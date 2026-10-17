# send-notification (Supabase Edge Function)

서버(DB 트리거, pg_cron 스케줄러 등)만 부르는 **내부 발송 함수**입니다. 사람이 로그인해서 쓰는 다른
함수와 달리 Authorization JWT를 전혀 보지 않고, 고정 공유 비밀값 헤더(`x-notify-secret`)로만 막습니다
— `collect-travel-feed`와 같은 방식입니다. 일반 사용자가 자신의 로그인 JWT를 아무리 올바르게 실어
보내도 이 헤더가 없거나 틀리면 401입니다.

## 요청과 응답

`POST /functions/v1/send-notification`

헤더: `x-notify-secret: <NOTIFY_SECRET 비밀값과 같은 값>` (없거나 틀리면 401)

본문:

```json
{
  "userIds": ["uuid1", "uuid2"],
  "type": "schedule",
  "title": "출발이 임박했어요",
  "body": "내일 오후 2시 출발이에요",
  "url": "/#/my-trip/<tripId>",
  "tripId": "<tripId>"
}
```

- `userIds`: 대상 `user_id` 배열이거나, 문자 그대로 `"all"`(전체 사용자 — 500명 단위로 나눠 처리합니다).
- `type`: `departure` | `schedule` | `invite` | `announcement`.
- `title`: 필수. `body`/`url`/`tripId`는 선택.
- `url`: 알림을 눌렀을 때 열 해시 경로 — 웹은 `sw.js`의 `notificationclick`이, 네이티브는 (아직 만들지
  않은) 수신 쪽이 이 값으로 화면을 연다는 계약입니다.
- `tripId`: `notifications.related_trip_id`에 그대로 들어갑니다.

성공 시 200과 함께 집계만 돌려줍니다(개별 발송 성공/실패로 전체 요청이 실패하지 않습니다):

```json
{
  "requested": 5,
  "targeted": 4,
  "sent": { "android": 1, "web": 1 },
  "failed": { "android": 1, "web": 1 },
  "invalidRemoved": { "android": 1, "web": 1 },
  "notificationsInserted": 4
}
```

- `requested`: 입력으로 받은(또는 `"all"`로 풀어낸) 전체 user id 수.
- `targeted`: 대상 필터(아래)를 통과한 수 — 기기 토큰 유무와 무관합니다.
- `sent`/`failed`: platform별 실제 발송 성공/실패 건수.
- `invalidRemoved`: 만료·무효 토큰이라 `device_tokens`에서 삭제한 건수.
- `notificationsInserted`: `notifications`에 새로 넣은 행 수(= `targeted`와 보통 같습니다 — insert
  실패 시에만 달라질 수 있습니다).

그 밖의 상태: `401` 시크릿 헤더 없음/틀림, `405` POST가 아님, `400` 입력 검증 실패, `500` 서버 설정
누락(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) 또는 `"all"` 조회 실패.

## 대상 필터 (요청 3번)

| `type` | 필터 |
| --- | --- |
| `departure`, `schedule` | `notification_settings.schedule_enabled = true` |
| `invite` | `notification_settings.share_enabled = true` |
| `announcement` | 없음 — 요청받은(또는 `"all"`로 풀어낸) 전원 |

`notification_settings`에 행이 아예 없는 사용자는 "꺼짐"으로 표시된 집합에 나타나지 않으므로 자동으로
켜짐으로 간주됩니다 — 설정 화면(`commonPages.js`)에서 한 번도 토글을 건드리지 않은 사용자와 같은 기본값
(`storage.getNotificationSettings()`의 기본값 `{scheduleEnabled:true, shareEnabled:true}`)입니다.

## 발송 (요청 4·5번)

필터를 통과한 사용자들의 `device_tokens`를 `platform`별로 나눠 보냅니다.

- **android — FCM HTTP v1**: `FCM_SERVICE_ACCOUNT` 비밀값(Firebase 서비스 계정 키 JSON 원문)의
  `private_key`로 RS256 JWT를 서명해(Web Crypto API, 라이브러리 없이 직접 구현) Google OAuth2 토큰
  엔드포인트에서 액세스 토큰을 받고, `https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`를
  호출합니다. `android.notification.channel_id`를 `"routory-default"`로 보내는데, 이건
  `triplog/js/pushNotifications.js`가 만드는 채널 id와 같아야 합니다(다르면 Android에서 채널을 못 찾아
  기본 채널로 떨어지거나 알림이 조용히 묻힐 수 있습니다).
