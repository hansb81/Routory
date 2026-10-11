// @별칭 DAY-MAP · 일정 화면 위쪽 지도
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 일정 화면 상단(빠른 메뉴와 Day 목록 사이)의 구글 지도.
// - 장소가 있는 일정을 Day별로 번호(1, 2, 3...)를 붙여 지도에 표시하고, 같은 Day의 장소를 점선으로 잇는다.
//   번호는 타임라인 카드의 순서와 같고, 카드의 아이콘 자리도 같은 색·번호의 원으로 바꿔서 서로 찾아볼 수 있게 한다.
// - 위치(lat/lng)가 저장된 일정은 그대로 쓰고, 장소 이름만 있는 일정은 Geocoding으로 찾는다 (결과는 메모리에만 둔다).
//   항공편은 공항 좌표가 없어서 표시하지 않는다.
// - 지도에는 지금 스크롤해서 보고 있는 Day의 장소만 나온다 (다음 Day로 넘어가면 1번부터 다시 시작하는 그 Day의 장소로 바뀐다).
// - 스크롤할 때 화면 맨 위에 보이는 일정의 번호를 지도에서 크게 키워 준다.
// 지도 스크립트는 지도를 펼친 상태에서 처음 그릴 때 불러온다 (접어 두면 요청도 요금도 없다).

