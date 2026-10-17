-- 017_trips_timezone: trips.timezone 컬럼 추가 (PRD v12 여행지 선택 화면 탭 확장 작업 4번)
--
-- 여행지 선택 화면에서 해외 도시를 고르면 search-destination의 select 액션이 그 도시의 IANA 타임존을
-- 확정해서 돌려준다(destinations.timezone). trips에도 같은 값을 복사해 둬서, 나중에 그 여행의 현지
-- 시각을 계산하는 기능(푸시 알림, 브리핑 등)이 매번 destinations를 다시 조인하지 않고 trips만 보면 되게
-- 한다. destination_id(014_destinations.sql)가 있어서 join으로도 구할 수 있지만, trips.destination_id가
-- null인(국내, 또는 아직 새 체계로 안 옮겨간) 여행과 같은 모양으로 다루기 쉽게 트립 자체에도 복제해 둔다.
--
-- 국내 여행이나 기존 방식으로 만들어진 여행은 timezone이 null로 남는다 - 트리거나 기본값을 넣지 않는다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 한 번 실행한다. 다시 실행해도 안전하다(이미 있으면 건너뛴다).

alter table public.trips
  add column if not exists timezone text;

comment on column public.trips.timezone is 'IANA 타임존(예: "Asia/Tokyo"). destinations.timezone을 여행 만들기 시점에 복사해 둔 값 - 국내/옛 방식 여행은 null.';
