// notify-scheduler: pg_cron이 5분마다 부르는 시간 기반 알림 판별 함수 (PRD v11 4번 "시간 기반 이벤트" —
// 앱이 꺼져 있어도 가야 하는 출발 임박/다음 일정 임박은 클라이언트가 아니라 서버가 주기적으로 훑어야
// 한다). Deno, no imports — REST/RPC 호출만 쓴다(travel-briefing/collect-travel-feed와 같은 "import 없이
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY로 직접 REST" 방식).
//
// ---- 인증 ----
// collect-travel-feed/send-notification과 같은 고정 공유 비밀값 헤더(x-notify-secret, NOTIFY_SECRET)로만
// 막는다 — pg_cron(서버 대 서버)만 부르고 사람이 로그인해서 쓰는 함수가 아니다. Supabase secrets는
// 프로젝트 전역이라, send-notification에 이미 NOTIFY_SECRET을 설정해 뒀다면 이 함수도 같은 값을 그대로
// 읽는다(추가로 `secrets set`할 필요 없음) — 033_notify_scheduler.sql의 pg_cron 작업도 Vault의 같은
// 'notify_secret' 값을 보낸다. 세 군데(Vault, 이 함수의 NOTIFY_SECRET, send-notification의
// NOTIFY_SECRET) 값이 전부 같아야 한다.
//
// ---- 판별은 전부 SQL에 있다 ----
// `find_departure_notify_targets()`/`find_schedule_notify_targets()`(033_notify_scheduler.sql, rpc로
// 호출)가 "누구에게 보내야 하는가"와 "이미 보냈는지(notification_log 중복 방지, 요청 4번)"를 한 번에
// 원자적으로 처리해서, (trip_id|schedule_item_id, user_id, was_reserved) 행들을 돌려준다. 이 함수는
// was_reserved=true인 행만 모아서 트립/일정 단위로 묶어 send-notification을 "한 번씩만" 부른다(요청
// 5번 — 대상 1명마다 부르지 않는다. send-notification 자체가 userIds 배열 하나를 받아 한 번에 처리하므로,
// 같은 트립/같은 일정의 수신자는 항상 하나의 호출로 묶인다).
//
// ---- 문구 ----
// 출발 임박: "내일 '<여행 제목><이/가>' 시작돼요. 항공권과 준비물을 확인하세요" — 요청 2번 예시를 그대로
// 쓰되, 여행 제목이 받침 없이 끝나는 경우(예: "하와이")에도 자연스럽도록 조사(이/가)만 코드로 고른다.
// 다음 일정 임박: "'<일정 제목 또는 장소>' 일정이 곧 시작돼요 (HH:MM)" — "일정이"는 항상 받침 있는
// "일정"에 붙으므로 조사 선택이 필요 없다. 제목도 장소도 없는 일정은 "다음 일정"으로 대체한다.
//
// ---- 로그(요청 6번) ----
// 매 실행 끝에 카테고리별 처리/발송/건너뜀 수와 실제 send-notification 호출 횟수를 한 줄로 남긴다.
// NOTIFY_SECRET 값 자체는 절대 로그에 안 남긴다(send-notification과 같은 원칙).

const NOTIFY_SECRET_HEADER = "x-notify-secret";

// 상수 시간 비교(2026-10-19 보안 점검 EDGE-05, collect-travel-feed#timingSafeEqual과 동일)
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

type Db = { supabaseUrl: string; serviceRoleKey: string; anonKey: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function restHeaders(serviceRoleKey: string, extra?: Record<string, string>) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...extra };
}

