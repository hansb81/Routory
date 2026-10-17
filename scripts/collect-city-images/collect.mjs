// collect.mjs — '어디로 떠나볼까요' 도시 대표 이미지 후보 수집 스크립트. 로컬에서 사람이 손으로 실행한다
// (cron/Edge Function 아님 — 후보를 모아 discover_city_images에 status='draft'로만 쌓아 두고, 실제
// 게시(published)는 반드시 관리 페이지(/admin, "도시 이미지" 탭)에서 사람이 눈으로 보고 고른다. 자동
// 게시 경로는 이 스크립트에 아예 없다).
//
// 단계 0 조사에서 "복사해도 되는" 소스만 쓴다: Wikimedia Commons(허용 라이선스만, 다운로드 가능), Pexels
// (다운로드 가능). AI로 이미지를 생성하거나, 이용 조건을 확인하지 않은 임의의 웹 이미지를 가져오는 경로는
// 없다. 라이선스가 모호하거나 핫링크만 허용되는 소스는 쓰지 않는다 — Google Places Photos(유료+캐싱 금지),
// 한국관광공사 TourAPI 이미지(대부분 공공누리 3유형, 변경금지라 800px 리사이즈와 상충), Unsplash(API
// 약관상 다운로드·캐싱이 금지돼 있고, 핫링크 사용 시 "표시마다 사진 다운로드 트래킹 엔드포인트를 따로
// 호출해야 하는" 별도 준수 의무가 있어 이번 범위에서는 일부러 뺐다 — 필요하면 providers/ 밑에 같은
// 인터페이스로 하나 더 추가하면 된다)는 전부 제외했다.
//
// 사람 얼굴이 중심인 사진·도시 풍경이 아닌 사진·로고/워터마크가 있는 사진을 거르는 건 이 스크립트가 아니라
// 관리자가 한다(검색어를 도시 풍경 쪽으로 편향시키고 orientation=landscape를 쓰지만, 이건 힌트일 뿐 자동
// 판별이 아니다) — 관리 페이지의 썸네일 비교 화면에서 최종적으로 거른다.
//
// 필요한 환경변수 (전부 코드/로그에 남기지 않고 process.env로만 읽는다):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (anon 키가 아니라 서비스 키 - discover_city_images insert는 RLS가
//                                is_admin()만 허용하므로, 로그인 세션 없이 도는 이 로컬 스크립트는
//                                서비스 키로 RLS를 우회해서 쓴다. 이 키는 절대 커밋/공유하지 않을 것.)
//   PEXELS_API_KEY              (선택 - 없으면 Pexels는 건너뛰고 Commons만 쓴다)
//   WIKIMEDIA_CONTACT           (선택이지만 강력 권장 - 이메일 또는 URL. Wikimedia User-Agent 정책
//                                (https://meta.wikimedia.org/wiki/User-Agent_policy)이 연락처 없는
//                                요청을 더 공격적으로 제한한다 - 실제로 연락처 없이 돌렸을 때 9번째 도시
//                                쯤부터 전부 빈 결과로 막힌 적이 있다. providers/commons.mjs 참고.)
//
// 미리 해야 할 것: Supabase 대시보드 → Storage → New bucket → 이름 "discover-images", Public bucket ON
// (복사해도 되는 소스의 이미지를 담을 공개 버킷 - README.md에 상세 단계가 있다). 버킷 자체는 SQL로 만들지
// 않는다(006_wallet.sql의 wallet 버킷과 같은 이유).
//
// 사용법:
//   cd scripts/collect-city-images && npm install
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WIKIMEDIA_CONTACT=... node collect.mjs [--dry-run] [--city=Tokyo] [--max=5]

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { searchCommons } from "./providers/commons.mjs";
import { searchPexels } from "./providers/pexels.mjs";

