// analyze-trip-import: 여행 관련 자료(일정표/예약확인서/메모 - 사진·PDF 또는 텍스트)를 Google Gemini로 읽어서
// 새 여행(trip)·일정(scheduleItems)·가계부(expenses) 후보를 JSON으로 돌려주는 Supabase Edge Function (Deno).
// PRD v8 "여행 가져오기 기능"용. analyze-ticket(항공권 단일 항목)과 역할이 달라서(한 번에 여러 일정/비용을
// 추출) 별개 함수로 둔다 — 코드 구조(로그인 확인, 모델 폴백, 재시도 규칙)는 그대로 옮겨 왔다.
//
// 요청:  POST  { "imageBase64": "<base64 문자열>", "mimeType": "image/jpeg" }  또는  { "text": "여행 일정 텍스트" }
//        (둘 다 보내도 된다 - 사진과 텍스트를 같이 분석한다. 최소 하나는 있어야 한다.)
//        선택으로 { "tripStartDate": "YYYY-MM-DD" } - append 모드(기존 여행에 더하기)일 때만 클라이언트가
//        그 여행의 저장된 시작일을 보낸다. "1일차"/"Day 2"/"둘째날"처럼 달력 날짜 없이 상대적으로만 날짜를
//        표현한 자료를 Gemini가 dayOffset(아래 참고)으로 뽑을 근거가 된다.
// 응답:  성공 {
//          trip: { title, destination, startDate, endDate } | null,
//          scheduleItems: [ { date, dayOffset, time, category, title, place, memo } ],
//          expenses: [ { dayKey, dayOffset, amount, currency, category, title } ]
//        }  (모르는 값은 null. 날짜/dayOffset이 둘 다 없는 일정, 금액이 없는 비용 항목은 통째로 뺀다 - 아래
//        toResult 참고. date/dayKey는 자료에 실제 달력 날짜가 있을 때만 채워진다 - "1일차"처럼 여행 시작일
//        기준 상대 표현만 있으면 date/dayKey는 null이고 dayOffset(0부터 시작하는 정수)만 채워지므로, 그 경우
//        호출한 쪽이 실제 여행 시작일 + dayOffset일로 날짜를 계산해야 한다 - tripImportPreview.js#resolveDayOffsets 참고)
//        실패 { error: "분석에 실패했어요. 직접 입력해주세요" }
//        (Gemini 오류·요청 한도 초과·아무것도 못 읽음 모두 HTTP 200으로 돌려줘서 앱이 멈추지 않게 한다)
//
// 사진/파일/텍스트는 어디에도 저장하지 않는다. 요청 안에서 Gemini로 한 번 보내고, 응답을 돌려주면 메모리에서
// 사라진다. 항공권 기능(analyze-ticket)과 같은 원칙. 결과도 여기서 DB에 바로 쓰지 않는다 - 클라이언트가
// 미리보기 화면에서 사용자 확인을 받은 뒤에만 저장한다(PRD v8 5번).
//
// 필요한 비밀값(secrets): GEMINI_API_KEY
// 선택 비밀값: GEMINI_MODEL  쉼표로 여러 개(기본은 아래 GEMINI_MODELS 참고).
//   analyze-ticket과 같은 비밀값 이름을 그대로 쓴다 - 이미 설정해 뒀다면 두 함수가 같이 그 값을 쓴다.
//   앞의 모델이 일시적으로 막히면(503 수요 폭주, 429 한도 초과, 시간 초과, 404 단종) 다음 모델로 다시 시도한다.
//   supabase secrets set GEMINI_MODEL=gemini-2.5-flash,gemini-3.5-flash-lite,...
// 이 파일에는 키를 쓰지 않는다. 키는 Supabase 비밀값으로만 넣는다.

