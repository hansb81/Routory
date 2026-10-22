// naver-login: 네이버 OAuth2.0 인가 코드를 Supabase 로그인에 쓸 수 있는 토큰으로 바꿔주는 Supabase Edge
// Function (Deno). Supabase의 소셜 로그인 제공자 목록에 네이버가 없어서(triplog/js/loginPage.js 참고), 인가
// 코드 교환·프로필 조회·계정 연결을 이 함수가 대신 한다.
//
// 요청:  POST { "code": "<네이버가 돌려준 인가 코드>", "state": "<인가 요청 때 실었던 state 값>" }
//        code/state는 triplog/auth/naver-callback.html이 네이버에서 돌아온 주소의 쿼리스트링(?code=&state=)을
//        그대로 옮겨 보낸다. state가 로그인을 시작할 때 sessionStorage에 저장해 둔 값과 맞는지는 그 페이지가
//        먼저 확인한다(CSRF) — 이 함수는 그 값을 그대로 네이버 토큰 요청에 실어 보내기만 한다(네이버 쪽에서도
//        한 번 더 대조한다).
//
// 응답:  성공 200 { "hashedToken": "<verifyOtp에 쓸 토큰>" }
//          이 함수는 세션을 직접 만들지 않는다 — 클라이언트(triplog/auth/naver-callback.html)가 나중에
//          supabase.auth.verifyOtp({ type: "email", token_hash: hashedToken })로 이 토큰을 실제 로그인
//          세션으로 바꾼다. type이 "email"인 이유는 6번 주석 참고. token_hash만으로 확인할 수 있어서(email
//          없이) 아래 4번의 내부용 이메일은 클라이언트 응답에 전혀 실리지 않는다.
//        실패 다음 중 하나의 상태 코드 + { "error": "<한국어 메시지>" }:
//          400 code/state가 없거나 형식이 이상함, 401 네이버가 인가 코드를 거절함(만료·재사용 등),
//          502 네이버 서버와 통신하지 못함(네트워크 오류 등), 500 로그인 처리(Supabase Admin API) 실패,
//          405 POST가 아님.
//
// 네이버 인가 코드/액세스 토큰/프로필은 어디에도 저장하지 않는다 — 이 요청 안에서만 쓰고 사라진다.
//
// 필요한 비밀값(secrets):
//   NAVER_CLIENT_ID       네이버 디벨로퍼스 애플리케이션의 Client ID (triplog/js/config.js의 naverClientId와 같은 값이어야 한다)
//   NAVER_CLIENT_SECRET   같은 애플리케이션의 Client Secret. 브라우저로는 절대 보내지 않는 값이라 서버(이 함수)에만 둔다.
//   supabase secrets set NAVER_CLIENT_ID=<client id> NAVER_CLIENT_SECRET=<client secret>
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로 넣어주는 값이라 따로
// 설정하지 않는다(대시보드 → Edge Functions → Secrets에 이미 있다). service_role 키는 Supabase Admin API
// 호출(사용자 조회·생성·로그인 토큰 발급)에만 쓰고, 이 파일 밖으로 나가지 않는다.
//
// 다른 두 함수(analyze-ticket, analyze-trip-import)와 달리 이 함수는 import를 쓴다: 사용자 조회/생성/로그인
// 토큰 발급(Admin API)을 직접 REST로 구현하는 대신 공식 SDK를 쓰는 편이 더 안전하고(서명·에러 형식을 SDK가
// 맞춰 준다) 짧다. 버전은 고정해 둔다(예고 없이 바뀌지 않도록) — 올릴 때는 이 숫자만 바꾸면 된다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
const NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me";
const INTERNAL_EMAIL_DOMAIN = "users.triplog.app"; // 실제로 열리는 도메인일 필요는 없다 — Supabase 계정 식별자로만 쓴다
const MAX_PARAM_CHARS = 2048; // code/state는 이보다 훨씬 짧지만, 이상한 값을 그대로 네이버에 보내지 않기 위한 상한

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

