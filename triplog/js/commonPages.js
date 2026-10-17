// @별칭 COMMON-PAGE · 알림 · 설정 공용 화면 (#/notifications, #/settings)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 메인 화면(MAIN-MENU)과 여행 공통 셸(SHELL MYTRIP-MENU) 양쪽의 🔔(알림)·⚙(설정) 버튼이 함께 여는 화면이다.
// 두 메뉴 모두 이 한 쌍의 라우트로 연결한다(각자 화면을 따로 만들지 않는다). 뒤로가기(←)는 history.back()으로
// 한 칸만 되짚어 나간다 - main에서 열었는지 SHELL(일정 등)에서 열었는지에 따라 돌아갈 화면이 달라서 특정
// 라우트로 고정하지 않는다(메뉴를 열어야만 들어오는 화면이라 "뒤로 갈 곳"은 항상 있다).
// 아이콘(ICONS.bell/gear)도 여기서 한 번만 만들어 mainPage.js/tripShell.js가 그대로 가져다 쓴다.
// 알림(#/notifications)은 아직 자리만 잡아둔 화면("준비 중이에요")이다.
//
// 설정(#/settings)은 위에서부터 "고객센터"(공지사항·문의하기·도움말 - 셋 다 #/notice·#/contact·#/help로
// 가는, 아직 "준비 중"인 자리표시자 화면이다. renderNotifications와 똑같은 모양이라 따로 설명할 내용은 없다),
// "개인정보 및 약관" 섹션(이용약관·개인정보처리방침(legalPages.js, #/terms·#/privacy)으로 가는 두 링크와,
// 같은 #/privacy를 다시 여는 "개인정보 수집·이용 안내"(consentPage.js의 동의 항목과 이름을 맞췄다 - 그
// 화면에 별도 문서가 없어서 개인정보처리방침 내용을 그대로 보여준다). 셋 다 그냥 legalPages.js 화면을 읽기
// 전용으로 보여줄 뿐 다시 동의를 받지 않는다 - 재동의는 #/consent(consentPage.js)에서만 받는다), "계정"
// 섹션(로그아웃(auth.signOut 후 #/login)과 회원 탈퇴(accountDeletePage.js, #/account-delete로 이동 - 실제
// 삭제 절차는 그 화면이 맡는다). 둘 다 예전엔 MAIN-MENU/MYTRIP-MENU에 있었는데 설정 화면이 생기면서 여기로
// 옮겨졌다), "여행 내보내기"(섹션이 아니라 바로 누르는 항목 하나 - tripExport.js의 모달을 연다. 아래 설명
// 참고), 그리고 맨 아래 "다른 설정은 준비 중이에요" 안내와 버전 정보(APP_VERSION, triplog/package.json의
// version과 같은 값 - 그 파일은 브라우저에서 읽지 않으므로 여기 상수로 따로 둔다. 버전을 올릴 때 함께 바꾼다)
// 순서다.
//
// "여행 내보내기"는 섹션(제목 있는 묶음)이 아니라 바로 클릭되는 항목이지만, 자리와 글자 크기·색은 다른
// 섹션 제목과 맞춰 달라는 요청이 있어서(actionTitle) .simple-page-section-title 클래스를 그대로 쓴다 -
// 다만 data-toggle-section/aria-expanded/캐럿이 없어서 collapsibleSection의 제목처럼 보이지만 눌러도
// 접고 펼 목록이 없고, 바로 data-action(trip-export)으로 동작한다. 클릭하면 tripExport.js가
// document.body에 직접 붙이는 모달(여행 고르기 → 확인 → 엑셀 저장)이 열린다 - 이 파일은 그 모달의
// 존재만 알고(window.TripLog.tripExport.open()) 내용은 모른다(walletPage.js가 walletForm.js를 부르는
// 것과 같은 느슨한 연결).
//
// 제목 있는 세 섹션(고객센터/개인정보 및 약관/계정)은 제목을 누르면 그 아래 목록이 접히고 펼쳐진다
// (collapsibleSection/toggleSection, sectionOpen). 처음엔 전부 접힌 채로 시작하고, 상태는 모듈 범위
// 변수(sectionOpen)에 남아 있어서 설정 화면을 나갔다(예: 공지사항을 보고 뒤로 가기) 다시 들어와도 열어
// 둔 섹션은 그대로 열려 있다 - consentPage.js가 체크박스 상태를 모듈 범위에 두는 것과 같은 이유다. "여행
// 내보내기"는 목록이 없어 접고 펼 것도 없으므로 sectionOpen에 들어가지 않는다.
//
// "알림" 섹션(PRD v11)은 맨 위에 추가됐다 - 토글 두 개(일정 알림/초대·공유 알림, notification_settings
// 031_push_notifications.sql과 1:1)와 공지사항 고정 문구, 그 위에 알림 권한 배너 한 줄이 있다. 배너는
// permissionPrompt.notificationPermissionState()로 매번 다시 확인해서 "알림 켜기" 버튼(아직 묻지 않음) /
// "설정에서 허용해주세요"(거부됨) / "알림이 켜져 있어요"(허용됨) / iOS Safari 비-PWA 안내 / "알림 등록에
// 실패했어요"(네이티브, pushNotifications의 registrationError) 중 하나로 채운다. 자세한 동작은
// docs/features/screen-common-pages.md, docs/features/permission-prompts.md 참고.
//
// 네이티브(Capacitor Android)에서 "알림 켜기"는 pushNotifications.requestAndRegister()로 이어진다 -
// OS 권한 요청 → 허용되면 채널 생성 + FCM 등록 → 'registration' 이벤트의 토큰을 device_tokens에 upsert
// (platform:'android'). 등록이 실패하면('registrationError') pushNotifications.onError 구독으로 이
// 화면이 다시 그려진다 - 이벤트가 비동기로 늦게 올 수 있어서, 지금 #/settings가 떠 있는 동안만(settingsEl)
// 배너를 갱신한다. 웹은 이 모듈을 거치지 않고 그대로 Notification.requestPermission()만 쓴다(웹 Web Push
// 등록은 범위 밖).

