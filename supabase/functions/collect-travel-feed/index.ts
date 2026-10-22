// collect-travel-feed: pg_cron이 매일 한 번 부르는 자동 수집 Supabase Edge Function (Deno, no imports).
// 단계 0 조사에서 "자동 수집 가능"으로 확인된 공식 API만 쓴다 — 외교부 해외안전여행(여행경보·안전공지)과
// 한국관광공사 TourAPI(축제·행사). "자동 수집 불가"로 분류된 인기 여행지 통계(공식 월간 순위 통계는 API가
// 아니라 데이터랩 게시판 엑셀 파일로만 공개됨)는 이번에 만들지 않는다 — 관리 페이지(/admin)에서 계속
// 수동으로 입력한다.
//
// 호출: POST (본문 없음), 헤더 x-cron-secret: <CRON_SECRET 비밀값과 동일한 값>
//   - 사람이 로그인해서 쓰는 다른 함수들(analyze-ticket 등)과 달리, 이 함수는 pg_cron(서버 대 서버)만
//     부른다 — Authorization JWT 대신 고정 공유 비밀값 헤더로 막는다. 비밀값이 없거나 안 맞으면 401.
//   - CORS 헤더를 두지 않았다 — 브라우저가 직접 부를 일이 없는 함수라서.
// 응답: { results: [{ source, ok, count, error? }, ...] } — 소스 하나가 실패해도 나머지는 계속 처리하고
//   (요청 6번), 이 배열에 소스별 성공/실패와 건수가 전부 담긴다. 로그에도 소스·건수·성공 여부만 남기고
//   인증키·요청 URL(쿼리에 서비스키가 들어있다)은 절대 안 남긴다 — fetchJsonWithRetry가 실패해도 URL은
//   던지는 에러 메시지에 넣지 않는다.
//
// 모든 결과는 항상 status='draft', origin='auto'로만 저장한다(요청 5번) — 이 함수는 published로 바꾸는
// 코드 경로 자체가 없다. 관리자가 /admin에서 검수 후 직접 게시해야 노출된다.
// created_by/updated_by/published_by/updated_at은 022_travel_feed_admin_audit.sql의 트리거가 채운다 —
// service_role로 호출하면 auth.uid()가 없어서 created_by 등은 자동으로 null로 남는다(의도한 동작).
//
// 같은 원본을 매일 또 집어넣지 않도록 (origin, external_id)로 먼저 존재를 확인하고, 있으면 아예 건드리지
// 않는다(요청 2번 "중복 방지") — 이미 있는 행은 관리자가 이미 검토·수정했을 수 있어서, 값을 덮어쓰지 않고
// 완전히 건너뛴다. 그래서 last_checked_at은 "처음 수집된 시각"에서 멈춰 있다(계속 갱신하려면 기존 행도
// 매번 다시 확인해야 하는데, 이번 범위에서는 안 한다 - 관리자가 필요하면 직접 /admin에서 보관 처리한다).
//
// 필요한 비밀값(secrets):
//   DATA_GO_KR_KEY     공공데이터포털 마이페이지의 "일반 인증키(Decoding)" — 이 코드가 매번 encodeURIComponent로
//                      인코딩해서 쓰므로 Encoding 키를 넣으면 이중 인코딩되어 전부 실패한다. 외교부
//                      여행경보·안전공지·한국관광공사 TourAPI 모두 같은 data.go.kr 계정의 키를 그대로 쓴다
//                      (데이터포털은 승인받은 API마다 키가 따로 있지 않고 계정 하나에 키 하나다).
//   CRON_SECRET        pg_cron이 보내는 x-cron-secret 헤더와 비교할 값 — 아무 긴 임의 문자열이나 정해서
//                      supabase secrets set으로 넣고, 025_collect_travel_feed_cron.sql의 cron.schedule에도
//                      "똑같은 값"을 넣는다(두 군데에 같은 값을 손으로 맞춰야 한다 - 자동으로 공유되지 않는다).
//   MOFA_SAFETY_NOTICE_API_URL (선택) 아래 "⚠️ 안전공지 엔드포인트 미확인" 참고. 안 넣으면 추정 URL로 시도한다.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로 넣어준다.
//
// ⚠️ 검증 상태 (airport-congestion과 같은 이유로 정직하게 남겨둔다 - supabase/CLAUDE.md 참고):
//   - 여행경보(TravelAlarmService2/getTravelAlarmList2): 엔드포인트 URL과 country_nm/country_iso_alp2/
//     alarm_lvl/written_dt 필드명은 공식 문서 요약을 두 번 교차 확인해서 비교적 확실하다.
//   - 안전공지: 정확한 오퍼레이션 이름·엔드포인트를 공개 검색으로 찾지 못했다 — 여행경보와 같은 제공기관
//     (1262000)·같은 "2" 버전 네이밍 관례를 따라 CountrySafetyNoticeService2/getCountrySafetyNoticeList2로
//     추정했을 뿐이다. 틀렸으면 이 소스만 매번 실패로 기록되고(다른 소스는 계속 동작) 조용히 건너뛴다 -
//     MOFA_SAFETY_NOTICE_API_URL 비밀값으로 실제 엔드포인트를 확인해서 넣으면 바로 고쳐진다.
//   - TourAPI(searchFestival2): 엔드포인트·title/contentid/eventstartdate/eventenddate/addr1/areacode
//     필드명은 TourAPI 전반에서 수년간 안 바뀐 표준 관례라 신뢰도가 높지만, 실제 키로 호출해 본 적은 없다.
//   - 세 소스 모두 실제 응답을 받아보기 전까지는 pickText()의 후보 필드 이름 목록만 맞으면 그대로 동작한다.

