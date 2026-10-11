-- 001_invite_feature: 여행 공유 · 초대 기능 (PRD v3)의 테이블, RLS 정책, 트리거
--
-- 만드는 것
--   1. 테이블 4개: trips(여행), schedule_items(일정), trip_members(멤버), trip_invites(초대 링크)   (PRD 2번)
--   2. 4개 테이블 모두 ROW LEVEL SECURITY 활성화
--   3. 멤버만 조회/수정할 수 있는 RLS 정책, 권한은 PRD 4번 기준 (owner: 일정 CRUD + 멤버 관리 + 여행 수정/삭제, editor: 일정 CRUD만)
--   4. 여행을 만들면 만든 사람을 trip_members에 role = 'owner'로 자동 추가하는 트리거
--   5. (PRD 3-1의 초대 수락에 꼭 필요해서 추가) accept_trip_invite 함수
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   같은 이름의 테이블이 이미 있으면 오류로 멈춘다 (있는 테이블을 조용히 건너뛰지 않으려고 IF NOT EXISTS를 쓰지 않았다).
--   맨 아래의 "되돌리기" 블록은 주석이다. 개발 중에 처음부터 다시 하고 싶을 때만 풀어서 쓴다.
--
-- PRD와 다르게 한 부분 (이유)
--   A. RLS 정책: PRD의 정책 그대로는 동작하지 않는다.
--      - trips에 SELECT 정책만 있어서 여행을 만들 수도(INSERT), 고칠 수도, 지울 수도 없다.
--      - trip_members의 SELECT 정책이 같은 테이블 trip_members를 다시 조회해서 "infinite recursion detected in policy" 오류가 난다.
--      그래서 멤버 여부를 RLS를 건너뛰고 확인하는 도우미 함수(is_trip_member, is_trip_owner)를 만들고, 빠진 정책을 채웠다.
--   B. trip_invites에도 RLS를 켰다 (PRD 5번은 3개 테이블만 켠다). 초대 코드를 아무나 읽으면 안 되기 때문이다.
--   C. 앱이 쓰는 컬럼을 더했다: trips.city_id(항공편·숙소 기능이 도시를 알아보는 값), schedule_items.lat/lng(지도 표시),
--      schedule_items.flight/lodging(항공편·숙소 상세, jsonb).
--   D. schedule_items의 title, category는 PRD에서 NOT NULL이지만 해제했다. 지금 앱의 일정에는 제목과 카테고리 입력이 없다.
--      (time 컬럼은 PRD대로 두었다.)
--   E. accept_trip_invite 함수를 추가했다. 초대받는 사람은 아직 멤버가 아니라서 RLS 때문에 초대 코드를 읽을 수도,
--      trip_members에 자기 자신을 넣을 수도 없다. PRD 3-1의 "코드 검증 → 멤버 추가"는 이 함수로만 할 수 있다.
--   [PRD 4번의 해석] 초대 링크 만들기·조회는 "멤버 관리"라서 owner만 할 수 있게 했다. editor도 하게 하려면 trip_invites 정책의 is_trip_owner를 is_trip_member로 바꾼다.
--   002_flight_ocr.sql이 나중에 schedule_items에 airline, flight_no 컬럼을 더하므로 여기에는 넣지 않았다.

-- ==========================================================================
-- 1. 테이블 (PRD 2번)
-- ==========================================================================

-- 여행
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id),
  title text not null,
  destination text,
  city_id text,
  start_date date not null,
  end_date date not null,
  created_at timestamptz default now(),
  constraint trips_dates_check check (end_date >= start_date)
);

-- 일정 (사진은 넣지 않는다: 앱은 사진을 브라우저 안에만 두고, 항공권 사진은 저장하지 않는다)
create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  date date not null,
  time time,
  category text,
  title text,
  place text,
  lat double precision,
  lng double precision,
  memo text,
  flight jsonb,
  lodging jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 멤버 (소유자 + 초대받은 사람)
create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at timestamptz default now(),
  unique (trip_id, user_id)
);

