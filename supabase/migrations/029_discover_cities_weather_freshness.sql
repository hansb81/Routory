-- get_discover_cities/get_city_detail이 오래된(24시간 넘은) 날씨 캐시를 숨기도록 고친다.
-- 027_discover_cities.sql과 028_refresh_city_weather_cron.sql 다음에 실행한다.
--
-- 027의 두 함수는 city_weather_cache를 destination_id로만 조인했다 - refresh-city-weather가 6시간마다
-- 도는 전제에서는 보통 괜찮지만, 그 cron이 하루 넘게 멈춰 있어도(배포 실수, Open-Meteo 장애 등) 값이
-- 전혀 없는 것보다 더 나쁜 "며칠 전 날씨를 마치 지금 날씨처럼" 보여주게 된다 — 그래서 조인 조건에
-- fetched_at 기준을 추가해 24시간이 넘은 캐시는 애초에 join되지 않게(= temp_c/weather_code가 null로
-- 돌아가게) 만든다. 요청은 get_discover_cities만 짚었지만, 같은 캐시를 읽는 get_city_detail도 그대로
-- 두면 목록엔 날씨가 안 보이는데 상세 화면엔 (최대 하루 넘게 묵은) 날씨가 보이는 모순이 생겨서 같은
-- 기준을 get_city_detail에도 적용했다.
--
-- 24시간 기준값 외에는 027의 로직을 전혀 바꾸지 않았다 - 반환 타입이 그대로라 drop 없이 create or
-- replace로 충분하다(024->026과 달리 타입 변경이 없다).

create or replace function public.get_discover_cities(p_limit int default 20)
returns table (
  city_id uuid,
  destination_id uuid,
  name_ko text,
  name_en text,
  country_code text,
  country_name_ko text,
  tagline text,
  reason_tag text,
  reason_text text,
  image_url text,
  thumb_url text,
  credit_name text,
  credit_url text,
  license text,
  temp_c numeric,
  weather_code int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month int := extract(month from (now() at time zone 'Asia/Seoul'))::int;
begin
  return query
  with candidates as (
    select
      dc.id as c_city_id,
      dc.destination_id as c_destination_id,
      d.name_ko as c_name_ko,
      d.name_en as c_name_en,
      d.country_code as c_country_code,
      cc.name_ko as c_country_name_ko,
      dc.tagline as c_tagline,
      dcm.reason_tag as c_reason_tag,
      dcm.reason_text as c_reason_text,
      wc.temp_c as c_temp_c,
      wc.weather_code as c_weather_code,
      (dcm.score * 10 + public.discover_weather_bonus(wc.temp_c, wc.weather_code)) as c_total_score,
      hashtext(dc.id::text || to_char(v_today, 'YYYYMMDD')) as c_tie_break
    from public.discover_cities dc
    join public.discover_city_months dcm on dcm.city_id = dc.id and dcm.month = v_month
    join public.destinations d on d.id = dc.destination_id
    left join public.country_currency cc on cc.country_code = d.country_code
    -- 조정 지점: 24시간 넘은 캐시는 join하지 않는다(temp_c/weather_code가 null로 돌아가고, 날씨 보너스도
    -- 0으로 떨어진다 - discover_weather_bonus가 null 입력을 0으로 처리하므로 별도 처리가 필요 없다).
    left join public.city_weather_cache wc
      on wc.destination_id = dc.destination_id
      and wc.fetched_at > now() - interval '24 hours'
    where dc.is_active = true
  ),
  ranked as (
    select
      cand.*,
      row_number() over (
        partition by cand.c_country_code
        order by cand.c_total_score desc, cand.c_tie_break
      ) as c_country_rank
    from candidates cand
  ),
  capped as (
    select * from ranked where c_country_rank <= public.discover_country_cap()
  ),
  top_image as (
    select distinct on (ci.city_id)
      ci.city_id as ti_city_id,
      ci.image_url as ti_image_url,
      ci.thumb_url as ti_thumb_url,
      ci.credit_name as ti_credit_name,
      ci.credit_url as ti_credit_url,
      ci.license as ti_license
    from public.discover_city_images ci
    where ci.status = 'published'
    order by ci.city_id, ci.sort_order asc
  )
  select
    capped.c_city_id,
    capped.c_destination_id,
    capped.c_name_ko,
    capped.c_name_en,
    capped.c_country_code,
    capped.c_country_name_ko,
    capped.c_tagline,
    capped.c_reason_tag,
    capped.c_reason_text,
    top_image.ti_image_url,
    top_image.ti_thumb_url,
    top_image.ti_credit_name,
    top_image.ti_credit_url,
    top_image.ti_license,
    capped.c_temp_c,
    capped.c_weather_code
  from capped
  left join top_image on top_image.ti_city_id = capped.c_city_id
  order by capped.c_total_score desc, capped.c_tie_break
  limit least(greatest(p_limit, 1), 20);
end;
$$;

revoke execute on function public.get_discover_cities(int) from public, anon;
grant execute on function public.get_discover_cities(int) to authenticated;

create or replace function public.get_city_detail(p_city_id uuid)
returns table (
  city_id uuid,
  destination_id uuid,
  name_ko text,
  name_en text,
  country_code text,
  country_name_ko text,
  tagline text,
  reason_tag text,
  reason_text text,
  temp_c numeric,
  weather_code int,
  weather_fetched_at timestamptz,
  images jsonb,
  highlights jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month int := extract(month from (now() at time zone 'Asia/Seoul'))::int;
begin
  return query
  select
    dc.id as r_city_id,
    dc.destination_id as r_destination_id,
    d.name_ko as r_name_ko,
    d.name_en as r_name_en,
    d.country_code as r_country_code,
    cc.name_ko as r_country_name_ko,
    dc.tagline as r_tagline,
    dcm.reason_tag as r_reason_tag,
    dcm.reason_text as r_reason_text,
    wc.temp_c as r_temp_c,
    wc.weather_code as r_weather_code,
    wc.fetched_at as r_weather_fetched_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'imageUrl', ci.image_url,
        'thumbUrl', ci.thumb_url,
        'creditName', ci.credit_name,
        'creditUrl', ci.credit_url,
        'license', ci.license,
        'sourceName', ci.source_name,
        'sourceUrl', ci.source_url
      ) order by ci.sort_order)
      from public.discover_city_images ci
      where ci.city_id = dc.id and ci.status = 'published'
    ), '[]'::jsonb) as r_images,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'nameKo', ch.name_ko,
        'summary', ch.summary,
        'lat', ch.lat,
        'lng', ch.lng,
        'sourceName', ch.source_name
      ) order by ch.sort_order)
      from public.city_highlights ch
      where ch.city_id = dc.id
    ), '[]'::jsonb) as r_highlights
  from public.discover_cities dc
  join public.destinations d on d.id = dc.destination_id
  left join public.country_currency cc on cc.country_code = d.country_code
  left join public.discover_city_months dcm on dcm.city_id = dc.id and dcm.month = v_month
  -- 위 get_discover_cities와 동일: 24시간 넘은 캐시는 join하지 않는다
  left join public.city_weather_cache wc
    on wc.destination_id = dc.destination_id
    and wc.fetched_at > now() - interval '24 hours'
  where dc.id = p_city_id and dc.is_active = true;
end;
$$;

revoke execute on function public.get_city_detail(uuid) from public, anon;
grant execute on function public.get_city_detail(uuid) to authenticated;

-- 되돌리기: 027_discover_cities.sql의 두 함수 정의를 다시 실행하면 24시간 기준 없는 버전으로 돌아간다
-- (되돌릴 이유는 없다 - 기준값 추가뿐이라서).
