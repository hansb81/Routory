-- 002_flight_ocr: 항공편 정보(항공사, 편명)를 저장할 컬럼 추가
--
-- 항공권 사진에서 읽어 낸(OCR) 항공사와 편명을 일정(schedule_items)에 저장하기 위한 준비다.
--   airline   : 항공사 이름          예) 대한항공, 아시아나항공
--   flight_no : 편명(항공사 코드 포함) 예) KE723, OZ723
-- 앱의 항공편 데이터(item.flight)의 airlineName, flightNo 값이 각각 여기에 들어간다.
--
-- 항공권 이미지는 분석한 뒤 바로 버리고 저장하지 않는다. 그래서 Storage 버킷은 만들지 않는다.
--
-- 이 파일은 Supabase 대시보드의 SQL Editor에서 직접 실행한다.
-- 선행 조건: public.schedule_items 테이블이 이미 있어야 한다 (없으면 아래 ALTER TABLE이 오류로 멈춘다).
-- 컬럼이 이미 있으면 건너뛰므로 다시 실행해도 안전하다. 기존 행의 두 컬럼은 null로 남는다.

alter table public.schedule_items
  add column if not exists airline text,
  add column if not exists flight_no text;

comment on column public.schedule_items.airline is '항공사 이름 (예: 대한항공). 항공편 일정이 아니면 null';
comment on column public.schedule_items.flight_no is '편명, 항공사 코드 포함 (예: KE723). 항공편 일정이 아니면 null';
