// airport-congestion: 국내 공항의 공식 실시간 혼잡도 공개데이터(data.go.kr)가 있는 공항에 한해서만, 그
// 데이터를 가져와 간단한 형태로 돌려주는 Supabase Edge Function (Deno, no imports). 나의 여행 화면의
// "공항 혼잡도" 카드(myTripPage.js#hydrateAirportCongestionCard)가 이 함수를 부른다.
//
// 요청:  POST { "airportCode": "ICN" }  (IATA 3글자 코드, js/flightData.js#AIRPORTS의 code)
// 응답:  성공 { "available": true, "level": "여유"|"보통"|"혼잡"|"매우혼잡", "waitMinutes": 12|null, "fetchedAt": "<ISO>" }
//        성공(데이터 없음) { "available": false }  (HTTP 200 — 지원하지 않는 공항이거나, 지원 공항이라도
//          지금 이 순간 실시간 조회에 실패했을 때도 마찬가지다. "카드 자체를 숨겨달라"는 요구사항이라, 애매하면
//          항상 실패가 아니라 available:false로 - 클라이언트는 이 응답이면 카드를 그냥 지운다.)
//        그 밖: 401 로그인 필요, 400 airportCode 형식 오류, 405 POST가 아님.
//
// ⚠️ **이 함수의 data.go.kr 호출부(fetchIncheonCongestion)는 검증되지 않았다** — 인천공항공사의 "출국장
// 혼잡도 조회"(data.go.kr/data/15148225/openapi.do) Open API는 실제 요청 URL·파라미터·응답 필드가 담긴
// 활용가이드(.docx)가 data.go.kr에 그 API를 신청해서 승인받은 계정에서만 열람할 수 있어서(공개 크롤링으로는
// 확인 불가), 이 코드는 data.go.kr 플랫폼 전체가 공통으로 쓰는 관례(요청: 쿼리 파라미터 `serviceKey`·`type=json`,
// 응답 envelope: `response.body.items.item[]`)만 확실히 따르고, 그 안의 실제 필드 이름(대기 인원/시간,
// 혼잡도 등급 등)은 최선의 추정치다 — 실제로 API를 신청해 살아있는 키로 한 번 호출해서 진짜 응답을 받아본
// 뒤(비슷한 사례의 조언: "문서 대신 실제 응답을 캡처해서 확인하라"), pickCongestionLevel()의 필드 이름을
// 거기 맞게 고쳐야 한다. 그 전까지는 DATA_GO_KR_SERVICE_KEY/INCHEON_CONGESTION_API_URL을 설정하지 않으면
// available:false만 돌려주므로(아래 참고) 카드가 그냥 안 보일 뿐 잘못된 값을 보여주지는 않는다.
//
// 필요한 비밀값(secrets) — 아래 그대로 쓰지 않고 실제 값을 확인한 뒤 지역해 넣는다:
//   DATA_GO_KR_SERVICE_KEY       공공데이터포털(data.go.kr) 마이페이지의 "일반 인증키(Encoding)"
//   INCHEON_CONGESTION_API_URL   위 "출국장 혼잡도 조회" API를 신청하면 활용가이드에 나오는 정확한 요청
//                                 URL(엔드포인트, serviceKey 앞부분 - 쿼리스트링 없이). 예시 형태:
//                                 https://apis.data.go.kr/B551177/<서비스명>/<오퍼레이션명>
//   둘 다 없으면 이 함수는 네트워크 호출 자체를 하지 않고 바로 available:false를 돌려준다(요청 2번의
//   "없으면 카드 자체를 숨겨줘"를 정확히 만족한다 - 비밀값을 안 넣은 상태 = "공식 공개데이터가 아직 연결 안 됨").
//   supabase secrets set DATA_GO_KR_SERVICE_KEY=<인증키> INCHEON_CONGESTION_API_URL=<엔드포인트>

// 지금은 인천공항(ICN)만 지원한다 - 검색으로 확인한 한도 안에서는 김포·김해·제주 등 나머지 국내 공항엔
// 인천공항공사의 이 API에 대응하는 실시간 혼잡도 공개데이터가 없었다(요청 2번: "해외 공항은 항상 숨김"도
// 같은 이유로 이 Set에 아예 없는 공항은 전부 숨겨지는 것으로 자동 만족된다). 나중에 다른 공항의 공식
// 공개데이터를 찾으면 이 Set에 코드만 추가하고, 그 공항에 맞는 fetch 함수를 분기해 주면 된다.
const SUPPORTED_AIRPORTS = new Set(["ICN"]);

