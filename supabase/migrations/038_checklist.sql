-- 038_checklist: 체크리스트 기능(준비물 체크리스트) 테이블과 RLS
--
-- SHELL의 하단 탭에 "체크리스트"가 새로 추가된다 (일정 · 여행중 · 여행지갑 · 가계부 · 체크리스트 5개,
-- tripShell.js). 가계부(expenses, 005_budget.sql)와 같은 "그 여행의 멤버라면 서로의 항목도 보고 고칠 수
-- 있다" 공유 모델을 그대로 따른다 - 짐 챙기기는 가족·동행자가 같이 보는 목록이라서다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다 (001~037 이후).
--   테이블이 이미 있으면 오류로 멈춘다. 맨 아래 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 만드는 것
--   1. checklist_categories 테이블 - 카테고리(기본값 "할 일"/"준비물" + 화면의 "+" 버튼으로 사용자가 더
--      추가할 수 있는 것). 처음엔 필수/의류/전자기기/세면·생활/상비용품 5개의 고정 카테고리(check 제약으로
--      강제)였다가, 사용자 요청으로 "할 일/준비물" 2개 기본값 + 자유 추가/삭제가 가능한 구조로 바뀌었다 -
--      그래서 카테고리는 더 이상 고정된 문자열 키가 아니라 이 테이블의 행(trip마다 따로)이다.
--   2. checklist_items 테이블 - 카테고리별 항목(여권, 충전기 ...), 완료 여부, 같은 카테고리 안에서의
--      순서(sort_order, schedule_items.sort_order·008과 같은 모양 - 카테고리가 다르면 비교하지 않는다).
--      category_id가 checklist_categories를 on delete cascade로 참조해서, 카테고리를 지우면 그 안의
--      항목도 함께 지워진다(화면의 "카테고리 삭제" = 카테고리와 그 항목 전부 삭제, 되돌릴 수 없다).
--   3. checklist_seeds 테이블 - "이 여행에 기본 카테고리·항목을 이미 한 번 깔아 두었다"는 표시만 남기는
--      마커 테이블. checklist_categories/checklist_items 자체로는 "원래 비어 있던 것"과 "사용자가 전부
--      지운 것"을 구분할 수 없어서(둘 다 0행), 체크리스트 화면(checklistPage.js)이 이 여행의 마커 행이
--      없을 때만 기본 카테고리·항목을 깔고 마커를 남긴다 - 그 뒤로는 사용자가 전부 지워도 다시 깔리지 않는다.
--      trips 테이블에 플래그 컬럼을 추가하는 대신 별도 테이블로 둔 이유: trips 수정은 owner만 가능한
--      RLS라서("owner만 여행 수정", 001), editor가 먼저 체크리스트를 열어 시딩한 경우 마커를 못 남기게
--      된다. 별도 테이블에 "멤버면 누구나 삽입 가능" 정책을 두면 이 문제가 없다.
--
-- PRD와 다르게 한 부분은 없다 (이 기능은 PRD 문서 없이 사용자 요청으로 바로 만들었다) - 005_budget.sql의
-- 관례(멤버 공유 모델, is_trip_member 재사용, created_by 기본값, set_updated_at 트리거)를 그대로 따랐다.

create table public.checklist_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 20),
  sort_order integer not null default 0, -- 같은 trip_id 안에서만 의미 있는 순서 (카테고리 나열 순서)
  created_by uuid default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);

create index checklist_categories_trip_id_idx on public.checklist_categories (trip_id);

alter table public.checklist_categories enable row level security;

-- 그 여행의 멤버(owner, editor 누구나)는 카테고리를 보고 등록하고 지울 수 있다 (expenses와 같은 모델).
create policy "멤버만 조회/수정" on public.checklist_categories
  for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  category_id uuid not null references public.checklist_categories (id) on delete cascade,
  title text not null,
  checked boolean not null default false,
  sort_order integer not null default 0, -- 같은 trip_id + category_id 안에서만 의미 있는 순서 (schedule_items.sort_order와 같은 모양)
  created_by uuid default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index checklist_items_trip_id_category_id_idx on public.checklist_items (trip_id, category_id);

alter table public.checklist_items enable row level security;

-- 그 여행의 멤버(owner, editor 누구나)는 체크리스트 항목을 보고 등록하고 고치고 지울 수 있다 (expenses와 같은 모델).
create policy "멤버만 조회/수정" on public.checklist_items
  for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create trigger checklist_items_set_updated_at
  before update on public.checklist_items
  for each row execute function public.set_updated_at();

-- "기본 카테고리·항목을 이미 깔았다" 마커 (위 설명 참고). update/delete 정책은 없다 - 한 번 생기면 지워지지
-- 않는 불변 마커라서 멤버가 실수로(또는 악의적으로) 지우고 다시 시딩을 유도할 수 없게 한다.
create table public.checklist_seeds (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  created_at timestamptz default now()
);

alter table public.checklist_seeds enable row level security;

create policy "멤버만 조회/생성" on public.checklist_seeds
  for select to authenticated
  using (public.is_trip_member(trip_id));

create policy "멤버만 마커 생성" on public.checklist_seeds
  for insert to authenticated
  with check (public.is_trip_member(trip_id));

-- 되돌리기:
-- drop table if exists public.checklist_seeds cascade;
-- drop table if exists public.checklist_items cascade;
-- drop table if exists public.checklist_categories cascade;
