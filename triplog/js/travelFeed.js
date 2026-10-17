// @별칭 MAIN-FEED · 메인 화면 '여행 소식' 영역 + 전체 목록(#/travel-feed) + 상세 모달
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 메인 화면("내 여행" 아래)에 안전/혜택 소식 카드를 최대 3개까지 보여주고, "더보기"를 누르면 같은 카드를
// 전부 보여주는 #/travel-feed로 이동한다. 둘 다 get_travel_feed RPC(021/024_travel_feed*.sql)를 쓰고,
// 같은 모듈 범위 캐시(5분)를 공유해서 탭을 오가거나 메인/목록 화면을 왔다갔다 해도 같은 조합을 5분 안에
// 다시 조회하면 네트워크 요청 없이 캐시를 쓴다(요청 8번).
//
// 원문 텍스트는 어디에도 저장/표시하지 않는다 - summary(우리가 정리한 요약)와 source_url(원문 링크)만 쓴다.
// '원문 보기'는 openExternalLink()가 네이티브 앱에서는 @capacitor/browser(인앱 브라우저, loginPage.js와 같은
// 플러그인)로, 웹에서는 새 탭으로 연다 - source_url을 그대로 전달할 뿐 아무 값도 덧붙이지 않는다(사용자
// 식별 정보 없음).

