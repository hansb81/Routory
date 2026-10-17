// @별칭 TRIP-SETUP · 여행 만들기·설정 마법사 (여행지 → 날짜)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행 정보 설정 2단계 위저드: 1단계 여행지 선택 → 2단계 날짜(달력) 선택.
// 저장은 하지 않고, 완료 시 onComplete({ cityId, cityName, destination, destinationId, timezone, lat, lng, currency, startDate, endDate })를 호출한다.
//
// 여행지 탭(PRD v12, 2단 구조로 되돌림): 1차 해외/국내(해외가 먼저) + 해외를 고르면 2차로 10개 지역
// (destinations.js의 OVERSEAS_GROUPS, Supabase destinations 테이블에서 불러옴). 해외 도시를 고르면(국내는
// 그대로 즉시 선택) search-destination의 select 액션을 호출해서 좌표·시간대를 확정한다 - 이미 확정된
// 프리셋(016_destinations_preset_coords.sql 실행 후 전부)은 그 함수가 외부 API 없이 바로 돌려준다.
//
// 자유 검색(검색창에 입력하면 탭 대신 결과 목록): 국내+이미 불러온 해외 프리셋을 먼저 로컬로 찾아 바로
// 보여주고(네트워크 없음 - "국내는 국내 탭 데이터를 우선 쓴다"는 지시를 이걸로 만족한다), 300ms
// 디바운스 후 search-destination의 search 액션으로 보완한다(IME 조합 중에는 안 부름). 같은 검색어는
// 세션 안에서 캐시해서 다시 안 부른다. 어느 쪽 결과를 고르든(국내는 즉시, 그 외엔 resolveCity/
// resolveSearchResult) 같은 cityResolveState/resolveGen으로 "확인 중/실패" 표시와 오래된 응답 무시를
// 공유한다.

