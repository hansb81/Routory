-- /admin "추천 도시" 탭의 "직접 업로드"(요청 4번)는 scripts/collect-city-images(service_role, RLS 우회)와
-- 달리 관리자 본인의 로그인 세션(authenticated)으로 Storage에 직접 업로드/삭제한다 — discover-images
-- 버킷엔 아직 storage.objects 정책이 하나도 없어서(027_discover_cities.sql#"discover-images" 버킷 생성
-- 안내 참고 — "쓰기는 service_role만, 읽기는 public 버킷이라 정책 불필요"라고만 해 뒀다), 관리자가 직접
-- 올리거나(업로드) 후보를 지울 때 함께 지우는 Storage 객체 삭제(adminPage.js#storageObjectPathFromPublicUrl)
-- 둘 다 지금은 막혀 있다. 이 마이그레이션은 그 구멍만 메운다 - is_admin()(020_admins.sql)인 사람만
-- 이 버킷에 쓸 수 있게 한다. 읽기는 그대로 public 버킷 URL로 RLS 없이 서빙된다(바뀌지 않음).
--
-- 027_discover_cities.sql 다음, "discover-images" 버킷을 대시보드에서 만든 뒤 실행한다.
-- storage.objects는 모든 Supabase 프로젝트에서 기본적으로 RLS가 켜져 있어 따로 enable할 필요가 없다
-- (006_wallet.sql과 같은 전제).

create policy "discover-images: 관리자만 업로드·수정·삭제" on storage.objects
  for all to authenticated
  using (bucket_id = 'discover-images' and public.is_admin())
  with check (bucket_id = 'discover-images' and public.is_admin());

-- 되돌리기:
-- drop policy "discover-images: 관리자만 업로드·수정·삭제" on storage.objects;
