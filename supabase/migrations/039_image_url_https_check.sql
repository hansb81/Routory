-- 039_image_url_https_check: 여행 소식/추천 도시 이미지 출처 URL에 https:// 강제 (보안 점검 FE-01)
--
-- 021_travel_feed.sql(`source_url`)과 023_travel_feed_source_checks.sql이 이미 travel_feed_items/
-- popular_destinations의 "원문" source_url에는 https:// CHECK를 걸어 뒀는데, 037_travel_feed_image_credit.sql이
-- 나중에 추가한 "이미지 출처" 4개 컬럼(image_credit_url/image_source_url)과 027_discover_cities.sql의
-- discover_city_images(credit_url/source_url)에는 같은 제약이 빠져 있었다 — 전부 nullable text라
-- javascript: 같은 스킴도 그대로 저장될 수 있었다.
--
-- 이 값들은 관리자(is_admin())만 쓸 수 있지만(021/027의 insert/update 정책), 쓰기 전용 방어선 하나만
-- 믿지 않는다는 이 저장소의 일관된 방침(012/023과 동일 이유) — 관리자 계정이 탈취되거나 실수로 이상한
-- 값을 넣어도, 그 값을 href에 그대로 쓰는 모든 로그인 사용자 화면(travelFeed.js)에서 실행되지 않도록
-- DB 레벨에서 한 번 더 막는다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 한 번 실행한다. 기존 행 중 이 제약을 어기는 값이
-- 있으면(지금까지는 전부 Unsplash/Wikimedia/Pexels 핫링크이거나 null이라 없을 것으로 보이지만) 이
-- ALTER가 오류로 멈춘다 — 그 경우 문제의 행을 먼저 고치거나 null로 비운 뒤 다시 실행한다.

alter table public.travel_feed_items
  add constraint travel_feed_items_image_credit_url_check check (image_credit_url is null or image_credit_url ~* '^https://'),
  add constraint travel_feed_items_image_source_url_check check (image_source_url is null or image_source_url ~* '^https://');

alter table public.discover_city_images
  add constraint discover_city_images_credit_url_check check (credit_url is null or credit_url ~* '^https://');
-- source_url은 discover_city_images에서 not null이라(027) 빈 문자열만 막혀 있었다 - 이번에 스킴도 같이 강제한다.
-- 기존 char_length 체크와 중복되지 않게 이름을 다르게 둔다.
alter table public.discover_city_images
  add constraint discover_city_images_source_url_scheme_check check (source_url ~* '^https://');

-- 되돌리기:
-- alter table public.discover_city_images drop constraint if exists discover_city_images_source_url_scheme_check;
-- alter table public.discover_city_images drop constraint if exists discover_city_images_credit_url_check;
-- alter table public.travel_feed_items drop constraint if exists travel_feed_items_image_source_url_check;
-- alter table public.travel_feed_items drop constraint if exists travel_feed_items_image_credit_url_check;
