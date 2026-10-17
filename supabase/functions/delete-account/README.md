# delete-account (Supabase Edge Function)

로그인한 사용자 본인의 계정과 데이터를 완전히 삭제합니다. 클라이언트(브라우저)는 `service_role` 키를 가질 수
없어서 `auth.users`를 직접 지울 권한이 없습니다(Supabase Admin API는 `service_role` 키로만 호출할 수 있습니다)
— 그래서 이 함수가 서버 쪽에서 대신 지웁니다. `triplog/js/accountDeletePage.js`(설정 → 계정 → 회원 탈퇴 화면)의
최종 확인 다이얼로그에서 "탈퇴하기"를 누르면 호출됩니다.

## 요청과 응답

`POST /functions/v1/delete-account` (본문 없음)

- `Authorization` 헤더에 **로그인한 사용자 본인의** `access_token`이 있어야 합니다(`TripLog.supabase.functions.invoke`가
  로그인 상태라면 항상 이렇게 보냅니다). 이 함수는 그 토큰에서 사용자 id(`sub` 클레임)를 꺼내 "지울 사람"으로
  삼습니다 — 몸체로 다른 사용자의 id를 받지 않습니다. **반드시 자기 자신만 지울 수 있게 하려는 의도적인
  설계**입니다. `service_role` 키는 본인 확인에는 전혀 쓰지 않고, 아래 삭제 작업(RLS를 건너뛰어야 하는
  작업들)에만 씁니다.

성공하면:

```json
{}
```

실패하면:

```json
{ "error": "<실패한 단계를 알 수 있는 한국어 메시지, 예: \"소유한 여행 삭제 실패: ...\">" }
```

| 상태 | 원인 |
| --- | --- |
| 401 | 로그인 토큰이 없거나 이상함(anon 키만으로 부른 경우 등) |
| 405 | POST가 아님 |
| 500 | 이 함수의 설정(비밀값) 또는 아래 12단계 중 하나가 실패함 — `error` 메시지에 어느 단계인지 담겨 있습니다 |

**클라이언트는 이 `error` 메시지를 사람에게 그대로 보여주지 않습니다.** `accountDeletePage.js`는 실패
원인과 무관하게 항상 "탈퇴 처리 중 문제가 발생했습니다. 고객센터로 문의해주세요."만 보여주고, 이 함수가
돌려준 구체적인 메시지는 브라우저 콘솔에만 남깁니다 — 내부 사정(어느 테이블에서 막혔는지 등)을 사용자에게
노출하지 않기 위해서입니다. 이 함수가 그래도 구체적인 단계 이름을 응답에 담는 이유는, Edge Function
로그(그리고 필요하면 고객센터가 원인을 조사할 때)에서 어디가 막혔는지 바로 알 수 있게 하기 위함입니다.

## 지우는 순서 (요청하신 순서 그대로)

1. **`wallet_items` (Storage의 실제 파일도 함께)** — 파일은 DB 행이 아니라서 아래 어떤 외래키
   `cascade`로도 지워지지 않습니다. `wallet_items`에서 `file_url`(= `'wallet'` 버킷 안의 경로)을 먼저
   읽고, 그 경로들을 Storage에서 지운 뒤 행 자체를 지웁니다.
2. **`expenses`** (`created_by` = 나) — 내가 기록한 지출. 내가 owner가 아닌 여행에 남긴 지출도 포함해서
   전부 지웁니다.
3. **`schedule_items`** (`created_by` = 나) — 내가 등록한 일정. 2번과 같은 이유로 trip 소유 여부로 범위를
   가리지 않습니다.
4. **`trip_members`** (`user_id` = 나, "본인이 속한") — 내가 속한 모든 여행에서의 멤버십(소유한 여행이든
   참여만 한 여행이든 전부) — "여행 나가기"를 모든 여행에 대해 한 번에 하는 것과 같습니다.
5. **`trips`** (`owner_id` = 나인 것만) — 내가 만든 여행 자체를 지웁니다. 공유 여행(내가 참여자일 뿐인
   여행)은 4번에서 내 멤버십만 빠지고 여행 자체는 그대로 남습니다. 이 단계는 내가 owner인 여행에 다른
   멤버가 남긴 `schedule_items`/`expenses`/`trip_members`/`trip_invites`까지 `trip_id`의
   `on delete cascade`로 함께 지웁니다 — 이미 있는 "여행 삭제"(`storage.js#deleteTrip`)와 정확히 같은
   범위입니다.
6. **`trip_invites`** (`created_by` = 나, "본인이 만든") — RLS상 초대는 owner만 만들 수 있어서 보통은
   5번의 `trip_id` cascade로 이미 다 지워져 있습니다 — 혹시 남은 게 있으면 마저 지웁니다(멱등 — 없는
   행을 지워도 오류가 아닙니다).
7. **`user_consents`** (`user_id` = 나) — 약관 동의 기록.
8. **`device_tokens`** (`user_id` = 나) — 이 계정이 등록해 둔 모든 기기의 푸시 토큰(안드로이드 FCM 토큰 +
   웹 구독 정보).
9. **`notification_settings`** (`user_id` = 나) — 알림 종류별 on/off 설정.
10. **`notifications`** (`user_id` = 나) — 인앱 알림 발송 기록.
11. **`notification_log`** (`user_id` = 나) — 중복 발송 방지 로그.
12. **`auth.admin.deleteUser(나)`** — Auth 계정 자체를 지웁니다. 1~11번을 이미 다 지웠으므로 이 시점엔
    외래키 제약에 걸릴 행이 없어야 정상입니다.

## 트랜잭션이 아닙니다 — 그리고 그래도 안전한 이유

