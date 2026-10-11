# naver-login (Supabase Edge Function)

네이버 OAuth2.0 인가 코드를 Supabase 로그인에 쓸 수 있는 토큰으로 바꿔줍니다. Supabase의 소셜 로그인 제공자
목록에 네이버가 없어서(`triplog/js/loginPage.js`가 `supabase.auth.signInWithOAuth` 대신 네이버 인가 URL을
직접 여는 이유), 인가 코드 교환 → 프로필 조회 → 계정 연결(없으면 생성) → 로그인 토큰 발급까지 이 함수가 대신
합니다.

**이 함수는 세션을 직접 만들지 않습니다.** 응답으로 `hashedToken` 하나만 돌려주고, 그 토큰을 실제 로그인
세션으로 바꾸는 마지막 단계(`supabase.auth.verifyOtp`)는 클라이언트가 합니다.

## 요청과 응답

`POST /functions/v1/naver-login`

```json
{ "code": "<네이버가 돌려준 인가 코드>", "state": "<인가 요청 때 실었던 state 값>" }
```

- `code`/`state`는 `triplog/auth/naver-callback.html`이 네이버에서 돌아온 주소의 쿼리스트링(`?code=&state=`)을
  그대로 옮겨 보냅니다. `state`가 로그인을 시작할 때 저장해 둔 값과 맞는지는 그 페이지가 먼저 확인합니다(CSRF) —
  이 함수는 그 값을 그대로 네이버 토큰 요청에 실어 보내기만 합니다(네이버 쪽에서도 한 번 더 대조합니다).
- 다른 두 함수(`analyze-ticket`, `analyze-trip-import`)와 달리 `Authorization`에 로그인한 사용자의
  `access_token`이 필요하지 않습니다 — 애초에 로그인하는 과정이라 아직 세션이 없습니다. 앱에 공개된 anon 키만
  으로 호출합니다(`TripLog.supabase.functions.invoke`가 항상 그렇게 보냅니다).

성공하면:

```json
{ "hashedToken": "pkce_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

클라이언트는 이 값으로 세션을 만듭니다:

```js
const { data, error } = await TripLog.supabase.auth.verifyOtp({ token_hash: hashedToken, type: "magiclink" });
// 성공하면 data.session이 생기고, onAuthStateChange(SIGNED_IN)이 앱의 나머지 부분(app.js#auth.onChange)을 깨운다
```

`token_hash`(=`hashedToken`)만으로 확인하는 방식이라 `email`이 필요 없습니다 — 그래서 이 함수가 내부적으로
만드는 이메일(아래 4번)이 클라이언트 응답에도, `verifyOtp` 호출에도 전혀 등장하지 않습니다.

실패하면 상태 코드로 원인을 구분합니다 (모두 `{ "error": "<한국어 메시지>" }`):

| 상태 | 원인 |
| --- | --- |
| 400 | `code`/`state`가 없거나 형식이 이상함 |
| 401 | 네이버가 인가 코드를 거절함(만료·재사용·`state` 불일치 등) |
| 405 | POST가 아님 |
| 500 | 이 함수의 설정(비밀값) 또는 Supabase Admin API(사용자 생성·토큰 발급) 실패 |
| 502 | 네이버 서버와 통신하지 못함(네트워크 오류 등) |

## 동작 순서 (코드의 1~7번 주석과 대응)

1. 클라이언트가 보낸 `{ code, state }`를 읽고 형식을 확인합니다.
2. `POST https://nid.naver.com/oauth2.0/token`에 `grant_type=authorization_code`, `client_id`, `client_secret`,
   `code`, `state`를 실어 액세스 토큰을 받습니다. `client_secret`은 비밀값 `NAVER_CLIENT_SECRET`에서만 읽고,
   클라이언트 코드(`triplog/js/config.js` 등)에는 절대 넣지 않습니다.
3. 받은 액세스 토큰으로 `GET https://openapi.naver.com/v1/nid/me`를 불러 `id`/`email`/`nickname`/
   `profile_image`를 받습니다.
4. 네이버 이메일은 없을 수도, 있어도 인증된 값이 아닐 수도 있어서(제공 동의만 하면 되는 값) Supabase 계정을
   구분하는 값으로 쓰지 않습니다. 대신 네이버가 보장하는 고유값인 `id`로 `naver_<네이버id>@users.triplog.app`
   형태의 내부용 이메일을 만들어 계정 식별자로 씁니다. 실제 네이버 이메일은 `user_metadata.naver_email`에
   참고용으로만 남습니다.
5. 그 이메일의 Supabase 사용자가 있는지 확인하고(있으면 그대로 씀), 없으면
   `admin.createUser({ email, email_confirm: true, user_metadata: { provider: "naver", naver_id, nickname,
   avatar_url, naver_email } })`로 만듭니다. 확인 단계가 (드물게) 있는 사용자를 놓쳐도 `createUser`가 "이미
   등록된 이메일" 오류를 돌려주면 그 계정을 있는 것으로 취급합니다 — 계정이 두 번 만들어지지 않습니다.
