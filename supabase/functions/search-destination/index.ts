// search-destination: 여행지(도시) 검색 + 선택 확정 Supabase Edge Function (Deno, PRD v12 3번).
//
// 두 액션을 한 함수에서 처리한다 (body.action):
//   - 검색 (action 없음 또는 'search'): POST { q, lang?, sessionToken? }
//       1순위 destinations 테이블(프리셋+이전에 저장된 사용자 검색 도시) 부분일치, 2순위 Google Places
//       Autocomplete (New), 둘 다 실패하면 Open-Meteo Geocoding. 나라 이름이면 그 나라 프리셋 도시를 먼저
//       채우고 부족하면 "[나라] 주요 도시"로 한 번 더 찾는다. 한 번의 검색에서 외부 호출은 최대 2회.
//       응답: { results: NormalizedResult[], degraded?: true }
//   - 선택 확정: POST { action: 'select', destinationId? | placeId? | (nameEn & countryCode)?, nameKo?, sessionToken? }
//       이미 좌표·시간대가 확정된 행이면 그대로 돌려주고, 아니면 Google Place Details/Text Search →
//       (실패 시) Open-Meteo Geocoding 순서로 좌표를 확정하고, 시간대는 Open-Meteo 응답값만 쓴다(Google Time
//       Zone API는 켜 두지 않았으므로 호출하지 않는다). 좌표·시간대를 모두 못 얻으면 저장하지 않고
//       { error: 'resolve_failed' }.
//       응답: { result: NormalizedResult } | { error: 'resolve_failed' }
//
// 로그인 필수(verify_jwt 켜 둠, --no-verify-jwt로 배포하지 않는다). 검색어 전체는 로그에 남기지 않는다
// (길이·결과 수·쓴 소스만). destinations/country_currency 쓰기(INSERT/UPDATE)는 이 함수(service role)만 한다
// — 014/015_destinations*.sql이 두 표 모두 클라이언트 직접 쓰기를 막아 뒀다.
//
// 필요한 비밀값(secrets): GOOGLE_PLACES_API_KEY
//   supabase secrets set GOOGLE_PLACES_API_KEY=<서버용 Google API 키 - Places API (New) 활성화, HTTP 리퍼러
//   제한 없이(또는 이 함수가 도는 서버 IP로) 발급한 키. 클라이언트 지도용 키(googleMaps.js)와는 다른 키를
//   권장한다 - 그 키는 HTTP 리퍼러로 도메인이 제한돼 있어서 서버에서 호출하면 거절된다.>
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동으로 넣어준다.

// ==========================================================================
// 설정값
// ==========================================================================

const RATE_LIMIT_PER_MINUTE = 20; // 사용자당 분당 호출 상한 (검색+선택 합산). 조정하려면 이 값만 바꾸면 된다.
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_QUERY_CHARS = 100;
const MAX_RESULTS = 10;
const EXTERNAL_TIMEOUT_MS = 5_000; // Google 호출 타임아웃(초과하면 Open-Meteo로 폴백)
const MAX_EXTERNAL_LOOKUPS = 2; // 검색 1회당 외부(Google/Open-Meteo) 조회 최대 횟수

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

// ---- 로그인 확인 (analyze-ticket/travel-briefing과 같은 패턴) ----

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

