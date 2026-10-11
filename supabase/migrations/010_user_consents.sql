-- 010_user_consents: 이용약관·개인정보처리방침·마케팅 수신 동의를 저장하는 user_consents 테이블과 RLS
--
-- 001(특히 set_updated_at() 함수)을 먼저 실행한 뒤에 이 파일을 실행한다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   user_consents 테이블이 이미 있으면 오류로 멈춘다. 맨 아래의 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 만드는 것
--   1. user_consents 테이블: 사용자 한 명당 한 행 — 이용약관/개인정보처리방침에 동의한 버전·시각,
--      마케팅 수신 동의 여부·시각을 담는다.
--   2. RLS 활성화 + "본인만 조회/수정" 정책 (user_id = auth.uid()인 행만 각자 읽고 쓸 수 있다)
--
-- 설계 결정 (요청에 없던 부분을 이렇게 채운 이유)
--   A. user_id에 unique 제약을 걸어 "사용자당 한 행"으로 했다. 이 테이블은 "지금 이 사람이 동의한 최신
--      상태"를 담는 용도라서(예: 약관이 바뀌면 다시 동의받고 terms_version/terms_agreed_at을 그 값으로
--      갱신), 동의할 때마다 쌓이는 이력 테이블이 아니다. 나중에 "언제 몇 번 동의했는지" 이력 자체가
--      필요해지면 별도의 로그 테이블(예: consent_log)을 추가하는 쪽을 권한다 — 이 테이블의 쓰임을 바꾸지
--      않기 위해서다.
--   B. user_id 기본값을 auth.uid()로 채웠다 (005의 expenses.created_by, 006의 wallet_items 패턴과 같은
--      이유 — 앱이 로그인한 사용자의 id를 따로 넣지 않아도 된다). on delete cascade는 계정이 삭제되면
--      동의 기록도 함께 지워지게 한다(006의 wallet_items.user_id와 같은 규칙).
--   C. marketing_agreed는 not null default false로 했다 — boolean 컬럼은 "동의 안 함"이 기본값이어야
--      하고(마케팅 수신은 opt-in이 원칙), null(동의 여부 모름) 상태를 허용하지 않는 편이 앱 쪽에서 다루기
--      쉽다.
--   D. terms_version/privacy_version은 자유 형식 text로 뒀다(예: "2026-01-01" 날짜나 "v1" 같은 버전
--      문자열) — 아직 앱에 버전 체계가 없어서 특정 형식을 강제하지 않았다. 둘 다 null을 허용한다(아직 한
--      번도 동의하지 않은 사용자의 행이 있을 수 있다는 뜻은 아니고, B번처럼 행 자체가 없으면 "동의 전"
--      이라는 뜻 — 다만 나중에 "동의는 했지만 버전 기록이 비는" 경우를 대비해 not null로 막지는 않았다).
--   E. auth.uid()를 (select auth.uid())로 감쌌다. 006/007과 같은 이유로, 행마다 다시 계산하지 않고 한 번만
--      계산해 더 빠르다(Supabase 권장 방식).
--   F. RLS 정책은 wallet_items(006)와 같은 모양으로 "본인만 조회/수정" 하나의 for all 정책만 둔다 — 이
--      테이블도 다른 사람과 공유되지 않는 순수 개인 데이터라서(여행 멤버에게도 공개하지 않는 wallet_items와
--      같은 성격), select/insert/update를 나눌 이유가 없다.
--   G. 수정 시 updated_at이 자동으로 지금 시각이 되도록 001의 set_updated_at() 트리거 함수를 재사용한다.
--
-- 여기서 하지 않은 것
--   - 이용약관·개인정보처리방침 "문서 자체"의 버전 이력을 담는 테이블은 만들지 않았다 (terms_version 등은
--     사용자가 "어떤 버전에 동의했는지"만 기록한다). 문서 내용 자체는 지금은 정적 화면(js/legalPages.js)의
--     하드코딩된 텍스트다 — 문서 버전 관리가 필요해지면 그때 별도 테이블/CMS를 고려한다.
--   - 동의를 모으는 화면(가입 시 체크박스 등)과 이 테이블에 실제로 쓰는 코드는 이번 작업 범위가 아니다.
--     이번 작업은 테이블/RLS와, 약관·정책 "내용"을 보여주는 화면(#/terms, #/privacy)까지다.

create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  terms_version text,
  privacy_version text,
  terms_agreed_at timestamptz,
  privacy_agreed_at timestamptz,
  marketing_agreed boolean not null default false,
  marketing_agreed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_consents enable row level security;

-- 본인 행만 보고 등록하고 고칠 수 있다 (006의 wallet_items "본인만 조회/수정"과 같은 모양).
create policy "본인만 조회/수정" on public.user_consents
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- set_updated_at()은 001_invite_feature.sql이 만든 함수다 (expenses·schedule_items에도 같은 방식으로 달려 있다)
create trigger user_consents_set_updated_at
  before update on public.user_consents
  for each row execute function public.set_updated_at();

-- 되돌리기: drop table if exists public.user_consents cascade;
