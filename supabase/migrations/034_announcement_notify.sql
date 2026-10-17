-- 034_announcement_notify: announcements에 행이 insert되면 전체 사용자에게 공지 알림을 보낸다
-- (PRD v11 3번 "공지사항 | 운영자가 수동 발송 | 전체 또는 일부 사용자 | MVP에서는 관리자 UI 없이 DB
-- 직접 insert로 충분함").
--
-- 관리자 UI는 일부러 안 만든다(요청 2번) - announcements는 031에서 이미 RLS를 켜고 정책을 전혀 안 둬서
-- (service_role만 접근 가능) 클라이언트가 직접 쓸 길이 없고, Supabase Studio의 Table Editor(=service_role로
-- 동작)에서 운영자가 직접 행을 insert하는 것으로 충분하다 - 020_admins.sql의 "관리자 추가는 대시보드에서
-- 수동으로"와 같은 방침이다. insert 예시는 파일 맨 아래 참고.
--
-- 흐름: announcements insert -> 트리거가 send-notification을 userIds:'all', type:'announcement'로 호출
-- -> "호출 자체가 성공"(net.http_post가 예외 없이 request_id를 돌려줌)하면 sent_at을 채운다.
--
-- ⚠️ "성공"의 뜻: net.http_post는 비동기다(요청을 큐에 넣고 바로 request_id만 돌려주고, 실제 HTTP 응답은
-- 나중에 net._http_response 테이블에 쌓인다) - pg_net에 요청 자체의 응답을 동기로 기다리는
-- net.http_collect_response()가 있긴 하지만, 그 함수의 정확한 반환 타입/필드 이름을 이 환경에서 pg_net을
-- 실제로 설치해 확인할 방법이 없어서(이 저장소의 다른 "확인 안 된 외부 API" 사례, 예: airport-congestion의
-- data.go.kr 엔드포인트와 같은 이유) 추측으로 그 API에 기대는 대신, 032/033이 이미 쓰고 있는 "fire-and-forget
-- net.http_post + 예외 안 나면 성공으로 본다"는 검증된 패턴을 그대로 따랐다. 그래서 여기서 sent_at은
-- "send-notification 호출을 성공적으로 큐에 넣었다"는 뜻이지, "모든 사용자에게 실제로 전달됐다"는
-- 보장은 아니다 - 다만 send-notification 자체도 내부적으로 best-effort(일부 기기 발송 실패를 허용하고
-- 항상 200에 집계만 돌려줌)라서, 이 해석이 기능 전체의 "성공" 기준과 일관된다.
--
-- Vault의 notify_secret은 032_trip_member_notify.sql에서 이미 등록해 둔 것을 그대로 재사용한다.

create extension if not exists pg_net;

create or replace function public.notify_announcement_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint constant text := 'https://ffzjgiknrrgwvgobybdq.supabase.co/functions/v1/send-notification';
  v_notify_secret text;
begin
  begin
    select decrypted_secret into v_notify_secret
      from vault.decrypted_secrets
      where name = 'notify_secret'
      limit 1;

    if v_notify_secret is null then
      raise warning 'notify_announcement_added: Vault에 notify_secret이 없어 공지 발송을 건너뜁니다 (announcement_id=%)', new.id;
      return new;
    end if;

    -- net.http_post가 예외 없이 끝나면(= 요청을 큐에 넣는 데 성공하면) "성공"으로 보고 sent_at을 채운다
    -- (위 파일 설명의 "성공"의 뜻 참고). 반환값(request_id)은 쓸 데가 없어 perform으로 버린다.
    perform net.http_post(
      url := v_endpoint,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_notify_secret),
      body := jsonb_build_object(
        'userIds', 'all',
        'type', 'announcement',
        'title', new.title,
        'body', new.body
      )
    );

    update public.announcements set sent_at = now() where id = new.id;
  exception when others then
    -- Vault 조회나 net.http_post 자체가 실패해도(pg_net 미설치 등) announcements insert는 항상 성공해야
    -- 한다 - 운영자가 공지를 "쓰는" 행위가 발송 실패 때문에 막히면 안 된다. sent_at은 null로 남아
    -- "아직 발송 안 함"을 그대로 나타낸다(031의 애초 의도).
    raise warning 'notify_announcement_added: 발송 요청 실패(무시하고 계속) announcement_id=% error=%', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create or replace trigger announcements_notify_added
  after insert on public.announcements
  for each row execute function public.notify_announcement_added();

-- ==========================================================================
-- 공지 작성 예시 (Supabase Studio → SQL Editor 또는 Table Editor에서 직접 실행)
-- ==========================================================================
-- insert into public.announcements (title, body) values ('서비스 점검 안내', '10/20 새벽 2시~4시 점검이 있어요.');
--
-- 이 한 줄만 실행하면 트리거가 자동으로 전체 사용자에게 공지 알림을 보내고(공지사항은
-- notification_settings의 끄기 설정이 없어 schedule_enabled/share_enabled와 무관하게 전원에게 간다 -
-- send-notification의 대상 필터 참고), 성공하면 sent_at이 채워진다.
--
-- 위 insert에 "returning sent_at"을 붙여서 같이 확인하고 싶어질 수 있는데, 그러면 null이 보인다 -
-- RETURNING은 INSERT 문 자체가 끝난 시점의 행 이미지라서 "그 다음"에 도는 AFTER 트리거의 UPDATE(sent_at
-- 채우기)를 못 본다(Postgres의 표준 동작이지 버그가 아니다). 발송 여부는 insert를 끝낸 뒤 따로 조회해야 한다:
-- select * from public.announcements order by created_at desc limit 1;

-- 되돌리기:
-- drop trigger if exists announcements_notify_added on public.announcements;
-- drop function if exists public.notify_announcement_added();