(function () {
  const router = window.TripLog.router;
  const auth = window.TripLog.auth;
  const { escapeHtml } = window.TripLog.util;
  const weatherCodes = window.TripLog.weatherCodes;
  const tripSetup = window.TripLog.tripSetup;
  const storage = window.TripLog.storage;
  const ui = window.TripLog.ui;

  const CACHE_MS = 5 * 60 * 1000; // 요청 8번: 같은 조합은 5분 안에 다시 안 부른다
  const MAIN_LIMIT = 3; // 요청 3번: 메인 화면엔 상위 3개만
  const LIST_LIMIT = 50; // "더보기" 전체 목록 - 100이 서버 상한(021/024)이라 그 안에서 넉넉히
  const cache = new Map(); // `${kind}|${scope}|${limit}` -> { data, fetchedAt }
  const rowCache = new Map(); // id -> get_travel_feed 행 (상세 모달이 다시 조회하지 않고 바로 쓴다)

  const KIND_LABEL = { safety: "여행 안전", benefit: "여행 혜택" };
  const IMPORTANCE_LABEL = { high: "높음", medium: "보통", low: "참고" };

  // ---- 공용: 날짜·기간·원문 링크 ----

  // mainPage.js의 dotted()와 같은 표기("2026.11.14") - timestamptz/date 문자열 앞 10자(YYYY-MM-DD)만 쓴다
  function formatDateDots(value) {
    if (!value) return "";
    return String(value).slice(0, 10).replaceAll("-", ".");
  }

  function periodLabel(row) {
    const from = row.valid_from ? formatDateDots(row.valid_from) : "";
    const to = row.valid_to ? formatDateDots(row.valid_to) : "";
    if (from && to) return `${from} ~ ${to}`;
    return from || to;
  }

  // 네이티브 앱에서는 인앱 브라우저(@capacitor/browser, loginPage.js#137과 같은 플러그인)로, 웹에서는 새 탭으로.
  // url(= row.source_url)을 그대로만 쓰고 쿼리 파라미터 등 아무것도 덧붙이지 않는다.
  function openExternalLink(url) {
    if (!url) return;
    if (auth?.isNativeApp?.() && window.Capacitor?.Plugins?.Browser) {
      window.Capacitor.Plugins.Browser.open({ url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  // ---- 캐시 ----

  function cacheKey(kind, scope, limit) {
    return `${kind}|${scope || ""}|${limit}`;
  }

  function getCached(kind, scope, limit) {
    const hit = cache.get(cacheKey(kind, scope, limit));
    return hit && Date.now() - hit.fetchedAt < CACHE_MS ? hit.data : null;
  }

  async function fetchFeed(kind, scope, limit) {
    const cached = getCached(kind, scope, limit);
    if (cached) return cached;
    const { data, error } = await window.TripLog.supabase.rpc("get_travel_feed", {
      p_kind: kind,
      p_scope: scope || null,
      p_limit: limit,
    });
    if (error) throw error;
    const rows = data || [];
    cache.set(cacheKey(kind, scope, limit), { data: rows, fetchedAt: Date.now() });
    return rows;
  }

  // ---- 카드 한 장 ----

  function matchLabelsHtml(row) {
    const labels = [];
    if (row.is_my_destination) labels.push('<span class="feed-match-label">내 여행지</span>');
    if (row.is_my_airline) labels.push('<span class="feed-match-label">내 항공편</span>');
    return labels.join("");
  }

  function feedCardHtml(row) {
    const dateLine = row.kind === "benefit" ? periodLabel(row) : formatDateDots(row.published_at);
    const metaText = [row.region_label, dateLine].filter(Boolean).join(" · ");
    return `
      <li class="feed-card" data-id="${escapeHtml(row.id)}">
        <div class="feed-card-top">
          <span class="feed-badge feed-badge--${escapeHtml(row.importance)}">${escapeHtml(IMPORTANCE_LABEL[row.importance] || row.importance)}</span>
          ${matchLabelsHtml(row)}
        </div>
        <p class="feed-card-title">${escapeHtml(row.title)}</p>
        ${metaText ? `<p class="feed-card-meta">${escapeHtml(metaText)}</p>` : ""}
        <p class="feed-card-source">${escapeHtml(row.source_name)}</p>
      </li>`;
  }

  function skeletonCardHtml() {
    return `
      <li class="feed-card feed-card--skeleton">
        <span class="pick-skeleton-line feed-skeleton-badge"></span>
        <span class="pick-skeleton-line feed-skeleton-title"></span>
        <span class="pick-skeleton-line feed-skeleton-meta"></span>
      </li>`;
  }

  function skeletonHtml(count) {
    return `<ul class="feed-card-list">${Array.from({ length: count }, skeletonCardHtml).join("")}</ul>`;
  }

  function emptyMessage(kind) {
    return kind === "safety" ? "현재 등록된 주의 소식이 없어요." : "현재 등록된 혜택 소식이 없어요.";
  }

  // rows를 container에 카드로 채운다. withMore면 "더보기" 버튼을 덧붙인다(메인 화면 미리보기 전용 - 전체
  // 목록 화면에서는 이미 전부 보여주므로 더보기가 없다). 여기서 그린 모든 행은 rowCache에 올려 둬서
  // 카드를 눌렀을 때(openDetail) 다시 조회하지 않고 바로 쓴다.
  function renderFeedResult(container, rows, kind, { withMore }) {
    rows.forEach((row) => rowCache.set(row.id, row));
    if (!rows.length) {
      container.innerHTML = `<p class="feed-empty">${escapeHtml(emptyMessage(kind))}</p>`;
      return;
    }
    const cardsHtml = `<ul class="feed-card-list">${rows.map(feedCardHtml).join("")}</ul>`;
    const moreHtml = withMore ? `<button type="button" class="feed-more-btn" data-action="feed-more">더보기</button>` : "";
    container.innerHTML = cardsHtml + moreHtml;
  }

  function renderFeedError(container) {
    container.innerHTML = `
      <div class="feed-empty-state">
        <p class="feed-empty">소식을 불러오지 못했어요.</p>
        <button type="button" class="btn btn-save" data-action="feed-retry">다시 시도</button>
      </div>`;
  }

  // ==========================================================================
  // 메인 화면 미리보기 (최대 3개)
  // ==========================================================================

  // 탭/칩 선택은 메인 화면이 다시 그려져도(여행 목록이 바뀔 때마다 mainPage.js가 el.innerHTML을 통째로
  // 다시 쓴다) 유지되도록 모듈 범위에 둔다 - DOM은 매번 새로 생기지만 이 state는 그대로다.
  const mainState = { kind: "safety", scope: "overseas" };
  let mainFeedSectionEl = null;
  let mainFeedGen = 0;

  // mainPage.js가 "내 여행" 섹션 바로 다음에 그대로 꽂아 넣는 조각 - trips.length===0이면 mainPage.js가
  // 이 함수 자체를 안 불러서(요청 1번: 여행이 없으면 빈 상태 안내만 보여주고 그 아래를 비워 화면을 채운다)
  // 여기선 "여행이 있는 경우"만 신경 쓴다.
  function mainSectionHtml() {
    return `
      <section class="main-feed" aria-label="여행 소식" data-alias="MAIN-FEED · 여행 소식">
        <div class="main-trips-head">
          <h2 class="main-section-title">여행 소식</h2>
        </div>
        <div class="tab-row" data-feed-kind-tabs>
          <button type="button" class="tab${mainState.kind === "safety" ? " tab--active" : ""}" data-kind="safety">여행 안전</button>
          <button type="button" class="tab${mainState.kind === "benefit" ? " tab--active" : ""}" data-kind="benefit">여행 혜택</button>
        </div>
        <div class="tab-row tab-row--sub" data-feed-scope-chips${mainState.kind === "benefit" ? "" : " hidden"}>
          <button type="button" class="tab${mainState.scope === "overseas" ? " tab--active" : ""}" data-scope="overseas">해외</button>
          <button type="button" class="tab${mainState.scope === "domestic" ? " tab--active" : ""}" data-scope="domestic">국내</button>
        </div>
        <div class="main-feed-body" data-feed-body></div>
      </section>`;
  }

  // mainPage.js가 el.innerHTML을 채운 "다음" 호출한다 - sectionEl은 방금 새로 생긴 DOM이라(이전 섹션은
  // mainPage의 innerHTML 교체로 이미 통째로 사라졌다) 리스너 중복 걱정 없이 매번 그냥 새로 건다.
  function initMainSection(sectionEl) {
    if (!sectionEl) return;
    mainFeedSectionEl = sectionEl;
    sectionEl.addEventListener("click", handleMainFeedClick);
    refreshMainFeed();
  }

  function handleMainFeedClick(e) {
    const kindBtn = e.target.closest("[data-kind]");
    if (kindBtn) {
      mainState.kind = kindBtn.dataset.kind;
      syncMainFeedShell();
      return;
    }
    const scopeBtn = e.target.closest("[data-scope]");
    if (scopeBtn) {
      mainState.scope = scopeBtn.dataset.scope;
      syncMainFeedShell();
      return;
    }
    if (e.target.closest('[data-action="feed-more"]')) {
      const params = new URLSearchParams({ kind: mainState.kind });
      if (mainState.kind === "benefit") params.set("scope", mainState.scope);
      router.navigate(`${router.buildPath("travel-feed")}?${params.toString()}`);
      return;
    }
    if (e.target.closest('[data-action="feed-retry"]')) {
      refreshMainFeed();
      return;
    }
    const card = e.target.closest(".feed-card[data-id]");
    if (card) openDetail(card.dataset.id);
  }

  // 탭/칩 버튼의 active 표시와 칩 표시 여부만 즉시 맞추고(깜빡임 없이), 본문은 refreshMainFeed가 채운다
  function syncMainFeedShell() {
    if (!mainFeedSectionEl) return;
    mainFeedSectionEl.querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("tab--active", b.dataset.kind === mainState.kind));
    const chips = mainFeedSectionEl.querySelector("[data-feed-scope-chips]");
    if (chips) chips.hidden = mainState.kind !== "benefit";
    mainFeedSectionEl.querySelectorAll("[data-scope]").forEach((b) => b.classList.toggle("tab--active", b.dataset.scope === mainState.scope));
    refreshMainFeed();
  }

  async function refreshMainFeed() {
    const sectionEl = mainFeedSectionEl;
    const bodyEl = sectionEl?.querySelector("[data-feed-body]");
    if (!bodyEl) return;
    const myGen = ++mainFeedGen;
    const effectiveScope = mainState.kind === "benefit" ? mainState.scope : null;
    if (!getCached(mainState.kind, effectiveScope, MAIN_LIMIT)) bodyEl.innerHTML = skeletonHtml(MAIN_LIMIT);
    try {
      const rows = await fetchFeed(mainState.kind, effectiveScope, MAIN_LIMIT);
      if (mainFeedGen !== myGen || mainFeedSectionEl !== sectionEl) return; // 그 사이 다른 탭으로 바뀌었거나 화면을 떠났다
      renderFeedResult(bodyEl, rows, mainState.kind, { withMore: true });
    } catch (err) {
      if (mainFeedGen !== myGen || mainFeedSectionEl !== sectionEl) return;
      console.error("[travelFeed] 여행 소식 조회 실패", err); // 화면엔 안내문만 보이므로, 실제 원인은 콘솔에서 확인한다
      renderFeedError(bodyEl);
    }
  }

  // ==========================================================================
  // 전체 목록 화면 (#/travel-feed, "더보기")
  // ==========================================================================

  let listPageEl = null;
  const listState = { kind: "safety", scope: "overseas" };
  let listGen = 0;

  function renderFeedListPage(el) {
    listPageEl = el;
    const q = router.query();
    listState.kind = q.get("kind") === "benefit" ? "benefit" : "safety";
    listState.scope = q.get("scope") === "domestic" ? "domestic" : "overseas";

    const { ICONS } = window.TripLog.commonPages;
    el.innerHTML = `
      <header class="simple-page-header">
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="back" aria-label="뒤로">${ICONS.back}</button>
        <h1 class="simple-page-title">${escapeHtml(KIND_LABEL[listState.kind])}</h1>
      </header>
      <div class="tab-row tab-row--sub" data-feed-scope-chips${listState.kind === "benefit" ? "" : " hidden"}>
        <button type="button" class="tab${listState.scope === "overseas" ? " tab--active" : ""}" data-scope="overseas">해외</button>
        <button type="button" class="tab${listState.scope === "domestic" ? " tab--active" : ""}" data-scope="domestic">국내</button>
      </div>
      <div class="main-feed-body" data-feed-body></div>`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="back"]')) return history.back();
        const scopeBtn = e.target.closest("[data-scope]");
        if (scopeBtn) {
          listState.scope = scopeBtn.dataset.scope;
          listPageEl?.querySelectorAll("[data-feed-scope-chips] .tab").forEach((b) => b.classList.toggle("tab--active", b === scopeBtn));
          router.navigate(`${router.buildPath("travel-feed")}?kind=${listState.kind}&scope=${listState.scope}`, { replace: true });
          refreshFeedList();
          return;
        }
        if (e.target.closest('[data-action="feed-retry"]')) return refreshFeedList();
        const card = e.target.closest(".feed-card[data-id]");
        if (card) openDetail(card.dataset.id);
      });
    }

    refreshFeedList();
  }

  async function refreshFeedList() {
    const el = listPageEl;
    const bodyEl = el?.querySelector("[data-feed-body]");
    if (!bodyEl) return;
    const myGen = ++listGen;
    const effectiveScope = listState.kind === "benefit" ? listState.scope : null;
    if (!getCached(listState.kind, effectiveScope, LIST_LIMIT)) bodyEl.innerHTML = skeletonHtml(5);
    try {
      const rows = await fetchFeed(listState.kind, effectiveScope, LIST_LIMIT);
      if (listGen !== myGen || listPageEl !== el) return;
      renderFeedResult(bodyEl, rows, listState.kind, { withMore: false });
    } catch (err) {
      if (listGen !== myGen || listPageEl !== el) return;
      console.error("[travelFeed] 여행 소식 전체 목록 조회 실패", err);
      renderFeedError(bodyEl);
    }
  }

  router.definePage("travel-feed", renderFeedListPage);
  router.onEnter("travel-feed", () => document.body.classList.add("has-simple-page-bg"));
  router.onLeave("travel-feed", () => document.body.classList.remove("has-simple-page-bg"));

  // ==========================================================================
  // 상세 모달 (카드를 누르면 연다)
  // ==========================================================================

  let detailOverlay = null;

  function ensureDetailModal() {
    if (detailOverlay) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal-overlay feed-detail-overlay" hidden>
        <div class="modal feed-detail-modal" role="dialog" aria-modal="true" aria-labelledby="feed-detail-title">
          <div class="feed-detail-top">
            <span class="feed-badge" data-detail-importance></span>
            <button type="button" class="mytrip-icon-btn" data-action="close" aria-label="닫기">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
            </button>
          </div>
          <h2 class="modal-title" id="feed-detail-title" data-detail-title></h2>
          <p class="feed-detail-meta" data-detail-meta></p>
          <p class="feed-detail-summary" data-detail-summary></p>
          <p class="feed-detail-action-tip" data-detail-action-tip hidden></p>
          <p class="feed-detail-source-name" data-detail-source-name></p>
          <p class="feed-detail-checked" data-detail-checked></p>
          <button type="button" class="btn btn-save btn-block" data-action="open-source">원문 보기</button>
          <p class="feed-detail-disclaimer" data-detail-disclaimer hidden>정확한 내용은 출처의 공식 사이트에서 확인하세요.</p>
        </div>
      </div>`;
    detailOverlay = wrap.firstElementChild;
    document.body.appendChild(detailOverlay);

    detailOverlay.addEventListener("click", (e) => {
      if (e.target === detailOverlay || e.target.closest('[data-action="close"]')) closeDetail();
      else if (e.target.closest('[data-action="open-source"]')) openExternalLink(detailOverlay.dataset.sourceUrl);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && detailOverlay && !detailOverlay.hidden) closeDetail();
    });
  }

  function openDetail(id) {
    const row = rowCache.get(id);
    if (!row) return;
    ensureDetailModal();
    detailOverlay.dataset.sourceUrl = row.source_url;
    detailOverlay.querySelector("[data-detail-importance]").className = `feed-badge feed-badge--${row.importance}`;
    detailOverlay.querySelector("[data-detail-importance]").textContent = IMPORTANCE_LABEL[row.importance] || row.importance;
    detailOverlay.querySelector("[data-detail-title]").textContent = row.title;

    const metaParts = [row.region_label, formatDateDots(row.published_at)];
    if (row.kind === "benefit") {
      const period = periodLabel(row);
      if (period) metaParts.push(`기간 ${period}`);
    }
    detailOverlay.querySelector("[data-detail-meta]").textContent = metaParts.filter(Boolean).join(" · ");
    detailOverlay.querySelector("[data-detail-summary]").textContent = row.summary;

    const tipEl = detailOverlay.querySelector("[data-detail-action-tip]");
    if (row.action_tip) {
      tipEl.textContent = `👉 ${row.action_tip}`;
      tipEl.hidden = false;
    } else {
      tipEl.hidden = true;
    }

    detailOverlay.querySelector("[data-detail-source-name]").textContent = `출처: ${row.source_name}`;
    detailOverlay.querySelector("[data-detail-checked]").textContent = row.last_checked_at ? `최종 확인일 ${formatDateDots(row.last_checked_at)}` : "";
    detailOverlay.querySelector("[data-detail-disclaimer]").hidden = row.kind !== "safety"; // 요청 6번: 안전 소식에만 항상 보여준다

    detailOverlay.hidden = false;
  }

  function closeDetail() {
    if (detailOverlay) detailOverlay.hidden = true;
  }

  // ==========================================================================
  // '어디로 떠나볼까요?' — 추천 도시 (get_discover_cities, 027_discover_cities.sql)
  // ==========================================================================
  // 여행 소식 섹션과 같은 자리(mainPage.js, trips.length가 있을 때만)에 이어서 그린다. 이번 버전은 탭도
  // 해외/국내 구분도 없다(요청 1번) - get_discover_cities(20)이 이미 나라당 상한까지 적용해 섞어서 돌려준다.
  // 기존 인기 여행지(popular_destinations)·클릭 시 바로 여행 만들기는 전부 제거했다 - 카드를 누르면
  // #/discover-city/:id로 이동만 하고, 그 화면도 여행을 만들지 않는 순수 정보 화면이다(요청 5번).

  const GRADIENT_COUNT = 6; // style.css의 --dest-gradient-1..6
  const DISCOVER_CACHE_MS = 30 * 60 * 1000; // 요청 7번: 같은 세션에서 30분 안엔 다시 안 부른다
  const DISCOVER_SKELETON_COUNT = 6;
  let discoverSectionEl = null;
  let discoverGen = 0;
  let discoverCache = null; // { data, fetchedAt } | null - 20개짜리 결과 하나뿐이라 Map이 아니라 단일 캐시

  async function fetchDiscoverCities() {
    if (discoverCache && Date.now() - discoverCache.fetchedAt < DISCOVER_CACHE_MS) return discoverCache.data;
    const { data, error } = await window.TripLog.supabase.rpc("get_discover_cities", { p_limit: 20 });
    if (error) throw error;
    const rows = data || [];
    discoverCache = { data: rows, fetchedAt: Date.now() };
    return rows;
  }

  // country_code(해외) 또는 name_ko(국내 - discover_cities엔 KR 도시도 섞여 있어 국가코드만으론 구분이 안
  // 된다)를 해시해서 --dest-gradient-1..6 중 하나를 고른다 - 이미지가 없는 도시의 대체 카드용(요청 3번).
  // 결정적이라 같은 도시는 항상 같은 색이다.
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function gradientIndexFor(countryCode, nameKo) {
    const key = countryCode === "KR" ? nameKo : countryCode;
    return (hashString(key || nameKo || "") % GRADIENT_COUNT) + 1;
  }

  // 날씨 캐시가 있을 때만 "☀️ 18°" 형태로 - 캐시가 없으면(city_weather_cache 미확보 또는 24시간 지나 숨겨짐,
  // 029_discover_cities_weather_freshness.sql) 빈 문자열이라 메타 줄에서 조용히 빠진다(요청 3번).
  function discoverWeatherText(tempC, weatherCode) {
    if (typeof tempC !== "number" || typeof weatherCode !== "number") return "";
    const { icon } = weatherCodes ? weatherCodes.weatherLabel(weatherCode) : { icon: "" };
    return `${icon} ${Math.round(tempC)}°`;
  }

  function discoverCardMediaHtml(row, initial) {
    const overlay = `
      <span class="discover-card-overlay">
        ${row.reason_tag ? `<span class="discover-card-tag">${escapeHtml(row.reason_tag)}</span>` : ""}
        <span class="discover-card-name">${escapeHtml(row.name_ko)}</span>
        <span class="discover-card-meta">${[escapeHtml(row.country_name_ko || row.country_code || ""), escapeHtml(discoverWeatherText(row.temp_c, row.weather_code))]
          .filter(Boolean)
          .join(" · ")}</span>
      </span>`;
    const img = row.thumb_url || row.image_url;
    if (img) {
      return `
        <span class="discover-card-media">
          <img class="discover-card-image" src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" />
          ${overlay}
        </span>`;
    }
    // 이미지가 없는 도시는 추천 목록에서 빼지 않고 그라데이션 대체 카드로 보여준다(요청 3번)
    return `
      <span class="discover-card-media discover-card-media--fallback" style="background: var(--dest-gradient-${gradientIndexFor(row.country_code, row.name_ko)})">
        <span class="discover-card-initial" aria-hidden="true">${escapeHtml(initial)}</span>
        ${overlay}
      </span>`;
  }

  function discoverCardHtml(row) {
    const initial = (row.name_ko || "").slice(0, 1);
    return `
      <li class="discover-card-wrap">
        <button type="button" class="discover-card" data-id="${escapeHtml(row.city_id)}">
          ${discoverCardMediaHtml(row, initial)}
        </button>
      </li>`;
  }

  function discoverSkeletonHtml() {
    return Array.from({ length: DISCOVER_SKELETON_COUNT })
      .map(() => '<li class="discover-card-wrap"><div class="discover-card-skeleton"></div></li>')
      .join("");
  }

  function discoverSectionHtml() {
    return `
      <section class="main-popular" aria-label="어디로 떠나볼까요" data-alias="MAIN-POPULAR · 어디로 떠나볼까요" hidden>
        <div class="main-trips-head">
          <h2 class="main-section-title">어디로 떠나볼까요?</h2>
        </div>
        <p class="main-section-subtitle">지금 가기 좋은 도시</p>
        <ul class="discover-card-row" data-discover-body></ul>
      </section>`;
  }

  // mainPage.js가 여행 소식 섹션 다음에 바로 이어서 끼워 넣은 뒤 부른다 - 여기도 매번 새 DOM이라(마찬가지로
  // mainPage.js의 el.innerHTML 교체로 이전 섹션이 통째로 사라진다) 리스너 중복 걱정 없이 그냥 새로 건다.
  function initDiscoverSection(sectionEl) {
    if (!sectionEl) return;
    discoverSectionEl = sectionEl;
    sectionEl.addEventListener("click", handleDiscoverClick);
    refreshDiscoverSection();
  }

  function handleDiscoverClick(e) {
    const card = e.target.closest(".discover-card[data-id]");
    if (card) router.navigate(router.buildPath("discover-city", { id: card.dataset.id }));
  }

  // 요청 6번: 데이터가 없어도, 네트워크/서버 에러여도 영역 전체를 조용히 숨긴다 - 기존 인기 여행지와 달리
  // 이번엔 "빈 상태"와 "에러"를 구분하지 않는다(에러 문구로 화면을 채우지 않는다). 다른 영역(여행 소식 등)은
  // 완전히 독립된 자기 섹션이라 영향이 없다.
  async function refreshDiscoverSection() {
    const sectionEl = discoverSectionEl;
    const bodyEl = sectionEl?.querySelector("[data-discover-body]");
    if (!sectionEl || !bodyEl) return;
    const myGen = ++discoverGen;
    if (!discoverCache) {
      sectionEl.hidden = false; // 캐시가 없어 실제로 기다려야 할 때만 스켈레톤을 보여준다(요청 6번)
      bodyEl.innerHTML = discoverSkeletonHtml();
    }
    try {
      const rows = await fetchDiscoverCities();
      if (discoverGen !== myGen || discoverSectionEl !== sectionEl) return;
      if (!rows.length) {
        sectionEl.hidden = true;
        return;
      }
      bodyEl.innerHTML = rows.map(discoverCardHtml).join("");
      sectionEl.hidden = false;
    } catch (err) {
      if (discoverGen !== myGen || discoverSectionEl !== sectionEl) return;
      console.error("[travelFeed] 어디로 떠나볼까요 조회 실패", err); // 화면은 조용히 숨긴다(요청 6번) - 원인은 콘솔에만
      sectionEl.hidden = true;
    }
  }

  // ==========================================================================
  // 도시 정보 화면 (#/discover-city/:id, 카드를 누르면 온다) - get_city_detail 하나로 데이터를 받아
  // 섹션 단위 함수로 나눠 그린다(요청 7번) - 대표 관광지 상세, 일정 담기, 주변 추천 같은 기능이 나중에
  // 이 섹션들 옆에 붙을 수 있게, 각 섹션은 row 하나만 받아 자기 블록만 그리는 순수 함수다. 지금은 하단
  // 고정 CTA("이 도시로 여행 만들기")만 실제 동작(여행 만들기 마법사 진입)이 있고, 대표 관광지는 목록만
  // 보여줄 뿐 클릭 동작이 없다(요청 4번).
  // ==========================================================================

  let discoverDetailPageEl = null;
  let discoverDetailGen = 0;
  let discoverDetailRow = null; // get_city_detail 결과 - CTA 클릭 핸들러가 다시 쓴다
  let discoverCtaState = "idle"; // "idle" | "resolving" | "error" (요청 5번: 확정 실패 시 재시도)

  function discoverDetailHeaderHtml(title) {
    const { ICONS } = window.TripLog.commonPages;
    return `
      <header class="simple-page-header">
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="back" aria-label="뒤로">${ICONS.back}</button>
        <h1 class="simple-page-title">${escapeHtml(title)}</h1>
      </header>`;
  }

  // ---- 섹션: 상단(대표 이미지 + 도시명은 헤더, 나라명 + 한 줄 소개는 여기) (요청 2번) ----

  function discoverHeroSectionHtml(row) {
    const images = Array.isArray(row.images) ? row.images : [];
    const hero = images[0];
    const heroHtml = hero
      ? `<div class="discover-detail-hero"><img src="${escapeHtml(hero.imageUrl)}" alt="" loading="lazy" decoding="async" /></div>`
      : `<div class="discover-detail-hero discover-detail-hero--fallback" style="background: var(--dest-gradient-${gradientIndexFor(row.country_code, row.name_ko)})">
           <span class="discover-card-initial" aria-hidden="true">${escapeHtml((row.name_ko || "").slice(0, 1))}</span>
         </div>`;
    const metaParts = [escapeHtml(row.country_name_ko || row.country_code || ""), row.tagline ? escapeHtml(row.tagline) : ""].filter(Boolean);
    return `
      ${heroHtml}
      <p class="discover-detail-meta">${metaParts.join(" · ")}</p>`;
  }

  // ---- 섹션: 지금 가기 좋은 이유 (이번 달 reason_tag/reason_text + 날씨 캐시가 있을 때만) (요청 3번) ----

  function discoverWeatherLineHtml(tempC, weatherCode) {
    if (typeof tempC !== "number" || typeof weatherCode !== "number") return "";
    const { icon, label } = weatherCodes ? weatherCodes.weatherLabel(weatherCode) : { icon: "", label: "" };
    return `<p class="discover-detail-weather">${icon} ${Math.round(tempC)}° · ${escapeHtml(label)}</p>`;
  }

  function discoverReasonSectionHtml(row) {
    const weatherHtml = discoverWeatherLineHtml(row.temp_c, row.weather_code);
    // 이번 달에 추천 이유가 없고(비추천 달) 날씨 캐시도 없으면 보여줄 내용이 없다 - 섹션 자체를 숨긴다.
    if (!row.reason_tag && !row.reason_text && !weatherHtml) return "";
    return `
      <section class="discover-detail-section" data-section="reason">
        <h2 class="discover-detail-section-title">지금 가기 좋은 이유</h2>
        ${row.reason_tag ? `<span class="discover-detail-tag">${escapeHtml(row.reason_tag)}</span>` : ""}
        ${row.reason_text ? `<p class="discover-detail-reason-text">${escapeHtml(row.reason_text)}</p>` : ""}
        ${weatherHtml}
      </section>`;
  }

  // ---- 섹션: 대표 관광지 (city_highlights 순서대로, 클릭 동작 없음 - 데이터 없으면 섹션 자체를 숨긴다) (요청 4번) ----

  function discoverHighlightsSectionHtml(row) {
    const highlights = Array.isArray(row.highlights) ? row.highlights : [];
    if (highlights.length === 0) return "";
    return `
      <section class="discover-detail-section" data-section="highlights">
        <h2 class="discover-detail-section-title">대표 관광지</h2>
        <ul class="discover-detail-highlights">
          ${highlights
            .map(
              (h) => `
            <li class="discover-detail-highlight">
              <p class="discover-detail-highlight-name">${escapeHtml(h.nameKo)}</p>
              ${h.summary ? `<p class="discover-detail-highlight-summary">${escapeHtml(h.summary)}</p>` : ""}
            </li>`
            )
            .join("")}
        </ul>
      </section>`;
  }

  // ---- 섹션: 사진 저작자 표기 (요청 6번, "메인 화면 개선" 때 확인한 라이선스 조건 그대로) ----

  function discoverCreditSectionHtml(row) {
    const image = (Array.isArray(row.images) ? row.images : [])[0];
    if (!image) return "";
    // creditUrl이 있으면 저작자 이름도 그 프로필로 링크한다(Unsplash처럼 "저작자 이름을 프로필에 링크"를
    // 요구하는 라이선스가 있어서 - 없으면 평문, 기존 Wikimedia/Pexels 표시와 동일하게 동작한다).
    const creditNameHtml = image.creditUrl
      ? `<a href="${escapeHtml(image.creditUrl)}" target="_blank" rel="noopener">${escapeHtml(image.creditName)}</a>`
      : escapeHtml(image.creditName);
    return `
      <p class="discover-detail-credit">
        사진: ${creditNameHtml} · ${escapeHtml(image.license)} ·
        <a href="${escapeHtml(image.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(image.sourceName)} 원본 보기</a>
      </p>`;
  }

  // ---- 하단 고정 CTA: "이 도시로 여행 만들기" (요청 5번) ----
  // 누르면 search-destination의 select 액션(PRD v12 도시 확정)을 이 화면에서 먼저 직접 호출해 좌표·시간대를
  // 확정한다 - tripSetup.js의 preset 자동 확정에 맡기지 않는 이유는, 그 쪽은 실패해도 조용히 1단계에 머무를
  // 뿐이라 "실패하면 재시도 버튼을 보여주고 넘기지 않는다"는 지시를 지킬 수 없기 때문이다. 여기서 먼저
  // 성공을 확인한 뒤에만 tripSetup.open()을 연다 - destinations 행이 이미 확정돼 있으니 tripSetup이 내부에서
  // 다시 resolveCity를 불러도 search-destination이 외부 API 호출 없이 바로 반환한다(헛된 중복 호출이 아니다).

  function discoverCtaHtml() {
    if (discoverCtaState === "error") {
      return `
        <p class="form-error">도시 정보를 불러오지 못했어요. 다시 시도해 주세요</p>
        <button type="button" class="btn btn-save btn-block" data-action="create-trip">다시 시도</button>`;
    }
    const resolving = discoverCtaState === "resolving";
    return `<button type="button" class="btn btn-save btn-block" data-action="create-trip"${resolving ? " disabled" : ""}>${
      resolving ? "확인하는 중..." : "이 도시로 여행 만들기"
    }</button>`;
  }

  function renderDiscoverCta() {
    const ctaEl = discoverDetailPageEl?.querySelector("[data-discover-cta]");
    if (ctaEl) ctaEl.innerHTML = discoverCtaHtml();
  }

  function openTripSetupForCity(row) {
    tripSetup.open({
      trip: null,
      canClose: true,
      preset: { destinationId: row.destination_id },
      onComplete: async ({ cityId, cityName, destination, destinationId, timezone, lat, lng, currency, startDate, endDate }) => {
        try {
          await storage.createTrip({ title: `${cityName} 여행`, destination, cityId, destinationId, timezone, lat, lng, currency, startDate, endDate });
        } catch (err) {
          ui.showToast(err.message);
          return;
        }
        router.navigate(router.buildPath("main"));
        ui.showToast(`'${cityName} 여행'을 만들었어요.`);
      },
    });
  }

  async function handleCreateTripClick() {
    const row = discoverDetailRow;
    if (!row || discoverCtaState === "resolving") return;
    discoverCtaState = "resolving";
    renderDiscoverCta();
    try {
      const { data, error } = await window.TripLog.supabase.functions.invoke("search-destination", {
        body: { action: "select", destinationId: row.destination_id },
      });
      if (row !== discoverDetailRow) return; // 그사이 다른 도시 화면으로 넘어갔다 - 이 응답은 버린다
      if (error || data?.error || !data?.result) throw new Error(data?.error || error?.message || "resolve_failed");
      discoverCtaState = "idle";
      renderDiscoverCta();
      openTripSetupForCity(row);
    } catch (err) {
      if (row !== discoverDetailRow) return;
      console.error("[travelFeed] 도시 확정 실패", err);
      discoverCtaState = "error";
      renderDiscoverCta();
    }
  }

  // ---- 화면 조립 ----

  async function renderDiscoverDetail(el, { params }) {
    discoverDetailPageEl = el;
    discoverDetailRow = null;
    discoverCtaState = "idle";
    const myGen = ++discoverDetailGen;
    el.innerHTML = `${discoverDetailHeaderHtml("도시 정보")}<p class="simple-page-empty">불러오는 중...</p>`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="back"]')) return history.back();
        if (e.target.closest('[data-action="create-trip"]')) handleCreateTripClick();
      });
    }

    try {
      const { data, error } = await window.TripLog.supabase.rpc("get_city_detail", { p_city_id: params.id });
      if (discoverDetailGen !== myGen || discoverDetailPageEl !== el) return;
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        el.innerHTML = `${discoverDetailHeaderHtml("도시 정보")}<p class="simple-page-empty">도시 정보를 찾을 수 없어요.</p>`;
        return;
      }

      discoverDetailRow = row;
      el.innerHTML = `
        ${discoverDetailHeaderHtml(row.name_ko)}
        <div class="discover-detail-body">
          ${discoverHeroSectionHtml(row)}
          ${discoverReasonSectionHtml(row)}
          ${discoverHighlightsSectionHtml(row)}
          ${discoverCreditSectionHtml(row)}
        </div>
        <div class="discover-detail-cta" data-discover-cta>${discoverCtaHtml()}</div>`;
    } catch (err) {
      if (discoverDetailGen !== myGen || discoverDetailPageEl !== el) return;
      console.error("[travelFeed] 도시 정보 조회 실패", err);
      el.innerHTML = `${discoverDetailHeaderHtml("도시 정보")}<p class="simple-page-empty">정보를 불러오지 못했어요.</p>`;
    }
  }

  router.definePage("discover-city", renderDiscoverDetail);
  router.onEnter("discover-city", () => document.body.classList.add("has-simple-page-bg"));
  router.onLeave("discover-city", () => document.body.classList.remove("has-simple-page-bg"));

  window.TripLog = window.TripLog || {};
  window.TripLog.travelFeed = { mainSectionHtml, initMainSection, discoverSectionHtml, initDiscoverSection };
})();
