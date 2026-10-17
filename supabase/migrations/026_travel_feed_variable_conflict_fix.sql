-- get_travel_feed 버그 수정 — "column reference 'country_code' is ambiguous (42702)"
-- 024_travel_feed_match_flags.sql 다음에 실행한다.
--
-- 원인: `returns table (..., country_code text, ...)`처럼 반환 컬럼 이름을 선언하면, PL/pgSQL이 그
-- 이름들을 함수 본문 전체에서 쓸 수 있는 변수(암묵적 OUT 파라미터)로도 동시에 등록해 버린다. 024의 본문
-- 안 `c.country_code in (select country_code from my_country_codes)`에서 괄호 안의 벗겨진(테이블 별칭이
-- 없는) `country_code`가 "my_country_codes의 컬럼"인지 "저 암묵 변수"인지 Postgres가 못 정해서 터진다.
-- 실제 배포 후 PostgREST로 호출했을 때 이 에러가 났다 — SQL Editor에서 직접 부를 때는 쿼리 플랜 캐싱
--차이로 우연히 안 걸렸을 뿐, 로직상 호출마다 날 수 있는 버그였다.
--
-- 고침: 함수 본문 맨 앞에 `#variable_conflict use_column` 지시자를 추가해 "애매하면 항상 테이블/컬럼
-- 참조로 해석해라"를 명시한다(PostgreSQL 공식 문서가 이 정확한 상황에 권장하는 해법). 이 함수는 암묵
-- 변수를 실제로 대입에 쓰는 곳이 전혀 없으므로(오직 `return query`로만 결과를 낸다) 항상 컬럼으로
-- 해석해도 안전하다. 로직은 024와 100% 동일하고, 이 한 줄만 추가됐다.

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

-- 되돌리기: 026 이전(변수 충돌 버그가 있는 버전)으로 되돌리려면 024_travel_feed_match_flags.sql의 함수
-- 정의를 다시 실행한다 - 되돌릴 이유는 없다(버그 수정뿐이라서).
