-- 019_wallet_trip_required: 여행지갑을 "여행별로 완전히 분리"로 바꾼다
--
-- 006_wallet.sql/007_wallet_shared.sql을 먼저 실행한 뒤에 이 파일을 실행한다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   trip_id가 null인 wallet_items 행이 하나라도 있으면 아래 1번에서 예외를 던지고 멈춘다 — 그 행을
--   어느 여행에 연결할지는 이 마이그레이션이 대신 정할 수 없어서(사용자만 안다), 먼저 그 행들을
--   지우거나(휴지통처럼 안 쓰는 임시 문서였다면) `update public.wallet_items set trip_id = '<그 여행의
--   id>' where id = '<문서 id>';`로 직접 여행을 지정한 뒤 이 파일을 다시 실행한다.
--
-- 왜 하는가 (사용자 피드백: "여행별로 올린 이미지나 파일들이 나와야한다, 지금은 모든 여행리스트에
-- 공유되고있다")
--   006/007 설계는 개인지갑 문서(여권 등)를 "특정 여행과 무관한 공통 보관함"으로 두고 트립 전체에서
--   똑같이 보이게 했다. 실제로는 walletForm.js가 개인지갑 업로드 시 trip_id를 항상 null로 보내서, 올린
--   문서가 전부 그 공통 보관함에 쌓여 모든 여행의 개인지갑에 뒤섞여 나타났다 — 사용자가 본 바로 그 증상.
--   이 마이그레이션 이후: 개인지갑도 공유지갑처럼 반드시 어느 여행에 속하고, 그 여행의 #/wallet/:id
--   화면에서만 보인다. "여권처럼 여러 여행에 공통으로 쓰는 문서" 같은 별도 보관함은 이번에 없애기로
--   했다(사용자 확인: 개인지갑은 "나만 보이는 민감한 정보" 저장용이고 공유지갑과 마찬가지로 여행별로
--   따로 저장되어야 한다는 쪽을 선택).
--
-- 하는 일
--   1. trip_id를 not null로 바꾼다 (기존에 null인 행이 있으면 위 안내대로 먼저 정리해야 한다).
--   2. trip_id의 삭제 규칙을 on delete set null에서 on delete cascade로 바꾼다 — 006 당시엔 "여행이
--      지워져도 개인 문서는 공통 보관함에 남아야 한다"는 전제였지만, 이제 모든 wallet_items가 어느
--      여행에 반드시 속하므로 그 여행이 없어지면 문서도 함께 없어지는 쪽이 맞다 (storage.js#deleteTrip이
--      Storage의 실제 파일까지 함께 정리하도록 같이 고쳤다 — 내가 올린 파일만 best-effort로, DB 행
--      cascade와는 별개로 처리한다).
--   3. wallet_items_shared_needs_trip 체크 제약(007)은 trip_id가 이제 항상 있어 늘 참이 되어 의미가
--      없어졌지만, 있어도 해롭지 않으니 그대로 둔다(제거하지 않는다).
--
-- RLS는 바꾸지 않는다 — select/insert/update/delete 정책 전부 trip_id의 null 여부와 무관하게 이미
-- user_id/visibility/is_trip_member만 본다 (007 참고).
--
-- 2번은 FK 제약 이름이 Postgres 기본값 wallet_items_trip_id_fkey라고 가정한다 (006의 inline
-- `references` 절이 이름을 안 지어줬을 때 Postgres가 붙이는 이름 — 011_delete_account_cascades.sql이
-- 같은 가정을 쓴 곳에 남긴 주석과 같은 이유). 이것이 이 파일이 깨질 수 있는 유일한 지점이다.

-- ==========================================================================
-- 1. trip_id를 필수로 바꾼다
-- ==========================================================================

do $$
begin
  if exists (select 1 from public.wallet_items where trip_id is null) then
    raise exception 'wallet_items에 trip_id가 비어 있는 행이 있어요. 이 파일의 맨 위 안내대로 먼저 지우거나 여행을 지정한 뒤 다시 실행해주세요.';
  end if;
end $$;

alter table public.wallet_items
  alter column trip_id set not null;

-- ==========================================================================
-- 2. trip_id 삭제 규칙: set null → cascade
-- ==========================================================================

alter table public.wallet_items
  drop constraint wallet_items_trip_id_fkey;

alter table public.wallet_items
  add constraint wallet_items_trip_id_fkey
  foreign key (trip_id) references public.trips (id) on delete cascade;

-- 되돌리기:
-- alter table public.wallet_items drop constraint wallet_items_trip_id_fkey;
-- alter table public.wallet_items add constraint wallet_items_trip_id_fkey
--   foreign key (trip_id) references public.trips (id) on delete set null;
-- alter table public.wallet_items alter column trip_id drop not null;
