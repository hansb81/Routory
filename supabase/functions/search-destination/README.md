# search-destination (Supabase Edge Function)

여행지(도시) 검색 + 선택 확정을 한 함수에서 처리합니다 (PRD v12 — 여행지 확장·도시 검색).

- **검색**: `destinations` 테이블(프리셋 + 전에 저장된 사용자 검색 도시) 부분일치 → 부족하면 Google Places
  Autocomplete (New) → 그것도 실패하면 Open-Meteo Geocoding. 나라 이름을 검색하면 그 나라의 프리셋 도시를
  먼저 채우고, 부족하면 "[나라] 주요 도시"로 한 번 더 찾습니다.
- **선택 확정**(`action: "select"`): 좌표(lat/lng)·시간대(IANA)·통화·지역을 이 시점에 확정해서
  `destinations`에 저장합니다. 이미 확정된 행(프리셋 대부분, `014_destinations.sql`+`016_...sql` 실행 후)은
  외부 호출 없이 그대로 돌려줍니다.

## 필요한 것

- 마이그레이션 `014_destinations.sql`, `015_destinations_unknown_country.sql`,
  `016_destinations_preset_coords.sql`을 (이 순서로) 먼저 실행해 둘 것.
- 비밀값: `GOOGLE_PLACES_API_KEY` — **서버용** Google API 키 (Places API (New) 활성화, HTTP 리퍼러 제한
  없이 발급). `triplog/js/googleMaps.js`가 쓰는 브라우저용 키(도메인 리퍼러 제한)와는 다른 키를 써야
  합니다 — 그 키로는 서버(Edge Function)에서 호출하면 거절됩니다.
  ```bash
  supabase secrets set GOOGLE_PLACES_API_KEY=<서버용 Google API 키>
  ```
  이 비밀값이 없으면 Google 호출을 건너뛰고 Open-Meteo Geocoding만으로 동작합니다(기능은 되지만 결과가
  적고 나라 검색 기능이 약해집니다).
- `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 자동으로 넣어줘서 따로 설정하지 않습니다.
- Google Time Zone API는 쓰지 않습니다(의도적) — 시간대는 Open-Meteo Geocoding 응답의 `timezone` 값만
  씁니다. 나중에 Google Time Zone API를 켜게 되면, 선택 확정 로직의 "시간대 보완" 부분에 호출을 추가해야
  합니다(지금은 Open-Meteo가 시간대를 못 주면 바로 `resolve_failed`).

## 요청/응답 — 검색

`POST /functions/v1/search-destination`

```json
{ "q": "체코", "lang": "ko" }
```

- `q`: 검색어. 한글은 1자 이상, 영문(그 외)은 2자 이상, 100자를 넘으면 거절(400)합니다.
- `lang`: `"ko"`(기본) 또는 `"en"`.
- `sessionToken`(선택): Google Autocomplete 세션 토큰을 직접 관리하고 싶으면 보냅니다(안 보내도 동작).

성공(200):

```json
{
  "results": [
    { "id": "<destinations.id>", "name_ko": "프라하", "name_en": "Prague", "country_code": "CZ", "country_name_ko": "체코", "lat": null, "lng": null, "timezone": null, "currency": "EUR", "place_id": null, "source": "preset", "is_preset": true }
  ],
  "degraded": true
}
```

- 최대 10개. `source`는 `"preset"`(destinations의 프리셋) / `"user"`(전에 다른 사용자가 선택해서 저장된
  도시) / `"search"`(이번 검색에서 외부 API로 막 찾아서 아직 저장 전인 도시) 중 하나. `is_preset`은
  `source === "preset"`의 축약.
- `id`는 `destinations.id` — `source`가 `"preset"`/`"user"`면 채워지고(이미 그 표에 있는 행이라서),
  `"search"`면 `null`(아직 저장 전). 선택 확정 때 `id`가 있으면 `destinationId`로 그냥 바로 쓰면 됩니다
  (가장 정확하고, 추가 조회가 없습니다) — 없을 때만 `placeId`나 `nameEn`+`countryCode`로 내려가세요.
- 프리셋/이전 사용자 도시는 좌표·시간대가 이미 있을 수도(채워진 프리셋), 없을 수도(아직 선택된 적 없는
  프리셋) 있습니다. 외부 검색(`source: "search"`) 결과는 이 단계에서 좌표·시간대가 항상 없습니다 — 선택
  확정 단계에서 채워집니다.
- `degraded: true`는 Google도 Open-Meteo도 실패해서 프리셋 결과만 돌려준 경우에만 붙습니다.

실패: `400`(검색어 형식), `401`(로그인 필요), `429`(분당 호출 상한 초과), `405`(POST 아님).

## 요청/응답 — 선택 확정

```json
{ "action": "select", "placeId": "ChIJ...", "nameKo": "오사카", "nameEn": "Osaka", "countryCode": "JP" }
```

- 프리셋/이미 저장된 도시를 골랐으면 `{ "action": "select", "destinationId": "<destinations.id>" }`만 보내면
  됩니다.
- 외부 검색 결과를 골랐으면 `placeId`(Google Autocomplete가 준 값)를 보내는 게 가장 정확합니다.
  Open-Meteo로만 찾은 결과처럼 `placeId`가 없으면 `nameEn`+`countryCode`를 보냅니다.
- `nameKo`(선택): 새 도시를 저장할 때 한국어 이름으로 쓸 값. 안 보내면 Google 응답의 이름으로 대신합니다.

성공(200):

```json
{ "result": { "id": "<destinations.id>", "name_ko": "오사카", "name_en": "Osaka", "country_code": "JP", "country_name_ko": "일본", "lat": 34.6937, "lng": 135.5023, "timezone": "Asia/Tokyo", "currency": "JPY", "place_id": "ChIJ...", "source": "user", "is_preset": false } }
```

실패: `{ "error": "resolve_failed" }` (200) — 좌표나 시간대 중 하나라도 못 얻으면 저장하지 않고 이걸
돌려줍니다. 그 밖엔 `400`(입력 부족) / `401` / `429`.

## 배포

```bash
supabase login   # 처음 한 번
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 1) 마이그레이션 3개를 SQL Editor에서 순서대로 실행 (014 → 015 → 016)

