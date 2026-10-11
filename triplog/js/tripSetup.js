// @별칭 TRIP-SETUP · 여행 만들기·설정 마법사 (여행지 → 날짜)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행 정보 설정 2단계 위저드: 1단계 여행지 선택 → 2단계 날짜(달력) 선택.
// 저장은 하지 않고, 완료 시 onComplete({ cityId, destination, startDate, endDate })를 호출한다.

(function () {
  const { REGIONS, OVERSEAS_GROUPS, getCities, searchCities, getCityById, fetchCityImage } = window.TripLog.destinations;

  const { escapeHtml } = window.TripLog.util;
  const calendar = window.TripLog.calendar;

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
    regionId: "overseas",
    groupId: "all",
    query: "",
    cityId: null,
    startDate: null,
    endDate: null,
    viewYear: 0,
    viewMonth: 0,
    canClose: false,
    onComplete: null,
  };

  // ---- 날짜 유틸 ----

  function formatKey(key) {
    return key.replaceAll("-", ".");
  }

  // ---- 열기/닫기 ----

  function open({ trip, canClose, onComplete }) {
    state.onComplete = onComplete;
    state.canClose = canClose;
    state.step = 1;
    state.regionId = "overseas";
    state.groupId = "all";
    state.query = "";
    els.searchInput.value = "";
    state.cityId = null;
    state.startDate = trip?.startDate ?? null;
    state.endDate = trip?.endDate && trip.endDate !== trip.startDate ? trip.endDate : null;

    const city = trip?.cityId ? getCityById(trip.cityId) : null;
    if (city) {
      state.cityId = city.id;
      state.regionId = city.region;
      state.groupId = "all";
    }

    const anchor = state.startDate ? new Date(`${state.startDate}T00:00:00`) : new Date();
    state.viewYear = anchor.getFullYear();
    state.viewMonth = anchor.getMonth();

    els.overlay.hidden = false;
    render();
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
      const city = getCityById(state.cityId);
      els.stepLabel.textContent = "2단계 · 날짜 입력";
      els.title.textContent = `${city.name}, 언제 떠나시나요?`;
      renderCalendar();
    }
    renderFooter();
  }

  function tabHtml(id, label, activeId, kind) {
    const active = id === activeId;
    return `<button type="button" class="tab${active ? " tab--active" : ""}" role="tab"
      aria-selected="${active}" data-${kind}="${id}">${label}</button>`;
  }

  // 검색 중에는 지역/나라 탭과 무관하게 전체에서 찾으므로 탭을 숨긴다
  function isSearching() {
    return state.query.trim() !== "";
  }

  function renderRegionTabs() {
    els.regionTabs.hidden = isSearching();
    els.regionTabs.innerHTML = REGIONS.map((r) => tabHtml(r.id, r.label, state.regionId, "region")).join("");
  }

  function renderGroupTabs() {
    const show = state.regionId === "overseas" && !isSearching();
    els.groupTabs.hidden = !show;
    if (!show) return;
    els.groupTabs.innerHTML = OVERSEAS_GROUPS.map((g) => tabHtml(g.id, g.label, state.groupId, "group")).join("");
  }

  function renderCityList() {
    const cities = isSearching()
      ? searchCities(state.query)
      : getCities(state.regionId, state.regionId === "overseas" ? state.groupId : "all");

    if (cities.length === 0) {
      els.cityList.innerHTML = `<li class="pick-empty">"${escapeHtml(state.query.trim())}" 검색 결과가 없습니다.</li>`;
      return;
    }

    els.cityList.innerHTML = cities
      .map((city) => {
        const selected = city.id === state.cityId;
        return `
          <li class="pick-item${selected ? " pick-item--selected" : ""}" data-city-id="${city.id}">
            <div class="pick-thumb" aria-hidden="true">📍</div>
            <div class="pick-info">
              <span class="pick-name">${city.name}</span>
              <span class="pick-sub">${city.country}</span>
            </div>
            <button type="button" class="pick-btn${selected ? " pick-btn--selected" : ""}"
              data-select-city="${city.id}" aria-pressed="${selected}">${selected ? "선택됨" : "선택"}</button>
          </li>`;
      })
      .join("");

    cities.forEach((city) => {
      const thumb = els.cityList.querySelector(`[data-city-id="${city.id}"] .pick-thumb`);
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
      const city = getCityById(state.cityId);
      els.footer.hidden = !city;
      if (city) els.confirmBtn.textContent = `${city.name} 선택완료`;
      return;
    }

    els.footer.hidden = !state.startDate;
    if (!state.startDate) return;
    els.confirmBtn.textContent = state.endDate
      ? `${formatKey(state.startDate)} ~ ${formatKey(state.endDate)} 등록 완료`
      : `${formatKey(state.startDate)} 당일 일정 등록`;
  }

  // ---- 이벤트 ----

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    render();
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
      if (!state.cityId) return;
      state.step = 2;
      render();
      return;
    }

    if (!state.startDate) return;
    const city = getCityById(state.cityId);
    const payload = {
      cityId: city.id,
      cityName: city.name,
      destination: `${city.name}, ${city.country}`,
      startDate: state.startDate,
      endDate: state.endDate ?? state.startDate,
    };
    close();
    state.onComplete?.(payload);
  }

  els.regionTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-region]");
    if (!btn) return;
    state.regionId = btn.dataset.region;
    state.groupId = "all";
    render();
  });

  els.groupTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group]");
    if (!btn) return;
    state.groupId = btn.dataset.group;
    render();
  });

  els.cityList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-select-city]");
    if (!btn) return;
    const id = btn.dataset.selectCity;
    state.cityId = state.cityId === id ? null : id;
    render();
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