// ---- 남용 방지: 사용자당 분당 호출 상한 ----
// 함수 인스턴스 메모리에만 두는 best-effort 제한이다 - 콜드 스타트로 리셋되거나, 동시에 여러 인스턴스가 뜨면
// 실제 상한이 설정값보다 높아질 수 있다. 엄격한 보장이 필요해지면 Postgres 테이블 기반으로 바꿔야 한다.
const rateLimitMap = new Map<string, { windowStart: number; count: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  // 가끔 오래된 항목을 정리한다(메모리가 계속 쌓이지 않도록) - 매 호출마다 전체를 훑지 않고 확률적으로만.
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

// ==========================================================================
// 나라 이름 (한/영) — country_currency(014_destinations.sql)의 201개 국가코드와 같은 코드 집합.
// 표시용(country_name_ko)과 "나라 이름 검색" 판별, Text Search 질의문 생성에 쓴다.
// ==========================================================================

const COUNTRY_NAMES: Record<string, { ko: string; en: string }> = {
  JP: { ko: "일본", en: "Japan" }, CN: { ko: "중국", en: "China" }, HK: { ko: "홍콩", en: "Hong Kong" }, MO: { ko: "마카오", en: "Macau" }, TW: { ko: "대만", en: "Taiwan" },
  BN: { ko: "브루나이", en: "Brunei" }, KH: { ko: "캄보디아", en: "Cambodia" }, ID: { ko: "인도네시아", en: "Indonesia" }, LA: { ko: "라오스", en: "Laos" }, MY: { ko: "말레이시아", en: "Malaysia" },
  MM: { ko: "미얀마", en: "Myanmar" }, PH: { ko: "필리핀", en: "Philippines" }, SG: { ko: "싱가포르", en: "Singapore" }, TH: { ko: "태국", en: "Thailand" }, TL: { ko: "동티모르", en: "Timor-Leste" }, VN: { ko: "베트남", en: "Vietnam" },
  AT: { ko: "오스트리아", en: "Austria" }, BE: { ko: "벨기에", en: "Belgium" }, BG: { ko: "불가리아", en: "Bulgaria" }, HR: { ko: "크로아티아", en: "Croatia" }, CY: { ko: "키프로스", en: "Cyprus" },
  CZ: { ko: "체코", en: "Czechia" }, DK: { ko: "덴마크", en: "Denmark" }, EE: { ko: "에스토니아", en: "Estonia" }, FI: { ko: "핀란드", en: "Finland" }, FR: { ko: "프랑스", en: "France" },
  DE: { ko: "독일", en: "Germany" }, GR: { ko: "그리스", en: "Greece" }, HU: { ko: "헝가리", en: "Hungary" }, IE: { ko: "아일랜드", en: "Ireland" }, IT: { ko: "이탈리아", en: "Italy" },
  LV: { ko: "라트비아", en: "Latvia" }, LT: { ko: "리투아니아", en: "Lithuania" }, LU: { ko: "룩셈부르크", en: "Luxembourg" }, MT: { ko: "몰타", en: "Malta" }, NL: { ko: "네덜란드", en: "Netherlands" },
  PL: { ko: "폴란드", en: "Poland" }, PT: { ko: "포르투갈", en: "Portugal" }, RO: { ko: "루마니아", en: "Romania" }, SK: { ko: "슬로바키아", en: "Slovakia" }, SI: { ko: "슬로베니아", en: "Slovenia" },
  ES: { ko: "스페인", en: "Spain" }, SE: { ko: "스웨덴", en: "Sweden" }, GB: { ko: "영국", en: "United Kingdom" }, CH: { ko: "스위스", en: "Switzerland" }, NO: { ko: "노르웨이", en: "Norway" },
  IS: { ko: "아이슬란드", en: "Iceland" }, LI: { ko: "리히텐슈타인", en: "Liechtenstein" }, MC: { ko: "모나코", en: "Monaco" }, SM: { ko: "산마리노", en: "San Marino" }, VA: { ko: "바티칸", en: "Vatican City" },
  AD: { ko: "안도라", en: "Andorra" }, AL: { ko: "알바니아", en: "Albania" }, BA: { ko: "보스니아 헤르체고비나", en: "Bosnia and Herzegovina" }, ME: { ko: "몬테네그로", en: "Montenegro" },
  MK: { ko: "북마케도니아", en: "North Macedonia" }, RS: { ko: "세르비아", en: "Serbia" }, XK: { ko: "코소보", en: "Kosovo" }, MD: { ko: "몰도바", en: "Moldova" }, UA: { ko: "우크라이나", en: "Ukraine" },
  BY: { ko: "벨라루스", en: "Belarus" }, RU: { ko: "러시아", en: "Russia" }, US: { ko: "미국", en: "United States" }, CA: { ko: "캐나다", en: "Canada" },
  MX: { ko: "멕시코", en: "Mexico" }, BZ: { ko: "벨리즈", en: "Belize" }, GT: { ko: "과테말라", en: "Guatemala" }, HN: { ko: "온두라스", en: "Honduras" }, SV: { ko: "엘살바도르", en: "El Salvador" },
  NI: { ko: "니카라과", en: "Nicaragua" }, CR: { ko: "코스타리카", en: "Costa Rica" }, PA: { ko: "파나마", en: "Panama" }, CU: { ko: "쿠바", en: "Cuba" }, JM: { ko: "자메이카", en: "Jamaica" },
  HT: { ko: "아이티", en: "Haiti" }, DO: { ko: "도미니카공화국", en: "Dominican Republic" }, BS: { ko: "바하마", en: "Bahamas" }, TT: { ko: "트리니다드토바고", en: "Trinidad and Tobago" },
  BB: { ko: "바베이도스", en: "Barbados" }, AG: { ko: "앤티가바부다", en: "Antigua and Barbuda" }, DM: { ko: "도미니카연방", en: "Dominica" }, GD: { ko: "그레나다", en: "Grenada" },
  KN: { ko: "세인트키츠네비스", en: "Saint Kitts and Nevis" }, LC: { ko: "세인트루시아", en: "Saint Lucia" }, VC: { ko: "세인트빈센트그레나딘", en: "Saint Vincent and the Grenadines" },
  AR: { ko: "아르헨티나", en: "Argentina" }, BO: { ko: "볼리비아", en: "Bolivia" }, BR: { ko: "브라질", en: "Brazil" }, CL: { ko: "칠레", en: "Chile" }, CO: { ko: "콜롬비아", en: "Colombia" },
  EC: { ko: "에콰도르", en: "Ecuador" }, GY: { ko: "가이아나", en: "Guyana" }, PY: { ko: "파라과이", en: "Paraguay" }, PE: { ko: "페루", en: "Peru" }, SR: { ko: "수리남", en: "Suriname" },
  UY: { ko: "우루과이", en: "Uruguay" }, VE: { ko: "베네수엘라", en: "Venezuela" }, AU: { ko: "호주", en: "Australia" }, NZ: { ko: "뉴질랜드", en: "New Zealand" }, FJ: { ko: "피지", en: "Fiji" },
  PG: { ko: "파푸아뉴기니", en: "Papua New Guinea" }, SB: { ko: "솔로몬제도", en: "Solomon Islands" }, VU: { ko: "바누아투", en: "Vanuatu" }, WS: { ko: "사모아", en: "Samoa" }, TO: { ko: "통가", en: "Tonga" },
  KI: { ko: "키리바시", en: "Kiribati" }, TV: { ko: "투발루", en: "Tuvalu" }, NR: { ko: "나우루", en: "Nauru" }, PW: { ko: "팔라우", en: "Palau" }, FM: { ko: "미크로네시아", en: "Micronesia" },
  MH: { ko: "마셜제도", en: "Marshall Islands" }, GU: { ko: "괌", en: "Guam" }, MP: { ko: "북마리아나제도", en: "Northern Mariana Islands" },
  AE: { ko: "아랍에미리트", en: "United Arab Emirates" }, BH: { ko: "바레인", en: "Bahrain" }, EG: { ko: "이집트", en: "Egypt" }, IR: { ko: "이란", en: "Iran" }, IQ: { ko: "이라크", en: "Iraq" },
  IL: { ko: "이스라엘", en: "Israel" }, JO: { ko: "요르단", en: "Jordan" }, KW: { ko: "쿠웨이트", en: "Kuwait" }, LB: { ko: "레바논", en: "Lebanon" }, OM: { ko: "오만", en: "Oman" },
  PS: { ko: "팔레스타인", en: "Palestine" }, QA: { ko: "카타르", en: "Qatar" }, SA: { ko: "사우디아라비아", en: "Saudi Arabia" }, SY: { ko: "시리아", en: "Syria" }, TR: { ko: "터키", en: "Turkey" }, YE: { ko: "예멘", en: "Yemen" },
  KR: { ko: "대한민국", en: "South Korea" }, KP: { ko: "북한", en: "North Korea" }, MN: { ko: "몽골", en: "Mongolia" },
  AF: { ko: "아프가니스탄", en: "Afghanistan" }, BD: { ko: "방글라데시", en: "Bangladesh" }, BT: { ko: "부탄", en: "Bhutan" }, IN: { ko: "인도", en: "India" }, MV: { ko: "몰디브", en: "Maldives" },
  NP: { ko: "네팔", en: "Nepal" }, PK: { ko: "파키스탄", en: "Pakistan" }, LK: { ko: "스리랑카", en: "Sri Lanka" },
  KZ: { ko: "카자흐스탄", en: "Kazakhstan" }, KG: { ko: "키르기스스탄", en: "Kyrgyzstan" }, TJ: { ko: "타지키스탄", en: "Tajikistan" }, TM: { ko: "투르크메니스탄", en: "Turkmenistan" }, UZ: { ko: "우즈베키스탄", en: "Uzbekistan" },
  AM: { ko: "아르메니아", en: "Armenia" }, AZ: { ko: "아제르바이잔", en: "Azerbaijan" }, GE: { ko: "조지아", en: "Georgia" },
  MA: { ko: "모로코", en: "Morocco" }, DZ: { ko: "알제리", en: "Algeria" }, TN: { ko: "튀니지", en: "Tunisia" }, LY: { ko: "리비아", en: "Libya" },
  NG: { ko: "나이지리아", en: "Nigeria" }, GH: { ko: "가나", en: "Ghana" }, SN: { ko: "세네갈", en: "Senegal" }, ML: { ko: "말리", en: "Mali" }, BF: { ko: "부르키나파소", en: "Burkina Faso" },
  NE: { ko: "니제르", en: "Niger" }, GN: { ko: "기니", en: "Guinea" }, GW: { ko: "기니비사우", en: "Guinea-Bissau" }, SL: { ko: "시에라리온", en: "Sierra Leone" }, LR: { ko: "라이베리아", en: "Liberia" },
  CI: { ko: "코트디부아르", en: "Côte d'Ivoire" }, TG: { ko: "토고", en: "Togo" }, BJ: { ko: "베냉", en: "Benin" }, CV: { ko: "카보베르데", en: "Cape Verde" }, GM: { ko: "감비아", en: "Gambia" }, MR: { ko: "모리타니", en: "Mauritania" },
  CM: { ko: "카메룬", en: "Cameroon" }, CF: { ko: "중앙아프리카공화국", en: "Central African Republic" }, TD: { ko: "차드", en: "Chad" }, CG: { ko: "콩고공화국", en: "Congo" },
  CD: { ko: "콩고민주공화국", en: "DR Congo" }, GQ: { ko: "적도기니", en: "Equatorial Guinea" }, GA: { ko: "가봉", en: "Gabon" }, ST: { ko: "상투메프린시페", en: "São Tomé and Príncipe" },
  ET: { ko: "에티오피아", en: "Ethiopia" }, KE: { ko: "케냐", en: "Kenya" }, TZ: { ko: "탄자니아", en: "Tanzania" }, UG: { ko: "우간다", en: "Uganda" }, RW: { ko: "르완다", en: "Rwanda" },
  BI: { ko: "부룬디", en: "Burundi" }, SO: { ko: "소말리아", en: "Somalia" }, DJ: { ko: "지부티", en: "Djibouti" }, ER: { ko: "에리트레아", en: "Eritrea" }, SS: { ko: "남수단", en: "South Sudan" },
  SD: { ko: "수단", en: "Sudan" }, MG: { ko: "마다가스카르", en: "Madagascar" }, MU: { ko: "모리셔스", en: "Mauritius" }, SC: { ko: "세이셸", en: "Seychelles" }, KM: { ko: "코모로", en: "Comoros" },
  ZA: { ko: "남아프리카공화국", en: "South Africa" }, NA: { ko: "나미비아", en: "Namibia" }, BW: { ko: "보츠와나", en: "Botswana" }, ZW: { ko: "짐바브웨", en: "Zimbabwe" }, ZM: { ko: "잠비아", en: "Zambia" },
  MZ: { ko: "모잠비크", en: "Mozambique" }, MW: { ko: "말라위", en: "Malawi" }, AO: { ko: "앙골라", en: "Angola" }, SZ: { ko: "에스와티니", en: "Eswatini" }, LS: { ko: "레소토", en: "Lesotho" },
};

const countryNameKo = (code: string | null | undefined) => (code && COUNTRY_NAMES[code]?.ko) || code || "";
const countryNameEn = (code: string | null | undefined) => (code && COUNTRY_NAMES[code]?.en) || code || "";

// 입력 문자열이 (정규화 후) 어느 나라의 한국어 이름과 정확히 같으면 그 국가코드를 돌려준다
function countryCodeByKoName(input: string): string | null {
  const norm = input.trim().toLowerCase();
  for (const [code, names] of Object.entries(COUNTRY_NAMES)) {
    if (names.ko.toLowerCase() === norm) return code;
  }
  return null;
}

// ==========================================================================
// Postgres REST (PostgREST에 직접 fetch - 다른 Gemini 계열 함수들과 같은 "no imports" 원칙)
// ==========================================================================

function restHeaders(serviceRoleKey: string, extra?: Record<string, string>) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...extra };
}