# 2) 서버용 Google API 키 설정
supabase secrets set GOOGLE_PLACES_API_KEY=<키>

# 3) 배포 (--no-verify-jwt 붙이지 말 것: 로그인 확인이 꺼진다)
supabase functions deploy search-destination
```

로그 보기: Supabase 대시보드 → Edge Functions → search-destination → Logs. 검색어 전체는 로그에 남지
않습니다(길이·언어·결과 수·쓴 소스·degraded 여부만).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>
export TOKEN=<로그인한 사용자의 access_token>

# 검색
curl -sS -X POST "$SUPABASE_URL/functions/v1/search-destination" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"q":"프라하"}'

# 프리셋 선택 확정 (destinationId는 Table Editor에서 destinations 행 id로 바꿔서)
curl -sS -X POST "$SUPABASE_URL/functions/v1/search-destination" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"select","destinationId":"<destinations.id>"}'
```

## 앱에서 부르는 방법

```js
const { data } = await TripLog.supabase.functions.invoke("search-destination", { body: { q, lang: "ko" } });
// data.results, data.degraded

const { data: picked } = await TripLog.supabase.functions.invoke("search-destination", {
  body: { action: "select", destinationId },
});
// picked.result 또는 picked.error === "resolve_failed"
```

`triplog/js/tripSetup.js`가 여행지 선택 화면(1단계)에서 이 함수의 두 액션을 모두 씁니다.

- `action:'search'`: 검색창에 입력하면(`runSearch`, 300ms 디바운스 + IME 조합 중 제외) 호출합니다. 국내
  도시는 `destinations`에 없어서 이 호출로는 안 나오지만, 클라이언트가 국내 코드 상수를 먼저 로컬로
  찾아 보여주므로 검색에서도 국내 도시가 나옵니다(`localSearchEntries`) — 그 결과와 이름이 같은 원격
  결과는 걸러냅니다.
- `action:'select'`: 탭에서 도시를 고르거나(`resolveCity`), 검색 결과를 고르면(`resolveSearchResult`)
  호출합니다(국내 도시는 호출하지 않습니다 - 기존 그대로). `destinations`가 이미 좌표·시간대를 갖고
  있으면(프리셋 70개는 `016_destinations_preset_coords.sql` 실행 후 전부 그렇습니다) 이 호출은 외부 API
  없이 바로 끝납니다.