// 기본값 맨 앞은 요청받은 gemini-2.5-flash. 다만 analyze-ticket을 만들 때 이미 겪은 문제인데, 이 모델은
// 새로 발급한 키에서는 404("no longer available to new users")가 나는 경우가 있다 - 그래서 뒤에 analyze-ticket과
// 같은 검증된 폴백 모델들을 이어 붙여 둔다. 404도 재시도 대상(RETRYABLE_STATUS)이라 자동으로 다음 모델로 넘어간다.
const GEMINI_MODELS = (
  Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const GEMINI_TIMEOUT_MS = 20_000; // 모델 하나에 기다리는 시간. 응답이 없는 모델은 이 시간 뒤에 다음 모델로 넘어간다
// 다른 모델로 다시 시도해 볼 만한 상태: 404(단종) 408 429(한도) 500 502 503(수요 폭주) 504. 그 밖의 오류(잘못된 키·요청)는 모델을 바꿔도 같다.
const RETRYABLE_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);
const MAX_BASE64_CHARS = 14 * 1024 * 1024; // base64 14M글자 ≈ 파일 약 10MB (Gemini 요청 한도 20MB보다 여유 있게)
const MAX_TEXT_CHARS = 20_000; // 여행 일정을 붙여넣는 텍스트어리아 하나 분량이면 충분하고 넘치는 값

const FAIL_MESSAGE = "분석에 실패했어요. 직접 입력해주세요";

const CATEGORY_LIST = "flight|lodging|meal|sightseeing|shopping|etc"; // scheduleItems (myTripData.CATEGORY_META와 같은 6개)
const EXPENSE_CATEGORY_LIST = "flight|lodging|transport|meal|shopping|tour|etc"; // expenses (expenseCategoryData.js와 같은 7개)

// scheduleItems/expenses는 날짜를 두 가지 방식 중 하나로 표현할 수 있다 - 자료에 실제 달력 날짜가 있으면
// date/dayKey에 그대로 쓰고, "1일차"/"Day 2"/"둘째날"처럼 여행 시작일 기준 상대적인 표현만 있으면(언어 무관 -
// 한글 서수·숫자+일차, 영어 Day N/서수 등 어떤 표현이든) dayOffset(0부터 시작하는 정수)에 넣는다. 이렇게
// 나누는 이유: "1일차"를 실제 날짜로 바꾸려면 여행 시작일을 알아야 하는데, 자료 자체에 시작일이 없으면(예:
// 영수증 목록이 "1일차 커피 5,000원"처럼 날짜 없이 상대 표현만 쓰는 경우) Gemini가 계산할 근거가 없다 -
// 그래서 상대 표현 인식(언어 이해가 필요한 부분, Gemini가 잘하는 일)과 날짜 계산(단순 덧셈, 클라이언트가
// 실제 여행 시작일 - append면 그 여행의 저장된 시작일, create면 사용자가 미리보기에서 입력/수정한 시작일 -
// 로 정확히 계산)을 나눴다. 둘 다 못 읽었으면 이전처럼 그 항목을 뺀다(scheduleItems는 date 없인 쓸모없고,
// expenses는 dayKey 없인 어느 Day에 넣을지 모른다).
function buildPrompt(tripStartDate: string | null): string {
  const lines = [
    "이 여행 관련 자료(여행 일정표, 예약확인서, 메모 등)를 분석해서 다음 JSON으로만 응답해:",
    "{",
    '  "trip": { "title": "", "destination": "", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" } 또는 null,',
    '  "scheduleItems": [ { "date": "YYYY-MM-DD"|null, "dayOffset": 0|null, "time": "HH:mm"|null, "category": "" , "title": "", "place": ""|null, "memo": ""|null } ],',
    '  "expenses": [ { "dayKey": "YYYY-MM-DD"|null, "dayOffset": 0|null, "amount": 0, "currency": "", "category": "", "title": "" } ]',
    "}",
    "",
    "규칙:",
    `- scheduleItems의 category는 ${CATEGORY_LIST} 중 하나만 쓰고, 확실하지 않으면 null.`,
    `- expenses의 category는 ${EXPENSE_CATEGORY_LIST} 중 하나만 쓰고, 확실하지 않으면 null.`,
    "- trip은 자료 전체가 다루는 여행 하나를 요약한 것이다. 제목·여행지·시작일·종료일 중 아무것도 확실하지 않으면 trip 자체를 null로.",
    "- 날짜는 두 가지 중 하나로 표현해라: (1) 자료에 실제 달력 날짜가 있으면(또는 확실히 유추되면) date/dayKey에 YYYY-MM-DD로. " +
      "(2) 달력 날짜 없이 여행 시작일 기준 상대적인 표현만 있으면(\"1일차\", \"첫째날\", \"둘째날\", \"Day 1\", \"Day 2\", " +
      "\"day one\", \"이틀째\" 등 - 한글·영어·숫자+단위 어떤 형식이든, 1일차/첫째날/Day 1은 0, 2일차/둘째날/Day 2는 1처럼 " +
      "0부터 시작하는 오프셋으로) dayOffset에 정수로. 대신 date/dayKey는 null로 둔다. 준비물처럼 날짜 표현 자체가 없는 " +
      "항목이면 date/dayOffset(또는 dayKey/dayOffset) 둘 다 null로 하고, 그런 scheduleItems 항목은 배열에서 빼라 " +
      "(expenses의 dayKey는 여행 준비를 뜻하는 문자열 \"prep\"도 허용 - 이때 dayOffset은 null).",
    "- expenses의 amount는 숫자만(통화 기호·쉼표 없이), currency는 KRW/USD 같은 통화 코드. 금액이 불확실하면 그 비용 항목은 배열에서 빼라.",
    "- 자료에 실제로 적혀 있거나 명확히 유추되는 내용만 쓰고, 추측으로 지어내지 마라. 여행과 무관한 자료이거나 아무것도 못 읽으면 trip은 null, scheduleItems와 expenses는 빈 배열로.",
  ];
  if (tripStartDate) {
    lines.push(
      `- 이 여행은 이미 시작일이 ${tripStartDate}로 정해져 있다. 상대적 날짜 표현이 나오면 이 시작일을 기준으로 dayOffset을 계산해라 ` +
        "(직접 날짜를 계산해서 date/dayKey에 넣지 말고, 위 규칙대로 dayOffset에 정수만 넣어라 - 실제 날짜 계산은 이 시작일로 클라이언트가 한다)."
    );
  }
  return lines.join("\n");
}

