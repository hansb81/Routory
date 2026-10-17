// @별칭 SCHEDULE-FORM · 일정 추가·수정·삭제 창 (일정 화면의 일부)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 일정 CRUD(추가/수정/삭제)와 필터/모달 UI를 담당하는 모듈
// 실제 타임라인 DOM 렌더링은 app.js가 맡고, 이 모듈은 데이터가 바뀔 때마다 onChange 콜백으로 알려준다.
// storage.js와 마찬가지로 file:// 직접 실행을 지원하기 위해 ES 모듈 대신 전역 네임스페이스를 사용한다.
//
// "장소 추가"·"메모 추가" 두 팝업이 전체화면 창 하나("일정 추가")로 합쳐졌다 (expenseForm.js처럼
// schedule.js가 body에 직접 붙인다 - index.html에는 더 이상 이 창의 마크업이 없다):
//   - 날짜는 달력이 아니라 이 여행의 Day 목록(getTripDays)에서 고른다. 시간은 그 옆 같은 줄에 있다.
//   - 장소 칸은 이제 검색창이다: 포커스하면 그 아래에 작은 지도가 나타나고(처음 포커스할 때만 만든다),
//     검색 결과를 고르거나 지도를 직접 눌러 위치를 정할 수 있다 - 별도의 "지도에서 선택" 버튼이나
//     주변 추천 목록은 없다(검색한 결과만 보여준다). 지도가 나오면 메모칸은 그 아래로 밀린다.
//   - 사진은 그대로지만, 썸네일을 누르면 전체화면으로 확인할 수 있다(schedule-photo-viewer-overlay).
//   - 장소·메모·사진 중 하나도 없으면 저장할 수 없다.
// 숙소 일정(item.lodging)은 체크인 날짜가 곧 Day라서 날짜 선택만 잠근다(hideDate) - 그 밖의 필드는 그대로 연다.

