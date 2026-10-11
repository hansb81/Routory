# travel-briefing (Supabase Edge Function)

목적지·여행 기간을 받아서 Google Gemini(구글 검색 도구)로 최신 여행자 뉴스와 할인/프로모션 정보를 찾아
JSON으로 돌려줍니다. 같은 목적지+기간 조합은 하루(24시간) 한 번만 새로 부르고, 나머지는
`briefing_cache` 테이블(`supabase/migrations/009_travel_briefing.sql`)에 저장해 둔 결과를 그대로 돌려줍니다.

## 요청과 응답

`POST /functions/v1/travel-briefing`

```json
{ "destination": "도쿄, 일본", "startDate": "2026-10-10", "endDate": "2026-10-13" }
```

- `destination`: 여행지 문자열(트립의 `destination` 그대로, 예: "도쿄, 일본"). 비어 있으면 안 됩니다.
- `startDate`/`endDate`: `YYYY-MM-DD`. `startDate`는 `endDate`보다 뒤일 수 없습니다.
- `Authorization: Bearer <로그인한 사용자의 access_token>`이 필요합니다. 앱에 공개된 anon 키만으로는 401이 납니다.

성공하면:

```json
{
  "news": [
    { "title": "도쿄 지하철 요금 인상", "summary": "다음 달부터 도쿄 지하철 요금이 인상됩니다.", "sourceUrl": "https://example.com/news1", "sourceName": "요미우리신문" }
  ],
  "deals": [
    { "title": "도쿄행 항공권 15% 할인", "summary": "얼리버드 프로모션이 진행 중입니다.", "sourceUrl": "https://example.com/deal1", "sourceName": "Klook" }
  ],
  "fetchedAt": "2026-09-30T08:43:23.482Z",
  "cached": true,
  "stale": false
}
```

- `news`/`deals`는 각각 최대 5개. 출처 링크(`sourceUrl`)를 못 찾은 항목은 통째로 빠집니다(URL을 지어내지 않습니다). 둘 다 빈 배열일 수 있습니다(뉴스·할인 정보가 없으면 정상적인 성공 응답입니다).
- `cached`: `true`면 24시간 안에 이미 만들어 둔 캐시를 그대로 돌려준 것(Gemini를 새로 부르지 않았습니다).
- `stale`: `true`면 새로 부르려다 실패해서, 24시간이 지난 예전 캐시를 대신 돌려준 것입니다. 클라이언트는 이 경우 "갱신 실패" 같은 안내를 붙이는 게 좋습니다.

실패하면 (Gemini 오류, 요청 한도 초과 모두 **HTTP 200**. 캐시가 있으면 실패 대신 `stale:true`로 그 캐시를 돌려주고, 캐시도 없을 때만 이 실패가 옵니다):

```json
{ "error": "최신 정보를 가져오지 못했어요" }
```

그 밖의 상태: `401` 로그인 필요, `400` 요청 형식 오류(목적지 없음, 날짜 형식 이상), `405` POST가 아님.

## 배포 (터미널에서 직접)

```bash
# 1) 프로젝트 연결 (처음 한 번, analyze-ticket 등을 이미 배포했다면 생략)
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 2) briefing_cache 테이블 만들기 (Supabase 대시보드 → SQL Editor에 009_travel_briefing.sql 내용을 붙여넣고 실행)

# 3) Gemini API 키 - analyze-ticket과 같은 값을 이미 설정해 뒀다면 이 단계는 생략해도 됩니다
supabase secrets set GEMINI_API_KEY=<발급받은 Gemini API 키>

# 4) 배포 (--no-verify-jwt는 붙이지 마세요: 로그인 확인이 꺼집니다)
supabase functions deploy travel-briefing
```

- `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 모든 Edge Function에 자동으로 넣어주는 값이라 따로 설정하지 않습니다.
- 모델이 막히거나 바뀌면 코드를 고치지 않고 비밀값만 바꿀 수 있습니다(analyze-ticket과 같은 비밀값 이름을 공유합니다).
  `supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview`
- 로그 보기: Supabase 대시보드 → Edge Functions → travel-briefing → Logs.

## 배포 후 테스트 (curl)

준비물: 로그인한 사용자의 토큰.

- 토큰은 앱(https://triplog-nu.vercel.app)에 로그인한 탭의 개발자 도구 콘솔에서 얻습니다.
  ```js
  (await TripLog.supabase.auth.getSession()).data.session.access_token
  ```
- anon 키는 `triplog/js/supabaseClient.js`에 있는 값입니다.

### Git Bash / macOS / Linux

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>
export TOKEN=<위에서 복사한 access_token>

# ① 정상 호출: 뉴스·할인 정보 JSON이 와야 합니다 (처음 호출이라 cached:false여야 정상)
curl -sS -X POST "$SUPABASE_URL/functions/v1/travel-briefing" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"destination":"도쿄, 일본","startDate":"2026-10-10","endDate":"2026-10-13"}'

# ② 같은 요청을 바로 다시: cached:true(같은 fetchedAt)가 와야 합니다 - 하루 한 번만 새로 부른다는 캐싱 확인
curl -sS -X POST "$SUPABASE_URL/functions/v1/travel-briefing" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"destination":"도쿄, 일본","startDate":"2026-10-10","endDate":"2026-10-13"}'

# ③ 로그인 없이(anon 키만) 호출: 401 {"error":"로그인이 필요해요"}가 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/travel-briefing" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"destination":"도쿄, 일본","startDate":"2026-10-10","endDate":"2026-10-13"}'

# ④ 잘못된 요청: 400이 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/travel-briefing" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"destination":"","startDate":"2026-10-10","endDate":"2026-10-13"}'
```

캐시를 다시 비우고 테스트하려면 Supabase 대시보드 → Table Editor → `briefing_cache`에서 해당 행을 지우거나,
SQL Editor에서 `delete from public.briefing_cache;`를 실행하세요.

### PowerShell (Windows)

```powershell
$env:SUPABASE_URL = "https://ffzjgiknrrgwvgobybdq.supabase.co"
$env:ANON_KEY = "<anon 키>"
$env:TOKEN = "<위에서 복사한 access_token>"

$body = '{"destination":"도쿄, 일본","startDate":"2026-10-10","endDate":"2026-10-13"}'
curl.exe -sS -X POST "$env:SUPABASE_URL/functions/v1/travel-briefing" `
  -H "apikey: $env:ANON_KEY" `
  -H "Authorization: Bearer $env:TOKEN" `
  -H "Content-Type: application/json" `
  -d $body
```

## 앱에서 부르는 방법 (연결되어 있음)

```js
const { data, error } = await TripLog.supabase.functions.invoke("travel-briefing", {
  body: { destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate },
});
// error가 있거나 data.error가 있으면 현지 뉴스/할인 정보 카드에 실패 문구를 보여준다
```

`triplog/js/myTripPage.js`의 `hydrateNewsCard`/`hydrateDiscountCard`가 이 방식으로 호출하고, 결과를 "여행 전"
단계의 현지 뉴스·할인 정보 카드에 출처 링크와 함께 채웁니다. 로그인한 상태여야 호출됩니다.
