-- 041_discover_detail_policy_fix: discover_city_months/city_highlights의 SELECT 정책에 discover_cities의
-- is_active 조건을 반영한다 (보안 점검 RLS-03).
--
-- 027_discover_cities.sql의 "로그인한 사용자 조회" 정책이 둘 다 using(true)라서, discover_cities가
-- is_active=false(관리자가 아직 비공개로 둔 도시)여도 city_id만 알면 REST로 직접 discover_city_months/
-- city_highlights를 조회해 미공개 추천 이유·대표 관광지를 먼저 볼 수 있었다 — get_discover_cities/
-- get_city_detail RPC는 is_active 조건을 걸고 있어서 정상 화면 흐름에선 안 보이지만, 테이블을 직접
-- select하면 우회됐다.
--
-- 고침: 일반 사용자는 "그 city_id가 discover_cities에서 is_active=true인 경우만" 조회할 수 있도록 좁히고,
-- discover_cities/discover_city_images와 같은 패턴으로 "관리자는 전체 조회" 정책을 추가로 둬서(permissive라
-- OR로 합쳐진다) 관리자는 비활성 도시의 달별 추천/하이라이트도 그대로 관리 화면에서 볼 수 있게 한다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 027_discover_cities.sql 이후 한 번 실행한다.

drop policy if exists "로그인한 사용자 조회" on public.discover_city_months;

create policy "활성 도시만 조회" on public.discover_city_months
  for select to authenticated
  using (
    exists (
      select 1 from public.discover_cities dc
      where dc.id = discover_city_months.city_id and dc.is_active = true
    )
  );

create policy "관리자는 전체 조회" on public.discover_city_months
  for select to authenticated
  using (public.is_admin());

drop policy if exists "로그인한 사용자 조회" on public.city_highlights;

create policy "활성 도시만 조회" on public.city_highlights
  for select to authenticated
  using (
    exists (
      select 1 from public.discover_cities dc
      where dc.id = city_highlights.city_id and dc.is_active = true
    )
  );

create policy "관리자는 전체 조회" on public.city_highlights
  for select to authenticated
  using (public.is_admin());

-- 되돌리기:
-- drop policy if exists "관리자는 전체 조회" on public.city_highlights;
-- drop policy if exists "활성 도시만 조회" on public.city_highlights;
-- create policy "로그인한 사용자 조회" on public.city_highlights for select to authenticated using (true);
-- drop policy if exists "관리자는 전체 조회" on public.discover_city_months;
-- drop policy if exists "활성 도시만 조회" on public.discover_city_months;
-- create policy "로그인한 사용자 조회" on public.discover_city_months for select to authenticated using (true);
