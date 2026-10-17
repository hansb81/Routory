-- PRD v13 "메인 화면 개선 (여행 소식·인기 여행지)" — 여행 소식 피드 + 인기 여행지 테이블/RLS/RPC
-- 020_admins.sql의 is_admin()을 관리자 쓰기 권한 판별에 그대로 재사용한다.
--
-- 쓰기 경로는 두 갈래다:
--   1. 관리자가 앱/대시보드에서 직접 작성·수정·삭제 (아래 "관리자만 ..." 정책, is_admin() 경유)
--   2. 자동 수집 Edge Function이 service_role로 draft만 insert (service_role은 RLS를 아예 건너뛰므로
--      별도 정책이 필요 없다 — 이 마이그레이션엔 자동 수집 함수 자체는 포함하지 않는다)
-- 일반 로그인 사용자는 어느 쪽 테이블도 절대 직접 쓸 수 없다 (insert/update/delete 정책이 없으면 기본 거부).

-- ==========================================================================
-- 1. travel_feed_items — 안전 소식(safety) · 혜택/할인 소식(benefit)
-- ==========================================================================

create table public.travel_feed_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('safety', 'benefit')),
  scope text not null check (scope in ('domestic', 'overseas')),
  country_code text references public.country_currency (country_code), -- null 허용: 국내 소식이거나 특정 국가에 한정되지 않는 소식
  region_label text not null, -- 사람이 읽는 지역 표시 (예: "일본", "동남아 전체")
  airline_code text, -- IATA 2~3자 코드. 항공사 소식이 아니면 null
  title text not null,
  summary text not null, -- 우리 문장으로 쓴 요약, 200자 내외 (DB에서 길이를 강제하지는 않는다)
  action_tip text, -- "이렇게 하세요" 한 줄 (없을 수 있음)
  importance text not null check (importance in ('high', 'medium', 'low')),
  published_at timestamptz not null default now(),
  valid_from date, -- benefit 소식의 적용 시작일. safety 소식이면 보통 null
  valid_to date, -- benefit 소식의 적용 종료일. 지나면 get_travel_feed에서 자동 제외된다
  source_name text not null, -- 출처 표기 (예: "외교부 해외안전여행")
  source_url text not null, -- 원문 링크. 본문을 긁어오지 않고 항상 출처로 연결한다
  last_checked_at timestamptz not null default now(), -- 운영자/자동 수집이 마지막으로 원문을 확인한 시각
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  origin text not null check (origin in ('manual', 'auto')),
  external_id text, -- 자동 수집 원본의 고유 id (중복 수집 방지용). 수동 작성이면 null
  created_by uuid references auth.users (id) on delete set null, -- 수동 작성한 관리자. 자동 수집이면 null
  created_at timestamptz not null default now(),
  constraint travel_feed_items_valid_range_check
    check (valid_from is null or valid_to is null or valid_to >= valid_from)
);

-- 자동 수집은 같은 원본을 (origin, external_id) 기준으로 중복 적재하지 않는다.
-- external_id가 없는 수동 작성 행은 이 제약에서 제외한다(부분 유니크 인덱스).
create unique index travel_feed_items_origin_external_id_key
  on public.travel_feed_items (origin, external_id)
  where external_id is not null;

create index travel_feed_items_feed_idx
  on public.travel_feed_items (status, kind, scope, country_code, published_at desc);

create index travel_feed_items_airline_code_idx
  on public.travel_feed_items (airline_code);

alter table public.travel_feed_items enable row level security;

create policy "게시된 소식만 조회" on public.travel_feed_items
  for select to authenticated
  using (status = 'published');

create policy "관리자만 작성" on public.travel_feed_items
  for insert to authenticated
  with check (public.is_admin());

create policy "관리자만 수정" on public.travel_feed_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "관리자만 삭제" on public.travel_feed_items
  for delete to authenticated
  using (public.is_admin());

-- ==========================================================================
-- 2. popular_destinations — 월별 인기 여행지 랭킹
-- ==========================================================================

create table public.popular_destinations (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('overseas', 'domestic')),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), -- 'YYYY-MM'
  rank int not null check (rank > 0),
  name_ko text not null,
  country_code text references public.country_currency (country_code), -- 국내 랭킹이면 보통 null
  destination_id uuid references public.destinations (id) on delete set null, -- destinations에 이미 있는 도시면 연결, 없으면 null
  source_name text not null,
  source_url text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  unique (scope, period, rank)
);

create index popular_destinations_scope_period_idx
  on public.popular_destinations (scope, period);

alter table public.popular_destinations enable row level security;

create policy "게시된 랭킹만 조회" on public.popular_destinations
  for select to authenticated
  using (status = 'published');

