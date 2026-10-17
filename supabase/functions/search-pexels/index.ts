// search-pexels: 관리 페이지(/admin, "추천 도시" 탭)의 "Pexels에서 검색"이 쓰는 Supabase Edge Function
// (Deno, no imports). PEXELS_API_KEY를 서버에만 두고, 관리자 브라우저는 이 함수만 호출한다 - Pexels 키는
// Google Maps 브라우저 키와 달리 도메인(리퍼러) 제한 기능이 없어서, 클라이언트 JS 파일에 넣으면 페이지
// 소스만 봐도 누구나 꺼내 쓸 수 있다. search-destination이 GOOGLE_PLACES_API_KEY를 서버에만 두는 것과
// 똑같은 이유 · 똑같은 패턴이다.
//
// 로그인만으로는 안 되고 is_admin()까지 통과해야 한다 - "관리자 전용 기능"이라고 화면만 숨겨 둔 게 아니라
// 서버에서도 막아야 한다는 요청(메인 화면 개선 단계 2 관리 페이지)을 Edge Function 레벨까지 그대로 지킨다.
// is_admin(uid uuid default auth.uid())는 020_admins.sql이 "임의의 uid에 대해 판정 가능"하도록 일부러
// security definer로 만들어 둔 함수라, service_role로 "이 토큰의 uid가 관리자인가"를 바로 물어볼 수 있다.
//
// 호출: POST { query } (로그인 + 관리자 세션 필요)
// 응답: { results: NormalizedResult[] } - Wikimedia 검색(adminPage.js#searchWikimedia)과 같은 모양
//   ({ imageUrl, thumbUrl, creditName, creditUrl, license, sourceName, sourceUrl })이라 관리 페이지에서
//   거의 같은 렌더링 코드로 보여줄 수 있다.
//
// 필요한 비밀값(secrets): PEXELS_API_KEY (https://www.pexels.com/api/ 무료 가입)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 넣어준다.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search";
const PER_PAGE = 8;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_QUERY_CHARS = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---- 로그인 확인 (search-destination#authClaims와 같은 패턴) ----

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

// ---- 관리자 확인: service_role로 is_admin(uid)를 직접 물어본다 (RLS 우회, 020_admins.sql 참고) ----

async function isAdminUser(supabaseUrl: string, serviceRoleKey: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/is_admin`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uid: userId }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

type PexelsPhoto = {
  photographer?: string;
  photographer_url?: string;
  url?: string;
  src?: { large?: string; medium?: string };
};

function normalize(photo: PexelsPhoto) {
  if (!photo.src?.large || !photo.photographer || !photo.url) return null;
  return {
    imageUrl: photo.src.large,
    thumbUrl: photo.src.medium ?? photo.src.large,
    creditName: photo.photographer,
    creditUrl: photo.photographer_url ?? null,
    license: "Pexels License",
    sourceName: "Pexels",
    sourceUrl: photo.url,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const { authenticated, userId } = authClaims(req);
  if (!authenticated || !userId) return json({ error: "로그인이 필요해요" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[search-pexels] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어요");
    return json({ error: "서버 설정 오류" }, 500);
  }
  if (!pexelsKey) {
    console.error("[search-pexels] PEXELS_API_KEY 비밀값이 설정되어 있지 않아요");
    return json({ error: "서버 설정 오류" }, 500);
  }

  if (!(await isAdminUser(supabaseUrl, serviceRoleKey, userId))) {
    return json({ error: "관리자만 사용할 수 있어요" }, 403);
  }

  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY_CHARS) : "";
  if (!query) return json({ error: "query가 비어있어요" }, 400);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const params = new URLSearchParams({ query, per_page: String(PER_PAGE), orientation: "landscape" });
    const res = await fetch(`${PEXELS_SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: pexelsKey },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
    const data = await res.json();
    const photos = Array.isArray(data?.photos) ? data.photos : [];
    const results = photos.map(normalize).filter((r: unknown) => r !== null);
    console.log(`[search-pexels] query_len=${query.length} results=${results.length}`); // 검색어 원문은 로그에 남기지 않는다
    return json({ results });
  } catch (err) {
    console.error("[search-pexels] Pexels 호출 실패", err instanceof Error ? err.message : err);
    return json({ error: "검색에 실패했어요" }, 502);
  }
});
