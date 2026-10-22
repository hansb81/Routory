-- 040_is_admin_self_only: is_admin(uuid)를 service_role 전용으로 좁히고, 로그인한 사용자 본인 확인용
-- is_admin_self()를 새로 둔다 (보안 점검 RLS-01).
--
-- 배경: 020_admins.sql의 is_admin(uid uuid default auth.uid())는 search-pexels/search-unsplash가
-- service_role로 "이 토큰의 uid가 관리자인가"를 물어볼 수 있도록 일부러 임의의 uid를 받게 만들었는데,
-- authenticated 역할에도 실행 권한이 열려 있어서 로그인한 사용자라면 누구나 다른 사용자의 user_id를
-- 안다는 전제하에(예: 같은 여행 멤버 목록에서) rpc('is_admin', {uid: 그값})으로 그 사람이 관리자인지
-- 알아낼 수 있었다 - 의도한 "본인 확인"을 벗어난 사용이 가능했던 것.
--
-- 고침: is_admin(uuid)는 authenticated/anon 실행 권한을 모두 거둬들여 service_role만 부를 수 있게 하고
-- (search-pexels/search-unsplash는 이미 service_role 키로 호출하므로 영향 없음), 매개변수 없이 호출자
-- "본인"의 관리자 여부만 돌려주는 is_admin_self()를 새로 만들어 authenticated에 연다. 두 함수를 같은
-- 이름으로 오버로드(인자 개수만 다르게)하지 않는 이유: is_admin(uuid)에 DEFAULT auth.uid()가 걸려 있어서,
-- 같은 이름으로 0-인자 버전을 또 만들면 인자 없이 부를 때 Postgres가 "어느 쪽을 부를지 모호하다"는
-- 오류를 낸다 - 그래서 이름 자체를 다르게 뒀다.
--
-- 클라이언트(adminPage.js)는 이제 rpc('is_admin') 대신 rpc('is_admin_self')를 불러야 한다 - 이 마이그레이션과
-- 같이 그 변경도 반영했다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 020_admins.sql 이후 아무 때나 한 번 실행한다.

revoke execute on function public.is_admin(uuid) from public, anon, authenticated;
-- service_role은 Supabase 기본 설정상 public 스키마 함수에 이미 실행 권한이 있어(020에서도 따로 grant하지
-- 않았다) 여기서도 별도 grant가 필요 없다 - search-pexels/search-unsplash가 service_role 키로 이 함수를
-- 호출하는 기존 동작은 그대로 유지된다.

create or replace function public.is_admin_self()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin(auth.uid());
$$;

revoke execute on function public.is_admin_self() from public, anon;
grant execute on function public.is_admin_self() to authenticated;

-- 되돌리기:
-- drop function if exists public.is_admin_self();
-- grant execute on function public.is_admin(uuid) to authenticated;
