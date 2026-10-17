-- PRD v13 관리 페이지(/admin) — 변경 이력(누가 언제 만들고/고치고/게시했는지) + 관리자용 전체 조회
-- 021_travel_feed.sql 다음에 실행한다.
--
-- 021의 "게시된 것만 조회" 정책만으로는 관리자 화면이 draft/archived 행을 못 본다 — Postgres RLS는
-- 같은 종류(select)의 permissive 정책을 OR로 합치므로, "관리자는 전체 조회" 정책을 하나 더 추가해서
-- 관리자는 상태와 무관하게 전부 보이고, 일반 사용자는 여전히 published만 보이게 한다.
--
-- created_by/updated_by/published_by는 클라이언트가 보낸 값을 믿지 않는다 — 트리거가 매번 auth.uid()로
-- 덮어써서, 다른 사람이 쓴 것처럼 조작할 수 없게 한다.

-- ==========================================================================
-- 1. 컬럼 추가
-- ==========================================================================

alter table public.travel_feed_items
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users (id) on delete set null,
  add column if not exists published_by uuid references auth.users (id) on delete set null;

alter table public.popular_destinations
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users (id) on delete set null,
  add column if not exists published_by uuid references auth.users (id) on delete set null;

-- ==========================================================================
-- 2. 감사(audit) 트리거 — created_by/updated_at/updated_by/published_by 자동 기록
-- ==========================================================================

create or replace function public.stamp_admin_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid(); -- 클라이언트가 뭘 보냈든 무시하고 실제 호출자로 덮어쓴다
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.status = 'published' then
      new.published_by := auth.uid();
    end if;
  elsif TG_OP = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
    -- 방금 published로 "바뀐" 순간에만 published_by를 새로 찍는다 (이미 published인 글을 다른 필드만
    -- 고치는 수정으로는 게시자가 바뀌지 않는다)
    if new.status = 'published' and old.status is distinct from 'published' then
      new.published_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create trigger travel_feed_items_stamp_audit
  before insert or update on public.travel_feed_items
  for each row execute function public.stamp_admin_audit_fields();

create trigger popular_destinations_stamp_audit
  before insert or update on public.popular_destinations
  for each row execute function public.stamp_admin_audit_fields();

-- ==========================================================================
-- 3. 관리자는 상태 무관 전체 조회 (기존 "게시된 것만 조회" 정책과 OR로 합쳐진다)
-- ==========================================================================

create policy "관리자는 전체 조회" on public.travel_feed_items
  for select to authenticated
  using (public.is_admin());

create policy "관리자는 전체 조회" on public.popular_destinations
  for select to authenticated
  using (public.is_admin());

-- ==========================================================================
-- 4. get_admin_labels() — created_by/updated_by/published_by를 화면에 이메일로 보여주기 위한 조회
-- ==========================================================================
-- admins 테이블엔 user_id만 있고 이메일이 없다 — auth.users는 일반 권한으로 조회할 수 없으므로
-- security definer로 auth.users를 조회하되, admins에 있는 사람(관리자)의 이메일만 돌려준다
-- (모든 사용자 이메일을 노출하지 않는다). 호출자 자신이 관리자가 아니면 빈 결과를 돌려준다.

create or replace function public.get_admin_labels()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email
  from auth.users u
  join public.admins a on a.user_id = u.id
  where public.is_admin();
$$;

revoke execute on function public.get_admin_labels() from public, anon;
grant execute on function public.get_admin_labels() to authenticated;

-- 되돌리기:
-- drop function if exists public.get_admin_labels();
-- drop policy if exists "관리자는 전체 조회" on public.popular_destinations;
-- drop policy if exists "관리자는 전체 조회" on public.travel_feed_items;
-- drop trigger if exists popular_destinations_stamp_audit on public.popular_destinations;
-- drop trigger if exists travel_feed_items_stamp_audit on public.travel_feed_items;
-- drop function if exists public.stamp_admin_audit_fields();
-- alter table public.popular_destinations drop column if exists published_by, drop column if exists updated_by, drop column if exists updated_at, drop column if exists created_by;
-- alter table public.travel_feed_items drop column if exists published_by, drop column if exists updated_by, drop column if exists updated_at;
