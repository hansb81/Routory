// refresh-city-weather: pg_cron이 6시간마다 부르는 날씨 캐시 갱신 Supabase Edge Function (Deno, no imports).
// '어디로 떠나볼까요' 도시 카드(027_discover_cities.sql#discover_cities)가 쓸 현재 기온/날씨 코드를
// city_weather_cache에 채워 둔다 — 카드를 보는 사용자가 매번 날씨 API를 직접 부르지 않도록 서버가 주기적으로
// 미리 받아 두는 캐시다.
//
// 호출: POST (본문 없음), 헤더 x-cron-secret: <CRON_SECRET 비밀값과 동일한 값>
//   - collect-travel-feed와 완전히 같은 방식·같은 비밀값 이름(CRON_SECRET)을 쓴다 — 이 프로젝트에는 아직
//     별도의 "푸시 알림" 기능이 없어서(저장소 전체를 찾아봐도 push/FCM/APNs 관련 코드가 없다), 요청한
//     "푸시 알림 때 쓴 방식과 같은 시크릿 헤더"에 해당하는 기존 선례는 collect-travel-feed뿐이다 — 그
//     패턴(사람이 아니라 pg_cron만 호출 → Authorization JWT 대신 고정 공유 비밀값 헤더)을 그대로 따랐다.
//     CRON_SECRET을 이미 collect-travel-feed용으로 설정해 뒀다면 같은 값을 그대로 재사용할 수 있고,
//     cron.schedule에 이 함수용 호출을 하나 더 추가하면 된다(028_refresh_city_weather_cron.sql).
// 응답: { success, failed, skippedUnresolved, total } — 개수만, 어떤 도시였는지는 담지 않는다(요청 4번:
//   로그에도 성공·실패 건수만 남긴다).
//
// Open-Meteo Forecast API는 좌표를 쉼표로 여러 개 묶어 한 번에 요청할 수 있다(latitude=1,2,3&longitude=
// 1,2,3 → 응답이 위치별 구조의 리스트가 된다) — 도시 수만큼 개별 호출하지 않고 이 방식을 쓴다(요청 1번).
// 다만 "한 번에 몇 개까지" 묶을 수 있는지는 공식 문서에 명시된 상한이 없어서(단계 0 조사 결과), 쿼리스트링이
// 지나치게 길어지는 것과 한 번의 실패가 전체 도시를 통째로 막는 것을 피하려고 BATCH_SIZE만큼씩 나눠
// 여러 번 호출한다 — 배치 하나가 실패해도 다른 배치는 계속 처리된다(요청 4번).
//
// 무료 티어 호출 한도(분당 600 / 일 10,000, 단계 0 조사)에는 여유있게 들어간다 — 6시간마다 도시
// 수/BATCH_SIZE번만 호출하므로 하루 호출 수가 수십 회를 넘지 않는다.
//
// ⚠️ Open-Meteo 무료 API는 공식 문서상 "비상업적 용도"로 한정돼 있다(CC BY 4.0, 상업적 이용엔 유료
// 구독이 필요) — 이 저장소는 서비스형 앱이라 그 경계에 해당하는지 애매하다는 점을 이미 한 번 플래그해
// 뒀다(메인 화면 개선 논의, myTripPage.js의 날씨 카드도 같은 이슈). 이 함수도 같은 문제를 그대로
// 안고 있다 — 운영 전 라이선스 조건을 다시 확인할 것.
//
// 필요한 비밀값(secrets):
//   CRON_SECRET        collect-travel-feed와 같은 이름/같은 값을 그대로 쓸 수 있다(025 참고). 새로
//                      다른 값을 쓰려면 이 값과 028_refresh_city_weather_cron.sql의 헤더 값을 똑같이
//                      맞춰야 한다(두 군데 손으로 맞추는 값, 자동 공유 안 됨).
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로 넣어준다.

const CRON_SECRET_HEADER = "x-cron-secret";

// 상수 시간 비교(2026-10-19 보안 점검 EDGE-05, collect-travel-feed#timingSafeEqual과 동일)
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 50; // 조정 지점: 한 번의 Open-Meteo 호출에 묶을 최대 도시 수 (공식 상한 미확인 - 보수적으로 설정)

type Db = { supabaseUrl: string; serviceRoleKey: string };

type CityRow = {
  destination_id: string;
  destinations: { lat: number | null; lng: number | null; resolved_at: string | null } | null;
};

type ResolvedCity = { destinationId: string; lat: number; lng: number };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function restHeaders(serviceRoleKey: string, extra?: Record<string, string>) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...extra };
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ---- 활성 도시 + destinations 좌표 조회 (PostgREST embed로 한 번에) ----

async function fetchActiveCities(db: Db): Promise<CityRow[]> {
  const url = `${db.supabaseUrl}/rest/v1/discover_cities?is_active=eq.true&select=destination_id,destinations(lat,lng,resolved_at)`;
  const res = await fetch(url, { headers: restHeaders(db.serviceRoleKey) });
  if (!res.ok) throw new Error(`discover_cities 조회 실패 HTTP ${res.status}`);
  return (await res.json().catch(() => [])) as CityRow[];
}

