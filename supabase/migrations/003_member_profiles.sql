-- 003_member_profiles: 여행 멤버의 이름·프로필 사진을 멤버끼리 볼 수 있게 하는 함수
--
-- 왜 필요한가: 이름과 프로필 사진은 로그인 정보(auth.users)의 user_metadata에 있고, 앱(클라이언트)은 그 테이블을 읽을 수 없다.
-- trip_members에는 user_id만 있어서, 나의 여행 화면의 "참여 인원" 아바타와 "멤버 관리" 창을 채우려면 이 함수가 필요하다.
-- (이 함수를 실행하지 않아도 앱은 동작한다: 이름 없이 인원수만 보이고 내 이름·사진만 나온다.)
--
-- 보안: security definer라서 auth.users를 읽을 수 있다. 그래서 (1) 호출한 사람이 그 여행의 멤버일 때만 행을 돌려주고,
--   (2) 이메일 같은 다른 정보는 돌려주지 않고 이름과 http(s) 사진 주소만 돌려준다. 로그인하지 않은 사용자(anon)는 부를 수 없다.
-- 이름/사진 필드 이름은 제공자마다 달라서(구글: full_name·picture, 카카오: nickname·profile_image 등) 앱의 auth.js와 같은 순서로 찾는다.
--
-- 실행 방법: 001, 002 다음에 Supabase 대시보드 → SQL Editor에서 실행한다. 여러 번 실행해도 된다 (create or replace).

create or replace function public.get_trip_members(p_trip_id uuid)
returns table (
  user_id uuid,
  role text,
  joined_at timestamptz,
  name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.user_id,
    m.role,
    m.joined_at,
    nullif(btrim(coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      u.raw_user_meta_data ->> 'nickname',
      u.raw_user_meta_data ->> 'preferred_username'
    )), ''),
    (select p from (values (coalesce(
      u.raw_user_meta_data ->> 'avatar_url',
      u.raw_user_meta_data ->> 'picture',
      u.raw_user_meta_data ->> 'profile_image'
    ))) as v(p) where p ~* '^https?://')
  from public.trip_members m
  join auth.users u on u.id = m.user_id
  where m.trip_id = p_trip_id
    and public.is_trip_member(p_trip_id)
  order by (m.role = 'owner') desc, m.joined_at, m.user_id;
$$;

revoke execute on function public.get_trip_members(uuid) from public, anon;
grant execute on function public.get_trip_members(uuid) to authenticated;

-- 되돌리기: drop function if exists public.get_trip_members(uuid);
