-- 032_trip_member_notify: trip_members에 멤버가 "초대 수락으로" 들어올 때(PRD v11 2번 "새 멤버 가입"·
-- "초대 수락") send-notification Edge Function을 DB 트리거에서 직접 부른다.
--
-- 클라이언트가 알림을 직접 요청하게 하면(예: "참여했어요" 호출을 앱이 보냄) 위조할 수 있다 - 아무나
-- send-notification을 안 쓰고도 "내가 참여했다"는 요청을 조작해서 다른 사람에게 원하는 메시지를 보낼
-- 길이 생긴다. 그래서 신뢰할 수 있는 경로는 DB 트리거뿐이다: trip_members에 실제로 행이 insert된 뒤에만,
-- 그것도 이 함수 자신이 트랜잭션 안에서 직접 확인한 trip_id/user_id/role로만 호출한다.
--
-- ---- 요청 2번: 대상 분기 ----
-- trip_members에 행이 생기는 경로는 두 가지뿐이다(001_invite_feature.sql 기준 - 클라이언트가 직접 insert할
-- 수 있는 정책 자체가 없다):
--   1. add_trip_owner() 트리거 - 여행을 만든 사람을 role='owner'로 자동 추가 (001)
--   2. accept_trip_invite() 함수 - 초대 코드를 수락한 사람을 role='editor'로 추가 (001)
-- role='owner'인 첫 행은 "자기 여행을 만든 것"이라 알림 대상이 아니다 - new.role <> 'editor'면 바로 반환한다.
--
-- ---- 요청 3번: 수신자·문구 ----
-- "새 멤버 가입"(기존 멤버 전원, 신규 참여자 본인과 초대한 사람 제외) + "초대 수락"(초대한 사람에게만) -
-- 둘 다 notifications.type은 'invite'다(스키마에 별도 type이 없다 - 031의 check 제약 참고). "초대한 사람"은
-- trip_invites에서 이 여행의 가장 최근 초대 행의 created_by를 쓰고, 없으면(이론상 가능성은 낮지만 트리거가
-- 여전히 방어적으로 다룬다) 여행 owner로 대체한다. 지금 스키마는 "이 멤버가 정확히 어느 초대 코드로
-- 들어왔는지"를 저장하지 않아서(trip_members에 invite_id 같은 FK가 없다) "가장 최근 초대"가 최선의
-- 근사치다 - 001의 RLS("owner만 초대 생성")가 유지되는 한 한 여행의 모든 초대는 결국 owner가 만든
-- 것이라 이 근사치와 owner 대체값이 사실상 같은 결과를 내므로 지금은 문제가 되지 않는다. 나중에 editor도
-- 초대를 만들 수 있게 정책이 바뀌면(001 주석 참고) 이 근사치의 오차가 커질 수 있다 - 그때는 trip_members에
-- invited_by 컬럼을 추가해 정확히 연결하는 편이 낫다.
-- 거절(초대 코드를 그냥 안 쓰는 것)은 trip_members에 행 자체가 생기지 않으므로 이 트리거가 아예 안 돈다 -
-- "거절은 알림을 보내지 않는다"는 자연히 만족된다.
-- 이중 발송 방지: "새 멤버 가입" 수신자 목록에서 신규 참여자 본인과 초대한 사람을 뺀다 - 지금 스키마에서는
-- 초대한 사람이 거의 항상 owner라서, 이 제외 덕분에 owner는 "새 멤버 가입"을 또 안 받고 "초대 수락" 한
-- 통만 받는다.
--
-- ---- 요청 4번: 이름 ----
-- 003_member_profiles.sql의 get_trip_members와 완전히 같은 순서로만 auth.users.raw_user_meta_data에서
-- 이름을 찾는다(full_name → name → nickname → preferred_username) - 이메일은 절대 읽지도, 문구에 쓰지도
-- 않는다. 보안 definer라서 auth.users를 읽을 수 있다(003과 같은 이유).
--
-- ---- 요청 1번: pg_net + Vault ----
-- NOTIFY_SECRET 값 자체는 이 마이그레이션 파일에 전혀 쓰지 않는다(025_collect_travel_feed_cron.sql의
-- CRON_SECRET처럼 평문 플레이스홀더로 파일에 남기지 않으려고 Vault를 쓰는 것이 이번 요청의 핵심이다).
-- **이 SQL을 실행하기 전에**, Supabase 대시보드 → SQL Editor에서 아래를 먼저 실행해 시크릿을 Vault에
-- 등록해야 한다(supabase/functions/send-notification의 NOTIFY_SECRET 비밀값과 반드시 같은 값):
--
--   select vault.create_secret('<NOTIFY_SECRET과 같은 값>', 'notify_secret', 'send-notification 호출용 공유 비밀값');
--
-- 나중에 값을 바꾸려면(두 곳 다 같이 바꿔야 한다 - send-notification의 secrets set도 같이):
--
--   select vault.update_secret(id, '<새 값>') from vault.decrypted_secrets where name = 'notify_secret';
--
-- pg_cron/pg_net과 달리 Vault(스키마 vault, pgsodium 기반)는 Supabase 호스팅 프로젝트에 기본으로 이미
-- 켜져 있어 별도 create extension이 필요 없다. pg_net은 025에서 이미 켰겠지만 이 파일만 단독으로 실행될
-- 가능성에 대비해 아래서 다시 한번 if not exists로 켠다(이미 켜져 있으면 조용히 건너뛴다).
--
-- Edge Function 호출은 net.http_post로 큐에 넣기만 하고(비동기, 응답을 기다리지 않는다) 바로 반환한다 -
-- 멤버 가입(트랜잭션 커밋)이 알림 발송 속도나 성공 여부에 발목 잡히지 않는다. Vault 조회 실패, net.http_post
-- 자체의 오류(확장 미설치 등) 모두 exception 블록으로 삼켜서 trip_members insert(초대 수락) 자체는 알림
-- 발송 문제와 무관하게 항상 성공한다.
--
-- send-notification 엔드포인트 URL은 025_collect_travel_feed_cron.sql과 같은 이유로 이 파일에 프로젝트
-- 주소를 직접 적는다(Supabase에 "내 프로젝트 URL" GUC가 따로 없다).

