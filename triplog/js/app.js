// @별칭 APP · 앱 시작 연결 + 일정 화면 타임라인 (#/schedule/:id)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 앱 진입점: 모듈을 초기화하고, 날짜별로 그룹핑된 일정 타임라인을 렌더링한다.
// 화면 전환은 router.js가 맡는다. 이 파일은 일정 화면(#/schedule/:id)을 담당하고,
// 여행이 여러 개라서 어느 여행을 보는지는 라우트의 :id로 정한다 (storage.setCurrentTrip).
// storage.js와 마찬가지로 file:// 직접 실행을 지원하기 위해 ES 모듈 대신 전역 네임스페이스를 사용한다.

(function () {
  const { initSchedule, getVisibleItems, deleteItemById } = window.TripLog.schedule;
  const timelineDrag = window.TripLog.timelineDrag;
  const { initDday, refreshDday } = window.TripLog.dday;
  const storage = window.TripLog.storage;
  const { getTrip, setCurrentTrip } = storage;
  const { getImageUrl } = window.TripLog.images;
  const { escapeHtml, shortDate, getTripDays, haversineKm } = window.TripLog.util;
  const flight = window.TripLog.flight;
  const transportForm = window.TripLog.transportForm;
  const dayMap = window.TripLog.dayMap;
  const router = window.TripLog.router;
  const auth = window.TripLog.auth;
  const ui = window.TripLog.ui;

  const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

  const timelineEl = document.getElementById("timeline");
  const tripTitleEl = document.getElementById("trip-title");
  const tripDatesEl = document.getElementById("trip-dates");

  // ---- 일정 타임라인 렌더링 ----

  // 일정 화면에 들어와 서버에서 일정을 받는 동안 보여줄 안내 (이미 받아 둔 여행은 캐시로 바로 그리고 뒤에서 새로 고친다)
  let timelineLoading = false;

  function renderTimeline() {
    const trip = getTrip();
    if (timelineLoading) {
      timelineEl.innerHTML = `<p class="timeline-empty">일정을 불러오는 중이에요...</p>`;
      dayMap.update({ trip, days: [] });
      return;
    }
    // 같은 날 안에서는 항공편을 출발 시간순으로 맨 위에 두고, 나머지(장소·메모)는 sortOrder(드래그로 바꾼
    // 순서, timelineDrag.js#persistReorder가 저장) 순으로 둔다. 숙소(체크인)는 그날의 맨 아래에 둔다.
    const sortKey = (item) =>
      `${item.date ?? ""} ${
        item.flight
          ? `0${item.flight.depTime}`
          : item.transport
          ? `0${item.transport.depTime}`
          : item.lodging
          ? "2"
          : `1${String(item.sortOrder ?? 0).padStart(8, "0")}`
      }`;
    const items = [...getVisibleItems()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    const itemsByDate = groupByDate(items);
    const dayIndexByDate = buildDayIndexByDate(trip);

    // 여행 기간의 모든 날짜 + 그 범위 밖에 등록된 일정의 날짜까지 합쳐서, 날짜순으로 day 섹션을 만든다
    const allDateKeys = new Set([...dayIndexByDate.keys(), ...itemsByDate.keys()]);
    const sortedDateKeys = [...allDateKeys].sort();

    if (sortedDateKeys.length === 0) {
      timelineEl.innerHTML = `<p class="timeline-empty">첫 일정을 등록해보세요.</p>`;
      dayMap.update({ trip, days: [] });
      return;
    }

    timelineEl.innerHTML = sortedDateKeys
      .map((dateKey) => renderDaySection(dateKey, dayIndexByDate.get(dateKey), itemsByDate.get(dateKey) ?? []))
      .join("");

    hydrateImageThumbnails();

    // 지도: 카드와 같은 순서·번호로 Day별 장소를 표시한다 (번호 배지는 방금 만든 카드에 붙는다)
    dayMap.update({
      trip,
      days: sortedDateKeys.map((dateKey) => ({
        dateKey,
        dayNumber: dayIndexByDate.get(dateKey),
        items: itemsByDate.get(dateKey) ?? [],
      })),
    });
  }

  // 카드 마크업에는 이미지 id만 넣어두고, IndexedDB 조회가 끝나는 대로 비동기로 src를 채운다
  function hydrateImageThumbnails() {
    const imgEls = [...timelineEl.querySelectorAll("img.item-thumb[data-image-id]")];
    imgEls.forEach(async (imgEl) => {
      const url = await getImageUrl(imgEl.dataset.imageId);
      if (url) imgEl.src = url;
    });
  }

  // 일정은 이미 날짜순으로 정렬돼 있으므로, 같은 날짜를 만나는 순서대로 묶으면
  // 그룹 내부는 등록한 순서를 유지한다.
  function groupByDate(sortedItems) {
    const groups = new Map();
    for (const item of sortedItems) {
      const key = item.date ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  }

  // 여행 시작일~종료일의 모든 날짜에 day 1, day 2 ... 번호를 매긴다 (여행 정보가 없으면 빈 맵)
  function buildDayIndexByDate(trip) {
    return new Map(getTripDays(trip).map((day) => [day.date, day.number]));
  }

  function renderDaySection(dateKey, dayNumber, dateItems) {
    const dayLabel = dayNumber ? `<span class="day-badge">Day ${dayNumber}</span>` : "";
    // .date-items는 일정이 없어도 항상 그린다(data-date만 있는 빈 칸) - 다른 Day에서 드래그해 온 카드를
    // 놓을 자리가 있어야 하기 때문이다(timelineDrag.js). 평소엔 빈 칸이라 눈에 띄지 않고,
    // 드래그 중에만 CSS(.timeline.is-reordering .date-items:empty)로 점선 칸을 보여준다.
    return `
      <section class="date-group" data-date="${dateKey}">
        <h2 class="date-header">
          ${dayLabel}
          <span class="date-label">${formatDateHeader(dateKey)}</span>
        </h2>
        <div class="date-items" data-date="${dateKey}">${renderDateItems(dateItems)}</div>
        <div class="day-actions">
          <button type="button" class="day-add-btn" data-date="${dateKey}">일정 추가</button>
        </div>
      </section>
    `;
  }

  // 카드 사이(바로 다음 일정)에 지도상 직선거리를 끼워 넣는다. 두 일정 모두 위치(lat/lng)가 있을 때만
  // 계산하고, 하나라도 없으면(장소를 지도에서 고르지 않았거나 항공편이면) 그 사이엔 아무것도 넣지 않는다.
  function renderDateItems(dateItems) {
    if (!dateItems.length) return "";
    const parts = [renderItemCard(dateItems[0])];
    for (let i = 1; i < dateItems.length; i++) {
      const km = itemDistanceKm(dateItems[i - 1], dateItems[i]);
      if (km !== null) parts.push(`<div class="item-distance">${formatDistanceKm(km)}</div>`);
      parts.push(renderItemCard(dateItems[i]));
    }
    return parts.join("");
  }

  function itemDistanceKm(a, b) {
    if (a.flight || b.flight || a.transport || b.transport) return null; // 항공편·기타 교통편은 좌표가 없어서 거리도 알 수 없다 (dayMap.js와 같은 규칙)
    if (typeof a.lat !== "number" || typeof a.lng !== "number") return null;
    if (typeof b.lat !== "number" || typeof b.lng !== "number") return null;
    return haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  }

  function formatDistanceKm(km) {
    if (km < 1) return `${Math.round(km * 1000)}m`;
    if (km < 10) return `${km.toFixed(1)}km`;
    return `${Math.round(km)}km`;
  }

  function formatDateHeader(dateStr) {
    if (!dateStr) return "날짜 미정";
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateStr;
    return `${date.getMonth() + 1}.${date.getDate()}/${WEEKDAY_LABELS[date.getDay()]}`;
  }

  function renderItemCard(item) {
    // 제목 필드가 없으므로 장소를 대표 텍스트로 쓰고, 장소가 없으면 메모를 대표 텍스트로 쓴다
    // (예전에 저장된 일정은 title이 있을 수 있어 그 값도 대체값으로 인정)
    const primary = item.flight
      ? flight.summary(item)
      : item.transport
      ? transportForm.summary(item)
      : item.place || item.title || item.memo || "";
    const memo = !item.flight && !item.transport && item.memo && item.memo !== primary ? item.memo : "";
    const icon = item.flight ? "✈️" : item.transport ? transportForm.iconFor(item) : item.lodging ? "🏨" : item.place ? "📍" : "📝";
    const stay = item.lodging;
    const metaLine = stay
      ? [
          `체크인 ${shortDate(stay.checkIn)} ~ 체크아웃 ${shortDate(stay.checkOut)}`,
          `${stay.nights}박`,
          [stay.typeLabel, stay.rating ? `★${stay.rating.toFixed(1)}` : stay.stars ? `★${stay.stars}` : ""].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    const imagesHtml =
      item.images && item.images.length
        ? `<div class="item-images">${item.images
            .map((id) => `<img class="item-thumb" data-image-id="${id}" alt="" />`)
            .join("")}</div>`
        : "";
    // 항공편·기타 교통편은 시간이 이미 요약문(primary)에 들어 있어서 따로 보여주지 않는다.
    const timeLabel = !item.flight && !item.transport && item.time ? item.time.slice(0, 5) : "";
    // 드래그 핸들로 순서 바꾸기·가로로 스와이프해서 삭제하기(timelineDrag.js)는 일반 카드(장소·메모)에서만
    // 된다. 항공편·기타 교통편은 출발시간순, 숙소는 항상 맨 아래라는 자체 규칙이 있어서 자유롭게 순서를
    // 바꾸면 안 되고, 셋 다 이미 각자의 수정/삭제 방법(항공편 상세 화면, 기타 교통편은 그 등록 창의 삭제
    // 버튼, 숙소는 수정 폼의 삭제 버튼)이 있다.
    const isPlain = !item.flight && !item.transport && !item.lodging;
    // 오른쪽 끝 드래그 핸들(3줄 아이콘): 누르는 즉시 순서 바꾸기가 시작된다(길게 누르기 없음).
    // tripShell.js의 메뉴(≡) 아이콘과 같은 모양·그리기 방식을 그대로 쓴다.
    const dragHandle = isPlain
      ? `<button type="button" class="item-drag-handle" aria-label="순서 변경">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>`
      : "";

    const card = `
      <div class="timeline-item" data-id="${item.id}" data-plain="${isPlain ? "1" : "0"}">
        <div class="item-icon">${icon}</div>
        <div class="item-body">
          <div class="item-top">
            <span class="item-title">${escapeHtml(primary)}</span>
          </div>
          ${timeLabel ? `<div class="item-time">${escapeHtml(timeLabel)}</div>` : ""}
          ${metaLine ? `<div class="item-meta">${escapeHtml(metaLine)}</div>` : ""}
          ${memo ? `<div class="item-memo">${escapeHtml(memo)}</div>` : ""}
          ${imagesHtml}
        </div>
        ${dragHandle}
      </div>
    `;

    return isPlain
      ? `
      <div class="timeline-item-wrap" data-wrap-id="${item.id}">
        <div class="item-delete-bg" aria-hidden="true"><span>삭제</span></div>
        ${card}
      </div>
    `
      : card;
  }

  // ---- 여행(Trip) 헤더 (제목 · 날짜) ----
  // 제목을 눌러 여행지·날짜를 고치던 예전 동작은 없앴다 (MYTRIP-MENU의 '여행 설정'이 아직 준비 중이라
  // 지금은 여행을 만든 뒤 목적지·날짜를 바꿀 방법이 앱에 없다 - 의도된 상태).

  function initTripSettings() {
    renderTripHeader(getTrip());
  }

  // "2026-11-14" ~ "2026-12-12" → "2026.11.14~2026.12.12"
  function tripDateRange(trip) {
    if (!trip?.startDate) return "";
    const end = trip.endDate || trip.startDate;
    const dotted = (dateKey) => dateKey.replaceAll("-", ".");
    return `${dotted(trip.startDate)}~${dotted(end)}`;
  }

  function renderTripHeader(trip) {
    tripTitleEl.textContent = trip?.title || "여행 제목을 설정해주세요";
    tripDatesEl.textContent = tripDateRange(trip);
  }

  // ---- 상단 메뉴 (교통편·숙소. 가계부·여행지갑은 SHELL의 하단 탭으로 옮겨갔다, tripShell.js 참고 - 숙소는
  // 한 번 그리로 옮겼다가 다시 여기로 돌아왔다) ----

  // 교통편 드롭다운: "교통편" 버튼 아래로 항공/기타 목록이 펼쳐진다(가운데 팝업이 아니다). 기차·버스·선박은
  // 더 이상 여기 각자의 항목이 아니다 - "기타"를 고르면 transportForm.js가 여는 창 안의 카테고리 칩으로
  // 들어갔다(사진 인식 과정 없이 전부 직접 입력). .app-top은 sticky라서 그 안에 넣으면 새 stacking
  // context에 갇혀 아래 타임라인 위로 못 떠오를 수 있다 - 그래서 이 목록은 body에 따로 붙이고
  // position: fixed로 버튼의 실제 화면 위치(getBoundingClientRect)에 맞춰 놓는다.
  let transportMenuEl = null;

  function ensureTransportMenu() {
    if (transportMenuEl) return transportMenuEl;
    transportMenuEl = document.createElement("ul");
    transportMenuEl.className = "quick-transport-list";
    transportMenuEl.hidden = true;
    transportMenuEl.setAttribute("role", "listbox");
    transportMenuEl.setAttribute("aria-label", "교통편 선택");
    transportMenuEl.innerHTML = `
      <li class="quick-transport-option" role="option" data-transport="flight">✈️ 항공</li>
      <li class="quick-transport-option" role="option" data-transport="etc">📌 기타</li>`;
    document.body.appendChild(transportMenuEl);

    transportMenuEl.addEventListener("click", (e) => {
      const option = e.target.closest("[data-transport]");
      if (!option) return;
      closeTransportMenu();
      if (option.dataset.transport === "flight") flight.openForm();
      else transportForm.openForm();
    });
    // 바깥을 누르거나(트리거 버튼 자신은 toggle이 처리하므로 제외), 스크롤되거나, Esc를 누르면 닫는다
    document.addEventListener("click", (e) => {
      if (transportMenuEl.hidden) return;
      if (e.target.closest(".quick-transport-list") || e.target.closest('[data-menu="flight"]')) return;
      closeTransportMenu();
    });
    document.addEventListener("scroll", () => closeTransportMenu(), true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeTransportMenu();
    });
    return transportMenuEl;
  }

  function openTransportMenu(triggerBtn) {
    ensureTransportMenu();
    const rect = triggerBtn.getBoundingClientRect();
    transportMenuEl.style.top = `${rect.bottom + 4}px`;
    transportMenuEl.style.left = `${rect.left}px`;
    transportMenuEl.hidden = false;
    triggerBtn.setAttribute("aria-expanded", "true");
  }

  function closeTransportMenu() {
    if (!transportMenuEl || transportMenuEl.hidden) return;
    transportMenuEl.hidden = true;
    document.querySelector('[data-menu="flight"]')?.setAttribute("aria-expanded", "false");
  }

  function initQuickMenu() {
    document.querySelector(".quick-menu").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-menu]");
      if (!btn) return;
      if (btn.dataset.menu === "flight") {
        if (transportMenuEl && !transportMenuEl.hidden) closeTransportMenu();
        else openTransportMenu(btn);
      } else if (btn.dataset.menu === "lodging") {
        const trip = getTrip();
        if (trip) router.navigate(router.buildPath("lodging", { id: trip.id }));
      }
    });
  }

  // ---- 화면 전환 연결 ----

  function closeAllOverlays() {
    document.querySelectorAll(".modal-overlay").forEach((overlay) => (overlay.hidden = true));
    closeTransportMenu();
    timelineDrag.cancel(); // 드래그 도중 화면을 벗어나면(뒤로 가기 등) 원위치로 되돌리고 스크롤 잠금도 풀어 둔다
  }

  function initRouting() {
    // 화면 보호: 로그인하지 않았으면 로그인 화면으로 보내고, 이미 로그인했는데 로그인 화면이면 메인으로 보낸다.
    // 가드는 등록한 순서대로 검사하므로, 아래의 requireConsent·requireTrip보다 먼저 등록해야 로그인 확인이 먼저 된다.
    // 메인이 아닌 화면(예: 초대 링크)에서 쫓겨나면 로그인 뒤에 그 화면으로 돌아오도록 경로를 redirect로 실어 보낸다
    const requireLogin = ({ route, path }) => {
      if (!auth.isRequired() || auth.isLoggedIn()) return true;
      const login = router.buildPath("login");
      return route.name === "main" ? login : `${login}?redirect=${encodeURIComponent(path)}`;
    };
    // consent(약관 동의 화면) 자신도 로그인은 필요하다 - auth.uid()로 user_consents에 저장하는 화면이라서.
    const CONSENT_GATED = [
      "main",
      "travel-feed",
      "discover-city",
      "my-trip",
      "schedule",
      "invite",
      "budget",
      "wallet",
      "lodging",
      "notifications",
      "settings",
      "account-delete",
      "notice",
      "contact",
      "help",
    ];
    [...CONSENT_GATED, "consent"].forEach((name) => router.beforeEnter(name, requireLogin));

    // 로그인은 했지만 아직 user_consents 행이 없으면(storage.hasConsent()) 약관 동의 화면으로 보낸다.
    // storage.refreshConsent()가 서버에 확인하기 전/실패했을 때는 hasConsent()가 기본값 true를 돌려줘서
    // (storage.js의 hasConsent 주석 참고) 이 가드가 모든 화면을 막아버리지 않는다 - 010 마이그레이션을
    // 아직 실행하지 않은 서버에서도 앱이 그대로 동작한다.
    const requireConsent = () => (!auth.isRequired() || !auth.isLoggedIn() || storage.hasConsent() ? true : router.buildPath("consent"));
    CONSENT_GATED.forEach((name) => router.beforeEnter(name, requireConsent));
    // 이미 동의한 사람이 이 화면으로 오면(주소를 직접 입력하는 등) 메인으로 돌려보낸다
    router.beforeEnter("consent", () => (storage.hasConsent() ? router.buildPath("main") : true));

    // 이미 로그인했는데 로그인 화면이면 redirect가 가리키는 화면(없으면 메인)으로 보낸다
    const loginDestination = () => router.safeRedirect(router.query().get("redirect")) ?? router.buildPath("main");
    router.beforeEnter("login", () => (auth.isRequired() && auth.isLoggedIn() ? loginDestination() : true));

    // 로그인에 막 성공한 순간(아래 auth.init() 이후, 또는 로그인 화면에 머무는 중 auth.onChange로 로그인됨을
    // 알게 된 순간) 쓰는 공통 경로: user_consents를 먼저 확인한 뒤에야 어디로 보낼지 정한다. 순서가 중요하다 -
    // 먼저 navigate부터 하면 위 requireConsent 가드가 아직 갱신되지 않은 캐시(기본값 true)를 보고 동의
    // 화면으로 보내지 못할 수 있다.
    async function enterApp() {
      await storage.refreshConsent();
      router.navigate(storage.hasConsent() ? loginDestination() : router.buildPath("consent"));
    }

    // 로그인·로그아웃이 화면을 보고 있는 중에(로그아웃 버튼, 다른 탭, 세션 만료) 일어나면 그 상태에 맞는 화면으로 옮긴다
    auth.onChange(() => {
      syncTripsOnAuthChange();
      const name = router.current()?.route.name;
      if (!name || !auth.isRequired()) return;
      if (!auth.isLoggedIn() && name !== "login") router.navigate(router.buildPath("login"));
      else if (auth.isLoggedIn() && name === "login") enterApp();
    });

    // 여행 ID가 가리키는 여행이 없으면 메인으로 돌려보낸다. 있으면 그 여행을 "지금 보는 여행"으로 정한다.
    const requireTrip = ({ params }) => (setCurrentTrip(params.id) ? true : router.buildPath("main"));
    router.beforeEnter("my-trip", requireTrip);
    router.beforeEnter("schedule", requireTrip);
    router.beforeEnter("budget", requireTrip);
    router.beforeEnter("wallet", requireTrip);
    router.beforeEnter("lodging", requireTrip);

    // 일정 화면에 들어올 때마다 선택된 여행의 데이터로 다시 그린다
    router.onEnter("schedule", () => enterSchedule());
    // 열려 있던 모달이 다른 화면 위에 남지 않게 한다 (예: 뒤로 가기)
    router.onLeave("schedule", closeAllOverlays);
    // 메인에서는 특정 여행을 보고 있지 않다
    router.onEnter("main", () => setCurrentTrip(null));
    // 로그인 여부를 알고 나서 첫 화면을 정한다 (소셜 로그인에서 막 돌아왔다면 세션이 만들어지는 것까지 기다린다).
    // 주소로 바로 들어온 #/my-trip/:id도 알아볼 수 있게, 내 여행 목록을 먼저 서버에서 받아 둔다.
    auth.init().then(async () => {
      // 초대 링크 등을 열었다가 로그인하러 나갔다 돌아왔다면(소셜 로그인은 #/main으로 돌아온다) 원래 가려던 화면으로 보낸다
      if (auth.isLoggedIn()) {
        const next = router.safeRedirect(auth.takePostLoginPath());
        if (next && ["/main", "/login"].includes(router.readPath())) history.replaceState(null, "", `#${next}`);
      }
      try {
        await storage.refreshTrips();
      } catch (err) {
        ui.showToast(err.message);
      }
      // router.start()의 첫 render()에서부터 위 requireConsent 가드가 올바른 값을 보도록, 화면을 띄우기
      // 전에 미리 확인해 둔다(실패해도 던지지 않으므로 try/catch가 필요 없다 - storage.js의 refreshConsent 참고).
      if (auth.isLoggedIn()) await storage.refreshConsent();
      // 네이티브 앱이고 이미 로그인돼 있으면: OS 알림 권한이 이전에 허용된 상태인지 확인해서, 허용돼
      // 있으면 register()를 다시 불러 토큰을 갱신한다(기기 재설치, FCM 토큰 로테이션 등으로 전에 저장해 둔
      // 값이 낡았을 수 있어서 - 요청 6번). 화면을 띄우는 것과 무관한 백그라운드 작업이라 기다리지 않는다.
      if (auth.isLoggedIn() && auth.isNativeApp()) window.TripLog.pushNotifications?.refreshIfAlreadyGranted();
      router.start();
    });
  }

  // 일정 화면에 들어올 때마다 그 여행의 일정을 서버에서 받아 다시 그린다.
  // 처음 받는 여행은 "불러오는 중" 안내를 보여주고, 받아 둔 적 있으면 캐시로 먼저 그린 뒤 새로 고친다.
  let scheduleEnterId = 0;

  async function enterSchedule() {
    const trip = getTrip();
    const enterId = ++scheduleEnterId;
    renderTripHeader(trip);
    refreshDday();
    timelineLoading = Boolean(trip) && !storage.isItemsLoaded(trip.id);
    renderTimeline();
    if (!trip) return;

    try {
      await storage.loadItems(trip.id);
    } catch (err) {
      ui.showToast(err.message);
    }
    if (enterId !== scheduleEnterId || getTrip()?.id !== trip.id) return; // 그 사이에 다른 화면이나 다른 여행으로 옮겼다
    timelineLoading = false;
    renderTimeline();
  }

  // 다른 탭에서 로그인·로그아웃하거나 계정이 바뀌면 그 사용자의 여행 목록으로 바꾼다 (같은 사용자면 아무것도 하지 않는다)
  function syncTripsOnAuthChange() {
    storage.syncUser().catch((err) => ui.showToast(err.message));
  }

  // 별칭 보기(개발용): 주소에 ?alias=1을 붙이거나 Alt+Shift+A를 누르면 화면의 각 부분 위에 별칭(comments.html 참고)이 표시된다.
  // 평소에는 내려받지 않고, 처음 켤 때만 js/aliasView.js를 불러온다.
  function initAliasView() {
    let loading = null;
    const load = () => {
      loading ??= new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "js/aliasView.js";
        script.onload = () => resolve(window.TripLog.aliasView);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      });
      return loading;
    };
    if (new URLSearchParams(location.search).get("alias") === "1") load().then((view) => view?.setEnabled(true));
    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && e.code === "KeyA") load().then((view) => view?.toggle());
    });
  }

  // 타임라인 카드 드래그 핸들로 순서 바꾸기(다른 Day로도 이동 가능) · 가로로 스와이프해서 삭제하기 (timelineDrag.js)
  function initTimelineDrag() {
    timelineDrag.init(timelineEl, {
      // dateChange: 다른 Day로 옮겨졌을 때만 { id, date } (같은 Day 안에서만 순서를 바꿨으면 null)
      onReorder: async (orderedIds, dateChange) => {
        try {
          const overrides = dateChange ? { [dateChange.id]: { date: dateChange.date } } : undefined;
          await storage.reorderItems(orderedIds, overrides);
        } catch (err) {
          ui.showToast(err.message);
        } finally {
          renderTimeline(); // 성공/실패 관계없이 서버(캐시) 기준으로 다시 그려서 번호·거리 표시를 새 순서에 맞춘다
        }
      },
      onDelete: async (id) => {
        try {
          await deleteItemById(id);
        } catch (err) {
          ui.showToast(err.message);
          renderTimeline(); // 실패하면 지워진 것처럼 보이던 카드를 되돌린다
        }
      },
    });
  }

  dayMap.init();
  initSchedule(renderTimeline);
  flight.init(renderTimeline);
  transportForm.init(renderTimeline);
  initQuickMenu();
  initDday();
  initTripSettings();
  initTimelineDrag();
  initRouting();
  initAliasView();
})();