// 허용 출처(2026-10-19 보안 점검 EDGE-07) - analyze-ticket과 동일한 이유/방식.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "https://triplog-nu.vercel.app",
  "https://localhost",
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://triplog-nu.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ---- 로그인 확인 (analyze-ticket과 같은 방식) ----
function isSignedIn(req: Request): boolean {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    if (!payload) return false;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(atob(padded)).role === "authenticated";
  } catch {
    return false;
  }
}

function readAirportCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { airportCode } = body as Record<string, unknown>;
  return typeof airportCode === "string" && /^[A-Z]{3}$/.test(airportCode) ? airportCode : null;
}

type CongestionResult = { level: "여유" | "보통" | "혼잡" | "매우혼잡"; waitMinutes: number | null };

// 대기 인원/시간 수치 → 4단계 등급. 정확한 기준(분·인원)은 실데이터를 받아본 뒤 다시 맞추는 게 좋다 -
// 지금은 "대기시간이 있으면 그걸로, 없으면 대기 인원수로" 대충 나눈 잠정치다.
function levelFromWaitMinutes(minutes: number): CongestionResult["level"] {
  if (minutes < 5) return "여유";
  if (minutes < 15) return "보통";
  if (minutes < 30) return "혼잡";
  return "매우혼잡";
}

// data.go.kr 표준 응답 envelope(response.body.items.item)에서, 이름이 확실치 않은 필드를 후보 이름
// 여러 개 중 먼저 걸리는 것으로 읽는다 - 실제 필드 이름을 확인하면 이 후보 목록만 고치면 된다.
function pickNumber(item: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const raw = item[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseIncheonResponse(raw: unknown): CongestionResult | null {
  const body = (raw as { response?: { body?: unknown } })?.response?.body as
    | { items?: { item?: unknown } | unknown[] }
    | undefined;
  const itemsField = body?.items;
  const list = Array.isArray(itemsField)
    ? itemsField
    : Array.isArray((itemsField as { item?: unknown })?.item)
      ? ((itemsField as { item: unknown[] }).item as unknown[])
      : itemsField && typeof itemsField === "object" && "item" in (itemsField as object)
        ? [(itemsField as { item: unknown }).item]
        : [];
  if (list.length === 0) return null;

  // 여러 게이트/시간대 항목이 올 수 있어서, 대기시간(또는 인원)이 가장 큰 항목을 대표값으로 쓴다
  let best: CongestionResult | null = null;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const waitMinutes = pickNumber(item, ["waitTime", "waitingTime", "avgWaitTime", "estimateWaitTime"]);
    const waitCount = pickNumber(item, ["waitPersonNum", "watingPersonNum", "waitingNum", "standbyNum"]);
    const minutes = waitMinutes ?? (waitCount != null ? waitCount / 4 : null); // 인원수만 있으면 4명/분 처리 속도로 대충 환산(잠정치)
    if (minutes == null) continue;
    if (!best || minutes > (best.waitMinutes ?? 0)) best = { level: levelFromWaitMinutes(minutes), waitMinutes: Math.round(minutes) };
  }
  return best;
}

async function fetchIncheonCongestion(serviceKey: string, apiUrl: string): Promise<CongestionResult | null> {
  const url = `${apiUrl}?serviceKey=${encodeURIComponent(serviceKey)}&type=json&terminalId=P01`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.error("[airport-congestion] data.go.kr 오류", res.status);
      return null;
    }
    return parseIncheonResponse(await res.json());
  } catch (err) {
    console.error("[airport-congestion] data.go.kr 호출 실패", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---- 요청 처리 ----

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS_HEADERS = corsHeadersFor(req);
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const unavailable = () => json({ available: false });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);
  if (!isSignedIn(req)) return json({ error: "로그인이 필요해요" }, 401);

  const body = await req.json().catch(() => null);
  const airportCode = readAirportCode(body);
  if (!airportCode) return json({ error: "airportCode(IATA 3글자)를 보내주세요" }, 400);

  if (!SUPPORTED_AIRPORTS.has(airportCode)) return unavailable(); // 공식 공개데이터가 없는 공항(해외 포함) - 요청 2번

  const serviceKey = Deno.env.get("DATA_GO_KR_SERVICE_KEY");
  const apiUrl = Deno.env.get("INCHEON_CONGESTION_API_URL");
  if (!serviceKey || !apiUrl) return unavailable(); // 아직 실제 엔드포인트를 확인/설정하지 않음 - 맨 위 주석 참고

  const result = await fetchIncheonCongestion(serviceKey, apiUrl);
  if (!result) return unavailable();

  return json({ available: true, ...result, fetchedAt: new Date().toISOString() });
});
