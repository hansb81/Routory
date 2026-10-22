// @별칭 MAIN · 메인 화면 (#/main)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 메인 화면(#/main): 위쪽엔 로고(MAIN-HEAD)와 계정 표시·메뉴, 아래쪽에는 등록된 여행 카드 목록.
// 카드를 누르면 #/schedule/:id로 이동하고, 여행이 없으면 "새 여행 만들기" 안내를 보여준다.
// "새 여행 만들기"는 2단계 마법사(tripSetup.js: 여행지 선택 → 날짜 선택)로 진행하고, 끝나면 여행을 만든다.
// "여행 가져오기"는 tripImport.js의 모달을 mode: "create"로 연다(tripId 없음 - 분석 결과로 새 여행을 만든다, PRD v8) -
// 원래 여기 목록 위에 버튼으로 있었으나, 오른쪽 상단 계정 옆 메뉴(MAIN-MENU)로 옮겼다(기능은 그대로).

(function () {
  const storage = window.TripLog.storage;
  const { getAllTrips, createTrip, loadItems, getItems, deleteTrip, leaveTrip, loadMembers } = storage;
  const { deleteImage } = window.TripLog.images;
  const { escapeHtml, ddayLabel, daysUntil, nightsBetween } = window.TripLog.util;
  const router = window.TripLog.router;
  const tripSetup = window.TripLog.tripSetup;
  const tripImport = window.TripLog.tripImport;
  const auth = window.TripLog.auth;
  const ui = window.TripLog.ui;

  let pageEl = null;
  const FRESH_MS = 3000; // 앱을 시작하며 방금 받은 목록이면 메인 화면이 또 받지 않는다
  let loadError = ""; // 여행 목록을 서버에서 받지 못했을 때의 안내 (받는 데 성공하면 비운다)

  // 아이콘은 SHELL(tripShell.js)과 같은 currentColor 24x24 선 아이콘 규칙을 쓴다
  const MENU_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;

  // 이름의 첫 글자를 깔아 두고 그 위에 사진을 얹는다: 사진이 없거나 못 불러오면 글자가 보인다.
  // 헤더의 계정 아이콘(MAIN-ACCOUNT)과 메뉴 안 프로필 줄(MAIN-MENU)이 이 구조를 그대로 공유하고,
  // 크기만 각자의 CSS 클래스(.main-avatar / .main-menu-profile-avatar)가 다르게 잡는다.
  function profileAvatarHtml(profile, className) {
    const initial = (profile.name ?? "?").slice(0, 1);
    return `<span class="${className}">
      <span class="${className}-initial">${escapeHtml(initial)}</span>
      ${profile.avatarUrl ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : ""}
    </span>`;
  }

  // ---- 로고 · 계정 · 메뉴 ----

  function headHtml() {
    return `
      <header class="main-head" data-alias="MAIN-HEAD · 로고 · 계정 · 메뉴">
        <span class="main-logo">
          <span class="main-logo-icon"><img src="img/login-icon.png" alt="" /></span>
          <span class="main-logo-text">Routory</span>
        </span>
        ${accountHtml()}
      </header>`;
  }

  // 로그인한 사용자의 아이콘·이름만 보여준다(로그인 플랫폼은 표시하지 않는다) + 메뉴 버튼
  // (로그인을 쓰지 않는 상태에서는 보여주지 않는다 - 이때는 로고만 남는다)
  function accountHtml() {
    const profile = auth.getProfile();
    if (!auth.isRequired() || !profile) return "";
    return `
      <div class="main-account" data-alias="MAIN-ACCOUNT · 계정 아이콘·이름 + 메뉴 버튼">
        ${profileAvatarHtml(profile, "main-avatar")}
        <span class="main-account-name">${escapeHtml(profile.name ?? "")}님</span>
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="menu" aria-label="메뉴" aria-haspopup="dialog" aria-expanded="false">${MENU_ICON}</button>
      </div>`;
  }

  // ---- 여행 카드 ----

  const dotted = (dateKey) => dateKey.replaceAll("-", ".");

  // "2026.11.14 ~ 2026.11.18 · 4박 5일" (하루짜리는 "2026.11.14 · 당일")
  function formatPeriod(trip) {
    const end = trip.endDate || trip.startDate;
    if (end === trip.startDate) return `${dotted(trip.startDate)} · 당일`;
    const nights = nightsBetween(trip.startDate, end);
    return `${dotted(trip.startDate)} ~ ${dotted(end)} · ${nights}박 ${nights + 1}일`;
  }

  // 일정이 끝난 여행 - "내 여행"에는 더 이상 보이지 않고, MAIN-MENU의 "지난 여행"에서만 보인다
  const isPastTrip = (trip) => daysUntil(trip.endDate || trip.startDate) < 0;
  const byStart = (a, b) => a.startDate.localeCompare(b.startDate);

  // 아직 끝나지 않은 여행을 가까운 순으로
  function sortUpcoming(trips) {
    return trips.filter((t) => !isPastTrip(t)).sort(byStart);
  }

  // 지난 여행을 최근에 끝난 순으로
  function sortPast(trips) {
    return trips.filter(isPastTrip).sort((a, b) => byStart(b, a));
  }

  function tripCardHtml(trip) {
    const past = isPastTrip(trip);
    const destination = trip.destination || trip.title || "여행지 미정";
    const title = trip.title && trip.title !== destination ? trip.title : "";
    return `
      <div class="trip-card-wrap" data-trip-id="${escapeHtml(trip.id)}">
        <div class="trip-card-delete-bg" aria-hidden="true"><span>삭제</span></div>
        <a class="trip-card" href="#${router.buildPath("schedule", { id: trip.id })}">
          <span class="trip-card-main">
            <span class="trip-card-dest-row">
              <span class="trip-card-dest">${escapeHtml(destination)}</span>
              <span class="trip-card-avatars" data-avatars="${escapeHtml(trip.id)}"></span>
            </span>
            ${title ? `<span class="trip-card-title">${escapeHtml(title)}</span>` : ""}
            <span class="trip-card-period">${escapeHtml(formatPeriod(trip))}</span>
          </span>
          <span class="dday-badge trip-card-dday${past ? " trip-card-dday--past" : ""}">${ddayLabel(trip.startDate)}</span>
        </a>
      </div>`;
  }

  // ---- 여행 카드의 동료 아바타(소셜 로그인 프로필 사진) ----
  // 여행마다 loadMembers를 한 번씩 불러 겹친 원형 아바타로 보여준다(항상 나 자신은 포함되고, 동행자가
  // 있으면 이어서 보인다). 4명까지 겹쳐 보이고 5명 이상이면 "+N"으로 마무리한다(tripMembers.js의
  // MAX_AVATARS=3·"+N명" 표시와 같은 원리, 카드가 더 넓어서 개수만 다르다).
  const MAX_CARD_AVATARS = 4;
  const memberCache = new Map(); // tripId -> members[] (화면에 있는 동안은 다시 묻지 않는다)
  let avatarRun = 0;

  // 나는 로그인 정보의 이름·사진을 쓴다 (서버 함수 get_trip_members가 없어 이름을 못 받은 경우에도 내 이름은 보인다).
  // tripMembers.js의 withSelf와 같은 로직 - 그 모듈은 이 함수를 내보내지 않아서 여기서 다시 둔다.
  function withSelf(members) {
    const myId = auth.getUserId();
    const profile = auth.getProfile();
    return members.map((m) => (m.userId === myId && profile ? { ...m, name: m.name || profile.name, avatarUrl: m.avatarUrl || profile.avatarUrl } : m));
  }

  function cardAvatarHtml(member) {
    const initial = (member.name || "?").slice(0, 1);
    return `<span class="trip-card-avatar" title="${escapeHtml(member.name || "이름 없는 멤버")}">
      <span class="trip-card-avatar-initial">${escapeHtml(initial)}</span>
      ${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : ""}
    </span>`;
  }

  function avatarsHtml(members) {
    const shown = members.slice(0, MAX_CARD_AVATARS);
    const rest = members.length - shown.length;
    return `${shown.map(cardAvatarHtml).join("")}${rest > 0 ? `<span class="trip-card-avatar-more">+${rest}</span>` : ""}`;
  }

  // 화면에 걸린 카드마다 멤버를 받아 아바타 자리를 채운다. 못 받으면(RLS 등) 그 카드는 그냥 비워 둔다.
  // root는 카드가 그려진 화면(main 또는 past-trips의 el) - 두 화면이 이 함수를 함께 쓴다.
  function hydrateCardAvatars(trips, root) {
    const run = ++avatarRun;
    trips.forEach(async (trip) => {
      let members = memberCache.get(trip.id);
      if (!members) {
        try {
          members = withSelf(await loadMembers(trip.id));
          memberCache.set(trip.id, members);
        } catch (err) {
          return; // 못 받으면 제목만 보인다
        }
      }
      if (run !== avatarRun || !root || root.hidden) return; // 그 사이에 화면을 떠났거나 다시 그렸다
      const slot = root.querySelector(`[data-avatars="${CSS.escape(trip.id)}"]`);
      if (slot && members.length) slot.innerHTML = avatarsHtml(members);
    });
  }

  // 프로필 사진을 못 불러오면(error는 버블링되지 않아 캡처로 받는다) 사진을 치워 깔아 둔 글자가 보이게 한다.
  // tripShell.js도 같은 profileAvatarHtml 구조(.mytrip-bar-avatar)를 가져다 써서 이 함수를 함께 쓴다.
  function removeBrokenAvatars(root) {
    root.addEventListener(
      "error",
      (e) => {
        if (e.target.matches?.(".main-avatar img, .trip-card-avatar img, .main-menu-profile-avatar img, .mytrip-bar-avatar img")) e.target.remove();
      },
      true
    );
  }

  // ---- 화면 ----

  function render(el) {
    pageEl = el;
    const trips = sortUpcoming(getAllTrips());

    // 서버에서 목록을 받기 전에는 "여행이 없다"고 보여주지 않는다
    const tripsHtml = trips.length
      ? `<div class="trip-cards">${trips.map(tripCardHtml).join("")}</div>`
      : loadError
      ? `<div class="empty-state">
           <p class="empty-title">여행 목록을 불러오지 못했어요</p>
           <p class="empty-desc">${escapeHtml(loadError)}</p>
           <button type="button" class="btn btn-save" data-action="retry">다시 불러오기</button>
         </div>`
      : !storage.isTripsLoaded()
      ? `<div class="empty-state"><p class="empty-desc">여행 목록을 불러오는 중이에요...</p></div>`
      : `<div class="empty-state">
           <p class="empty-title">아직 등록된 여행이 없어요</p>
           <p class="empty-desc">새 여행을 만들고 일정을 계획해보세요.</p>
           <button type="button" class="btn btn-save" data-action="new-trip">새 여행 만들기</button>
         </div>`;

    el.innerHTML = `
      ${headHtml()}

      <section class="main-trips" aria-label="내 여행" data-alias="MAIN-TRIPS · 내 여행 카드 목록">
        <div class="main-trips-head">
          <h2 class="main-section-title">내 여행${trips.length ? ` <span>${trips.length}</span>` : ""}</h2>
          ${
            trips.length
              ? `<div class="main-trips-head-actions">
                   <button type="button" class="main-new-btn" data-action="new-trip">+ 새 여행</button>
                 </div>`
              : ""
          }
        </div>
        ${tripsHtml}
      </section>

      ${trips.length ? window.TripLog.travelFeed.mainSectionHtml() + window.TripLog.travelFeed.discoverSectionHtml() : ""}`;
    // 요청 1번: 여행이 하나도 없으면 "새 여행 만들기" 안내만 보여주고 그 아래(여행 소식·어디로 떠나볼까요)는
    // 아예 안 그려서 빈 상태 안내가 화면을 채운다 - 여행이 없는 사람에게 "내 여행지/내 항공편" 매칭이나
    // "미리 선택된 여행 만들기"나 애초에 의미가 같이 없다.

    if (trips.length) {
      window.TripLog.travelFeed.initMainSection(el.querySelector(".main-feed"));
      window.TripLog.travelFeed.initDiscoverSection(el.querySelector(".main-popular"));
    }

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="new-trip"]')) openTripSetup();
        if (e.target.closest('[data-action="retry"]')) loadTrips();
        if (e.target.closest('[data-action="menu"]')) setMenu(true);
      });
      removeBrokenAvatars(el);
      el.addEventListener("pointerdown", handleCardPointerDown);
    }

    if (trips.length) hydrateCardAvatars(trips, el);
  }

  // ---- 새 여행 만들기 (2단계 마법사) ----

  // 1단계 여행지 → 2단계 날짜를 마치면 여행을 만든다. 제목은 "<도시> 여행"으로 정해지고, 나중에 일정 화면에서 바꿀 수 있다.
  function openTripSetup() {
    tripSetup.open({
      trip: null,
      canClose: true,
      onComplete: async ({ cityId, cityName, destination, destinationId, timezone, lat, lng, currency, startDate, endDate }) => {
        try {
          await createTrip({ title: `${cityName} 여행`, destination, cityId, destinationId, timezone, lat, lng, currency, startDate, endDate });
        } catch (err) {
          ui.showToast(err.message);
          return;
        }
        render(pageEl);
        ui.showToast(`'${cityName} 여행'을 만들었어요.`);
      },
    });
  }

  // ---- 오른쪽 상단 메뉴(MAIN-MENU): 알림·설정 + 여행 가져오기 ----
  // SHELL의 우측 슬라이드 메뉴(tripShell.js MYTRIP-MENU)와 같은 CSS(.mytrip-drawer 등)를 그대로 쓴다 -
  // 여행 화면에 종속된 클래스가 아니라 "우측에서 미끄러져 나오는 메뉴"라는 범용 레이아웃이라, Conventions에서
  // 말하는 .wizard*/.pick-list처럼 재사용 대상이다. SHELL은 my-trip/schedule/budget/wallet/lodging에서만
  // 보이고 main에서는 숨어 있어서 이 화면 전용 메뉴가 따로 필요했다.
  // 패널 헤드: 닫기(✕)는 왼쪽 끝, 알림(🔔)·설정(⚙, commonPages.js의 공용 화면으로 이동)은 오른쪽 끝에
  // 두 아이콘만 바짝 붙여 묶는다(.mytrip-panel-head-actions, 둘 다 tripShell.js MYTRIP-MENU와 같은
  // 아이콘을 commonPages.js에서 가져다 쓴다). 로그아웃·설정(예전 더미 토스트)은 다른 위치로 옮길
  // 예정이라 일단 뺐고, 패널 헤드의 "메뉴" 글자도 함께 뺐다.

  let menuEl = null;

  // 메뉴 패널 헤드 바로 아래의 프로필 줄: 왼쪽 로그인 이름, 오른쪽 프로필 아이콘(헤더의 .main-avatar
  // 28px보다 50% 더 크게, 54px - 이 메뉴에서 유일하게 강조하는 아이콘이라 눈에 먼저 띄어야 한다).
  // 프로필이 없으면(로그인을 안 쓰는 상태) 통째로 비운다.
  function menuProfileHtml() {
    const profile = auth.getProfile();
    if (!auth.isRequired() || !profile) return "";
    return `
      <div class="main-menu-profile">
        <span class="main-menu-profile-name">${escapeHtml(profile.name ?? "")}님</span>
        ${profileAvatarHtml(profile, "main-menu-profile-avatar")}
      </div>`;
  }

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.className = "mytrip-drawer main-menu"; // main-menu: 이 메뉴 안에서만 다르게 줄 크기(닫기 버튼 등)를 잡는 훅
    menuEl.hidden = false; // is-open으로 여닫는다(닫힌 기본 상태는 CSS의 visibility:hidden이 맡는다)
    menuEl.dataset.alias = "MAIN-MENU · 메인 화면 우측 슬라이드 메뉴";
    const { ICONS } = window.TripLog.commonPages;
    menuEl.innerHTML = `
      <div class="mytrip-backdrop" data-action="close"></div>
      <aside class="mytrip-panel" role="dialog" aria-modal="true" aria-label="메뉴">
        <div class="mytrip-panel-head">
          <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark main-menu-close" data-action="close" aria-label="메뉴 닫기">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
          </button>
          <span class="mytrip-panel-head-actions">
            <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="notifications" aria-label="알림">${ICONS.bell}</button>
            <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="settings" aria-label="설정">${ICONS.gear}</button>
          </span>
        </div>
        ${menuProfileHtml()}
        <ul class="mytrip-menu">
          <li><button type="button" data-action="import-trip">여행 가져오기</button></li>
          <li><button type="button" data-action="past-trips">지난 여행</button></li>
          <li><button type="button" data-action="travel-benefit">여행 혜택·축제</button></li>
          <li><button type="button" data-action="travel-safety">여행 안전</button></li>
        </ul>
        <div class="main-menu-links">
          <button type="button" data-action="notice">공지사항</button>
          <button type="button" data-action="contact">문의하기</button>
        </div>
      </aside>`;
    document.body.appendChild(menuEl);
    removeBrokenAvatars(menuEl); // menuEl은 pageEl 밖의 별도 트리라 render()가 el에 건 캡처 리스너가 안 닿는다

    menuEl.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="close"]')) setMenu(false);
      else if (e.target.closest('[data-action="import-trip"]')) {
        setMenu(false);
        tripImport.open({ mode: "create" }); // tripId 없음 - 분석 결과로 새 여행을 만든다
      } else if (e.target.closest('[data-action="past-trips"]')) {
        setMenu(false);
        router.navigate(router.buildPath("past-trips"));
      } else if (e.target.closest('[data-action="travel-benefit"]')) {
        setMenu(false);
        router.navigate(`${router.buildPath("travel-feed")}?kind=benefit&scope=overseas`);
      } else if (e.target.closest('[data-action="travel-safety"]')) {
        setMenu(false);
        router.navigate(`${router.buildPath("travel-feed")}?kind=safety`);
      } else if (e.target.closest('[data-action="notice"]')) {
        setMenu(false);
        router.navigate(router.buildPath("notice"));
      } else if (e.target.closest('[data-action="contact"]')) {
        setMenu(false);
        router.navigate(router.buildPath("contact"));
      } else if (e.target.closest('[data-action="notifications"]')) {
        setMenu(false);
        router.navigate(router.buildPath("notifications"));
      } else if (e.target.closest('[data-action="settings"]')) {
        setMenu(false);
        router.navigate(router.buildPath("settings"));
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isMenuOpen()) setMenu(false);
    });

    return menuEl;
  }

  function isMenuOpen() {
    return Boolean(menuEl?.classList.contains("is-open"));
  }

  function setMenu(open) {
    ensureMenu();
    menuEl.classList.toggle("is-open", open);
    menuEl.setAttribute("aria-hidden", String(!open));
    const btn = pageEl?.querySelector('[data-action="menu"]');
    btn?.setAttribute("aria-expanded", String(open));
    (open ? menuEl.querySelector('[data-action="close"].mytrip-icon-btn') : btn)?.focus();
  }

  // ---- 여행 카드 스와이프해서 삭제 ----
  // 일정 화면의 스와이프 삭제(timelineDrag.js)와 같은 원리(가로로 SWIPE_START_PX 이상 밀면 확정, 카드는
  // 손가락을 1:1로 따라간다)지만, 여기서는 50% 지점에서 곧바로 지우지 않고 확인창을 띄운다 - 여행 삭제는
  // 되돌릴 수 없어서(일정이 전부 함께 사라진다) 되돌리기 쉬운 일정 카드보다 한 단계 더 신중해야 한다.
  const SWIPE_START_PX = 10;
  const SWIPE_CONFIRM_RATIO = 0.5;
  const SWIPE_REVEAL_PX = 84; // 확인창이 뜨는 동안 카드가 멈춰 있을 자리(삭제 글자가 드러날 만큼)

  let swipe = null; // 진행 중인 스와이프 제스처(한 번에 하나) - { pointerId, wrap, card, tripId, startX, startY, mode, width, confirming }

  // 마우스는 눌렀던 자리에서 떼면 움직인 거리와 무관하게 click을 그대로 내는데, 카드가 <a>라 그 click이
  // 곧바로 일정 화면으로 이동시켜 버린다 - 스와이프가 확정된 다음의 click 한 번만 가로채 막는다.
  function suppressNextClick(card) {
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      card.removeEventListener("click", handler, true);
    };
    card.addEventListener("click", handler, true);
  }

  function handleCardPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // 마우스 왼쪽 버튼(또는 터치/펜)만
    if (swipe) return;
    const wrap = e.target.closest(".trip-card-wrap");
    if (!wrap) return;
    const card = wrap.querySelector(".trip-card");
    swipe = { pointerId: e.pointerId, wrap, card, tripId: wrap.dataset.tripId, startX: e.clientX, startY: e.clientY, mode: "pending" };
    try {
      card.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 이미 풀렸거나 못 잡는 환경이면 무시 - 아래 리스너는 document에 걸려 있어 상관없다 */
    }
    document.addEventListener("pointermove", handleCardPointerMove);
    document.addEventListener("pointerup", handleCardPointerUp);
    document.addEventListener("pointercancel", handleCardPointerCancel);
  }

  function handleCardPointerMove(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    if (swipe.confirming) return; // 확인창이 뜬 다음엔 손가락이 더 움직여도 무시한다
    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;

    if (swipe.mode === "pending") {
      if (Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy)) {
        swipe.mode = "swiping";
        swipe.width = swipe.wrap.getBoundingClientRect().width;
        suppressNextClick(swipe.card);
      }
      return; // 세로로 조금 움직이는 것 정도는 그냥 스크롤이 되게 둔다
    }

    e.preventDefault();
    const x = Math.min(0, dx); // 오른쪽으로는 못 밀리게
    swipe.card.style.transform = `translateX(${x}px)`;
    if (swipe.width && Math.abs(x) >= swipe.width * SWIPE_CONFIRM_RATIO) confirmSwipeDelete();
  }

  function handleCardPointerUp(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    if (swipe.mode === "swiping" && !swipe.confirming) snapCardBack(swipe.card);
    cleanupSwipe();
  }

  function handleCardPointerCancel(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    if (swipe.mode === "swiping" && !swipe.confirming) snapCardBack(swipe.card);
    cleanupSwipe();
  }

  function cleanupSwipe() {
    if (!swipe) return;
    document.removeEventListener("pointermove", handleCardPointerMove);
    document.removeEventListener("pointerup", handleCardPointerUp);
    document.removeEventListener("pointercancel", handleCardPointerCancel);
    try {
      swipe.card.releasePointerCapture(swipe.pointerId);
    } catch (err) {
      /* 이미 풀렸으면 무시 */
    }
    swipe = null;
  }

  function snapCardBack(card) {
    card.style.transition = "transform 0.2s ease";
    card.style.transform = "";
    setTimeout(() => {
      card.style.transition = "";
    }, 220);
  }

  function confirmSwipeDelete() {
    if (swipe.confirming) return;
    swipe.confirming = true;
    const trip = getAllTrips().find((t) => t.id === swipe.tripId);
    if (!trip) return; // 그 사이 목록이 바뀌었다(드물다) - 그냥 아무 일도 없던 것처럼 둔다
    swipe.card.style.transition = "transform 0.15s ease";
    swipe.card.style.transform = `translateX(-${SWIPE_REVEAL_PX}px)`;
    openDeleteConfirm(trip, swipe.card);
  }

  // ---- 스와이프 확인창: "여행을 삭제하시겠습니까?" (owner면 삭제, 초대받은 참여자면 나가기) ----
  // tripShell.js의 MYTRIP-EXIT-CONFIRM(EXIT_TEXT)과 같은 규칙이다: 삭제는 서버에서 여행과 딸린 데이터가
  // 모두 지워지고, 나가기는 내 멤버십만 지워지고 여행과 일정은 남는다. tripShell은 이 화면과 별도의
  // DOM/모듈이라 로직을 그대로 가져다 쓸 수 없어 같은 규칙으로 다시 둔다.

  let deleteOverlay = null;
  let deleteTarget = null; // { trip, card } - 취소하면 card를 제자리로 되돌린다
  let deleting = false;

  function ensureDeleteModal() {
    if (deleteOverlay) return;
    deleteOverlay = document.createElement("div");
    deleteOverlay.className = "modal-overlay";
    deleteOverlay.dataset.alias = "MAIN-TRIP-DELETE-CONFIRM · 여행 카드 스와이프 삭제 확인창";
    deleteOverlay.hidden = true;
    deleteOverlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="main-trip-delete-title">
        <h2 class="modal-title" id="main-trip-delete-title"></h2>
        <p class="trip-exit-note" data-note></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
            <button type="button" class="btn btn-danger" data-action="ok"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(deleteOverlay);

    deleteOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="cancel"]')) closeDeleteModal();
      else if (e.target.closest('[data-action="ok"]')) performDelete();
    });
    deleteOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDeleteModal();
    });
  }

  function openDeleteConfirm(trip, card) {
    ensureDeleteModal();
    const isOwner = trip.role === "owner";
    deleteTarget = { trip, card, isOwner };
    const name = trip.title || trip.destination || "여행";
    deleteOverlay.querySelector("#main-trip-delete-title").textContent = isOwner ? `'${name}' 여행을 삭제하시겠습니까?` : `'${name}' 여행에서 나가시겠습니까?`;
    deleteOverlay.querySelector("[data-note]").textContent = isOwner
      ? "이 여행의 일정, 초대 링크, 참여한 사람 정보가 모두 사라지고 되돌릴 수 없어요."
      : "나가면 이 여행이 내 목록에서 사라져요. 초대 링크가 아직 유효하면 다시 들어올 수 있어요.";
    deleteOverlay.querySelector('[data-action="ok"]').textContent = isOwner ? "삭제" : "나가기";
    deleteOverlay.hidden = false;
    deleteOverlay.querySelector('[data-action="cancel"]').focus();
  }

  // 취소(또는 Esc)로 닫을 때만 카드를 제자리로 되돌린다 - 삭제 성공 후에는 목록이 통째로 다시 그려져서
  // card가 이미 화면에서 떨어져 나간 뒤라 되돌릴 대상이 없다(performDelete에서 직접 처리).
  function closeDeleteModal() {
    if (deleteOverlay) deleteOverlay.hidden = true;
    if (deleting) return;
    if (deleteTarget) snapCardBack(deleteTarget.card);
    deleteTarget = null;
  }

  async function performDelete() {
    if (!deleteTarget || deleting) return;
    const { trip, isOwner } = deleteTarget;
    const okBtn = deleteOverlay.querySelector('[data-action="ok"]');
    deleting = true;
    okBtn.disabled = true;
    okBtn.textContent = isOwner ? "삭제 중..." : "나가는 중...";
    try {
      await loadItems(trip.id).catch(() => {});
      const imageIds = getItems()
        .filter((item) => item.tripId === trip.id)
        .flatMap((item) => item.images ?? []);
      await (isOwner ? deleteTrip(trip.id) : leaveTrip(trip.id));
      imageIds.forEach((id) => deleteImage(id));
    } catch (err) {
      ui.showToast(err.message);
      deleting = false;
      okBtn.disabled = false;
      okBtn.textContent = isOwner ? "삭제" : "나가기";
      return; // 모달은 열어 둔다 - 실패해도 다시 시도할 수 있게
    }
    deleting = false;
    deleteOverlay.hidden = true;
    const name = trip.title || trip.destination || "여행";
    deleteTarget = null;
    memberCache.delete(trip.id);
    // storage.deleteTrip/leaveTrip이 캐시를 바꾸고 notify()를 불러서 아래 storage.onChange가 이미
    // 목록을 다시 그렸다(그 카드는 사라졌다) - 여기서는 토스트만 보여주면 된다.
    ui.showToast(isOwner ? `'${name}' 여행을 삭제했어요.` : `'${name}' 여행에서 나갔어요.`);
  }

  // ---- 지난 여행 (MAIN-MENU "지난 여행", #/past-trips) ----
  // 일정이 끝난 여행만 모아 보여주는 목록 화면이다. 알림·설정과 같은 "SHELL 없는 보통 .page" 화면이라
  // commonPages.js의 .simple-page-header/-title/-empty를 그대로 쓰고, 배경도 그 화면들과 같은
  // body.has-simple-page-bg(--surface-blue, #d6e4fb)를 그대로 재사용한다(새 배경 클래스를 만들지 않는다).
  // 카드 모양은 "내 여행"의 tripCardHtml을 그대로 쓰지만, 스와이프 삭제는 여기서는 묶지 않는다(지난
  // 여행을 지우는 길은 아직 없다 - 필요해지면 그때 추가).

  let pastPageEl = null;

  function renderPastTrips(el) {
    pastPageEl = el;
    const { ICONS } = window.TripLog.commonPages;
    const trips = sortPast(getAllTrips());
    el.innerHTML = `
      <header class="simple-page-header">
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="back" aria-label="뒤로">${ICONS.back}</button>
        <h1 class="simple-page-title">지난 여행</h1>
      </header>
      ${trips.length ? `<div class="trip-cards">${trips.map(tripCardHtml).join("")}</div>` : `<p class="simple-page-empty">지난 여행이 없습니다.</p>`}`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="back"]')) history.back();
      });
      removeBrokenAvatars(el);
    }

    if (trips.length) hydrateCardAvatars(trips, el);
  }

  router.definePage("past-trips", renderPastTrips);
  router.onEnter("past-trips", () => document.body.classList.add("has-simple-page-bg"));
  router.onLeave("past-trips", () => document.body.classList.remove("has-simple-page-bg"));

  // ---- 내 여행 목록 불러오기 ----

  // 서버에서 내가 속한(초대받은 것 포함) 여행을 받아 온다. 받으면 storage.onChange가 화면을 다시 그리게 한다.
  async function loadTrips() {
    try {
      await storage.refreshTrips({ maxAgeMs: FRESH_MS });
      loadError = "";
    } catch (err) {
      loadError = err.message;
      if (pageEl && !pageEl.hidden) render(pageEl);
    }
  }

  // 여행 목록 캐시가 바뀌면(서버에서 새로 받음, 로그아웃) 메인/지난 여행 화면을 보고 있을 때 다시 그린다
  storage.onChange(() => {
    if (pageEl && !pageEl.hidden) render(pageEl);
    if (pastPageEl && !pastPageEl.hidden) renderPastTrips(pastPageEl);
  });

  // 파스텔 블루 배경(지금은 메인 화면만 - 다른 화면은 각자 작업할 때 차례로 적용한다): body에 클래스를
  // 얹고 벗기는 방식이라(SHELL의 body.has-trip-shell과 같은 패턴) .page의 padding 바깥(좁은 화면에선
  // 거의 없지만 넓은 화면의 좌우 여백)까지 화면 전체가 덮인다.
  router.definePage("main", render);
  router.onEnter("main", loadTrips); // 들어올 때마다 서버의 최신 목록으로 새로 고친다
  router.onEnter("main", () => document.body.classList.add("has-main-bg"));
  router.onLeave("main", () => {
    tripSetup.close();
    if (menuEl) setMenu(false);
    document.body.classList.remove("has-main-bg");
  }); // 뒤로 가기로 떠날 때 마법사·메뉴가 다른 화면 위에 남지 않게 하고, 파스텔 배경도 다른 화면에 새지 않게 벗긴다

  // tripShell.js의 MYTRIP-MENU·MYTRIP-TOPBAR도 같은 프로필 아이콘 구조를 가져다 쓴다
  window.TripLog.mainPage = { profileAvatarHtml, removeBrokenAvatars };
})();
