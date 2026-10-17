-- 013_transport_items: 기차/버스/선박 등 "기타" 교통편 일정을 저장할 컬럼 추가
--
-- 항공편(schedule_items.flight, jsonb)과 같은 자리에, 항공이 아닌 교통편을 사진 인식 없이 직접 입력으로
-- 저장하기 위한 컬럼이다. 일정 화면의 빠른 메뉴(교통편) 드롭다운이 "항공"/"기타" 둘로 줄어들면서, 기존에
-- 드롭다운의 개별 항목이었던 기차/버스/선박은 이 컬럼의 category 값(하위 분류)이 됐다.
--   transport.category : "train" | "bus" | "ship" | "etc"
--   transport.depPlace  : 출발지 (글자, 지도 좌표 아님)
--   transport.depTime   : 출발 시간 "HH:MM"
--   transport.arrPlace  : 도착지
--   transport.arrTime   : 도착 시간 "HH:MM"
--   transport.seat      : 좌석 (선택 입력, 비우면 빈 문자열)
--
-- 이 파일은 Supabase 대시보드의 SQL Editor에서 직접 실행한다.
-- 컬럼이 이미 있으면 건너뛰므로 다시 실행해도 안전하다. 기존 행은 null로 남는다.
-- 이 마이그레이션을 실행하기 전에는 "기타" 교통편을 추가/수정하려는 시도가 "서버 테이블 구조가 앱과
-- 달라요" 오류로 실패한다(storage.js#addItem/updateItem 참고) - 일반 일정·항공편 추가는 영향이 없다.

alter table public.schedule_items
  add column if not exists transport jsonb;

comment on column public.schedule_items.transport is '기차/버스/선박/기타 교통편 상세(jsonb) - { category, depPlace, depTime, arrPlace, arrTime, seat }. 항공편은 flight 컬럼을 쓴다.';