-- 초대 링크: https://도메인/#/invite/<invite_code>
-- invite_code는 앱이 만들어 넣어도 되고, 넣지 않으면 추측하기 어려운 무작위 값이 들어간다.
create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  expires_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);

-- 정책이 "이 사용자가 멤버인가"를 매번 찾으므로 그 조회가 빨라야 한다
create index trip_members_user_id_idx on public.trip_members (user_id);
create index schedule_items_trip_id_date_idx on public.schedule_items (trip_id, date);
create index trip_invites_trip_id_idx on public.trip_invites (trip_id);

-- ==========================================================================
-- 2. 도우미 함수 (RLS 정책에서 쓴다)
-- ==========================================================================
-- 정책 안에서 trip_members를 직접 조회하면 trip_members의 정책이 다시 trip_members를 조회해서 무한 반복 오류가 난다.
-- 그래서 RLS를 건너뛰는 함수(security definer)로 "이 사용자가 이 여행의 멤버/소유자인가"만 확인한다.
-- search_path를 비워 두어 다른 스키마의 같은 이름 객체로 바꿔치기되는 것을 막는다.

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members m
    where m.trip_id = p_trip_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_trip_owner(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members m
    where m.trip_id = p_trip_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- 로그인한 사용자만 부를 수 있게 한다
revoke execute on function public.is_trip_member(uuid) from public, anon;
revoke execute on function public.is_trip_owner(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_owner(uuid) to authenticated;

-- ==========================================================================
-- 3. RLS 활성화 (4개 테이블 모두)
-- ==========================================================================
-- 켜기만 하고 정책이 없으면 아무도 못 본다. 아래 정책이 허용한 것만 된다.
-- 모든 정책은 로그인한 사용자(authenticated)에게만 주어서, 로그인하지 않은 사용자(anon)는 아무것도 못 한다.

alter table public.trips enable row level security;
alter table public.schedule_items enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;

-- ==========================================================================
-- 4. RLS 정책 (PRD 4번 권한 모델 + 5번 정책)
-- ==========================================================================

-- ---- trips ----
-- 조회: 멤버만. "만든 사람"도 넣은 이유는, 여행을 만드는 순간(INSERT ... RETURNING)에는 멤버 등록 트리거가 아직 끝나기 전이라
-- 멤버 조건만으로는 방금 만든 여행을 돌려받는 조회가 막히기 때문이다.
create policy "멤버만 여행 조회" on public.trips
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_trip_member(id));

create policy "내 이름으로만 여행 생성" on public.trips
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- 여행 정보 수정과 삭제는 owner만 (PRD 4번: 여행 삭제 불가는 editor, 6번: 여행 관리는 owner만)
create policy "owner만 여행 수정" on public.trips
  for update to authenticated
  using (public.is_trip_owner(id))
  with check (public.is_trip_owner(id));

create policy "owner만 여행 삭제" on public.trips
  for delete to authenticated
  using (public.is_trip_owner(id));

-- ---- schedule_items ----
-- 그 여행의 멤버(owner, editor)는 일정을 보고 만들고 고치고 지울 수 있다 (PRD: "멤버만 일정 조회/수정", for all)
create policy "멤버만 일정 조회/수정" on public.schedule_items
  for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- ---- trip_members ----
-- 멤버 목록은 그 여행의 멤버만 볼 수 있다 (자기 멤버십도 여기에 포함된다)
create policy "멤버만 멤버 목록 조회" on public.trip_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_trip_member(trip_id));

-- 강퇴: owner가 다른 멤버를 내보낼 수 있다 (owner 자신은 못 지운다).
create policy "owner만 멤버 강퇴" on public.trip_members
  for delete to authenticated
  using (public.is_trip_owner(trip_id) and user_id <> (select auth.uid()));

