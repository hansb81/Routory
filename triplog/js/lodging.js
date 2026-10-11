// @별칭 LODGING · 숙소 추가 화면 (#/lodging/:id)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// SHELL의 하단 탭 "숙소"에서 들어오는 새 화면(모달 아님, budgetPage.js와 같은 구조 - 원래는 일정 화면의
// QUICK-MENU 버튼이었다). 첫 화면이 곧 "지도에서 찾기"(map)다 - 검색해서 지도에 표시된 숙소를 고르면
// 체크인/체크아웃 날짜 선택(dates)으로 넘어가 등록한다. 검색 전에는 지도에 아무 마커도 없다(예전엔 주변
// 인기 숙소를 미리 마커로 깔아 뒀지만 지금은 뺐다 - 검색해서 고른 숙소만 지도에 표시한다).
// ← 버튼은 이 화면 자체에는 없다 - SHELL(tripShell.js) 상단바의 홈 버튼이 이 화면에 있는 동안만 ←로
// 바뀌어 그 역할을 한다(goBackFromShell: dates면 map으로, map이면 일정 화면으로).
// 숙소 일정은 일반 일정과 같은 items 배열에 item.lodging 필드로 저장한다.
// item.lodging = { name, typeLabel, rating, ratingCount, placeId, checkIn, checkOut, nights }
// (예전에 저장된 숙소는 rating 대신 stars(호텔 등급)를 가질 수 있다)

