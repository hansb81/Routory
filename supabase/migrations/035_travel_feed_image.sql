-- 메인 화면 '여행 소식' 영역(MAIN-FEED)에 대표 이미지를 보여주기 위한 컬럼 추가. 021 이후 아무 때나
-- 실행 가능(기존 컬럼/정책을 건드리지 않는 단순 추가) — image_url이 null이면 카드/상세 모달 모두
-- 이미지 없이 기존 모습 그대로 보인다(기존 행은 전부 null로 시작).
--
-- 저작권: Unsplash/Wikimedia Commons에서 핫링크(다운로드 없이 그 서비스가 제공하는 주소를 그대로 저장)로
-- 고르거나, 관리자가 직접 URL을 입력한다 — discover_city_images(027_discover_cities.sql)처럼 저작자/
-- 라이선스 컬럼을 별도로 두지 않는다(여행 소식 카드 하나당 이미지 한 장뿐이라 그 정도 메타데이터까지는
-- 요구되지 않았다 - 필요해지면 나중에 추가).

alter table public.travel_feed_items
  add column image_url text;

-- 되돌리기:
-- alter table public.travel_feed_items drop column image_url;
