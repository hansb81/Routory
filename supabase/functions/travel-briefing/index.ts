// travel-briefing: 여행중 탭(마이트립) '여행 전' 카드의 현지 뉴스·할인 정보를 Google Gemini(구글 검색 도구)로
// 찾아서 JSON으로 돌려주는 Supabase Edge Function (Deno). analyze-ticket과 같은 Gemini 연동 패턴(모델 폴백,
// 로그인 확인, "실패도 HTTP 200")을 그대로 재사용한다 — 다른 점은 이미지가 아니라 텍스트 프롬프트를 보내고,
// Gemini의 구글 검색 도구(google_search)를 켜서 실제 웹검색 결과를 근거로 답하게 하는 것, 그리고 같은
// 목적지+기간 조합은 하루 한 번만 새로 부르고 나머지는 Postgres(briefing_cache 테이블, 009_travel_briefing.sql)에
// 캐싱해 둔 결과를 돌려주는 것이다.
//
// 요청:  POST { "destination": "도쿄, 일본", "startDate": "2026-10-10", "endDate": "2026-10-13" }
// 응답:  성공 {
//          news: [ { title, summary, sourceUrl, sourceName } ],   // 여행자에게 도움될 만한 최신 현지 뉴스, 최대 5개
//          deals: [ { title, summary, sourceUrl, sourceName } ],  // 항공권·숙소·투어 할인/프로모션, 최대 5개
//          fetchedAt: "<ISO 시각>",  // 이 결과가 만들어진(캐시에 저장된) 시각
//          cached: boolean,          // true면 오늘 안에 이미 만들어 둔 캐시를 그대로 돌려준 것 (Gemini를 새로 안 불렀다)
//          stale: boolean            // true면 "새로 부르려 했지만 실패해서" 24시간 지난 예전 캐시를 대신 돌려준 것
//        }
//        news/deals의 각 항목은 sourceUrl(출처 링크)이 있는 것만 담는다 - 출처를 못 찾았거나 URL 형식이
//        이상하면 그 항목 자체를 뺀다(아래 toResult 참고). 둘 다 비어 있을 수도 있다(뺄 게 없으면 - 이 경우도
//        실패가 아니라 성공 응답이다. analyze-ticket류와 달리 "아무것도 못 찾음"이 흔한 정상 결과라서다).
//        실패 { error: "최신 정보를 가져오지 못했어요" }  (Gemini 오류·요청 한도 초과 모두 HTTP 200 — 캐시도
//        없으면 이 실패를 돌려준다. 캐시가 있으면(오래됐어도) 실패 대신 stale:true로 그 캐시를 돌려준다.)
//
// 프롬프트/응답에 response_schema(구조화 출력 강제)를 쓰지 않는다 — Gemini API는 도구(tools, 여기선
// google_search)와 response_mime_type: "application/json" + response_schema를 같이 쓰는 걸 지원하지 않는다
// (문서화된 제약). 그래서 이 함수는 프롬프트로만 "JSON만 응답해"를 강하게 지시하고, analyze-ticket과 같은
// 방식(```json 코드펜스 제거 후 JSON.parse)으로 텍스트를 해석한 뒤 toResult()에서 한 번 더 형식을 검증한다.
//
// DB(briefing_cache) 접근은 @supabase/supabase-js를 쓰지 않고 PostgREST에 직접 fetch한다(naver-login과 달리,
// 여기선 Admin API처럼 SDK가 꼭 필요한 기능이 없다 - 단순 조회 1번 + upsert 1번뿐이라 raw REST가 더 가볍고,
// analyze-ticket/analyze-trip-import의 "이 파일엔 import 없음" 원칙과도 맞는다).
//
// 필요한 비밀값(secrets): GEMINI_API_KEY (analyze-ticket과 같은 값 - 이미 설정해 뒀다면 그대로 같이 쓴다)
// 선택 비밀값: GEMINI_MODEL (analyze-ticket과 같은 이름/기본값 - 아래 GEMINI_MODELS 참고)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로 넣어주는 값이라 따로
// 설정하지 않는다(naver-login과 같다). service_role 키는 briefing_cache 조회/저장에만 쓰고 이 파일 밖으로
// 나가지 않는다 - briefing_cache는 RLS 정책이 없어서(009_travel_briefing.sql) 이 키가 있어야만 접근된다.

