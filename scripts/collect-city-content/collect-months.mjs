// collect-months.mjs — '어디로 떠나볼까요' 도시의 월별 추천 이유(discover_city_months) 초안을 만들어 주는
// 스크립트. 로컬에서 사람이 손으로 실행한다 (cron/Edge Function 아님).
//
// *** "승인 대기"(discover_cities.is_active=false) 도시에만 바로 저장하고, "게시 중"(is_active=true) 도시는
// 절대 쓰지 않고 리포트로만 남긴다. *** discover_city_months 자체엔 draft/published 구분이 없지만,
// get_discover_cities/get_city_detail과 그 테이블의 RLS(041_discover_detail_policy_fix.sql)가 전부
// "dc.is_active = true"일 때만 노출하도록 걸려 있다 — 그래서 승인 대기 도시에 바로 insert해도 그 도시가
// 실제로 게시되기 전까지는 사용자에게 보이지 않는다(collect-city-images의 draft 이미지와 같은 효과를
// discover_cities.is_active 하나로 얻는 셈). 반면 이미 게시 중인 도시는 게이트가 이미 열려 있어서, 거기에
// 직접 쓰면 그 순간 바로 노출된다 — 그 경우만 리포트에 남겨 관리자가 직접 입력하게 한다.
//
// *** 문화·계절 행사(벚꽃/단풍/축제 등)는 전혀 추정하지 않는다. *** 그런 정보는 도시마다 고유하고 연도마다
// 날짜가 바뀌어서, 범용 공개 API만으로 정확히 맞히는 건 무책임한 추측이 된다. 이 스크립트가 보는 근거는
// Open-Meteo의 과거 1년치 실측 기온/강수량뿐이고, 027_discover_cities.sql의 discover_weather_bonus()가 이미
// 쓰는 "쾌적 기온 15~28도" 기준을 그대로 재사용해 "선선한/따뜻한 날씨"처럼 일반적인 이유만 제안한다 - 특정
// 축제·개화 시기 같은 그 도시만의 이유는 관리자가 직접 조사해서 입력해야 한다. 점수는 기온만으로는 정확히
// 매길 수 없어 승인 대기 도시에도 항상 DEFAULT_SCORE(아래)로 임시로 넣는다 - 관리자가 도시를 게시하기 전에
// "월별 점수" 섹션에서 숫자를 눈으로 한 번 더 확인/조정하는 걸 권장한다.
//
// 데이터 소스: Open-Meteo Historical Weather API (https://archive-api.open-meteo.com) - API 키 불필요,
// ERA5 재분석 기반 실측값(예보가 아니다). 기준 연도는 기본값으로 작년(올해는 아직 다 지나지 않아 월별
// 평균을 끝까지 못 구할 수 있어서) 1년치를 한 번에 받는다 - 도시당 호출 1회.
//
// 필요한 환경변수:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (승인 대기 도시엔 실제로 insert한다 - anon 키로는 "승인 대기" 도시 자체가
//                                RLS에 가려 안 보이고, discover_city_months 쓰기도 관리자만 가능해서 서비스
//                                키가 필요하다.)
//
// 사용법:
//   cd scripts/collect-city-content && npm install
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node collect-months.mjs [--city=Tokyo] [--year=2025] [--out=path]

import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCities } from "./lib/cities.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;
const USER_AGENT = "RoutoryCityMonthsCollector/1.0 (local one-off script, low volume)";

// discover_weather_bonus()와 같은 쾌적 기온 구간 - 조정 지점을 SQL 쪽과 맞추려면 둘 다 고쳐야 한다.
const COMFORT_MIN_C = 15;
const COMFORT_MAX_C = 28;
// 월 강수량 총합 - 비가 너무 많이 오는 달(우기)은 기온이 맞아도 추천하지 않는다 (느슨한 경험적 기준).
const MAX_COMFORTABLE_PRECIP_MM = 150;
// 승인 대기 도시에 자동 저장할 때 쓰는 임시 점수 - 기온만으로는 1~5점을 정확히 매길 수 없어 중간값을
// 쓴다. 관리자가 "월별 점수" 섹션에서 숫자를 보고 조정할 수 있다(저장된다고 끝이 아님).
const DEFAULT_SCORE = 3;

function parseArgs(argv) {
  const args = { city: null, year: new Date().getUTCFullYear() - 1, out: null };
  for (const raw of argv) {
    if (raw.startsWith("--city=")) args.city = raw.slice("--city=".length).toLowerCase();
    else if (raw.startsWith("--year=")) args.year = Number(raw.slice("--year=".length)) || args.year;
    else if (raw.startsWith("--out=")) args.out = raw.slice("--out=".length);
  }
  return args;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[collect-months] 환경변수 ${name}이 설정되어 있지 않아요.`);
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
      const err = new Error(`Open-Meteo HTTP ${res.status}`);
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
      const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      if (!retryable || attempt === MAX_RETRIES) break;
      console.warn(`  [open-meteo] ${label}: HTTP ${err.status}, ${RETRY_DELAY_MS}ms 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  console.warn(`  [open-meteo] ${label}: 조회 실패 - ${lastErr?.message || lastErr}`);
  return null;
}

