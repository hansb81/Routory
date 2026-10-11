// @별칭 MYTRIP · 나의 여행 화면 (#/my-trip/:id)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 나의 여행 화면(#/my-trip/:id). 상단 아이콘 바·하단 탭바·우측 메뉴는 이 화면만의 것이 아니라
// 일정·가계부·여행지갑 화면까지 함께 쓰는 공통 셸이라 tripShell.js가 따로 그린다(화면을 옮겨도 계속 떠 있다).
// 이 화면 자체는 그 셸 사이에 낀 화면으로, computeTripPhase가 가른 3가지 상태(여행 전/출발 전/여행중)에 따라
// 다른 카드 묶음을 세로로 쌓아 보여준다. 일곱 카드 전부 실제 데이터로 연동돼 있다(아래 "실시간 연동" 절
// 참고) — "여행 전": 환율(open.er-api.com)·날씨(open-meteo.com, 둘 다 키 없는 무료 API)·현지 뉴스·할인
// 정보(Supabase Edge Function `travel-briefing`, Gemini의 구글 검색 도구). "출발 전": 공항 이동 교통상황
// (사용자 위치 + Google Distance Matrix)·공항 혼잡도(Edge Function `airport-congestion`, 공식 공개데이터가
// 있는 공항만). "여행중": 주변 맛집/볼거리(Google Places Nearby Search, googleMaps.js#searchNearby 재사용).
// 위치 권한이 없거나 공식 데이터가 없는 공항이면 그 카드는 자리 자체를 지운다(hydrate*Card가 카드
// article을 `.remove()`) — 다른 카드들처럼 실패 문구를 보여주는 대신 숨기는 이 두 카드만의 규칙이다.
// 공항 이동 교통상황 카드는 실제 위치 권한 팝업을 띄우기 전에 먼저 안내(허용/나중에)를 보여준다 - 이미
// 거부한 적이 있으면(브라우저가 알려줄 수 있을 때만 확인 가능) 안내 대신 "설정에서 권한을 허용해주세요"로
// 바뀐다(permissionBodyHtml/checkGeoPermission, 아래 "실시간 연동" 절 참고).

