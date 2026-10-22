// analyze-ticket: 항공권 사진(base64)을 Google Gemini로 읽어 항공편 정보를 JSON으로 돌려주는 Supabase Edge Function (Deno).
//
// 요청:  POST  { "imageBase64": "<base64 문자열>" }   (선택: "mimeType": "image/jpeg")
//        Storage 경로가 아니라 이미지 자체를 base64로 받는다. "data:image/jpeg;base64," 머리말이 붙어 있어도 된다.
// 응답:  성공 { tickets: [ { airline, airlineCode, flightNo, departureDate, arrivalDate, departureTime, arrivalTime,
//               departureAirport, departureAirportCode, arrivalAirport, arrivalAirportCode }, ... ] }  (모르는 값은 null)
//        한 장의 사진에 왕복(출국편+귀국편)처럼 서로 다른 항공편이 여러 개 있으면 tickets에 각각 한 항목씩 담아 돌려준다.
//        편도면 tickets는 항목 1개짜리 배열이다.
//        실패 { error: "인식에 실패했어요. 직접 입력해주세요" }  (Gemini 오류·요청 한도 초과·인식 불가 모두 HTTP 200으로 돌려줘서 앱이 멈추지 않게 한다)
//
// 이미지는 어디에도 저장하지 않는다. 요청 안에서 Gemini로 한 번 보내고, 응답을 돌려주면 메모리에서 사라진다.
// 이미지·base64·API 키는 로그에도 남기지 않는다.
//
// 필요한 비밀값(secrets): GEMINI_API_KEY
// 선택 비밀값: GEMINI_MODEL  쉼표로 여러 개 (기본 "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview").
//   앞의 모델이 일시적으로 막히면(503 수요 폭주, 429 한도 초과, 시간 초과, 404 단종) 다음 모델로 다시 시도한다.
//   Gemini 모델은 자주 바뀐다: 처음 요청했던 gemini-2.5-flash는 새 키로는 이미 쓸 수 없다. 막히면 여기 이름만 바꾸면 된다.
//   supabase secrets set GEMINI_API_KEY=<키>
// 이 파일에는 키를 쓰지 않는다. 키는 Supabase 비밀값으로만 넣는다.

const GEMINI_MODELS = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const GEMINI_TIMEOUT_MS = 20_000; // 모델 하나에 기다리는 시간. 응답이 없는 모델은 이 시간 뒤에 다음 모델로 넘어간다
// 다른 모델로 다시 시도해 볼 만한 상태: 404(단종) 408 429(한도) 500 502 503(수요 폭주) 504. 그 밖의 오류(잘못된 키·요청)는 모델을 바꿔도 같다.
const RETRYABLE_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);
const MAX_BASE64_CHARS = 14 * 1024 * 1024; // base64 14M글자 ≈ 사진 약 10MB (Gemini 요청 한도 20MB보다 여유 있게)

const FAIL_MESSAGE = "인식에 실패했어요. 직접 입력해주세요";

const PROMPT = [
  "이 항공권 이미지에서 항공편 정보를 추출해서 JSON만 응답해. 결과는 tickets 배열에 담아: 이미지 안에 출국편·귀국편처럼 서로 다른 항공편이 여러 개 있으면(왕복 항공권 등) 각각을 배열의 별도 항목으로 나눠 담고, 편도이거나 항공편이 하나뿐이면 항목을 1개만 담아. 같은 항공편을 중복해서 넣지 마.",
  "",
  "tickets 배열의 각 항목(키 이름 그대로, 모르는 값은 null로):",
  "- airline: 항공사 이름. 한국어 이름을 알면 한국어로 (예: KOREAN AIR → 대한항공, ASIANA AIRLINES → 아시아나항공), 모르면 적힌 그대로",
  "- flightNo: 편명. 항공사 코드 2글자와 숫자 (예: KE723)",
  "- departureDate, arrivalDate: YYYY-MM-DD",
  "- departureTime, arrivalTime: 24시간제 HH:mm (현지 시각)",
  "- departureAirport, arrivalAirport: 공항 또는 도시 이름",
  "- departureAirportCode, arrivalAirportCode: 3글자 IATA 공항 코드 (예: ICN, KIX)",
  "",
  "규칙: 이미지에 실제로 적힌 값만 쓰고 추측하지 마. 연도가 없어서 날짜를 확정할 수 없으면 그 날짜는 null. 도착날짜가 적혀 있지 않으면 null.",
  "항공권이 아닌 이미지이거나 읽을 수 없으면 tickets를 빈 배열로.",
].join("\n");