// Gemini 구조화 출력: 이 모양의 JSON만 나오도록 강제한다. 값 자체가 맞는지(날짜 형식, 카테고리 값 등)는
// 강제하지 않고(Gemini가 지시를 어길 수 있으므로) 아래 toResult()에서 한 번 더 걸러낸다 - analyze-ticket과 같은 방식.
const nullableString = { type: "STRING", nullable: true };
const nullableInt = { type: "INTEGER", nullable: true };
const TRIP_SCHEMA = {
  type: "OBJECT",
  nullable: true,
  properties: {
    title: nullableString,
    destination: nullableString,
    startDate: nullableString,
    endDate: nullableString,
  },
  required: ["title", "destination", "startDate", "endDate"],
};
const SCHEDULE_ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    date: nullableString,
    dayOffset: nullableInt,
    time: nullableString,
    category: nullableString,
    title: nullableString,
    place: nullableString,
    memo: nullableString,
  },
  required: ["date", "dayOffset", "time", "category", "title", "place", "memo"],
};
const EXPENSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dayKey: nullableString,
    dayOffset: nullableInt,
    amount: { type: "NUMBER", nullable: true },
    currency: nullableString,
    category: nullableString,
    title: nullableString,
  },
  required: ["dayKey", "dayOffset", "amount", "currency", "category", "title"],
};
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    trip: TRIP_SCHEMA,
    scheduleItems: { type: "ARRAY", items: SCHEDULE_ITEM_SCHEMA },
    expenses: { type: "ARRAY", items: EXPENSE_SCHEMA },
  },
  required: ["trip", "scheduleItems", "expenses"],
};

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

// ---- 입력(이미지/파일 base64 + 텍스트, 둘 다 올 수도 있다) ----

// base64 머리 몇 글자로 파일 종류를 알아낸다 (요청에 mimeType이 없을 때 쓴다)
function sniffMimeType(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("JVBERi0")) return "application/pdf";
  return "image/jpeg";
}

const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;