(function () {
  const { getTripById, addItem } = window.TripLog.storage;
  const lodgingData = window.TripLog.lodgingData;
  const { findOnMap, getCenter, placeName } = lodgingData;
  const { escapeHtml, shortDate, nightsBetween } = window.TripLog.util;
  const calendar = window.TripLog.calendar;
  const gmaps = window.TripLog.googleMaps;
  const ui = window.TripLog.ui;
  const router = window.TripLog.router;

  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울 (여행지 좌표를 못 구했을 때의 기본값)
  const DEFAULT_ZOOM = 14;
  const PIN_ZOOM = 16;

  let currentEl = null;

  const state = {
    page: "map", // map | dates - 첫 화면이 map이다(예전 list 화면은 없앴다)
    tripId: null,
    picked: null,
    checkIn: null,
    checkOut: null,
    viewYear: 0,
    viewMonth: 0,
    results: { mapSearch: [] },
    requestId: 0,
  };

  // 지도에서 찾기 전용 상태 (지도 인스턴스는 화면을 다시 들어올 때마다 새로 만든다)
  const mapState = {
    loaded: false,
    loading: false,
    map: null,
    MarkerClass: null,
    center: null,
    markers: [], // 검색 결과 하나당 핀 하나: [{ item, marker }] (상단에 따로 목록을 두지 않고 지도 위 핀으로만 고른다)
    selectedItem: null,
    searchId: 0,
  };

  function qs(role) {
    return currentEl?.querySelector(`[data-role="${role}"]`);
  }

  // 키가 잘못됐거나 허용되지 않은 주소에서 지도를 열었을 때 구글이 알려준다 (한 번만 등록해 두면 된다)
  gmaps.onAuthFailure(() => {
    if (state.page === "map") {
      const el = qs("map-status");
      if (el) el.textContent = gmaps.errorMessage({ code: "AUTH_FAILED" });
    }
  });

  // ---- 유틸 ----

  // "★4.2 (6,184)": 구글 평점과 리뷰 수. 예전에 저장된 숙소(stars)는 "★5"로 보여준다.
  function ratingText(p) {
    if (p.rating) return `★${p.rating.toFixed(1)}${p.ratingCount ? ` (${p.ratingCount.toLocaleString()})` : ""}`;
    return p.stars ? `★${p.stars}` : "";
  }

  function tripRange(trip) {
    return { start: trip?.startDate, end: trip?.endDate || trip?.startDate };
  }

  // ---- 화면 전환 ----

  function goTo(page) {
    state.page = page;
    ["map", "dates"].forEach((name) => {
      const section = qs(`page-${name}`);
      if (section) section.hidden = name !== page;
    });
    render();
    if (page === "map") openMap();
  }

  // dates에서 map으로 되짚어간다.
  function goBack() {
    state.requestId += 1;
    goTo("map");
  }

  // SHELL(tripShell.js)의 상단바 ← 버튼이 이 화면에 있는 동안 호출한다(홈 버튼 대신 이 버튼이 뜬다) -
  // dates 화면이면 map으로 한 단계만 되짚어가고, map(첫 화면)이면 일정 화면으로 완전히 나간다.
  function goBackFromShell() {
    if (state.page === "dates") return goBack();
    if (state.tripId) router.navigate(router.buildPath("schedule", { id: state.tripId }));
  }

  function render() {
    const trip = getTripById(state.tripId);
    const footer = qs("footer");
    if (footer) footer.hidden = state.page !== "dates";

    if (state.page === "map") {
      // 지도 화면 자체 상태는 openMap()/renderMapConfirm()이 그린다
    } else {
      renderPicked();
      renderCalendar(trip);
      renderFooter();
    }
  }

  function pickLodging(item) {
    if (!item) return;
    const trip = getTripById(state.tripId);
    const { start } = tripRange(trip);
    const anchor = new Date(`${start}T00:00:00`);
    state.picked = item;
    state.checkIn = null;
    state.checkOut = null;
    state.viewYear = anchor.getFullYear();
    state.viewMonth = anchor.getMonth();
    goTo("dates");
  }

  // ---- 지도에서 찾기 ----

  const PIN_COLOR_SELECTED = "#007aff";
  const PIN_COLOR_RESULT = "#8cb4ff"; // 아직 고르지 않은 검색 결과 핀 (파스텔 블루)

  function pinIcon(color, scale) {
    return {
      path: window.google.maps.SymbolPath.CIRCLE,
      scale,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: scale > 7 ? 2 : 1,
    };
  }

  // 검색 결과 핀을 모두 지운다(다음 검색 전, 또는 검색어를 지웠을 때)
  function clearMarkers() {
    mapState.markers.forEach(({ marker }) => marker.setMap(null));
    mapState.markers = [];
    mapState.selectedItem = null;
  }

  function renderMapConfirm() {
    const bar = qs("map-confirm");
    const info = qs("map-confirm-info");
    const item = mapState.selectedItem;
    if (!bar || !info) return;
    bar.hidden = !item;
    if (!item) return;
    const meta = [item.typeLabel, ratingText(item), item.address].filter(Boolean).join(" · ");
    info.innerHTML = `<strong>🏨 ${escapeHtml(item.name)}</strong>` + (meta ? `<span>${escapeHtml(meta)}</span>` : "");
  }

  function updateAttribution() {
    const attribution = qs("map-attribution");
    if (attribution) attribution.hidden = state.results.mapSearch.length === 0;
  }

  // 검색 결과 핀 중 하나를 고른다: 그 핀만 강조 색으로 바꾸고(따로 마커를 더 만들지 않는다),
  // 아래 확인 바에 그 숙소 정보를 보여준다. 위에 별도 목록이 없으므로 이름/정보는 확인 바에서만 보인다.
  function selectMapItem(item) {
    mapState.selectedItem = item;
    mapState.markers.forEach(({ item: markerItem, marker }) => {
      marker.setIcon(pinIcon(markerItem === item ? PIN_COLOR_SELECTED : PIN_COLOR_RESULT, markerItem === item ? 9 : 6));
    });
    mapState.map.panTo({ lat: item.lat, lng: item.lng });
    if (mapState.map.getZoom() < PIN_ZOOM) mapState.map.setZoom(PIN_ZOOM);
    renderMapConfirm();
  }

  async function ensureMapLoaded() {
    if (mapState.loaded || mapState.loading) return mapState.loaded;
    mapState.loading = true;
    const statusEl = qs("map-status");
    if (statusEl) statusEl.textContent = "지도를 불러오는 중...";

    let center = null;
    try {
      center = await getCenter(getTripById(state.tripId));
    } catch (err) {
      console.warn("[lodging] 여행지 좌표 조회 실패", err);
    }
    if (state.page !== "map") {
      mapState.loading = false;
      return false;
    }
    center = center ?? DEFAULT_CENTER;
    mapState.center = center;

    try {
      const mapsApi = await gmaps.load();
      const { Map } = await mapsApi.importLibrary("maps");
      const { Marker } = await mapsApi.importLibrary("marker");
      if (state.page !== "map") {
        mapState.loading = false;
        return false;
      }
      mapState.MarkerClass = Marker;
      mapState.map = new Map(qs("map-el"), {
        center,
        zoom: DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
    } catch (err) {
      console.warn("[lodging] 지도를 불러오지 못했습니다.", err);
      if (statusEl && state.page === "map") statusEl.textContent = gmaps.errorMessage(err);
      mapState.loading = false;
      return false;
    }

    mapState.loaded = true;
    mapState.loading = false;
    if (statusEl) statusEl.textContent = "숙소를 검색해서 지도에 표시해보세요.";
    return true;
  }

  async function openMap() {
    state.results.mapSearch = [];
    clearMarkers();
    renderMapConfirm();
    updateAttribution();
    const mapSearchInput = qs("map-search-input");
    if (mapSearchInput) mapSearchInput.value = "";
    const statusEl = qs("map-status");
    if (statusEl) statusEl.textContent = "";

    const wasLoaded = mapState.loaded;
    const ok = await ensureMapLoaded();
    if (!ok || state.page !== "map") return;
    if (wasLoaded) {
      window.google.maps.event.trigger(mapState.map, "resize");
      mapState.map.setCenter(mapState.center);
    }
  }

  async function runMapSearch(query) {
    const trip = getTripById(state.tripId);
    const searchId = ++mapState.searchId;
    const statusEl = qs("map-status");
    if (statusEl) statusEl.textContent = "검색하는 중...";
    clearMarkers();
    renderMapConfirm();

    const center = mapState.map ? mapState.map.getCenter().toJSON() : mapState.center ?? DEFAULT_CENTER;
    const result = await findOnMap(center, placeName(trip), query);
    if (searchId !== mapState.searchId || state.page !== "map") return;

    if (result.status === "error") {
      state.results.mapSearch = [];
      if (statusEl) statusEl.textContent = result.message ?? "검색에 실패했어요. 잠시 후 다시 시도해주세요.";
    } else if (result.items.length === 0) {
      state.results.mapSearch = [];
      if (statusEl) statusEl.textContent = `"${query}"에 맞는 숙소나 주소를 찾지 못했어요. 다른 검색어로 검색해보세요.`;
    } else {
      state.results.mapSearch = result.items;
      // 검색 결과 하나당 지도에 핀을 하나씩 놓는다 - 위에 따로 목록을 두지 않고 핀을 눌러 고른다
      mapState.markers = result.items.map((item) => {
        const marker = new mapState.MarkerClass({
          position: { lat: item.lat, lng: item.lng },
          map: mapState.map,
          icon: pinIcon(PIN_COLOR_RESULT, 6),
        });
        marker.addListener("click", () => selectMapItem(item));
        return { item, marker };
      });

      const first = result.items[0];
      if (result.items.length === 1) {
        selectMapItem(first);
      } else {
        const bounds = new window.google.maps.LatLngBounds();
        result.items.forEach((item) => bounds.extend({ lat: item.lat, lng: item.lng }));
        mapState.map.fitBounds(bounds);
      }
      if (statusEl) {
        statusEl.textContent = first.isAddressOnly
          ? "숙소로는 찾지 못해 주소로 위치를 찾았어요. 정확한 숙소인지 확인해주세요."
          : result.items.length === 1
          ? "검색 결과 1곳"
          : `검색 결과 ${result.items.length}곳 · 지도의 핀을 눌러 선택해주세요.`;
      }
    }
    updateAttribution();
  }

  // ---- 날짜 선택 ----

  function renderPicked() {
    const el = qs("picked");
    if (!el) return;
    const p = state.picked;
    const meta = [p.typeLabel, ratingText(p), p.address].filter(Boolean).join(" · ");
    el.innerHTML = `<strong>🏨 ${escapeHtml(p.name)}</strong>` + (meta ? `<span>${escapeHtml(meta)}</span>` : "");
  }

  function renderCalendar(trip) {
    const { start, end } = tripRange(trip);
    const { viewYear: year, viewMonth: month, checkIn, checkOut } = state;
    const calEl = qs("calendar");
    if (!calEl) return;
    // 여행 기간 밖의 날짜는 고를 수 없다
    calEl.innerHTML = calendar.monthHtml({
      year,
      month,
      start: checkIn,
      end: checkOut,
      isDisabled: (key) => key < start || key > end,
    });

    const hintEl = qs("calendar-hint");
    if (hintEl) {
      hintEl.textContent = !checkIn
        ? "체크인 날짜를 선택해주세요. 여행 기간 안에서만 고를 수 있어요."
        : !checkOut
        ? "체크아웃 날짜를 선택해주세요."
        : "다른 날짜를 누르면 체크인부터 다시 선택할 수 있어요.";
    }
  }

  function pickDate(key) {
    const trip = getTripById(state.tripId);
    const range = calendar.pickRange({ start: state.checkIn, end: state.checkOut }, key);
    state.checkIn = range.start;
    state.checkOut = range.end;
    renderCalendar(trip);
    renderFooter();
  }

  function renderFooter() {
    const footer = qs("footer");
    const confirmBtn = qs("confirm-btn");
    const { checkIn, checkOut } = state;
    if (footer) footer.hidden = state.page !== "dates" || !(checkIn && checkOut);
    if (checkIn && checkOut && confirmBtn) {
      confirmBtn.textContent = `${shortDate(checkIn)} ~ ${shortDate(checkOut)} (${nightsBetween(checkIn, checkOut)}박) 날짜 등록 완료`;
    }
  }

  let saving = false;

  async function confirmSave() {
    const { picked, checkIn, checkOut, tripId } = state;
    if (!picked || !checkIn || !checkOut || saving) return;

    saving = true;
    const confirmBtn = qs("confirm-btn");
    if (confirmBtn) confirmBtn.disabled = true;
    try {
      await addItem({
        tripId,
        date: checkIn,
        place: picked.name,
        lat: picked.lat,
        lng: picked.lng,
        lodging: {
          name: picked.name,
          typeLabel: picked.typeLabel,
          rating: picked.rating,
          ratingCount: picked.ratingCount,
          placeId: picked.placeId,
          checkIn,
          checkOut,
          nights: nightsBetween(checkIn, checkOut),
        },
      });
    } catch (err) {
      ui.showToast(err.message);
      return;
    } finally {
      saving = false;
      if (confirmBtn) confirmBtn.disabled = false;
    }
    router.navigate(router.buildPath("schedule", { id: tripId }));
  }

  // ---- 화면 진입 ----

  // .lodging-header는 내용(← 버튼 · 제목 · 부제)이 없다 - SHELL(tripShell.js)의 상단바가 그 역할을
  // 대신한다(홈 버튼 대신 ← 버튼, goBackFromShell). 빈 채로 두는 건 map/dates 두 하위 화면 위 여백용이다.
  function pageHtml() {
    return `
      <div class="lodging-shell">
        <header class="lodging-header"></header>

        <section class="lodging-page" data-role="page-map">
          <form class="lodging-map-search" data-role="map-search-form">
            <input type="search" class="lodging-map-search-input" data-role="map-search-input" placeholder="숙소 이름이나 주소로 검색" autocomplete="off" />
            <button type="submit" class="btn btn-save">검색</button>
          </form>
          <p class="lodging-status lodging-map-status" data-role="map-status"></p>
          <p class="lodging-attribution" data-role="map-attribution" hidden>장소 정보: Google 지도</p>
          <div class="lodging-map" data-role="map-el"></div>
          <div class="lodging-map-confirm" data-role="map-confirm" hidden>
            <div class="lodging-map-confirm-info" data-role="map-confirm-info"></div>
            <button type="button" class="btn btn-save" data-action="map-select">이 숙소 선택</button>
          </div>
        </section>

        <section class="lodging-page" data-role="page-dates" hidden>
          <div class="lodging-picked" data-role="picked"></div>
          <div class="calendar" data-role="calendar"></div>
          <p class="calendar-hint" data-role="calendar-hint"></p>
        </section>

        <div class="lodging-footer" data-role="footer" hidden>
          <button type="button" class="btn btn-save btn-block" data-role="confirm-btn" data-action="confirm"></button>
        </div>
      </div>`;
  }

  function bindEvents(el) {
    el.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="confirm"]')) return confirmSave();
      if (e.target.closest('[data-action="map-select"]')) {
        if (mapState.selectedItem) pickLodging(mapState.selectedItem);
        return;
      }

      const nav = e.target.closest("[data-cal-nav]");
      if (nav) {
        const next = calendar.shiftMonth({ year: state.viewYear, month: state.viewMonth }, Number(nav.dataset.calNav));
        state.viewYear = next.year;
        state.viewMonth = next.month;
        renderCalendar(getTripById(state.tripId));
        return;
      }
      const day = e.target.closest("[data-date]");
      if (day && !day.disabled) pickDate(day.dataset.date);
    });

    // 화면에 들어올 때마다 폼 엘리먼트가 새로 만들어지므로(el.innerHTML을 통째로 다시 그린다),
    // 폼 자체가 아니라 el에 위임해서 매 방문마다 다시 걸지 않아도 되게 한다 (submit도 버블링된다).
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.target.matches('[data-role="map-search-form"]')) {
        const query = qs("map-search-input")?.value.trim();
        if (query) runMapSearch(query);
      }
    });

    // 검색어를 모두 지우면(브라우저의 ✕ 버튼 포함) 검색 결과와 선택했던 마커를 지운다
    el.addEventListener("input", (e) => {
      if (!e.target.matches('[data-role="map-search-input"]') || e.target.value.trim()) return;
      if (!state.results.mapSearch.length) return;
      state.results.mapSearch = [];
      mapState.searchId += 1;
      clearMarkers();
      renderMapConfirm();
      updateAttribution();
      const statusEl = qs("map-status");
      if (statusEl) statusEl.textContent = "숙소를 검색해서 지도에 표시해보세요.";
    });
  }

  async function enter(el, { params }) {
    const trip = getTripById(params.id);
    if (!trip) return; // 가드가 이미 걸러내므로 여기까지 오지 않는다

    currentEl = el;
    el.dataset.tripId = trip.id;
    state.tripId = trip.id;
    state.page = "map";
    state.picked = null;
    state.results = { mapSearch: [] };
    state.requestId += 1;

    mapState.loaded = false;
    mapState.loading = false;
    mapState.map = null;
    mapState.MarkerClass = null;
    mapState.markers = [];
    mapState.selectedItem = null;
    mapState.searchId += 1;

    el.innerHTML = pageHtml();
    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      bindEvents(el);
    }

    goTo("map");
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.lodging = { goBackFromShell };
  router.definePage("lodging", enter);
})();
