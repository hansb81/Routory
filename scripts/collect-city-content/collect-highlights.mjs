// collect-highlights.mjs — '어디로 떠나볼까요' 도시의 명소(city_highlights) 후보를 모아 주는 스크립트.
// 로컬에서 사람이 손으로 실행한다 (cron/Edge Function 아님).
//
// *** "승인 대기"(discover_cities.is_active=false) 도시에만 바로 저장하고, "게시 중"(is_active=true) 도시는
// 절대 쓰지 않고 리포트로만 남긴다. *** city_highlights 자체엔 draft/published 구분이 없지만,
// get_city_detail과 그 테이블의 RLS(041_discover_detail_policy_fix.sql)가 전부 "dc.is_active = true"일
// 때만 노출하도록 걸려 있다 - 그래서 승인 대기 도시에 바로 insert해도 그 도시가 실제로 게시되기 전까지는
// 사용자에게 보이지 않는다. 이미 게시 중인 도시는 게이트가 이미 열려 있어서 직접 쓰면 그 순간 바로
// 노출되므로, 그 경우만 리포트에 남겨 관리자가 직접 추가하게 한다 (collect-months.mjs와 동일한 설계).
//
// 데이터 소스: 위키백과 Geosearch API(action=query, generator=geosearch) - API 키 불필요. 도시 좌표 주변
// 8km 안의 위키백과 문서를 거리순으로 찾고, 같은 요청에 prop=extracts를 같이 걸어 한 줄 요약도 받는다
// (검색+요약을 호출 1번으로 끝낸다). 한국어판(ko.wikipedia.org)을 먼저 찾고, 결과가 부족하면(--max 미달)
// 영어판(en.wikipedia.org)으로 보충한다 - collect-city-images/collect.mjs가 Commons 부족 시 Pexels로
// 보충하는 것과 같은 패턴.
//
// *** 승인 대기 도시에 자동 저장되는 것도 "검증된 명소"가 아니라 "후보"일 뿐이다. *** Geosearch는 거리만
// 보고 문서를 찾기 때문에 관광지가 아닌 행정구역·동네·역·회사 등이 자주 섞여 나온다(실제로 도쿄로 테스트
// 하면 상위 결과가 전철역/동네였다) - collect-city-images README의 "사람 얼굴 중심 사진" 경고와 같은 성격의
// 한계다. 이 스크립트가 하는 필터링은 "도시 이름 자체와 같은 문서"와 "요약이 비어 있는 문서"를 빼는 것뿐이라,
// **관리자가 도시를 게시하기 전에 "대표 관광지" 섹션에서 명소가 아닌 항목을 반드시 지워야 한다.**
//
// 필요한 환경변수:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (승인 대기 도시엔 실제로 insert한다 - anon 키로는 "승인 대기" 도시 자체가
//                                RLS에 가려 안 보이고, city_highlights 쓰기도 관리자만 가능해서 서비스
//                                키가 필요하다.)
//   WIKIMEDIA_CONTACT           (선택이지만 강력 권장 - collect-city-images/README.md의 설명과 동일한
//                                이유. 위키백과도 같은 Wikimedia User-Agent 정책을 쓴다.)
//
// 사용법:
//   cd scripts/collect-city-content && npm install
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WIKIMEDIA_CONTACT=... node collect-highlights.mjs [--city=Tokyo] [--max=6] [--out=path]

import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCities } from "./lib/cities.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;
const GEOSEARCH_RADIUS_M = 8_000;
const GEOSEARCH_LIMIT = 15; // 필터링 후 --max개가 남도록 여유 있게 가져온다
const MIN_HIGHLIGHTS_TO_SKIP = 3; // city_highlights.sql 주석: 도시당 3~6개 권장 - 이미 3개 이상이면 건너뛴다
const SUMMARY_MAX_LEN = 90;

const CONTACT = process.env.WIKIMEDIA_CONTACT || "no-contact-provided";
const USER_AGENT = `RoutoryCityHighlightsCollector/1.0 (${CONTACT}; local one-off script, low volume)`;

