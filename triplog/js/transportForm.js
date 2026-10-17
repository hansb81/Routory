// @별칭 TRANSPORT-FORM · 기타 교통편(기차·버스·선박) 추가 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 일정 화면의 빠른 메뉴(교통편) 드롭다운에서 "기타"를 고르면 열리는 창. 항공(flight.js)과 달리 사진으로
// 인식하는 과정이 없고, 전부 직접 입력한다: 날짜 선택 → 카테고리(기차/버스/선박/기타) → 출발지·출발시간 →
// 도착지·도착시간 → 좌석(선택, 비워도 된다) → 등록.
// 저장은 item.transport = { category, depPlace, depTime, arrPlace, arrTime, seat } 하나의 jsonb로 한다
// (flight.js의 item.flight와 같은 자리, 013_transport_items.sql의 schedule_items.transport 컬럼).
// 수정도 같은 창을 쓴다(item을 넘기면 그 값으로 채워진다) - schedule.js의 일반 일정 폼과 같은 add/edit 겸용 방식.
// 삭제는 flight.js의 상세 창과 같은 "두 번 눌러야 삭제"(deleteArmed) 방식을 쓴다 - 따로 확인 팝업을 만들지 않는다.
// 출발지/도착지는 schedule.js의 장소 칸과 같은 방식으로 지도에서 찾을 수 있다(포커스하면 지도가 나타나고,
// 검색 결과를 고르거나 지도를 누르면 이름이 채워진다) - 다만 좌표는 저장하지 않는다(item.transport은 이름만
// 쓴다, 역/터미널 이름 같은 글자만 필요). 못 찾으면 그냥 입력칸에 직접 타이핑하면 된다.