(function () {
  const {
    getTrip,
    getItems,
    addItem,
    updateItem,
    deleteItem,
    getItemById,
  } = window.TripLog.storage;
  const { saveImage, getImageUrl, deleteImage } = window.TripLog.images;
  const { escapeHtml, getTripDays } = window.TripLog.util;
  const gmaps = window.TripLog.googleMaps;

  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울 (여행지 좌표를 못 구했을 때의 기본값)
  const SEARCH_DEBOUNCE_MS = 400;

  let onChange = () => {};
  let timelineEl = null;

  let editingId = null;
  let saving = false;

  // 폼에 첨부된(아직 저장 전인) 이미지 id 목록과, 편집 시작 시점에 이미 있던 이미지 id 목록.
  // 취소 시에는 "새로 추가했다가 취소한" 이미지만 IndexedDB에서 지운다.
  let pendingImageIds = [];
  let originalImageIds = [];

  const state = {
    days: [], // buildDayOptions(trip): [{ dayKey, label }]
    dayKey: null,
    hideDate: false,
  };

  // 장소 검색용 지도 상태 - 폼을 열 때마다 초기화하고, 실제 지도 인스턴스는 장소 칸에 처음 포커스할 때 만든다
  // (매번 새로 만든다 - lodging.js의 지도에서 찾기와 같은 방식).
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

  let els = null; // ensureForm()이 한 번만 만든다
  let photoViewer = null; // ensurePhotoViewer()가 한 번만 만든다

  function initSchedule(onChangeCallback) {
    onChange = typeof onChangeCallback === "function" ? onChangeCallback : () => {};
    timelineEl = document.getElementById("timeline");
    bindTimelineEvents();
    onChange();
  }

  // 현재 여행에 일정을 하나 추가한다 (폼 저장과 다른 화면의 "일정에 담기"가 같은 경로를 쓴다).
  // 화면 갱신(onChange)은 부르지 않는다. 일정 화면은 들어올 때마다 다시 그려진다. 현재 여행이 없으면 null.
  // 서버 저장이 끝나면 저장된 일정을 돌려주고, 저장하지 못하면 Error(한국어 메시지)를 던진다.
  async function addScheduleItem({ date, time, place, lat, lng, memo, images }) {
    const trip = getTrip();
    if (!trip) return null;
    return addItem({ tripId: trip.id, date, time, place, lat, lng, memo, images });
  }

  // 현재 여행에 속한 일정 목록 (정렬/그룹핑은 app.js 책임)
  function getVisibleItems() {
    const trip = getTrip();
    return trip ? getItems().filter((item) => item.tripId === trip.id) : [];
  }

  function bindTimelineEvents() {
    timelineEl.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".day-add-btn");
      if (addBtn) {
        openForm(null, { date: addBtn.dataset.date });
        return;
      }

      const card = e.target.closest(".timeline-item");
      if (!card) return;
      const item = getItemById(card.dataset.id);
      if (!item) return;
      if (item.flight) {
        window.TripLog.flight.openDetail(item.id);
        return;
      }
      if (item.transport) {
        window.TripLog.transportForm.openForm(item);
        return;
      }
      // 숙소는 체크인 날짜가 곧 Day라서 날짜를 바꾸지 못하게 잠근다
      openForm(item, { hideDate: Boolean(item.lodging) });
    });
  }

  // ---- 전체화면 창 생성 (한 번만 만들고 body에 붙인다) ----

  function ensureForm() {
    if (els) return;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay schedule-form-overlay";
    overlay.dataset.alias = "SCHEDULE-FORM · 일정 추가·수정 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="schedule-form-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-form-title">
        <div class="schedule-form-header">
          <button type="button" class="schedule-form-close" data-action="close" aria-label="닫기">✕</button>
          <h2 class="schedule-form-title" id="schedule-form-title">일정 추가</h2>
        </div>

        <div class="schedule-form-body">
          <form novalidate>
            <div class="schedule-form-daytime">
              <div class="schedule-day-picker" data-day-picker>
                <button type="button" class="schedule-day-trigger" data-action="day-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="날짜 선택">
                  <span data-day-trigger-text></span>
                  <span class="schedule-day-caret" aria-hidden="true">▾</span>
                </button>
                <ul class="schedule-day-list" data-day-list hidden role="listbox" aria-label="날짜 선택"></ul>
              </div>
              <div class="schedule-time-group">
                <label class="schedule-time-label" for="schedule-field-time">시간</label>
                <input type="time" id="schedule-field-time" data-time />
              </div>
            </div>

            <div class="form-field">
              <label for="schedule-field-place">장소</label>
              <input type="text" id="schedule-field-place" data-place placeholder="장소 검색" autocomplete="off" />
              <input type="hidden" data-lat />
              <input type="hidden" data-lng />
              <div class="schedule-place-map-wrap" data-place-map-wrap hidden>
                <ul class="schedule-place-results" data-place-results></ul>
                <p class="schedule-place-status" data-place-status></p>
                <div class="schedule-place-map" data-place-map></div>
              </div>
            </div>

            <div class="form-field">
              <label for="schedule-field-memo">메모</label>
              <textarea id="schedule-field-memo" data-memo rows="3" placeholder="메모를 남겨보세요"></textarea>
            </div>

            <div class="form-field">
              <label>사진</label>
              <div class="image-thumbs" data-image-thumbs></div>
              <input type="file" data-field-images accept="image/*" multiple hidden />
              <button type="button" class="btn-add-image" data-action="add-image">🖼️ 이미지 추가</button>
            </div>

            <p class="form-error" data-error hidden></p>
          </form>
        </div>

        <div class="schedule-form-footer">
          <div class="modal-actions">
            <button type="button" class="btn btn-delete" data-action="delete" hidden>삭제</button>
            <div class="modal-actions-right">
              <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
              <button type="button" class="btn btn-save" data-action="save">저장</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    els = {
      overlay,
      title: overlay.querySelector("#schedule-form-title"),
      dayPicker: overlay.querySelector("[data-day-picker]"),
      dayTrigger: overlay.querySelector('[data-action="day-toggle"]'),
      dayTriggerText: overlay.querySelector("[data-day-trigger-text]"),
      dayList: overlay.querySelector("[data-day-list]"),
      time: overlay.querySelector("[data-time]"),
      place: overlay.querySelector("[data-place]"),
      lat: overlay.querySelector("[data-lat]"),
      lng: overlay.querySelector("[data-lng]"),
      placeMapWrap: overlay.querySelector("[data-place-map-wrap]"),
      placeResults: overlay.querySelector("[data-place-results]"),
      placeStatus: overlay.querySelector("[data-place-status]"),
      placeMap: overlay.querySelector("[data-place-map]"),
      memo: overlay.querySelector("[data-memo]"),
      imageThumbs: overlay.querySelector("[data-image-thumbs]"),
      fieldImages: overlay.querySelector("[data-field-images]"),
      error: overlay.querySelector("[data-error]"),
      deleteBtn: overlay.querySelector('[data-action="delete"]'),
      saveBtn: overlay.querySelector('[data-action="save"]'),
    };

    // 날짜(Day) 드롭다운: expenseForm.js의 날짜 선택과 같은 토글형 목록
    els.dayTrigger.addEventListener("click", () => setDayOpen(els.dayList.hidden));
    els.dayList.addEventListener("click", (e) => {
      const option = e.target.closest("[data-day-key]");
      if (option) selectDay(option.dataset.dayKey);
    });
    document.addEventListener("click", (e) => {
      if (overlay.hidden) return;
      if (!els.dayPicker.contains(e.target)) setDayOpen(false);
    });

    // 장소 검색: 포커스하면 지도가 나타나고, 입력하면(디바운스) 검색한다. Enter는 폼을 제출하지 않게 막는다
    // (검색어를 치는 도중 엔터를 눌러도 저장되지 않게).
    els.place.addEventListener("focus", showPlaceMap);
    els.place.addEventListener("input", handlePlaceInput);
    els.place.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    els.placeResults.addEventListener("click", (e) => {
      const item = e.target.closest("[data-result-index]");
      if (item) selectPlaceResult(Number(item.dataset.resultIndex));
    });

    overlay.querySelector('[data-action="add-image"]').addEventListener("click", () => els.fieldImages.click());
    els.fieldImages.addEventListener("change", handleImageFilesSelected);
    els.imageThumbs.addEventListener("click", handleImageThumbClick);

    overlay.querySelector('[data-action="close"]').addEventListener("click", handleCancelClick);
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", handleCancelClick);
    els.saveBtn.addEventListener("click", handleSubmit);
    els.deleteBtn.addEventListener("click", () => openConfirm(editingId));

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") handleCancelClick();
    });
  }

  // ---- 날짜(Day) 드롭다운 ----

  function buildDayOptions(trip) {
    return getTripDays(trip).map((day) => ({ dayKey: day.date, label: `Day ${day.number} · ${day.label}` }));
  }

  // 트리거에는 예시처럼 실제 날짜("2026-11-14")를 그대로 보여준다 - 목록에서 고를 항목은 "Day N · ..."로 보여준다
  function renderDayList() {
    els.dayList.innerHTML = state.days
      .map(
        (day) => `
        <li role="option" aria-selected="${day.dayKey === state.dayKey}"
          class="schedule-day-option${day.dayKey === state.dayKey ? " schedule-day-option--active" : ""}"
          data-day-key="${escapeHtml(day.dayKey)}">${escapeHtml(day.label)}</li>`
      )
      .join("");
    els.dayTriggerText.textContent = state.dayKey || "날짜 선택";
  }

  function setDayOpen(open) {
    if (state.hideDate && open) return; // 숙소는 날짜를 못 바꾼다
    els.dayList.hidden = !open;
    els.dayTrigger.setAttribute("aria-expanded", String(open));
  }

  function selectDay(dayKey) {
    state.dayKey = dayKey;
    renderDayList();
    setDayOpen(false);
  }

  // ---- 장소 검색 + 지도 ----

  // 포커스할 때 딱 한 번만 지도를 만든다(이후 포커스에서는 이미 있는 지도를 그대로 쓴다)
  async function showPlaceMap() {
    els.placeMapWrap.hidden = false;
    if (mapState.loaded || mapState.loading) return;
    mapState.loading = true;
    els.placeStatus.textContent = "지도를 불러오는 중...";

    const lat = els.lat.value ? parseFloat(els.lat.value) : null;
    const lng = els.lng.value ? parseFloat(els.lng.value) : null;
    let center = lat != null && lng != null ? { lat, lng } : null;

    try {
      const mapsApi = await gmaps.load();
      if (!center && getTrip()?.destination) {
        try {
          center = await gmaps.geocodeAddress(getTrip().destination);
        } catch (err) {
          console.warn("[schedule] 여행지 좌표 조회 실패", err); // 기본 좌표로 계속 진행한다
        }
      }
      if (els.overlay.hidden) return; // 그 사이 창을 닫았다
      center = center ?? DEFAULT_CENTER;

      const { Map } = await mapsApi.importLibrary("maps");
      const { Marker } = await mapsApi.importLibrary("marker");
      if (els.overlay.hidden) return;

      mapState.MarkerClass = Marker;
      mapState.map = new Map(els.placeMap, {
        center,
        zoom: lat != null && lng != null ? 16 : 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: true,
      });
      mapState.map.addListener("click", handleMapClick);
      if (lat != null && lng != null) placeMarker(lat, lng);
      els.placeStatus.textContent = "";
      mapState.loaded = true;
    } catch (err) {
      console.warn("[schedule] 지도를 불러오지 못했습니다.", err);
      els.placeStatus.textContent = gmaps.errorMessage(err);
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
    els.lat.value = lat;
    els.lng.value = lng;
    clearPlaceResults();

    const thisPick = ++mapState.searchId;
    els.placeStatus.textContent = "위치 확인 중...";
    gmaps
      .reverseGeocode(lat, lng)
      .then((name) => {
        if (thisPick !== mapState.searchId) return;
        els.place.value = name || "선택한 위치";
        els.placeStatus.textContent = "";
      })
      .catch((err) => {
        console.warn("[schedule] 주소 조회 실패", err);
        if (thisPick !== mapState.searchId) return;
        els.place.value = "선택한 위치";
        els.placeStatus.textContent = "";
      });
  }

  function handlePlaceInput() {
    const query = els.place.value.trim();
    clearTimeout(mapState.searchTimer);
    if (!query) {
      clearPlaceResults();
      els.placeStatus.textContent = "";
      return;
    }
    mapState.searchTimer = setTimeout(() => runPlaceSearch(query), SEARCH_DEBOUNCE_MS);
  }

  // 지도가 아직 없으면(포커스 전에 입력이 들어올 일은 거의 없지만) 검색만 미뤄 둔다
  async function runPlaceSearch(query) {
    if (!mapState.map) return;
    const searchId = ++mapState.searchId;
    els.placeStatus.textContent = "검색 중...";

    let places;
    try {
      places = await gmaps.searchText(query, { center: mapState.map.getCenter().toJSON(), radius: 20000 });
    } catch (err) {
      if (searchId !== mapState.searchId) return;
      console.warn("[schedule] 장소 검색 실패", err);
      renderPlaceResults([]);
      els.placeStatus.textContent = gmaps.errorMessage(err);
      return;
    }
    if (searchId !== mapState.searchId) return;
    renderPlaceResults(places);
    els.placeStatus.textContent = places.length ? `검색 결과 ${places.length}곳` : `"${query}"에 맞는 장소를 찾지 못했어요.`;
  }

  function renderPlaceResults(items) {
    mapState.results = items;
    els.placeResults.innerHTML = items
      .map(
        (p, i) => `
        <li class="schedule-place-result" data-result-index="${i}">
          <span class="schedule-place-result-name">${escapeHtml(p.name)}</span>
          ${p.address ? `<span class="schedule-place-result-sub">${escapeHtml(p.address)}</span>` : ""}
        </li>`
      )
      .join("");
  }

  function clearPlaceResults() {
    mapState.results = [];
    els.placeResults.innerHTML = "";
  }

  function selectPlaceResult(index) {
    const item = mapState.results[index];
    if (!item) return;
    els.place.value = item.name;
    els.lat.value = item.lat;
    els.lng.value = item.lng;
    placeMarker(item.lat, item.lng);
    if (mapState.map.getZoom() < 16) mapState.map.setZoom(16);
    clearPlaceResults();
    els.placeStatus.textContent = `"${item.name}" 선택됨`;
  }

  function resetPlaceMap() {
    mapState.map = null;
    mapState.marker = null;
    mapState.MarkerClass = null;
    mapState.loaded = false;
    mapState.loading = false;
    mapState.searchId += 1;
    clearTimeout(mapState.searchTimer);
    clearPlaceResults();
    els.placeMapWrap.hidden = true;
    els.placeStatus.textContent = "";
    els.placeMap.innerHTML = ""; // 이전 지도 DOM을 지운다 (다음 포커스에서 새 지도를 만든다)
  }

  // ---- 열기/닫기 ----

  // item이 있으면 수정, 없으면 추가. date는 추가할 때(day-add-btn) 넘어오는 초기 날짜, hideDate는 숙소 수정일 때
  function openForm(item, { date, hideDate } = {}) {
    ensureForm();
    editingId = item ? item.id : null;
    const trip = getTrip();
    state.days = buildDayOptions(trip);
    state.hideDate = Boolean(hideDate);

    clearError();
    resetPlaceMap();
    els.dayTrigger.disabled = state.hideDate;

    if (item) {
      els.title.textContent = "일정 수정";
      state.dayKey = item.date ?? state.days[0]?.dayKey ?? "";
      els.time.value = item.time ? item.time.slice(0, 5) : ""; // 서버는 "HH:MM:SS"(time 타입)로 주므로 앞 5자리만 쓴다
      els.place.value = item.place ?? "";
      els.lat.value = typeof item.lat === "number" ? item.lat : "";
      els.lng.value = typeof item.lng === "number" ? item.lng : "";
      els.memo.value = item.memo ?? "";
      els.deleteBtn.hidden = false;
      setImages(item.images ?? []);
    } else {
      els.title.textContent = "일정 추가";
      state.dayKey = date ?? state.days[0]?.dayKey ?? "";
      els.time.value = "";
      els.place.value = "";
      els.lat.value = "";
      els.lng.value = "";
      els.memo.value = "";
      els.deleteBtn.hidden = true;
      setImages([]);
    }

    renderDayList();
    setDayOpen(false);
    els.overlay.hidden = false;
  }

  function closeForm() {
    els.overlay.hidden = true;
    editingId = null;
    clearError();
  }

  function handleCancelClick() {
    // 새로 추가했다가 저장 없이 취소한 이미지는 고아로 남지 않게 정리한다
    const unusedIds = pendingImageIds.filter((id) => !originalImageIds.includes(id));
    unusedIds.forEach((id) => deleteImage(id));
    closeForm();
  }

  // ---- 이미지 첨부 ----

  function setImages(ids) {
    originalImageIds = [...ids];
    pendingImageIds = [...ids];
    renderImageThumbs();
  }

  let thumbRenderId = 0;

  async function renderImageThumbs() {
    const renderId = ++thumbRenderId;
    const ids = [...pendingImageIds];
    const entries = await Promise.all(ids.map(async (id) => ({ id, url: await getImageUrl(id) })));
    if (renderId !== thumbRenderId) return;

    els.imageThumbs.innerHTML = entries
      .filter((entry) => entry.url)
      .map(
        (entry) => `
          <div class="image-thumb" data-id="${entry.id}">
            <img src="${entry.url}" alt="" data-id="${entry.id}" />
            <button type="button" class="image-thumb-remove" data-id="${entry.id}" aria-label="이미지 삭제">✕</button>
          </div>
        `
      )
      .join("");
  }

  async function handleImageFilesSelected() {
    const files = [...els.fieldImages.files];
    els.fieldImages.value = "";
    // 여러 장을 한 번에 골랐을 때 하나씩 기다리지 않고 동시에 저장한다 (순서는 files 순서대로 유지).
    const results = await Promise.allSettled(files.map((file) => saveImage(file)));
    let hasError = false;
    for (const result of results) {
      if (result.status === "fulfilled") pendingImageIds.push(result.value);
      else {
        hasError = true;
        console.warn("[schedule] 사진 저장 실패", result.reason);
      }
    }
    if (hasError) showError("사진을 저장하지 못했어요. 다른 사진으로 다시 시도해주세요.");
    renderImageThumbs();
  }

  // 삭제(✕) 버튼과 사진 자체(전체화면으로 보기)를 한 리스너에서 나눠 처리한다
  function handleImageThumbClick(e) {
    const removeBtn = e.target.closest(".image-thumb-remove");
    if (removeBtn) return handleRemoveImageClick(removeBtn);

    const img = e.target.closest(".image-thumb img");
    if (img) openPhotoViewer(img.dataset.id);
  }

  function handleRemoveImageClick(btn) {
    const id = btn.dataset.id;
    pendingImageIds = pendingImageIds.filter((existingId) => existingId !== id);

    // 이번에 새로 추가했다가 저장 전에 지운 이미지는 곧바로 정리. 원래 있던 이미지는 취소 시 그대로
    // 남아야 하므로, 실제 저장(handleSubmit)이 확정될 때에만 지운다.
    if (!originalImageIds.includes(id)) {
      deleteImage(id);
    }
    renderImageThumbs();
  }

  // ---- 사진 전체화면 보기 (5-2) ----

  function ensurePhotoViewer() {
    if (photoViewer) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay schedule-photo-viewer-overlay";
    overlay.dataset.alias = "SCHEDULE-PHOTO-VIEWER · 일정 사진 전체화면 보기";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="schedule-photo-viewer">
        <img alt="" />
        <button type="button" class="schedule-photo-viewer-close" aria-label="닫기">✕</button>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => {
      overlay.hidden = true;
    };
    overlay.querySelector(".schedule-photo-viewer-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(); // 사진·닫기 버튼이 아닌 빈 배경을 눌러도 닫힌다
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    photoViewer = { overlay, img: overlay.querySelector("img") };
  }

  async function openPhotoViewer(imageId) {
    ensurePhotoViewer();
    const url = await getImageUrl(imageId);
    if (!url) return;
    photoViewer.img.src = url;
    photoViewer.overlay.hidden = false;
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

  // ---- 저장 ----

  async function handleSubmit() {
    if (saving) return;

    const date = state.dayKey;
    const time = els.time.value.trim() || null; // 빈 문자열은 time 컬럼에 넣을 수 없어서 null로
    const place = els.place.value.trim();
    const lat = els.lat.value ? parseFloat(els.lat.value) : null;
    const lng = els.lng.value ? parseFloat(els.lng.value) : null;
    const memo = els.memo.value.trim();
    const images = [...pendingImageIds];

    if (!date) {
      showError("날짜를 선택해주세요.");
      return;
    }
    if (!place && !memo && images.length === 0) {
      showError("장소, 메모, 사진 중 하나는 입력해주세요.");
      return;
    }

    clearError();

    // 서버에 저장한다. 실패하면 창을 닫지 않고 알려서, 입력한 내용을 잃지 않게 한다.
    saving = true;
    els.saveBtn.disabled = true;
    try {
      if (editingId) await updateItem(editingId, { date, time, place, lat, lng, memo, images });
      else await addScheduleItem({ date, time, place, lat, lng, memo, images });
    } catch (err) {
      showError(err.message);
      return;
    } finally {
      saving = false;
      els.saveBtn.disabled = false;
    }

    // 편집 중 제거된, 기존에 있던 이미지는 저장이 확정된 지금 정리한다
    const removedOriginalIds = originalImageIds.filter((id) => !images.includes(id));
    removedOriginalIds.forEach((id) => deleteImage(id));

    closeForm();
    onChange();
  }

  // ---- 삭제 확인 (index.html의 정적 창 #confirm-overlay를 그대로 쓴다) ----

  let pendingDeleteId = null;
  const confirmEls = {
    overlay: document.getElementById("confirm-overlay"),
    cancel: document.getElementById("confirm-cancel"),
    ok: document.getElementById("confirm-ok"),
  };

  function openConfirm(id) {
    pendingDeleteId = id;
    confirmEls.overlay.hidden = false;
  }

  function closeConfirm() {
    confirmEls.overlay.hidden = true;
    pendingDeleteId = null;
  }

  // 일정 하나를 지운다 (서버 삭제 + 붙어 있던 사진 정리 + 화면 갱신). 수정 폼의 삭제 버튼과
  // 타임라인 스와이프 삭제(timelineDrag.js)가 함께 쓴다. 실패하면 그대로 던지므로 호출한 쪽이
  // 각자의 방식(폼 에러 문구 / 토스트)으로 보여준다.
  async function deleteItemById(id) {
    const item = getItemById(id);
    await deleteItem(id);
    (item?.images ?? []).forEach((imageId) => deleteImage(imageId));
    onChange();
  }

  async function performDelete() {
    if (pendingDeleteId) {
      try {
        await deleteItemById(pendingDeleteId);
      } catch (err) {
        closeConfirm();
        showError(err.message);
        return;
      }
    }
    closeConfirm();
    closeForm();
  }

  confirmEls.cancel.addEventListener("click", closeConfirm);
  confirmEls.ok.addEventListener("click", performDelete);

  window.TripLog = window.TripLog || {};
  window.TripLog.schedule = {
    initSchedule,
    getVisibleItems,
    addScheduleItem,
    deleteItemById,
  };
})();