- **web — Web Push(VAPID)**: `https://esm.sh/web-push@3.6.7`(naver-login/delete-account가 이미 쓰는
  esm.sh import 방식과 동일). `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY` 비밀값으로
  `webpush.setVapidDetails`를 호출합니다 — `VAPID_PUBLIC_KEY`는 `triplog/js/config.js`의
  `vapidPublicKey`와 **반드시 같은 쌍**이어야 합니다(다른 쌍이면 구독이 전부 무효화됩니다). `device_tokens.token`은
  `triplog/js/webPush.js`가 저장한 `PushSubscription` JSON 문자열이라 그대로 `JSON.parse`해서 씁니다.

만료되었거나 더 이상 유효하지 않은 토큰(요청 5번)은 그 자리에서 `device_tokens`에서 삭제합니다:

- FCM: HTTP 404, 또는 응답의 `error.status`가 `"UNREGISTERED"`/`"NOT_FOUND"`.
- Web Push: `web-push`가 던지는 `WebPushError.statusCode`가 `404` 또는 `410`.

## "all" 배치 (요청 7번)

`userIds`가 `"all"`이면 GoTrue Admin API(`GET {SUPABASE_URL}/auth/v1/admin/users?page=&per_page=500`)로
전체 `user_id`를 모읍니다. 이후 필터링 → 기기 토큰 조회 → 발송 → `notifications` 기록까지 **500명 단위
청크**로 나눠 돕니다(명시적으로 500명을 넘는 `userIds` 배열을 보내도 같은 청크 루프를 타므로 안전합니다).

## 시크릿이 로그에 남지 않습니다 (요청 8번)

`NOTIFY_SECRET`·`FCM_SERVICE_ACCOUNT`·`VAPID_PRIVATE_KEY`의 실제 값은 어떤 `console.log`/`warn`/`error`
호출에도 들어가지 않습니다 — 로그는 건수·성공 실패 여부·HTTP 상태 코드만 남깁니다
(`collect-travel-feed`의 "인증키 비노출" 원칙과 동일). 아래 검증에서 이 조건 자체를 자동으로 확인했습니다.

## ⚠️ 검증 상태 (배포 전에 꼭 읽어주세요)

이 환경에는 Deno CLI도 Docker도 없어서 `supabase functions serve`로 실제 Edge Runtime에서 돌려볼 수
없었습니다. 대신 이렇게 검증했습니다:

- **FCM의 RS256 JWT 서명**: 실제 Google 서비스 계정과 동일한 흐름(RFC 7523 JWT Bearer)을 Web Crypto
  API로 직접 구현했는데, Node의 `globalThis.crypto.subtle`(Deno와 같은 Web Crypto 표준 구현)로
  테스트용 RSA 키 쌍을 만들어 서명 → 같은 공개키로 서명 검증까지 왕복해 통과를 확인했습니다. 더 나아가
  아래 핸들러 테스트에서는 **가짜 Google OAuth 엔드포인트가 실제로 JWT 서명을 암호학적으로 검증**한
  뒤에만 액세스 토큰을 내주도록 만들어서, 함수 전체 흐름 안에서도 서명이 올바르다는 것을 확인했습니다.
- **web-push 라이브러리**: `npm install web-push@3.6.7`로 로컬에 설치하고, 자체 서명 인증서로 띄운
  로컬 HTTPS 서버를 "가짜 푸시 서비스"로 삼아 실제 VAPID 키 쌍 + 테스트용 P-256 구독 키로
  `webpush.sendNotification()`을 실행했습니다 — 서버가 실제로 `authorization: vapid t=...`,
  `content-encoding: aes128gcm`가 찍힌, 원문보다 큰(암호화된) 본문을 받는 것까지 확인했습니다. 즉
  **라이브러리 자체가 실제로 동작한다는 것은 확인했습니다.**
- **이 함수 전체(`index.ts`)도 Node + `globalThis.Deno` 섀임으로 end-to-end 테스트했습니다**(다른
  함수들과 같은 기법) — import 한 줄만 `https://esm.sh/web-push@3.6.7` → 로컬 npm `web-push`로 바꾼
  사본으로(로직은 100% 동일), 인증 401/405/400 가드, `schedule`/`invite`/`announcement` 타입별 대상
  필터(설정 없으면 켜짐 기본값 포함), FCM 성공/무효 토큰 삭제, Web Push 성공/무효 구독 삭제(실제 암호화
  요청으로), `notifications` insert, `"all"`의 GoTrue 페이지네이션(2페이지, 500+150명)과 청크 분할,
  시크릿 무로그까지 전부 통과를 확인했습니다.
