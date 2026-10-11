# analyze-trip-import (Supabase Edge Function)

여행 관련 자료(일정표/예약확인서/메모 — 사진·PDF 또는 텍스트)를 Google Gemini로 읽어서 새 여행(trip)·일정
(scheduleItems)·가계부(expenses) 후보를 JSON으로 돌려줍니다. PRD v8 "여행 가져오기 기능"용.

`analyze-ticket`(항공권 사진 한 장 → 항공편 정보 하나)과는 역할이 달라서 별개 함수입니다 — 한 번에 자료 하나에서
여러 일정·여러 비용 항목을 뽑아냅니다. 로그인 확인, Gemini 모델 폴백, 재시도 규칙 같은 구조는 그대로 가져왔습니다.

사진·파일·텍스트는 저장하지 않습니다. 요청 안에서 Gemini로 한 번 보내고, 응답을 돌려주면 메모리에서 사라집니다.
**이 함수 자체도 DB에 아무것도 쓰지 않습니다** — 클라이언트가 결과를 미리보기 화면에 보여주고, 사용자가
항목별로 확인·수정한 뒤 '등록하기'를 눌러야만 저장됩니다(PRD v8 5번, 자동 저장 금지).

## 요청과 응답

`POST /functions/v1/analyze-trip-import`

```json
{ "imageBase64": "<base64 문자열>", "mimeType": "image/jpeg" }
```
또는
```json
{ "text": "9/1 제주 도착, 9/2 한라산, 항공권 45,000원 ..." }
```

- `imageBase64` + `text` 둘 다 보낼 수 있습니다(둘 다 있으면 같이 분석). 둘 중 최소 하나는 있어야 합니다.
- `imageBase64`: 사진 또는 PDF를 base64로 인코딩한 문자열. `data:image/jpeg;base64,` 머리말이 붙어 있어도 됩니다.
- 선택으로 `mimeType`을 보낼 수 있습니다(이미지: `image/jpeg` 등, 파일: `application/pdf`). 없으면 base64 앞부분으로 알아냅니다.
- `text`: 최대 20,000자. 넘는 부분은 잘립니다.
- 선택으로 `tripStartDate`(`"YYYY-MM-DD"`)를 보낼 수 있습니다. append 모드(기존 여행에 더하기)에서만 클라이언트가
  그 여행의 저장된 시작일을 보냅니다 — 자료가 "1일차"/"Day 2"처럼 달력 날짜 없이 상대적으로만 날짜를 표현할 때
  Gemini가 `dayOffset`을 계산할 근거가 됩니다.
- `Authorization: Bearer <로그인한 사용자의 access_token>`이 필요합니다. 앱에 공개된 anon 키만으로는 401이 납니다.

성공하면:

```json
{
  "trip": { "title": "제주도 여행", "destination": "제주", "startDate": "2026-09-01", "endDate": "2026-09-03" },
  "scheduleItems": [
    { "date": "2026-09-01", "dayOffset": null, "time": "10:00", "category": "flight", "title": "제주 도착", "place": "제주공항", "memo": null }
  ],
  "expenses": [
    { "dayKey": "2026-09-01", "dayOffset": null, "amount": 45000, "currency": "KRW", "category": "flight", "title": "항공권" }
  ]
}
```

- `trip`은 자료 전체를 요약한 것 하나뿐입니다. 제목·여행지·시작일·종료일을 하나도 못 읽었으면 `trip`은 `null`.
- `scheduleItems`/`expenses`의 각 필드는 모르면 `null` (단, `date`/`dayKey`/`dayOffset`/`amount`가 없는 항목은
  애초에 배열에서 빠집니다 — 날짜·오프셋 없는 일정, 금액 없는 비용은 쓸모가 없어서 통째로 제외합니다. `currency`를
  못 읽으면 `"KRW"`로 기본 처리합니다).
- `scheduleItems[].category`: `flight | lodging | meal | sightseeing | shopping | etc` 중 하나, 그 밖의 값은 `null`.
- `expenses[].category`: `flight | lodging | transport | meal | shopping | tour | etc` 중 하나(가계부 기능의
  7개 카테고리와 동일), 그 밖의 값은 `null`.