// Gemini 구조화 출력: 이 모양의 JSON만 나오도록 강제한다 (모르는 값은 null)
const nullableString = { type: "STRING", nullable: true };
const TICKET_SCHEMA = {
  type: "OBJECT",
  properties: {
    airline: nullableString,
    flightNo: nullableString,
    departureDate: nullableString,
    arrivalDate: nullableString,
    departureTime: nullableString,
    arrivalTime: nullableString,
    departureAirport: nullableString,
    departureAirportCode: nullableString,
    arrivalAirport: nullableString,
    arrivalAirportCode: nullableString,
  },
  required: [
    "airline",
    "flightNo",
    "departureDate",
    "arrivalDate",
    "departureTime",
    "arrivalTime",
    "departureAirport",
    "departureAirportCode",
    "arrivalAirport",
    "arrivalAirportCode",
  ],
};
// 왕복 항공권처럼 한 사진에 항공편이 여러 개 있을 수 있어 배열로 받는다. 4개 넘게 오면(오인식) 앞에서 잘라낸다.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tickets: { type: "ARRAY", items: TICKET_SCHEMA, maxItems: 4 },
  },
  required: ["tickets"],
};

// 허용 출처(2026-10-19 보안 점검 EDGE-07) - 예전엔 Access-Control-Allow-Origin이 "*"라 어떤 사이트에서도
// (탈취된 세션 토큰을 들고) 이 함수를 브라우저에서 직접 호출할 수 있었다. 요청의 Origin이 이 목록에
// 있을 때만 그 값을 그대로 돌려주고, 없으면 배포 사이트 값을 돌려줘서(요청 출처와 안 맞으니 브라우저가
// 응답을 읽지 못한다) 사실상 막는다 - 로컬 개발 서버·네이티브 앱(Capacitor WebView 기본 출처)·배포
// 사이트 셋 다 계속 동작해야 해서 단일 고정값 대신 매 요청마다 Origin을 확인한다.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080", // serve.py 로컬 개발
  "https://triplog-nu.vercel.app", // 배포된 사이트 - 도메인이 바뀌면 여기도 같이 바꿔야 한다
  "https://localhost", // Capacitor Android WebView 기본 출처(capacitor.config.json에 androidScheme 오버라이드 없음)
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

// ---- 로그인 확인 ----
// Supabase가 서명을 이미 확인한 토큰(verify_jwt)이라 payload의 role/sub만 본다.
// 앱에 공개돼 있는 anon 키만으로는 호출할 수 없게 해서, 누구나 Gemini 사용량을 쓰지 못하게 한다.
function authClaims(req: Request): { authenticated: boolean; userId: string | null } {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    if (!payload) return { authenticated: false, userId: null };
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    return { authenticated: claims.role === "authenticated", userId: typeof claims.sub === "string" ? claims.sub : null };
  } catch {
    return { authenticated: false, userId: null };
  }
}

// ---- 남용 방지: 사용자당 분당 호출 상한 (search-destination#checkRateLimit과 같은 방식) ----
// 로그인 확인만으로는 한 계정이 Gemini 호출(유료 API)을 무제한 반복하는 것을 막지 못한다 - 함수 인스턴스
// 메모리에만 두는 best-effort 제한이다(콜드 스타트·다중 인스턴스에서는 실제 상한이 설정값보다 높아질 수
// 있다 - 엄격한 보장이 필요해지면 Postgres 테이블 기반 리미터로 바꿔야 한다).
const RATE_LIMIT_PER_MINUTE = 10; // 조정 지점
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { windowStart: number; count: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  if (Math.random() < 0.01) {
    for (const [key, entry] of rateLimitMap) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(key);
    }
  }
  const entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_PER_MINUTE;
}

// ---- 이미지 ----

// base64 머리 몇 글자로 이미지 종류를 알아낸다 (요청에 mimeType이 없을 때 쓴다)
function sniffMimeType(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
}

const ALLOWED_MIME = /^image\/(jpeg|png|webp|gif|heic|heif)$/;

function readImage(body: unknown): { data: string; mimeType: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { imageBase64, mimeType } = body as { imageBase64?: unknown; mimeType?: unknown };
  if (typeof imageBase64 !== "string") return null;

  let data = imageBase64.trim();
  const dataUrl = /^data:([^;,]+);base64,/i.exec(data);
  if (dataUrl) data = data.slice(dataUrl[0].length);
  data = data.replace(/\s+/g, "");

  if (data.length === 0 || data.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;

  const declared = typeof mimeType === "string" ? mimeType : dataUrl?.[1];
  return { data, mimeType: declared && ALLOWED_MIME.test(declared) ? declared : sniffMimeType(data) };
}

// ---- Gemini ----

type GeminiResult = { value: unknown; retry: false } | { value: null; retry: boolean };

async function askGemini(image: { data: string; mimeType: string }, apiKey: string, model: string): Promise<GeminiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      // 키는 주소(?key=)가 아니라 헤더로 보낸다: 오류 메시지나 로그에 주소가 찍혀도 키가 새지 않는다
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: image.mimeType, data: image.data } }, { text: PROMPT }] }],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      // 429(요청 한도 초과), 503(수요 폭주), 403(키 문제), 404(모델 없음) 등. 이유만 남기고 앱에는 실패 안내를 준다.
      console.error("[analyze-ticket] Gemini 오류", model, res.status, payload?.error?.status, String(payload?.error?.message ?? "").slice(0, 200));
      return { value: null, retry: RETRYABLE_STATUS.has(res.status) };
    }

    const candidate = payload?.candidates?.[0];
    if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP")) {
      console.error("[analyze-ticket] Gemini가 답을 끝까지 만들지 못했어요", model, candidate?.finishReason ?? payload?.promptFeedback?.blockReason);
      return { value: null, retry: false };
    }

    // 생각(thought) 조각을 빼고 글자 조각만 이어 붙인다
    const text = (candidate.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => typeof part.text === "string" && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    return { value: JSON.parse(text), retry: false };
  } catch (err) {
    // 시간 초과(AbortError)나 네트워크 오류는 다른 모델로 다시 해 볼 수 있다. JSON을 읽지 못한 경우는 그대로 실패로 본다.
    const name = err instanceof Error ? err.name : "unknown";
    console.error("[analyze-ticket] Gemini 호출·해석 실패", model, name);
    return { value: null, retry: name === "AbortError" || name === "TypeError" };
  } finally {
    clearTimeout(timer);
  }
}

