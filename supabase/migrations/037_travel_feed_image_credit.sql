-- 여행 소식 대표 이미지의 출처 표기 — Wikimedia Commons(CC BY/CC BY-SA는 저작자 표기가 라이선스 조건)와
-- Unsplash 둘 다 사진을 쓸 때 저작자/출처를 남겨야 하는데, 035_travel_feed_image.sql은 image_url 하나만
-- 저장해서 그 정보가 어디에도 안 남았다 — 이 마이그레이션이 그 메타데이터 컬럼을 추가한다.
-- discover_city_images(027_discover_cities.sql)와 같은 이름(credit_name/credit_url/license/source_name/
-- source_url)을 쓰되, travel_feed_items엔 이미 뉴스 원문용 source_name/source_url이 있으므로 충돌을
-- 피하려고 전부 image_ 접두어를 붙인다. 전부 nullable — 관리자가 URL을 직접 입력한 경우처럼 출처를 모를
-- 수도 있다(그 경우 상세 화면은 이미지만 보여주고 출처 줄 자체를 숨긴다).
--
-- 035/036을 쪼개서 "테이블엔 컬럼을 추가했는데 RPC엔 못 받아서 사용자 화면엔 하나도 안 보이는" 버그를 한
-- 번 겪었다(036_travel_feed_image_rpc.sql 참고) — 그 교훈대로 이번엔 테이블 변경과 get_travel_feed RPC
-- 갱신을 한 마이그레이션에 같이 담는다.

-- if not exists: 이 파일을 통째로 재실행해도(예: 뒤쪽 함수 재생성 단계에서 한 번 실패해 다시 돌리는 경우)
-- "컬럼이 이미 있다"로 막히지 않게 한다 - 실제로 겪은 문제(알터는 성공, 함수 재생성만 따로 다시 돌려야
-- 했던 경우)라 멱등하게 고쳤다.
alter table public.travel_feed_items
  add column if not exists image_credit_name text,
  add column if not exists image_credit_url text,
  add column if not exists image_license text,
  add column if not exists image_source_name text,
  add column if not exists image_source_url text;

-- 반환 타입이 바뀌므로(024/026/036과 같은 이유) create or replace로는 안 되고 drop 후 다시 만들어야 한다.

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
  image_url text,
  image_credit_name text,
  image_credit_url text,
  image_license text,
  image_source_name text,
  image_source_url text
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
    s.is_my_destination, s.is_my_airline,
    s.image_url, s.image_credit_name, s.image_credit_url, s.image_license, s.image_source_name, s.image_source_url
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

-- 되돌리기:
-- drop function if exists public.get_travel_feed(text, text, int); (036_travel_feed_image_rpc.sql의 함수 정의를 다시 실행)
-- alter table public.travel_feed_items
--   drop column image_credit_name, drop column image_credit_url, drop column image_license,
--   drop column image_source_name, drop column image_source_url;
