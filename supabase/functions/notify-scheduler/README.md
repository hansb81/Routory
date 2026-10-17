# notify-scheduler (Supabase Edge Function)

pg_cron이 **5분마다** 부르는 시간 기반 알림 함수입니다. 출발 임박·다음 일정 임박은 앱이 꺼져 있어도
가야 해서, 클라이언트가 아니라 서버가 주기적으로 조건을 훑습니다(PRD v11 4번). `collect-travel-feed`와
같은 이유로 사람이 로그인해서 쓰는 함수가 아니라 **pg_cron(서버 대 서버)만** 부르고, 고정 공유 비밀값
헤더(`x-notify-secret`)로만 막습니다.

## 요청과 응답

`POST /functions/v1/notify-scheduler` (본문 없음)

헤더: `x-notify-secret: <NOTIFY_SECRET 비밀값과 같은 값>` (없거나 틀리면 401)

```json
{
  "departure": { "processed": 4, "sent": 3, "skipped": 1, "calls": 2, "events": 2 },
  "schedule": { "processed": 4, "sent": 3, "skipped": 1, "calls": 2, "events": 2 }
}
```

- `processed`: 이번 실행에서 조건(날짜/시간)을 만족한 (user, trip|schedule_item) 전체 행 수.
- `sent`: 그중 실제로 처음 보낸(= `notification_log`에 새로 예약된) 행 수.
- `skipped`: 조건은 만족하지만 이미 보낸 적 있어서 건너뛴 행 수(요청 4번 중복 방지).
- `calls`: `send-notification`을 부른 횟수 — 대상 한 명마다가 아니라 트립/일정 **한 건당 한 번**만 부른다(요청 5번).
- `events`: 실제로 알림이 나간(= 수신자가 1명 이상인) 트립/일정 개수.

`401` 시크릿 없음/틀림, `405` POST가 아님, `500` 서버 설정 누락. 출발 임박/일정 임박 어느 한쪽 처리 중
오류가 나도(판별 RPC 실패 등) 다른 한쪽은 그대로 처리되고 실패한 쪽만 0으로 기록됩니다 — 항상 200.

## 판별은 SQL에 있다

`033_notify_scheduler.sql`의 두 함수(`find_departure_notify_targets()`/`find_schedule_notify_targets()`,
`rpc`로 호출)가 "누구에게 보낼지"와 "이미 보냈는지"를 **한 번의 원자적 쿼리**로 같이 처리합니다 —
`now() at time zone trips.timezone`으로 그 여행의 현지 시각을 계산하고, 같은 쿼리 안의 writable CTE로
`notification_log`에 `insert ... on conflict (user_id, kind, ref_id) do nothing`을 시도해 중복 방지까지
끝냅니다. 자세한 조건(출발 임박의 "하루 전 18:00 이후", 일정 임박의 "2시간 이하 남음")과 중복 방지
동작은 그 마이그레이션 파일과 `supabase/CLAUDE.md`를 참고하세요.

이 함수(`index.ts`)는 그 결과를 받아 `was_reserved=true`인 행만 트립/일정 단위로 묶어 `send-notification`을
부르는 "그룹핑 + 호출" 역할만 합니다 — 타임존 계산이나 중복 판정 로직은 여기 없습니다.

## 문구

- **출발 임박**: `"내일 '<여행 제목><이/가>' 시작돼요. 항공권과 준비물을 확인하세요"` — 여행 제목이
  받침 없이 끝나도(예: "하와이") 자연스럽게 "가"를 쓰도록 조사를 코드로 고릅니다(`josa()`, 한글 음절의
  종성 유무로 판정).
- **다음 일정 임박**: `"'<일정 제목 또는 장소>' 일정이 곧 시작돼요 (HH:MM)"` — 제목이 없으면 장소로,
  둘 다 없으면 "다음 일정"으로 대체합니다. "일정이"는 항상 받침 있는 "일정"에 붙으므로 조사 선택이
  필요 없습니다.

## 시크릿

`NOTIFY_SECRET` 하나를 Vault(`032_trip_member_notify.sql`에서 이미 등록)와 이 함수, `send-notification`
셋이 전부 같은 값으로 공유합니다. Supabase secrets는 **프로젝트 전역**이라(함수별로 따로 설정하는 게
아니다) `send-notification`에 이미 `NOTIFY_SECRET`을 설정해 뒀다면 이 함수도 같은 값을 자동으로 읽습니다
— 별도로 `secrets set`할 필요가 없습니다. 값 자체는 어떤 로그에도 남기지 않습니다.

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# NOTIFY_SECRET을 이미 send-notification에 설정했다면 이 단계는 건너뛰어도 된다(프로젝트 전역 secret).
# 아직 안 했다면:
supabase secrets set NOTIFY_SECRET=<임의의 긴 문자열>

