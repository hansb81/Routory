# refresh-city-weather (Supabase Edge Function)

pg_cron이 6시간마다 부르는 날씨 캐시 갱신 함수입니다. `discover_cities`(027_discover_cities.sql, '어디로
떠나볼까요' 도시 카드)의 활성 도시들을 `city_weather_cache`에 채워 둡니다 — 카드를 보는 사용자가 직접
날씨 API를 부르지 않도록 서버가 미리 받아 둡니다.

**이 저장소에는 아직 "푸시 알림" 기능이 없습니다** (검색해 봐도 push/FCM/APNs 관련 코드가 전혀 없습니다).
그래서 "푸시 알림 때 쓴 것과 같은 방식의 시크릿 헤더/스케줄"에 해당하는 기존 선례는
`collect-travel-feed`(025/026, 외교부·TourAPI 자동 수집)뿐입니다 — 이 함수는 그 패턴을 그대로 따랐습니다:
사람이 아니라 pg_cron(서버 대 서버)만 부르고, `Authorization` JWT 대신 고정 공유 비밀값 헤더
(`x-cron-secret`)로 막습니다.

## 요청과 응답

`POST /functions/v1/refresh-city-weather` (본문 없음)

- `x-cron-secret: <CRON_SECRET 비밀값과 같은 값>` 헤더가 필요합니다. 없거나 틀리면 401.
- `Authorization`/`apikey`는 보지 않습니다 — 다만 Supabase 게이트웨이가 모든 함수에 유효한 `apikey`
  헤더(anon 키로 충분)를 요구하니, curl로 테스트할 때는 여전히 같이 보내야 합니다.

성공하면 (일부 도시/배치가 실패해도 200 — 개수만 다름):

```json
{ "success": 25, "failed": 1, "skippedUnresolved": 1, "total": 27 }
```

- `success`: 이번에 `city_weather_cache`에 새로 upsert한 도시 수.
- `failed`: Open-Meteo 응답이 비정상이었거나(그 도시만) 배치 호출/upsert 자체가 실패한(그 배치 전체)
  도시 수 — **이 도시들의 기존 캐시 값은 건드리지 않습니다**(요청 4번). 어떤 도시였는지는 응답/로그 어디에도
  남기지 않고 개수만 남깁니다.
- `skippedUnresolved`: `destinations.lat`/`lng`가 아직 없는(좌표 미확정) 활성 도시 수 — 요청 자체를
  안 보내고 건너뛴 개수입니다(요청 6번).
- 그 밖의 상태: `401` 시크릿 헤더 없음/틀림, `405` POST가 아님, `500` 서버 설정 누락 또는
  `discover_cities` 조회 실패.

## 여러 도시를 한 번에 (배치)

Open-Meteo Forecast API는 `latitude`/`longitude`에 좌표를 쉼표로 여러 개 넣으면 한 번의 호출로 위치별
결과 리스트를 돌려줍니다(단계 0 조사) — 도시 수만큼 개별 호출하지 않습니다. 다만 "한 번에 몇 개까지"
묶을 수 있는지 공식 상한이 문서에 없어서, `index.ts`의 `BATCH_SIZE`(기본 50)만큼씩 나눠 호출합니다 — 한
배치가 실패해도 다른 배치는 그대로 처리됩니다. 지금처럼 활성 도시가 수십 개 수준이면 보통 배치 1개로
끝납니다.

## ⚠️ Open-Meteo 라이선스 관련 플래그

무료 API는 공식 문서상 "비상업적 용도"로 한정돼 있습니다(CC BY 4.0, 상업적 이용엔 유료 구독 필요) — 이
저장소는 서비스형 앱이라 그 경계에 해당하는지 애매합니다(메인 화면 개선 논의에서 이미 한 번 플래그했고,
`myTripPage.js`의 날씨 카드도 같은 이슈를 안고 있습니다). 운영 전에 다시 확인하는 걸 권장합니다.

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# collect-travel-feed용으로 이미 CRON_SECRET을 설정해 뒀다면 이 단계는 건너뛰어도 됩니다 - 같은 이름/같은
# 값을 그대로 재사용합니다. 아직 없다면 아무 긴 임의 문자열이나 정해서 설정하세요.
supabase secrets set CRON_SECRET=<임의의 긴 문자열>

# 로그인한 사용자가 아니라 pg_cron이 부르므로 JWT 검증을 끕니다
supabase functions deploy refresh-city-weather --no-verify-jwt
```

`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 모든 Edge Function에 자동으로 넣어줍니다. 로그 보기:
Supabase 대시보드 → Edge Functions → refresh-city-weather → Logs.

pg_cron 스케줄은 `supabase/migrations/028_refresh_city_weather_cron.sql`에서 설정합니다 — 그 파일을 SQL
Editor에서 실행하기 전에, 위에서 정한 `CRON_SECRET`과 **완전히 같은 값**을 그 파일의 플레이스홀더 자리에
채워 넣으세요(두 군데 손으로 맞추는 값이라 자동으로 공유되지 않습니다 — collect-travel-feed와 같은 값을
썼다면 025_collect_travel_feed_cron.sql에 이미 넣은 값을 그대로 복사하면 됩니다).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키 - triplog/js/supabaseClient.js 참고>
export CRON_SECRET=<supabase secrets set으로 넣은 값>

# ① 정상 호출: success/failed/skippedUnresolved/total이 와야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/refresh-city-weather" \
  -H "apikey: $ANON_KEY" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json"

# ② 시크릿 헤더 없이: 401이 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/refresh-city-weather" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json"
```

캐시된 값은 Supabase 대시보드 → Table Editor → `city_weather_cache`에서 바로 확인할 수 있습니다.
