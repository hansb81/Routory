# airport-congestion (Supabase Edge Function)

국내 공항 중 공식 실시간 혼잡도 공개데이터(data.go.kr)가 있는 공항에 한해서만 그 값을 가져옵니다.
지금은 인천공항(ICN)만 지원 목록에 있습니다 — 나머지 국내 공항과 모든 해외 공항은 `available: false`만 돌려주고,
`triplog/js/myTripPage.js`는 이 응답을 받으면 "공항 혼잡도" 카드를 화면에서 완전히 지웁니다(숨김).

## ⚠️ 배포 전에 꼭 읽어주세요 (data.go.kr 엔드포인트 미검증)

인천국제공항공사의 "출국장 혼잡도 조회" Open API(https://www.data.go.kr/data/15148225/openapi.do)는
실제 요청 URL·파라미터·응답 필드가 담긴 활용가이드(.docx)가 **그 API를 신청해서 승인받은 계정에서만**
열람할 수 있어서, 이 함수의 `index.ts` 안 `fetchIncheonCongestion`/`parseIncheonResponse`는 확인된 실제
응답이 아니라 data.go.kr 플랫폼의 공통 관례(요청 파라미터 `serviceKey`·`type=json`, 응답
`response.body.items.item[]` envelope)만 근거로 한 최선의 추정치입니다.

**그래서 이 함수는 `DATA_GO_KR_SERVICE_KEY`/`INCHEON_CONGESTION_API_URL` 비밀값을 설정하지 않으면
네트워크 호출 자체를 하지 않고 바로 `available:false`만 돌려주도록 만들어 뒀습니다** — 즉 지금 바로
배포해도 안전합니다(카드가 그냥 계속 숨겨질 뿐, 틀린 값을 보여주지 않습니다). 실제로 켜려면:

1. https://www.data.go.kr/data/15148225/openapi.do 에서 "활용신청" → 승인 후 마이페이지에서
   "일반 인증키(Encoding)"를 받습니다.
2. 승인된 신청 목록의 "상세설명"/Swagger 문서에서 **실제 요청 URL(엔드포인트)**을 확인합니다.
3. 그 URL로 직접(curl 등) 한 번 호출해서 **진짜 응답 JSON**을 받아 보고, `response.body.items.item[]`
   안의 실제 필드 이름(대기 인원/시간, 혼잡도 등급 등)을 확인합니다.
4. `index.ts`의 `pickNumber(item, [...])` 후보 필드 이름 목록을 3번에서 확인한 실제 이름으로 고칩니다
   (지금은 `waitTime`/`waitingTime`/`avgWaitTime`/`estimateWaitTime`, `waitPersonNum`/`watingPersonNum`/
   `waitingNum`/`standbyNum` 같은 추정 후보만 들어 있습니다).
5. 아래 배포 단계에서 두 비밀값을 설정합니다.

## 요청과 응답

`POST /functions/v1/airport-congestion`

```json
{ "airportCode": "ICN" }
```

- `Authorization: Bearer <로그인한 사용자의 access_token>`이 필요합니다.

성공(데이터 있음):

```json
{ "available": true, "level": "보통", "waitMinutes": 12, "fetchedAt": "2026-09-30T09:00:00.000Z" }
```

성공(데이터 없음 — 지원하지 않는 공항, 비밀값 미설정, 실시간 조회 실패 모두 이 형태이고 **HTTP 200**입니다):

```json
{ "available": false }
```

그 밖: `401` 로그인 필요, `400` `airportCode` 형식 오류, `405` POST가 아님.

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 위 "배포 전에 꼭 읽어주세요"를 아직 안 끝냈다면 이 두 줄은 생략해도 됩니다(그래도 안전하게 배포됩니다)
supabase secrets set DATA_GO_KR_SERVICE_KEY=<공공데이터포털 인증키>
supabase secrets set INCHEON_CONGESTION_API_URL=<확인한 실제 엔드포인트 URL>

supabase functions deploy airport-congestion
```

## 앱에서 부르는 방법 (연결되어 있음)

```js
const { data, error } = await TripLog.supabase.functions.invoke("airport-congestion", {
  body: { airportCode: "ICN" },
});
// error가 있거나 data.available !== true면 카드를 그대로 숨긴다
```

`myTripPage.js`의 `hydrateAirportCongestionCard`가 이 방식으로 호출합니다.