function readImage(body: Record<string, unknown>): { data: string; mimeType: string } | null {
  const { imageBase64, mimeType } = body;
  if (typeof imageBase64 !== "string") return null;

  let data = imageBase64.trim();
  const dataUrl = /^data:([^;,]+);base64,/i.exec(data);
  if (dataUrl) data = data.slice(dataUrl[0].length);
  data = data.replace(/\s+/g, "");

  if (data.length === 0 || data.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;

  const declared = typeof mimeType === "string" ? mimeType : dataUrl?.[1];
  return { data, mimeType: declared && ALLOWED_MIME.test(declared) ? declared : sniffMimeType(data) };
}

function readText(body: Record<string, unknown>): string | null {
  const { text } = body;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT_CHARS);
}

// append 모드(기존 여행에 더하기)일 때 클라이언트가 그 여행의 저장된 시작일을 보낸다 - "1일차"처럼 상대적인
// 날짜 표현을 Gemini가 실제 날짜 대신 dayOffset으로만 뽑게 하는 근거로 프롬프트에 넣는다(create 모드는 여행이
// 아직 없어서 안 보낸다 - trip.startDate를 자료에서 직접 추출해야 한다).
function readTripStartDate(body: Record<string, unknown>): string | null {
  const { tripStartDate } = body;
  if (typeof tripStartDate !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(tripStartDate) ? tripStartDate : null;
}

// ---- Gemini ----

type GeminiResult = { value: unknown; retry: false } | { value: null; retry: boolean };
type GeminiContentPart = { inline_data: { mime_type: string; data: string } } | { text: string };

async function askGemini(parts: GeminiContentPart[], apiKey: string, model: string): Promise<GeminiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      // 키는 주소(?key=)가 아니라 헤더로 보낸다: 오류 메시지나 로그에 주소가 찍혀도 키가 새지 않는다
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
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
      console.error(
        "[analyze-trip-import] Gemini 오류",
        model,
        res.status,
        payload?.error?.status,
        String(payload?.error?.message ?? "").slice(0, 200)
      );
      return { value: null, retry: RETRYABLE_STATUS.has(res.status) };
    }

    const candidate = payload?.candidates?.[0];
    if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP")) {
      console.error(
        "[analyze-trip-import] Gemini가 답을 끝까지 만들지 못했어요",
        model,
        candidate?.finishReason ?? payload?.promptFeedback?.blockReason
      );
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
    console.error("[analyze-trip-import] Gemini 호출·해석 실패", model, name);
    return { value: null, retry: name === "AbortError" || name === "TypeError" };
  } finally {
    clearTimeout(timer);
  }
}

// 모델을 차례로 시도해서 처음 성공한 결과를 돌려준다. 다시 시도할 수 없는 실패(잘못된 키 등)면 바로 멈춘다.
async function askGeminiWithFallback(parts: GeminiContentPart[], apiKey: string): Promise<unknown | null> {
  for (const model of GEMINI_MODELS) {
    const result = await askGemini(parts, apiKey, model);
    if (result.value !== null) return result.value;
    if (!result.retry) return null;
  }
  return null;
}