// 모델을 차례로 시도해서 처음 성공한 결과를 돌려준다. 다시 시도할 수 없는 실패(잘못된 키 등)면 바로 멈춘다.
async function askGeminiWithFallback(image: { data: string; mimeType: string }, apiKey: string): Promise<unknown | null> {
  for (const model of GEMINI_MODELS) {
    const result = await askGemini(image, apiKey, model);
    if (result.value !== null) return result.value;
    if (!result.retry) return null;
  }
  return null;
}

// ---- 결과 정리: 이상한 값은 null로 ----

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function date(value: unknown): string | null {
  const v = text(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v ? null : v;
}

function time(value: unknown): string | null {
  const v = text(value);
  const m = v && /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour > 23 || minute > 59 ? null : `${String(hour).padStart(2, "0")}:${m[2]}`;
}

function flightNo(value: unknown): string | null {
  const v = text(value)?.toUpperCase().replace(/[\s-]/g, "");
  return v && /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(v) ? v : null;
}

function airportCode(value: unknown, name: string | null): string | null {
  const v = text(value)?.toUpperCase();
  if (v && /^[A-Z]{3}$/.test(v)) return v;
  return name?.toUpperCase().match(/\(([A-Z]{3})\)/)?.[1] ?? null; // 코드가 따로 없으면 "인천(ICN)"에서 꺼낸다
}

function toTicket(raw: unknown) {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const no = flightNo(r.flightNo);
  const departureAirport = text(r.departureAirport);
  const arrivalAirport = text(r.arrivalAirport);

  return {
    airline: text(r.airline),
    airlineCode: no ? no.slice(0, 2) : null,
    flightNo: no,
    departureDate: date(r.departureDate),
    arrivalDate: date(r.arrivalDate),
    departureTime: time(r.departureTime),
    arrivalTime: time(r.arrivalTime),
    departureAirport,
    departureAirportCode: airportCode(r.departureAirportCode, departureAirport),
    arrivalAirport,
    arrivalAirportCode: airportCode(r.arrivalAirportCode, arrivalAirport),
  };
}

// 아무것도 읽지 못한 항목(항공권이 아닌 사진 등에서 나온 빈 항목)을 골라내는 기준
function hasAnyValue(ticket: ReturnType<typeof toTicket>): boolean {
  return [ticket.airline, ticket.flightNo, ticket.departureTime, ticket.arrivalTime, ticket.departureAirportCode, ticket.arrivalAirportCode].some(
    (value) => value !== null
  );
}

// 같은 항공편(편명+출발일)이 중복으로 오면 하나만 남긴다
function dedupeTickets(tickets: ReturnType<typeof toTicket>[]): ReturnType<typeof toTicket>[] {
  const seen = new Set<string>();
  return tickets.filter((t) => {
    const key = `${t.flightNo ?? ""}|${t.departureDate ?? ""}`;
    if (key === "|" || !seen.has(key)) {
      seen.add(key);
      return true;
    }
    return false;
  });
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
  const fail = () => json({ error: FAIL_MESSAGE });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);
  const { authenticated, userId } = authClaims(req);
  if (!authenticated || !userId) return json({ error: "로그인이 필요해요" }, 401);
  if (!checkRateLimit(userId)) return json({ error: "너무 자주 호출했어요. 잠시 뒤 다시 시도해주세요" }, 429);

  const body = await req.json().catch(() => null);
  const image = readImage(body);
  if (!image) return json({ error: "imageBase64(base64로 인코딩한 이미지)를 보내주세요" }, 400);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[analyze-ticket] GEMINI_API_KEY 비밀값이 설정되어 있지 않아요");
    return fail();
  }

  const raw = await askGeminiWithFallback(image, apiKey);
  if (raw === null) return fail();

  const rawTickets = Array.isArray((raw as { tickets?: unknown })?.tickets) ? (raw as { tickets: unknown[] }).tickets : [raw];
  const tickets = dedupeTickets(rawTickets.map(toTicket).filter(hasAnyValue));
  // 아무것도 읽지 못했으면(항공권이 아닌 사진 등) 빈 결과 대신 실패로 알린다
  if (tickets.length === 0) return fail();

  return json({ tickets });
});