// ---- 요청 읽기 ----

function readCodeAndState(body: unknown): { code: string | null; state: string | null } {
  if (typeof body !== "object" || body === null) return { code: null, state: null };
  const { code, state } = body as { code?: unknown; state?: unknown };
  const clean = (value: unknown) => (typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PARAM_CHARS ? value.trim() : null);
  return { code: clean(code), state: clean(state) };
}

// ---- 네이버 ----

// 2) 인가 코드를 액세스 토큰으로 바꾼다. client_secret은 여기(서버)에서만 붙인다.
async function exchangeNaverToken(params: { code: string; state: string; clientId: string; clientSecret: string }): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      state: params.state,
    });
    const res = await fetch(NAVER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const payload = await res.json().catch(() => null);
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token : null;
    if (!res.ok || !accessToken) {
      // 네이버는 오류도 200으로 돌려줄 때가 있어서(error/error_description) res.ok만으로는 못 걸러낸다
      console.error("[naver-login] 네이버 토큰 교환 실패", res.status, payload?.error, payload?.error_description);
      return null;
    }
    return accessToken;
  } catch (err) {
    console.error("[naver-login] 네이버 토큰 요청 실패", err instanceof Error ? err.message : err);
    return null;
  }
}

type NaverProfile = { naverId: string; email: string | null; nickname: string | null; profileImage: string | null };

// 3) 액세스 토큰으로 프로필(id/email/nickname/profile_image)을 받는다.
async function fetchNaverProfile(accessToken: string): Promise<NaverProfile | null> {
  try {
    const res = await fetch(NAVER_PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await res.json().catch(() => null);
    const info = payload?.response;
    if (!res.ok || payload?.resultcode !== "00" || typeof info?.id !== "string" || !info.id) {
      console.error("[naver-login] 네이버 프로필 조회 실패", res.status, payload?.resultcode, payload?.message);
      return null;
    }
    return {
      naverId: info.id,
      email: typeof info.email === "string" && info.email ? info.email : null,
      nickname: typeof info.nickname === "string" && info.nickname ? info.nickname : null,
      profileImage: typeof info.profile_image === "string" && info.profile_image ? info.profile_image : null,
    };
  } catch (err) {
    console.error("[naver-login] 네이버 프로필 요청 실패", err instanceof Error ? err.message : err);
    return null;
  }
}

// 4) 네이버 이메일은 없을 수도, 있어도 못 믿을 수도 있어서(동의만 하면 되고 인증된 값이 아니다) Supabase 계정을
// 구분하는 값으로는 절대 쓰지 않는다 — 네이버가 보장하는 고유값인 id로 내부용 이메일을 만들어 대신 쓴다.
// 실제 네이버 이메일은 참고용으로 user_metadata.naver_email에만 남긴다.
function buildInternalEmail(naverId: string): string {
  const safeId = naverId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `naver_${safeId}@${INTERNAL_EMAIL_DOMAIN}`;
}

// ---- Supabase Admin ----

// createClient의 반환 타입 그대로 쓰면 admin.auth.admin.* 메서드를 부를 때마다 제네릭(스키마 타입) 불일치로
// 타입 오류가 난다 — 이 함수는 스키마를 다루지 않고 auth Admin API만 부르므로 any로 충분하다.
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

// supabase-js admin API에는 "이메일로 한 명 찾기"가 따로 없어서 목록 조회의 filter로 찾는다. filter가 부분
// 일치일 수 있어 정확히 같은 이메일인지 다시 확인한다. 이 조회가 실패하거나 못 찾아도 아래 ensureNaverUser의
// createUser 중복 처리가 안전망 역할을 하므로, 로그인 자체를 막지 않고 null만 돌려준다.
async function findUserByEmail(admin: SupabaseAdmin, email: string) {
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1, filter: email } as never);
    if (error) {
      console.warn("[naver-login] 사용자 조회 실패(계속 진행)", error.message);
      return null;
    }
    return data.users.find((u: { email?: string | null }) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  } catch (err) {
    console.warn("[naver-login] 사용자 조회 중 오류(계속 진행)", err instanceof Error ? err.message : err);
    return null;
  }
}

