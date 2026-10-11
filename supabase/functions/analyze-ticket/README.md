# analyze-ticket (Supabase Edge Function)

항공권 사진(base64)을 Google Gemini로 읽어서 항공편 정보를 JSON으로 돌려줍니다.
이미지는 저장하지 않고, 요청이 끝나면 메모리에서 사라집니다.

## 요청과 응답

`POST /functions/v1/analyze-ticket`

```json
{ "imageBase64": "<base64 문자열>" }
```

- `imageBase64`: 이미지를 base64로 인코딩한 문자열입니다. `data:image/jpeg;base64,` 머리말이 붙어 있어도 됩니다.
- 선택으로 `mimeType`(`image/jpeg` 등)을 보낼 수 있습니다. 없으면 base64 앞부분으로 알아냅니다.
- `Authorization: Bearer <로그인한 사용자의 access_token>`이 필요합니다. 앱에 공개된 anon 키만으로는 401이 납니다.

성공하면 (모르는 값은 `null`). 한 장의 사진에 왕복(출국편+귀국편)처럼 서로 다른 항공편이 여러 개 있으면 `tickets`에 각각 한 항목씩 담겨 온다. 편도면 `tickets`는 항목 1개짜리 배열이다:

```json
{
  "tickets": [
    {
      "airline": "대한항공",
      "airlineCode": "KE",
      "flightNo": "KE723",
      "departureDate": "2026-10-10",
      "arrivalDate": "2026-10-10",
      "departureTime": "09:30",
      "arrivalTime": "11:10",
      "departureAirport": "SEOUL INCHEON",
      "departureAirportCode": "ICN",
      "arrivalAirport": "OSAKA KANSAI",
      "arrivalAirportCode": "KIX"
    }
  ]
}
```

인식에 실패하면 (Gemini 오류, 요청 한도 초과, 항공권이 아닌 사진 모두 **HTTP 200**):

```json
{ "error": "인식에 실패했어요. 직접 입력해주세요" }
```

그 밖의 상태: `401` 로그인 필요, `400` 요청 형식 오류(이미지 없음, base64 아님, 약 10MB 초과), `405` POST가 아님.

## 배포 (터미널에서 직접)

```bash
# 1) 프로젝트 연결 (처음 한 번)
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 2) Gemini API 키를 비밀값으로 저장 (코드에는 키를 쓰지 않습니다)
supabase secrets set GEMINI_API_KEY=<발급받은 Gemini API 키>

# 3) 배포 (--no-verify-jwt는 붙이지 마세요: 로그인 확인이 꺼집니다)
supabase functions deploy analyze-ticket
```

- 모델이 막히거나 바뀌면 코드를 고치지 않고 비밀값만 바꿀 수 있습니다. 쉼표로 여러 개를 적으면 앞에서부터 차례로 시도합니다.
  `supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview`
- 로그 보기: Supabase 대시보드 → Edge Functions → analyze-ticket → Logs (이미지와 키는 남기지 않습니다).

## 배포 후 테스트 (curl)

준비물: 시험용 항공권 사진(`ticket.jpg`)과 로그인한 사용자의 토큰.

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

# 큰 이미지는 명령줄에 직접 넣을 수 없어서 파일로 만든 뒤 @로 보냅니다 (macOS는 base64 -i ticket.jpg)
printf '{"imageBase64":"%s"}' "$(base64 -w0 ticket.jpg)" > payload.json

# ① 정상 호출: 항공편 정보 JSON이 와야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/analyze-ticket" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @payload.json

# ② 로그인 없이(anon 키만) 호출: 401 {"error":"로그인이 필요해요"}가 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/analyze-ticket" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @payload.json

# ③ 항공권이 아닌 이미지: HTTP 200 {"error":"인식에 실패했어요. 직접 입력해주세요"}가 와야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/analyze-ticket" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}'
```

### PowerShell (Windows)

```powershell
$env:SUPABASE_URL = "https://ffzjgiknrrgwvgobybdq.supabase.co"
$env:ANON_KEY = "<anon 키>"
$env:TOKEN = "<위에서 복사한 access_token>"

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\ticket.jpg"))
[IO.File]::WriteAllText("$PWD\payload.json", '{"imageBase64":"' + $b64 + '"}')   # BOM 없는 UTF-8

curl.exe -sS -X POST "$env:SUPABASE_URL/functions/v1/analyze-ticket" `
  -H "apikey: $env:ANON_KEY" `
  -H "Authorization: Bearer $env:TOKEN" `
  -H "Content-Type: application/json" `
  --data-binary "@payload.json"
```

시험이 끝나면 `payload.json`(사진이 들어 있는 파일)은 지워 주세요.

## 앱에서 부르는 방법 (연결되어 있음)

```js
const { data, error } = await TripLog.supabase.functions.invoke("analyze-ticket", {
  body: { imageBase64: state.ticket.base64, mimeType: state.ticket.mime },
});
// error가 있거나 data.error가 있으면 "인식에 실패했어요. 직접 입력해주세요"를 보여주고 직접 입력하게 한다
```

`flight.js`의 `analyzeTicket()`이 이 방식으로 호출하고, 결과로 항공사·편명 입력칸을 채웁니다. 로그인한 상태여야 호출됩니다.
