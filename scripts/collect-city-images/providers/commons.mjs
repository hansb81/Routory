// Wikimedia Commons provider — 도시 사진 후보 검색 + 라이선스/저작자 메타데이터 추출.
//
// API 키가 필요 없다(공개 API). 요청 하나로 검색 + 이미지 메타데이터를 같이 받는다
// (generator=search + prop=imageinfo, MediaWiki API 공식 문서의 권장 조합).
//
// 라이선스 화이트리스트: CC0/퍼블릭 도메인/CC BY/CC BY-SA만 허용한다 — 상업적 이용과 변경(리사이즈)이
// 모두 가능한 라이선스만 통과시킨다. "Commons는 자유 라이선스만 올라간다"는 정책이 있어도 실제로는
// 비자유 콘텐츠가 섞여 들어오는 경우가 있다고 단계 0 조사에서 확인했으므로, LicenseShortName을 직접
// 검사해서 한 번 더 걸러낸다 — 못 미더우면(모르는 문구, NC/ND 포함, 필드 자체가 없음) 후보에서 뺀다.
//
// User-Agent 정책(실사용 중 발견한 버그): Wikimedia는 연락처 정보가 없는 User-Agent를 더 공격적으로
// 제한한다(https://meta.wikimedia.org/wiki/User-Agent_policy). 처음 버전은 연락처 없는 UA를 썼다가
// 실제 수집 중 9번째 도시쯤부터 모든 요청이 조용히 빈 배열로 돌아오는 문제가 있었다(아래 fetchJson이
// 실패를 삼켜서 "진짜로 사진이 없다"와 구분이 안 됐다) — WIKIMEDIA_CONTACT 환경변수(이메일 또는 URL,
// 선택)로 UA에 연락처를 넣을 수 있게 했고, 실패는 이제 콘솔에 상태 코드와 함께 남는다.
const CONTACT = process.env.WIKIMEDIA_CONTACT || "no-contact-provided";
const USER_AGENT = `RoutoryCityImageCollector/1.0 (${CONTACT}; local one-off script, low volume)`;

const API_URL = "https://commons.wikimedia.org/w/api.php";
const SEARCH_LIMIT = 8; // 화이트리스트/표기 정보 필터링 후 3~5개가 남도록 여유 있게 가져온다
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2; // 429/403(요청 제한)만 재시도 - 그 외 실패는 바로 포기하고 다음 도시로
const RETRY_DELAY_MS = 2_000;

// 허용: CC0, Public Domain, CC BY(-SA) 2.0/3.0/4.0 등. 금지어(비상업/변경금지)가 포함되면 무조건 거른다.
function isAllowedLicense(licenseShortName) {
  if (!licenseShortName) return false;
  const s = licenseShortName.toLowerCase();
  if (s.includes("nc") || s.includes("nd") || s.includes("non-commercial") || s.includes("no derivative")) return false;
  return /cc0|public domain|cc[- ]?by(-sa)?/.test(s);
}

function stripHtml(value) {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      const err = new Error(`Wikimedia Commons HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 429/403(요청 제한)은 잠깐 쉬었다 재시도한다 - 그 외 실패(네트워크 오류, 404 등)는 바로 포기한다.
// 실패는 더 이상 조용히 삼키지 않는다 - "진짜로 사진이 없다"와 "요청이 막혔다"를 콘솔에서 구분할 수 있어야 한다.
async function fetchJson(url, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (err) {
      lastErr = err;
      const retryable = err.status === 429 || err.status === 403;
      if (!retryable || attempt === MAX_RETRIES) break;
      console.warn(`  [commons] ${label}: HTTP ${err.status}, ${RETRY_DELAY_MS}ms 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  console.warn(`  [commons] ${label}: 검색 실패 - ${lastErr?.message || lastErr}`);
  return null;
}

// query: 검색어(보통 "<영문 도시명> cityscape" 형태로 호출한다 - collect.mjs 참고)
export async function searchCommons(query) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6", // File: 네임스페이스만
    gsrlimit: String(SEARCH_LIMIT),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
  });
  const data = await fetchJson(`${API_URL}?${params.toString()}`, query);
  if (!data) return []; // fetchJson이 이미 경고를 남겼다 - 여기서는 그냥 다음 도시로 넘어간다(collect.mjs)

  const pages = data?.query?.pages;
  if (!pages) return [];

  const candidates = [];
  for (const page of Object.values(pages)) {
    const info = page?.imageinfo?.[0];
    if (!info || !info.url) continue;
    if (!/^image\//.test(info.mime || "")) continue; // svg/pdf 등 비사진 파일 제외

    const meta = info.extmetadata || {};
    const licenseShortName = meta.LicenseShortName?.value || "";
    if (!isAllowedLicense(licenseShortName)) continue;

    const artist = stripHtml(meta.Artist?.value);
    if (!artist) continue; // 저작자 표기를 못 만들면 후보에서 제외 (요청 1번)

    const title = page.title; // 예: "File:Tokyo Skyline.jpg"
    const filePageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

    candidates.push({
      sourceName: "Wikimedia Commons",
      sourceUrl: filePageUrl,
      imageUrl: info.url,
      width: info.width ?? null,
      height: info.height ?? null,
      creditName: artist,
      creditUrl: null, // Commons엔 작가 프로필 URL이라는 고정 필드가 없다 - sourceUrl(파일 설명 페이지)이 출처 역할을 한다
      license: licenseShortName,
      copyAllowed: true, // 다운로드해 자체 저장소에 복사 가능(단계 0 조사 - 공식 가이드가 다운로드를 정상 재사용으로 설명)
    });
  }
  return candidates;
}