const STORAGE_BUCKET = "discover-images";
const IMAGE_WIDTH = 800; // 요청 2번: 가로 800px 안팎
const THUMB_WIDTH = 320;
const WEBP_QUALITY = 82;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 비정상적으로 큰 파일 다운로드 방지(안전장치, 일반 사진은 훨씬 작다)

function parseArgs(argv) {
  const args = { dryRun: false, city: null, max: 5 };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--city=")) args.city = raw.slice("--city=".length).toLowerCase();
    else if (raw.startsWith("--max=")) args.max = Math.max(1, Math.min(5, Number(raw.slice("--max=".length)) || 5));
  }
  return args;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[collect-city-images] 환경변수 ${name}이 설정되어 있지 않아요.`);
    process.exit(1);
  }
  return v;
}

function slugify(countryCode, nameEn) {
  const base = `${countryCode}-${nameEn}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base || "city";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`이미지 다운로드 실패 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("이미지 파일이 너무 커요");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function toWebp(buffer, width) {
  return sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
}

// 복사 가능한 소스의 후보를 리사이즈해 Storage에 올리고 공개 URL을 돌려준다.
async function uploadToStorage(supabase, buffer, path) {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchActiveCities(supabase, cityFilter) {
  const { data, error } = await supabase
    .from("discover_cities")
    .select("id, destinations(id, name_ko, name_en, country_code)")
    .eq("is_active", true);
  if (error) throw error;
  const rows = (data || []).filter((row) => row.destinations);
  if (!cityFilter) return rows;
  return rows.filter((row) => row.destinations.name_en.toLowerCase().includes(cityFilter));
}

async function fetchExistingSourceUrls(supabase, cityId) {
  const { data, error } = await supabase.from("discover_city_images").select("source_url").eq("city_id", cityId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.source_url));
}

async function fetchMaxSortOrder(supabase, cityId) {
  const { data, error } = await supabase
    .from("discover_city_images")
    .select("sort_order")
    .eq("city_id", cityId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? data[0].sort_order : -1;
}

function dedupeBySourceUrl(candidates) {
  const seen = new Set();
  const result = [];
  for (const c of candidates) {
    if (seen.has(c.sourceUrl)) continue;
    seen.add(c.sourceUrl);
    result.push(c);
  }
  return result;
}

async function collectCandidatesFor(nameEn, pexelsApiKey, max) {
  const commons1 = await searchCommons(`${nameEn} cityscape`);
  let merged = dedupeBySourceUrl(commons1);
  if (merged.length < max) {
    const commons2 = await searchCommons(`${nameEn} skyline`);
    merged = dedupeBySourceUrl([...merged, ...commons2]);
  }
  if (merged.length < max) {
    const pexels = await searchPexels(`${nameEn} cityscape`, pexelsApiKey);
    merged = dedupeBySourceUrl([...merged, ...pexels]);
  }
  return merged.slice(0, max);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const pexelsApiKey = process.env.PEXELS_API_KEY || null;
  if (!pexelsApiKey) console.log("[collect-city-images] PEXELS_API_KEY가 없어요 - Wikimedia Commons만 사용해요.");

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const cities = await fetchActiveCities(supabase, args.city);
  if (cities.length === 0) {
    console.log("[collect-city-images] 조건에 맞는 활성 도시가 없어요.");
    return;
  }

  let totalSaved = 0;
  let totalSkippedDuplicate = 0;
  let totalSkippedNoAttribution = 0; // providers가 이미 걸러낸 뒤 숫자만 참고용으로 남긴다
  const perCityReport = [];

  for (const city of cities) {
    const d = city.destinations;
    console.log(`\n[collect-city-images] ${d.name_ko}(${d.name_en}, ${d.country_code}) 처리 중...`);

    let candidates;
    try {
      candidates = await collectCandidatesFor(d.name_en, pexelsApiKey, args.max);
    } catch (err) {
      console.error(`  검색 실패: ${(err && err.message) || err}`);
      perCityReport.push({ city: d.name_ko, saved: 0, note: "검색 실패" });
      continue;
    }

    if (candidates.length === 0) {
      console.log("  후보를 찾지 못했어요.");
      perCityReport.push({ city: d.name_ko, saved: 0, note: "후보 없음" });
      continue;
    }

    const existingUrls = await fetchExistingSourceUrls(supabase, city.id);
    const fresh = candidates.filter((c) => !existingUrls.has(c.sourceUrl));
    const skippedDup = candidates.length - fresh.length;
    totalSkippedDuplicate += skippedDup;

    if (fresh.length === 0) {
      console.log(`  새 후보 없음 (이미 저장된 ${skippedDup}개와 중복).`);
      perCityReport.push({ city: d.name_ko, saved: 0, note: "전부 중복" });
      continue;
    }

    let nextSortOrder = (await fetchMaxSortOrder(supabase, city.id)) + 1;
    let savedForCity = 0;
    const slug = slugify(d.country_code, d.name_en);

    for (const candidate of fresh) {
      if (args.dryRun) {
        console.log(`  [dry-run] ${candidate.sourceName} · ${candidate.creditName} · ${candidate.license} · ${candidate.sourceUrl}`);
        continue;
      }

      let imageUrl = candidate.imageUrl;
      let thumbUrl = candidate.imageUrl;

      if (candidate.copyAllowed) {
        try {
          const original = await downloadImage(candidate.imageUrl);
          const [full, thumb] = await Promise.all([toWebp(original, IMAGE_WIDTH), toWebp(original, THUMB_WIDTH)]);
          const id = randomUUID();
          imageUrl = await uploadToStorage(supabase, full, `${slug}/${id}.webp`);
          thumbUrl = await uploadToStorage(supabase, thumb, `${slug}/${id}-thumb.webp`);
        } catch (err) {
          console.error(`  이미지 처리 실패(${candidate.sourceUrl}): ${(err && err.message) || err} - 이 후보는 건너뛰어요.`);
          continue;
        }
      }
      // copyAllowed가 false인 소스(핫링크 전용)는 원본 URL을 그대로 쓴다(요청 2번) - 지금 쓰는 두
      // provider(Commons/Pexels)는 둘 다 copyAllowed:true라 이 분기는 현재 코드 경로상 타지 않지만,
      // 핫링크 전용 소스를 나중에 추가할 때를 위해 남겨 둔다.

      const { error } = await supabase.from("discover_city_images").insert({
        city_id: city.id,
        image_url: imageUrl,
        thumb_url: thumbUrl,
        credit_name: candidate.creditName,
        credit_url: candidate.creditUrl,
        license: candidate.license,
        source_name: candidate.sourceName,
        source_url: candidate.sourceUrl,
        status: "draft",
        sort_order: nextSortOrder++,
      });
      if (error) {
        console.error(`  저장 실패(${candidate.sourceUrl}): ${error.message}`);
        continue;
      }
      savedForCity++;
      console.log(`  저장: ${candidate.sourceName} · ${candidate.creditName} · ${candidate.license}`);
    }

    totalSaved += savedForCity;
    perCityReport.push({ city: d.name_ko, saved: savedForCity, note: args.dryRun ? "dry-run" : "" });

    await sleep(1000); // Commons/Pexels에 대한 매너 - 300ms는 9번째 도시쯤부터 막히는 걸 겪고 늘렸다
  }

  console.log("\n[collect-city-images] 완료");
  perCityReport.forEach((r) => console.log(`  - ${r.city}: ${r.saved}개 저장${r.note ? " (" + r.note + ")" : ""}`));
  console.log(`총 저장 ${totalSaved}개, 중복으로 건너뜀 ${totalSkippedDuplicate}개`);
  console.log("저장된 이미지는 전부 status='draft'예요 - /admin의 '도시 이미지' 탭에서 사람이 보고 게시해야 실제로 노출돼요.");
}

main().catch((err) => {
  console.error("[collect-city-images] 처리 중 오류:", (err && err.message) || err);
  process.exit(1);
});
