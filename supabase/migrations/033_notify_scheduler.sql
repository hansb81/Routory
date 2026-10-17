-- 033_notify_scheduler: 시간 기반 알림(출발 임박·다음 일정 임박, PRD v11 4번 "시간 기반 이벤트")을
-- pg_cron이 5분마다 깨우는 Edge Function 'notify-scheduler'가 쓰는 두 판별 함수 + 그 cron 작업.
-- Edge Function 자체(supabase/functions/notify-scheduler)와 이 마이그레이션은 서로 짝이다 - 함수를
-- 먼저 배포해야 cron이 불러도 의미가 있다.
--
-- ---- 왜 이 판별을 SQL에서 하는가 ----
-- "여행 시간대(trips.timezone) 기준 18:00" · "일정 시작 시각까지 2시간 이하"는 IANA 타임존 + DST를
-- 정확히 다뤄야 하는 계산이라, `now() at time zone <timezone>`을 쓸 수 있는 Postgres에 맡기는 게
-- Deno에서 직접 흉내 내는 것보다 훨씬 안전하다(이 리포의 다른 security definer 함수들과 같은 이유 -
-- 001의 is_trip_member, 020의 is_admin 등 RLS로 가려진 데이터를 다루는 계산은 전부 SQL 쪽에 둔다).
--
-- ---- 중복 방지(요청 4번)를 판별과 "같은 쿼리 안에서" 한다 ----
-- 두 함수 모두: ① 후보(candidates) CTE로 "지금 보내야 하는 (user_id, trip_id|schedule_item_id)" 쌍을
-- 찾고, ② notification_log에 `insert ... on conflict (user_id, kind, ref_id) do nothing returning ...`로
-- "예약"을 시도하고, ③ 후보 전체를 "예약 성공(reserved) 여부"와 함께 돌려준다. 후보를 먼저 구하고 나중에
-- 따로 insert하면 그 사이에 또 다른 cron 실행(이론상 겹칠 수 있다)이 같은 대상을 먼저 예약해 버려 이중
-- 발송이 날 틈(race)이 생긴다 - 하나의 SQL 문 안에서 CTE로 묶으면 그 틈이 없다. `was_reserved=false`로
-- 돌아온 행은 "이미 보낸 적 있어서 건너뛴 것"이고, Edge Function은 `was_reserved=true`인 행만 실제로
-- 발송한다(요청 6번의 "건너뛴 수"도 이 플래그로 집계한다).
--
-- 일정 시간이 나중에 수정돼도(요청 4번 "다시 보내지는 않아도 됨") ref_id는 schedule_item_id 자체라
-- 값이 안 바뀐다 - 한 번 notification_log에 박히면 그 일정은 영원히 중복 후보에서 빠진다(설계대로).

-- ---- 출발 임박: 여행 시작일 하루 전, 그 여행 시간대 기준 18:00 이후 ----
create or replace function public.find_departure_notify_targets()
returns table (trip_id uuid, trip_title text, user_id uuid, was_reserved boolean)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select t.id as trip_id, t.title as trip_title, m.user_id
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
    where (now() at time zone coalesce(t.timezone, 'Asia/Seoul'))::date = t.start_date - 1
      and (now() at time zone coalesce(t.timezone, 'Asia/Seoul'))::time >= time '18:00'
  ),
  reserved as (
    insert into public.notification_log (user_id, kind, ref_id)
    select c.user_id, 'departure', c.trip_id from candidates c
    on conflict (user_id, kind, ref_id) do nothing
    returning user_id, ref_id as trip_id
  )
  select c.trip_id, c.trip_title, c.user_id, (r.user_id is not null) as was_reserved
  from candidates c
  left join reserved r on r.trip_id = c.trip_id and r.user_id = c.user_id;
$$;

-- ---- 다음 일정 임박: 시간이 등록된 일정 중, 시작까지 2시간 이하 남았고 아직 지나지 않은 것 ----
create or replace function public.find_schedule_notify_targets()
returns table (schedule_item_id uuid, trip_id uuid, item_title text, item_place text, item_time time, user_id uuid, was_reserved boolean)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      si.id as schedule_item_id,
      si.trip_id,
      si.title as item_title,
      si.place as item_place,
      si.time as item_time,
      m.user_id
    from public.schedule_items si
    join public.trips t on t.id = si.trip_id
    join public.trip_members m on m.trip_id = si.trip_id
    where si.time is not null
      and (si.date + si.time) at time zone coalesce(t.timezone, 'Asia/Seoul') > now()
      and (si.date + si.time) at time zone coalesce(t.timezone, 'Asia/Seoul') - now() <= interval '2 hours'
  ),
  reserved as (
    insert into public.notification_log (user_id, kind, ref_id)
    select c.user_id, 'schedule', c.schedule_item_id from candidates c
    on conflict (user_id, kind, ref_id) do nothing
    returning user_id, ref_id as schedule_item_id
  )
  select c.schedule_item_id, c.trip_id, c.item_title, c.item_place, c.item_time, c.user_id, (r.user_id is not null) as was_reserved
  from candidates c
  left join reserved r on r.schedule_item_id = c.schedule_item_id and r.user_id = c.user_id;
$$;

-- 둘 다 notify-scheduler Edge Function(service_role 키로 rpc 호출)만 쓴다 - 로그인한 사용자가 직접
-- 부르면 안 된다(다른 사람의 여행/일정이 섞인 전체 후보 목록을 읽을 수 있고, notification_log를 마음대로
-- 예약/소모해 실제 알림을 틀어막을 수도 있다). public/anon/authenticated 전부 막고 service_role에만 연다.
revoke execute on function public.find_departure_notify_targets() from public, anon, authenticated;
revoke execute on function public.find_schedule_notify_targets() from public, anon, authenticated;
grant execute on function public.find_departure_notify_targets() to service_role;
grant execute on function public.find_schedule_notify_targets() to service_role;

-- ---- pg_cron: 5분마다 notify-scheduler 호출 ----
-- NOTIFY_SECRET 값은 032_trip_member_notify.sql에서 이미 Vault에 등록해 둔 'notify_secret'을 그대로
-- 재사용한다(같은 내부 호출용 공유 비밀값 - send-notification을 부르는 모든 경로가 이 하나를 쓴다).
-- 025_collect_travel_feed_cron.sql과 달리 이 cron 작업 정의에는 비밀값이 평문으로 들어가지 않는다 -
-- cron.job에 저장되는 SQL 텍스트 자체가 "Vault에서 읽어오라"는 서브쿼리일 뿐이라, cron.job을 읽어도
-- 실제 비밀값은 보이지 않는다.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-scheduler-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://ffzjgiknrrgwvgobybdq.supabase.co/functions/v1/notify-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 되돌리기:
-- select cron.unschedule('notify-scheduler-5min');
-- drop function if exists public.find_departure_notify_targets();
-- drop function if exists public.find_schedule_notify_targets();