const CRON_SECRET_HEADER = "x-cron-secret";

// 상수 시간 비교(2026-10-19 보안 점검 EDGE-05) - 일반 `!==` 문자열 비교는 첫 번째로 다른 글자에서 바로
// false가 되므로, 이론상 응답 시간차로 비밀값을 한 글자씩 추정하는 타이밍 공격의 여지가 있다. 길이가
// 다르면 그 즉시 false이되(더 비교할 이유가 없다), 길이가 같으면 끝까지 모든 바이트를 다 비교해서
// "몇 번째 글자에서 달랐는지"가 시간차로 드러나지 않게 한다.
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
const MAX_RETRIES = 2; // 요청 6번: 실패한 호출은 재시도 횟수를 제한한다
const RETRY_DELAY_MS = 600;
const FETCH_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 2; // 소스당 하루 최대 PAGE_SIZE*MAX_PAGES(=200)건 조회 - MOFA(1만/일)·TourAPI(1천/일) 한도에 비해 충분히 여유 있다(요청: 호출 한도를 넘지 않도록 제한)

// 외교부 여행경보 단계 -> 중요도 매핑표 (요청 2번: 코드 상수로 분리) - 남색(유의)은 참고, 황색(자제)은
// 보통, 적색(철수권고)·흑색(여행금지)은 높음으로 본다.
const ALARM_LEVEL_TO_IMPORTANCE: Record<string, "high" | "medium" | "low"> = {
  "1": "low",
  "2": "medium",
  "3": "high",
  "4": "high",
};
const ALARM_LEVEL_LABEL: Record<string, string> = {
  "1": "1단계(남색경보)",
  "2": "2단계(황색경보)",
  "3": "3단계(적색경보)",
  "4": "4단계(흑색경보)",
};

// TourAPI areacode 표준 코드표 (수년간 안 바뀐 값) - addr1(주소)이 없을 때만 이걸로 지역 표기를 대신한다
const TOURAPI_AREA_LABEL: Record<string, string> = {
  "1": "서울", "2": "인천", "3": "대전", "4": "대구", "5": "광주", "6": "부산", "7": "울산", "8": "세종",
  "31": "경기", "32": "강원", "33": "충북", "34": "충남", "35": "경북", "36": "경남", "37": "전북", "38": "전남", "39": "제주",
};

const MOFA_ALARM_URL = "https://apis.data.go.kr/1262000/TravelAlarmService2/getTravelAlarmList2";
// 추정값 - 파일 위 설명 참고. 실제 엔드포인트를 확인하면 MOFA_SAFETY_NOTICE_API_URL 비밀값으로 덮어쓴다.
const MOFA_SAFETY_NOTICE_DEFAULT_URL = "https://apis.data.go.kr/1262000/CountrySafetyNoticeService2/getCountrySafetyNoticeList2";
const TOURAPI_FESTIVAL_URL = "https://apis.data.go.kr/B551011/KorService2/searchFestival2";

const SOURCE_NAME_MOFA = "외교부 해외안전여행(0404)"; // 공공저작물 출처표시 의무를 대비해 기관명을 항상 넣는다
const SOURCE_NAME_TOURAPI = "한국관광공사";
// 둘 다 국가/도시별 세부 글 주소를 이 API 응답만으로는 만들 수 없어서(아래 각 수집 함수 주석 참고),
// 공식 목록 페이지로 연결한다 - "원문 링크"는 있어야 하지만 더 깊은 주소는 검증되지 않았다.
const MOFA_ALARM_SOURCE_URL = "https://0404.go.kr/ntnSafetyInfo/list";
const MOFA_NOTICE_SOURCE_URL = "https://0404.go.kr/bbs/safetyNtc/list";