(function () {
  const { REGIONS, OVERSEAS_GROUPS, getCities, getCityById, fetchCityImage, loadPresets, isPresetsLoaded, getPresetLoadError, retryLoadPresets } =
    window.TripLog.destinations;

  const { escapeHtml } = window.TripLog.util;
  const calendar = window.TripLog.calendar;
  const supabase = window.TripLog.supabase;
  const ui = window.TripLog.ui;

  const els = {
    overlay: document.getElementById("trip-modal-overlay"),
    stepLabel: document.getElementById("trip-step-label"),
    title: document.getElementById("trip-modal-title"),
    back: document.getElementById("trip-back"),
    close: document.getElementById("trip-btn-cancel"),
    step1: document.getElementById("trip-step-1"),
    step2: document.getElementById("trip-step-2"),
    searchInput: document.getElementById("city-search"),
    regionTabs: document.getElementById("region-tabs"),
    groupTabs: document.getElementById("group-tabs"),
    cityList: document.getElementById("city-list"),
    calendar: document.getElementById("calendar"),
    calendarHint: document.getElementById("calendar-hint"),
    footer: document.getElementById("trip-footer"),
    confirmBtn: document.getElementById("trip-confirm-btn"),
  };

  const state = {
    step: 1,
    regionId: "overseas", // 1차 탭(해외/국내) - 기존처럼 해외가 기본
    groupId: "japan", // 2차 탭(해외일 때만) - 가장 많이 쓰는 지역을 기본으로
    query: "",
    cityId: null, // 국내 도시의 id, 또는 확정된 해외 도시의 destinations.id
    resolvedCity: null, // search-destination select 결과 (해외 도시를 골랐을 때만 채워짐) - 완료 페이로드의 출처
    resolvedKey: null, // 지금 선택된 항목의 안정적인 키(목록 재조립 후에도 "선택됨" 표시를 유지하는 용도) - resultKeyFor 참고
    startDate: null,
    endDate: null,
    viewYear: 0,
    viewMonth: 0,
    canClose: false,
    onComplete: null,
  };

  // 도시 하나를 확정(resolve)하는 중/실패 상태 (탭 선택·검색 선택 공용). 한 번에 하나만 - { id, status: 'loading'|'error' } | null
  let cityResolveState = null;
  let resolveGen = 0;

  // 자유 검색 상태
  const searchCache = new Map(); // 세션 안에서 같은 검색어를 다시 안 부르기 위한 캐시. key: 정규화된 검색어 → { status: 'loading'|'done', results }
  let searchDebounceTimer = null;
  let isComposing = false; // 한글 IME 조합 중이면 true - 조합이 끝나기 전엔 검색을 보내지 않는다
  let currentSearchEntries = []; // 방금 그린 검색 결과 목록 (클릭 시 data-select-result로 다시 찾기 위해 들고 있는다)

  // ---- 날짜 유틸 ----

  function formatKey(key) {
    return key.replaceAll("-", ".");
  }

  // ---- 열기/닫기 ----

  // preset(mainPage.js의 '어디로 떠나볼까요' 카드 등 외부에서 여행지를 미리 정해 주는 경우):
  //   { destinationId } - destinations.id가 있으면 resolveCity와 같은 경로로 바로 확정하고 2단계(날짜)로 건너뛴다.
  //   { query } - destinations.id가 없으면(관리자가 이름만 저장한 인기 여행지 등) 검색창에 그 이름을 채워
  //     넣고 검색 결과만 띄운다 - 동명이인 도시가 있을 수 있어 최종 선택은 사용자가 한다(요청 4번).
  function open({ trip, canClose, onComplete, preset }) {
    state.onComplete = onComplete;
    state.canClose = canClose;
    state.step = 1;
    state.regionId = "overseas";
    state.groupId = "japan";
    state.query = "";
    els.searchInput.value = "";
    state.cityId = null;
    state.resolvedCity = null;
    state.resolvedKey = null;
    cityResolveState = null;
    clearTimeout(searchDebounceTimer);
    isComposing = false;
    state.startDate = trip?.startDate ?? null;
    state.endDate = trip?.endDate && trip.endDate !== trip.startDate ? trip.endDate : null;

    const city = trip?.cityId ? getCityById(trip.cityId) : null;
    if (city) {
      state.cityId = city.id;
      if (city.region === "domestic") {
        state.regionId = "domestic";
      } else {
        state.regionId = "overseas";
        state.groupId = city.region;
      }
    }

    const anchor = state.startDate ? new Date(`${state.startDate}T00:00:00`) : new Date();
    state.viewYear = anchor.getFullYear();
    state.viewMonth = anchor.getMonth();

    els.overlay.hidden = false;
    render();

    // 탭을 아직 안 눌러도 바로 쓸 수 있게 미리 불러온다 (실패해도 여기서는 조용히 넘어가고, 그 탭을 눌렀을 때 재시도 버튼으로 안내한다)
    loadPresets().finally(() => {
      if (!els.overlay.hidden && state.step === 1) render();
    });

    if (preset?.destinationId) {
      resolveCity({ id: preset.destinationId }, { autoAdvance: true });
    } else if (preset?.query) {
      state.query = preset.query;
      els.searchInput.value = preset.query;
      render();
      scheduleSearch(preset.query);
    }
  }

  function close() {
    els.overlay.hidden = true;
  }

  // ---- 렌더링 ----

  function render() {
    const isStep1 = state.step === 1;
    els.step1.hidden = !isStep1;
    els.step2.hidden = isStep1;
    els.back.hidden = isStep1;
    els.close.hidden = !state.canClose;

    if (isStep1) {
      els.stepLabel.textContent = "1단계 · 여행지 입력";
      els.title.textContent = "어디로 떠나시나요?";
      renderRegionTabs();
      renderGroupTabs();
      renderCityList();
    } else {
      const label = selectedCityLabel();
      els.stepLabel.textContent = "2단계 · 날짜 입력";
      els.title.textContent = `${label?.name ?? ""}, 언제 떠나시나요?`;
      renderCalendar();
    }
    renderFooter();
  }

  function tabHtml(id, label, activeId, kind) {
    const active = id === activeId;
    return `<button type="button" class="tab${active ? " tab--active" : ""}" role="tab"
      aria-selected="${active}" data-${kind}="${id}">${label}</button>`;
  }

  // 검색 중에는 지역 탭과 무관하게 전체에서 찾으므로 탭을 숨긴다 (지시 1번: 입력값이 있으면 탭 대신 결과를)
  function isSearching() {
    return state.query.trim() !== "";
  }

  // 1차 탭: 해외/국내 (기존처럼 - 해외가 먼저)
  function renderRegionTabs() {
    els.regionTabs.hidden = isSearching();
    if (isSearching()) return;
    els.regionTabs.innerHTML = REGIONS.map((r) => tabHtml(r.id, r.label, state.regionId, "region")).join("");
  }

  // 2차 탭: 해외를 골랐을 때만 보이는 지역 그룹(일본/동남아/.../남미) - 10개라 가로 스크롤
  function renderGroupTabs() {
    const show = state.regionId === "overseas" && !isSearching();
    els.groupTabs.hidden = !show;
    if (!show) return;
    els.groupTabs.innerHTML = OVERSEAS_GROUPS.map((g) => tabHtml(g.id, g.label, state.groupId, "group")).join("");
    // 선택된 탭이 가로 스크롤 영역 밖에 있으면 보이는 곳으로 스크롤 (터치/마우스 모두 scrollIntoView면 충분)
    const activeTab = els.groupTabs.querySelector(".tab--active");
    activeTab?.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // 선택된 도시의 표시 이름/나라 - 국내면 state.cityId로, 그 외엔 확정된 resolvedCity로
  function selectedCityLabel() {
    if (state.resolvedCity) return { name: state.resolvedCity.name_ko, country: state.resolvedCity.country_name_ko };
    const city = state.cityId ? getCityById(state.cityId) : null;
    return city ? { name: city.name, country: city.country } : null;
  }

  function skeletonListHtml() {
    return Array.from(
      { length: 5 },
      () => `
        <li class="pick-item pick-item--skeleton" aria-hidden="true">
          <div class="pick-thumb pick-skeleton-block"></div>
          <div class="pick-info">
            <span class="pick-skeleton-line pick-skeleton-line--name"></span>
            <span class="pick-skeleton-line pick-skeleton-line--sub"></span>
          </div>
        </li>`
    ).join("");
  }

  function loadErrorHtml() {
    return `
      <li class="pick-empty pick-empty--error">
        <p class="empty-desc">${escapeHtml(getPresetLoadError() ?? "여행지 목록을 불러오지 못했어요.")}</p>
        <button type="button" class="btn btn-save" data-action="retry-destinations">다시 불러오기</button>
      </li>`;
  }

  function cityRowHtml(city) {
    const resolving = cityResolveState?.id === city.id && cityResolveState.status === "loading";
    const errored = cityResolveState?.id === city.id && cityResolveState.status === "error";

    if (errored) {
      return `
        <li class="pick-item pick-item--error" data-city-id="${city.id}">
          <div class="pick-thumb" aria-hidden="true">📍</div>
          <div class="pick-info">
            <span class="pick-name">${escapeHtml(city.name)}</span>
            <span class="pick-sub pick-sub--error">도시 정보를 불러오지 못했어요. 다시 시도해 주세요</span>
          </div>
          <button type="button" class="btn btn-cancel" data-retry-city="${city.id}">다시 시도</button>
        </li>`;
    }

    const selected = !resolving && (city.isDbPreset ? state.resolvedKey === city.id : state.cityId === city.id);

    return `
      <li class="pick-item${selected ? " pick-item--selected" : ""}" data-city-id="${city.id}">
        <div class="pick-thumb" aria-hidden="true">📍</div>
        <div class="pick-info">
          <span class="pick-name">${escapeHtml(city.name)}</span>
          <span class="pick-sub">${escapeHtml(city.country)}</span>
        </div>
        <button type="button" class="pick-btn${selected ? " pick-btn--selected" : ""}"
          data-select-city="${city.id}" aria-pressed="${selected}" ${resolving ? "disabled" : ""}>${
      resolving ? "확인 중…" : selected ? "선택됨" : "선택"
    }</button>
      </li>`;
  }

  function renderCityList() {
    if (isSearching()) {
      renderSearchResults();
      return;
    }

    if (state.regionId === "domestic") {
      renderCityRows(getCities("domestic"), "");
      return;
    }

    if (!isPresetsLoaded()) {
      els.cityList.innerHTML = getPresetLoadError() ? loadErrorHtml() : skeletonListHtml();
      return;
    }

    renderCityRows(getCities("overseas", state.groupId), "이 지역의 여행지를 찾을 수 없습니다.");
  }

  function renderCityRows(cities, emptyText) {
    if (cities.length === 0) {
      els.cityList.innerHTML = `<li class="pick-empty">${emptyText}</li>`;
      return;
    }

    els.cityList.innerHTML = cities.map(cityRowHtml).join("");

    // 대표 이미지(위키백과 썸네일) - city.wiki가 있는 도시만. 국내는 고정 제목, 해외 프리셋은 name_en으로
    // 추정한 제목이라 가끔 못 찾을 수 있다(destinations.js 참고) - 그러면 핀 아이콘 그대로 둔다.
    cities
      .filter((city) => city.wiki)
      .forEach((city) => {
        const thumb = els.cityList.querySelector(`[data-city-id="${city.id}"] .pick-thumb`);
        if (!thumb) return;
        fetchCityImage(city).then((url) => {
          if (!url || !thumb.isConnected) return;
          thumb.textContent = "";
          const img = document.createElement("img");
          img.alt = "";
          img.src = url;
          thumb.appendChild(img);
        });
      });
  }

  // ---- 자유 검색 (search-destination action:'search') ----

  function normalizeQuery(q) {
    return q.trim().toLowerCase();
  }

  // 한글은 1자 이상, 그 외(영문 등)는 2자 이상 - search-destination의 서버쪽 검증과 같은 기준
  function hasEnoughLength(q) {
    return q.length >= (/[가-힣]/.test(q) ? 1 : 2);
  }

  // 국내(DOMESTIC_CITIES) + 이미 불러온 해외 프리셋 중 이름/나라가 검색어를 포함하는 것들 - 네트워크 호출
  // 없이 바로 보여준다. "국내 도시를 검색하면 국내 탭 데이터를 우선 쓴다"는 지시를, remote 결과 중 같은
  // 이름이 있으면 걸러내는 mergeSearchEntries와 함께 이걸로 만족한다.
  function localSearchEntries(query) {
    const normalize = (v) => (v ?? "").toLowerCase().replace(/[\s_]/g, "");
    const q = normalize(query);

    const domestic = getCities("domestic")
      .filter((c) => [c.name, c.country, c.wiki].some((v) => normalize(v).includes(q)))
      .map((c) => ({
        kind: "domestic",
        legacyId: c.id,
        id: null,
        place_id: null,
        name_ko: c.name,
        name_en: c.wiki ? c.wiki.replace(/_/g, " ") : c.name,
        country_code: null,
        country_name_ko: c.country,
        is_preset: true,
      }));

    const overseasPresets = OVERSEAS_GROUPS.flatMap((g) => getCities("overseas", g.id))
      .filter((c) => [c.name, c.nameEn, c.country].some((v) => normalize(v).includes(q)))
      .map((c) => ({
        kind: "local-preset",
        legacyId: c.id,
        id: c.id,
        place_id: null,
        name_ko: c.name,
        name_en: c.nameEn,
        country_code: null,
        country_name_ko: c.country,
        is_preset: true,
      }));

    return [...domestic, ...overseasPresets];
  }

  // 같은 도시인지 느슨하게(한글 이름+나라명) 비교 - 로컬 항목엔 국가코드가 없는 것도 있어서
  function entryDedupeKey(entry) {
    return `${(entry.name_ko || "").toLowerCase()}|${(entry.country_name_ko || "").toLowerCase()}`;
  }

  // 로컬(국내+이미 불러온 프리셋)을 먼저, 그다음 원격 결과 중 프리셋(추천)을, 마지막에 그 외 원격 결과를
  // - 지시 4번("프리셋 위, 외부 검색 결과 아래")을 로컬도 "추천" 줄로 보고 만족한다. 이미 로컬에 있는
  // 이름은 원격에도 나오더라도 다시 넣지 않는다(중복 방지).
  function mergeSearchEntries(local, remote) {
    const seen = new Set(local.map(entryDedupeKey));
    const remotePreset = [];
    const remoteOther = [];
    for (const r of remote) {
      const key = entryDedupeKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      (r.is_preset ? remotePreset : remoteOther).push({ ...r, kind: "remote" });
    }
    return [...local, ...remotePreset, ...remoteOther];
  }

  // 목록 재조립 후에도 "선택됨/확인 중/실패" 표시가 같은 항목을 계속 가리키게 할 안정적인 키.
  // 국내는 고유 코드(legacyId), 그 외엔 destinations.id(있으면) → place_id → "영문명|국가코드" 순.
  function resultKeyFor(entry) {
    if (entry.kind === "domestic") return `domestic:${entry.legacyId}`;
    return entry.id ?? entry.place_id ?? `${entry.name_en}|${entry.country_code ?? ""}`;
  }

  function searchRowHtml(entry) {
    const key = resultKeyFor(entry);
    const resolving = cityResolveState?.id === key && cityResolveState.status === "loading";
    const errored = cityResolveState?.id === key && cityResolveState.status === "error";

    if (errored) {
      return `
        <li class="pick-item pick-item--error" data-result-key="${escapeHtml(key)}">
          <div class="pick-thumb" aria-hidden="true">📍</div>
          <div class="pick-info">
            <span class="pick-name">${escapeHtml(entry.name_ko)}</span>
            <span class="pick-sub pick-sub--error">도시 정보를 불러오지 못했어요. 다시 시도해 주세요</span>
          </div>
          <button type="button" class="btn btn-cancel" data-retry-result="${escapeHtml(key)}">다시 시도</button>
        </li>`;
    }

    const selected = !resolving && (entry.kind === "domestic" ? state.cityId === entry.legacyId && !state.resolvedCity : state.resolvedKey === key);
    const subText = [entry.name_en, entry.country_name_ko].filter(Boolean).join(" · ");

    return `
      <li class="pick-item${selected ? " pick-item--selected" : ""}" data-result-key="${escapeHtml(key)}">
        <div class="pick-thumb" aria-hidden="true">📍</div>
        <div class="pick-info">
          <span class="pick-name">${escapeHtml(entry.name_ko)}${entry.is_preset ? ' <span class="pick-badge">추천</span>' : ""}</span>
          <span class="pick-sub">${escapeHtml(subText)}</span>
        </div>
        <button type="button" class="pick-btn${selected ? " pick-btn--selected" : ""}"
          data-select-result="${escapeHtml(key)}" aria-pressed="${selected}" ${resolving ? "disabled" : ""}>${
      resolving ? "확인 중…" : selected ? "선택됨" : "선택"
    }</button>
      </li>`;
  }

  function renderSearchResults() {
    const trimmed = state.query.trim();
    if (!hasEnoughLength(trimmed)) {
      els.cityList.innerHTML = `<li class="pick-empty">${/[가-힣]/.test(trimmed) ? "검색어를 입력해주세요." : "두 글자 이상 입력해주세요."}</li>`;
      currentSearchEntries = [];
      return;
    }

    const local = localSearchEntries(trimmed);
    const cacheEntry = searchCache.get(normalizeQuery(trimmed));
    const remote = cacheEntry?.status === "done" ? cacheEntry.results : [];
    const merged = mergeSearchEntries(local, remote);
    const stillLoading = !cacheEntry || cacheEntry.status === "loading";

    currentSearchEntries = merged;

    if (merged.length === 0) {
      els.cityList.innerHTML = stillLoading
        ? `<li class="pick-empty pick-empty--loading">검색하는 중이에요…</li>`
        : `<li class="pick-empty">"${escapeHtml(trimmed)}" 다른 이름으로 검색해 보세요.</li>`;
      return;
    }

    els.cityList.innerHTML = merged.map(searchRowHtml).join("") + (stillLoading ? `<li class="pick-search-more" aria-hidden="true">검색 중…</li>` : "");
  }

  function searchCacheKey(q) {
    return normalizeQuery(q);
  }

  function scheduleSearch(rawQuery) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => runSearch(rawQuery), 300);
  }

  // 같은(정규화한) 검색어는 세션 안에서 한 번만 부른다(지시 7번). 응답이 오기 전에 사용자가 다른 검색어로
  // 넘어가 있어도 캐시에는 그대로 반영하고(나중에 재사용 가능), 화면은 지금 보여주는 검색어와 같을 때만
  // 다시 그린다 - "오래된 응답이 새 응답을 덮어쓰지 않는다"는 지시 2번을 이렇게 만족한다(실제 네트워크
  // 취소는 아니지만, 화면에 영향이 없는 건 같다 - supabase-js의 functions.invoke는 외부에서 취소할 방법을
  // 제공하지 않는다).
  async function runSearch(rawQuery) {
    const trimmed = rawQuery.trim();
    if (!trimmed || !hasEnoughLength(trimmed)) return;

    const key = searchCacheKey(trimmed);
    if (searchCache.has(key)) {
      if (state.query.trim() === trimmed) render();
      return;
    }

    searchCache.set(key, { status: "loading", results: [] });
    if (state.query.trim() === trimmed) render();

    let degraded = false;
    try {
      const { data, error } = await supabase.functions.invoke("search-destination", { body: { q: trimmed, lang: "ko" } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      searchCache.set(key, { status: "done", results: Array.isArray(data.results) ? data.results : [] });
      degraded = !!data.degraded;
    } catch (err) {
      searchCache.set(key, { status: "done", results: [] }); // 실패해도 로컬(국내·프리셋) 결과는 그대로 보여준다
      degraded = true;
    }

    if (degraded) ui?.showToast?.("검색 연결이 불안정해요. 추천 도시만 보여드려요.");
    if (!els.overlay.hidden && state.step === 1 && state.query.trim() === trimmed) render();
  }

  function renderCalendar() {
    const { viewYear: year, viewMonth: month, startDate, endDate } = state;
    els.calendar.innerHTML = calendar.monthHtml({ year, month, start: startDate, end: endDate });

    if (!startDate) {
      els.calendarHint.textContent = "출발 날짜를 선택해주세요.";
    } else if (!endDate) {
      els.calendarHint.textContent = "돌아오는 날짜를 선택하세요. 선택하지 않으면 당일 일정으로 등록돼요.";
    } else {
      els.calendarHint.textContent = "다른 날짜를 누르면 처음부터 다시 선택할 수 있어요.";
    }
  }

  function renderFooter() {
    if (state.step === 1) {
      const label = selectedCityLabel();
      els.footer.hidden = !label;
      if (label) els.confirmBtn.textContent = `${label.name} 선택완료`;
      return;
    }

    els.footer.hidden = !state.startDate;
    if (!state.startDate) return;
    els.confirmBtn.textContent = state.endDate
      ? `${formatKey(state.startDate)} ~ ${formatKey(state.endDate)} 등록 완료`
      : `${formatKey(state.startDate)} 당일 일정 등록`;
  }

  // ---- 도시 확정 (search-destination select) - 탭 선택·검색 선택 공용 cityResolveState/resolveGen ----

  // autoAdvance: true면(mainPage.js의 '어디로 떠나볼까요' 카드처럼 destinationId가 이미 확실한 경우)
  // 확정되자마자 1단계를 건너뛰고 바로 날짜 선택(2단계)으로 넘어간다. 실패하면(네트워크 등) 그냥 1단계에
  // 머무른다 - 그 city가 지금 보이는 탭에 없을 수도 있어 에러 표시가 안 보일 수 있지만, 조용히 넘어가는
  // 선에서 그친다(이 모듈의 다른 실패 경로들과 같은 수준의 우아한 성능 저하).
  async function resolveCity(city, { autoAdvance = false } = {}) {
    const gen = ++resolveGen;
    state.cityId = null;
    state.resolvedCity = null;
    state.resolvedKey = null;
    cityResolveState = { id: city.id, status: "loading" };
    render();

    try {
      const { data, error } = await supabase.functions.invoke("search-destination", {
        body: { action: "select", destinationId: city.id },
      });
      if (gen !== resolveGen) return; // 그사이 다른 도시를 누름 - 이 응답은 버린다
      if (error || data?.error || !data?.result) throw new Error(data?.error || error?.message || "resolve_failed");

      cityResolveState = null;
      state.cityId = city.id;
      state.resolvedCity = data.result;
      state.resolvedKey = city.id;
      if (autoAdvance) state.step = 2;
      render();
    } catch (err) {
      if (gen !== resolveGen) return;
      cityResolveState = { id: city.id, status: "error" };
      render();
    }
  }

  // 검색 결과 하나를 select 액션으로 확정한다. destinations.id가 있으면(이미 프리셋/이전 사용자 도시) 그걸
  // 그대로 쓰고, 없으면 place_id(구글 쪽 결과) 또는 name_en+country_code(Open-Meteo 쪽 결과) 순으로 보낸다.
  async function resolveSearchResult(entry) {
    const key = resultKeyFor(entry);
    const gen = ++resolveGen;
    state.cityId = null;
    state.resolvedCity = null;
    state.resolvedKey = null;
    cityResolveState = { id: key, status: "loading" };
    render();

    const payload = entry.id
      ? { action: "select", destinationId: entry.id }
      : entry.place_id
      ? { action: "select", placeId: entry.place_id, nameKo: entry.name_ko, nameEn: entry.name_en, countryCode: entry.country_code ?? undefined }
      : { action: "select", nameEn: entry.name_en, countryCode: entry.country_code, nameKo: entry.name_ko };

    try {
      const { data, error } = await supabase.functions.invoke("search-destination", { body: payload });
      if (gen !== resolveGen) return;
      if (error || data?.error || !data?.result) throw new Error(data?.error || error?.message || "resolve_failed");

      cityResolveState = null;
      state.resolvedCity = data.result;
      state.resolvedKey = key;
      render();
    } catch (err) {
      if (gen !== resolveGen) return;
      cityResolveState = { id: key, status: "error" };
      render();
    }
  }

  // ---- 이벤트 ----

  // 한글 IME 조합 중(e.isComposing)엔 검색을 보내지 않는다(지시 3번) - compositionend가 끝난 뒤에 보낸다.
  els.searchInput.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  els.searchInput.addEventListener("compositionend", () => {
    isComposing = false;
    state.query = els.searchInput.value;
    render();
    scheduleSearch(state.query);
  });

  els.searchInput.addEventListener("input", (e) => {
    state.query = els.searchInput.value;
    render(); // 탭↔검색결과 전환, 로컬 매칭은 조합 중에도 바로 보여준다(입력을 지우면 탭으로 바로 돌아간다 - 지시 1번)
    if (e.isComposing || isComposing) return;
    if (!state.query.trim()) {
      clearTimeout(searchDebounceTimer);
      return;
    }
    scheduleSearch(state.query);
  });

  function pickDate(key) {
    const range = calendar.pickRange({ start: state.startDate, end: state.endDate }, key);
    state.startDate = range.start;
    state.endDate = range.end;
    render();
  }

  function goBack() {
    state.step = 1;
    render();
  }

  function confirm() {
    if (state.step === 1) {
      if (!selectedCityLabel()) return;
      state.step = 2;
      render();
      return;
    }

    if (!state.startDate) return;
    const payload = buildPayload();
    close();
    state.onComplete?.(payload);
  }

  function buildPayload() {
    const common = { startDate: state.startDate, endDate: state.endDate ?? state.startDate };
    if (state.resolvedCity) {
      const c = state.resolvedCity;
      return {
        ...common,
        cityId: null, // destinations.js(코드 상수)가 모르는 도시라서 비워 둔다 - 항공편·숙소 도시 추천만 못 받는다(tripImportPreview.js와 같은 규칙)
        cityName: c.name_ko,
        destination: `${c.name_ko}, ${c.country_name_ko}`,
        destinationId: c.id,
        timezone: c.timezone,
        lat: c.lat,
        lng: c.lng,
        currency: c.currency,
      };
    }
    const city = getCityById(state.cityId);
    return {
      ...common,
      cityId: city.id,
      cityName: city.name,
      destination: `${city.name}, ${city.country}`,
      destinationId: null,
      timezone: null,
      lat: null,
      lng: null,
      currency: null,
    };
  }

  els.regionTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-region]");
    if (!btn) return;
    state.regionId = btn.dataset.region;
    render();
  });

  els.groupTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group]");
    if (!btn) return;
    state.groupId = btn.dataset.group;
    render();
  });

  els.cityList.addEventListener("click", (e) => {
    if (cityResolveState?.status === "loading") return; // 확인 중에는 다른 선택을 막는다

    const retryCityBtn = e.target.closest("[data-retry-city]");
    if (retryCityBtn) {
      const city = getCityById(retryCityBtn.dataset.retryCity);
      if (city) resolveCity(city);
      return;
    }

    const retryResultBtn = e.target.closest("[data-retry-result]");
    if (retryResultBtn) {
      const entry = currentSearchEntries.find((en) => resultKeyFor(en) === retryResultBtn.dataset.retryResult);
      if (entry) resolveSearchResult(entry);
      return;
    }

    if (e.target.closest('[data-action="retry-destinations"]')) {
      retryLoadPresets().finally(() => render());
      render();
      return;
    }

    const tabBtn = e.target.closest("[data-select-city]");
    if (tabBtn) {
      const id = tabBtn.dataset.selectCity;
      const city = getCityById(id);
      if (!city) return;

      if (!city.isDbPreset) {
        // 국내: 기존 그대로 즉시 토글
        state.cityId = state.cityId === id ? null : id;
        state.resolvedCity = null;
        state.resolvedKey = null;
        render();
        return;
      }

      if (state.resolvedKey === id) {
        state.cityId = null;
        state.resolvedCity = null;
        state.resolvedKey = null;
        render();
        return;
      }
      resolveCity(city);
      return;
    }

    const resultBtn = e.target.closest("[data-select-result]");
    if (resultBtn) {
      const key = resultBtn.dataset.selectResult;
      const entry = currentSearchEntries.find((en) => resultKeyFor(en) === key);
      if (!entry) return;

      if (entry.kind === "domestic") {
        state.cityId = state.cityId === entry.legacyId ? null : entry.legacyId;
        state.resolvedCity = null;
        state.resolvedKey = null;
        render();
        return;
      }

      if (state.resolvedKey === key) {
        state.cityId = null;
        state.resolvedCity = null;
        state.resolvedKey = null;
        render();
        return;
      }
      resolveSearchResult(entry);
    }
  });

  els.calendar.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-cal-nav]");
    if (nav) {
      const next = calendar.shiftMonth({ year: state.viewYear, month: state.viewMonth }, Number(nav.dataset.calNav));
      state.viewYear = next.year;
      state.viewMonth = next.month;
      renderCalendar();
      return;
    }
    const day = e.target.closest("[data-date]");
    if (day) pickDate(day.dataset.date);
  });

  els.confirmBtn.addEventListener("click", confirm);
  els.back.addEventListener("click", goBack);
  els.close.addEventListener("click", () => {
    if (state.canClose) close();
  });

  window.TripLog = window.TripLog || {};
  window.TripLog.tripSetup = { open, close };
})();
