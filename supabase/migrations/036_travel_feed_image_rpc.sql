-- 035_travel_feed_image.sql이 travel_feed_items.image_url 컬럼을 추가했지만, 사용자 화면(메인 화면
-- 미리보기/전체 목록/상세 모달 - travelFeed.js)은 그 테이블을 직접 select하지 않고 get_travel_feed RPC만
-- 호출한다. 026에서 고정된 get_travel_feed는 `returns table (...)`에 명시적 컬럼 목록을 쓰고 있어서(024가
-- 처음 그렇게 바꿈), 035가 테이블에 컬럼을 추가해도 이 RPC의 반환 목록엔 자동으로 안 붙는다 — 그래서
-- 관리 페이지(`travel_feed_items`를 직접 select하는 adminPage.js)는 이미지가 보이는데 실사용자 화면은
-- 하나도 안 보이는 증상이 났다. 이 마이그레이션은 image_url을 반환 목록에 추가하는 것, 그 외 로직은
-- 026과 100% 동일하다.
--
-- 반환 타입이 바뀌므로(024/026과 같은 이유) create or replace로는 안 되고 drop 후 다시 만들어야 한다.

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
  is_my_airline boolean,
  image_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
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
    s.is_my_destination, s.is_my_airline, s.image_url
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

-- 되돌리기: 026_travel_feed_variable_conflict_fix.sql의 함수 정의(image_url 없는 버전)를 다시 실행한다.