create extension if not exists pg_net;

create or replace function public.notify_trip_member_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint constant text := 'https://ffzjgiknrrgwvgobybdq.supabase.co/functions/v1/send-notification';
  v_notify_secret text;
  v_new_name text;
  v_trip_title text;
  v_owner_id uuid;
  v_inviter_id uuid;
  v_recipient_ids uuid[];
begin
  -- 요청 2번: owner로 들어가는 첫 행(여행 생성)은 대상이 아니다. 초대 수락(editor)만 처리한다.
  if new.role <> 'editor' then
    return new;
  end if;

  begin
    select decrypted_secret into v_notify_secret
      from vault.decrypted_secrets
      where name = 'notify_secret'
      limit 1;

    if v_notify_secret is null then
      raise warning 'notify_trip_member_added: Vault에 notify_secret이 없어 알림을 건너뜁니다 (trip_id=%)', new.trip_id;
      return new;
    end if;

    -- 요청 4번: 이름/닉네임만, 이메일은 절대 안 읽는다 (003_member_profiles.sql과 같은 순서)
    select nullif(btrim(coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        u.raw_user_meta_data ->> 'nickname',
        u.raw_user_meta_data ->> 'preferred_username'
      )), '')
      into v_new_name
      from auth.users u
      where u.id = new.user_id;
    v_new_name := coalesce(v_new_name, '여행 멤버');

    select t.title, t.owner_id into v_trip_title, v_owner_id
      from public.trips t
      where t.id = new.trip_id;

    -- 요청 3번: 초대한 사람 = trip_invites의 가장 최근 생성자, 없으면 owner로 대체 (위 설명 참고)
    select i.created_by into v_inviter_id
      from public.trip_invites i
      where i.trip_id = new.trip_id
      order by i.created_at desc
      limit 1;
    v_inviter_id := coalesce(v_inviter_id, v_owner_id);

    -- "새 멤버 가입": 기존 멤버 전원, 신규 참여자 본인과 초대한 사람은 제외 (이중 발송 방지)
    select array_agg(m.user_id) into v_recipient_ids
      from public.trip_members m
      where m.trip_id = new.trip_id
        and m.user_id <> new.user_id
        and (v_inviter_id is null or m.user_id <> v_inviter_id);

    if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
      perform net.http_post(
        url := v_endpoint,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_notify_secret),
        body := jsonb_build_object(
          'userIds', to_jsonb(v_recipient_ids),
          'type', 'invite',
          'title', v_new_name || '님이 ''' || coalesce(v_trip_title, '여행') || '''에 참여했어요',
          'url', '/#/my-trip/' || new.trip_id::text,
          'tripId', new.trip_id::text
        )
      );
    end if;

    -- "초대 수락": 초대한 사람에게만 (본인이 본인을 초대한 경우는 없지만 방어적으로 한 번 더 막는다)
    if v_inviter_id is not null and v_inviter_id <> new.user_id then
      perform net.http_post(
        url := v_endpoint,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_notify_secret),
        body := jsonb_build_object(
          'userIds', jsonb_build_array(v_inviter_id),
          'type', 'invite',
          'title', v_new_name || '님이 초대를 수락했어요',
          'url', '/#/my-trip/' || new.trip_id::text,
          'tripId', new.trip_id::text
        )
      );
    end if;
  exception when others then
    -- 알림 발송 경로의 어떤 오류(Vault 미설정, pg_net 미설치, 네트워크 등)도 trip_members insert
    -- (= 초대 수락)를 막으면 안 된다 - 로그만 남기고 멤버 가입은 그대로 성공시킨다.
    raise warning 'notify_trip_member_added: 알림 발송 중 오류(무시하고 계속) trip_id=% error=%', new.trip_id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace trigger trip_members_notify_added
  after insert on public.trip_members
  for each row execute function public.notify_trip_member_added();

-- 되돌리기:
-- drop trigger if exists trip_members_notify_added on public.trip_members;
-- drop function if exists public.notify_trip_member_added();
-- select vault.delete_secret(id) from vault.decrypted_secrets where name = 'notify_secret';