# 배포 (서버 대 서버 함수라 JWT 검증을 끈다 - collect-travel-feed/send-notification과 동일)
supabase functions deploy notify-scheduler --no-verify-jwt
```

배포 후 `supabase/migrations/033_notify_scheduler.sql`을 SQL Editor에서 실행하세요 — 그 안의
`cron.schedule`이 5분마다 이 함수를 부르기 시작합니다. 그 파일을 실행하기 전에 Vault에
`notify_secret`이 이미 등록돼 있어야 합니다(`032_trip_member_notify.sql`의 안내 참고 — 아직 안 했다면
먼저 `select vault.create_secret('<NOTIFY_SECRET과 같은 값>', 'notify_secret', ...)`를 실행).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>
export NOTIFY_SECRET=<supabase secrets set으로 넣은 값>

# 수동으로 한 번 돌려보기 - 지금 조건을 만족하는 여행/일정이 없으면 전부 0으로 온다
curl -sS -X POST "$SUPABASE_URL/functions/v1/notify-scheduler" \
  -H "apikey: $ANON_KEY" \
  -H "x-notify-secret: $NOTIFY_SECRET"

# 시크릿 없이: 401이 와야 한다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/notify-scheduler" \
  -H "apikey: $ANON_KEY"
```

실제로 출발 임박/일정 임박 알림이 뜨는지 확인하려면, 테스트 계정으로 내일 출발하는 여행을 만들고(그
여행 시간대 기준 18시 이후에 돌려보거나, 임시로 SQL Editor에서 그 여행의 `start_date`/`timezone`을
조건에 맞게 바꿔서) 5분 뒤 cron이 돌거나 위 curl을 직접 호출해 알림이 오는지 확인하세요.

## ⚠️ 검증 상태

이 환경에는 Deno/Docker뿐 아니라 실제 Postgres도 없어서, `docs/testing.md`가 말하는 PGlite(Node 안의
WASM Postgres) 기법으로 `033_notify_scheduler.sql`의 두 판별 함수를 검증했습니다. `now()`가 테스트를
실행하는 실제 시각이라 통제할 수 없는 문제는, "UTC 지금 시각에 몇 시간을 더하면 원하는 지역시각(예:
20시)이 되는가"를 계산해 그 오프셋에 맞는 고정 오프셋 타임존(`Etc/GMT±N`, DST 없음)을 `trips.timezone`에
넣는 방식으로 우회해, 실행 시각과 무관하게 항상 같은 결과가 나오는 결정적 테스트를 만들었습니다.
확인한 것: 날짜·18:00 경계가 정확히 지켜짐(하루 전이 아니거나 아직 18시 전이면 후보가 아님), 2시간
이내·아직 안 지남 조건이 정확히 지켜짐(3시간 뒤는 제외, 이미 지난 것도 제외), 시간 없는 일정은 아예
제외, 중복 실행 시 `was_reserved`가 `false`로 바뀌어 재발송되지 않음(여행/일정 정보가 갱신돼도 마찬가지).

이 함수(`index.ts`) 자체는 Node + `globalThis.Deno`-shim(다른 함수들과 동일한 기법)으로, rpc 두 개와
`send-notification` 호출을 모킹해 401/405 가드, 그룹핑(대상 1명마다가 아니라 트립/일정 단위로 묶임),
조사(이/가) 선택, 시간 포맷, 제목→장소→기본값 대체, 한쪽 `send-notification` 호출이 실패해도 나머지는
계속 처리됨, `NOTIFY_SECRET` 무로그까지 확인했습니다.

**실제로 확인 못 한 것**: 실제 Supabase 프로젝트에서 pg_cron이 정확히 5분마다 이 함수를 깨우는지, 그리고
`SUPABASE_ANON_KEY`가 실제 환경에 자동 주입되는지는 문서상의 사실로 가정했을 뿐 이 환경에서 직접
확인하지 못했습니다 — 배포 후 위 curl 테스트와 Supabase 대시보드 Edge Functions 로그로 확인해주세요.