// 도시 1곳의 1년치 일별 평균기온/강수량을 받아 월별로 집계한다.
async function fetchMonthlyClimate(lat, lng, year, label) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    daily: "temperature_2m_mean,precipitation_sum",
    timezone: "UTC",
  });
  const data = await fetchJson(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`, label);
  if (!data?.daily?.time) return null;

  const { time, temperature_2m_mean: temps, precipitation_sum: precips } = data.daily;
  const perMonth = Array.from({ length: 12 }, () => ({ tempSum: 0, tempCount: 0, precipSum: 0 }));
  for (let i = 0; i < time.length; i++) {
    const month = Number(time[i].slice(5, 7)) - 1; // "YYYY-MM-DD" -> 0-indexed month
    const temp = temps[i];
    const precip = precips[i];
    if (typeof temp === "number") {
      perMonth[month].tempSum += temp;
      perMonth[month].tempCount += 1;
    }
    if (typeof precip === "number") perMonth[month].precipSum += precip;
  }
  return perMonth.map((m) => ({
    avgTempC: m.tempCount ? m.tempSum / m.tempCount : null,
    totalPrecipMm: m.precipSum,
  }));
}

function classifyMonth(avgTempC, totalPrecipMm) {
  if (avgTempC == null) return null;
  if (avgTempC < COMFORT_MIN_C || avgTempC > COMFORT_MAX_C) return null;
  if (totalPrecipMm != null && totalPrecipMm > MAX_COMFORTABLE_PRECIP_MM) return null;

  const reasonTag = avgTempC < 21 ? "선선한 날씨" : "따뜻한 날씨";
  const reasonText = `이번 달 평균 기온이 약 ${Math.round(avgTempC)}도로 여행하기 좋은 날씨예요.`;
  return { reasonTag, reasonText };
}

async function fetchExistingMonths(supabase, cityId) {
  const { data, error } = await supabase.from("discover_city_months").select("month").eq("city_id", cityId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.month));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const cities = await fetchCities(supabase, args.city);
  if (cities.length === 0) {
    console.log("[collect-months] 조건에 맞는 도시가 없어요.");
    return;
  }

  const report = { generatedAt: new Date().toISOString(), climateYear: args.year, cities: [] };

  for (const city of cities) {
    console.log(`\n[collect-months] ${city.nameKo}(${city.nameEn}, ${city.countryCode}, ${city.isActive ? "게시 중" : "승인 대기"}) 처리 중...`);
    const existingMonths = await fetchExistingMonths(supabase, city.cityId);

    const climate = await fetchMonthlyClimate(city.lat, city.lng, args.year, `${city.nameEn} ${args.year}`);
    if (!climate) {
      console.log("  기후 데이터를 가져오지 못했어요.");
      continue;
    }

    const candidates = [];
    for (let i = 0; i < 12; i++) {
      const month = i + 1;
      if (existingMonths.has(month)) continue; // 이미 입력된 달(관리자 수동 입력이든 이전 실행의 자동 저장이든)은 건드리지 않는다
      const classified = classifyMonth(climate[i].avgTempC, climate[i].totalPrecipMm);
      if (!classified) continue;
      candidates.push({
        month,
        avgTempC: climate[i].avgTempC == null ? null : Math.round(climate[i].avgTempC * 10) / 10,
        totalPrecipMm: Math.round(climate[i].totalPrecipMm),
        reasonTag: classified.reasonTag,
        reasonText: classified.reasonText,
      });
    }

    const cityReport = {
      cityId: city.cityId,
      nameKo: city.nameKo,
      nameEn: city.nameEn,
      countryCode: city.countryCode,
      status: city.isActive ? "published" : "pending",
      autoSaved: [], // 승인 대기 도시: 바로 discover_city_months에 upsert한 것
      needsManualReview: [], // 게시 중인 도시: DB에 안 쓰고 여기 리포트에만 남긴 것
    };

    if (candidates.length === 0) {
      console.log("  이미 다 채워져 있거나, 쾌적한 달이 없어요(제안 없음).");
    } else if (!city.isActive) {
      for (const c of candidates) {
        const { error } = await supabase
          .from("discover_city_months")
          .upsert(
            { city_id: city.cityId, month: c.month, score: DEFAULT_SCORE, reason_tag: c.reasonTag, reason_text: c.reasonText },
            { onConflict: "city_id,month" }
          );
        if (error) {
          console.warn(`  ${c.month}월 저장 실패: ${error.message}`);
          continue;
        }
        cityReport.autoSaved.push({ ...c, score: DEFAULT_SCORE });
      }
      console.log(
        `  승인 대기 도시 - ${cityReport.autoSaved.length}개월 자동 저장(임시 ${DEFAULT_SCORE}점): ` +
          cityReport.autoSaved.map((s) => `${s.month}월(${s.reasonTag})`).join(", ")
      );
    } else {
      cityReport.needsManualReview = candidates;
      console.log(
        `  게시 중인 도시 - ${candidates.length}개월 제안(DB에는 안 씀, 직접 입력 필요): ` +
          candidates.map((c) => `${c.month}월(${c.reasonTag})`).join(", ")
      );
    }

    report.cities.push(cityReport);
  }

  const outDir = path.join(__dirname, "output");
  await mkdir(outDir, { recursive: true });
  const outPath = args.out || path.join(outDir, `months-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  const totalAutoSaved = report.cities.reduce((sum, c) => sum + c.autoSaved.length, 0);
  const totalNeedsReview = report.cities.reduce((sum, c) => sum + c.needsManualReview.length, 0);
  console.log(`\n[collect-months] 완료 - 자동 저장(승인 대기 도시) ${totalAutoSaved}건, 리포트만(게시 중 도시) ${totalNeedsReview}건`);
  console.log(`리포트 저장: ${outPath}`);
  console.log("자동 저장된 건도 점수는 임시값이에요 - 도시를 게시하기 전에 /admin에서 한 번 더 확인해 주세요.");
  console.log("게시 중인 도시의 제안은 DB에 안 썼어요 - 리포트를 보고 '월별 점수' 섹션에 직접 입력해 주세요.");
}

main().catch((err) => {
  console.error("[collect-months] 처리 중 오류:", (err && err.message) || err);
  process.exit(1);
});
