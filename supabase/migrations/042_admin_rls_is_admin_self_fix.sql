-- 042_admin_rls_is_admin_self_fix: 040_is_admin_self_only.sql이 깨뜨린 관리자 전용 RLS 정책들을
-- is_admin_self()로 옮겨서 복구한다 (관리 페이지 "목록이 전부 사라짐" 버그 수정).
--
-- 원인: 040이 is_admin(uuid)의 authenticated/anon 실행 권한을 완전히 거둬 service_role 전용으로
-- 좁혔다. 그런데 021/022/027/030/041이 각 테이블(travel_feed_items, popular_destinations,
-- discover_cities, discover_city_months, discover_city_images, city_highlights)과
-- storage.objects(discover-images 버킷)에 걸어둔 "관리자만 조회/작성/수정/삭제" RLS 정책들은
-- 전부 인자 없이 public.is_admin()을 직접 호출한다(기본값 auth.uid()로 해석됨) — adminPage.js의
-- initGate()만 is_admin_self()로 옮겨졌을 뿐, 테이블 RLS 쪽은 그대로 남아 있었다.
--
-- RLS의 USING/WITH CHECK 절은 테이블 소유자가 아니라 "쿼리를 실행하는 역할"(PostgREST가 쓰는
-- authenticated)의 권한으로 평가된다 — is_admin(uuid)가 SECURITY DEFINER라도, 그 함수를 "호출할
-- 권리" 자체가 authenticated에게 없어지면 정책 평가 자체가 "permission denied for function
-- is_admin"으로 실패한다. 그 결과 관리자가 자기 글을 올리거나(insert), 승인 대기/보관 탭을 열거나
-- (022의 "관리자는 전체 조회" select 정책), 추천 도시를 관리하는(027) 모든 쓰기·조회가 깨졌다 —
-- 관리자 눈에는 "올렸던 목록이 다 사라졌다"로 보인다. (PGlite로 이 깨짐과 아래 수정 둘 다 재현해
-- 확인했다 — 최소 재현: 020 모양의 is_admin(uuid) + 040의 revoke를 적용하면 "관리자는 전체 조회"
-- 류 정책이 즉시 permission denied로 터지고, is_admin_self()로 바꾸면 복구된다.)
--
-- 고침: 이 정책들은 애초에 "호출자 본인"의 관리자 여부만 물어봤을 뿐(임의 uid를 넘긴 적이 없다) —
-- 즉 의미상 이미 is_admin_self()와 동일했다. ALTER POLICY로 USING/WITH CHECK 절만 is_admin_self()
-- 호출로 바꾼다(정책 이름·대상 role·다른 조건은 그대로 — 021의 "게시된 것만 조회"처럼 is_admin()을
-- 안 쓰는 정책은 손대지 않는다). get_admin_labels()(022) 안의 public.is_admin() 호출은 안 건드려도
-- 된다 — SECURITY DEFINER 함수 본문 안에서의 권한 체크는 그 함수 소유자(postgres, 슈퍼유저) 기준으로
-- 돌기 때문에 애초에 영향이 없다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 041_discover_detail_policy_fix.sql 이후 한 번 실행한다.

-- 021_travel_feed.sql
alter policy "관리자만 작성" on public.travel_feed_items
  with check (public.is_admin_self());
alter policy "관리자만 수정" on public.travel_feed_items
  using (public.is_admin_self())
  with check (public.is_admin_self());
alter policy "관리자만 삭제" on public.travel_feed_items
  using (public.is_admin_self());

alter policy "관리자만 작성" on public.popular_destinations
  with check (public.is_admin_self());
alter policy "관리자만 수정" on public.popular_destinations
  using (public.is_admin_self())
  with check (public.is_admin_self());
alter policy "관리자만 삭제" on public.popular_destinations
  using (public.is_admin_self());

-- 022_travel_feed_admin_audit.sql
alter policy "관리자는 전체 조회" on public.travel_feed_items
  using (public.is_admin_self());
alter policy "관리자는 전체 조회" on public.popular_destinations
  using (public.is_admin_self());

-- 027_discover_cities.sql — discover_cities
alter policy "관리자는 전체 조회" on public.discover_cities
  using (public.is_admin_self());
alter policy "관리자만 작성" on public.discover_cities
  with check (public.is_admin_self());
alter policy "관리자만 수정" on public.discover_cities
  using (public.is_admin_self())
  with check (public.is_admin_self());
alter policy "관리자만 삭제" on public.discover_cities
  using (public.is_admin_self());

-- 027_discover_cities.sql — discover_city_months
alter policy "관리자만 작성" on public.discover_city_months
  with check (public.is_admin_self());
alter policy "관리자만 수정" on public.discover_city_months
  using (public.is_admin_self())
  with check (public.is_admin_self());
alter policy "관리자만 삭제" on public.discover_city_months
  using (public.is_admin_self());

-- 027_discover_cities.sql — discover_city_images
alter policy "관리자는 전체 조회" on public.discover_city_images
  using (public.is_admin_self());
alter policy "관리자만 작성" on public.discover_city_images
  with check (public.is_admin_self());
alter policy "관리자만 수정" on public.discover_city_images
  using (public.is_admin_self())
  with check (public.is_admin_self());
alter policy "관리자만 삭제" on public.discover_city_images
  using (public.is_admin_self());

-- 027_discover_cities.sql — city_highlights
alter policy "관리자만 작성" on public.city_highlights
  with check (public.is_admin_self());
alter policy "관리자만 수정" on public.city_highlights
  using (public.is_admin_self())
  with check (public.is_admin_self());
alter policy "관리자만 삭제" on public.city_highlights
  using (public.is_admin_self());

-- 030_discover_images_storage_admin_policy.sql
alter policy "discover-images: 관리자만 업로드·수정·삭제" on storage.objects
  using (bucket_id = 'discover-images' and public.is_admin_self())
  with check (bucket_id = 'discover-images' and public.is_admin_self());

-- 041_discover_detail_policy_fix.sql
alter policy "관리자는 전체 조회" on public.discover_city_months
  using (public.is_admin_self());
alter policy "관리자는 전체 조회" on public.city_highlights
  using (public.is_admin_self());

-- 되돌리기 (040 이전 상태로 — 다시 버그가 재현되니 되돌릴 이유가 없다):
-- 위 각 alter policy의 public.is_admin_self()를 public.is_admin()으로 바꿔 그대로 다시 실행.