6. `admin.generateLink({ type: "magiclink", email })`로 로그인용 토큰을 받아, 그 안의 `properties.hashed_token`
   값만 꺼냅니다. 실제로 메일을 보내는 게 아니라 토큰만 발급받는 용도로 씁니다.
7. `hashedToken`만 클라이언트에 돌려줍니다. `service_role` 키·`NAVER_CLIENT_SECRET`·네이버 액세스 토큰·내부용
   이메일은 이 함수 밖으로 절대 나가지 않습니다(로그에도 남기지 않습니다).

## 다른 두 함수와 다른 점: import를 씁니다

`analyze-ticket`/`analyze-trip-import`는 "Deno, no imports"가 원칙이지만, 이 함수는 사용자 조회·생성·로그인
토큰 발급(Supabase Auth Admin API)에 공식 SDK(`@supabase/supabase-js`)를 씁니다. 이 API를 raw REST로 직접
구현하는 것보다 안전하고(서명·에러 형식을 SDK가 맞춰 줌) 코드도 짧습니다. `https://esm.sh/@supabase/supabase-js@2.45.4`
처럼 버전을 고정해 둡니다(예고 없이 동작이 바뀌지 않도록) — 올릴 때는 이 버전 문자열만 바꾸면 됩니다.

## 배포 (터미널에서 직접)

```bash
# 1) 프로젝트 연결 (이미 다른 함수를 배포했다면 생략)
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 2) 네이버 Client ID/Secret을 비밀값으로 저장 (코드에는 절대 쓰지 않습니다)
#    Client ID는 triplog/js/config.js의 naverClientId와 반드시 같은 값이어야 합니다.
supabase secrets set NAVER_CLIENT_ID=<네이버 디벨로퍼스 Client ID>
supabase secrets set NAVER_CLIENT_SECRET=<네이버 디벨로퍼스 Client Secret>

# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로 넣어주므로
# 따로 설정하지 않습니다.

# 3) 배포 (--no-verify-jwt는 붙이지 마세요: 이 함수는 로그인한 사용자의 토큰이 아니라 항상 anon 키로 호출되지만,
#    verify_jwt 자체는 "서명이 유효한 프로젝트 키(anon도 포함)인지"만 확인하므로 꺼도 되는 이유가 없습니다.)
supabase functions deploy naver-login
```

- 네이버 디벨로퍼스 → 애플리케이션 등록 정보에서 이 앱을 여는 모든 주소를 "서비스 URL"에, 그 주소마다
  `/auth/naver-callback`을 "Callback URL"에 등록해야 합니다(예: `http://localhost:8080/auth/naver-callback`,
  `https://triplog-nu.vercel.app/auth/naver-callback`) — `triplog/js/config.js`의 `naverClientId` 주석 참고.
- 로그 보기: Supabase 대시보드 → Edge Functions → naver-login → Logs (액세스 토큰·시크릿·이메일은 남기지 않습니다).

## 배포 후 테스트 (curl)

실제 네이버 로그인 없이도 요청 형식 검증과 오류 처리는 확인할 수 있습니다. 진짜 `code`는 브라우저로 네이버
로그인 화면을 한 번 통과해야만 얻을 수 있고(1회용, 금방 만료됩니다), 그 값을 얻는 순간 이미
`triplog/auth/naver-callback.html`에 도착해 있으므로 거기서 직접 이 함수를 호출해 보는 편이 더 쉽습니다.

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>

# ① code/state 없음: 400
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/naver-login" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

# ② 가짜 code/state: 네이버가 거절해서 401이 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/naver-login" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"fake","state":"fake"}'

# ③ 진짜 code/state (네이버 로그인 화면을 한 번 통과해 얻은 값, 금방 만료됨): hashedToken이 와야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/naver-login" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"<실제 code>","state":"<실제 state>"}'
```

anon 키는 `triplog/js/supabaseClient.js`에 있는 값입니다.

## 앱에서 부르는 방법 (연결되어 있음)

`triplog/auth/naver-callback.html`이 `state`를 확인한 뒤 이 함수를 부릅니다:

```js
const { data, error } = await supabase.functions.invoke("naver-login", { body: { code, state } });
if (error || data?.error || !data?.hashedToken) {
  // 실패: /#/login?error=...&error_description=...으로 돌려보낸다 (loginPage.js가 그 값을 보여준다)
} else {
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "email", token_hash: data.hashedToken });
  // 성공하면 /#/main으로 이동한다 — verifyOtp가 만든 세션은 localStorage에 남아서, 그 페이지가 새로 여는
  // TripLog.supabase 클라이언트(index.html의 supabaseClient.js)가 그대로 이어받는다.
}
```

이 페이지는 SPA(`index.html`) 밖의 독립된 정적 페이지라 `window.TripLog.supabase`를 쓸 수 없어서, 같은
프로젝트 URL/anon 키로 자신만의 supabase-js 클라이언트를 새로 만듭니다(`detectSessionInUrl: false` —
이 페이지 주소의 `?code=`는 네이버 인가 코드지 Supabase의 PKCE code가 아니라서, supabase-js가 그 값으로
자기 나름의 세션 교환을 시도하지 않게 막습니다). 전체 흐름은 **CLAUDE.md**의 **Login page** 항목 참고.
