# collect-travel-feed (Supabase Edge Function)

pg_cron이 매일 한 번 부르는 자동 수집 함수입니다. 사람이 로그인해서 쓰는 다른 함수와 달리 **pg_cron(서버
대 서버)만** 부르고, 고정 공유 비밀값 헤더로 막습니다. 단계 0 조사에서 "자동 수집 가능"으로 확인된 공식
API만 씁니다 — 외교부 해외안전여행(여행경보·안전공지), 한국관광공사 TourAPI(축제·행사). 인기 여행지
통계는 공식 월간 순위가 API/파일로 공개되지 않아(데이터랩 게시판 엑셀뿐) 이번에 만들지 않았습니다 —
`/admin`에서 계속 수동 입력합니다.

모든 결과는 `status='draft', origin='auto'`로만 저장됩니다. **이 함수는 published로 바꾸는 코드가 아예
없습니다** — 관리자가 `/admin`에서 검수 후 직접 게시해야 노출됩니다.

## 요청과 응답

`POST /functions/v1/collect-travel-feed` (본문 없음)

- `x-cron-secret: <CRON_SECRET 비밀값과 같은 값>` 헤더가 필요합니다. 없거나 틀리면 401.
- `Authorization`/`apikey`는 보지 않습니다(로그인한 사용자가 호출하는 함수가 아니라서요) — 다만 Supabase
  게이트웨이 자체가 모든 함수에 유효한 `apikey`(anon 키로 충분) 헤더를 요구하니, curl로 테스트할 때는
  여전히 `apikey` 헤더를 같이 보내야 합니다(아래 테스트 예시 참고).

성공하면 (한 소스가 실패해도 200 — 소스별 결과만 다름):

```json
{
  "results": [
    { "source": "mofa_alarm", "ok": true, "count": 3 },
    { "source": "mofa_safety_notice", "ok": false, "count": 0, "error": "외교부 안전공지 HTTP 404" },
    { "source": "tourapi_festival", "ok": true, "count": 5 }
  ]
}
```

- `count`: 이번 호출에서 **새로** 넣은 draft 행 수 (이미 있던 것, 즉 `(origin='auto', external_id)`가
  같은 행은 건드리지 않고 건너뜁니다 — 관리자가 이미 검토·수정했을 수 있어서입니다).
- `error`: 있으면 실패 사유 한 줄. 인증키나 요청 URL(쿼리에 서비스키가 들어있습니다)은 절대 안 담습니다.
- 그 밖의 상태: `401` 시크릿 헤더 없음/틀림, `405` POST가 아님, `500` 서버 설정 누락(`DATA_GO_KR_KEY` 등).

## ⚠️ 검증 상태 (배포 전에 꼭 읽어주세요)

- **여행경보**(`TravelAlarmService2/getTravelAlarmList2`): 엔드포인트와 필드명(`country_nm`,
  `country_iso_alp2`, `alarm_lvl`, `written_dt`)은 공식 문서 요약을 두 번 교차 확인해서 비교적 확실합니다.
- **안전공지**: 정확한 오퍼레이션 이름을 공개 검색으로 찾지 못해서, 여행경보와 같은 제공기관·네이밍
  관례로 **추정**했습니다(`CountrySafetyNoticeService2/getCountrySafetyNoticeList2`). 틀렸다면 이 소스만
  계속 실패로 기록되고(다른 두 소스는 영향 없음) draft가 하나도 안 쌓입니다 — data.go.kr에서 정확한
  엔드포인트를 확인한 뒤 `MOFA_SAFETY_NOTICE_API_URL` 비밀값으로 넣으면 코드 수정 없이 바로 고쳐집니다.
- **TourAPI 축제·행사**(`KorService2/searchFestival2`): 필드명(`title`, `contentid`, `eventstartdate`,
  `eventenddate`, `addr1`, `areacode`)은 TourAPI 전반에서 수년간 안 바뀐 표준 관례라 신뢰도가 높지만,
  실제 키로 호출해 본 적은 없습니다.
- 셋 다 `pickText()`가 후보 필드 이름 여러 개 중 먼저 맞는 것을 쓰므로, 실제 응답을 받아보고 필드 이름이
  다르면 `index.ts`의 후보 목록만 고치면 됩니다 — `airport-congestion` 함수와 같은 방식입니다.
- 실제 호출 없이 Node + `globalThis.Deno` 섀임으로 다음을 확인했습니다(다른 함수들과 같은 검증 방식):
  시크릿 헤더 없음/틀림 → 401, GET → 405, 세 소스 중 하나가 계속 실패해도 나머지 둘은 정상 처리, 실패
  메시지에 인증키 비노출, `(origin, external_id)` 중복 건너뛰기, `country_code` FK 위반 시 그 값만 비우고
  재시도, 재시도 횟수 제한(최초 1회 + 2회 = 3회에서 멈춤).

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 1) 공공데이터포털 "일반 인증키(Decoding)"를 그대로 넣습니다 - Encoding 키를 넣으면 이중 인코딩되어
#    전부 실패합니다(이 함수가 매번 encodeURIComponent로 인코딩해서 쓰기 때문입니다).
supabase secrets set DATA_GO_KR_KEY=<공공데이터포털 일반 인증키(Decoding)>
supabase secrets set DATA_GO_KR_KEY=<6fdb972999951c1ff15f34178f8009588d0adfe39c5bd1cba698151c5165ab64>
  
# 2) pg_cron이 보낼 헤더 값 - 아무 긴 임의 문자열이나 정합니다. 025_collect_travel_feed_cron.sql에도
#    "완전히 같은 값"을 넣어야 합니다(두 군데에 손으로 맞추는 값이라 자동으로 공유되지 않습니다).
supabase secrets set CRON_SECRET=<u9XmQ7vR2wzP5bK1eE8tY4cN3sA6xG0fH5jK2mL9oP3iU7yT1rE4wQ8vN0bV5cX2zZ1aA3sS>

# 3) (선택) 안전공지 엔드포인트가 추정값과 다르면 확인 후 설정
supabase secrets set MOFA_SAFETY_NOTICE_API_URL=<data.go.kr에서 확인한 정확한 요청 URL>

# 4) 배포 (이 함수는 로그인한 사용자가 아니라 pg_cron이 부르므로 JWT 검증을 끕니다)
supabase functions deploy collect-travel-feed --no-verify-jwt
```

`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 모든 Edge Function에 자동으로 넣어줍니다. 로그 보기:
Supabase 대시보드 → Edge Functions → collect-travel-feed → Logs.

pg_cron 스케줄은 이 함수가 아니라 `supabase/migrations/025_collect_travel_feed_cron.sql`에서 설정합니다 —
그 파일을 SQL Editor에서 실행하기 전에, 위 2번에서 정한 `CRON_SECRET`과 **완전히 같은 값**을 그 파일의
플레이스홀더 자리에 채워 넣으세요.

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키 - triplog/js/supabaseClient.js 참고>
export CRON_SECRET=<supabase secrets set으로 넣은 값>

# ① 정상 호출: results 배열이 와야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/collect-travel-feed" \
  -H "apikey: $ANON_KEY" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json"

# ② 시크릿 헤더 없이: 401이 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/collect-travel-feed" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json"
```

쌓인 draft는 Supabase 대시보드 → Table Editor → `travel_feed_items` (`status='draft', origin='auto'`
필터) 또는 `/admin`의 "승인 대기" 탭에서 바로 확인할 수 있습니다. 테스트로 쌓인 행을 지우려면 SQL
Editor에서 `delete from public.travel_feed_items where origin = 'auto';`.
