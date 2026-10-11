// @별칭 FLIGHT-DATA · 항공사·공항 데이터와 항공편 조회
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 항공편 입력에 쓰는 항공사/공항 데이터.
// 공항 tz는 UTC 기준 시차(시간 단위)이며, 출발·도착 현지 시각으로 소요시간을 계산할 때 쓴다.
// 여기 등록된 나라들은 모두 서머타임이 없어 고정값을 쓴다. 다른 나라를 추가할 때는 서머타임을 따로 고려해야 한다.

(function () {
  const AIRLINES = [
    { code: "KE", name: "대한항공", en: "Korean Air" },
    { code: "OZ", name: "아시아나항공", en: "Asiana Airlines" },
    { code: "7C", name: "제주항공", en: "Jeju Air" },
    { code: "TW", name: "티웨이항공", en: "T'way Air" },
    { code: "LJ", name: "진에어", en: "Jin Air" },
    { code: "BX", name: "에어부산", en: "Air Busan" },
    { code: "ZE", name: "이스타항공", en: "Eastar Jet" },
    { code: "RS", name: "에어서울", en: "Air Seoul" },
    { code: "YP", name: "에어프레미아", en: "Air Premia" },
    { code: "JL", name: "일본항공", en: "Japan Airlines" },
    { code: "NH", name: "전일본공수(ANA)", en: "All Nippon Airways" },
    { code: "MM", name: "피치항공", en: "Peach Aviation" },
    { code: "TG", name: "타이항공", en: "Thai Airways" },
    { code: "VN", name: "베트남항공", en: "Vietnam Airlines" },
    { code: "VJ", name: "비엣젯항공", en: "VietJet Air" },
    { code: "SQ", name: "싱가포르항공", en: "Singapore Airlines" },
    { code: "MH", name: "말레이시아항공", en: "Malaysia Airlines" },
    { code: "AK", name: "에어아시아", en: "AirAsia" },
    { code: "5J", name: "세부퍼시픽", en: "Cebu Pacific" },
    { code: "PR", name: "필리핀항공", en: "Philippine Airlines" },
    { code: "GA", name: "가루다인도네시아", en: "Garuda Indonesia" },
    { code: "CA", name: "중국국제항공", en: "Air China" },
    { code: "MU", name: "중국동방항공", en: "China Eastern" },
    { code: "CZ", name: "중국남방항공", en: "China Southern" },
    { code: "CX", name: "캐세이퍼시픽", en: "Cathay Pacific" },
  ];

  // 검색어가 없을 때 기본으로 나열할 대표 항공사
  const DEFAULT_AIRLINE_CODES = ["KE", "OZ", "7C", "TW", "LJ", "BX", "ZE", "RS"];

  const REGION_LABELS = {
    korea: "한국",
    japan: "일본",
    sea: "동남아시아",
    china: "중국·홍콩·마카오",
    taiwan: "대만",
  };

  const AIRPORTS = [
    { code: "ICN", city: "인천", name: "인천국제공항", region: "korea", tz: 9 },
    { code: "GMP", city: "서울", name: "김포국제공항", region: "korea", tz: 9 },
    { code: "PUS", city: "부산", name: "김해국제공항", region: "korea", tz: 9 },
    { code: "CJU", city: "제주", name: "제주국제공항", region: "korea", tz: 9 },
    { code: "TAE", city: "대구", name: "대구국제공항", region: "korea", tz: 9 },
    { code: "CJJ", city: "청주", name: "청주국제공항", region: "korea", tz: 9 },
    { code: "RSU", city: "여수", name: "여수공항", region: "korea", tz: 9 },
    { code: "YNY", city: "속초·양양", name: "양양국제공항", region: "korea", tz: 9 },

    { code: "NRT", city: "도쿄", name: "나리타국제공항", region: "japan", tz: 9 },
    { code: "HND", city: "도쿄", name: "하네다공항", region: "japan", tz: 9 },
    { code: "KIX", city: "오사카", name: "간사이국제공항", region: "japan", tz: 9 },
    { code: "ITM", city: "오사카", name: "오사카국제공항(이타미)", region: "japan", tz: 9 },
    { code: "FUK", city: "후쿠오카", name: "후쿠오카공항", region: "japan", tz: 9 },
    { code: "CTS", city: "삿포로", name: "신치토세공항", region: "japan", tz: 9 },
    { code: "OKA", city: "오키나와", name: "나하공항", region: "japan", tz: 9 },
    { code: "NGO", city: "나고야", name: "주부국제공항", region: "japan", tz: 9 },
    { code: "HIJ", city: "히로시마", name: "히로시마공항", region: "japan", tz: 9 },
    { code: "KMJ", city: "구마모토", name: "구마모토공항", region: "japan", tz: 9 },
    { code: "KOJ", city: "가고시마", name: "가고시마공항", region: "japan", tz: 9 },
    { code: "NGS", city: "나가사키", name: "나가사키공항", region: "japan", tz: 9 },
    { code: "SDJ", city: "센다이", name: "센다이공항", region: "japan", tz: 9 },

    { code: "BKK", city: "방콕", name: "수완나품국제공항", region: "sea", tz: 7 },
    { code: "DMK", city: "방콕", name: "돈므앙국제공항", region: "sea", tz: 7 },
    { code: "CNX", city: "치앙마이", name: "치앙마이국제공항", region: "sea", tz: 7 },
    { code: "DAD", city: "다낭", name: "다낭국제공항", region: "sea", tz: 7 },
    { code: "HAN", city: "하노이", name: "노이바이국제공항", region: "sea", tz: 7 },
    { code: "SGN", city: "호치민", name: "탄손녓국제공항", region: "sea", tz: 7 },
    { code: "PQC", city: "푸꾸옥", name: "푸꾸옥국제공항", region: "sea", tz: 7 },
    { code: "CEB", city: "세부", name: "막탄세부국제공항", region: "sea", tz: 8 },
    { code: "MPH", city: "보라카이", name: "카티클란공항", region: "sea", tz: 8 },
    { code: "KLO", city: "보라카이", name: "칼리보국제공항", region: "sea", tz: 8 },
    { code: "SIN", city: "싱가포르", name: "창이국제공항", region: "sea", tz: 8 },
    { code: "KUL", city: "쿠알라룸푸르", name: "쿠알라룸푸르국제공항", region: "sea", tz: 8 },
    { code: "BKI", city: "코타키나발루", name: "코타키나발루국제공항", region: "sea", tz: 8 },
    { code: "DPS", city: "발리", name: "응우라라이국제공항", region: "sea", tz: 8 },
    { code: "REP", city: "씨엠립", name: "씨엠립앙코르국제공항", region: "sea", tz: 7 },
    { code: "PNH", city: "프놈펜", name: "프놈펜국제공항", region: "sea", tz: 7 },
    { code: "VTE", city: "비엔티안", name: "왓따이국제공항", region: "sea", tz: 7 },

    { code: "PEK", city: "베이징", name: "베이징수도국제공항", region: "china", tz: 8 },
    { code: "PKX", city: "베이징", name: "베이징다싱국제공항", region: "china", tz: 8 },
    { code: "PVG", city: "상하이", name: "푸둥국제공항", region: "china", tz: 8 },
    { code: "SHA", city: "상하이", name: "훙차오국제공항", region: "china", tz: 8 },
    { code: "TFU", city: "청두", name: "청두톈푸국제공항", region: "china", tz: 8 },
    { code: "CTU", city: "청두", name: "청두솽류국제공항", region: "china", tz: 8 },
    { code: "XIY", city: "시안", name: "시안셴양국제공항", region: "china", tz: 8 },
    { code: "TAO", city: "칭다오", name: "칭다오자오둥국제공항", region: "china", tz: 8 },
    { code: "DYG", city: "장가계", name: "장가계허화국제공항", region: "china", tz: 8 },
    { code: "HKG", city: "홍콩", name: "홍콩국제공항", region: "china", tz: 8 },
    { code: "MFM", city: "마카오", name: "마카오국제공항", region: "china", tz: 8 },

    { code: "TPE", city: "타이베이", name: "타오위안국제공항", region: "taiwan", tz: 8 },
    { code: "TSA", city: "타이베이", name: "쑹산공항", region: "taiwan", tz: 8 },
    { code: "KHH", city: "가오슝", name: "가오슝국제공항", region: "taiwan", tz: 8 },
  ];

  // destinations.js의 도시 id → 그 도시에서 주로 쓰는 공항 (첫 번째가 기본값)
  const CITY_AIRPORTS = {
    tokyo: ["NRT", "HND"],
    osaka: ["KIX", "ITM"],
    kyoto: ["KIX", "ITM"],
    fukuoka: ["FUK"],
    sapporo: ["CTS"],
    naha: ["OKA"],
    bangkok: ["BKK", "DMK"],
    chiangmai: ["CNX"],
    danang: ["DAD"],
    hanoi: ["HAN"],
    hochiminh: ["SGN"],
    phuquoc: ["PQC"],
    cebu: ["CEB"],
    boracay: ["MPH", "KLO"],
    singapore: ["SIN"],
    kualalumpur: ["KUL"],
    kotakinabalu: ["BKI"],
    bali: ["DPS"],
    beijing: ["PEK", "PKX"],
    shanghai: ["PVG", "SHA"],
    chengdu: ["TFU", "CTU"],
    xian: ["XIY"],
    qingdao: ["TAO"],
    zhangjiajie: ["DYG"],
    seoul: ["GMP", "ICN"],
    busan: ["PUS"],
    jeju: ["CJU"],
    sokcho: ["YNY"],
    yeosu: ["RSU"],
  };

  // 편명 조회(adsbdb)는 IATA 항공사 코드 대신 ICAO 콜사인 접두어(KAL723 등)로 찾는다
  const ICAO_CODES = {
    KE: "KAL", OZ: "AAR", "7C": "JJA", TW: "TWB", LJ: "JNA", BX: "ABL", ZE: "ESR", RS: "ASV", YP: "APZ",
    JL: "JAL", NH: "ANA", MM: "APJ", TG: "THA", VN: "HVN", VJ: "VJC", SQ: "SIA", MH: "MAS", AK: "AXM",
    "5J": "CEB", PR: "PAL", GA: "GIA", CA: "CCA", MU: "CES", CZ: "CSN", CX: "CPA",
  };

  // 편명으로 노선(출발·도착 공항)을 조회한다. 무료 공개 API라 운항 시간표는 제공하지 않는다.
  // 결과 status: found(dep/arr 포함) | notfound | error(네트워크 실패·시간 초과)
  const routeCache = new Map();

  async function fetchRoute(airlineCode, number) {
    const icao = ICAO_CODES[airlineCode];
    if (!icao) return { status: "notfound" };

    const key = `${icao}${number}`;
    if (routeCache.has(key)) return routeCache.get(key);

    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), 8000);
    try {
      const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`, {
        signal: abort.signal,
      });
      if (res.status === 404) return cacheRoute(key, { status: "notfound" });
      if (!res.ok) throw new Error(`adsbdb status ${res.status}`);

      const route = (await res.json())?.response?.flightroute;
      if (!route?.origin?.iata_code || !route?.destination?.iata_code) {
        return cacheRoute(key, { status: "notfound" });
      }
      return cacheRoute(key, { status: "found", dep: route.origin.iata_code, arr: route.destination.iata_code });
    } catch (err) {
      console.warn("[flight] 편명 조회 실패 (오프라인이거나 시간 초과일 수 있음)", err);
      return { status: "error" };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function cacheRoute(key, result) {
    routeCache.set(key, result);
    return result;
  }

  // ---- AviationStack 조회: 출발·도착 시간까지 가져온다 ----
  // 무료 요금제에서는 편명 필터가 되는 실시간 조회(/flights)만 쓸 수 있어, 그 편명의 "최근 운항 기록"에 있는
  // 예정 시각(scheduled)을 가져온다. 시간표는 보통 매일 같지만 시즌 변경 등으로 여행 날짜와 다를 수 있다.
  // 키는 이 브라우저의 localStorage에만 저장한다(소스코드에 넣지 않는다).

  const API_KEY_STORAGE = "triplog.aviationstack.key";
  const scheduleCache = new Map();

  function getApiKey() {
    try {
      return localStorage.getItem(API_KEY_STORAGE) || "";
    } catch (err) {
      return "";
    }
  }

  function setApiKey(key) {
    try {
      if (key) localStorage.setItem(API_KEY_STORAGE, key);
      else localStorage.removeItem(API_KEY_STORAGE);
    } catch (err) {
      console.warn("[flight] API 키 저장 실패", err);
    }
  }

  // 응답의 예정 시각은 "2026-09-19T09:35:00+00:00"처럼 +00:00이 붙어 있지만 실제로는 각 공항의 현지 시각이다
  function localHHMM(value) {
    return /T(\d{2}:\d{2})/.exec(value ?? "")?.[1] ?? null;
  }

  function dayDiff(a, b) {
    return Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`));
  }

  // 여행 날짜에 가장 가까운 운항일의 기록을 고른다 (코드셰어가 아닌 운항편을 우선)
  function pickRecord(records, date) {
    if (records.length === 0) return { status: "notfound" };
    const f = [...records].sort(
      (x, y) =>
        dayDiff(x.flight_date, date) - dayDiff(y.flight_date, date) ||
        Number(Boolean(x.flight.codeshared)) - Number(Boolean(y.flight.codeshared))
    )[0];
    return {
      status: "found",
      dep: f.departure.iata,
      arr: f.arrival.iata,
      depTime: localHHMM(f.departure.scheduled),
      arrTime: localHHMM(f.arrival.scheduled),
      approx: f.flight_date !== date,
    };
  }

  // status: found(dep/arr/depTime/arrTime/approx) | notfound | auth | quota | error
  // approx: 조회된 운항일이 여행 날짜와 다른 경우(최근 운항 기준 시간)
  // 무료 요금제 호출 한도가 작아서, 같은 편명은 날짜가 달라도 한 번만 요청하고 결과 기록을 재사용한다.
  async function fetchSchedule(airlineCode, number, date, apiKey) {
    const flightIata = `${airlineCode}${number}`;
    if (scheduleCache.has(flightIata)) return pickRecord(scheduleCache.get(flightIata), date);

    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), 10000);
    try {
      const url =
        `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(apiKey)}` +
        `&flight_iata=${encodeURIComponent(flightIata)}&limit=20`;
      const res = await fetch(url, { signal: abort.signal });
      const body = await res.json().catch(() => null);

      const errorCode = body?.error?.code ?? (typeof body?.error === "string" ? body.error : "");
      if (errorCode) {
        if (/invalid_access_key|missing_access_key|inactive_user/.test(errorCode)) return { status: "auth" };
        if (/usage_limit_reached|rate_limit_reached/.test(errorCode)) return { status: "quota" };
        return { status: "error" };
      }
      if (res.status === 401 || res.status === 403) return { status: "auth" };
      if (res.status === 429) return { status: "quota" };
      if (!res.ok || !Array.isArray(body?.data)) throw new Error(`aviationstack status ${res.status}`);

      // 공동운항(codeshare)으로 다른 항공사 편명이 섞여 나오므로 요청한 편명 자체의 운항 기록만 쓴다
      const target = flightIata.toUpperCase();
      const records = body.data.filter(
        (f) =>
          f.flight?.iata?.toUpperCase() === target &&
          f.flight_status !== "cancelled" &&
          f.departure?.iata &&
          f.arrival?.iata &&
          localHHMM(f.departure.scheduled) &&
          localHHMM(f.arrival.scheduled)
      );
      scheduleCache.set(flightIata, records);
      return pickRecord(records, date);
    } catch (err) {
      console.warn("[flight] 스케줄 조회 실패 (오프라인이거나 시간 초과일 수 있음)", err);
      return { status: "error" };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 편명 조회의 진입점. 키가 있으면 스케줄(시간 포함)을 먼저 시도하고, 안 되면 무료 노선 조회로 대체한다.
  // 반환: { status: found|notfound|error, dep, arr, depTime?, arrTime?, approx?, note? }
  // note: nokey(키 없음) | auth | quota | nodate(조회된 운항 기록 없음) | neterr
  async function fetchFlightInfo(airlineCode, number, date) {
    const apiKey = getApiKey();
    let note = "nokey";

    if (apiKey) {
      const schedule = await fetchSchedule(airlineCode, number, date, apiKey);
      if (schedule.status === "found") return schedule;
      note = { auth: "auth", quota: "quota", notfound: "nodate", error: "neterr" }[schedule.status];
    }

    const route = await fetchRoute(airlineCode, number);
    return { ...route, note };
  }

  function getAirline(code) {
    return AIRLINES.find((a) => a.code === code) ?? null;
  }

  function getAirport(code) {
    return AIRPORTS.find((a) => a.code === code) ?? null;
  }

  function airportsForCity(cityId) {
    return CITY_AIRPORTS[cityId] ?? [];
  }

  const normalize = (v) => String(v).toLowerCase().replace(/[\s'’().\-]/g, "");

  // 항공사 이름(한글/영문)이나 코드에 검색어가 포함된 항공사. 검색어가 없으면 대표 항공사를 돌려준다.
  function searchAirlines(query) {
    const q = normalize(query);
    if (!q) return DEFAULT_AIRLINE_CODES.map(getAirline);
    return AIRLINES.filter((a) => [a.name, a.en, a.code].some((v) => normalize(v).includes(q)));
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.flightData = {
    REGION_LABELS,
    AIRPORTS,
    getAirline,
    getAirport,
    airportsForCity,
    searchAirlines,
    fetchFlightInfo,
    getApiKey,
    setApiKey,
  };
})();