-- 멤버 추가(INSERT)와 역할 변경(UPDATE) 정책은 일부러 만들지 않았다: 클라이언트가 직접 멤버가 되거나 역할을 바꿀 수 없게 하려는 것이다.
-- 멤버가 늘어나는 길은 두 가지뿐이다: (1) 아래 트리거가 만든 사람을 owner로 넣는 것, (2) 아래 accept_trip_invite 함수로 초대를 수락하는 것.
-- (editor가 스스로 나가는 기능은 PRD에 없어서 만들지 않았다.)

-- ---- trip_invites ----
-- 초대 링크의 조회·생성·폐기는 owner만 한다 (멤버 관리로 보았다). 초대받는 사람은 이 테이블을 직접 읽을 수 없고,
-- 코드를 검사하고 멤버로 넣어 주는 accept_trip_invite 함수로만 수락한다.
create policy "owner만 초대 조회" on public.trip_invites
  for select to authenticated
  using (public.is_trip_owner(trip_id));

create policy "owner만 초대 생성" on public.trip_invites
  for insert to authenticated
  with check (public.is_trip_owner(trip_id) and created_by = (select auth.uid()));

create policy "owner만 초대 폐기" on public.trip_invites
  for delete to authenticated
  using (public.is_trip_owner(trip_id));

-- ==========================================================================
-- 5. 트리거
-- ==========================================================================

-- 여행을 만들면 만든 사람을 role = 'owner'로 trip_members에 자동 추가한다.
-- trip_members에는 INSERT 정책이 없어서 일반 권한으로는 넣을 수 없으므로 RLS를 건너뛰는 함수(security definer)로 넣는다.
create or replace function public.add_trip_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (trip_id, user_id) do nothing;
  return new;
end;
$$;

-- 트리거 함수는 사용자가 직접 부를 필요가 없다
revoke execute on function public.add_trip_owner() from public, anon, authenticated;

create trigger trips_add_owner
  after insert on public.trips
  for each row execute function public.add_trip_owner();

-- 일정을 고칠 때마다 updated_at을 지금 시각으로 바꾼다
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger schedule_items_set_updated_at
  before update on public.schedule_items
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 6. 초대 수락 함수 (PRD 3-1: 코드 검증 → trip_members에 본인 추가)
-- ==========================================================================
-- 앱에서: const { data: tripId, error } = await supabase.rpc('accept_trip_invite', { p_invite_code: code })
-- 성공하면 그 여행의 id를 돌려주고(그 여행 페이지로 이동하면 된다), 실패하면 오류 메시지가 온다:
--   login_required           로그인하지 않았다
--   invite_invalid_or_expired 없는 코드이거나 7일이 지났다
-- 이미 멤버인 사람이 다시 수락해도 역할은 그대로다 (owner가 자기 초대를 눌러도 owner로 남는다). 새 멤버는 editor로 들어온다.

create or replace function public.accept_trip_invite(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_trip uuid;
begin
  if v_user is null then
    raise exception 'login_required';
  end if;

  select i.trip_id
    into v_trip
    from public.trip_invites i
   where i.invite_code = p_invite_code
     and i.expires_at > now();

  if v_trip is null then
    raise exception 'invite_invalid_or_expired';
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (v_trip, v_user, 'editor')
  on conflict (trip_id, user_id) do nothing;

  return v_trip;
end;
$$;

revoke execute on function public.accept_trip_invite(text) from public, anon;
grant execute on function public.accept_trip_invite(text) to authenticated;

-- ==========================================================================
-- 되돌리기 (개발 중에 처음부터 다시 하고 싶을 때만: 아래 주석을 풀고 실행한다. 저장된 데이터가 모두 지워진다)
-- ==========================================================================
-- drop function if exists public.accept_trip_invite(text);
-- drop table if exists public.trip_invites cascade;
-- drop table if exists public.trip_members cascade;
-- drop table if exists public.schedule_items cascade;
-- drop table if exists public.trips cascade;
-- drop function if exists public.add_trip_owner();
-- drop function if exists public.set_updated_at();
-- drop function if exists public.is_trip_member(uuid);
-- drop function if exists public.is_trip_owner(uuid);
