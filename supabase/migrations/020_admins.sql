-- PRD v13 "메인 화면 개선 (여행 소식·인기 여행지)" — 공지사항 작성 등 운영자 권한
-- admins에 행을 추가/삭제하는 것은 클라이언트 정책을 열어두지 않았으므로
-- Supabase 대시보드(Table Editor, service_role로 동작)에서 운영자가 직접 처리한다.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- 본인이 관리자인지 여부만 조회 가능 (전체 관리자 목록은 노출하지 않음)
create policy "본인 관리자 여부만 조회"
  on public.admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- insert/update/delete 정책 없음 — service_role(대시보드)만 추가/해제 가능

-- 001_invite_feature.sql의 is_trip_member/is_trip_owner와 같은 패턴:
-- 다른 테이블의 RLS 정책(예: 공지사항 작성 권한)이 admins를 직접 참조하면
-- "본인 행만 조회" 정책 때문에 타인에 대해서는 false로 평가되어 버린다.
-- security definer로 RLS를 우회해 "이 uid가 관리자인가"를 어디서든 정확히 판단한다.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = uid
  );
$$;

revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