function parseArgs(argv) {
  const args = { city: null, max: 6, out: null };
  for (const raw of argv) {
    if (raw.startsWith("--city=")) args.city = raw.slice("--city=".length).toLowerCase();
    else if (raw.startsWith("--max=")) args.max = Math.max(1, Math.min(10, Number(raw.slice("--max=".length)) || 6));
    else if (raw.startsWith("--out=")) args.out = raw.slice("--out=".length);
  }
  return args;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[collect-highlights] 환경변수 ${name}이 설정되어 있지 않아요.`);
    process.exit(1);
  }
  return v;
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
      const err = new Error(`Wikipedia HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (err) {
      lastErr = err;
      const retryable = err.status === 429 || err.status === 403;
      if (!retryable || attempt === MAX_RETRIES) break;
      console.warn(`  [wikipedia] ${label}: HTTP ${err.status}, ${RETRY_DELAY_MS}ms 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  console.warn(`  [wikipedia] ${label}: 검색 실패 - ${lastErr?.message || lastErr}`);
  return null;
}

function truncate(text, max) {
  if (!text) return "";
  const trimmed = text.trim().split("\n")[0];
  return trimmed.length > max ? trimmed.slice(0, max).trim() + "…" : trimmed;
}

// lang: "ko" | "en". 도시 이름과 거의 같은 문서(그 도시 자체를 다루는 문서)와 요약이 비어 있는 문서는 뺀다.
async function searchWikipedia(lang, lat, lng, cityNameKo, cityNameEn, label) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(GEOSEARCH_RADIUS_M),
    ggslimit: String(GEOSEARCH_LIMIT),
    prop: "extracts|coordinates",
    exintro: "1",
    explaintext: "1",
    exsentences: "1",
  });
  const data = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, label);
  if (!data) return [];

  const pages = data?.query?.pages;
  if (!pages) return [];

  const excludeNames = new Set([cityNameKo?.toLowerCase(), cityNameEn?.toLowerCase()].filter(Boolean));
  const candidates = [];
  for (const page of Object.values(pages)) {
    const title = page.title;
    if (!title) continue;
    if (excludeNames.has(title.toLowerCase())) continue; // 도시 자체 문서는 명소가 아니다

    const summary = truncate(page.extract, SUMMARY_MAX_LEN);
    if (!summary) continue; // 요약이 없으면 뭘 소개해야 할지 알 수 없어 후보에서 뺀다

    const coord = page.coordinates?.[0];
    candidates.push({
      nameKo: title,
      summary,
      lat: coord?.lat ?? null,
      lng: coord?.lon ?? null,
      lang,
      sourceName: lang === "ko" ? "위키백과" : "Wikipedia (영문)",
      sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    });
  }
  return candidates;
}

// 개수뿐 아니라 이름·정렬순서도 같이 가져온다 - 자동 저장 시 중복 이름을 건너뛰고, sort_order를 이어서 매긴다.
async function fetchExistingHighlights(supabase, cityId) {
  const { data, error } = await supabase
    .from("city_highlights")
    .select("name_ko, sort_order")
    .eq("city_id", cityId)
    .order("sort_order", { ascending: false });
  if (error) throw error;
  const rows = data || [];
  return {
    count: rows.length,
    names: new Set(rows.map((r) => r.name_ko)),
    nextSortOrder: rows.length ? rows[0].sort_order + 1 : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const cities = await fetchCities(supabase, args.city);
  if (cities.length === 0) {
    console.log("[collect-highlights] 조건에 맞는 도시가 없어요.");
    return;
  }

  const report = { generatedAt: new Date().toISOString(), cities: [] };

  for (const city of cities) {
    const existing = await fetchExistingHighlights(supabase, city.cityId);
    if (existing.count >= MIN_HIGHLIGHTS_TO_SKIP) {
      continue; // 이미 충분하면 건너뛴다 (admin.html의 "하이라이트" 집계와 같은 기준)
    }

    console.log(
      `\n[collect-highlights] ${city.nameKo}(${city.nameEn}, ${city.countryCode}, ${city.isActive ? "게시 중" : "승인 대기"}) 처리 중... (기존 ${existing.count}개)`
    );

    let candidates = await searchWikipedia("ko", city.lat, city.lng, city.nameKo, city.nameEn, `${city.nameEn} ko`);
    if (candidates.length < args.max) {
      const more = await searchWikipedia("en", city.lat, city.lng, city.nameKo, city.nameEn, `${city.nameEn} en`);
      candidates = candidates.concat(more);
    }
    candidates = candidates.filter((c) => !existing.names.has(c.nameKo)).slice(0, args.max);

    const cityReport = {
      cityId: city.cityId,
      nameKo: city.nameKo,
      nameEn: city.nameEn,
      countryCode: city.countryCode,
      status: city.isActive ? "published" : "pending",
      existingCount: existing.count,
      autoSaved: [], // 승인 대기 도시: 바로 city_highlights에 insert한 것
      needsManualReview: [], // 게시 중인 도시: DB에 안 쓰고 여기 리포트에만 남긴 것
    };

    if (candidates.length === 0) {
      console.log("  후보를 찾지 못했어요.");
    } else if (!city.isActive) {
      let nextSortOrder = existing.nextSortOrder;
      for (const c of candidates) {
        const { error } = await supabase.from("city_highlights").insert({
          city_id: city.cityId,
          sort_order: nextSortOrder++,
          name_ko: c.nameKo,
          summary: c.summary,
          lat: c.lat,
          lng: c.lng,
          source_name: c.sourceName,
        });
        if (error) {
          console.warn(`  "${c.nameKo}" 저장 실패: ${error.message}`);
          continue;
        }
        cityReport.autoSaved.push(c);
      }
      console.log(`  승인 대기 도시 - ${cityReport.autoSaved.length}개 자동 저장(검증 안 됨): ` + cityReport.autoSaved.map((c) => c.nameKo).join(", "));
    } else {
      cityReport.needsManualReview = candidates;
      console.log(`  게시 중인 도시 - ${candidates.length}개 후보(DB에는 안 씀, 직접 입력 필요): ` + candidates.map((c) => c.nameKo).join(", "));
    }

    report.cities.push(cityReport);

    await sleep(300); // Wikipedia에 대한 매너 - collect.mjs가 Commons/Pexels에 쓰는 간격과 같은 취지
  }

  const outDir = path.join(__dirname, "output");
  await mkdir(outDir, { recursive: true });
  const outPath = args.out || path.join(outDir, `highlights-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  const totalAutoSaved = report.cities.reduce((sum, c) => sum + c.autoSaved.length, 0);
  const totalNeedsReview = report.cities.reduce((sum, c) => sum + c.needsManualReview.length, 0);
  console.log(`\n[collect-highlights] 완료 - 자동 저장(승인 대기 도시) ${totalAutoSaved}개, 리포트만(게시 중 도시) ${totalNeedsReview}개`);
  console.log(`리포트 저장: ${outPath}`);
  console.log("자동 저장된 것도 명소가 아닐 수 있어요(역/행정구역 등) - 도시를 게시하기 전에 /admin의 '대표 관광지' 섹션에서 걸러내 주세요.");
  console.log("게시 중인 도시의 후보는 DB에 안 썼어요 - 리포트를 보고 '대표 관광지' 섹션에 직접 추가해 주세요.");
}

main().catch((err) => {
  console.error("[collect-highlights] 처리 중 오류:", (err && err.message) || err);
  process.exit(1);
});