- **직접 실행해 보지 못한 것**: (1) esm.sh에서 받은 `web-push`가 **실제 Supabase Edge Runtime(Deno)**
  위에서도 그대로 동작하는지 — `naver-login`/`delete-account`가 이미 esm.sh로 `@supabase/supabase-js`를
  불러와 쓰고 있어 같은 방식이 동작할 가능성이 높지만, 이 함수는 그보다 훨씬 많은 암호화 연산(ECDH,
  HKDF, AES-GCM)을 esm.sh 번들 안에서 수행하므로 완전히 같은 보장은 아닙니다. (2) 실제 Firebase
  프로젝트/서비스 계정, 실제 기기로 FCM 발송 — `FCM_SERVICE_ACCOUNT` 비밀값을 넣기 전까지는 운영
  환경에서도 모든 FCM 발송이 "비밀값 없음" 오류로 조용히 건너뛰어집니다(500이 아니라 `sent.android:0`로
  집계만 됩니다). **배포 후 아래 curl 테스트로, 그리고 실제 기기/브라우저 구독이 있는 테스트 계정으로
  한 번은 꼭 확인해 주세요.**

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 1) 서버 대 서버 호출을 막는 고정 비밀값 - 아무 긴 임의 문자열이나 정합니다.
#    DB 트리거/pg_cron이 이 함수를 부를 때 쓸 x-notify-secret 헤더 값과 완전히 같아야 합니다.
supabase secrets set NOTIFY_SECRET=<임의의 긴 문자열>

# 2) Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"으로 받은 JSON 파일의 "내용 전체"를
#    한 줄 문자열로 넣습니다(개행 포함 private_key 필드가 JSON 안에 이스케이프된 채로 들어있어야 합니다).
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"

# 3) VAPID 키 쌍 - 이미 npx web-push generate-vapid-keys로 만들어 Public Key는
#    triplog/js/config.js의 vapidPublicKey에 넣어 둔 바로 그 쌍을 씁니다(새로 만들면 기존 구독이 전부 무효화됩니다).
supabase secrets set VAPID_PUBLIC_KEY=<triplog/js/config.js의 vapidPublicKey와 동일한 값>
supabase secrets set VAPID_PRIVATE_KEY=<같은 때 발급받은 Private Key>
# (선택) 기본값은 "mailto:support@routory.app" - 실제 연락 가능한 주소/URL로 바꾸고 싶으면:
supabase secrets set VAPID_SUBJECT=mailto:<실제 연락처 이메일>

# 4) 배포 (서버 대 서버 함수라 JWT 검증을 끕니다 - collect-travel-feed와 동일)
supabase functions deploy send-notification --no-verify-jwt
```

`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 모든 Edge Function에 자동으로 넣어줍니다. 로그
보기: Supabase 대시보드 → Edge Functions → send-notification → Logs.

이 함수를 실제로 호출하는 쪽(DB 트리거, pg_cron 스케줄)은 아직 만들지 않았습니다 — 이번 작업은
`send-notification` 함수 자체까지입니다. 호출하는 쪽을 만들 때도 `collect-travel-feed`의
`x-cron-secret`/`025_collect_travel_feed_cron.sql` 패턴을 참고하면 됩니다 (`net.http_post`에
`x-notify-secret` 헤더로 이 함수의 `NOTIFY_SECRET`과 같은 값을 실어 보내면 됩니다).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키 - triplog/js/supabaseClient.js 참고>
export NOTIFY_SECRET=<supabase secrets set으로 넣은 값>
export TEST_USER_ID=<테스트용 실제 user_id - device_tokens에 토큰을 등록해 둔 계정이어야 발송까지 확인됩니다>

# ① 정상 호출: 집계 JSON이 와야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/send-notification" \
  -H "apikey: $ANON_KEY" \
  -H "x-notify-secret: $NOTIFY_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"userIds\":[\"$TEST_USER_ID\"],\"type\":\"announcement\",\"title\":\"테스트 알림\",\"body\":\"send-notification 배포 확인\"}"

# ② 시크릿 헤더 없이: 401이 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/send-notification" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"userIds\":\"all\",\"type\":\"announcement\",\"title\":\"x\"}"

# ③ 일반 사용자 JWT만 보내고 시크릿 헤더는 없이: 마찬가지로 401이어야 합니다(요청 1번 확인)
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/send-notification" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer <로그인한 사용자의 access_token>" \
  -H "Content-Type: application/json" \
  -d "{\"userIds\":[\"$TEST_USER_ID\"],\"type\":\"announcement\",\"title\":\"x\"}"
```

①을 실행한 뒤 `$TEST_USER_ID` 계정의 기기(안드로이드 앱 또는 "알림 켜기"를 누른 브라우저)에 실제
알림이 뜨는지, 그리고 Supabase 대시보드의 `notifications` 테이블에 행이 생겼는지 확인하세요.
