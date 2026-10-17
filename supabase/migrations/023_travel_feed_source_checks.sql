-- PRD v13 관리 페이지(/admin) — 출처 필드 DB 레벨 검증
-- 022_travel_feed_admin_audit.sql 다음에 실행한다.
--
-- 021은 source_name/source_url을 not null로만 막았다 — 빈 문자열(''), 공백, http(비보안) URL은 통과한다.
-- 관리 페이지(admin.js)가 이미 "출처 없으면 저장 불가 + https만 허용"을 UI에서 막지만, 그 경로 하나만
-- 믿지 않고 DB에도 같은 규칙을 걸어 둔다 — 나중에 자동 수집 Edge Function이 생기면 그 경로도 똑같이 걸린다.

alter table public.travel_feed_items
  add constraint travel_feed_items_source_name_check check (char_length(trim(source_name)) > 0),
  add constraint travel_feed_items_source_url_check check (source_url ~* '^https://');

alter table public.popular_destinations
  add constraint popular_destinations_source_name_check check (char_length(trim(source_name)) > 0),
  add constraint popular_destinations_source_url_check check (source_url ~* '^https://');

-- 되돌리기:
-- alter table public.popular_destinations drop constraint if exists popular_destinations_source_url_check, drop constraint if exists popular_destinations_source_name_check;
-- alter table public.travel_feed_items drop constraint if exists travel_feed_items_source_url_check, drop constraint if exists travel_feed_items_source_name_check;
