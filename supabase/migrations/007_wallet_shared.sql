-- 007_wallet_shared: 여행지갑 개인지갑/공유지갑 구분
--
-- 006_wallet.sql을 먼저 실행한 뒤에 이 파일을 실행한다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   visibility 컬럼이 이미 있으면 오류로 멈춘다. 맨 아래의 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 하는 일
--   1. wallet_items.visibility 컬럼 추가 (personal | shared, 기본값 personal). shared인 행은 반드시
--      trip_id가 있어야 한다(어느 여행 멤버와 공유하는지 알아야 하므로) — check 제약으로 강제한다.
--   2. RLS를 "본인만 조회/수정" 단일 정책에서 작업별 4개로 나눈다: 쓰기(추가/수정/삭제)는 여전히 본인만,
--      조회만 "본인 것이거나, shared이고 내가 그 trip_id의 멤버"까지 넓힌다 — 001의 is_trip_member를
--      그대로 재사용한다(무한 재귀를 피하려고 만든 security definer 함수, trip_members를 RLS 없이 확인).
--   3. Storage 정책 추가: 'wallet' 버킷의 객체도, 그 경로(name)를 file_url로 가진 wallet_items 행이
--      shared이고 내가 그 여행 멤버면 조회(다운로드/서명 URL 생성)를 허용한다. 006의 "본인 폴더만" 정책은
--      그대로 둔다(본인의 업로드/수정/삭제는 여전히 그 정책 하나로 충분하다) — 이 정책은 "남의 폴더에 있는
--      공유 파일을 읽기"만 추가로 열어 준다.

-- ==========================================================================
-- 1. wallet_items.visibility
-- ==========================================================================

alter table public.wallet_items
  add column visibility text not null default 'personal' check (visibility in ('personal', 'shared'));

alter table public.wallet_items
  add constraint wallet_items_shared_needs_trip check (visibility = 'personal' or trip_id is not null);

-- ==========================================================================
-- 2. RLS: 조회는 넓히고, 추가/수정/삭제는 그대로 본인만
-- ==========================================================================

drop policy if exists "본인만 조회/수정" on public.wallet_items;

create policy "본인 것이거나 공유된 것을 조회" on public.wallet_items
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (visibility = 'shared' and trip_id is not null and public.is_trip_member(trip_id))
  );

create policy "본인만 추가" on public.wallet_items
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "본인만 수정" on public.wallet_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "본인만 삭제" on public.wallet_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ==========================================================================
-- 3. Storage 정책 추가: 공유 항목은 여행 멤버도 파일을 조회할 수 있다
-- ==========================================================================
-- 006의 "wallet: 본인 폴더만 업로드·조회·수정·삭제" 정책은 그대로 둔다. 이 정책은 그 옆에 추가로 붙어서
-- (permissive라서 OR로 합쳐진다) "남의 폴더 안이라도, 그 파일이 공유된 wallet_items 행의 file_url과
-- 같고 내가 그 여행 멤버면" 조회만 허용한다.

create policy "wallet: 공유 항목은 여행 멤버도 조회" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'wallet'
    and exists (
      select 1
      from public.wallet_items wi
      where wi.file_url = storage.objects.name
        and wi.visibility = 'shared'
        and wi.trip_id is not null
        and public.is_trip_member(wi.trip_id)
    )
  );

-- 되돌리기:
-- drop policy "wallet: 공유 항목은 여행 멤버도 조회" on storage.objects;
-- drop policy "본인만 삭제" on public.wallet_items;
-- drop policy "본인만 수정" on public.wallet_items;
-- drop policy "본인만 추가" on public.wallet_items;
-- drop policy "본인 것이거나 공유된 것을 조회" on public.wallet_items;
-- create policy "본인만 조회/수정" on public.wallet_items
--   for all to authenticated
--   using (user_id = (select auth.uid()))
--   with check (user_id = (select auth.uid()));
-- alter table public.wallet_items drop constraint wallet_items_shared_needs_trip;
-- alter table public.wallet_items drop column visibility;