- `dayKey`는 실제 날짜(`YYYY-MM-DD`) 또는 여행 준비를 뜻하는 `"prep"`.
- **`dayOffset`**: 자료가 달력 날짜 없이 "1일차"/"Day 2"/"둘째날"처럼 여행 시작일 기준 상대 표현만 쓸 때, 그
  표현을 0부터 시작하는 정수로 바꾼 값입니다(1일차/첫째날/Day 1 = `0`). 이때 `date`/`dayKey`는 `null`이 되므로,
  호출한 쪽이 실제 여행 시작일 + `dayOffset`일로 날짜를 계산해야 합니다(`triplog/js/tripImportPreview.js`의
  `resolveDayOffsets`가 이 계산을 합니다 — append면 그 여행의 저장된 시작일로, create면 사용자가 미리보기에서
  입력/수정한 시작일로, 시작일을 아직 모르면 그대로 빈 칸으로 남겨 사용자가 채우게 둡니다). 달력 날짜를 읽었거나
  유추했으면 `dayOffset`은 `null`입니다.

인식에 실패하면 (Gemini 오류, 요청 한도 초과, 여행과 무관한 자료라 아무것도 못 건진 경우 모두 **HTTP 200**):

```json
{ "error": "분석에 실패했어요. 직접 입력해주세요" }
```

그 밖의 상태: `401` 로그인 필요, `400` 요청 형식 오류(`imageBase64`/`text` 둘 다 없음, base64 아님, 약 10MB 초과), `405` POST가 아님.

## 배포 (터미널에서 직접)

```bash
# 1) 프로젝트 연결 (이미 analyze-ticket을 배포했다면 생략)
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 2) Gemini API 키는 analyze-ticket과 같은 비밀값을 그대로 씁니다 (이미 설정했다면 이 단계는 생략)
supabase secrets set GEMINI_API_KEY=<발급받은 Gemini API 키>

# 3) 배포 (--no-verify-jwt는 붙이지 마세요: 로그인 확인이 꺼집니다)
supabase functions deploy analyze-trip-import
```

- 기본 모델 목록은 `gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview` 순서로
  시도합니다. `gemini-2.5-flash`는 새로 발급한 키에서 404(단종)가 날 수 있는데(analyze-ticket에서 이미 겪은
  문제), 그 경우 자동으로 다음 모델로 넘어가므로 별도 조치가 필요 없습니다. 모델을 바꾸고 싶으면(코드 수정 없이):
  `supabase secrets set GEMINI_MODEL=gemini-2.5-flash,gemini-3.5-flash-lite,...`
  **이 비밀값은 `analyze-ticket`과 공유됩니다** — 이름이 같아서, 하나를 바꾸면 둘 다 바뀝니다. 두 함수를 다른
  모델로 쓰고 싶다면 이 비밀값 공유 구조부터 손봐야 합니다.
- 로그 보기: Supabase 대시보드 → Edge Functions → analyze-trip-import → Logs (사진·파일·텍스트·키는 남기지 않습니다).

## 배포 후 테스트 (curl)

### 텍스트로 테스트 (Git Bash / macOS / Linux)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>
export TOKEN=<로그인한 사용자의 access_token>

curl -sS -X POST "$SUPABASE_URL/functions/v1/analyze-trip-import" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"9월 1일 제주도 도착, 항공권 45000원. 9월 2일 한라산 등반."}'

# 로그인 없이(anon 키만) 호출: 401 {"error":"로그인이 필요해요"}가 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/analyze-trip-import" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"아무 텍스트"}'

# 이미지·텍스트 둘 다 없음: 400
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/analyze-trip-import" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 사진/PDF로 테스트

`analyze-ticket`의 README와 같은 방식으로 `imageBase64`에 base64로 인코딩한 파일을 넣어 보내면 됩니다
(Git Bash: `base64 -w0 파일명`, PowerShell: `[Convert]::ToBase64String(...)`).

토큰은 앱에 로그인한 탭의 개발자 도구 콘솔에서 얻습니다:
```js
(await TripLog.supabase.auth.getSession()).data.session.access_token
```
anon 키는 `triplog/js/supabaseClient.js`에 있는 값입니다.

## 앱에서 부르는 방법 (연결되어 있음)

```js
const { data, error } = await TripLog.supabase.functions.invoke("analyze-trip-import", {
  body: { imageBase64, mimeType, text }, // 필요한 것만 넣으면 된다
});
// error가 있거나 data.error가 있으면 "분석에 실패했어요. 직접 입력해주세요"를 보여주고 직접 입력하게 한다
```

`triplog/js/tripImport.js`의 `handleSubmit()`이 이 방식으로 호출합니다(모달은 MAIN 페이지의 '여행 가져오기'와
SCHEDULE 페이지의 '가져오기' 버튼에서 엽니다). 결과는 `triplog/js/tripImportPreview.js`의 미리보기·수정
화면으로 넘어가 사람이 확인·수정한 뒤, '등록하기'를 누르면 실제로 `trips`/`schedule_items`/`expenses`에
저장됩니다(새 여행이면 먼저 만들고, 기존 여행에 더하는 거면 중복으로 잡힌 항목은 update·나머지는 insert).