type Db = { supabaseUrl: string; serviceRoleKey: string };
type SourceResult = { source: string; ok: boolean; count: number; error?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- data.go.kr 공통: 표준 응답 envelope(response.body.items.item) 파싱, 후보 필드 이름으로 읽기 ----
// (airport-congestion#parseIncheonResponse/pickNumber와 같은 방식 - 정확한 필드 이름이 불확실한 소스를 위해)

function extractItems(raw: unknown): Record<string, unknown>[] {
  const body = (raw as { response?: { body?: unknown } })?.response?.body as { items?: unknown } | undefined;
  const itemsField = body?.items as { item?: unknown } | unknown[] | undefined;
  if (Array.isArray(itemsField)) return itemsField as Record<string, unknown>[];
  const item = (itemsField as { item?: unknown })?.item;
  if (Array.isArray(item)) return item as Record<string, unknown>[];
  if (item && typeof item === "object") return [item as Record<string, unknown>];
  return [];
}

function pickText(item: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

// "20261101" / "2026-11-01" / "2026-11-01 10:00:00" -> "2026-11-01" (date 컬럼용). 못 읽으면 null.
function toDateOnly(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

// 위와 같은 입력을 timestamptz 문자열로. 못 읽으면 "지금"(수집 시각)을 대신 쓴다 - 날짜를 아예 못 채우는
// 것보다는, 적어도 "오늘 수집했다"는 사실이라도 담아 두는 편이 관리자가 검수할 때 더 쓸모 있다.
function toTimestamp(value: string | null): string {
  const dateOnly = toDateOnly(value);
  return dateOnly ? `${dateOnly}T00:00:00Z` : new Date().toISOString();
}

async function fetchJsonWithRetry(url: string, label: string): Promise<unknown> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}`); // 주소(쿼리의 서비스키 포함)는 절대 메시지에 안 넣는다
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---- travel_feed_items 저장: (origin='auto', external_id)로 먼저 있는지 확인하고, 없을 때만 넣는다 ----

type DraftRow = {
  kind: "safety" | "benefit";
  scope: "domestic" | "overseas";
  country_code?: string | null;
  region_label: string;
  title: string;
  summary: string;
  importance: "high" | "medium" | "low";
  published_at: string;
  valid_from?: string | null;
  valid_to?: string | null;
  source_name: string;
  source_url: string;
  last_checked_at: string;
};

function restHeaders(serviceRoleKey: string, extra?: Record<string, string>) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...extra };
}

async function insertIfNew(db: Db, externalId: string, row: DraftRow): Promise<boolean> {
  const headers = restHeaders(db.serviceRoleKey);
  const checkUrl =
    `${db.supabaseUrl}/rest/v1/travel_feed_items` +
    `?origin=eq.auto&external_id=eq.${encodeURIComponent(externalId)}&select=id&limit=1`;
  const checkRes = await fetch(checkUrl, { headers });
  if (!checkRes.ok) throw new Error(`존재 확인 실패 HTTP ${checkRes.status}`);
  const existing = (await checkRes.json().catch(() => [])) as unknown[];
  if (Array.isArray(existing) && existing.length > 0) return false; // 이미 수집된 적 있음 - 관리자가 손댔을 수 있어 건드리지 않는다

  const insertUrl = `${db.supabaseUrl}/rest/v1/travel_feed_items`;
  const payload = { ...row, origin: "auto", status: "draft", external_id: externalId };
  const insertRes = await fetch(insertUrl, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify([payload]) });
  if (insertRes.ok) return true;

  const errText = await insertRes.text().catch(() => "");
  // country_code가 country_currency(021/014) 밖의 코드면 FK 위반(23503) - country_code만 비우고 한 번 더 시도한다
  if (errText.includes("23503") && row.country_code) {
    const retryRes = await fetch(insertUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify([{ ...payload, country_code: null }]),
    });
    if (retryRes.ok) return true;
    throw new Error(`insert 실패(국가코드 제거 재시도 후) HTTP ${retryRes.status}`);
  }
  throw new Error(`insert 실패 HTTP ${insertRes.status}`);
}

// ---- 소스 1: 외교부 여행경보 (safety, overseas) ----

function alarmLevelKey(raw: string): string | null {
  const digit = raw.match(/[1-4]/);
  if (digit) return digit[0];
  if (raw.includes("남색")) return "1";
  if (raw.includes("황색")) return "2";
  if (raw.includes("적색")) return "3";
  if (raw.includes("흑색")) return "4";
  return null;
}

async function collectMofaAlarms(apiKey: string, db: Db): Promise<number> {
  let inserted = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${MOFA_ALARM_URL}?serviceKey=${encodeURIComponent(apiKey)}&numOfRows=${PAGE_SIZE}&pageNo=${page}&returnType=json`;
    const items = extractItems(await fetchJsonWithRetry(url, "외교부 여행경보"));
    if (items.length === 0) break;

    for (const item of items) {
      const alarmLvlRaw = pickText(item, ["alarm_lvl"]);
      if (!alarmLvlRaw) continue; // 경보 단계가 없는 행(해제됨 등)은 안전 소식감이 아니다
      const levelKey = alarmLevelKey(alarmLvlRaw);
      const countryCode = pickText(item, ["country_iso_alp2"]);
      const countryName = pickText(item, ["country_nm"]) ?? countryCode ?? "국가 미상";
      const writtenDt = pickText(item, ["written_dt"]);
      const levelLabel = levelKey ? ALARM_LEVEL_LABEL[levelKey] : `단계 ${alarmLvlRaw}`;

      const externalId = `mofa-alarm-${countryCode ?? countryName}-${writtenDt ?? "unknown"}`;
      const row: DraftRow = {
        kind: "safety",
        scope: "overseas",
        country_code: countryCode,
        region_label: countryName,
        title: `${countryName} 여행경보 ${levelLabel}`,
        // 요청 2번: 원문 문장을 복사하지 않고 제목 기반 한 줄만 - 관리자가 직접 다듬는다
        summary: `${countryName}의 여행경보가 ${levelLabel}(으)로 확인됐습니다. 자세한 내용은 출처에서 확인해주세요.`,
        importance: levelKey ? ALARM_LEVEL_TO_IMPORTANCE[levelKey] : "medium",
        published_at: toTimestamp(writtenDt),
        source_name: SOURCE_NAME_MOFA,
        source_url: MOFA_ALARM_SOURCE_URL,
        last_checked_at: new Date().toISOString(),
      };
      if (await insertIfNew(db, externalId, row)) inserted++;
    }
    if (items.length < PAGE_SIZE) break;
  }
  return inserted;
}