(function () {
  const router = window.TripLog.router;
  const ui = window.TripLog.ui;
  const storage = window.TripLog.storage;
  const supabase = window.TripLog.supabase;
  const { getTripById, loadItems, isItemsLoaded, getItems } = storage;
  const { toDateKey, escapeHtml, ddayLabel, addDays, shortDate, daysUntil, haversineKm } = window.TripLog.util;
  const flightData = window.TripLog.flightData;
  const destinations = window.TripLog.destinations;
  const googleMaps = window.TripLog.googleMaps;
  // currencyData.js는 이 파일보다 늦게 로드되므로(index.html 순서) 최상위에서 구조분해하지 않고,
  // 실제로 쓰는 시점(buildExchangeCard, render 이후)에 window.TripLog.currencyData로 그때 읽는다.

  let loadRunId = 0;

  // 여행중 탭에서 쓸 3가지 상태
  const PHASE = {
    BEFORE_TRIP: "before-trip", // 여행 전
    BEFORE_DEPARTURE: "before-departure", // 출발 전
    IN_TRIP: "in-trip", // 여행중
  };

  const DEFAULT_ITEM_TIME = "09:00"; // 시간이 없는 일정(하루종일 성격)을 이 시각으로 취급
  const PRE_DEPARTURE_BUFFER_MIN = 3 * 60; // 첫 항공편 출발까지 이 시간(분) 이하로 남으면 이미 '여행중'으로 본다

  // "HH:MM" | "HH:MM:SS" → 자정 기준 분(minute). 형식이 아니면 null.
  function timeToMinutes(value) {
    const m = typeof value === "string" && value.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  // 일정 하나의 '시각'(분). 항공 일정은 출발 시각(item.flight.depTime), 그 외엔 등록된 item.time,
  // 둘 다 없으면(하루종일 성격) defaultTime.
  function itemMinutes(item, defaultTime) {
    const flightMinutes = item.flight ? timeToMinutes(item.flight.depTime) : null;
    if (flightMinutes != null) return flightMinutes;
    const ownMinutes = timeToMinutes(item.time);
    if (ownMinutes != null) return ownMinutes;
    return timeToMinutes(defaultTime) ?? 0;
  }

  // 오늘(todayKey) 일정 중 아직 지나지 않은(시각 >= 현재) 것 중 가장 이른 일정 하나. 없으면 null.
  function findNextItem(tripItems, todayKey, nowMinutes, defaultTime) {
    const upcoming = tripItems
      .filter((it) => it.date === todayKey)
      .map((it) => ({ item: it, minutes: itemMinutes(it, defaultTime) }))
      .filter((entry) => entry.minutes >= nowMinutes)
      .sort((a, b) => a.minutes - b.minutes || (a.item.sortOrder ?? 0) - (b.item.sortOrder ?? 0));
    return upcoming[0]?.item ?? null;
  }

  // 여행중 탭(SHELL · MYTRIP-BOTTOMTABS)의 상태 분류. trip은 storage의 Trip(startDate/endDate 필요),
  // items는 여러 여행이 섞인 배열이어도 된다(trip.id로 걸러낸다 — storage.getItems() 그대로 넘겨도 됨).
  // options.now: 테스트용 현재 시각(기본 new Date()), options.defaultTime: 시간 없는 일정의 기본 시각(기본 "09:00").
  //
  // 1) 여행 전: 오늘이 startDate 이전.
  // 2) 출발 전: 오늘이 startDate이고, category "flight"인 일정 중 가장 이른 출발 시각 기준으로
  //    아직 3시간 넘게 남은 경우. 항공 일정이 없으면 이 상태는 건너뛰고 바로 3)으로.
  // 3) 여행중: 그 외 전부(출발 3시간 전부터, 또는 이미 출발한 뒤, 또는 startDate~endDate의 다른 날).
  //    nextItem: 오늘 일정 중 아직 지나지 않은 다음 일정(없으면 null) — itemMinutes로 시각을 매긴다.
  function computeTripPhase(trip, items, options = {}) {
    if (!trip?.startDate) return { phase: null, nextItem: null };

    const now = options.now instanceof Date ? options.now : new Date();
    const defaultTime = options.defaultTime || DEFAULT_ITEM_TIME;
    const todayKey = toDateKey(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const tripItems = (items || []).filter((it) => it.tripId === trip.id);

    if (todayKey < trip.startDate) {
      return { phase: PHASE.BEFORE_TRIP, nextItem: null };
    }

    if (todayKey === trip.startDate) {
      const firstFlight = tripItems
        .filter((it) => timeToMinutes(it.flight?.depTime) != null)
        .sort((a, b) => timeToMinutes(a.flight.depTime) - timeToMinutes(b.flight.depTime))[0];

      if (firstFlight) {
        const minutesUntilDeparture = timeToMinutes(firstFlight.flight.depTime) - nowMinutes;
        if (minutesUntilDeparture > PRE_DEPARTURE_BUFFER_MIN) {
          return { phase: PHASE.BEFORE_DEPARTURE, flightItem: firstFlight, minutesUntilDeparture, nextItem: null };
        }
      }
    }

    return { phase: PHASE.IN_TRIP, nextItem: findNextItem(tripItems, todayKey, nowMinutes, defaultTime) };
  }

  // ---- 상태별 카드 (더미 데이터) ----
  // 아이콘은 SHELL(tripShell.js)과 달리 선 아이콘을 쓸 정도로 개수가 많지 않아 이모지를 그대로 쓴다
  // (walletCategoryData.js 등 다른 화면의 카테고리 아이콘과 같은 방식).

  // "오후 3시 기준" | "오후 3시 12분 기준"
  function formatTimeLabel(date) {
    const h24 = date.getHours();
    const period = h24 < 12 ? "오전" : "오후";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const min = date.getMinutes();
    return min === 0 ? `${period} ${h12}시 기준` : `${period} ${h12}시 ${min}분 기준`;
  }

  // 45 → "45분", 130 → "2시간 10분", 180 → "3시간"
  function formatDuration(totalMinutes) {
    const minutes = Math.max(0, Math.round(totalMinutes));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h <= 0) return `${m}분`;
    return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
  }

  // "도쿄, 일본" → { city: "도쿄", country: "일본" }
  function splitDestination(trip) {
    const parts = (trip.destination || "").split(",").map((s) => s.trim());
    return { city: parts[0] || "여행지", country: parts[parts.length - 1] || "" };
  }

  // key가 있으면 data-card로 남겨 hydrateExchangeCard/hydrateWeatherCard가 나중에 그 카드의 body만 찾아 바꾼다.
  function cardHtml({ key, icon, title, bodyHtml }, timeLabel) {
    return `
      <article class="mytrip-card"${key ? ` data-card="${key}"` : ""}>
        <header class="mytrip-card-head">
          <div class="mytrip-card-title-group">
            <span class="mytrip-card-icon" aria-hidden="true">${icon}</span>
            <h2 class="mytrip-card-title">${escapeHtml(title)}</h2>
          </div>
          <span class="mytrip-card-time">${escapeHtml(timeLabel)}</span>
        </header>
        <div class="mytrip-card-body">${bodyHtml}</div>
      </article>`;
  }

  function loadingBodyHtml(label) {
    return `<p class="mytrip-card-empty">${escapeHtml(label)}</p>`;
  }

  function listBodyHtml(lines) {
    return `<ul class="mytrip-card-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
  }

  function statBodyHtml(stat, sub) {
    return `<p class="mytrip-card-stat">${escapeHtml(stat)}</p><p class="mytrip-card-stat-sub">${escapeHtml(sub)}</p>`;
  }

  // 위치 권한처럼 실제 OS 권한 팝업을 띄우기 전에 보여주는 안내 - 메시지 + 버튼 1~2개. laterLabel을 생략하면
  // '허용' 버튼 하나만 그린다(권한이 이미 거부된 상태의 안내처럼 버튼 자체가 없는 경우는 actions를 아예
  // 생략한 채 이 함수를 쓰지 않고 loadingBodyHtml을 바로 쓴다).
  function permissionBodyHtml(message, { allowLabel, laterLabel } = {}) {
    return `
      <p class="mytrip-card-empty">${escapeHtml(message)}</p>
      <div class="mytrip-card-actions">
        ${laterLabel ? `<button type="button" class="btn btn-cancel" data-action="permission-later">${escapeHtml(laterLabel)}</button>` : ""}
        <button type="button" class="btn btn-save" data-action="permission-allow">${escapeHtml(allowLabel)}</button>
      </div>`;
  }

  // [여행 전 1/4] 환율 — 처음엔 로딩 문구만 그리고, hydrateExchangeCard가 실제 값을 채운다(아래 "실시간 연동" 절).
  function buildExchangeCard() {
    return { key: "exchange", icon: "💱", title: "환율", bodyHtml: loadingBodyHtml("환율을 불러오는 중이에요...") };
  }

  // [여행 전 2/4] 날씨 — 처음엔 로딩 문구만 그리고, hydrateWeatherCard가 실제 값을 채운다(아래 "실시간 연동" 절).
  function buildWeatherCard() {
    return { key: "weather", icon: "🌤️", title: "날씨", bodyHtml: loadingBodyHtml("날씨를 불러오는 중이에요...") };
  }

  // ---- 실시간 연동: 환율(open.er-api.com) · 날씨(open-meteo.com) ----
  // 둘 다 키 없이 바로 쓸 수 있는 무료 API라서 config.js에 새 키를 추가하지 않아도 된다.
  // 카드가 이미 위 build*Card로 로딩 문구와 함께 그려진 뒤, 아래 hydrate*Card가 fetch 결과로 body만 다시 채운다
  // (renderStatus가 매번 새로 매기는 el.dataset.statusGen으로 "그 사이 새로고침/다른 화면 이동"된 응답은 버린다).

  const EXCHANGE_CACHE_PREFIX = "triplog.exchangeRate."; // + 통화코드. 값: { rate, fetchedAt(ISO) }

  function readExchangeCache(code) {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXCHANGE_CACHE_PREFIX + code));
      return typeof parsed?.rate === "number" && parsed.fetchedAt ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeExchangeCache(code, rate) {
    try {
      localStorage.setItem(EXCHANGE_CACHE_PREFIX + code, JSON.stringify({ rate, fetchedAt: new Date().toISOString() }));
    } catch {
      // 시크릿 모드 등으로 localStorage를 못 쓰면 캐싱만 못 할 뿐 화면은 그대로 동작한다
    }
  }

  // 100 이상이면 정수(원 단위), 아니면 소수점 있는 통화(JPY·IDR·VND 등)라 최대 2자리까지 보여준다
  function formatKrw(rate) {
    return rate >= 100
      ? Math.round(rate).toLocaleString("ko-KR")
      : rate.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  }

  // open.er-api.com/v6/latest/<코드>: 키 없이 쓰는 무료 환율 API(하루 1회 갱신). rates.KRW가 "그 통화 1단위 = 몇 원"이다.
  async function fetchExchangeRateToKrw(code) {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.KRW;
    if (typeof rate !== "number") throw new Error("KRW 환율 없음");
    return rate;
  }

  async function hydrateExchangeCard(el, trip, gen) {
    const body = el.querySelector('.mytrip-card[data-card="exchange"] .mytrip-card-body');
    if (!body) return;

    const currencyData = window.TripLog.currencyData;
    const { country } = splitDestination(trip);
    const dest = currencyData?.findByCountry(country);
    const code = dest?.code ?? "USD";
    const nameKo = dest?.nameKo ?? "달러";

    try {
      const rate = await fetchExchangeRateToKrw(code);
      writeExchangeCache(code, rate);
      if (el.dataset.statusGen !== String(gen)) return; // 그 사이 새로고침/다른 화면 이동
      body.innerHTML = statBodyHtml(`1 ${nameKo}(${code}) = ₩${formatKrw(rate)}`, "실시간 환율 · open.er-api.com");
    } catch {
      if (el.dataset.statusGen !== String(gen)) return;
      const cached = readExchangeCache(code);
      body.innerHTML = cached
        ? statBodyHtml(`1 ${nameKo}(${code}) = ₩${formatKrw(cached.rate)}`, `갱신 실패, ${formatTimeLabel(new Date(cached.fetchedAt))}`)
        : loadingBodyHtml("환율 정보를 불러오지 못했어요.");
    }
  }

  // WMO 날씨 코드(open-meteo) → 한글 라벨 (0=맑음 ~ 99=우박 동반 뇌우)
  const WEATHER_CODE_LABELS = {
    0: { icon: "☀️", label: "맑음" },
    1: { icon: "🌤️", label: "대체로 맑음" },
    2: { icon: "⛅", label: "구름 조금" },
    3: { icon: "☁️", label: "흐림" },
    45: { icon: "🌫️", label: "안개" },
    48: { icon: "🌫️", label: "안개" },
    51: { icon: "🌦️", label: "약한 이슬비" },
    53: { icon: "🌦️", label: "이슬비" },
    55: { icon: "🌦️", label: "강한 이슬비" },
    56: { icon: "🌦️", label: "언 이슬비" },
    57: { icon: "🌦️", label: "언 이슬비" },
    61: { icon: "🌧️", label: "약한 비" },
    63: { icon: "🌧️", label: "비" },
    65: { icon: "🌧️", label: "강한 비" },
    66: { icon: "🌧️", label: "언 비" },
    67: { icon: "🌧️", label: "언 비" },
    71: { icon: "🌨️", label: "약한 눈" },
    73: { icon: "🌨️", label: "눈" },
    75: { icon: "🌨️", label: "강한 눈" },
    77: { icon: "🌨️", label: "싸락눈" },
    80: { icon: "🌦️", label: "약한 소나기" },
    81: { icon: "🌦️", label: "소나기" },
    82: { icon: "🌦️", label: "강한 소나기" },
    85: { icon: "🌨️", label: "약한 소낙눈" },
    86: { icon: "🌨️", label: "소낙눈" },
    95: { icon: "⛈️", label: "뇌우" },
    96: { icon: "⛈️", label: "우박 동반 뇌우" },
    99: { icon: "⛈️", label: "우박 동반 뇌우" },
  };

  function weatherLabel(code) {
    return WEATHER_CODE_LABELS[code] ?? { icon: "🌡️", label: "정보 없음" };
  }

  // open-meteo 지오코딩: 도시 이름 → 위도/경도 (키 없이 쓰는 무료 API). destinations.js에 등록된 도시면
  // 영문 위키 제목(더 검색이 잘 된다)을, 아니면 목적지 문자열의 도시 부분을 그대로 검색어로 쓴다.
  async function geocodeCity(trip) {
    const cityMeta = trip.cityId ? destinations?.getCityById(trip.cityId) : null;
    const query = cityMeta?.wiki?.replace(/_/g, " ") || splitDestination(trip).city;
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ko&format=json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit) throw new Error("위치를 찾지 못했어요");
    return { lat: hit.latitude, lng: hit.longitude };
  }

  // open-meteo 일별 예보: 무료 요금제는 오늘부터 최대 16일치까지만 나온다.
  async function fetchDailyForecast(lat, lng, startDate, endDate) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${startDate}&end_date=${endDate}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.daily?.time)) throw new Error("예보 데이터 없음");
    return data.daily.time.map((date, i) => ({
      date,
      code: data.daily.weathercode[i],
      max: data.daily.temperature_2m_max[i],
      min: data.daily.temperature_2m_min[i],
    }));
  }

  async function hydrateWeatherCard(el, trip, gen, now) {
    const body = el.querySelector('.mytrip-card[data-card="weather"] .mytrip-card-body');
    if (!body) return;

    try {
      const todayKey = toDateKey(now);
      const horizonEndKey = addDays(todayKey, 15); // 오늘 포함 16일치가 무료 예보 한계
      const rangeStart = trip.startDate > todayKey ? trip.startDate : todayKey;
      const rangeEnd = trip.endDate < horizonEndKey ? trip.endDate : horizonEndKey;

      if (rangeStart > rangeEnd) {
        if (el.dataset.statusGen !== String(gen)) return;
        body.innerHTML = loadingBodyHtml("아직 예보 범위 밖이에요. 출발 16일 전부터 볼 수 있어요.");
        return;
      }

      const loc = await geocodeCity(trip);
      const days = await fetchDailyForecast(loc.lat, loc.lng, rangeStart, rangeEnd);
      if (el.dataset.statusGen !== String(gen)) return;

      const lines = days.map((d) => {
        const meta = weatherLabel(d.code);
        return `${shortDate(d.date)} ${meta.icon} ${meta.label} ${Math.round(d.min)}°~${Math.round(d.max)}°`;
      });
      const list = `<ul class="mytrip-card-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
      const note = days.some((d) => daysUntil(d.date) > 7)
        ? `<p class="mytrip-card-note">장기 예보 참고용 · 7일 이후 예보는 정확도가 낮아요</p>`
        : "";
      body.innerHTML = list + note;
    } catch {
      if (el.dataset.statusGen !== String(gen)) return;
      body.innerHTML = loadingBodyHtml("날씨 정보를 불러오지 못했어요.");
    }
  }

  // [여행 전 3/4] 현지 뉴스 — 처음엔 로딩 문구만 그리고, hydrateBriefingCards가 실제 값을 채운다.
  function buildNewsCard() {
    return { key: "news", icon: "📰", title: "현지 뉴스", bodyHtml: loadingBodyHtml("현지 뉴스를 불러오는 중이에요...") };
  }

  // [여행 전 4/4] 할인 정보 — 처음엔 로딩 문구만 그리고, hydrateBriefingCards가 실제 값을 채운다.
  function buildDiscountCard() {
    return { key: "discount", icon: "🏷️", title: "할인 정보", bodyHtml: loadingBodyHtml("할인 정보를 불러오는 중이에요...") };
  }

  // 현지 뉴스·할인 정보 항목 하나(title/summary/sourceUrl/sourceName) → <li> 한 줄. 출처 링크는 항상 있다
  // (travel-briefing이 이미 sourceUrl 없는 항목을 걸러서 보낸다) - walletViewer.js의 "새 탭에서 열기" 링크와
  // 같은 방식(href에 escapeHtml)으로 새 탭에 연다.
  function briefingItemHtml(item) {
    let sourceLabel = item.sourceName;
    if (!sourceLabel) {
      try {
        sourceLabel = new URL(item.sourceUrl).hostname.replace(/^www\./, "");
      } catch {
        sourceLabel = "출처 보기";
      }
    }
    return `
      <li class="mytrip-briefing-item">
        <p class="mytrip-briefing-title">${escapeHtml(item.title)}</p>
        <p class="mytrip-briefing-summary">${escapeHtml(item.summary)}</p>
        <a class="mytrip-briefing-source" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel)} ↗</a>
      </li>`;
  }

  function briefingBodyHtml(items, emptyText, stale) {
    const note = stale ? `<p class="mytrip-card-note">갱신 실패 · 이전에 가져온 정보예요</p>` : "";
    if (!items.length) return loadingBodyHtml(emptyText) + note;
    return `<ul class="mytrip-card-list mytrip-card-list--briefing">${items.map(briefingItemHtml).join("")}</ul>` + note;
  }

  // travel-briefing Edge Function을 한 번만 불러서(요청 3번) 현지 뉴스·할인 정보 카드 두 개를 같이 채운다
  // (news/deals가 한 응답에 같이 오므로, 카드가 두 개라고 따로 두 번 부를 필요가 없다). 실패하면 캐시가 있어도
  // 없어도 안내 문구만 보여준다 - Edge Function 쪽이 이미 "캐시라도 있으면 stale:true로 돌려주고, 정말
  // 아무것도 없을 때만 error"를 처리해 두었으므로, 여기서 오는 error는 "정말 아무 정보도 없다"는 뜻이다.
  async function hydrateBriefingCards(el, trip, gen) {
    const newsBody = el.querySelector('.mytrip-card[data-card="news"] .mytrip-card-body');
    const discountBody = el.querySelector('.mytrip-card[data-card="discount"] .mytrip-card-body');
    if (!newsBody && !discountBody) return;

    try {
      const { data, error } = await supabase.functions.invoke("travel-briefing", {
        body: { destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "travel-briefing 실패");
      if (el.dataset.statusGen !== String(gen)) return; // 그 사이 새로고침/다른 화면 이동

      if (newsBody) newsBody.innerHTML = briefingBodyHtml(data.news ?? [], "아직 관련 뉴스가 없어요.", data.stale);
      if (discountBody) discountBody.innerHTML = briefingBodyHtml(data.deals ?? [], "아직 할인 정보가 없어요.", data.stale);
    } catch {
      if (el.dataset.statusGen !== String(gen)) return;
      if (newsBody) newsBody.innerHTML = loadingBodyHtml("현지 뉴스를 불러오지 못했어요.");
      if (discountBody) discountBody.innerHTML = loadingBodyHtml("할인 정보를 불러오지 못했어요.");
    }
  }

  // ---- 실시간 연동: 공항 이동 교통상황(Google Distance Matrix) · 공항 혼잡도(Edge Function) ----
  // 이 둘은 위치 권한이 없거나 공식 데이터가 없으면 카드 자체를 지운다(요청 1·2번) - 실패 문구를 보여주는
  // 환율/날씨/뉴스/할인 카드와 다른 규칙이다.

  const LOCATION_MESSAGE = "주변 장소 검색과 교통정보 안내를 위해 위치정보를 사용합니다.";
  const PERMISSION_DENIED_MESSAGE = "설정에서 권한을 허용해주세요.";

  // navigator.geolocation을 Promise로. 실제 OS 권한 팝업을 띄우는 지점은 이 호출 시점이다 - 그래서
  // hydrateAirportTrafficCard가 이걸 바로 부르지 않고, 아직 묻지 않은 상태라면 안내(허용/나중에)를 먼저
  // 보여준 뒤 '허용'을 눌렀을 때만 이 함수를 부른다(요청 2번).
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("이 브라우저는 위치 정보를 지원하지 않아요"));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(err), // 권한 거부(PERMISSION_DENIED)·위치 확인 실패·시간 초과 모두 여기로 온다
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 } // 5분 이내 캐시된 위치면 재요청 없이 바로 쓴다
      );
    });
  }

  // 이미 거부한 적이 있는지 미리 확인한다(요청 3번) - Permissions API를 지원하는 브라우저(크롬 계열 등)에서만
  // 가능하다. 지원하지 않으면(일부 Safari 버전 등) null(모름)을 돌려주고, 호출한 쪽은 "아직 묻지 않음"과
  // 똑같이 취급해 안내(허용/나중에)부터 보여준다 - 모르는 상태를 "거부됨"으로 잘못 단정하지 않기 위해서다.
  async function checkGeoPermission() {
    try {
      if (!navigator.permissions?.query) return null;
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state; // 'granted' | 'denied' | 'prompt'
    } catch (err) {
      console.warn("[myTripPage] 위치 권한 상태 확인 실패", err);
      return null;
    }
  }

  // 실제 위치 조회 + 경로 계산. '허용'을 누른 뒤(또는 이미 권한이 있을 때) 호출한다.
  async function runAirportTrafficLookup(el, body, result, gen) {
    body.innerHTML = loadingBodyHtml("현재 위치를 확인하는 중이에요...");
    try {
      const pos = await getCurrentPosition(); // 이미 거부된 상태가 아니라면 여기서 OS 권한 팝업이 뜬다
      const airport = flightData.getAirport(result.flightItem.flight.depAirport);
      if (!airport) throw new Error("공항 정보 없음");
      const eta = await googleMaps.travelDurationTo(pos, airport.name); // 공항 이름을 목적지 주소로 그대로 쓴다(좌표를 따로 안 들고 있어도 된다)
      if (!eta) throw new Error("경로를 찾지 못했어요");
      if (el.dataset.statusGen !== String(gen)) return; // 그 사이 새로고침/다른 화면 이동

      body.innerHTML = statBodyHtml(`예상 소요시간 ${eta.durationText}`, `${airport.name} 가는 길 · ${eta.distanceText}`);
    } catch {
      if (el.dataset.statusGen !== String(gen)) return;
      body.closest(".mytrip-card")?.remove(); // 위치 조회 자체의 실패(거부 포함) → 카드를 숨긴다 (요청 1번)
    }
  }

  async function hydrateAirportTrafficCard(el, result, gen) {
    const body = el.querySelector('.mytrip-card[data-card="traffic"] .mytrip-card-body');
    if (!body) return;

    const permission = await checkGeoPermission();
    if (el.dataset.statusGen !== String(gen)) return; // 그 사이 새로고침/다른 화면 이동

    if (permission === "denied") {
      // 이미 거부한 적이 있으면 안내(허용/나중에) 대신 설정으로 안내한다(요청 3번) - 다시 물어봐도
      // OS가 권한 팝업 자체를 띄워주지 않는 경우가 많아 getCurrentPosition을 아예 부르지 않는다.
      body.innerHTML = loadingBodyHtml(PERMISSION_DENIED_MESSAGE);
      return;
    }

    if (permission === "granted") {
      // 이미 허용된 상태면 다시 안내할 필요 없이 바로 조회한다 - OS 팝업 자체가 뜨지 않기 때문이다.
      return runAirportTrafficLookup(el, body, result, gen);
    }

    // 아직 묻지 않았거나(permission === "prompt") 상태를 확인할 수 없으면(permission === null) 실제 OS
    // 팝업을 띄우기 전에 이 안내부터 보여준다(요청 2번).
    body.innerHTML = permissionBodyHtml(LOCATION_MESSAGE, { allowLabel: "허용", laterLabel: "나중에" });
    body.querySelector('[data-action="permission-allow"]')?.addEventListener("click", () => {
      runAirportTrafficLookup(el, body, result, gen);
    });
    body.querySelector('[data-action="permission-later"]')?.addEventListener("click", () => {
      body.closest(".mytrip-card")?.remove(); // 지금은 원하지 않음 → 카드를 숨긴다(다음 방문 때 다시 물어본다)
    });
  }

  // 공식 실시간 혼잡도 공개데이터가 있는 걸로 확인한 국내 공항만. 다른 국내 공항·모든 해외 공항은 buildCards가
  // 아예 이 카드를 만들지 않는다(요청 2번: "해외 공항은 항상 숨김"도 이 목록에 없으면 자동으로 만족된다).
  // supabase/functions/airport-congestion/README.md 참고 - 인천공항 API 자체도 아직 미검증 상태다.
  const CONGESTION_AVAILABLE_AIRPORTS = new Set(["ICN"]);

  async function hydrateAirportCongestionCard(el, result, gen) {
    const body = el.querySelector('.mytrip-card[data-card="congestion"] .mytrip-card-body');
    if (!body) return; // buildCards가 애초에 이 카드를 안 만들었으면(지원 안 하는 공항) 할 일이 없다

    try {
      const { data, error } = await supabase.functions.invoke("airport-congestion", {
        body: { airportCode: result.flightItem.flight.depAirport },
      });
      if (el.dataset.statusGen !== String(gen)) return;
      if (error || data?.available !== true) throw new Error("혼잡도 정보 없음");

      body.innerHTML = statBodyHtml(
        `혼잡도 ${data.level}`,
        data.waitMinutes != null ? `보안검색대 대기 약 ${data.waitMinutes}분` : "실시간 혼잡도"
      );
    } catch {
      if (el.dataset.statusGen !== String(gen)) return;
      body.closest(".mytrip-card")?.remove(); // 공식 데이터가 없거나 조회 실패 → 카드 자체를 숨긴다 (요청 2번)
    }
  }

  // ---- 실시간 연동: 주변 맛집/볼거리 (Google Places Nearby Search, googleMaps.js#searchNearby 재사용) ----

  const NEARBY_TYPES = ["restaurant", "cafe", "tourist_attraction"]; // 맛집(식당·카페) + 볼거리
  const NEARBY_RADIUS_M = 1000; // 반경 1km (요청 3번)

  // Google Places(New)는 includedPrimaryTypes로 "restaurant"를 요청해도 실제 결과의 primaryType은
  // japanese_restaurant/sushi_restaurant/ramen_restaurant/fast_food_restaurant처럼 더 구체적인 하위
  // 유형으로 온다(생 API로 직접 확인함) - 정확히 일치하는 값만 찾는 표 대신 부분 문자열로 매칭한다.
  function nearbyIcon(primaryType) {
    const t = primaryType || "";
    if (t.includes("cafe") || t === "coffee_shop") return "☕";
    if (t.includes("restaurant") || t === "food" || t.includes("meal_")) return "🍜";
    if (t.includes("bakery")) return "🥐";
    if (t.includes("bar") || t.includes("pub")) return "🍸";
    if (t.includes("museum") || t.includes("tourist_attraction") || t.includes("landmark") || t.includes("monument")) return "🏛️";
    if (t.includes("park")) return "🌳";
    return "📍";
  }

  // "1.2km" | "350m" - haversineKm(위 거리 계산)은 util.js의 공유 함수를 그대로 쓰지만, km→문자열 표기
  // 규칙 자체는 app.js#formatDistanceKm(타임라인 카드 사이 거리 표시)와 같은 규칙을 이 파일에도 옮겨 적은
  // 것이다(app.js를 참조하면 모듈 의존이 한 방향 더 늘어나므로).
  function formatDistanceKm(km) {
    return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
  }

  async function hydrateNearbyCard(el, result, gen) {
    if (!result.nextItem) return; // buildNearbyCard가 이미 빈 상태를 그려 뒀다 - 찾아볼 좌표 자체가 없다
    const body = el.querySelector('.mytrip-card[data-card="nearby"] .mytrip-card-body');
    if (!body) return;

    const item = result.nextItem;
    if (typeof item.lat !== "number" || typeof item.lng !== "number") {
      body.innerHTML = loadingBodyHtml("이 일정에 위치 정보가 없어서 주변 정보를 찾을 수 없어요.");
      return;
    }

    try {
      const center = { lat: item.lat, lng: item.lng };
      const places = await googleMaps.searchNearby({ center, radius: NEARBY_RADIUS_M, types: NEARBY_TYPES, max: 6 });
      if (el.dataset.statusGen !== String(gen)) return;

      if (!places.length) {
        body.innerHTML = loadingBodyHtml("주변 1km 안에서 추천할 만한 곳을 못 찾았어요.");
        return;
      }
      const spots = places
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
        .map((p) => ({
          icon: nearbyIcon(p.primaryType),
          name: p.name,
          desc: [p.typeLabel || null, p.rating ? `${p.rating}★` : null, formatDistanceKm(haversineKm(center, { lat: p.lat, lng: p.lng }))]
            .filter(Boolean)
            .join(" · "),
        }));
      body.innerHTML = `<ul class="mytrip-card-list mytrip-card-list--spots">${spots
        .map(
          (s) =>
            `<li><span class="mytrip-spot-icon" aria-hidden="true">${s.icon}</span><span class="mytrip-spot-text"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.desc)}</small></span></li>`
        )
        .join("")}</ul>`;
    } catch {
      if (el.dataset.statusGen !== String(gen)) return;
      body.innerHTML = loadingBodyHtml("주변 정보를 불러오지 못했어요.");
    }
  }

  // [출발 전 1/2] 공항 이동 교통상황 — 처음엔 로딩 문구만 그리고, hydrateAirportTrafficCard가 채운다.
  function buildAirportTrafficCard() {
    return { key: "traffic", icon: "🚗", title: "공항 이동 교통상황", bodyHtml: loadingBodyHtml("현재 위치를 확인하는 중이에요...") };
  }

  // [출발 전 2/2] 공항 혼잡도 — buildCards가 공식 공개데이터가 있는 공항일 때만 이 카드를 추가한다(요청 2번).
  // 처음엔 로딩 문구만 그리고, hydrateAirportCongestionCard가 채운다(혹은 조회 실패 시 카드 자체를 지운다).
  function buildAirportCongestionCard() {
    return { key: "congestion", icon: "🧳", title: "공항 혼잡도", bodyHtml: loadingBodyHtml("혼잡도를 확인하는 중이에요...") };
  }

  // [여행중] 다음 일정 장소 주변 맛집/볼거리. 오늘 남은 일정이 없으면(result.nextItem null) 빈 상태만 보여주고
  // 끝(hydrate 호출 자체가 없다 - 찾아볼 좌표가 없으므로). 있으면 로딩 문구만 그리고 hydrateNearbyCard가 채운다.
  function buildNearbyCard(result) {
    if (!result.nextItem) {
      return { key: "nearby", icon: "📍", title: "주변 정보", bodyHtml: loadingBodyHtml("오늘 남은 일정이 없어요.") };
    }
    const place = result.nextItem.place || result.nextItem.title || "다음 일정";
    return { key: "nearby", icon: "📍", title: `${place} 근처`, bodyHtml: loadingBodyHtml("주변 정보를 찾는 중이에요...") };
  }

  // 상태별 카드 목록. 순서 = 급한 것부터(요청 2번): 출발 전은 교통상황(공항 이동) → 혼잡도 순.
  function buildCards(trip, result) {
    if (result.phase === PHASE.BEFORE_TRIP) {
      return [buildExchangeCard(), buildWeatherCard(), buildNewsCard(), buildDiscountCard()];
    }
    if (result.phase === PHASE.BEFORE_DEPARTURE) {
      const cards = [buildAirportTrafficCard()];
      if (CONGESTION_AVAILABLE_AIRPORTS.has(result.flightItem.flight.depAirport)) {
        cards.push(buildAirportCongestionCard());
      }
      return cards;
    }
    if (result.phase === PHASE.IN_TRIP) {
      return [buildNearbyCard(result)];
    }
    return [];
  }

  function phaseHeaderText(trip, result) {
    if (result.phase === PHASE.BEFORE_TRIP) {
      return { title: "여행 전", sub: `${ddayLabel(trip.startDate)} · 출발 준비를 시작해요` };
    }
    if (result.phase === PHASE.BEFORE_DEPARTURE) {
      return { title: "출발 전", sub: `출발까지 ${formatDuration(result.minutesUntilDeparture)} 남았어요` };
    }
    if (result.phase === PHASE.IN_TRIP) {
      const place = result.nextItem?.place || result.nextItem?.title;
      return { title: "여행중", sub: place ? `다음 일정: ${place}` : "오늘 남은 일정이 없어요" };
    }
    return { title: "", sub: "" };
  }

  let statusGen = 0; // renderStatus를 부를 때마다 하나씩 늘려서, 뒤늦게 도착한 fetch 응답이 최신 렌더를 덮지 않게 한다

  // trip·items·now로 상태를 다시 계산해 헤더와 카드 목록을 통째로 다시 그린다. 새로고침 버튼과 최초 진입이 공유한다.
  // 환율·날씨 카드는 먼저 로딩 문구로 그려두고, 이 함수가 끝난 뒤 hydrateExchangeCard/hydrateWeatherCard가
  // 비동기로 실제 값을 채운다(el.dataset.statusGen으로 이 호출이 여전히 최신인지 그때 다시 확인한다).
  function renderStatus(el, trip, items, now) {
    const result = computeTripPhase(trip, items, { now });
    const { title, sub } = phaseHeaderText(trip, result);
    const timeLabel = formatTimeLabel(now);
    const gen = ++statusGen;
    el.dataset.statusGen = String(gen);

    el.querySelector("[data-mytrip-title]").textContent = title;
    el.querySelector("[data-mytrip-sub]").textContent = sub;
    el.querySelector("[data-mytrip-cards]").innerHTML = buildCards(trip, result)
      .map((card) => cardHtml(card, timeLabel))
      .join("");

    if (result.phase === PHASE.BEFORE_TRIP) {
      hydrateExchangeCard(el, trip, gen);
      hydrateWeatherCard(el, trip, gen, now);
      hydrateBriefingCards(el, trip, gen);
    }
    if (result.phase === PHASE.BEFORE_DEPARTURE) {
      hydrateAirportTrafficCard(el, result, gen);
      hydrateAirportCongestionCard(el, result, gen); // buildCards가 애초에 카드를 안 만들었으면 내부에서 바로 반환
    }
    if (result.phase === PHASE.IN_TRIP) {
      hydrateNearbyCard(el, result, gen);
    }
  }

  const REFRESH_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3"/><path d="M17.3 4.3v3.2h-3.2M6.7 19.7v-3.2h3.2"/></svg>';

  async function render(el, { params }) {
    const trip = getTripById(params.id);
    if (!trip) return; // 가드가 이미 걸러내므로 여기까지 오지 않는다
    el.dataset.tripId = trip.id;
    const runId = ++loadRunId;

    el.innerHTML = `
      <div class="mytrip-status-shell">
        <header class="mytrip-status-header">
          <div class="mytrip-status-header-text">
            <h1 class="mytrip-status-title" data-mytrip-title></h1>
            <p class="mytrip-status-sub" data-mytrip-sub></p>
          </div>
          <button type="button" class="mytrip-refresh-btn" data-action="refresh">${REFRESH_ICON}<span>새로고침</span></button>
        </header>
        <div class="mytrip-status-scroll" data-mytrip-cards></div>
      </div>`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      // 수동 새로고침: 자동갱신(추후 API 연동 시 타이머로 추가될 부분)과는 별개로, 언제든 지금 시각 기준으로
      // 상태·카드를 즉시 다시 계산해 그린다 — renderStatus를 그대로 다시 부르기만 하면 되므로 서로 독립적이다.
      el.addEventListener("click", (e) => {
        const btn = e.target.closest('[data-action="refresh"]');
        if (!btn) return;
        const currentTrip = getTripById(el.dataset.tripId);
        if (!currentTrip) return;
        btn.classList.add("is-refreshing");
        setTimeout(() => btn.classList.remove("is-refreshing"), 500);
        renderStatus(el, currentTrip, getItems(), new Date());
        ui.showToast("새로고침했어요");
      });
    }

    // 처음 보는 여행이면 "불러오는 중" 문구를 먼저 보여주고, 받아 둔 적 있으면 캐시로 먼저 그린 뒤 새로 고친다
    // (budgetPage.js#render와 같은 패턴)
    if (isItemsLoaded(trip.id)) {
      renderStatus(el, trip, getItems(), new Date());
    } else {
      el.querySelector("[data-mytrip-cards]").innerHTML = `<p class="mytrip-status-loading">정보를 불러오는 중이에요...</p>`;
    }

    try {
      await loadItems(trip.id);
    } catch (err) {
      if (runId === loadRunId) ui.showToast(err.message);
    }
    if (runId !== loadRunId || el.dataset.tripId !== trip.id) return; // 그 사이에 떠났거나 다른 여행으로 옮겼다
    renderStatus(el, trip, getItems(), new Date());
  }

  router.definePage("my-trip", render);

  window.TripLog.myTripPage = { PHASE, computeTripPhase };
})();
