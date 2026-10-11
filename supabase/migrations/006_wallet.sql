-- 006_wallet: 여행지갑 기능 (PRD v7 "여행지갑 기능")의 wallet_items 테이블과 Storage 정책
--
-- 001~005를 먼저 실행한 뒤에 이 파일을 실행한다 (wallet_items.trip_id가 public.trips를 참조한다).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   단, **2번(Storage 정책)을 실행하기 전에 'wallet' 버킷을 먼저 만들어야 한다** — 이 파일 맨 아래
--   "버킷 만들기(대시보드)" 안내를 먼저 따라 한 다음 이 SQL을 실행한다. (버킷이 없어도 정책 자체는
--   오류 없이 만들어지지만, 버킷이 있어야 의미가 있다.)
--   wallet_items 테이블이 이미 있으면 오류로 멈춘다. 맨 아래의 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 만드는 것
--   1. wallet_items 테이블 (PRD 6번 스키마) + RLS "본인만 조회/수정"
--   2. Storage 정책: 'wallet' 버킷의 경로가 "{내 auth.uid()}/파일명" 형식일 때만 업로드·조회·수정·삭제 허용
--      (storage.objects는 모든 Supabase 프로젝트에서 기본적으로 RLS가 켜져 있어 따로 enable할 필요가 없고,
--      권한이 없어 enable/disable 자체가 안 될 수도 있다 — 그래서 이 파일은 정책만 만든다)
--
-- PRD와 다르게 한 부분 (이유)
--   A. auth.uid()를 (select auth.uid())로 감쌌다. 001의 다른 정책들과 같은 이유로, 이렇게 하면
--      PostgreSQL이 행마다 다시 계산하지 않고 한 번만 계산해 둬서 더 빠르다(Supabase 권장 방식).
--   B. trip_id의 삭제 규칙을 on delete cascade가 아니라 on delete set null로 했다. PRD 원문에는 규칙이
--      없어(기본값 no action) 여행지갑에 연결해 둔 여행을 지우려고 하면 외래키 오류로 여행 삭제 자체가
--      막힌다. 여행지갑 항목은 여행이 아니라 "나"에게 속한 개인 문서(여권 등 다른 여행에도 쓰는 것)라서,
--      연결된 여행이 지워져도 문서는 남고 trip_id만 비워지는 쪽(공통 보관함으로 남음)이 맞다.
--   C. user_id에는 on delete cascade를 추가했다 (계정이 없어지면 그 사람의 문서도 함께 없어진다 —
--      001의 trip_members.user_id와 같은 규칙).
--   D. category, file_type에 PRD 7번이 확정한 값만 허용하는 check 제약을 추가했다
--      (category: passport/flight/qr/lodging/etc, file_type: image/pdf). 005의 expenses.category와 같은 방식이다.
--   E. (user_id, trip_id) 색인을 추가했다. RLS가 항상 user_id로 거르고, 화면에서 "이 여행에 연결된 문서만"
--      보여줄 때도 이 색인 하나로 다 된다.
--   F. file_url은 이름 그대로 "공개 URL"이 아니라 **Storage 안의 경로**(예: "그-사람-uid/파일명.png")를 저장하는
--      용도로 쓰기를 권한다. 'wallet' 버킷이 private라 공개 URL 자체가 없기 때문이다 — 화면에서 보여줄 때는
--      이 경로로 서명된 URL(signed URL)을 그때그때 새로 만들어야 한다. (컬럼 이름은 PRD 그대로 두었다.)

-- ==========================================================================
-- 1. wallet_items 테이블 + RLS
-- ==========================================================================

create table public.wallet_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null, -- 특정 여행과 연결(선택). null이면 공통 보관함
  category text not null check (category in ('passport', 'flight', 'qr', 'lodging', 'etc')),
  title text not null,
  description text,
  file_url text not null, -- 'wallet' 버킷 안의 경로 ("{auth.uid()}/파일명"). private 버킷이라 공개 URL이 아니다
  file_type text not null check (file_type in ('image', 'pdf')),
  created_at timestamptz default now()
);

create index wallet_items_user_trip_idx on public.wallet_items (user_id, trip_id);

alter table public.wallet_items enable row level security;

-- 본인 것만 보고 등록하고 고치고 지울 수 있다. 여행 멤버에게도 공개하지 않는다(개인 문서라서 일정/가계부와 다르다).
create policy "본인만 조회/수정" on public.wallet_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ==========================================================================
-- 2. Storage 정책: 'wallet' 버킷, 경로 "{내 auth.uid()}/파일명"일 때만 본인이 업로드/조회/수정/삭제
-- ==========================================================================
-- storage.foldername(name)은 경로("아이디/파일명.png")를 '/'로 나눈 배열이다. [1]이 첫 번째 조각(=폴더 이름).
-- 이 조각이 내 auth.uid()와 같을 때만 허용한다 (PRD: "경로의 첫 번째 세그먼트가 auth.uid()와 일치할 때만").

create policy "wallet: 본인 폴더만 업로드·조회·수정·삭제" on storage.objects
  for all to authenticated
  using (bucket_id = 'wallet' and (select auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'wallet' and (select auth.uid())::text = (storage.foldername(name))[1]);

-- 되돌리기:
-- drop policy "wallet: 본인 폴더만 업로드·조회·수정·삭제" on storage.objects;
-- drop table if exists public.wallet_items cascade;

-- ==========================================================================
-- 버킷 만들기 (대시보드에서 직접 — SQL이 아니다)
-- ==========================================================================
-- 1. Supabase 대시보드 → 왼쪽 메뉴 Storage → "New bucket"
-- 2. Name: wallet
-- 3. "Public bucket" 토글을 반드시 꺼진 상태(OFF)로 둔다 — private 버킷. (켜져 있으면 이 파일의 Storage
--    정책과 무관하게 누구나 파일을 볼 수 있게 되므로 중요하다.)
-- 4. "Additional configuration" 펼쳐서(있는 버전이라면):
--      - File size limit: 10 (MiB) — PRD 4번의 "개당 최대 10MB"
--      - Allowed MIME types: image/png, image/jpeg, application/pdf
--    (이 필드가 없는 오래된 대시보드 버전이면 건너뛰고, 업로드 전 앱 쪽에서 형식·용량을 확인하게 한다.)
-- 5. "Create bucket"
-- 6. 만든 뒤 다시 확인하려면: Storage → wallet 버킷 클릭 → 오른쪽 위에 "Public" 표시가 없어야 private다.
-- 7. 이 파일의 2번 SQL을 실행하면 정책이 만들어진다. Storage → Policies(또는 wallet 버킷의 Policies 탭)에서
--    "wallet: 본인 폴더만 업로드·조회·수정·삭제" 정책이 보이면 잘 된 것이다. 대시보드에서 정책을 손으로
--    또 만들 필요는 없다.