// 5) 있으면 그대로, 없으면 admin.createUser로 만든다. 조회 단계가 (filter 미지원 등으로) 있는 사용자를 놓쳤어도
// createUser가 "이미 등록된 이메일" 오류를 돌려주면 그 계정을 있는 것으로 취급한다 — 그래서 두 번 만들어지지 않는다.
async function ensureNaverUser(
  admin: SupabaseAdmin,
  email: string,
  metadata: { provider: "naver"; naver_id: string; nickname: string | null; avatar_url: string | null; naver_email: string | null }
): Promise<void> {
  const existing = await findUserByEmail(admin, email);
  if (existing) return;

  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: metadata });
  if (!error) return;

  const alreadyExists = /already.*(registered|exists)|email_exists/i.test(error.message ?? "");
  if (alreadyExists) return; // 방금 조회에서 놓쳤을 뿐, 실제로는 있는 계정이다

  throw error;
}

// 6) 로그인용 토큰을 받는다. 실제로 메일을 보내는 게 아니라(magiclink 타입이지만) 토큰만 꺼내 쓴다 — 클라이언트가
// verifyOtp({ type: "email", token_hash })로 이 값을 세션으로 바꾼다. generateLink에 넣는 type("magiclink")과
// verifyOtp에 넣는 type("email")이 다른 이유: token_hash로 확인할 때는 Supabase가 "email 계열 토큰"이라는
// 뜻의 공통 type을 쓰고(실제로 어떤 종류로 발급됐는지는 토큰 자체에 담겨 있다), generateLink 쪽 type은 그
// 토큰을 "어떤 방식으로 만들지"를 고르는 값이라 서로 다른 값 집합이다.
async function generateLoginToken(admin: SupabaseAdmin, email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    console.error("[naver-login] 로그인 토큰 발급 실패", error?.message);
    return null;
  }
  return data.properties.hashed_token;
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
  const fail = (status: number, message: string) => json({ error: message }, status);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail(405, "POST 요청만 받아요");

  const body = await req.json().catch(() => null);
  const { code, state } = readCodeAndState(body);
  if (!code || !state) return fail(400, "code와 state가 필요해요");

  const clientId = Deno.env.get("NAVER_CLIENT_ID");
  const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("[naver-login] NAVER_CLIENT_ID/NAVER_CLIENT_SECRET 비밀값이 설정되어 있지 않아요");
    return fail(500, "로그인 설정이 아직 끝나지 않았어요");
  }

  const accessToken = await exchangeNaverToken({ code, state, clientId, clientSecret });
  if (!accessToken) return fail(401, "네이버 인증에 실패했어요. 다시 로그인해주세요");

  const profile = await fetchNaverProfile(accessToken);
  if (!profile) return fail(502, "네이버 서버와 통신하지 못했어요. 잠시 뒤 다시 시도해주세요");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[naver-login] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않아요");
    return fail(500, "로그인 처리 중 오류가 발생했어요");
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const email = buildInternalEmail(profile.naverId);
  try {
    await ensureNaverUser(admin, email, {
      provider: "naver",
      naver_id: profile.naverId,
      nickname: profile.nickname,
      avatar_url: profile.profileImage,
      naver_email: profile.email,
    });
  } catch (err) {
    console.error("[naver-login] 사용자 생성 실패", err instanceof Error ? err.message : err);
    return fail(500, "로그인 처리 중 오류가 발생했어요. 잠시 뒤 다시 시도해주세요");
  }

  const hashedToken = await generateLoginToken(admin, email);
  if (!hashedToken) return fail(500, "로그인 처리 중 오류가 발생했어요. 잠시 뒤 다시 시도해주세요");

  return json({ hashedToken });
});