const GEMINI_MODELS = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const GEMINI_TIMEOUT_MS = 20_000; // 모델 하나에 기다리는 시간. 응답이 없는 모델은 이 시간 뒤에 다음 모델로 넘어간다
// 다른 모델로 다시 시도해 볼 만한 상태: 404(단종) 408 429(한도) 500 502 503(수요 폭주) 504. 그 밖의 오류(잘못된 키·요청)는 모델을 바꿔도 같다.
const RETRYABLE_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);

const FAIL_MESSAGE = "최신 정보를 가져오지 못했어요";
const MAX_ITEMS = 5; // news/deals 각각 최대 개수 (Gemini가 지시보다 많이 줄 수 있어 서버에서도 한 번 더 자른다)
const CACHE_FRESH_MS = 24 * 60 * 60 * 1000; // "하루 한 번" = 이 시간(24시간) 안에 만들어진 캐시면 새로 안 부른다

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

const fail = () => json({ error: FAIL_MESSAGE });

// ---- 로그인 확인 ----
// Supabase가 서명을 이미 확인한 토큰(verify_jwt)이라 payload의 role만 본다.
// 앱에 공개돼 있는 anon 키만으로는 호출할 수 없게 해서, 누구나 Gemini 사용량을 쓰지 못하게 한다.
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

// ---- 요청 읽기 ----

const MAX_DESTINATION_CHARS = 200;

function readRequest(body: unknown): { destination: string; startDate: string; endDate: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { destination, startDate, endDate } = body as Record<string, unknown>;

  const dest = typeof destination === "string" ? destination.trim() : "";
  if (!dest || dest.length > MAX_DESTINATION_CHARS) return null;

  const isDateKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) return null;

  return { destination: dest, startDate, endDate };
}

// trip.startDate~trip.endDate 그대로 "~"로 이어붙인, briefing_cache의 캐시 키(date_range)
const dateRangeKey = (startDate: string, endDate: string) => `${startDate}~${endDate}`;

// ---- briefing_cache (PostgREST에 직접 fetch - 맨 위 주석 참고) ----

type BriefingContent = { news: BriefingItem[]; deals: BriefingItem[] };
type BriefingItem = { title: string; summary: string; sourceUrl: string; sourceName: string | null };
type CacheRow = { content: BriefingContent; created_at: string };

function restHeaders(serviceRoleKey: string, extra?: Record<string, string>) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...extra };
}

// destination+date_range에 맞는 캐시 행을 하나 찾는다(있으면). 새것/오래된 것 구분은 호출한 쪽이 created_at으로 한다.
async function readCache(supabaseUrl: string, serviceRoleKey: string, destination: string, dateRange: string): Promise<CacheRow | null> {
  const url =
    `${supabaseUrl}/rest/v1/briefing_cache` +
    `?destination=eq.${encodeURIComponent(destination)}&date_range=eq.${encodeURIComponent(dateRange)}` +
    `&select=content,created_at&limit=1`;
  try {
    const res = await fetch(url, { headers: restHeaders(serviceRoleKey) });
    if (!res.ok) {
      console.error("[travel-briefing] 캐시 조회 실패", res.status);
      return null;
    }
    const rows = (await res.json().catch(() => [])) as CacheRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.error("[travel-briefing] 캐시 조회 중 오류", err instanceof Error ? err.message : err);
    return null;
  }
}

// (destination, date_range) 유니크 제약(009_travel_briefing.sql)으로 upsert - 그 조합의 캐시 행 하나를 항상 덮어쓴다.
// created_at을 여기서 직접 보낸다: 컬럼 기본값(default now())은 최초 insert에만 적용되고 upsert의 update
// 경로에는 안 쓰이므로, "언제 마지막으로 갱신됐는지"를 계속 정확히 남기려면 매번 명시적으로 넣어야 한다.
async function writeCache(supabaseUrl: string, serviceRoleKey: string, destination: string, dateRange: string, content: BriefingContent, fetchedAt: string): Promise<void> {
  const url = `${supabaseUrl}/rest/v1/briefing_cache?on_conflict=destination,date_range`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: restHeaders(serviceRoleKey, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify([{ destination, date_range: dateRange, content, created_at: fetchedAt }]),
    });
    if (!res.ok) console.error("[travel-briefing] 캐시 저장 실패", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[travel-briefing] 캐시 저장 중 오류", err instanceof Error ? err.message : err);
  }
}