// ---- 소스 2: 외교부 안전공지 (safety, overseas) ----

async function collectMofaSafetyNotices(apiKey: string, db: Db): Promise<number> {
  const apiUrl = Deno.env.get("MOFA_SAFETY_NOTICE_API_URL") || MOFA_SAFETY_NOTICE_DEFAULT_URL;
  let inserted = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${apiUrl}?serviceKey=${encodeURIComponent(apiKey)}&numOfRows=${PAGE_SIZE}&pageNo=${page}&returnType=json&country_nm=ALL`;
    const items = extractItems(await fetchJsonWithRetry(url, "외교부 안전공지"));
    if (items.length === 0) break;

    for (const item of items) {
      const title = pickText(item, ["title", "sj", "subject", "ntcTitle"]);
      if (!title) continue;
      const countryName = pickText(item, ["country_nm", "ctznNm"]) ?? "국가 미상";
      const countryCode = pickText(item, ["country_iso_alp2"]);
      const noticeDate = pickText(item, ["written_dt", "regDt", "wrtDt", "ntcDt"]);
      const noticeId = pickText(item, ["seq", "bbsSeq", "ntcSeq", "idx"]) ?? `${countryName}|${title}|${noticeDate ?? ""}`;

      const externalId = `mofa-notice-${noticeId}`;
      const row: DraftRow = {
        kind: "safety",
        scope: "overseas",
        country_code: countryCode,
        region_label: countryName,
        title, // 공관이 올린 공지 제목 그대로 - 뉴스 헤드라인처럼 제목 자체는 원문 그대로 써도 된다(요약만 직접 쓴다)
        summary: `${countryName} 공관이 올린 안전공지입니다. 자세한 내용은 출처에서 확인해주세요.`,
        importance: "medium", // 이 API는 경보단계를 안 주므로 균일하게 '보통'으로 시작, 관리자가 조정한다
        published_at: toTimestamp(noticeDate),
        source_name: SOURCE_NAME_MOFA,
        source_url: MOFA_NOTICE_SOURCE_URL,
        last_checked_at: new Date().toISOString(),
      };
      if (await insertIfNew(db, externalId, row)) inserted++;
    }
    if (items.length < PAGE_SIZE) break;
  }
  return inserted;
}

// ---- 소스 3: 한국관광공사 TourAPI 축제·행사 (benefit, domestic) ----

function todayYyyymmdd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function collectFestivals(apiKey: string, db: Db): Promise<number> {
  let inserted = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    // eventStartDate=오늘: 오늘 이후 끝나는(진행 중+예정) 행사 - TourAPI 관례상 "이 날짜 이후 끝나는 행사"를 돌려준다
    const url =
      `${TOURAPI_FESTIVAL_URL}?serviceKey=${encodeURIComponent(apiKey)}&numOfRows=${PAGE_SIZE}&pageNo=${page}` +
      `&MobileOS=ETC&MobileApp=Routory&_type=json&eventStartDate=${todayYyyymmdd()}&arrange=O`;
    const items = extractItems(await fetchJsonWithRetry(url, "한국관광공사 TourAPI"));
    if (items.length === 0) break;

    for (const item of items) {
      const contentId = pickText(item, ["contentid"]);
      const title = pickText(item, ["title"]);
      if (!contentId || !title) continue;
      const startDate = toDateOnly(pickText(item, ["eventstartdate"]));
      const endDate = toDateOnly(pickText(item, ["eventenddate"]));
      const addr = pickText(item, ["addr1"]);
      const areaCode = pickText(item, ["areacode"]);
      const regionLabel = addr ?? (areaCode ? TOURAPI_AREA_LABEL[areaCode] : null) ?? "국내";

      const externalId = `tourapi-festival-${contentId}`;
      const row: DraftRow = {
        kind: "benefit",
        scope: "domestic",
        region_label: regionLabel,
        title,
        // 요청 3번 "같은 방식으로" - overview(행사 소개) 같은 원문 설명 필드는 일부러 안 쓴다
        summary: `${title} 행사 정보입니다. 정확한 일정·장소는 출처에서 확인해주세요.`,
        importance: "medium",
        published_at: new Date().toISOString(),
        valid_from: startDate,
        valid_to: endDate,
        source_name: SOURCE_NAME_TOURAPI,
        // 대한민국 구석구석(한국관광공사 공식 포털)의 contentid 상세 페이지 - TourAPI 응답 자체엔 공개 웹페이지
        // 주소가 안 들어있어서, 콘텐츠 ID로 구성하는 이 표준 패턴을 쓴다(검증된 실제 호출은 아직 안 해봤다)
        source_url: `https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=${encodeURIComponent(contentId)}`,
        last_checked_at: new Date().toISOString(),
      };
      if (await insertIfNew(db, externalId, row)) inserted++;
    }
    if (items.length < PAGE_SIZE) break;
  }
  return inserted;
}

// ---- 요청 처리 ----

async function runSource(source: string, fn: () => Promise<number>): Promise<SourceResult> {
  try {
    const count = await fn();
    return { source, ok: true, count };
  } catch (err) {
    // 요청 6번: 로그에 소스·건수·성공 여부만 남긴다 - err.message에 인증키가 들어갈 일이 없게(위 fetchJsonWithRetry 참고)
    // 만들어 뒀지만, 혹시 몰라 길이도 잘라서 남긴다.
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    return { source, ok: false, count: 0, error: message };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || !timingSafeEqual(req.headers.get(CRON_SECRET_HEADER) ?? "", cronSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dataGoKrKey = Deno.env.get("DATA_GO_KR_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[collect-travel-feed] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않아요");
    return json({ error: "server not configured" }, 500);
  }
  if (!dataGoKrKey) {
    console.error("[collect-travel-feed] DATA_GO_KR_KEY 비밀값이 설정되어 있지 않아요");
    return json({ error: "DATA_GO_KR_KEY가 설정되어 있지 않아요" }, 500);
  }

  const db: Db = { supabaseUrl, serviceRoleKey };

  // 요청 6번: 한 소스가 실패해도 다른 소스는 계속 처리한다 - runSource가 모든 에러를 삼키므로
  // Promise.all 중 하나가 reject되어 전체가 멈추는 일이 없다.
  const results = await Promise.all([
    runSource("mofa_alarm", () => collectMofaAlarms(dataGoKrKey, db)),
    runSource("mofa_safety_notice", () => collectMofaSafetyNotices(dataGoKrKey, db)),
    runSource("tourapi_festival", () => collectFestivals(dataGoKrKey, db)),
  ]);

  results.forEach((r) => {
    console.log(`[collect-travel-feed] source=${r.source} ok=${r.ok} count=${r.count}${r.error ? " error=" + r.error : ""}`);
  });

  return json({ results });
});
