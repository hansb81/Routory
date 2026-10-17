-- PRD v13 자동 수집 — pg_cron으로 collect-travel-feed Edge Function을 매일 1회 호출한다.
-- 024_travel_feed_match_flags.sql 다음에 실행한다. supabase/functions/collect-travel-feed/README.md를
-- 먼저 읽고 그 함수를 배포 + CRON_SECRET 비밀값을 설정한 뒤 이 파일을 실행할 것.
--
-- 인기 여행지(월 1회) cron은 일부러 만들지 않았다 — 공식 "한국인이 많이 간 여행지" 월간 순위 통계는
-- API나 파일로 공개되지 않아서(데이터랩 게시판 엑셀 보고서뿐, 단계 0 조사 결과) 자동 수집 자체가 없다.
-- 그 데이터가 생기지 않는데 월간 cron만 만들어 두면 아무 일도 안 하는 빈 작업만 남는다 — /admin에서
-- 계속 수동으로 입력한다.
--
-- ⚠️ 이 파일을 실행하기 전에 아래 '여기를 채우세요' 자리를, supabase functions deploy 때
-- `supabase secrets set CRON_SECRET=...`로 설정한 값과 "완전히 같은 문자열"로 바꿔야 한다 — 두 군데
-- 손으로 맞추는 값이고 자동으로 공유되지 않는다(아래 collect-travel-feed README 참고).
--
-- pg_cron/pg_net은 Supabase 호스팅 프로젝트에 기본 제공되는 확장이다. 아래 create extension이 권한
-- 오류로 실패하면 대시보드 → Database → Extensions에서 pg_cron/pg_net을 먼저 켠 뒤 다시 실행한다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron.schedule은 같은 이름의 작업이 이미 있으면 일정만 갱신한다(pg_cron 1.4+) - 이 파일을 다시 실행해도 안전하다.
select cron.schedule(
  'collect-travel-feed-daily',
  '0 19 * * *', -- 매일 UTC 19:00 = KST 04:00 (사용자 활동이 적은 새벽 시간)
  $$
  select net.http_post(
    url := 'https://ffzjgiknrrgwvgobybdq.supabase.co/functions/v1/collect-travel-feed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'u9XmQ7vR2wzP5bK1eE8tY4cN3sA6xG0fH5jK2mL9oP3iU7yT1rE4wQ8vN0bV5cX2zZ1aA3sS'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 되돌리기:
-- select cron.unschedule('collect-travel-feed-daily');