// ---- 결과 정리: 이상한 값은 null로, 핵심 값(날짜·금액)이 없는 항목은 통째로 뺀다 ----

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function date(value: unknown): string | null {
  const v = text(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v ? null : v;
}

// scheduleItems의 date와 달리 expenses의 dayKey는 "prep"(여행 준비)도 허용한다
function dayKey(value: unknown): string | null {
  const v = text(value);
  if (v === "prep") return "prep";
  return date(value);
}

function time(value: unknown): string | null {
  const v = text(value);
  const m = v && /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour > 23 || minute > 59 ? null : `${String(hour).padStart(2, "0")}:${m[2]}`;
}

function amount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "1일차"/"Day 2" 같은 상대 표현의 0부터 시작하는 오프셋. 음수나 비정수는 버린다(Gemini가 지시를 어겼을 때).
function dayOffsetOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function currency(value: unknown): string | null {
  const v = text(value)?.toUpperCase();
  return v && /^[A-Z]{3}$/.test(v) ? v : null;
}

function categoryOf(value: unknown, allowed: readonly string[]): string | null {
  const v = text(value)?.toLowerCase();
  return v && (allowed as string[]).includes(v) ? v : null;
}

const SCHEDULE_CATEGORIES = ["flight", "lodging", "meal", "sightseeing", "shopping", "etc"] as const;
const EXPENSE_CATEGORIES = ["flight", "lodging", "transport", "meal", "shopping", "tour", "etc"] as const;

function toTrip(raw: unknown): { title: string | null; destination: string | null; startDate: string | null; endDate: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const trip = {
    title: text(r.title),
    destination: text(r.destination),
    startDate: date(r.startDate),
    endDate: date(r.endDate),
  };
  // 넷 다 못 읽었으면 trip 자체가 의미 없으니 null로 (analyze-ticket의 "아무것도 못 읽으면 실패"와 같은 원칙)
  return Object.values(trip).every((v) => v === null) ? null : trip;
}

// date/dayOffset 중 하나는 있어야 쓸모가 있다(둘 다 null이면 그 항목은 뺀다) - date가 없고 dayOffset만
// 있으면 클라이언트가 실제 여행 시작일로 date를 계산해 채운다(tripImportPreview.js#resolveDayOffsets).
function toScheduleItems(
  raw: unknown
): Array<{ date: string | null; dayOffset: number | null; time: string | null; category: string | null; title: string | null; place: string | null; memo: string | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const r = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      return {
        date: date(r.date),
        dayOffset: dayOffsetOf(r.dayOffset),
        time: time(r.time),
        category: categoryOf(r.category, SCHEDULE_CATEGORIES),
        title: text(r.title),
        place: text(r.place),
        memo: text(r.memo),
      };
    })
    .filter((item) => item.date !== null || item.dayOffset !== null); // 날짜도 상대 오프셋도 없는 일정은 쓸모가 없어서 뺀다
}

function toExpenses(
  raw: unknown
): Array<{ dayKey: string | null; dayOffset: number | null; amount: number; currency: string; category: string | null; title: string | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const r = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      return {
        dayKey: dayKey(r.dayKey),
        dayOffset: dayOffsetOf(r.dayOffset),
        amount: amount(r.amount),
        currency: currency(r.currency) ?? "KRW", // 통화를 못 읽으면 가계부 기본값(KRW)으로 - PRD v6과 같은 기본값
        category: categoryOf(r.category, EXPENSE_CATEGORIES),
        title: text(r.title),
      };
    })
    .filter(
      (item): item is typeof item & { amount: number } => (item.dayKey !== null || item.dayOffset !== null) && item.amount !== null
    ); // 날짜·오프셋 둘 다 없거나 금액 없는 비용은 뺀다
}

function toResult(raw: unknown) {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    trip: toTrip(r.trip),
    scheduleItems: toScheduleItems(r.scheduleItems),
    expenses: toExpenses(r.expenses),
  };
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body !== "object" || body === null) return json({ error: "imageBase64 또는 text 중 하나를 보내주세요" }, 400);

  const image = readImage(body);
  const inputText = readText(body);
  const tripStartDate = readTripStartDate(body);
  if (!image && !inputText) return json({ error: "imageBase64 또는 text 중 하나를 보내주세요" }, 400);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[analyze-trip-import] GEMINI_API_KEY 비밀값이 설정되어 있지 않아요");
    return fail();
  }

  // 사진/파일과 텍스트가 둘 다 왔으면 둘 다 보낸다. 지시문(PROMPT)은 항상 맨 뒤에 붙인다.
  const parts: GeminiContentPart[] = [];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  if (inputText) parts.push({ text: `사용자가 붙여넣은 텍스트:\n\n${inputText}` });
  parts.push({ text: buildPrompt(tripStartDate) });

  const raw = await askGeminiWithFallback(parts, apiKey);
  if (raw === null) return fail();

  const result = toResult(raw);
  // 여행도, 일정도, 비용도 하나도 못 건졌으면(여행과 무관한 자료 등) 빈 결과 대신 실패로 알린다
  if (result.trip === null && result.scheduleItems.length === 0 && result.expenses.length === 0) return fail();

  return json(result);
});