// 요청 6번: 좌표가 아직 확정되지 않은(lat/lng가 null인) 도시는 건너뛴다 - destinations.resolved_at이
// null인 행(검색으로만 들어왔고 아직 search-destination의 select를 거치지 않은 도시)이 대표적인 경우다.
function partitionByCoords(rows: CityRow[]): { resolved: ResolvedCity[]; skippedUnresolved: number } {
  const resolved: ResolvedCity[] = [];
  let skippedUnresolved = 0;
  for (const row of rows) {
    const lat = row.destinations?.lat;
    const lng = row.destinations?.lng;
    if (typeof lat === "number" && typeof lng === "number") {
      resolved.push({ destinationId: row.destination_id, lat, lng });
    } else {
      skippedUnresolved++;
    }
  }
  return { resolved, skippedUnresolved };
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

// ---- Open-Meteo Forecast: 여러 좌표를 한 번에 (요청 1번) ----

type OpenMeteoCurrent = { temperature_2m?: number; weather_code?: number };
type OpenMeteoItem = { current?: OpenMeteoCurrent };

async function fetchBatchWeather(batch: ResolvedCity[]): Promise<OpenMeteoItem[]> {
  const lat = batch.map((c) => c.lat).join(",");
  const lng = batch.map((c) => c.lng).join(",");
  const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=UTC`;
  const data = await withTimeout(async (signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    return res.json();
  }, FETCH_TIMEOUT_MS);
  // 좌표가 1개뿐이면 응답이 리스트가 아니라 단일 객체로 온다(단계 0 조사) - 항상 리스트로 다룬다.
  return Array.isArray(data) ? (data as OpenMeteoItem[]) : [data as OpenMeteoItem];
}

// ---- city_weather_cache upsert ----

async function upsertWeatherCache(
  db: Db,
  rows: { destination_id: string; temp_c: number; weather_code: number; fetched_at: string }[]
): Promise<void> {
  if (rows.length === 0) return;
  const url = `${db.supabaseUrl}/rest/v1/city_weather_cache?on_conflict=destination_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: restHeaders(db.serviceRoleKey, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`city_weather_cache upsert 실패 HTTP ${res.status}`);
}

// ---- 배치 하나 처리: 실패해도 다른 배치에 영향 없음(요청 4번), 실패한 도시의 기존 캐시는 건드리지 않음 ----

async function processBatch(db: Db, batch: ResolvedCity[]): Promise<{ success: number; failed: number }> {
  let items: OpenMeteoItem[];
  try {
    items = await fetchBatchWeather(batch);
  } catch (err) {
    // 배치 전체 호출 실패 - 이 배치의 모든 도시를 실패로 집계하고, 캐시는 그대로 둔 채 다음 배치로 넘어간다
    console.error(`[refresh-city-weather] 배치 호출 실패 size=${batch.length} error=${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return { success: 0, failed: batch.length };
  }

  const toUpsert: { destination_id: string; temp_c: number; weather_code: number; fetched_at: string }[] = [];
  let failed = 0;
  const fetchedAt = new Date().toISOString();

  // Open-Meteo는 입력 좌표 순서와 같은 순서로 응답을 돌려준다(공식 문서) - 인덱스로 짝을 맞춘다.
  batch.forEach((city, i) => {
    const current = items[i]?.current;
    const temp = current?.temperature_2m;
    const code = current?.weather_code;
    if (typeof temp === "number" && typeof code === "number") {
      toUpsert.push({ destination_id: city.destinationId, temp_c: temp, weather_code: code, fetched_at: fetchedAt });
    } else {
      failed++; // 이 도시만 응답이 비정상 - 다른 도시는 계속 처리, 이 도시의 기존 캐시는 그대로 둔다
    }
  });

  try {
    await upsertWeatherCache(db, toUpsert);
  } catch (err) {
    // upsert 자체가 실패하면 이번에 성공적으로 받아온 값도 저장되지 않은 것 - 전부 실패로 집계한다
    console.error(`[refresh-city-weather] upsert 실패 count=${toUpsert.length} error=${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return { success: 0, failed: batch.length };
  }

  return { success: toUpsert.length, failed };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || !timingSafeEqual(req.headers.get(CRON_SECRET_HEADER) ?? "", cronSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[refresh-city-weather] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않아요");
    return json({ error: "server not configured" }, 500);
  }
  const db: Db = { supabaseUrl, serviceRoleKey };

  let rows: CityRow[];
  try {
    rows = await fetchActiveCities(db);
  } catch (err) {
    console.error(`[refresh-city-weather] discover_cities 조회 실패 error=${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return json({ error: "discover_cities 조회에 실패했어요" }, 500);
  }

  const { resolved, skippedUnresolved } = partitionByCoords(rows);

  let success = 0;
  let failed = 0;
  for (const batch of chunk(resolved, BATCH_SIZE)) {
    const result = await processBatch(db, batch);
    success += result.success;
    failed += result.failed;
  }

  console.log(
    `[refresh-city-weather] success=${success} failed=${failed} skipped_unresolved=${skippedUnresolved} total=${rows.length}`
  );

  return json({ success, failed, skippedUnresolved, total: rows.length });
});
