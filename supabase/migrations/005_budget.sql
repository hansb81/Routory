-- 005_budget: 가계부 기능 (PRD v6 "가계부 기능")의 expenses 테이블과 RLS
--
-- 이름을 004가 아니라 005로 했다: 004_leave_trip.sql이 이미 있어서, 파일 이름이 겹치면 어느 것을 먼저
-- 실행했는지 헷갈린다. 001~004를 먼저 실행한 뒤에 이 파일을 실행한다 (특히 003의 함수 is_trip_member,
-- 001의 함수 set_updated_at을 그대로 재사용한다).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   expenses 테이블이 이미 있으면 오류로 멈춘다. 맨 아래의 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 만드는 것
--   1. expenses 테이블 (PRD 6번 스키마)
--   2. RLS 활성화
--   3. "멤버만 조회/수정" 정책 (그 여행의 멤버라면 항공편·숙소처럼 서로의 지출도 보고 고칠 수 있다 — PRD 5-6의
--      "결제/나누기"가 여러 명을 겨냥하는 공용 지출 개념과 맞춘 것이다. 한 사람만 자기 지출을 고치게 하려면
--      "using (created_by = auth.uid())"로 바꾸면 된다.)
--
-- PRD와 다르게 한 부분 (이유)
--   A. trip_id를 not null로 했다. PRD 원문은 not null이 없었지만, 지출은 반드시 어느 여행에 속해야 앱이
--      쓸 수 있다 (schedule_items.trip_id도 not null이다).
--   B. RLS 정책을 PRD가 준 SQL 그대로("trip_id in (select ... from trip_members ...)") 쓰지 않고,
--      001에서 만든 is_trip_member(uuid) 함수를 썼다. 같은 조건이지만, RLS 정책 안에서 다른 테이블을
--      직접 서브쿼리하면 그 테이블의 정책까지 다시 평가되어 trip_members처럼 자기 자신을 참조하는 경우
--      무한 재귀 오류가 날 수 있다. expenses는 trip_members를 참조만 하니 지금 당장은 문제가 없지만,
--      helper 함수를 쓰면 항상 안전하고 001·002의 다른 정책과도 일관된다.
--   C. created_by 기본값을 auth.uid()로 채웠다 (PRD는 참조만 정의하고 기본값이 없었다). schedule_items와
--      같은 방식이라 폼에서 따로 넣지 않아도 "누가 등록했는지"가 남는다.
--   D. amount에 "0보다 커야 한다" 검사를 더했다. 영수증 금액이 음수이거나 0인 지출은 의미가 없어서다.
--   E. category에 PRD 4번이 정한 7개 값(항공/숙소/교통/식비/쇼핑/투어/기타)만 허용하는 검사를 더했다.
--      js/expenseCategoryData.js의 key와 정확히 같은 7개(flight/lodging/transport/meal/shopping/tour/etc)다.
--   F. schedule_items(trip_id, date)처럼 (trip_id, day_key) 색인을 추가했다. 가계부 목록이 Day별로
--      묶어서 보여주므로 조회가 빨라진다.
--   G. 수정할 때 updated_at이 자동으로 지금 시각이 되도록, 001에서 만든 set_updated_at() 트리거 함수를
--      재사용해 트리거를 하나 더 달았다 (schedule_items에 이미 같은 방식으로 달려 있다).
--
-- 여기서 하지 않은 것
--   - 환율 고정값 테이블은 SQL이 아니라 js/currencyData.js에 둔다 (요청하신 파일 구성대로). 서버는
--     각 지출을 저장할 때 앱이 계산해 보낸 krw_amount를 그대로 저장만 한다 (PRD 6번 "저장 시점 환율로
--     환산" 그대로).
--   - payer_ids/split_ids(uuid[])는 각 원소가 trip_members의 user_id를 가리키는 값이지만, Postgres는
--     배열 원소 하나하나에 외래키를 걸 수 없어서 참조 무결성 검사는 걸지 않았다 (PRD도 걸지 않았다).

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  day_key text not null, -- '여행준비' 구간은 'prep', 그 외는 'YYYY-MM-DD' (일정의 Day 구분과 같은 값)
  amount numeric not null check (amount > 0),
  currency text not null, -- 'KRW' | 'USD' | 여행지 통화 코드(예: 'VND') — js/currencyData.js의 code
  krw_amount numeric, -- 저장 시점 환율로 환산한 KRW 값 (합계 계산용, 근사치). 앱이 계산해서 보낸다.
  payment_method text check (payment_method in ('cash', 'card')),
  title text not null,
  category text not null check (category in ('flight', 'lodging', 'transport', 'meal', 'shopping', 'tour', 'etc')),
  payer_ids uuid[] default '{}', -- 결제한 사람들 (trip_members의 user_id, 보통 여러 명은 아니지만 여러 명도 허용)
  split_ids uuid[] default '{}', -- 나눠 낸 사람들 (trip_members의 user_id)
  memo text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index expenses_trip_id_day_key_idx on public.expenses (trip_id, day_key);

alter table public.expenses enable row level security;

-- 그 여행의 멤버(owner, editor 누구나)는 지출을 보고 등록하고 고치고 지울 수 있다.
-- is_trip_member는 001_invite_feature.sql이 만든 함수다 (RLS 재귀를 피하려고 security definer로 만들어졌다).
create policy "멤버만 조회/수정" on public.expenses
  for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- set_updated_at()은 001_invite_feature.sql이 만든 함수다 (schedule_items에도 같은 방식으로 달려 있다)
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- 되돌리기: drop table if exists public.expenses cascade;