create policy "관리자만 작성" on public.popular_destinations
  for insert to authenticated
  with check (public.is_admin());

create policy "관리자만 수정" on public.popular_destinations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "관리자만 삭제" on public.popular_destinations
  for delete to authenticated
  using (public.is_admin());

-- ==========================================================================
-- 3. get_travel_feed(kind, scope, limit) — 로그인한 사용자 맞춤 정렬
-- ==========================================================================
-- 우선순위 1~5 (낮을수록 먼저): 내 여행 국가+importance=high > 내 여행 국가 일치
--   > 내 여행 항공권의 항공사 일치 > 그 외 importance=high > 최신순.
-- "내 여행"은 내가 trip_members로 속해 있고 아직 끝나지 않은(end_date >= 오늘) 여행만 본다(지난 여행 제외).
-- 항공사 코드는 schedule_items.flight_no 맨 앞 2~3글자(IATA 코드, 예: "KE723" → "KE")에서 뽑는다 —
-- schedule_items에는 항공사명(airline)만 있고 IATA 코드 전용 컬럼이 없기 때문에 쓰는 best-effort 방식이다.
-- security definer지만 auth.uid()로 호출자 본인의 여행/항공권만 들여다보고, 그 값 자체는 결과에 포함하지 않는다
-- (반환하는 것은 published 상태의 travel_feed_items 행뿐 — 다른 사용자의 데이터는 어떤 형태로도 나가지 않는다).

create or replace function public.get_travel_feed(
  p_kind text default null,
  p_scope text default null,
  p_limit int default 20
)
returns setof public.travel_feed_items
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return; -- 로그인하지 않았으면 아무것도 내려주지 않는다
  end if;

  return query
  with my_trips as (
    select t.id, t.destination_id
    from public.trips t
    join public.trip_members tm on tm.trip_id = t.id
    where tm.user_id = v_uid
      and t.end_date >= current_date
  ),
  my_country_codes as (
    select distinct d.country_code
    from my_trips mt
    join public.destinations d on d.id = mt.destination_id
    where d.country_code is not null
  ),
  my_airline_codes as (
    select distinct upper(substring(si.flight_no from '^[A-Za-z]{2,3}')) as code
    from public.schedule_items si
    join my_trips mt on mt.id = si.trip_id
    where si.flight_no is not null
  ),
  candidates as (
    select f.*
    from public.travel_feed_items f
    where f.status = 'published'
      and (p_kind is null or f.kind = p_kind)
      and (p_scope is null or f.scope = p_scope)
      -- 적용 기간이 지난 혜택/할인 소식은 제외
      and not (
        f.kind = 'benefit'
        and f.valid_to is not null
        and f.valid_to < current_date
      )
      -- importance가 high가 아닌 안전 소식 중 90일 넘은 것은 제외 (high는 기간과 무관하게 계속 노출)
      and not (
        f.kind = 'safety'
        and f.importance <> 'high'
        and f.published_at < now() - interval '90 days'
      )
  )
  select c.*
  from candidates c
  order by
    case
      when c.country_code is not null
        and c.country_code in (select country_code from my_country_codes)
        and c.importance = 'high' then 1
      when c.country_code is not null
        and c.country_code in (select country_code from my_country_codes) then 2
      when c.airline_code is not null
        and c.airline_code in (select code from my_airline_codes) then 3
      when c.importance = 'high' then 4
      else 5
    end,
    c.published_at desc
  limit least(greatest(p_limit, 0), 100); -- 음수 방지 + 한 번에 최대 100개로 상한
end;
$$;

revoke execute on function public.get_travel_feed(text, text, int) from public, anon;
grant execute on function public.get_travel_feed(text, text, int) to authenticated;

-- ==========================================================================
-- 4. get_popular_destinations(scope) — 가장 최근 period의 상위 10개
-- ==========================================================================

create or replace function public.get_popular_destinations(p_scope text)
returns setof public.popular_destinations
language sql
stable
security definer
set search_path = ''
as $$
  select pd.*
  from public.popular_destinations pd
  where pd.status = 'published'
    and pd.scope = p_scope
    and pd.period = (
      select max(period)
      from public.popular_destinations
      where status = 'published' and scope = p_scope
    )
  order by pd.rank
  limit 10;
$$;

revoke execute on function public.get_popular_destinations(text) from public, anon;
grant execute on function public.get_popular_destinations(text) to authenticated;

-- 되돌리기:
-- drop function if exists public.get_popular_destinations(text);
-- drop function if exists public.get_travel_feed(text, text, int);
-- drop table if exists public.popular_destinations;
-- drop table if exists public.travel_feed_items;