// ---- Gemini ----

function buildPrompt(destination: string, startDate: string, endDate: string): string {
  return [
    `목적지: ${destination}`,
    `여행 기간: ${startDate} ~ ${endDate}`,
    "",
    "구글 검색 도구로 이 목적지·기간과 관련된 최신 정보를 찾아서, 다른 설명 없이 아래 형식의 JSON만 응답해:",
    "{",
    '  "news": [ { "title": "", "summary": "", "sourceUrl": "", "sourceName": "" } ],',
    '  "deals": [ { "title": "", "summary": "", "sourceUrl": "", "sourceName": "" } ]',
    "}",
    "",
    `- news: 여행자에게 도움이 될 만한 이 목적지의 최신 뉴스(대중교통 요금 변경, 축제·행사, 파업, 기상특보, 치안 이슈 등). 최대 ${MAX_ITEMS}개.`,
    `- deals: 이 목적지 관련 항공권·숙소·투어 등 여행 할인/프로모션 정보. 최대 ${MAX_ITEMS}개.`,
    "- title과 summary는 한국어로 쓰고, summary는 1~2문장으로 짧게.",
    "- sourceUrl은 검색으로 실제 찾은 출처 기사/페이지의 정확한 URL만 써라. 확실한 출처 URL이 없으면 그 항목 자체를 배열에서 빼라 - URL을 지어내지 마라.",
    "- sourceName은 출처 매체·사이트 이름(예: '요미우리신문', 'Klook'). 모르면 null.",
    "- 이 목적지·기간과 무관하거나 너무 오래돼서(1년 이상 지난 뉴스 등) 지금 여행 계획에 도움이 안 되는 내용은 빼라.",
    "- 찾은 내용이 없으면 해당 배열을 빈 배열로 둬라 (억지로 채우지 마라).",
  ].join("\n");
}

type GeminiResult = { value: unknown; retry: false } | { value: null; retry: boolean };

async function askGemini(prompt: string, apiKey: string, model: string): Promise<GeminiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      // 키는 주소(?key=)가 아니라 헤더로 보낸다: 오류 메시지나 로그에 주소가 찍혀도 키가 새지 않는다
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }], // 실제 웹검색 결과를 근거로 답하게 하는 Gemini 내장 도구 (요청 1번)
        // response_mime_type/response_schema는 일부러 안 쓴다 - 맨 위 주석 참고 (tools와 함께 못 쓴다)
        generationConfig: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      // 429(요청 한도 초과), 503(수요 폭주), 403(키 문제), 404(모델 없음) 등. 이유만 남기고 앱에는 실패 안내를 준다.
      console.error("[travel-briefing] Gemini 오류", model, res.status, payload?.error?.status, String(payload?.error?.message ?? "").slice(0, 200));
      return { value: null, retry: RETRYABLE_STATUS.has(res.status) };
    }

    const candidate = payload?.candidates?.[0];
    if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP")) {
      console.error("[travel-briefing] Gemini가 답을 끝까지 만들지 못했어요", model, candidate?.finishReason ?? payload?.promptFeedback?.blockReason);
      return { value: null, retry: false };
    }

    // 생각(thought) 조각을 빼고 글자 조각만 이어 붙인다 (검색 도구를 쓸 때도 답은 text 조각으로 온다)
    const text = (candidate.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => typeof part.text === "string" && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    // google_search 도구를 쓰면(response_schema를 못 써서 프롬프트 지시만으로 JSON을 받는다 - 맨 위 주석
    // 참고) 모델이 지시를 어기고 JSON 앞뒤에 안내 문구나 출처 각주를 붙이는 일이 흔하다. 전체 문자열이
    // 아니라 그 안의 첫 {...} 블록만 잘라내 관용적으로 파싱한다.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return { value: JSON.parse(jsonMatch ? jsonMatch[0] : text), retry: false };
  } catch (err) {
    // 시간 초과(AbortError)나 네트워크 오류, 그리고 JSON을 못 읽은 경우(SyntaxError - 위 설명대로 검색 도구를
    // 쓰면 모델이 가끔 지시를 어긴다) 모두 다른 모델로 다시 시도해 볼 수 있다.
    const name = err instanceof Error ? err.name : "unknown";
    console.error("[travel-briefing] Gemini 호출·해석 실패", model, name);
    return { value: null, retry: name === "AbortError" || name === "TypeError" || name === "SyntaxError" };
  } finally {
    clearTimeout(timer);
  }
}