(function () {
  const gmaps = window.TripLog.googleMaps;
  const { haversineKm } = window.TripLog.util;

  const STORAGE_KEY = "triplog.dayMap.open";
  const ROUTE_COLOR_COUNT = 6; // css의 --route-1 ~ --route-6
  const MAX_GEOCODE = 30; // 한 번에 Geocoding으로 찾을 장소 수 상한 (요금 보호)
  const MAX_DISTANCE_KM = 400; // 여행지에서 이보다 멀리 찍힌 Geocoding 결과는 엉뚱한 장소로 보고 버린다
  const FIT_PADDING = 36;
  const SINGLE_ZOOM = 15;
  const MAX_FIT_ZOOM = 16;
  const EMPTY_ZOOM = 11;
  const SCROLL_THROTTLE_MS = 40; // 스크롤 중 "맨 위 일정" 계산 간격
  const REF_OFFSET = 24; // 기준선: 상단 영역 아래 이만큼 내려온 곳 (다음 카드가 이 선을 넘으면 그 카드가 "맨 위 일정"이 된다)
  const ROLL_MS = 90; // 한 번에 여러 카드를 건너뛰어 스크롤했을 때, 사이 카드들의 번호를 차례로 비추는 간격
  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };

  let els = null;
  let map = null;
  let PinClass = null;
  let routeColors = [];
  let routeInks = [];
  let routeLineColor = "";

  let plan = []; // 마지막으로 받은 일정에서 뽑은 번호 매긴 장소 목록
  let latestTrip = null;
  let renderId = 0; // 응답이 늦게 도착해도 가장 마지막 요청의 결과만 반영하기 위한 번호
  let needsDraw = false; // 접혀 있는 동안 일정이 바뀌었으면 펼칠 때 다시 그린다
  let locatedEntries = null; // 위치를 찾은 장소들 (아직 못 그렸으면 null)
  let shownDay = null; // 지도에 지금 표시 중인 Day
  let pins = []; // { id, pin, entry } 표시 중인 Day의 번호 마커
  let lines = [];
  let focusId = null; // 지금 크게 키운(포커스된) 일정
  let rollTimer = null;
  let tail = 0; // 타임라인 아래에 붙인 여백(px)
  let fitSignature = "";
  let pendingFit = false;
  let scrollQueued = false;
  let fitTargets = []; // 마지막으로 화면에 맞춘 마커들 (지도 크기가 생긴 뒤 다시 맞출 때 쓴다)

  // ---- 접기/펼치기 ----

  function readOpen() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "0"; // 처음에는 펼쳐 둔다
    } catch (err) {
      return true;
    }
  }

  function writeOpen(open) {
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch (err) {
      /* 저장소를 못 쓰는 환경이면 기억만 못 한다 */
    }
  }

  const isOpen = () => els.root.dataset.open === "true";

  function setOpen(open, { remember = true, redraw = true } = {}) {
    els.root.dataset.open = String(open);
    els.toggle.setAttribute("aria-expanded", String(open));
    els.toggle.setAttribute("aria-label", open ? "지도 접기" : "지도 펼치기");
    if (remember) writeOpen(open);
    if (redraw && open && (needsDraw || !map)) draw();
  }

  // ---- 초기화 ----

  function init() {
    els = {
      root: document.getElementById("day-map"),
      top: document.querySelector(".app-top"),
      toggle: document.getElementById("day-map-toggle"),
      canvas: document.getElementById("day-map-canvas"),
      status: document.getElementById("day-map-status"),
      timeline: document.getElementById("timeline"),
    };

    const styles = getComputedStyle(document.documentElement);
    routeColors = Array.from({ length: ROUTE_COLOR_COUNT }, (_, i) => styles.getPropertyValue(`--route-${i + 1}`).trim() || "#007aff");
    // 각 Day 색은 파스텔톤이라 번호 글자색을 밝게/어둡게 따로 골라 둬야 읽힌다 (색마다 대비를 계산해 --route-N-ink에 미리 정해 둔 값)
    routeInks = Array.from({ length: ROUTE_COLOR_COUNT }, (_, i) => styles.getPropertyValue(`--route-${i + 1}-ink`).trim() || "#ffffff");
    routeLineColor = styles.getPropertyValue("--route-line").trim() || "#3a3a3c";

    els.toggle.addEventListener("click", () => setOpen(!isOpen()));
    // 지금 어느 화면이든 앱이 시작될 때 구글 스크립트를 불러오지 않도록, 그리기는 일정 화면이 update()를 부를 때 시작한다
    setOpen(readOpen(), { remember: false, redraw: false });

    // 상단 영역(헤더+메뉴+지도)의 높이를 css 변수로 알려 준다: 카드로 스크롤할 때 그 아래에 가려지지 않게 하는 데 쓴다
    new ResizeObserver(() => {
      document.documentElement.style.setProperty("--app-top-h", `${els.top.offsetHeight}px`);
      layoutTail();
      queueActiveUpdate();
    }).observe(els.top);

    // 카드 높이가 바뀌거나(사진이 늦게 뜰 때 등) 화면 크기가 바뀌면 아래 여백을 다시 계산한다
    new ResizeObserver(layoutTail).observe(els.timeline);
    window.addEventListener("resize", () => {
      layoutTail();
      queueActiveUpdate();
    });

    // 화면이 숨겨져 있다가 보이거나 접었다 펼치면서 지도 크기가 바뀌면 지도에 알려 준다
    new ResizeObserver(() => {
      if (!map || els.canvas.offsetWidth === 0) return;
      window.google.maps.event.trigger(map, "resize");
      if (pendingFit) fit();
    }).observe(els.canvas);

    window.addEventListener("scroll", queueActiveUpdate, { passive: true });

    gmaps.onAuthFailure(() => showStatus(gmaps.errorMessage({ code: "AUTH_FAILED" })));
  }

  // 안내가 필요할 때만 지도 아래에 한 줄을 보여준다
  function showStatus(text) {
    els.status.textContent = text;
    els.status.hidden = !text;
  }

  // ---- 일정 → 번호 매긴 장소 목록 ----

  // days: [{ dateKey, dayNumber, items }] (날짜순, items는 타임라인에 보이는 순서)
  // 지도에 넣을 장소는 항공편이 아니면서 장소 이름이나 위치가 있는 일정이다.
  // 번호는 그 Day 안에서 1부터 순서대로 매기고, 위치를 못 찾은 장소도 번호는 차지한다 (카드의 번호와 항상 같게).
  function buildPlan(days) {
    const entries = [];
    days.forEach((day, dayIndex) => {
      let order = 0;
      for (const item of day.items) {
        const hasCoords = typeof item.lat === "number" && typeof item.lng === "number";
        if (item.flight || !(hasCoords || item.place)) continue;
        order += 1;
        entries.push({
          item,
          order,
          dayNumber: day.dayNumber ?? dayIndex + 1,
          color: routeColors[((day.dayNumber ?? dayIndex + 1) - 1) % ROUTE_COLOR_COUNT],
          ink: routeInks[((day.dayNumber ?? dayIndex + 1) - 1) % ROUTE_COLOR_COUNT],
          lat: hasCoords ? item.lat : null,
          lng: hasCoords ? item.lng : null,
        });
      }
    });
    return entries;
  }

  // 타임라인 카드의 아이콘 자리를 지도 마커와 같은 색·번호의 원으로 바꾼다 (카드는 다시 그려질 때마다 새로 만들어진다)
  function decorateCards() {
    for (const entry of plan) {
      const icon = els.timeline.querySelector(`.timeline-item[data-id="${CSS.escape(entry.item.id)}"] .item-icon`);
      if (!icon) continue;
      icon.textContent = entry.order;
      icon.classList.add("item-icon--num");
      icon.style.setProperty("--pin-color", entry.color);
      icon.style.setProperty("--pin-ink", entry.ink);
    }
  }

  // 렌더러(app.js)가 타임라인을 다시 그릴 때마다 부른다
  function update({ trip, days }) {
    latestTrip = trip;
    plan = buildPlan(days);
    decorateCards();
    layoutTail();
    needsDraw = true;
    // 일정 화면이 아닐 때는 지도를 불러오지 않는다 (앱이 시작될 때는 화면 전환 전이라 일정 화면이 잠깐 보이는 상태여서,
    // hidden만으로는 알 수 없고 주소를 함께 본다). 일정 화면에 들어오면 타임라인이 다시 그려지며 여기로 다시 온다.
    if (isOpen() && !els.top.hidden && location.hash.startsWith("#/schedule/")) draw();
  }

  // ---- 지도 그리기 ----

  // 번호가 붙는 원형 마커. 기본 Marker는 CSS 애니메이션을 쓸 수 없어서 OverlayView로 직접 만든다.
  function makePinClass(mapsApi) {
    return class Pin extends mapsApi.OverlayView {
      constructor(position, order, color, ink, onClick) {
        super();
        this.position = new mapsApi.LatLng(position.lat, position.lng);
        this.order = order;
        this.color = color;
        this.ink = ink;
        this.onClick = onClick;
        this.active = false; // onAdd 전에 정해진 값도 잃지 않게 기억해 둔다
        this.el = null;
      }

      onAdd() {
        this.el = document.createElement("div");
        this.el.className = "day-pin";
        this.el.style.setProperty("--pin-color", this.color);
        this.el.style.setProperty("--pin-ink", this.ink);
        this.el.innerHTML = `<span class="day-pin-dot">${this.order}</span>`;
        this.el.classList.toggle("is-active", this.active);
        this.el.addEventListener("click", this.onClick);
        this.getPanes().overlayMouseTarget.appendChild(this.el);
      }

      draw() {
        const point = this.getProjection()?.fromLatLngToDivPixel(this.position);
        if (!point || !this.el) return;
        this.el.style.left = `${point.x}px`;
        this.el.style.top = `${point.y}px`;
      }

      onRemove() {
        this.el?.remove();
        this.el = null;
      }

      setActive(active) {
        this.active = active;
        this.el?.classList.toggle("is-active", active);
      }
    };
  }

  async function ensureMap() {
    const mapsApi = await gmaps.load();
    if (map) return;
    const { Map } = await mapsApi.importLibrary("maps");
    if (map) return; // 기다리는 사이 다른 호출이 먼저 만들었다
    PinClass = makePinClass(mapsApi);
    map = new Map(els.canvas, {
      center: DEFAULT_CENTER,
      zoom: 12,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      // 지도 위에서 페이지가 스크롤되지 않는 "갇힘"을 막는다 (휴대폰은 손가락 두 개, PC는 Ctrl+휠)
      gestureHandling: "cooperative",
    });
  }

  function clearOverlays() {
    pins.forEach(({ pin }) => pin.setMap(null));
    lines.forEach((line) => line.setMap(null));
    pins = [];
    lines = [];
  }

  async function draw() {
    const id = ++renderId;
    const snapshot = plan;
    needsDraw = false;
    showStatus("");

    try {
      await ensureMap();
      if (id !== renderId) return;

      // 위치가 없는 장소는 이름으로 찾는다 (같은 이름은 googleMaps가 캐시해 두어 다시 묻지 않는다)
      const destination = latestTrip?.destination ?? "";
      const center = destination ? await gmaps.geocodeAddress(destination).catch(() => null) : null;
      if (id !== renderId) return;

      // 여러 장소를 동시에 찾는다 (예전에는 하나씩 순서대로 기다려서, 찾을 게 많으면 지도가 뜨는 데 몇 초씩 걸렸다).
      const toGeocode = snapshot.filter((entry) => entry.lat === null).slice(0, MAX_GEOCODE);
      await Promise.all(
        toGeocode.map(async (entry) => {
          try {
            const found = await gmaps.geocodeAddress(destination ? `${entry.item.place}, ${destination}` : entry.item.place);
            if (id !== renderId) return;
            if (found && (!center || haversineKm(center, found) <= MAX_DISTANCE_KM)) {
              entry.lat = found.lat;
              entry.lng = found.lng;
            }
          } catch (err) {
            if (id !== renderId) return;
            console.warn("[dayMap] 장소 위치 조회 실패", err);
          }
        })
      );
      if (id !== renderId) return;

      // 새 데이터로 처음부터 다시 그린다: 지금 화면 맨 위의 일정이 속한 Day가 지도에 나온다
      clearTimeout(rollTimer);
      clearOverlays();
      locatedEntries = snapshot.filter((entry) => entry.lat !== null);
      shownDay = null;
      focusId = null;

      if (!snapshot.length) {
        showStatus("장소가 있는 일정을 추가하면 번호와 함께 지도에 표시돼요.");
        fitSignature = "";
        if (center) {
          map.setCenter(center);
          map.setZoom(EMPTY_ZOOM);
        }
        return;
      }
      updateActive();
    } catch (err) {
      if (id !== renderId) return;
      console.warn("[dayMap] 지도를 그리지 못했습니다.", err);
      showStatus(gmaps.errorMessage(err));
    }
  }

  // 지도에 그 Day의 장소만 그린다: 번호 마커와, 그 장소들을 잇는 진한 점선
  function showDay(day) {
    clearOverlays();
    shownDay = day;
    const dayEntries = plan.filter((entry) => entry.dayNumber === day);
    const located = locatedEntries.filter((entry) => entry.dayNumber === day);

    for (const entry of located) {
      const pin = new PinClass({ lat: entry.lat, lng: entry.lng }, entry.order, entry.color, entry.ink, () => scrollToCard(entry.item.id));
      pin.setMap(map);
      pins.push({ id: entry.item.id, pin, entry });
    }
    drawRoutes(located);

    const missing = dayEntries.length - located.length;
    showStatus(
      !located.length
        ? "이 Day의 장소는 위치를 찾지 못했어요. 지도에서 장소를 선택해 등록하면 표시돼요."
        : missing
          ? `위치를 찾지 못한 장소가 ${missing}곳 있어요. 지도에서 장소를 선택해 등록하면 표시돼요.`
          : ""
    );

    // 같은 Day의 같은 장소들이면(일정을 고치지 않고 다시 그린 경우) 사용자가 옮겨 둔 지도 위치를 그대로 둔다
    const signature = `${day}:${located.map((e) => `${e.lat},${e.lng}`).join("|")}`;
    if (located.length && signature !== fitSignature) fit(located);
    fitSignature = signature;
  }

  function drawRoutes(located) {
    if (located.length < 2) return;
    lines.push(
      new window.google.maps.Polyline({
        map,
        path: located.map((e) => ({ lat: e.lat, lng: e.lng })),
        strokeOpacity: 0, // 선 자체는 숨기고, 반복 기호(짧은 막대)로 점선을 만든다
        icons: [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: 0.85, strokeColor: routeLineColor, strokeWeight: 3, scale: 3 },
            offset: "0",
            repeat: "14px",
          },
        ],
      })
    );
  }

  // 모든 마커가 한 화면에 들어오게 맞춘다. 지도가 숨겨져 있어 크기가 0이면 크기가 생길 때 다시 맞춘다.
  function fit(located) {
    if (located) fitTargets = located;
    if (!fitTargets.length) return;
    if (els.canvas.offsetWidth === 0) {
      pendingFit = true;
      return;
    }
    pendingFit = false;
    const { LatLngBounds, event } = window.google.maps;
    if (fitTargets.length === 1) {
      map.setCenter({ lat: fitTargets[0].lat, lng: fitTargets[0].lng });
      map.setZoom(SINGLE_ZOOM);
      return;
    }
    const bounds = new LatLngBounds();
    fitTargets.forEach((e) => bounds.extend({ lat: e.lat, lng: e.lng }));
    map.fitBounds(bounds, FIT_PADDING);
    // 마커가 서로 아주 가까우면 너무 크게 확대되니 상한을 둔다
    event.addListenerOnce(map, "idle", () => {
      if (map.getZoom() > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
    });
  }

  // ---- 스크롤 연동 ----

  function scrollToCard(itemId) {
    const card = els.timeline.querySelector(`.timeline-item[data-id="${CSS.escape(itemId)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "start" }); // 카드의 scroll-margin-top이 상단 영역을 피해 준다
  }

  function queueActiveUpdate() {
    if (scrollQueued) return;
    scrollQueued = true;
    setTimeout(() => {
      scrollQueued = false;
      updateActive();
    }, SCROLL_THROTTLE_MS);
  }

  // "맨 위의 일정"을 고른다: 상단 영역 바로 아래(limit + REF_OFFSET)에 기준선을 긋고, 그 선을 지난 카드 중 마지막 것.
  //   tops: 카드들의 화면(뷰포트) 기준 top 위치 (문서 순서), limit: 상단 영역의 아래쪽 y
  function pickActiveIndex(tops, { limit }) {
    const refY = limit + REF_OFFSET;
    let index = 0; // 아직 아무 카드도 기준선에 닿지 않았으면(페이지 맨 위) 첫 카드
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] <= refY) index = i;
      else break;
    }
    return index;
  }

  // 페이지 맨 아래쪽 카드도 화면 맨 위(기준선)까지 올라올 수 있게 타임라인 아래에 붙일 여백(px).
  //   belowDist: 마지막 카드의 top에서 문서 맨 끝까지의 거리 (여백 제외)
  function tailNeeded(belowDist, { limit, viewH }) {
    return Math.max(0, viewH - limit - REF_OFFSET - belowDist + 2);
  }

  function layoutTail() {
    const cards = numberedCards();
    let needed = 0;
    if (cards.length && els.root.offsetWidth > 0) {
      const scrollY = window.scrollY;
      const docBottom = els.timeline.getBoundingClientRect().bottom + scrollY - tail;
      const lastTop = cards[cards.length - 1].card.getBoundingClientRect().top + scrollY;
      needed = tailNeeded(docBottom - lastTop, { limit: els.top.offsetHeight, viewH: window.innerHeight });
    }
    if (Math.abs(needed - tail) < 1) return;
    tail = needed;
    els.timeline.style.setProperty("--timeline-tail", `${needed}px`);
  }

  // 번호가 붙은 일정과 그 카드 (문서 순서). 지도에 표시되지 않는 일정(위치를 못 찾은 것)도 포함한다.
  function numberedCards() {
    const list = [];
    for (const entry of plan) {
      const card = els.timeline.querySelector(`.timeline-item[data-id="${CSS.escape(entry.item.id)}"]`);
      if (card) list.push({ entry, card });
    }
    return list;
  }

  function updateActive() {
    if (!map || !locatedEntries || els.root.offsetWidth === 0) return;
    const list = numberedCards();
    if (!list.length) return;
    const index = pickActiveIndex(
      list.map(({ card }) => card.getBoundingClientRect().top),
      { limit: els.top.getBoundingClientRect().bottom }
    );
    moveFocus(list, index);
  }

  // 같은 Day 안에서 한 번에 여러 카드를 건너뛰었으면(휠 한 칸이 카드 높이보다 크거나 PageDown을 눌렀을 때 등),
  // 건너뛴 카드들의 번호도 차례로 비춰 준다. Day가 바뀌는 이동은 바로 그 일정으로 간다.
  function moveFocus(list, target) {
    clearTimeout(rollTimer);
    const from = list.findIndex(({ entry }) => entry.item.id === focusId);
    const sameDay = from !== -1 && list[from].entry.dayNumber === list[target].entry.dayNumber;
    if (!sameDay || Math.abs(target - from) <= 1) {
      applyFocus(list[target].entry);
      return;
    }
    let i = from;
    const step = () => {
      i += Math.sign(target - i);
      applyFocus(list[i].entry);
      if (i !== target) rollTimer = setTimeout(step, ROLL_MS);
    };
    step();
  }

  function applyFocus(entry) {
    if (entry.item.id === focusId && entry.dayNumber === shownDay) return;
    focusId = entry.item.id;
    if (entry.dayNumber !== shownDay) showDay(entry.dayNumber);

    pins.forEach(({ id, pin }) => pin.setActive(id === focusId));
    const active = pins.find(({ id }) => id === focusId);
    // 키운 마커가 지도 밖에 있으면 지도를 부드럽게 옮겨서 보이게 한다
    const bounds = map.getBounds();
    if (active && bounds && !bounds.contains(active.pin.position)) map.panTo(active.pin.position);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.dayMap = { init, update, pickActiveIndex, tailNeeded };
})();
