-- pg_cron으로 refresh-city-weather Edge Function을 6시간마다 호출한다.
-- 027_discover_cities.sql 다음에 실행한다. supabase/functions/refresh-city-weather/README.md를 먼저 읽고
-- 그 함수를 배포 + CRON_SECRET 비밀값을 설정한 뒤 이 파일을 실행할 것.
--
-- 025_collect_travel_feed_cron.sql과 완전히 같은 방식(pg_cron + pg_net + x-cron-secret 헤더)이다 — 이
-- 저장소에는 아직 "푸시 알림" 기능이 없어서(push/FCM/APNs 관련 코드 없음), 그 선례를 그대로 따랐다.
-- CRON_SECRET을 collect-travel-feed용으로 이미 설정해 뒀다면 같은 값을 아래 플레이스홀더에 그대로 넣으면
-- 된다(함수별로 다른 비밀값을 쓸 필요는 없다 — 둘 다 "pg_cron만 호출"이라는 같은 신뢰 경계를 막는 용도).
--
-- ⚠️ 이 파일을 실행하기 전에 아래 '여기를 채우세요' 자리를, `supabase secrets set CRON_SECRET=...`로
-- 설정한 값과 "완전히 같은 문자열"로 바꿔야 한다 — 두 군데 손으로 맞추는 값이고 자동으로 공유되지 않는다.
--
-- pg_cron/pg_net은 025에서 이미 켰다면 아래 create extension은 그냥 통과한다(if not exists).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron.schedule은 같은 이름의 작업이 이미 있으면 일정만 갱신한다(pg_cron 1.4+) - 이 파일을 다시 실행해도 안전하다.
select cron.schedule(
  'refresh-city-weather-6h',
  '0 */6 * * *', -- 매 6시간마다 (00/06/12/18시 UTC)
  $$
  select net.http_post(
    url := 'https://ffzjgiknrrgwvgobybdq.supabase.co/functions/v1/refresh-city-weather',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'u9XmQ7vR2wzP5bK1eE8tY4cN3sA6xG0fH5jK2mL9oP3iU7yT1rE4wQ8vN0bV5cX2zZ1aA3sS'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 되돌리기:
-- select cron.unschedule('refresh-city-weather-6h');