// 모델을 차례로 시도해서 처음 성공한 결과를 돌려준다. 다시 시도할 수 없는 실패(잘못된 키 등)면 바로 멈춘다.
async function askGeminiWithFallback(prompt: string, apiKey: string): Promise<unknown | null> {
  for (const model of GEMINI_MODELS) {
    const result = await askGemini(prompt, apiKey, model);
    if (result.value !== null) return result.value;
    if (!result.retry) return null;
  }
  return null;
}

// ---- 결과 정리: 이상한 값·출처 없는 항목은 뺀다 ----

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

// http(s) URL만 인정한다 (javascript:, data: 등은 링크로 내보내지 않는다)
function sourceUrl(value: unknown): string | null {
  const v = text(value);
  if (!v) return null;
  try {
    const parsed = new URL(v);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function toItems(raw: unknown): BriefingItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const r = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      const url = sourceUrl(r.sourceUrl);
      const title = text(r.title);
      const summary = text(r.summary);
      if (!url || !title || !summary) return null; // 출처 링크 없는 항목은 요청 1번대로 통째로 뺀다
      return { title, summary, sourceUrl: url, sourceName: text(r.sourceName) };
    })
    .filter((item): item is BriefingItem => item !== null)
    .slice(0, MAX_ITEMS);
}

function toResult(raw: unknown): BriefingContent {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return { news: toItems(r.news), deals: toItems(r.deals) };
}

// ---- 요청 처리 ----

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);
  if (!isSignedIn(req)) return json({ error: "로그인이 필요해요" }, 401);

  const body = await req.json().catch(() => null);
  const params = readRequest(body);
  if (!params) return json({ error: "destination, startDate, endDate(YYYY-MM-DD)를 보내주세요" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[travel-briefing] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않아요");
    return fail();
  }

  const dateRange = dateRangeKey(params.startDate, params.endDate);
  const cached = await readCache(supabaseUrl, serviceRoleKey, params.destination, dateRange);

  // 하루(24시간) 안에 만든 캐시가 있으면 그대로 돌려준다 (요청 2번: 같은 목적지+기간은 하루 한 번만 새로 호출)
  if (cached && Date.now() - new Date(cached.created_at).getTime() < CACHE_FRESH_MS) {
    return json({ ...cached.content, fetchedAt: cached.created_at, cached: true, stale: false });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[travel-briefing] GEMINI_API_KEY 비밀값이 설정되어 있지 않아요");
    return cached ? json({ ...cached.content, fetchedAt: cached.created_at, cached: true, stale: true }) : fail();
  }

  const raw = await askGeminiWithFallback(buildPrompt(params.destination, params.startDate, params.endDate), apiKey);
  if (raw === null) {
    // 새로 부르는 데 실패했어도, 오래된 캐시라도 있으면 없는 것보다는 낫다 - stale:true로 표시해서 돌려준다.
    return cached ? json({ ...cached.content, fetchedAt: cached.created_at, cached: true, stale: true }) : fail();
  }

  const content = toResult(raw);
  const fetchedAt = new Date().toISOString();
  await writeCache(supabaseUrl, serviceRoleKey, params.destination, dateRange, content, fetchedAt);

  return json({ ...content, fetchedAt, cached: false, stale: false });
});