async function callRpc<T>(db: Db, fn: string): Promise<T[]> {
  const res = await fetch(`${db.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: restHeaders(db.serviceRoleKey),
    body: "{}",
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`rpc ${fn} 실패 HTTP ${res.status} ${errText.slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

// 한글 음절의 받침(종성) 유무로 "이/가" 같은 조사를 고른다 - "하와이가"/"제주도가" vs "오사카여행이"처럼
// 단어가 어떻게 끝나든 자연스럽게 읽히게 한다. 한글이 아닌 문자로 끝나면(영문 등) withBatchim을 기본값으로 쓴다.
function josa(word: string, withBatchim: string, withoutBatchim: string): string {
  const lastChar = (word ?? "").trim().slice(-1);
  const code = lastChar.charCodeAt(0);
  if (!lastChar || code < 0xac00 || code > 0xd7a3) return withBatchim;
  return (code - 0xac00) % 28 === 0 ? withoutBatchim : withBatchim;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Postgres time 컬럼은 "14:30:00" 형태 문자열로 온다 - 분까지만 보여준다.
function formatHm(timeStr: string): string {
  const [hh, mm] = timeStr.split(":");
  return `${pad2(Number(hh))}:${pad2(Number(mm))}`;
}

type DepartureRow = { trip_id: string; trip_title: string; user_id: string; was_reserved: boolean };
type ScheduleRow = {
  schedule_item_id: string;
  trip_id: string;
  item_title: string | null;
  item_place: string | null;
  item_time: string;
  user_id: string;
  was_reserved: boolean;
};

async function callSendNotification(db: Db, notifySecret: string, payload: { userIds: string[]; type: string; title: string; url: string; tripId: string }): Promise<boolean> {
  const res = await fetch(`${db.supabaseUrl}/functions/v1/send-notification`, {
    method: "POST",
    headers: { apikey: db.anonKey, "Content-Type": "application/json", [NOTIFY_SECRET_HEADER]: notifySecret },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`[notify-scheduler] send-notification 호출 실패 HTTP ${res.status} type=${payload.type} tripId=${payload.tripId}`);
    return false;
  }
  return true;
}

async function processDeparture(db: Db, notifySecret: string) {
  const rows = await callRpc<DepartureRow>(db, "find_departure_notify_targets");
  const processed = rows.length;
  const skipped = rows.filter((r) => !r.was_reserved).length;

  const byTrip = new Map<string, { title: string; userIds: string[] }>();
  for (const r of rows) {
    if (!r.was_reserved) continue;
    if (!byTrip.has(r.trip_id)) byTrip.set(r.trip_id, { title: r.trip_title, userIds: [] });
    byTrip.get(r.trip_id)!.userIds.push(r.user_id);
  }

  let sent = 0;
  let calls = 0;
  for (const [tripId, group] of byTrip) {
    const title = `내일 '${group.title}'${josa(group.title, "이", "가")} 시작돼요. 항공권과 준비물을 확인하세요`;
    const ok = await callSendNotification(db, notifySecret, {
      userIds: group.userIds,
      type: "departure",
      title,
      url: `/#/my-trip/${tripId}`,
      tripId,
    });
    calls++;
    if (ok) sent += group.userIds.length;
  }

  return { processed, sent, skipped, calls, events: byTrip.size };
}

async function processSchedule(db: Db, notifySecret: string) {
  const rows = await callRpc<ScheduleRow>(db, "find_schedule_notify_targets");
  const processed = rows.length;
  const skipped = rows.filter((r) => !r.was_reserved).length;

  const byItem = new Map<string, { tripId: string; label: string; hm: string; userIds: string[] }>();
  for (const r of rows) {
    if (!r.was_reserved) continue;
    if (!byItem.has(r.schedule_item_id)) {
      const label = r.item_title?.trim() || r.item_place?.trim() || "다음 일정";
      byItem.set(r.schedule_item_id, { tripId: r.trip_id, label, hm: formatHm(r.item_time), userIds: [] });
    }
    byItem.get(r.schedule_item_id)!.userIds.push(r.user_id);
  }

  let sent = 0;
  let calls = 0;
  for (const [, group] of byItem) {
    const title = `'${group.label}' 일정이 곧 시작돼요 (${group.hm})`;
    const ok = await callSendNotification(db, notifySecret, {
      userIds: group.userIds,
      type: "schedule",
      title,
      url: `/#/schedule/${group.tripId}`,
      tripId: group.tripId,
    });
    calls++;
    if (ok) sent += group.userIds.length;
  }

  return { processed, sent, skipped, calls, events: byItem.size };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const notifySecret = Deno.env.get("NOTIFY_SECRET");
  if (!notifySecret || !timingSafeEqual(req.headers.get(NOTIFY_SECRET_HEADER) ?? "", notifySecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("[notify-scheduler] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY가 설정되어 있지 않아요");
    return json({ error: "server not configured" }, 500);
  }
  const db: Db = { supabaseUrl, serviceRoleKey, anonKey };

  let departure: Awaited<ReturnType<typeof processDeparture>>;
  let schedule: Awaited<ReturnType<typeof processSchedule>>;
  try {
    departure = await processDeparture(db, notifySecret);
  } catch (err) {
    console.error("[notify-scheduler] 출발 임박 처리 실패", (err as Error)?.message);
    departure = { processed: 0, sent: 0, skipped: 0, calls: 0, events: 0 };
  }
  try {
    schedule = await processSchedule(db, notifySecret);
  } catch (err) {
    console.error("[notify-scheduler] 다음 일정 임박 처리 실패", (err as Error)?.message);
    schedule = { processed: 0, sent: 0, skipped: 0, calls: 0, events: 0 };
  }

  console.log(
    `[notify-scheduler] departure: processed=${departure.processed} sent=${departure.sent} skipped=${departure.skipped} calls=${departure.calls} events=${departure.events} | ` +
      `schedule: processed=${schedule.processed} sent=${schedule.sent} skipped=${schedule.skipped} calls=${schedule.calls} events=${schedule.events}`
  );

  return json({ departure, schedule });
});
