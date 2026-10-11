-- 012_account_deletion_requests: 로그인 없이도 접수할 수 있는 "계정 삭제 요청" 테이블과 RLS.
--
-- 이 테이블은 triplog/account-deletion.html(로그인 없이 열리는 정적 페이지, Google Play 데이터 안전
-- 양식에 등록할 URL)의 폼이 쓴다. 그 페이지는 앱(index.html) 밖의 독립된 정적 페이지라 로그인 세션이
-- 없고, anon 키로만 이 테이블에 쓸 수 있다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   account_deletion_requests 테이블이 이미 있으면 오류로 멈춘다. 맨 아래의 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 만드는 것
--   1. account_deletion_requests 테이블: 이메일, 로그인 수단, 추가 메모, 처리 상태를 담는다.
--   2. RLS 활성화 + "누구나 접수만 가능" INSERT 정책. SELECT/UPDATE/DELETE 정책은 일부러 두지 않는다 —
--      로그인조차 하지 않은 사람이 보내는 요청이라 "본인 것만" 같은 조건을 걸 수가 없고(계정이 없으니
--      auth.uid()가 없다), 그렇다고 아무나 다 읽게 하면 다른 사람이 남긴 이메일 주소가 그대로
--      노출된다 — 그래서 조회는 Supabase 대시보드(Table Editor, service_role로 동작)에서 운영자가
--      직접 확인·처리하는 방식으로만 연다. 처리 자체(실제 계정 삭제)는 이번 작업 범위가 아니다 — 수동으로
--      처리하거나, 나중에 운영자가 이 테이블을 보고 delete-account Edge Function을 대신 호출해 주는 식으로
--      연결할 수 있다(요청하신 1번 "나중에 연결해도 됨" 참고).
--
-- 설계 결정
--   A. email은 필수, login_provider는 선택(값을 모를 수도 있어서) — 'google'|'kakao'|'naver'|'other'|null로
--      제한한다(로그인 화면의 세 제공자 + "모름/기타"). 값 검사는 폼에서도 하지만, 테이블에도 같은 체크
--      제약을 걸어 둔다(앱 서버 코드 없이 anon 키로 직접 insert하는 구조라, 폼의 검증만으로는 다른
--      값이 들어오는 걸 막을 수 없다 — DB 쪽 제약이 마지막 방어선이다).
--   B. email/message 길이에 넉넉한 상한을 뒀다(스팸성으로 지나치게 긴 값이 들어오는 것만 막는 최소한의
--      장치 — CAPTCHA 같은 본격적인 스팸 방지는 이번 범위에 넣지 않았다. RLS가 "쓰기 전용"이라 스팸이
--      쌓여도 다른 사용자 데이터에는 영향이 없고, 운영자가 대시보드에서 지우면 된다).
--   C. status(pending/done/rejected, 기본 pending)와 processed_at을 뒀다 — 운영자가 대시보드에서 처리
--      상태를 표시해 둘 수 있게 하는 최소한의 필드다. 이 두 컬럼도 RLS상 일반 사용자는 못 보고 못 바꾼다.
--   D. user_id/계정 자체를 참조하는 외래키는 두지 않았다 — 요청 시점에 그 사람이 실제로 로그인된 계정을
--      갖고 있는지조차 확인하지 않는 테이블이라서(로그인 없이 받는 요청이라는 것 자체가 핵심이다),
--      auth.users를 참조할 방법이 없다.

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 320),
  login_provider text check (login_provider in ('google', 'kakao', 'naver', 'other')),
  message text check (char_length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  created_at timestamptz default now(),
  processed_at timestamptz
);

alter table public.account_deletion_requests enable row level security;

-- 로그인 여부와 무관하게(anon도 authenticated도) 새 요청을 넣을 수 있다 — 조회/수정/삭제 정책은 없다
-- (위 설명 참고 — 운영자가 Supabase 대시보드에서 service_role로 직접 확인한다).
create policy "누구나 접수만 가능" on public.account_deletion_requests
  for insert to anon, authenticated
  with check (true);

-- 되돌리기: drop table if exists public.account_deletion_requests cascade;
