-- 031_push_notifications: 푸시 알림 시스템 (PRD v11) 데이터 모델 + RLS
--
-- 만드는 것
--   1. device_tokens        FCM/Web Push 토큰 등록
--   2. notification_settings 사용자별 알림 종류 on/off (공지사항은 끄는 설정 없음 — PRD 5번)
--   3. notifications        인앱 알림센터용, 사용자별 발송 기록
--   4. notification_log     시간 기반 알림(출발 임박/일정 임박)의 중복 발송 방지 로그
--   5. announcements        전체 공지용. PRD 3번은 공지사항도 notifications에 넣는 방식이었지만,
--                           notifications는 사용자별 테이블이라 전체 공지를 거기 넣으면 수신자 수만큼
--                           행이 복제돼야 한다 — 그래서 공지 "원본"은 이 테이블에 따로 두고, 발송 시점에
--                           필요하면 notifications에 사용자별 행을 만들어 내려주는 쪽으로 분리했다.
--   6. trips.timezone 기본값 'Asia/Seoul' 지정 (+ 기존 null 행 백필)
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 한 번 실행한다.
--   테이블 5개는 전부 새로 만드는 것이라 IF NOT EXISTS를 쓰지 않았다 (001_invite_feature.sql과 동일한 방침).

-- ==========================================================================
-- 1. device_tokens
-- ==========================================================================

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('android', 'web')),
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

create index device_tokens_user_id_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- 본인 토큰만 읽기/쓰기 (등록·갱신·로그아웃 시 삭제 모두 본인 행만)
create policy "본인 토큰만 조회/수정" on public.device_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger device_tokens_set_updated_at
  before update on public.device_tokens
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 2. notification_settings
-- ==========================================================================
-- PRD 5번: 설정 화면에 일정 알림 / 초대·공유 알림 두 토글만 있고, 공지사항은 끄는 설정이 없다
-- (항상 수신). user_id 자체가 PK라서 사용자당 한 행이고, upsert로 다룬다(010_user_consents.sql과 같은 모양).

create table public.notification_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  schedule_enabled boolean not null default true,
  share_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

create policy "본인 설정만 조회/수정" on public.notification_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger notification_settings_set_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 3. notifications (인앱 알림센터용, 사용자별 발송 기록)
-- ==========================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('departure', 'schedule', 'invite', 'announcement')),
  title text not null,
  body text,
  related_trip_id uuid references public.trips (id) on delete cascade,
  sent_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_id_sent_at_idx on public.notifications (user_id, sent_at desc);

alter table public.notifications enable row level security;

-- 조회는 본인 행만. insert 정책은 일부러 안 만든다 — service_role(Edge Function)만 발송할 수 있다.
create policy "본인 알림만 조회" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

-- update 정책은 본인 행만 허용하지만, "읽음 처리"만 되게 해야 한다. RLS의 USING/WITH CHECK만으로는
-- "이 컬럼만 바뀌었는지"를 OLD/NEW를 비교해 판단할 수 없어서(022_travel_feed_admin_audit.sql의
-- stamp_admin_audit_fields와 같은 이유), 트리거로 read_at 이외의 모든 컬럼을 OLD 값으로 강제 복원한다.
create policy "본인 알림만 읽음 처리" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.lock_notification_fields_except_read_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.type := old.type;
  new.title := old.title;
  new.body := old.body;
  new.related_trip_id := old.related_trip_id;
  new.sent_at := old.sent_at;
  return new;
end;
$$;

create trigger notifications_lock_fields_except_read_at
  before update on public.notifications
  for each row execute function public.lock_notification_fields_except_read_at();

-- ==========================================================================
-- 4. notification_log (중복 발송 방지용 — 시간 기반 알림 전용)
-- ==========================================================================
-- 출발 임박/일정 임박은 pg_cron이 몇 분마다 조건에 맞는 대상을 다시 훑기 때문에, 같은 여행(출발 임박)이나
-- 같은 일정(일정 임박)에 이미 보냈는지를 확인할 로그가 필요하다 (PRD 4번 "중복 발송 방지용 플래그/로그").
-- ref_id는 kind='departure'면 trips.id, kind='schedule'이면 schedule_items.id — 둘 중 어느 테이블을
-- 가리키는지가 kind에 따라 달라져서 FK를 걸지 않는다(polymorphic reference, wallet_items의 trip_id처럼
-- 단일 FK로 고정하기 어려운 경우).

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('departure', 'schedule')),
  ref_id uuid not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);

alter table public.notification_log enable row level security;
-- 정책을 전혀 만들지 않는다 — authenticated/anon 둘 다 아무 것도 할 수 없고, service_role만
-- (RLS를 우회하므로) 읽고 쓸 수 있다. 009_travel_briefing.sql의 briefing_cache와 같은 패턴.

-- ==========================================================================
-- 5. announcements (전체 공지용 — notifications와 분리)
-- ==========================================================================

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.announcements enable row level security;
-- notification_log과 동일하게 정책 없음 — service_role만 접근 (작성·발송은 운영자가 대시보드 또는
-- 관리자 전용 Edge Function으로 처리, 클라이언트는 이 테이블을 직접 보거나 쓸 수 없다).

-- ==========================================================================
-- 6. trips.timezone 기본값 (일정 시간을 해석하는 기준)
-- ==========================================================================
-- 017_trips_timezone.sql은 "트리거나 기본값을 넣지 않는다"고 일부러 null로 남겨 두었는데(국내/옛 방식
-- 여행 구분용), 이제 일정 임박 알림이 트리거 시각을 현지 시각으로 해석해야 해서 모든 여행이 타임존을
-- 가져야 한다. 국내 여행은 'Asia/Seoul'이 맞는 값이라 안전하게 기본값/백필로 채운다.

alter table public.trips
  alter column timezone set default 'Asia/Seoul';

update public.trips
  set timezone = 'Asia/Seoul'
  where timezone is null;

comment on column public.trips.timezone is 'IANA 타임존(예: "Asia/Tokyo"). 여행 만들기 시점에 destinations.timezone을 복사한 값. 017에서는 국내/옛 여행을 null로 남겼지만, 031부터는 일정 임박 알림이 현지 시각 해석에 이 값을 써야 해서 기본값 Asia/Seoul로 백필했다.';
