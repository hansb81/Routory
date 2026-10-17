-- 메인 화면 '여행 소식' 영역 — get_travel_feed가 "내 여행지"/"내 항공편" 라벨을 화면에서 붙일 수 있게
-- 각 행에 매칭 여부를 boolean으로 같이 돌려준다. 022 다음, 023 다음에 실행한다(독립적이지만 번호 순서상).
--
-- 021의 get_travel_feed는 travel_feed_items의 원본 컬럼만 돌려줬다 — 어떤 행이 "내 여행 국가"/"내 항공권
-- 항공사"와 일치하는지는 함수 내부 우선순위 계산에만 쓰이고 바깥으로 안 나갔다. 클라이언트가 그 라벨을
-- 보여주려면 사용자의 여행/항공권 정보를 따로 또 조회해서 직접 매칭해야 하는데, 그러면 같은 매칭 로직을
-- 서버·클라이언트 두 곳에 중복으로 두게 되고 불필요한 데이터도 더 노출된다 — 대신 이미 서버가 계산해 둔
-- 결과를 is_my_destination/is_my_airline 두 컬럼으로 같이 내려준다.
--
-- 반환 타입이 바뀌므로(setof travel_feed_items → 커스텀 table(...)) create or replace로는 안 되고
-- drop 후 다시 만들어야 한다.

drop function if exists public.get_travel_feed(text, text, int);

create or replace function public.get_travel_feed(
  p_kind text default null,
  p_scope text default null,
  p_limit int default 20
)
returns table (
  id uuid,
  kind text,
  scope text,
  country_code text,
  region_label text,
  airline_code text,
  title text,
  summary text,
  action_tip text,
  importance text,
  published_at timestamptz,
  valid_from date,
  valid_to date,
  source_name text,
  source_url text,
  last_checked_at timestamptz,
  status text,
  origin text,
  external_id text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  updated_by uuid,
  published_by uuid,
  is_my_destination boolean,
  is_my_airline boolean
)
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
  ),
  scored as (
    select
      c.*,
      (c.country_code is not null and c.country_code in (select country_code from my_country_codes)) as is_my_destination,
      (c.airline_code is not null and c.airline_code in (select code from my_airline_codes)) as is_my_airline
    from candidates c
  )
  select
    s.id, s.kind, s.scope, s.country_code, s.region_label, s.airline_code,
    s.title, s.summary, s.action_tip, s.importance, s.published_at,
    s.valid_from, s.valid_to, s.source_name, s.source_url, s.last_checked_at,
    s.status, s.origin, s.external_id, s.created_by, s.created_at,
    s.updated_at, s.updated_by, s.published_by,
    s.is_my_destination, s.is_my_airline
  from scored s
  order by
    case
      when s.is_my_destination and s.importance = 'high' then 1
      when s.is_my_destination then 2
      when s.is_my_airline then 3
      when s.importance = 'high' then 4
      else 5
    end,
    s.published_at desc
  limit least(greatest(p_limit, 0), 100); -- 음수 방지 + 한 번에 최대 100개로 상한
end;
$$;

revoke execute on function public.get_travel_feed(text, text, int) from public, anon;
grant execute on function public.get_travel_feed(text, text, int) to authenticated;

-- 되돌리기: 024 이전 버전(라벨 플래그 없는 버전)으로 되돌리려면 021_travel_feed.sql의 함수 정의를 다시 실행한다.