(function () {
  const { getTrip, addItem, updateItem, deleteItem } = window.TripLog.storage;
  const { escapeHtml, getTripDays: tripDaysOf } = window.TripLog.util;
  const gmaps = window.TripLog.googleMaps;

  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울 (여행지 좌표를 못 구했을 때의 기본값)
  const SEARCH_DEBOUNCE_MS = 400;

  const TRANSPORT_META = {
    train: { icon: "🚆", label: "기차" },
    bus: { icon: "🚌", label: "버스" },
    ship: { icon: "🚢", label: "선박" },
    etc: { icon: "📌", label: "기타" },
  };
  const TRANSPORT_KEYS = Object.keys(TRANSPORT_META);

  let onChange = () => {};
  let els = null; // ensureModal()이 한 번만 만든다
  let depPlaceField = null; // createPlaceField() - ensureModal()이 한 번만 만든다
  let arrPlaceField = null;

  const state = {
    trip: null,
    days: [],
    dayKey: null,
    category: null,
    editingId: null,
    saving: false,
  };

  // 타임라인 카드에 보여줄 한 줄 요약: "서울역 09:00 ~ 부산역 11:30 · 3호차 12A"
  function summary(item) {
    const t = item.transport;
    const seatSuffix = t.seat ? ` · ${t.seat}` : "";
    return `${t.depPlace} ${t.depTime} ~ ${t.arrPlace} ${t.arrTime}${seatSuffix}`;
  }

  function iconFor(item) {
    return TRANSPORT_META[item.transport?.category]?.icon ?? TRANSPORT_META.etc.icon;
  }

  function ensureModal() {
    if (els) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "TRANSPORT-FORM · 기타 교통편 추가 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal transport-modal" role="dialog" aria-modal="true" aria-labelledby="transport-modal-title">
        <h2 class="modal-title" id="transport-modal-title">기타 교통편 등록</h2>
        <form novalidate>
          <div class="form-field">
            <div class="transport-day-picker" data-day-picker>
              <button type="button" class="transport-day-trigger" data-action="day-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="날짜 선택">
                <span data-day-trigger-text></span>
                <span class="transport-day-caret" aria-hidden="true">▾</span>
              </button>
              <ul class="transport-day-list" data-day-list hidden role="listbox" aria-label="날짜 선택"></ul>
            </div>
          </div>

          <div class="form-field">
            <div class="transport-category-chips" data-category-chips role="radiogroup" aria-label="카테고리"></div>
          </div>

          <div class="form-field">
            <div class="transport-row">
              <input type="text" data-dep-place placeholder="출발지" aria-label="출발지" autocomplete="off" />
              <input type="time" data-dep-time aria-label="출발 시간" />
            </div>
            <div class="transport-place-map-wrap" data-dep-map-wrap hidden>
              <ul class="transport-place-results" data-dep-results></ul>
              <p class="transport-place-status" data-dep-status></p>
              <div class="transport-place-map" data-dep-map></div>
            </div>
          </div>

          <div class="form-field">
            <div class="transport-row">
              <input type="text" data-arr-place placeholder="도착지" aria-label="도착지" autocomplete="off" />
              <input type="time" data-arr-time aria-label="도착 시간" />
            </div>
            <div class="transport-place-map-wrap" data-arr-map-wrap hidden>
              <ul class="transport-place-results" data-arr-results></ul>
              <p class="transport-place-status" data-arr-status></p>
              <div class="transport-place-map" data-arr-map></div>
            </div>
          </div>

          <div class="form-field">
            <input type="text" data-seat placeholder="좌석 (선택)" aria-label="좌석" autocomplete="off" />
          </div>

          <p class="form-error" data-error hidden></p>

          <div class="modal-actions">
            <button type="button" class="btn btn-delete" data-action="delete" hidden>삭제</button>
            <div class="modal-actions-right">
              <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
              <button type="submit" class="btn btn-save" data-save>등록</button>
            </div>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    els = {
      overlay,
      form: overlay.querySelector("form"),
      dayPicker: overlay.querySelector("[data-day-picker]"),
      dayTrigger: overlay.querySelector('[data-action="day-toggle"]'),
      dayTriggerText: overlay.querySelector("[data-day-trigger-text]"),
      dayList: overlay.querySelector("[data-day-list]"),
      categoryChips: overlay.querySelector("[data-category-chips]"),
      depPlace: overlay.querySelector("[data-dep-place]"),
      depTime: overlay.querySelector("[data-dep-time]"),
      depMapWrap: overlay.querySelector("[data-dep-map-wrap]"),
      depResults: overlay.querySelector("[data-dep-results]"),
      depStatus: overlay.querySelector("[data-dep-status]"),
      depMap: overlay.querySelector("[data-dep-map]"),
      arrPlace: overlay.querySelector("[data-arr-place]"),
      arrTime: overlay.querySelector("[data-arr-time]"),
      arrMapWrap: overlay.querySelector("[data-arr-map-wrap]"),
      arrResults: overlay.querySelector("[data-arr-results]"),
      arrStatus: overlay.querySelector("[data-arr-status]"),
      arrMap: overlay.querySelector("[data-arr-map]"),
      seat: overlay.querySelector("[data-seat]"),
      error: overlay.querySelector("[data-error]"),
      deleteBtn: overlay.querySelector('[data-action="delete"]'),
      saveBtn: overlay.querySelector("[data-save]"),
    };

    depPlaceField = createPlaceField({
      input: els.depPlace,
      mapWrap: els.depMapWrap,
      resultsEl: els.depResults,
      statusEl: els.depStatus,
      mapEl: els.depMap,
    });
    arrPlaceField = createPlaceField({
      input: els.arrPlace,
      mapWrap: els.arrMapWrap,
      resultsEl: els.arrResults,
      statusEl: els.arrStatus,
      mapEl: els.arrMap,
    });

    els.dayTrigger.addEventListener("click", () => setDayOpen(els.dayList.hidden));
    els.dayList.addEventListener("click", (e) => {
      const option = e.target.closest("[data-day-key]");
      if (option) selectDay(option.dataset.dayKey);
    });
    document.addEventListener("click", (e) => {
      if (overlay.hidden) return;
      if (!els.dayPicker.contains(e.target)) setDayOpen(false);
    });

    els.categoryChips.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-category-key]");
      if (chip) selectCategory(chip.dataset.categoryKey);
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    els.deleteBtn.addEventListener("click", handleDelete);
    els.form.addEventListener("submit", handleSubmit);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // ---- 출발지/도착지 지도 검색: schedule.js의 장소 칸과 같은 방식(포커스하면 지도가 나타나고, 입력하면
  // 디바운스 후 검색한다)을 두 입력칸(출발지/도착지)에 각각 붙인다. 좌표는 저장하지 않는다 - 이름만
  // 채워주는 용도라 못 찾으면 그냥 입력칸에 직접 타이핑하면 된다(선택하지 않아도 입력값이 그대로 저장된다).
  function createPlaceField({ input, mapWrap, resultsEl, statusEl, mapEl }) {
    const mapState = {
      map: null,
      marker: null,
      MarkerClass: null,
      loaded: false,
      loading: false,
      searchId: 0,
      searchTimer: null,
      results: [],
    };

    // 포커스할 때 딱 한 번만 지도를 만든다(이후 포커스에서는 이미 있는 지도를 그대로 쓴다)
    async function showMap() {
      mapWrap.hidden = false;
      if (mapState.loaded || mapState.loading) return;
      mapState.loading = true;
      statusEl.textContent = "지도를 불러오는 중...";

      try {
        const mapsApi = await gmaps.load();
        let center = null;
        if (state.trip?.destination) {
          try {
            center = await gmaps.geocodeAddress(state.trip.destination);
          } catch (err) {
            console.warn("[transportForm] 여행지 좌표 조회 실패", err); // 기본 좌표로 계속 진행한다
          }
        }
        if (els.overlay.hidden) return; // 그 사이 창을 닫았다
        center = center ?? DEFAULT_CENTER;

        const { Map } = await mapsApi.importLibrary("maps");
        const { Marker } = await mapsApi.importLibrary("marker");
        if (els.overlay.hidden) return;

        mapState.MarkerClass = Marker;
        mapState.map = new Map(mapEl, {
          center,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: true,
        });
        mapState.map.addListener("click", handleMapClick);
        statusEl.textContent = "";
        mapState.loaded = true;
      } catch (err) {
        console.warn("[transportForm] 지도를 불러오지 못했습니다.", err);
        statusEl.textContent = gmaps.errorMessage(err);
      } finally {
        mapState.loading = false;
      }
    }

    function placeMarker(lat, lng) {
      if (!mapState.marker) {
        mapState.marker = new mapState.MarkerClass({ position: { lat, lng }, map: mapState.map });
      } else {
        mapState.marker.setPosition({ lat, lng });
      }
      mapState.map.panTo({ lat, lng });
    }

    // 지도의 빈 곳을 누르면 그 위치의 주소로 이름을 채운다 (POI 세부 조회 없이, 좌표만으로 단순하게)
    function handleMapClick(e) {
      const { lat, lng } = e.latLng.toJSON();
      placeMarker(lat, lng);
      clearResults();

      const thisPick = ++mapState.searchId;
      statusEl.textContent = "위치 확인 중...";
      gmaps
        .reverseGeocode(lat, lng)
        .then((name) => {
          if (thisPick !== mapState.searchId) return;
          input.value = name || "선택한 위치";
          statusEl.textContent = "";
        })
        .catch((err) => {
          console.warn("[transportForm] 주소 조회 실패", err);
          if (thisPick !== mapState.searchId) return;
          input.value = "선택한 위치";
          statusEl.textContent = "";
        });
    }

    function handleInput() {
      const query = input.value.trim();
      clearTimeout(mapState.searchTimer);
      if (!query) {
        clearResults();
        statusEl.textContent = "";
        return;
      }
      mapState.searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    }

    // 지도가 아직 없으면(포커스 전에 입력이 들어올 일은 거의 없지만) 검색만 미뤄 둔다
    async function runSearch(query) {
      if (!mapState.map) return;
      const searchId = ++mapState.searchId;
      statusEl.textContent = "검색 중...";

      let places;
      try {
        places = await gmaps.searchText(query, { center: mapState.map.getCenter().toJSON(), radius: 20000 });
      } catch (err) {
        if (searchId !== mapState.searchId) return;
        console.warn("[transportForm] 장소 검색 실패", err);
        renderResults([]);
        statusEl.textContent = gmaps.errorMessage(err);
        return;
      }
      if (searchId !== mapState.searchId) return;
      renderResults(places);
      statusEl.textContent = places.length
        ? `검색 결과 ${places.length}곳`
        : `"${query}"에 맞는 장소를 찾지 못했어요. 직접 입력해도 돼요.`;
    }

    function renderResults(items) {
      mapState.results = items;
      resultsEl.innerHTML = items
        .map(
          (p, i) => `
          <li class="transport-place-result" data-result-index="${i}">
            <span class="transport-place-result-name">${escapeHtml(p.name)}</span>
            ${p.address ? `<span class="transport-place-result-sub">${escapeHtml(p.address)}</span>` : ""}
          </li>`
        )
        .join("");
    }

    function clearResults() {
      mapState.results = [];
      resultsEl.innerHTML = "";
    }

    function selectResult(index) {
      const item = mapState.results[index];
      if (!item) return;
      input.value = item.name;
      placeMarker(item.lat, item.lng);
      if (mapState.map.getZoom() < 16) mapState.map.setZoom(16);
      clearResults();
      statusEl.textContent = `"${item.name}" 선택됨`;
    }

    function reset() {
      mapState.map = null;
      mapState.marker = null;
      mapState.MarkerClass = null;
      mapState.loaded = false;
      mapState.loading = false;
      mapState.searchId += 1;
      clearTimeout(mapState.searchTimer);
      clearResults();
      mapWrap.hidden = true;
      statusEl.textContent = "";
      mapEl.innerHTML = ""; // 이전 지도 DOM을 지운다 (다음 포커스에서 새 지도를 만든다)
    }

    input.addEventListener("focus", showMap);
    input.addEventListener("input", handleInput);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    resultsEl.addEventListener("click", (e) => {
      const item = e.target.closest("[data-result-index]");
      if (item) selectResult(Number(item.dataset.resultIndex));
    });

    return { reset };
  }

  // ---- 날짜(Day) 드롭다운: schedule.js/expenseForm.js와 같은 토글형 목록 ----

  function buildDayOptions() {
    return tripDaysOf(state.trip).map((day) => ({ dayKey: day.date, label: `Day ${day.number} · ${day.label}` }));
  }

  function renderDayList() {
    els.dayList.innerHTML = state.days
      .map(
        (day) => `
        <li role="option" aria-selected="${day.dayKey === state.dayKey}"
          class="transport-day-option${day.dayKey === state.dayKey ? " transport-day-option--active" : ""}"
          data-day-key="${escapeHtml(day.dayKey)}">${escapeHtml(day.label)}</li>`
      )
      .join("");
    const selected = state.days.find((day) => day.dayKey === state.dayKey);
    els.dayTriggerText.textContent = selected?.label ?? "날짜 선택";
  }

  function setDayOpen(open) {
    els.dayList.hidden = !open;
    els.dayTrigger.setAttribute("aria-expanded", String(open));
  }

  function selectDay(dayKey) {
    state.dayKey = dayKey;
    renderDayList();
    setDayOpen(false);
  }

  // ---- 카테고리(기차/버스/선박/기타): expenseForm.js의 원형 칩과 같은 모양 ----

  function renderCategoryChips() {
    els.categoryChips.innerHTML = TRANSPORT_KEYS.map(
      (key) => `
        <button type="button" role="radio" aria-checked="${key === state.category}"
          class="transport-category-item${key === state.category ? " transport-category-item--active" : ""}"
          data-category-key="${key}">
          <span class="transport-category-icon" aria-hidden="true">${TRANSPORT_META[key].icon}</span>
          <span class="transport-category-label">${escapeHtml(TRANSPORT_META[key].label)}</span>
        </button>`
    ).join("");
  }

  function selectCategory(key) {
    state.category = key;
    renderCategoryChips();
  }

  // ---- 오류 표시 ----

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  // ---- 열기/닫기 ----

  // item을 넘기면 그 값으로 채워진 수정 폼, 안 넘기면 새 교통편 추가 폼이 된다. 여행 기간이 아직 없으면
  // (Day가 하나도 없으면) 고를 날짜가 없다는 뜻이라 그냥 열지 않는다 - flight.openForm과 같은 가드.
  function openForm(item) {
    ensureModal();
    const trip = getTrip();
    if (!trip || tripDaysOf(trip).length === 0) return;

    state.trip = trip;
    state.days = buildDayOptions();
    state.dayKey = item?.date ?? state.days[0]?.dayKey ?? null;
    state.category = item?.transport?.category ?? null;
    state.editingId = item?.id ?? null;
    state.saving = false;

    els.form.reset();
    els.depPlace.value = item?.transport?.depPlace ?? "";
    els.depTime.value = item?.transport?.depTime ?? "";
    els.arrPlace.value = item?.transport?.arrPlace ?? "";
    els.arrTime.value = item?.transport?.arrTime ?? "";
    els.seat.value = item?.transport?.seat ?? "";
    depPlaceField.reset();
    arrPlaceField.reset();
    clearError();

    els.deleteBtn.hidden = !state.editingId;
    els.deleteBtn.textContent = "삭제";
    els.deleteBtn.classList.remove("btn-danger");

    setDayOpen(false);
    renderDayList();
    renderCategoryChips();

    els.overlay.hidden = false;
  }

  function close() {
    if (state.saving) return; // 저장 중에는 창을 닫아 중간에 끊기지 않게 한다
    els.overlay.hidden = true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (state.saving) return;

    const depPlace = els.depPlace.value.trim();
    const depTime = els.depTime.value;
    const arrPlace = els.arrPlace.value.trim();
    const arrTime = els.arrTime.value;
    const seat = els.seat.value.trim();

    if (!state.dayKey) return showError("날짜를 선택해주세요.");
    if (!state.category) return showError("카테고리를 선택해주세요.");
    if (!depPlace || !depTime) return showError("출발지와 출발 시간을 입력해주세요.");
    if (!arrPlace || !arrTime) return showError("도착지와 도착 시간을 입력해주세요.");

    clearError();
    const transport = { category: state.category, depPlace, depTime, arrPlace, arrTime, seat };

    state.saving = true;
    els.saveBtn.disabled = true;
    try {
      if (state.editingId) await updateItem(state.editingId, { date: state.dayKey, transport });
      else await addItem({ tripId: state.trip.id, date: state.dayKey, transport });
    } catch (err) {
      showError(err.message);
      return;
    } finally {
      state.saving = false;
      els.saveBtn.disabled = false;
    }

    els.overlay.hidden = true;
    onChange();
  }

  async function handleDelete() {
    // 실수로 지우지 않도록 첫 클릭은 확인 상태로만 바꾸고, 두 번째 클릭에서 삭제한다 (flight.js의 상세 창과 같은 방식)
    if (!els.deleteBtn.classList.contains("btn-danger")) {
      els.deleteBtn.textContent = "정말 삭제";
      els.deleteBtn.classList.add("btn-danger");
      return;
    }
    try {
      await deleteItem(state.editingId);
    } catch (err) {
      showError(err.message);
      return;
    }
    els.overlay.hidden = true;
    onChange();
  }

  function init(onChangeCallback) {
    onChange = typeof onChangeCallback === "function" ? onChangeCallback : () => {};
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.transportForm = { init, openForm, summary, iconFor };
})();