이 12단계는 하나의 Postgres 트랜잭션으로 묶여 있지 않습니다(그렇게 하려면 이 모든 작업을 수행하는 Postgres
함수(RPC)를 따로 만들어야 하는데, 이번 요청 범위에서는 만들지 않았습니다). 그래서 중간 단계가 실패하면 그
앞 단계까지는 이미 지워진 채로 멈출 수 있습니다.

다만 모든 단계가 `WHERE ... = 나`라서 **다시 호출해도 안전합니다** — 이미 지워진 행은 0건 매치로 조용히
넘어갑니다. 즉 실패했을 때 복구 방법은 "다시 시도"이고, 안내 메시지가 고객센터로 문의하라고 하는 것도
재시도로 해결되지 않을 만큼 깊은 문제(예: 예상 못 한 외래키 제약, 권한 문제 등)는 사람이 봐야 하기
때문입니다.

## `ON DELETE CASCADE`로도 같은 결과가 나오도록 스키마도 맞췄습니다

`011_delete_account_cascades.sql`이 `trips.owner_id`/`schedule_items.created_by`/`expenses.created_by`/
`trip_invites.created_by`의 `on delete` 규칙을 `cascade`로 바꿔 둡니다. `device_tokens`/
`notification_settings`/`notifications`/`notification_log` 네 테이블은 `031_push_notifications.sql`이
처음부터 `auth.users`에 `on delete cascade`로 선언해 뒀습니다(뒤늦게 추가된 안전망이 아니라 설계
시점부터 cascade였다는 차이만 있습니다). 이 함수가 위 1~11번을 이미 명시적으로 먼저 지우므로
12번(`deleteUser`) 시점엔 사실 아무것도 안 걸리지만, 이 cascade들은 **안전망**입니다:

- 혹시 위 단계 중 하나가 코드 변경으로 빠지거나, 경쟁 상태로 그 사이 새 행이 생겨도 `deleteUser` 자체가
  외래키 오류 없이 끝납니다.
- 이 함수를 거치지 않고(예: Supabase 대시보드에서) 직접 `deleteUser`를 불러도 같은 범위로 정리됩니다.

**이 마이그레이션을 먼저 실행하지 않아도 이 함수 자체는 정상 동작합니다** — 1~7번에서 이미 명시적으로
지우기 때문입니다. 다만 "로직을 단순화"하고 스키마를 일관되게 맞추기 위해 함께 실행하는 것을 권장합니다.

## naver-login과 같은 이유로 import를 씁니다

`analyze-ticket`/`analyze-trip-import`는 "Deno, no imports"가 원칙이지만, 이 함수는 `naver-login`과 같은
이유로 공식 SDK(`@supabase/supabase-js`)를 씁니다: Admin API(사용자 삭제)와 Storage 관리자 작업을 raw REST로
손수 구현하는 것보다 안전하고(서명·에러 형식을 SDK가 맞춰 줌) 코드도 짧습니다. `naver-login`과 같은 버전
(`https://esm.sh/@supabase/supabase-js@2.45.4`)으로 고정해 둡니다.

## 배포 (터미널에서 직접)

```bash
# 1) 프로젝트 연결 (이미 다른 함수를 배포했다면 생략)
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로 넣어주므로
# 따로 설정할 비밀값이 없습니다.

# 2) (권장) 011_delete_account_cascades.sql을 SQL Editor에서 먼저 실행합니다 — 위 "안전망" 설명 참고.
#    먼저 실행하지 않아도 이 함수 자체는 동작하지만, 함께 실행하는 것을 권장합니다.

# 3) 배포 (이 함수는 반드시 로그인한 사용자의 토큰으로만 불러야 하므로 --no-verify-jwt를 붙이지 않습니다 —
#    기본값(JWT 검증 켜짐) 그대로 둡니다. getCallerId()가 role 클레임을 다시 확인하는 것은 "로그인은
#    했지만 과연 본인이 맞는가"가 아니라 "애초에 로그인 토큰인가(anon 키가 아닌가)"를 가리기 위함입니다.)
supabase functions deploy delete-account
```

- 로그 보기: Supabase 대시보드 → Edge Functions → delete-account → Logs (토큰·service_role 키는 남기지 않습니다. 실패한 단계 이름은 여기서 확인합니다).

## 배포 후 테스트 (curl)

⚠️ **실제 계정으로 테스트하면 그 계정이 정말로 삭제됩니다.** 테스트 전용 계정(소셜 로그인으로 새로 하나
만들어서)으로만 시도하세요.

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>

# ① 로그인 토큰 없이: 401
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/delete-account" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"

# ② 테스트 계정으로 로그인한 뒤 그 access_token으로: {}가 오면 성공(그 계정은 삭제되었습니다)
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/delete-account" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer <테스트 계정의 access_token>"
```

access_token은 브라우저 콘솔에서 `(await TripLog.supabase.auth.getSession()).data.session.access_token`으로
확인할 수 있습니다(테스트 계정으로 로그인한 상태에서).

## 앱에서 부르는 방법 (연결되어 있음)

`triplog/js/accountDeletePage.js`의 최종 확인 다이얼로그("탈퇴하기")가 부릅니다:

```js
const { data, error } = await TripLog.supabase.functions.invoke("delete-account");
if (error || data?.error) {
  // 실패: 원인과 무관하게 "탈퇴 처리 중 문제가 발생했습니다. 고객센터로 문의해주세요."만 보여주고
  // 확인 다이얼로그는 열어 둔다(재시도 가능하게). 실제 원인은 console.warn으로만 남긴다.
} else {
  // 성공: supabase.auth.signOut() 후 #/login으로 이동 (계정이 이미 없어졌으므로 세션도 정리해야 한다)
}
```