(function () {
  const router = window.TripLog.router;
  const auth = window.TripLog.auth;
  const ui = window.TripLog.ui;
  const storage = window.TripLog.storage;
  const permissionPrompt = window.TripLog.permissionPrompt;

  // 아이콘은 SHELL(tripShell.js)과 같은 24x24 currentColor 선 아이콘 규칙을 쓴다
  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    bell: icon('<path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>'),
    gear: icon(
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82A1.65 1.65 0 003.09 13H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>'
    ),
    back: icon('<path d="M15 5l-7 7 7 7"/>'),
    caret: icon('<path d="M6 9l6 6 6-6"/>'),
  };

  // triplog/package.json의 version과 같은 값을 손으로 맞춰 둔다 (그 파일은 브라우저에서 읽지 않는다 - CLAUDE.md 참고)
  const APP_VERSION = "1.0.0";

  // 설정 화면의 제목 있는 섹션(고객센터/개인정보 및 약관/계정)을 눌러서 접고 펼친다. 모듈 범위에 둬서
  // 설정 화면을 나갔다(예: 공지사항을 보고 뒤로 가기) 다시 들어와도 열어 둔 상태가 그대로 남는다 - 처음엔
  // 전부 접힌 채로 시작한다("여행 내보내기"처럼 제목 없는 섹션은 접고 펼 것이 없어서 여기 들어가지 않는다).
  const sectionOpen = { notification: false, "customer-service": false, legal: false, account: false };

  // 설정 화면 "알림" 섹션의 두 토글 - notification_settings(031_push_notifications.sql)의 컬럼과
  // 1:1로 맞춘다. 공지사항은 끄는 설정이 없어서(PRD v11 5번) 여기 들어가지 않고 고정 문구로만 보여준다.
  const NOTIFICATION_TOGGLES = [
    { key: "scheduleEnabled", label: "일정 알림", desc: "출발 임박, 다음 일정 안내" },
    { key: "shareEnabled", label: "초대·공유 알림", desc: "새 멤버 가입, 초대 수락 안내" },
  ];

  // 제목(title) + 목록(itemsHtml)을 접고 펼치는 섹션 하나로 감싼다 (renderSettings 전용)
  function collapsibleSection(key, title, itemsHtml) {
    const open = sectionOpen[key];
    return `
      <section class="simple-page-section">
        <button type="button" class="simple-page-section-title" data-toggle-section="${key}"
          aria-expanded="${open}" aria-controls="settings-list-${key}">
          <span>${title}</span>
          <span class="simple-page-section-caret">${ICONS.caret}</span>
        </button>
        <ul class="mytrip-menu simple-page-list" id="settings-list-${key}"${open ? "" : " hidden"}>
          ${itemsHtml}
        </ul>
      </section>`;
  }

  function toggleSection(btn) {
    const key = btn.dataset.toggleSection;
    const open = !sectionOpen[key];
    sectionOpen[key] = open;
    btn.setAttribute("aria-expanded", String(open));
    const list = document.getElementById(btn.getAttribute("aria-controls"));
    if (list) list.hidden = !open;
  }

  // "여행 내보내기"처럼 접고 펼 목록이 없는, 섹션 제목 자리만 빌려 쓰는 단일 항목 - .simple-page-section-title
  // 클래스를 그대로 써서 위치·글자 크기·색을 다른 섹션 제목과 맞추되, aria-expanded/캐럿 없이 눌러서
  // 바로 동작(data-action)한다. collapsibleSection과 달리 펼칠 목록이 아예 없다.
  function actionTitle(action, label) {
    return `
      <section class="simple-page-section">
        <button type="button" class="simple-page-section-title" data-action="${action}">
          <span>${label}</span>
        </button>
      </section>`;
  }

  function header(title) {
    return `
      <header class="simple-page-header">
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="back" aria-label="뒤로">${ICONS.back}</button>
        <h1 class="simple-page-title">${title}</h1>
      </header>`;
  }

  // mainPage.js/tripShell.js가 예전에 가지고 있던 것과 같은 로그아웃 - 실패(인터넷 연결 등)하면 로그인
  // 상태를 그대로 두고 토스트만 보여준다.
  async function logout() {
    // 로그아웃 "직전에" 이 기기/브라우저의 푸시 토큰(또는 구독) 행을 지운다 - 다음에 이 기기에 로그인하는
    // 사람에게 이전 사용자 몫의 알림이 가지 않게 하려는 것. 네이티브는 FCM 토큰 행만, 웹은 실제 브라우저
    // 구독(unsubscribe)까지 끊고 행을 지운다 - 둘 다 자신과 무관한 플랫폼에서는 isSupported()로 조용히
    // no-op이라 분기 없이 둘 다 불러도 안전하다. 실패해도 조용히 넘어간다 - 로그아웃 자체를 막을 이유는 아니다.
    await window.TripLog.pushNotifications?.removeDeviceToken?.();
    await window.TripLog.webPush?.unsubscribeAndRemove?.();
    const { error } = await auth.signOut();
    if (error) return ui.showToast("로그아웃하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.");
    router.navigate(router.buildPath("login"));
  }

  function bindBack(el) {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("click", (e) => {
      const toggleBtn = e.target.closest("[data-toggle-section]");
      if (toggleBtn) return toggleSection(toggleBtn);
      if (e.target.closest('[data-action="back"]')) history.back();
      else if (e.target.closest('[data-action="terms"]')) router.navigate(router.buildPath("terms"));
      // privacy-notice(개인정보 수집·이용 안내)도 같은 #/privacy로 간다 - 별도 문서가 없어서다(위 파일 설명 참고)
      else if (e.target.closest('[data-action="privacy"], [data-action="privacy-notice"]')) router.navigate(router.buildPath("privacy"));
      else if (e.target.closest('[data-action="notice"]')) router.navigate(router.buildPath("notice"));
      else if (e.target.closest('[data-action="contact"]')) router.navigate(router.buildPath("contact"));
      else if (e.target.closest('[data-action="help"]')) router.navigate(router.buildPath("help"));
      // tripExport.js가 index.html 로드 순서상 이 파일보다 뒤에 온다 - 클릭 시점에만 읽으면 순서를 안 타도 된다
      else if (e.target.closest('[data-action="trip-export"]')) window.TripLog.tripExport?.open();
      else if (e.target.closest('[data-action="logout"]')) logout();
      else if (e.target.closest('[data-action="account-delete"]')) router.navigate(router.buildPath("account-delete"));
      // "알림 켜기": 바로 OS 권한을 묻지 않고 사전 안내 모달부터 연다(요청 2번) - 모달의 '허용'을 눌러야
      // requestNotificationPermission이 실제 권한을 요청한다. 이미 거부됨/iOS Safari면 이 버튼 자체가
      // renderNotificationPermissionRow에서 안내 문구로 바뀌어 있어서 여기까지 올 일이 없다.
      else if (e.target.closest('[data-action="notif-allow"]')) {
        permissionPrompt?.askNotification?.(() => requestNotificationPermission(el));
      }
    });

    // 알림 토글 on/off: 바로 서버에 저장하고, 실패하면 체크 상태를 되돌리고 토스트로 알린다.
    el.addEventListener("change", async (e) => {
      const input = e.target.closest('[data-role="notif-toggle"]');
      if (!input) return;
      const key = input.dataset.key;
      const next = { ...storage.getNotificationSettings(), [key]: input.checked };
      try {
        await storage.saveNotificationSettings(next);
      } catch (err) {
        input.checked = !input.checked;
        ui.showToast(err.message);
      }
    });
  }

  function renderNotifications(el) {
    el.innerHTML = `${header("알림")}<p class="simple-page-empty">준비 중이에요.</p>`;
    bindBack(el);
  }

  // 공지사항·문의하기·도움말: 아직 내용 없이 자리만 잡아둔 화면("준비 중이에요") - renderNotifications와 같은 모양이다
  function renderNotice(el) {
    el.innerHTML = `${header("공지사항")}<p class="simple-page-empty">준비 중이에요.</p>`;
    bindBack(el);
  }

  function renderContact(el) {
    el.innerHTML = `${header("문의하기")}<p class="simple-page-empty">준비 중이에요.</p>`;
    bindBack(el);
  }

  function renderHelp(el) {
    el.innerHTML = `${header("도움말")}<p class="simple-page-empty">준비 중이에요.</p>`;
    bindBack(el);
  }

  function notificationToggleRow(item, checked) {
    return `
      <li class="settings-toggle-row">
        <div class="settings-toggle-text">
          <span class="settings-toggle-label">${item.label}</span>
          <span class="settings-toggle-desc">${item.desc}</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" data-role="notif-toggle" data-key="${item.key}" ${checked ? "checked" : ""} />
          <span class="toggle-switch-track"></span>
        </label>
      </li>`;
  }

  // 공지사항은 끄는 설정이 없다(PRD v11 5번) - 토글 없이 문구만 보여준다.
  const ANNOUNCEMENT_STATIC_ROW = `
    <li class="settings-toggle-row settings-toggle-row--static">
      <div class="settings-toggle-text">
        <span class="settings-toggle-label">공지사항</span>
        <span class="settings-toggle-desc">공지사항은 항상 받아요</span>
      </div>
    </li>`;

  // 알림 섹션 자체는 동기로 그린다(설정값이 없어도 기본 '켜짐'으로 먼저 보여준 뒤, hydrateNotificationSection이
  // 서버 값/권한 상태로 다시 채운다) - storage.getNotificationSettings()는 로드 전에도 기본값을 돌려준다.
  function notificationSectionHtml() {
    const settings = storage.getNotificationSettings();
    return collapsibleSection(
      "notification",
      "알림",
      `<li class="settings-permission-row" data-role="notif-permission" hidden></li>
       ${NOTIFICATION_TOGGLES.map((item) => notificationToggleRow(item, settings[item.key])).join("")}
       ${ANNOUNCEMENT_STATIC_ROW}`
    );
  }

  // navigator.standalone은 iOS Safari에만 있는 속성이다 - 홈 화면에 추가해 PWA로 띄운 상태면 true,
  // 보통 탭으로 열었으면 false. 다른 브라우저는 이 속성 자체가 없어(undefined) 이 분기를 타지 않는다.
  function isIOSSafariNonStandalone() {
    return typeof navigator.standalone !== "undefined" && navigator.standalone === false;
  }

  // #/settings가 지금 화면에 떠 있으면 그 el, 아니면 null. registrationError는 네이티브 쪽에서 비동기로
  // (요청 당시의 await가 끝난 뒤) 늦게 올 수 있어서, pushNotifications.onError 구독이 이 값을 보고 지금
  // 열려 있는 설정 화면이 있을 때만 배너를 다시 그린다.
  let settingsEl = null;

  // 알림 권한 배너를 채운다: iOS Safari 비-PWA 안내 > 네이티브 등록 실패 안내 > (웹에서) 브라우저 미지원
  // 안내 > 거부됨 안내 > 허용됨 안내 > "알림 켜기" 버튼 순으로 하나만 보여준다. 버튼이 없는 경우들은
  // 그 상태에서는 알림 권한 모달이 열릴 일이 없다(요청 3·4번 - "모달 대신 안내로 바꿔줘").
  async function renderNotificationPermissionRow(el) {
    const row = el.querySelector('[data-role="notif-permission"]');
    if (!row) return;

    if (isIOSSafariNonStandalone()) {
      row.hidden = false;
      row.innerHTML = `<p class="settings-permission-note">iPhone에서는 홈 화면에 추가한 뒤에 알림을 받을 수 있어요.</p>`;
      return;
    }

    // OS 권한은 허용됐어도(아래 notificationPermissionState가 "granted"로 볼 것이다) FCM 등록 자체가
    // 실패했을 수 있다(구글 플레이 서비스 없음, google-services.json 문제, 네트워크 등) - 그 경우를 먼저
    // 가려서 "허용됨" 문구 대신 실패를 보여준다.
    if (auth.isNativeApp() && window.TripLog.pushNotifications?.getLastError()) {
      row.hidden = false;
      row.innerHTML = `<p class="settings-permission-note settings-permission-note--error">알림 등록에 실패했어요.</p>`;
      return;
    }

    // 웹인데 이 브라우저가 Service Worker/Push API 자체를 지원하지 않으면(구형 브라우저 등) 버튼을 아예
    // 숨기고 안내 문구만 보여준다 - 눌러도 될 수 없는 버튼을 보여주지 않는다(요청 6번).
    if (!auth.isNativeApp() && !window.TripLog.webPush?.isSupported?.()) {
      row.hidden = false;
      row.innerHTML = `<p class="settings-permission-note">이 브라우저에서는 알림을 지원하지 않아요.</p>`;
      return;
    }

    const state = await permissionPrompt?.notificationPermissionState?.();
    row.hidden = false;
    if (state === "denied") {
      row.innerHTML = `<p class="settings-permission-note">설정에서 알림 권한을 허용해주세요.</p>`;
    } else if (state === "granted") {
      row.innerHTML = `<p class="settings-permission-note">알림이 켜져 있어요.</p>`;
    } else {
      row.innerHTML = `<button type="button" class="btn btn-save settings-permission-btn" data-action="notif-allow">알림 켜기</button>`;
    }
  }

  // registrationError가 늦게 와도 (지금 설정 화면이 떠 있다면) 배너를 다시 그린다. 모듈이 로드될 때 한 번만 구독한다.
  window.TripLog.pushNotifications?.onError(() => {
    if (settingsEl) renderNotificationPermissionRow(settingsEl);
  });

  // 안내 모달의 '허용'을 누른 뒤에만 불린다(permissionPrompt.askNotification의 onAllow). 네이티브
  // (Capacitor Android)는 pushNotifications.requestAndRegister()로 OS 권한 요청 → 채널 생성 → FCM
  // 등록까지, 웹은 webPush.subscribe()로 Notification.requestPermission() → 서비스 워커 등록 →
  // pushManager.subscribe()까지 이어간다 - 둘 다 끝에 device_tokens에 upsert한다(platform만 다르다).
  async function requestNotificationPermission(el) {
    try {
      if (auth.isNativeApp()) {
        await window.TripLog.pushNotifications?.requestAndRegister?.();
      } else {
        await window.TripLog.webPush?.subscribe?.();
      }
    } catch (err) {
      console.warn("[commonPages] 알림 권한 요청 실패", err);
    }
    renderNotificationPermissionRow(el); // 방금 요청한 결과(허용/거부, 또는 이미 알고 있는 등록 실패)를 배너에 반영
  }

  // 설정 화면에 들어올 때마다: 저장된 토글 값을 서버에서 다시 받아 체크박스에 반영하고, 권한 배너를 채운다.
  async function hydrateNotificationSection(el) {
    const settings = await storage.loadNotificationSettings();
    NOTIFICATION_TOGGLES.forEach((item) => {
      const input = el.querySelector(`[data-role="notif-toggle"][data-key="${item.key}"]`);
      if (input) input.checked = Boolean(settings[item.key]);
    });
    renderNotificationPermissionRow(el);
  }

  function renderSettings(el) {
    el.innerHTML = `
      ${header("설정")}
      ${notificationSectionHtml()}
      ${collapsibleSection(
        "customer-service",
        "고객센터",
        `<li><button type="button" data-action="notice">공지사항</button></li>
         <li><button type="button" data-action="contact">문의하기</button></li>
         <li><button type="button" data-action="help">도움말</button></li>`
      )}
      ${collapsibleSection(
        "legal",
        "개인정보 및 약관",
        `<li><button type="button" data-action="terms">이용약관</button></li>
         <li><button type="button" data-action="privacy">개인정보처리방침</button></li>
         <li><button type="button" data-action="privacy-notice">개인정보 수집·이용 안내</button></li>`
      )}
      ${collapsibleSection(
        "account",
        "계정",
        `<li><button type="button" data-action="logout">로그아웃</button></li>
         <li class="mytrip-menu-logout"><button type="button" data-action="account-delete">회원 탈퇴</button></li>`
      )}
      ${actionTitle("trip-export", "여행 내보내기")}
      <p class="simple-page-empty">다른 설정은 준비 중이에요.</p>
      <p class="simple-page-version">버전 정보 ${APP_VERSION}</p>`;
    bindBack(el);
    settingsEl = el; // registrationError가 늦게 와도 배너를 다시 그릴 수 있게 기억해 둔다 (위 onError 구독 참고)
    hydrateNotificationSection(el);
  }

  router.definePage("notifications", renderNotifications);
  router.definePage("settings", renderSettings);
  router.definePage("notice", renderNotice);
  router.definePage("contact", renderContact);
  router.definePage("help", renderHelp);

  // body.has-main-bg(mainPage.js)와 같은 패턴 - 이 화면에 있는 동안만 배경을 --surface-blue(#d6e4fb)로 바꾼다
  ["notifications", "settings", "notice", "contact", "help"].forEach((name) => {
    router.onEnter(name, () => document.body.classList.add("has-simple-page-bg"));
    router.onLeave(name, () => document.body.classList.remove("has-simple-page-bg"));
  });
  router.onLeave("settings", () => {
    settingsEl = null;
  });

  window.TripLog = window.TripLog || {};
  window.TripLog.commonPages = { ICONS };
})();
