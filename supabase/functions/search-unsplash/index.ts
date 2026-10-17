// search-unsplash: 관리 페이지(/admin, "추천 도시" 탭)의 "Unsplash에서 검색"이 쓰는 Supabase Edge
// Function (Deno, no imports). UNSPLASH_ACCESS_KEY를 서버에만 두고, 관리자 브라우저는 이 함수만
// 호출한다 - search-pexels와 똑같은 이유·패턴(Pexels/Unsplash 키 둘 다 도메인 제한 기능이 없어서
// 클라이언트 JS에 넣으면 페이지 소스만 보고 누구나 꺼내 쓸 수 있다).
//
// 로그인만으로는 안 되고 is_admin()까지 통과해야 한다 - search-pexels와 동일하게 Edge Function
// 레벨에서도 관리자만 호출 가능하도록 막는다.
//
// Unsplash API 이용약관(Guidelines)상 이 함수가 반드시 지켜야 하는 두 가지(scripts/collect-city-images
// /README.md가 Unsplash를 그 스크립트에서 일부러 뺀 이유와 같은 조항들 - 거긴 다운로드해 Storage에
// 복사하는 방식이라 "다운로드·캐싱 금지"에 바로 걸리지만, 여기는 핫링크만 쓰는 방식이라 적용 가능하다):
//   1. 핫링크만 허용 - urls.* 가 돌려주는 주소를 그대로 쓰고 다운로드/재업로드하지 않는다(이 함수도
//      addImageCandidate와 마찬가지로 URL만 저장한다, Wikimedia/Pexels와 동일).
//   2. "다운로드"(=실사용) 액션마다 photo.links.download_location에 GET을 보내야 한다. 이 관리
//      페이지에서 "사용"에 해당하는 지점은 "후보로 추가" 버튼 클릭(그 사진을 쓰기로 고른 순간) - 그래서
//      검색 결과에 downloadLocation을 같이 돌려주고, adminPage.js가 "후보로 추가" 클릭 시 이 함수를
//      { downloadLocation } 모드로 한 번 더 호출해 트래킹한다(Unsplash 공식 데모 앱들도 "선택 시점에
//      1회"로 구현한다 - 매 화면 노출마다가 아니다). ACCESS_KEY를 클라이언트에 노출하지 않으려고 트래킹도
//      이 서버 함수를 거친다.
//
// 호출(검색): POST { query } (로그인 + 관리자 세션 필요)
// 응답: { results: NormalizedResult[] } - search-pexels/Wikimedia 검색과 같은 모양
//   ({ imageUrl, thumbUrl, creditName, creditUrl, license, sourceName, sourceUrl, downloadLocation })
// 호출(다운로드 트래킹): POST { downloadLocation } - downloadLocation은 반드시 이 함수가 방금 돌려준
//   값이어야 한다(아래 isUnsplashDownloadLocation 검증 - 임의 URL을 이 함수로 프록시하는 열린 리다이렉터가
//   되지 않게 하는 안전장치).
// 응답: { ok: true }
//
// 필요한 비밀값(secrets): UNSPLASH_ACCESS_KEY (https://unsplash.com/developers 무료 가입 - Demo 앱으로도
// 충분, 시간당 호출 한도가 낮을 뿐)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 넣어준다.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";
const UNSPLASH_API_HOST = "https://api.unsplash.com/";
const PER_PAGE = 8;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_QUERY_CHARS = 100;
// Routory가 Unsplash 사진을 쓰고 있다는 걸 Unsplash 쪽 통계/귀속 표시에 식별시키는 값 (요청된 utm 포맷,
// 앱 이름 변경 시 여기만 바꾸면 된다 - CLAUDE.md "표시명 Routory" 참고)
const UTM_PARAMS = "utm_source=routory&utm_medium=referral";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---- 로그인 확인 (search-pexels#authClaims와 같은 패턴) ----

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

function withUtm(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + UTM_PARAMS;
}

// download_location이 실제로 Unsplash API 자신을 가리키는지 확인 - 아니면 이 함수가 ACCESS_KEY를 실어서
// 임의 URL에 GET을 보내는 열린 프록시가 될 수 있다.
function isUnsplashDownloadLocation(value: string): boolean {
  return typeof value === "string" && value.startsWith(UNSPLASH_API_HOST);
}

type UnsplashPhoto = {
  urls?: { regular?: string; small?: string };
  user?: { name?: string; links?: { html?: string } };
  links?: { html?: string; download_location?: string };
};

function normalize(photo: UnsplashPhoto) {
  const imageUrl = photo.urls?.regular;
  const creditName = photo.user?.name;
  const sourceUrl = photo.links?.html;
  const downloadLocation = photo.links?.download_location;
  if (!imageUrl || !creditName || !sourceUrl || !downloadLocation) return null;
  return {
    imageUrl,
    thumbUrl: photo.urls?.small ?? imageUrl,
    creditName,
    creditUrl: photo.user?.links?.html ? withUtm(photo.user.links.html) : null,
    license: "Unsplash License",
    sourceName: "Unsplash",
    sourceUrl: withUtm(sourceUrl),
    downloadLocation,
  };
}

async function handleSearch(unsplashKey: string, query: string): Promise<Response> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const params = new URLSearchParams({ query, per_page: String(PER_PAGE), orientation: "landscape" });
    const res = await fetch(`${UNSPLASH_SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Client-ID ${unsplashKey}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
    const data = await res.json();
    const photos = Array.isArray(data?.results) ? data.results : [];
    const results = photos.map(normalize).filter((r: unknown) => r !== null);
    console.log(`[search-unsplash] query_len=${query.length} results=${results.length}`); // 검색어 원문은 로그에 남기지 않는다
    return json({ results });
  } catch (err) {
    console.error("[search-unsplash] Unsplash 검색 실패", err instanceof Error ? err.message : err);
    return json({ error: "검색에 실패했어요" }, 502);
  }
}

async function handleTrackDownload(unsplashKey: string, downloadLocation: string): Promise<Response> {
  if (!isUnsplashDownloadLocation(downloadLocation)) {
    return json({ error: "잘못된 downloadLocation이에요" }, 400);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${unsplashKey}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
    return json({ ok: true });
  } catch (err) {
    console.error("[search-unsplash] 다운로드 트래킹 실패", err instanceof Error ? err.message : err);
    // 트래킹 실패는 관리자의 "후보로 추가" 작업 자체를 막을 이유가 아니다(adminPage.js는 이 응답을
    // best-effort로만 취급한다) - 그래도 호출 실패는 알 수 있어야 하니 502는 그대로 돌려준다.
    return json({ error: "다운로드 트래킹에 실패했어요" }, 502);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const { authenticated, userId } = authClaims(req);
  if (!authenticated || !userId) return json({ error: "로그인이 필요해요" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const unsplashKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[search-unsplash] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어요");
    return json({ error: "서버 설정 오류" }, 500);
  }
  if (!unsplashKey) {
    console.error("[search-unsplash] UNSPLASH_ACCESS_KEY 비밀값이 설정되어 있지 않아요");
    return json({ error: "서버 설정 오류" }, 500);
  }

  if (!(await isAdminUser(supabaseUrl, serviceRoleKey, userId))) {
    return json({ error: "관리자만 사용할 수 있어요" }, 403);
  }

  const body = await req.json().catch(() => null);

  const downloadLocation = typeof body?.downloadLocation === "string" ? body.downloadLocation : null;
  if (downloadLocation) return handleTrackDownload(unsplashKey, downloadLocation);

  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY_CHARS) : "";
  if (!query) return json({ error: "query가 비어있어요" }, 400);
  return handleSearch(unsplashKey, query);
});
