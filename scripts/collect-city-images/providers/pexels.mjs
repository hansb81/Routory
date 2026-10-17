// Pexels provider — 도시 사진 후보 검색.
//
// 단계 0 조사: 무료, 저작자 표기가 법적으로 필수는 아니지만(라이선스 페이지) 가능하면 표기를 권장한다고
// API 문서가 안내해서 이 스크립트는 항상 표기 정보를 저장한다. 다운로드해 자체 저장소에 복사 가능(라이선스가
// 수정·저장을 명시적으로 허용). 호출 한도: 200회/시간, 20,000회/월 - fetchCandidates가 호출 한 번으로
// 도시 하나를 처리하므로 이번 27개 도시 규모에서는 전혀 문제가 안 된다.
//
// API 키가 필요하다: PEXELS_API_KEY 환경변수로만 읽는다(코드에 적지 않음, 로그에도 안 남김).

const API_URL = "https://api.pexels.com/v1/search";
const PER_PAGE = 6;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchJson(url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Authorization: apiKey } });
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// query: 검색어. apiKey가 없으면 호출 자체를 하지 않고 빈 배열(collect.mjs가 "Pexels 비활성화"로 집계한다).
export async function searchPexels(query, apiKey) {
  if (!apiKey) return [];
  const params = new URLSearchParams({ query, per_page: String(PER_PAGE), orientation: "landscape" });
  let data;
  try {
    data = await fetchJson(`${API_URL}?${params.toString()}`, apiKey);
  } catch {
    return [];
  }

  const photos = Array.isArray(data?.photos) ? data.photos : [];
  return photos
    .filter((p) => p?.src?.large && p.photographer && p.url)
    .map((p) => ({
      sourceName: "Pexels",
      sourceUrl: p.url,
      imageUrl: p.src.large,
      width: p.width ?? null,
      height: p.height ?? null,
      creditName: p.photographer,
      creditUrl: p.photographer_url || null,
      license: "Pexels License",
      copyAllowed: true, // 다운로드·수정·저장 가능(단계 0 조사 - Pexels License)
    }));
}
