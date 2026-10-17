// @별칭 SHELL · 여행 공통 셸 (상단 아이콘 바 · 하단 탭바 · 우측 메뉴)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 나의 여행(#/my-trip/:id) · 일정(#/schedule/:id) · 가계부(#/budget/:id) · 여행지갑(#/wallet/:id) ·
// 숙소 추가(#/lodging/:id) 다섯 화면에서 화면이 바뀌어도 같은 DOM 하나가 그대로 남아 있는 공통 셸이다.
// body에 한 번만 붙이고(모달과 같은 방식), 라우터가 화면을 바꿀 때마다 보이기/숨기기와 하단 탭 강조만 갱신한다.
//
//   MYTRIP-TOPBAR    홈(메인으로) · 계정 아이콘·이름(topbarAccountHtml, main의 MAIN-ACCOUNT와 같은 구조) ·
//                    메뉴(☰) - 검색·지도 아이콘은 아직 뒤에 화면이 없어 통째로 뺐다.
//   MYTRIP-BOTTOMTABS 일정 · 여행중 · 여행지갑 · 가계부 (각 탭이 자기 라우트일 때만 강조된다. 일정은 예외로
//                    schedule과 lodging 둘 다에서 강조된다 - 숙소는 일정 화면의 QUICK-MENU에서 들어오는
//                    화면이라서, budget/wallet과 달리 자기 탭이 따로 없다).
//                    여행지갑/가계부는 원래 일정 화면의 QUICK-MENU 버튼이었는데 여기 하단 탭으로 옮겨왔다
//                    (그 두 화면의 QUICK-MENU 진입 흔적인 ← 뒤로가기 버튼도 같이 없앴다 - budgetPage.js/
//                    walletPage.js 참고). 숙소는 한 번 같이 하단 탭으로 옮겼다가 다시 QUICK-MENU로
//                    돌아왔다(schedule.js/lodging.js 참고, lodging.js는 그래서 ← 버튼이 그대로 있다).
//                    예전에 있던 저장/여행도구(둘 다 "준비 중" 토스트만 뜨던 더미 탭)는 통째로 지웠다.
//   MYTRIP-MENU      우측 슬라이드 메뉴: 패널 헤드 왼쪽 끝에 닫기(✕), 오른쪽 끝에 알림(🔔)·설정(⚙,
//                    commonPages.js 공용 화면) 두 아이콘을 바짝 붙여 묶는다(.mytrip-panel-head-actions).
//                    그 아래 프로필 줄(menuProfileHtml, main의 MAIN-MENU 프로필 줄과 같은 CSS) ·
//                    여행 공유(owner, invite.js)·여행 가져오기(tripImport.js)·동행자 관리(tripMembers.js) +
//                    여행 삭제(owner)/나가기(참여자). 로그아웃·알림 설정·여행 설정은 다른 위치로 옮길
//                    예정이라 일단 뺐다(메뉴 텍스트 "메뉴" 자체도 뺐다).
//
// 네 화면 모두 지금 보는 여행은 storage.getTrip()으로 얻는다 (각 화면의 requireTrip 가드가 미리 정해 둔다).