// PostgREST or=(...) 필터 안에 들어갈 값 이스케이프 (쉼표/괄호가 있으면 더블쿼트로 감싼다)
function pgFilterValue(v: string): string {
  return /[,()]/.test(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v;
}

type DestRow = {
  id: string;
  name_ko: string;
  name_en: string;
  country_code: string;
  region: string;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  currency: string | null;
  place_id: string | null;
  source: "preset" | "user";
  resolved_at: string | null;
};

async function pgGet<T>(baseUrl: string, serviceRoleKey: string, path: string): Promise<T[]> {
  try {
    const res = await fetch(`${baseUrl}/rest/v1/${path}`, { headers: restHeaders(serviceRoleKey) });
    if (!res.ok) {
      console.error("[search-destination] DB 조회 실패", path.split("?")[0], res.status);
      return [];
    }
    return (await res.json().catch(() => [])) as T[];
  } catch (err) {
    console.error("[search-destination] DB 조회 중 오류", path.split("?")[0], err instanceof Error ? err.message : err);
    return [];
  }
}

// name_ko/name_en 부분일치 (대소문자 무시) - 최대 limit개, source 무관
async function searchDestinationsByText(baseUrl: string, key: string, q: string, limit: number): Promise<DestRow[]> {
  const pattern = pgFilterValue(`*${q}*`);
  const filter = `or=(name_ko.ilike.${pattern},name_en.ilike.${pattern})`;
  return pgGet<DestRow>(baseUrl, key, `destinations?${filter}&order=source.asc,sort_order.asc&limit=${limit}&select=*`);
}

async function destinationsByCountry(baseUrl: string, key: string, countryCode: string, limit: number): Promise<DestRow[]> {
  return pgGet<DestRow>(baseUrl, key, `destinations?country_code=eq.${encodeURIComponent(countryCode)}&order=source.asc,sort_order.asc&limit=${limit}&select=*`);
}

async function destinationById(baseUrl: string, key: string, id: string): Promise<DestRow | null> {
  const rows = await pgGet<DestRow>(baseUrl, key, `destinations?id=eq.${encodeURIComponent(id)}&limit=1&select=*`);
  return rows[0] ?? null;
}

async function destinationByPlaceId(baseUrl: string, key: string, placeId: string): Promise<DestRow | null> {
  const rows = await pgGet<DestRow>(baseUrl, key, `destinations?place_id=eq.${encodeURIComponent(placeId)}&limit=1&select=*`);
  return rows[0] ?? null;
}

async function destinationByNameCountry(baseUrl: string, key: string, nameEn: string, countryCode: string): Promise<DestRow | null> {
  const rows = await pgGet<DestRow>(
    baseUrl,
    key,
    `destinations?country_code=eq.${encodeURIComponent(countryCode)}&name_en=ilike.${encodeURIComponent(nameEn)}&limit=1&select=*`
  );
  return rows[0] ?? null;
}

async function countryCurrencyRow(baseUrl: string, key: string, countryCode: string): Promise<{ currency_code: string; region: string } | null> {
  const rows = await pgGet<{ currency_code: string; region: string }>(baseUrl, key, `country_currency?country_code=eq.${encodeURIComponent(countryCode)}&limit=1&select=currency_code,region`);
  return rows[0] ?? null;
}

// 좌표·시간대가 모두 갖춰졌을 때만 부른다. (country_code, name_en) 유니크로 upsert - 동시에 같은 도시를
// 두 사용자가 선택해도 중복 행이 생기지 않는다. 사용자 식별 정보는 어떤 필드에도 넣지 않는다.
async function upsertResolvedDestination(
  baseUrl: string,
  key: string,
  values: {
    name_ko: string;
    name_en: string;
    country_code: string;
    region: string;
    lat: number;
    lng: number;
    timezone: string;
    currency: string | null;
    place_id: string | null;
    source: "preset" | "user";
  }
): Promise<DestRow | null> {
  try {
    const res = await fetch(`${baseUrl}/rest/v1/destinations?on_conflict=country_code,name_en`, {
      method: "POST",
      headers: restHeaders(key, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify([{ ...values, resolved_at: new Date().toISOString() }]),
    });
    if (!res.ok) {
      console.error("[search-destination] destinations upsert 실패", res.status, await res.text().catch(() => ""));
      return null;
    }
    const rows = (await res.json().catch(() => [])) as DestRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.error("[search-destination] destinations upsert 중 오류", err instanceof Error ? err.message : err);
    return null;
  }
}

// 기존 행(이미 다른 필드가 채워진 preset/user 행)의 좌표·시간대만 메운다 - name/country/currency는 그대로 둔다.
async function fillDestinationCoords(baseUrl: string, key: string, id: string, lat: number, lng: number, timezone: string, placeId: string | null): Promise<DestRow | null> {
  try {
    const patch: Record<string, unknown> = { lat, lng, timezone, resolved_at: new Date().toISOString() };
    if (placeId) patch.place_id = placeId;
    const res = await fetch(`${baseUrl}/rest/v1/destinations?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: restHeaders(key, { Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      console.error("[search-destination] destinations 좌표 보완 실패", res.status, await res.text().catch(() => ""));
      return null;
    }
    const rows = (await res.json().catch(() => [])) as DestRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.error("[search-destination] destinations 좌표 보완 중 오류", err instanceof Error ? err.message : err);
    return null;
  }
}

// ==========================================================================
// Google Places API (New)
// ==========================================================================

type AutocompleteSuggestion = { mainText: string; secondaryText: string; placeId: string; types: string[] };

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 도시(locality)·나라(country) 타입으로 제한한 Autocomplete (New). 실패/타임아웃이면 null(호출한 쪽이 폴백).
async function placesAutocomplete(input: string, languageCode: string, apiKey: string, sessionToken?: string): Promise<AutocompleteSuggestion[] | null> {
  return withTimeout(async (signal) => {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
      },
      body: JSON.stringify({
        input,
        includedPrimaryTypes: ["locality", "country"],
        languageCode,
        ...(sessionToken ? { sessionToken } : {}),
      }),
      signal,
    });
    if (!res.ok) {
      console.error("[search-destination] Places Autocomplete 오류", res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    return suggestions
      .map((s: Record<string, unknown>) => {
        const p = s.placePrediction as Record<string, unknown> | undefined;
        if (!p) return null;
        const structured = p.structuredFormat as Record<string, Record<string, unknown>> | undefined;
        return {
          mainText: String(structured?.mainText?.text ?? (p.text as Record<string, unknown>)?.text ?? ""),
          secondaryText: String(structured?.secondaryText?.text ?? ""),
          placeId: String(p.placeId ?? ""),
          types: Array.isArray(p.types) ? (p.types as string[]) : [],
        };
      })
      .filter((s: AutocompleteSuggestion | null): s is AutocompleteSuggestion => !!s && !!s.placeId);
  }, EXTERNAL_TIMEOUT_MS);
}

type GooglePlace = { lat: number; lng: number; countryCode: string | null; displayName: string | null; placeId: string };

function extractCountryCode(addressComponents: unknown): string | null {
  if (!Array.isArray(addressComponents)) return null;
  const country = addressComponents.find((c: Record<string, unknown>) => Array.isArray(c.types) && (c.types as string[]).includes("country"));
  return typeof country?.shortText === "string" ? country.shortText.toUpperCase() : null;
}

// Place Details (New) by place_id - 이미 특정 장소가 고른 상태라 결과의 나라를 다시 검증하지 않는다.
async function placeDetails(placeId: string, apiKey: string, sessionToken?: string): Promise<GooglePlace | null> {
  return withTimeout(async (signal) => {
    const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${qs}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "location,addressComponents,displayName",
      },
      signal,
    });
    if (!res.ok) {
      console.error("[search-destination] Place Details 오류", res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!data?.location) return null;
    return {
      lat: data.location.latitude,
      lng: data.location.longitude,
      countryCode: extractCountryCode(data.addressComponents),
      displayName: typeof data.displayName?.text === "string" ? data.displayName.text : null,
      placeId,
    };
  }, EXTERNAL_TIMEOUT_MS);
}

// Text Search (New) - place_id가 없을 때 "이름, 나라"로 찾고, 같은 국가코드의 결과만 인정한다(동명이인 도시 방지)
async function textSearchInCountry(query: string, expectedCountryCode: string | null, apiKey: string): Promise<GooglePlace | null> {
  const results = await withTimeout(async (signal) => {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.location,places.addressComponents,places.displayName",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "en" }),
      signal,
    });
    if (!res.ok) {
      console.error("[search-destination] Text Search 오류", res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.places) ? data.places : [];
  }, EXTERNAL_TIMEOUT_MS);

  if (!results) return null;
  for (const place of results) {
    const countryCode = extractCountryCode(place.addressComponents);
    if (!expectedCountryCode || countryCode === expectedCountryCode) {
      if (!place.location) continue;
      return {
        lat: place.location.latitude,
        lng: place.location.longitude,
        countryCode: countryCode ?? expectedCountryCode,
        displayName: typeof place.displayName?.text === "string" ? place.displayName.text : null,
        placeId: String(place.id ?? ""),
      };
    }
  }
  return null;
}

// ==========================================================================
// Open-Meteo Geocoding (키 없음, 폴백 + 시간대 조회용)
// ==========================================================================

type OpenMeteoHit = { name: string; lat: number; lng: number; countryCode: string | null; timezone: string | null };

async function openMeteoGeocode(name: string, language: string, count: number): Promise<OpenMeteoHit[] | null> {
  return withTimeout(async (signal) => {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${count}&language=${encodeURIComponent(language)}&format=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      console.error("[search-destination] Open-Meteo 오류", res.status);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data?.results)) return [];
    return data.results.map((r: Record<string, unknown>) => ({
      name: String(r.name ?? ""),
      lat: Number(r.latitude),
      lng: Number(r.longitude),
      countryCode: typeof r.country_code === "string" ? r.country_code.toUpperCase() : null,
      timezone: typeof r.timezone === "string" ? r.timezone : null,
    }));
  }, EXTERNAL_TIMEOUT_MS);
}

// ==========================================================================
// 정규화된 결과
// ==========================================================================

type NormalizedResult = {
  id: string | null; // destinations.id - 이미 그 표에 있는 행(preset/user)이면 채워진다. 선택(action:'select') 시 destinationId로 바로 쓸 수 있어 가장 안전한 식별자다.
  name_ko: string;
  name_en: string;
  country_code: string | null;
  country_name_ko: string;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  currency: string | null; // destinations.currency - country_currency에 없는 나라면 null(015). 미확정 상태(resolved_at 전)에도 null일 수 있다.
  place_id: string | null;
  source: "preset" | "user" | "search";
  is_preset: boolean;
};

function fromDestRow(row: DestRow): NormalizedResult {
  return {
    id: row.id,
    name_ko: row.name_ko,
    name_en: row.name_en,
    country_code: row.country_code,
    country_name_ko: countryNameKo(row.country_code),
    lat: row.lat,
    lng: row.lng,
    timezone: row.timezone,
    currency: row.currency,
    place_id: row.place_id,
    source: row.source,
    is_preset: row.source === "preset",
  };
}

// 구글 제안 1건의 secondaryText("도시, 나라" 형태가 흔하다)에서 마지막 구성요소를 나라 이름으로 추정한다.
// 맞는 나라를 못 찾으면 country_code는 null로 둔다 - place_id가 있으니 선택 단계에서 Place Details로 확정된다.
function guessCountryFromSecondaryText(secondaryText: string): string | null {
  const last = secondaryText.split(",").pop()?.trim();
  return last ? countryCodeByKoName(last) : null;
}

function fromAutocomplete(s: AutocompleteSuggestion, lang: string): NormalizedResult {
  const countryCode = guessCountryFromSecondaryText(s.secondaryText);
  // 한 번의 Autocomplete 호출로는 한 언어만 오므로, 요청 언어가 아닌 쪽은 같은 표시값을 임시로 채운다
  // (정확한 영문 표기는 선택(action:'select') 단계의 Place Details/Text Search에서 확정된다).
  return {
    id: null,
    name_ko: lang === "ko" ? s.mainText : s.mainText,
    name_en: s.mainText,
    country_code: countryCode,
    country_name_ko: countryCode ? countryNameKo(countryCode) : s.secondaryText,
    lat: null,
    lng: null,
    timezone: null,
    currency: null,
    place_id: s.placeId,
    source: "search",
    is_preset: false,
  };
}

function fromOpenMeteo(hit: OpenMeteoHit): NormalizedResult {
  return {
    id: null,
    name_ko: hit.name,
    name_en: hit.name,
    country_code: hit.countryCode,
    country_name_ko: countryNameKo(hit.countryCode),
    lat: hit.lat,
    lng: hit.lng,
    timezone: hit.timezone,
    currency: null,
    place_id: null,
    source: "search",
    is_preset: false,
  };
}

function dedupeKey(r: NormalizedResult): string {
  if (r.place_id) return `place:${r.place_id}`;
  return `name:${r.name_ko.toLowerCase()}|${r.name_en.toLowerCase()}`;
}

// ==========================================================================
// 검색 (action: 'search' 또는 미지정)
// ==========================================================================

function validateQuery(raw: unknown): string | null {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (!q || q.length > MAX_QUERY_CHARS) return null;
  const hasHangul = /[가-힣]/.test(q);
  const minLen = hasHangul ? 1 : 2;
  return q.length >= minLen ? q : null;
}

async function handleSearch(req: Request, baseUrl: string, serviceKey: string, apiKey: string | undefined): Promise<Response> {
  const body = await req.json().catch(() => null);
  const q = validateQuery((body as Record<string, unknown> | null)?.q);
  if (!q) return json({ error: "q(검색어)가 비어있거나 길이가 맞지 않아요" }, 400);
  const lang = (body as Record<string, unknown>)?.lang === "en" ? "en" : "ko";
  const sessionToken = typeof (body as Record<string, unknown>)?.sessionToken === "string" ? ((body as Record<string, unknown>).sessionToken as string) : undefined;

  let externalLookups = 0;
  let degraded = false;
  const usedSources = new Set<string>(["preset"]);

  const presetHits = await searchDestinationsByText(baseUrl, serviceKey, q, MAX_RESULTS);
  const results: NormalizedResult[] = presetHits.map(fromDestRow);

  let detectedCountryCode: string | null = countryCodeByKoName(q);

  if (results.length < MAX_RESULTS && externalLookups < MAX_EXTERNAL_LOOKUPS) {
    externalLookups += 1;
    let googleOk = false;
    if (apiKey) {
      const suggestions = await placesAutocomplete(q, lang, apiKey, sessionToken);
      if (suggestions) {
        googleOk = true;
        usedSources.add("google");
        if (!detectedCountryCode && suggestions[0]?.types.includes("country")) {
          detectedCountryCode = countryCodeByKoName(suggestions[0].mainText) ?? guessCountryFromSecondaryText(suggestions[0].secondaryText);
        }
        const existingKeys = new Set(results.map(dedupeKey));
        const existingNames = new Set(results.flatMap((r) => [r.name_ko.toLowerCase(), r.name_en.toLowerCase()]));
        for (const s of suggestions) {
          if (s.types.includes("country") && detectedCountryCode) continue; // 나라 자체는 도시 목록에 안 넣는다
          const normalized = fromAutocomplete(s, lang);
          if (existingKeys.has(dedupeKey(normalized))) continue;
          if (existingNames.has(normalized.name_ko.toLowerCase())) continue;
          results.push(normalized);
        }
      }
    }
    if (!googleOk) {
      usedSources.add("open-meteo");
      const hits = await openMeteoGeocode(q, lang, MAX_RESULTS);
      if (hits) {
        const existingKeys = new Set(results.map(dedupeKey));
        for (const hit of hits) {
          const normalized = fromOpenMeteo(hit);
          if (existingKeys.has(dedupeKey(normalized))) continue;
          results.push(normalized);
        }
      } else {
        degraded = true; // Google도, Open-Meteo도 실패 - 프리셋 결과만 돌려준다
      }
    }
  }

  // 나라 이름 검색: 그 나라의 프리셋 도시를 먼저 채우고, 부족하면 "[나라] 주요 도시"로 한 번 더 찾는다
  if (detectedCountryCode) {
    const countryCities = await destinationsByCountry(baseUrl, serviceKey, detectedCountryCode, MAX_RESULTS);
    const existingKeys = new Set(results.map(dedupeKey));
    for (const row of countryCities) {
      const normalized = fromDestRow(row);
      if (existingKeys.has(dedupeKey(normalized))) continue;
      results.unshift(normalized); // 나라의 프리셋 도시를 앞쪽에
      existingKeys.add(dedupeKey(normalized));
    }

    if (results.length < MAX_RESULTS && externalLookups < MAX_EXTERNAL_LOOKUPS && apiKey) {
      externalLookups += 1;
      const expansionQuery = lang === "en" ? `major cities in ${countryNameEn(detectedCountryCode)}` : `${countryNameKo(detectedCountryCode)} 주요 도시`;
      const suggestions = await placesAutocomplete(expansionQuery, lang, apiKey, sessionToken);
      if (suggestions) {
        usedSources.add("google");
        const keys = new Set(results.map(dedupeKey));
        const names = new Set(results.flatMap((r) => [r.name_ko.toLowerCase(), r.name_en.toLowerCase()]));
        for (const s of suggestions) {
          if (s.types.includes("country")) continue;
          const normalized = { ...fromAutocomplete(s, lang), country_code: detectedCountryCode, country_name_ko: countryNameKo(detectedCountryCode) };
          if (keys.has(dedupeKey(normalized)) || names.has(normalized.name_ko.toLowerCase())) continue;
          results.push(normalized);
        }
      }
    }
  }

  console.log(`[search-destination] search q_len=${q.length} lang=${lang} results=${results.length} sources=${Array.from(usedSources).join("+")} degraded=${degraded}`);

  return json({ results: results.slice(0, MAX_RESULTS), ...(degraded ? { degraded: true } : {}) });
}

// ==========================================================================
// 선택 확정 (action: 'select')
// ==========================================================================

type SelectInput = {
  destinationId?: string;
  placeId?: string;
  nameEn?: string;
  nameKo?: string;
  countryCode?: string;
  sessionToken?: string;
};

function readSelectInput(body: unknown): SelectInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const destinationId = str(b.destinationId);
  const placeId = str(b.placeId);
  const nameEn = str(b.nameEn);
  const countryCode = str(b.countryCode)?.toUpperCase();
  if (!destinationId && !placeId && !(nameEn && countryCode)) return null;
  return { destinationId, placeId, nameEn, nameKo: str(b.nameKo), countryCode, sessionToken: str(b.sessionToken) };
}

const isResolved = (row: DestRow) => row.lat !== null && row.lng !== null && !!row.timezone && !!row.resolved_at;

async function handleSelect(req: Request, baseUrl: string, serviceKey: string, apiKey: string | undefined): Promise<Response> {
  const body = await req.json().catch(() => null);
  const input = readSelectInput(body);
  if (!input) return json({ error: "destinationId 또는 placeId 또는 (nameEn+countryCode)가 필요해요" }, 400);

  // 1) 이미 있는 행 찾기
  let row: DestRow | null = null;
  if (input.destinationId) row = await destinationById(baseUrl, serviceKey, input.destinationId);
  else if (input.placeId) row = await destinationByPlaceId(baseUrl, serviceKey, input.placeId);
  else if (input.nameEn && input.countryCode) row = await destinationByNameCountry(baseUrl, serviceKey, input.nameEn, input.countryCode);

  if (row && isResolved(row)) {
    console.log(`[search-destination] select hit=db resolved=true source=${row.source}`);
    return json({ result: fromDestRow(row) });
  }

  // 2) 좌표 확정: place_id가 있으면 Place Details, 없으면 Text Search. Google 실패 시 Open-Meteo로 대체.
  const placeId = input.placeId ?? row?.place_id ?? null;
  const nameEn = input.nameEn ?? row?.name_en ?? null;
  const expectedCountryCode = input.countryCode ?? row?.country_code ?? null;

  if (!nameEn && !placeId) return json({ error: "resolve_failed" });

  let lat: number | null = null;
  let lng: number | null = null;
  let resolvedCountryCode: string | null = expectedCountryCode;
  let resolvedNameEn: string | null = nameEn;
  let discoveredPlaceId: string | null = placeId;
  let timezone: string | null = null;
  let usedSource: "google" | "open-meteo" | null = null;

  if (apiKey) {
    if (placeId) {
      const details = await placeDetails(placeId, apiKey, input.sessionToken);
      if (details) {
        lat = details.lat;
        lng = details.lng;
        resolvedCountryCode = details.countryCode ?? expectedCountryCode;
        resolvedNameEn = resolvedNameEn ?? details.displayName;
        usedSource = "google";
      }
    } else if (nameEn) {
      const found = await textSearchInCountry(`${nameEn}, ${countryNameEn(expectedCountryCode)}`, expectedCountryCode, apiKey);
      if (found) {
        lat = found.lat;
        lng = found.lng;
        resolvedCountryCode = found.countryCode ?? expectedCountryCode;
        discoveredPlaceId = discoveredPlaceId ?? (found.placeId || null);
        usedSource = "google";
      }
    }
  }

  // Open-Meteo: 좌표가 아직 없으면 폴백 소스로, 좌표가 이미 있으면 시간대만 보완하는 용도로 한 번 부른다.
  const geocodeName = nameEn ?? resolvedNameEn ?? row?.name_ko ?? "";
  if (geocodeName) {
    const hits = await openMeteoGeocode(geocodeName, "en", 10);
    const match = hits?.find((h) => !expectedCountryCode || h.countryCode === expectedCountryCode) ?? (lat === null ? hits?.[0] ?? null : null);
    if (match) {
      if (lat === null || lng === null) {
        lat = match.lat;
        lng = match.lng;
        resolvedCountryCode = match.countryCode ?? resolvedCountryCode;
        usedSource = usedSource ?? "open-meteo";
      }
      timezone = match.timezone ?? timezone;
    }
  }

  if (lat === null || lng === null || !timezone || !resolvedCountryCode) {
    console.log(`[search-destination] select resolve_failed hasCoords=${lat !== null} hasTimezone=${!!timezone} hasCountry=${!!resolvedCountryCode}`);
    return json({ error: "resolve_failed" });
  }

  // 3) 통화/지역: country_currency에 없는 나라면 region은 'other', currency는 null.
  const currencyRow = await countryCurrencyRow(baseUrl, serviceKey, resolvedCountryCode);
  const region = currencyRow?.region ?? "other";
  const currency = currencyRow?.currency_code ?? null;

  // 4) 저장 - 기존 행이면 좌표·시간대만 보완, 없으면 새로 upsert (동시 선택에도 중복 없음)
  let saved: DestRow | null;
  if (row) {
    saved = await fillDestinationCoords(baseUrl, serviceKey, row.id, lat, lng, timezone, discoveredPlaceId);
  } else {
    const finalNameEn = resolvedNameEn ?? nameEn ?? geocodeName;
    saved = await upsertResolvedDestination(baseUrl, serviceKey, {
      name_ko: input.nameKo ?? finalNameEn,
      name_en: finalNameEn,
      country_code: resolvedCountryCode,
      region,
      lat,
      lng,
      timezone,
      currency,
      place_id: discoveredPlaceId,
      source: "user",
    });
  }

  if (!saved) return json({ error: "resolve_failed" });

  console.log(`[search-destination] select resolved=true source=${usedSource} saved_as=${saved.source}`);
  return json({ result: fromDestRow(saved) });
}

// ==========================================================================
// 요청 처리
// ==========================================================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const { authenticated, userId } = authClaims(req);
  if (!authenticated || !userId) return json({ error: "로그인이 필요해요" }, 401);
  if (!checkRateLimit(userId)) return json({ error: "너무 자주 호출했어요. 잠시 뒤 다시 시도해주세요" }, 429);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[search-destination] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어요");
    return json({ error: "서버 설정 오류" }, 500);
  }
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) console.error("[search-destination] GOOGLE_PLACES_API_KEY 비밀값이 설정되어 있지 않아요 - Open-Meteo 전용으로만 동작해요");

  // body를 각 핸들러가 다시 읽어야 해서(req.json()은 한 번만 읽힌다) 먼저 action만 미리 들여다본다
  const raw = await req.clone().json().catch(() => null);
  const action = typeof (raw as Record<string, unknown> | null)?.action === "string" ? (raw as Record<string, unknown>).action : "search";

  if (action === "select") return handleSelect(req, supabaseUrl, serviceRoleKey, apiKey);
  if (action === "search") return handleSearch(req, supabaseUrl, serviceRoleKey, apiKey);
  return json({ error: "action은 'search' 또는 'select'여야 해요" }, 400);
});