(function () {
  const { getTrip, loadItems, getItems, deleteTrip, leaveTrip } = window.TripLog.storage;
  const { deleteImage } = window.TripLog.images;
  const { showToast, showAlert } = window.TripLog.ui;
  const { escapeHtml } = window.TripLog.util;
  const router = window.TripLog.router;
  const auth = window.TripLog.auth;
  const invite = window.TripLog.invite;
  const tripImport = window.TripLog.tripImport;
  const tripMembers = window.TripLog.tripMembers;

  const SHELL_ROUTES = ["my-trip", "schedule", "budget", "wallet", "lodging"]; // 이 화면들에서만 셸이 보인다
  const ALL_ROUTES = [
    "main",
    "my-trip",
    "schedule",
    "login",
    "invite",
    "budget",
    "wallet",
    "lodging",
    "notifications",
    "settings",
    "terms",
    "privacy",
    "consent",
    "account-delete",
    "notice",
    "contact",
    "help",
  ];
  const BACK_MODE_ROUTES = ["lodging"]; // 이 화면들에서는 상단바 홈 버튼이 ← 버튼으로 바뀐다(lodging.js#goBackFromShell)

  // 아이콘은 currentColor를 쓰는 24x24 선 아이콘 (myTripPage.js에서 그대로 옮겨 왔다)
  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    close: icon('<path d="M5 5l14 14M19 5L5 19"/>'),
    home: icon('<path d="M3.5 10.5L12 4l8.5 6.5"/><path d="M5.5 9.5V19a1 1 0 001 1h3v-6h5v6h3a1 1 0 001-1V9.5"/>'),
    back: icon('<path d="M15 5l-7 7 7 7"/>'),
    menu: icon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    schedule: icon('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
    trip: icon('<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>'),
    wallet: icon('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>'),
    budget: icon('<path d="M6.5 3.5h11v17l-2.75-1.8-2.75 1.8-2.75-1.8-2.75 1.8v-17z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>'),
  };

  // 일정을 여행중보다 앞에 둔다 (일정이 기본 진입 화면이라서): 여기 순서가 그대로 하단 탭 순서다.
  // 여행지갑·가계부는 원래 일정 화면의 QUICK-MENU에 있던 버튼이었는데 여기 하단 탭으로 옮겨왔다. 숙소는
  // 같이 옮겼다가 다시 QUICK-MENU로 돌려보냈다(schedule.js) - 그래서 일정 탭은 schedule뿐 아니라 lodging
  // 화면에서도 강조된다(숙소는 자기 탭이 없으니 "일정" 탭이 그 자리를 대신한다).
  // route: 이 탭을 눌렀을 때 갈 라우트 이름. activeOn: 이 탭이 강조되는 라우트 이름들.
  const TABS = [
    { id: "schedule", label: "일정", icon: ICONS.schedule, route: "schedule", activeOn: ["schedule", "lodging"] },
    { id: "ongoing", label: "여행중", icon: ICONS.trip, route: "my-trip", activeOn: ["my-trip"] },
    { id: "wallet", label: "여행지갑", icon: ICONS.wallet, route: "wallet", activeOn: ["wallet"] },
    { id: "budget", label: "가계부", icon: ICONS.budget, route: "budget", activeOn: ["budget"] },
  ];

  let shellEl = null;

  // 상단바(MYTRIP-TOPBAR)의 홈 아이콘 옆, 메뉴(☰) 버튼 앞에 두는 계정 아이콘·이름 - main(MAIN-ACCOUNT)과
  // 같은 구조(profileAvatarHtml)를 mainPage.js에서 가져다 쓴다. 로그인을 안 쓰는 상태면 통째로 비운다.
  function topbarAccountHtml() {
    const profile = auth.getProfile();
    if (!auth.isRequired() || !profile) return "";
    const { profileAvatarHtml } = window.TripLog.mainPage;
    return `
      <span class="mytrip-bar-account">
        ${profileAvatarHtml(profile, "mytrip-bar-avatar")}
        <span class="mytrip-bar-account-name">${escapeHtml(profile.name ?? "")}님</span>
      </span>`;
  }

  // 우측 슬라이드 메뉴 패널 헤드 바로 아래 프로필 줄 - mainPage.js의 MAIN-MENU 프로필 줄과 같은 CSS
  // (.main-menu-profile 등)를 그대로 가져다 쓴다(이 메뉴 전용 클래스를 새로 만들지 않는다).
  function menuProfileHtml() {
    const profile = auth.getProfile();
    if (!auth.isRequired() || !profile) return "";
    const { profileAvatarHtml } = window.TripLog.mainPage;
    return `
      <div class="main-menu-profile">
        <span class="main-menu-profile-name">${escapeHtml(profile.name ?? "")}님</span>
        ${profileAvatarHtml(profile, "main-menu-profile-avatar")}
      </div>`;
  }

  function ensureShell() {
    if (shellEl) return shellEl;

    const { ICONS: COMMON_ICONS } = window.TripLog.commonPages;
    shellEl = document.createElement("div");
    shellEl.dataset.alias = "SHELL · 여행 공통 셸";
    shellEl.hidden = true;
    shellEl.innerHTML = `
      <div class="mytrip-bar" data-alias="MYTRIP-TOPBAR · 상단 아이콘 바(홈·계정·메뉴)">
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="close" aria-label="홈으로">${ICONS.home}</button>
        <span class="mytrip-bar-spacer"></span>
        ${topbarAccountHtml()}
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="menu" aria-label="메뉴" aria-haspopup="dialog" aria-expanded="false">${ICONS.menu}</button>
      </div>

      <nav class="mytrip-tabs" aria-label="여행 메뉴" data-alias="MYTRIP-BOTTOMTABS · 하단 탭바">
        ${TABS.map((tab) => `
          <button type="button" class="mytrip-tab" data-tab="${tab.id}">
            ${tab.icon}<span>${tab.label}</span>
          </button>`).join("")}
      </nav>

      <div class="mytrip-drawer" data-drawer aria-hidden="true" data-alias="MYTRIP-MENU · 우측 슬라이드 메뉴">
        <div class="mytrip-backdrop" data-action="drawer-close"></div>
        <aside class="mytrip-panel" role="dialog" aria-modal="true" aria-label="메뉴">
          <div class="mytrip-panel-head">
            <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="drawer-close" aria-label="메뉴 닫기">${ICONS.close}</button>
            <span class="mytrip-panel-head-actions">
              <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="notifications" aria-label="알림">${COMMON_ICONS.bell}</button>
              <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="settings" aria-label="설정">${COMMON_ICONS.gear}</button>
            </span>
          </div>
          ${menuProfileHtml()}
          <ul class="mytrip-menu" data-menu-list></ul>
        </aside>
      </div>`;
    document.body.appendChild(shellEl);
    window.TripLog.mainPage.removeBrokenAvatars(shellEl); // 프로필 사진을 못 불러오면 치우고 깔아 둔 글자가 보이게 한다

    shellEl.addEventListener("click", handleClick);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.target.closest?.(".modal-overlay")) return;
      if (isDrawerOpen()) setDrawer(false);
    });

    return shellEl;
  }

  // 메뉴 목록은 지금 보는 여행의 역할(owner/editor)에 따라 달라져서 열 때마다 다시 그린다.
  // '여행 공유'(초대 링크, invite.js)와 '여행 가져오기'(tripImport.js)는 원래 일정 화면 헤더의 #invite-row에
  // 있었으나 여기로 옮겨왔다. 초대 링크 조회·생성은 RLS상 owner만 할 수 있어서 '여행 공유'는 owner에게만 보이고,
  // '여행 가져오기'는 역할과 무관하게 여행이 있으면 보인다(원래 #invite-row와 같은 규칙).
  // '동행자 관리'는 tripMembers.js의 멤버 관리 창을 연다 - owner는 내보내기까지 할 수 있고, 초대받아 들어온
  // 참여자는 내보내기 없이 함께 하는 멤버 목록만 본다(tripMembers.js#renderManage가 역할을 보고 가른다).
  function renderMenuList(trip) {
    const list = shellEl.querySelector("[data-menu-list]");
    list.innerHTML = `
      ${trip?.role === "owner" ? `<li><button type="button" data-action="invite">여행 공유</button></li>` : ""}
      ${trip ? `<li><button type="button" data-action="trip-import">여행 가져오기</button></li>` : ""}
      ${trip ? `<li><button type="button" data-action="members">동행자 관리</button></li>` : ""}
      ${
        trip
          ? trip.role === "owner"
            ? `<li class="mytrip-menu-logout mytrip-menu-delete"><button type="button" data-action="delete-trip">여행 삭제</button></li>`
            : `<li class="mytrip-menu-logout mytrip-menu-delete"><button type="button" data-action="leave-trip">여행 나가기</button></li>`
          : ""
      }`;
  }

  // ---- 표시 여부 · 하단 탭 강조 ----

  function updateShell(routeName) {
    ensureShell();
    const visible = SHELL_ROUTES.includes(routeName);
    shellEl.hidden = !visible;
    document.body.classList.toggle("has-trip-shell", visible);
    if (!visible) return setDrawer(false);

    const closeBtn = shellEl.querySelector('[data-action="close"]');
    const isBack = BACK_MODE_ROUTES.includes(routeName);
    closeBtn.innerHTML = isBack ? ICONS.back : ICONS.home;
    closeBtn.setAttribute("aria-label", isBack ? "뒤로" : "홈으로");
    closeBtn.dataset.mode = isBack ? "back" : "home";

    shellEl.querySelectorAll("[data-tab]").forEach((btn) => {
      const tab = TABS.find((t) => t.id === btn.dataset.tab);
      if (tab.activeOn?.includes(routeName)) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  // ---- 우측 슬라이드 메뉴 ----

  function isDrawerOpen() {
    return Boolean(shellEl?.querySelector("[data-drawer].is-open"));
  }

  function setDrawer(open) {
    const drawer = shellEl.querySelector("[data-drawer]");
    const menuButton = shellEl.querySelector('[data-action="menu"]');
    if (open) renderMenuList(getTrip());
    drawer.classList.toggle("is-open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    menuButton.setAttribute("aria-expanded", String(open));
    (open ? drawer.querySelector('[data-action="drawer-close"].mytrip-icon-btn') : menuButton).focus();
  }

  // ---- 여행 삭제(owner) / 여행 나가기(초대받은 참여자): 확인창 → 실행 ----
  // myTripPage.js에 있던 것과 같은 동작이다 (문구도 그대로): 삭제는 서버에서 여행과 딸린 데이터가 모두 지워지고,
  // 나가기는 내 멤버십만 지워지고 여행과 일정은 남는다.

  const EXIT_TEXT = {
    delete: {
      title: (name) => `'${name}'을(를) 삭제할까요?`,
      note: "이 여행의 일정, 초대 링크, 참여한 사람 정보가 모두 사라지고 되돌릴 수 없어요. 같이 참여한 사람의 화면에서도 없어져요.",
      ok: "삭제",
      busy: "삭제 중...",
      done: (name) => `'${name}'을(를) 삭제했어요.`,
      run: deleteTrip,
    },
    leave: {
      title: (name) => `'${name}'에서 나갈까요?`,
      note: "나가면 이 여행이 내 목록에서 사라져요. 내가 추가한 일정은 여행에 그대로 남고, 초대 링크가 아직 유효하면 다시 들어올 수 있어요.",
      ok: "나가기",
      busy: "나가는 중...",
      done: (name) => `'${name}'에서 나갔어요.`,
      run: leaveTrip,
    },
  };

  function placeName(trip) {
    return (trip.destination || trip.title || "여행지").split(",")[0].trim();
  }

  let exitOverlay = null;
  let exitTarget = null; // { trip, mode }
  let exiting = false;

  function ensureExitModal() {
    if (exitOverlay) return;
    exitOverlay = document.createElement("div");
    exitOverlay.className = "modal-overlay";
    exitOverlay.dataset.alias = "MYTRIP-EXIT-CONFIRM · 여행 삭제/나가기 확인창";
    exitOverlay.hidden = true;
    exitOverlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="trip-exit-title">
        <h2 class="modal-title" id="trip-exit-title"></h2>
        <p class="trip-exit-note"></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="trip-exit-cancel">취소</button>
            <button type="button" class="btn btn-danger" data-action="trip-exit-ok"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(exitOverlay);

    exitOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="trip-exit-cancel"]')) closeExitModal();
      else if (e.target.closest('[data-action="trip-exit-ok"]')) performExit();
    });
    exitOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeExitModal();
    });
  }

  function openExitModal(trip, mode) {
    ensureExitModal();
    const text = EXIT_TEXT[mode];
    exitTarget = { trip, mode };
    exitOverlay.querySelector("#trip-exit-title").textContent = text.title(trip.title || placeName(trip));
    exitOverlay.querySelector(".trip-exit-note").textContent = text.note;
    exitOverlay.querySelector('[data-action="trip-exit-ok"]').textContent = text.ok;
    exitOverlay.hidden = false;
    exitOverlay.querySelector('[data-action="trip-exit-cancel"]').focus();
  }

  function closeExitModal() {
    if (exitOverlay) exitOverlay.hidden = true;
    if (!exiting) exitTarget = null;
  }

  async function performExit() {
    if (!exitTarget || exiting) return;
    const { trip, mode } = exitTarget;
    const text = EXIT_TEXT[mode];
    const okBtn = exitOverlay.querySelector('[data-action="trip-exit-ok"]');
    exiting = true;
    okBtn.disabled = true;
    okBtn.textContent = text.busy;
    try {
      await loadItems(trip.id).catch(() => {});
      const imageIds = getItems().filter((item) => item.tripId === trip.id).flatMap((item) => item.images ?? []);
      await text.run(trip.id);
      imageIds.forEach((id) => deleteImage(id));
    } catch (err) {
      showAlert(err.message);
      return;
    } finally {
      exiting = false;
      okBtn.disabled = false;
      okBtn.textContent = text.ok;
      closeExitModal();
    }
    showToast(text.done(trip.title || placeName(trip)));
    router.navigate(router.buildPath("main"));
  }

  // ---- 클릭 처리 ----

  function handleClick(e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      const def = TABS.find((t) => t.id === tab.dataset.tab);
      const trip = getTrip();
      if (def.route && trip) router.navigate(router.buildPath(def.route, { id: trip.id }));
      return;
    }

    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const trip = getTrip();

    if (action === "close") {
      if (target.dataset.mode === "back") window.TripLog.lodging?.goBackFromShell();
      else router.navigate(router.buildPath("main"));
    }
    else if (action === "menu") setDrawer(true);
    else if (action === "drawer-close") setDrawer(false);
    else if (action === "invite") {
      setDrawer(false);
      invite.open();
    } else if (action === "trip-import" && trip) {
      setDrawer(false);
      tripImport.open({ mode: "append", tripId: trip.id });
    } else if (action === "members" && trip) {
      setDrawer(false);
      tripMembers.open(trip);
    } else if (action === "notifications") {
      setDrawer(false);
      router.navigate(router.buildPath("notifications"));
    } else if (action === "settings") {
      setDrawer(false);
      router.navigate(router.buildPath("settings"));
    } else if ((action === "delete-trip" || action === "leave-trip") && trip) {
      setDrawer(false);
      openExitModal(trip, action === "delete-trip" ? "delete" : "leave");
    }
  }

  // 라우트가 바뀔 때마다(셸이 보이는 화면이 아니어도) 표시 여부와 강조 탭을 다시 정한다
  ALL_ROUTES.forEach((name) => router.onEnter(name, () => updateShell(name)));

  window.TripLog = window.TripLog || {};
  window.TripLog.tripShell = {};
})();
