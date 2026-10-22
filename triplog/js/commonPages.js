// @별칭 COMMON-PAGE · 알림 · 설정 공용 화면 (#/notifications, #/settings)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 메인 화면(MAIN-MENU)과 여행 공통 셸(SHELL MYTRIP-MENU) 양쪽의 🔔(알림)·⚙(설정) 버튼이 함께 여는 화면이다.
// 두 메뉴 모두 이 한 쌍의 라우트로 연결한다(각자 화면을 따로 만들지 않는다). 뒤로가기(←)는 history.back()으로
// 한 칸만 되짚어 나간다 - main에서 열었는지 SHELL(일정 등)에서 열었는지에 따라 돌아갈 화면이 달라서 특정
// 라우트로 고정하지 않는다(메뉴를 열어야만 들어오는 화면이라 "뒤로 갈 곳"은 항상 있다).
// 아이콘(ICONS.bell/gear)도 여기서 한 번만 만들어 mainPage.js/tripShell.js가 그대로 가져다 쓴다.
// 알림(#/notifications)은 아직 자리만 잡아둔 화면("준비 중이에요")이다.
//
// 설정(#/settings)은 위에서부터 "고객센터"(공지사항·문의하기·도움말로 가는 메뉴 - 공지사항만 아직
// "준비 중"인 자리표시자 화면이고, 문의하기(#/contact)·도움말(#/help)은 실제 내용이 채워져 있다. 아래
// renderContact/renderHelp 참고),
// "개인정보 및 약관" 섹션(이용약관·개인정보처리방침(legalPages.js, #/terms·#/privacy)으로 가는 두 링크와,
// 같은 #/privacy를 다시 여는 "개인정보 수집·이용 안내"(consentPage.js의 동의 항목과 이름을 맞췄다 - 그
// 화면에 별도 문서가 없어서 개인정보처리방침 내용을 그대로 보여준다), 그리고 플레이스토어 등록 준비로
// 추가된 "AI 및 외부 서비스 이용 안내"(#/ai-usage, legalPages.js - Gemini/Maps/FCM 등 실제 쓰는 AI·API
// 목록과 출처를 모아 둔 화면)). 넷 다 그냥 legalPages.js 화면을 읽기 전용으로 보여줄 뿐 다시 동의를 받지
// 않는다 - 재동의는 #/consent(consentPage.js)에서만 받는다), "계정"
// 섹션(로그아웃(auth.signOut 후 #/login)과 회원 탈퇴(accountDeletePage.js, #/account-delete로 이동 - 실제
// 삭제 절차는 그 화면이 맡는다). 둘 다 예전엔 MAIN-MENU/MYTRIP-MENU에 있었는데 설정 화면이 생기면서 여기로
// 옮겨졌다), "여행 내보내기"(섹션이 아니라 바로 누르는 항목 하나 - tripExport.js의 모달을 연다. 아래 설명
// 참고), 그리고 맨 아래 버전 정보(APP_VERSION, triplog/package.json의 version과 같은 값 - 그 파일은
// 브라우저에서 읽지 않으므로 여기 상수로 따로 둔다. 버전을 올릴 때 함께 바꾼다) 순서다.
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

  // 도움말(#/help) 섹션 제목 옆에 붙는 아이콘 - schedule/mytrip/budget/checklist/wallet 다섯 개는
  // tripShell.js의 하단 탭 아이콘과 똑같은 path를 써서(그 파일 ICONS.schedule/trip/budget/checklist/wallet
  // 그대로 복사), 사용자가 실제
  // 탭에서 본 모양과 도움말 글 속 아이콘이 같아 보이게 한다 - 화면 스크린샷 없이도 "이 모양이 그 화면"이란
  // 걸 바로 알아보게 하려는 용도(스크린샷은 로그인 후 실제 데이터가 있어야 의미가 있어서 이번엔 만들지
  // 않았다 - 나중에 사용자가 직접 캡처해서 넣을 수 있다).
  const HELP_ICONS = {
    create: icon('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    schedule: icon('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
    mytrip: icon('<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>'),
    budget: icon('<path d="M6.5 3.5h11v17l-2.75-1.8-2.75 1.8-2.75-1.8-2.75 1.8v-17z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>'),
    checklist: icon('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9.5l1.3 1.3L12.5 8.5M9 15l1.3 1.3L12.5 14"/><path d="M14.5 9.5h3M14.5 15h3"/>'),
    wallet: icon('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>'),
    invite: icon(
      '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c0-3.3 2.6-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><path d="M16 4.5a3 3 0 010 6"/><path d="M15 14c2.4 .3 4.5 2 4.5 5"/>'
    ),
    export: icon('<path d="M12 3v11m0 0l-3.5-3.5M12 14l3.5-3.5"/><path d="M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2"/>'),
    account: icon('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/>'),
  };

  // triplog/package.json의 version과 같은 값을 손으로 맞춰 둔다 (그 파일은 브라우저에서 읽지 않는다 - CLAUDE.md 참고)
  const APP_VERSION = "1.0.0";

  // 설정 화면의 제목 있는 섹션(고객센터/개인정보 및 약관/계정)을 눌러서 접고 펼친다. 모듈 범위에 둬서
  // 설정 화면을 나갔다(예: 공지사항을 보고 뒤로 가기) 다시 들어와도 열어 둔 상태가 그대로 남는다 - 처음엔
  // 전부 접힌 채로 시작한다("여행 내보내기"처럼 제목 없는 섹션은 접고 펼 것이 없어서 여기 들어가지 않는다).
  const sectionOpen = {
    notification: false,
    "customer-service": false,
    legal: false,
    account: false,
    // 도움말(#/help) 화면 아코디언 섹션 - 설정 화면의 키와 겹치지 않게 "help-" 접두사를 붙인다(겹치면
    // 설정의 "계정" 섹션을 열어둔 채 도움말의 "계정 관리" 섹션에 들어갔을 때 서로 열림 상태가 엉킨다).
    "help-create": false,
    "help-schedule": false,
    "help-mytrip": false,
    "help-budget": false,
    "help-checklist": false,
    "help-wallet": false,
    "help-invite": false,
    "help-export": false,
    "help-notification": false,
    "help-account": false,
    // 문의하기(#/contact) 화면의 자주 묻는 질문(FAQ) 아코디언 - 위 두 그룹과 키가 겹치지 않는다
    "faq-device": false,
    "faq-invite": false,
    "faq-delete-mistake": false,
    "faq-ticket-scan": false,
    "faq-notification": false,
    "faq-wallet-share": false,
    "faq-exchange": false,
    "faq-export": false,
    "faq-account-delete": false,
  };

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

  // 도움말(#/help) 본문 - 앱의 화면 순서(메인 → 일정 → 여행중 → 가계부 → 여행지갑 → 초대 → 설정 쪽 기능)를
  // 따라 "처음 쓰는 사람도 그대로 따라 할 수 있는" 단계별 설명을 담는다. 실제 UI에 보이는 버튼/메뉴
  // 글자를 그대로 인용하고(화면이 바뀌면 이 글도 함께 고쳐야 한다), 끝에는 "헷갈리기 쉬운 점"으로 구현
  // 디테일이 아니라 사용자가 실제로 헷갈릴 만한 동작만 짚어준다.
  const HELP_SECTIONS = [
    {
      key: "help-create",
      title: "여행 만들기",
      icon: HELP_ICONS.create,
      body: `
        <p>메인 화면에서 <strong>"새 여행 만들기"</strong>를 누르면 두 단계로 여행을 만들 수 있어요.</p>
        <ul>
          <li>1단계 — 목록에서 가고 싶은 여행지(도시)를 골라요. (직접 입력은 안 되고, 목록에 없으면 가까운 도시를 선택해 주세요)</li>
          <li>2단계 — 여행 날짜를 선택해요.</li>
          <li>완료하면 바로 <strong>"일정"</strong> 화면으로 이동해서 세부 계획을 짤 수 있어요.</li>
          <li>이미 가지고 있는 여행 일정표(문서)가 있다면 메인 화면의 <strong>"여행 가져오기"</strong>로 한 번에 등록할 수도 있어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 메인 화면의 여행 카드를 누르면 "여행중" 현황판이 아니라 곧바로 "일정" 화면이 열려요. 여행 날짜가 지나면 메인 목록에서는 사라지고, 메인 화면 ☰ 메뉴의 "지난 여행"에서 다시 볼 수 있어요.</p>`,
    },
    {
      key: "help-schedule",
      title: "일정 관리",
      icon: HELP_ICONS.schedule,
      body: `
        <p>하단 탭의 <strong>"일정"</strong>에서 여행 날짜별(Day)로 세부 계획을 짜요.</p>
        <ul>
          <li>각 Day 아래 <strong>"일정 추가"</strong>를 눌러 장소·시간·메모·사진을 입력해요. 장소는 검색창에 입력한 뒤 지도에 뜨는 결과 중에서 골라요.</li>
          <li>상단의 <strong>"교통편"</strong>으로 항공편(사진을 올리면 자동으로 읽어줘요)이나 기차·버스·선박을 추가해요.</li>
          <li>상단의 <strong>"숙소"</strong>로 머무는 곳 정보를 추가해요.</li>
          <li>일정 카드 오른쪽의 <strong>≡ 손잡이</strong>를 누른 채 끌면 순서나 날짜를 바꿀 수 있어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 일정 카드 자체를 옆으로 쓸어넘기면 확인 없이 바로 삭제돼요(항공편·교통편·숙소 카드는 쓸어도 삭제되지 않아요). 순서만 바꾸고 싶을 땐 꼭 ≡ 손잡이를 눌러서 끌어주세요. 항공권 사진은 일정에 등록된 뒤 서버에 저장되지 않고 바로 폐기돼요.</p>`,
    },
    {
      key: "help-mytrip",
      title: "나의 여행 현황판",
      icon: HELP_ICONS.mytrip,
      body: `
        <p>하단 탭의 <strong>"여행중"</strong>은 여행을 누르면 처음 보게 되는 화면으로, 지금 상황에 맞는 정보를 카드로 보여줘요.</p>
        <ul>
          <li>여행 전: 환율, 날씨, 시차, 현지 뉴스 등을 보여줘요.</li>
          <li>출발이 가까워지면: 공항까지 가는 길의 교통 상황을 보여줘요.</li>
          <li>여행 중에는: 다음 일정 주변의 맛집을 추천해줘요.</li>
          <li>화면 우측 상단의 새로고침 버튼을 누르면 정보를 바로 다시 불러와요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 국내 여행은 환율·시차 카드가 원래 나오지 않아요(정상이에요). 위치 권한을 허용하지 않으면 공항 교통 카드가 보이지 않을 수 있고, 일부 정보는 불러오지 못하면 카드 자체가 조용히 사라져요(오류가 아니라 정상적인 동작이에요).</p>`,
    },
    {
      key: "help-budget",
      title: "가계부",
      icon: HELP_ICONS.budget,
      body: `
        <p>하단 탭의 <strong>"가계부"</strong>에서 여행 중 쓴 돈을 기록하고 나눠요.</p>
        <ul>
          <li><strong>"+ 비용 추가"</strong>로 통화, 금액, 날짜(Day), 결제수단, 제목, 카테고리, 결제한 사람과 나눠 낼 사람을 입력해요.</li>
          <li>상단의 합계(파이) 아이콘으로 카테고리별로 얼마를 썼는지 볼 수 있어요.</li>
          <li>상단의 "1/n" 아이콘으로 동행자끼리 누가 누구에게 얼마를 보내야 하는지 정산 금액을 확인할 수 있어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 가계부 카드는 옆으로 쓸면 <strong>확인창 없이 바로 삭제</strong>돼요 — 일정과 달리 되돌릴 수 없으니 주의해주세요. 아직 가입하지 않은 동행자를 직접 입력해 추가하면 "이름 없는 멤버"로 표시될 수 있어요.</p>`,
    },
    {
      key: "help-checklist",
      title: "체크리스트",
      icon: HELP_ICONS.checklist,
      body: `
        <p>하단 탭의 <strong>"체크리스트"</strong>에서 여행 준비물을 챙겨요. 여행을 처음 열면 "할 일"·"준비물" 두 카테고리에 자주 챙기는 항목이 미리 담겨 있어요.</p>
        <ul>
          <li>카테고리 제목을 누르면 접고 펼 수 있어요. (처음엔 맨 앞 카테고리만 열려 있어요)</li>
          <li>항목의 체크박스를 눌러 챙긴 것을 표시해요.</li>
          <li>각 카테고리 맨 아래 <strong>"+ 추가하기"</strong>로 나만의 항목을 더 넣을 수 있고, 화면 오른쪽 위 <strong>"+"</strong> 버튼으로 카테고리 자체도 더 만들 수 있어요.</li>
          <li>항목을 옆으로 쓸어넘기면 <strong>확인창 없이 바로 삭제</strong>돼요. 오른쪽 끝의 <strong>≡ 손잡이</strong>를 끌면 같은 카테고리 안에서 순서를 바꿀 수 있어요.</li>
          <li>카테고리 제목줄을 옆으로 쓸어넘기면 <strong>"정말 삭제하시겠습니까?" 확인창</strong>이 떠요 — 삭제하면 그 안의 항목도 함께 사라지고 되돌릴 수 없어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 미리 담긴 기본 카테고리·항목은 그 여행에서 한 번만 채워져요 — 전부 지워도 다시 채워지지 않으니, 지우기보다는 체크 표시로 남겨두는 걸 추천해요. 같은 여행의 동행자도 이 체크리스트를 함께 보고 고칠 수 있어요.</p>`,
    },
    {
      key: "help-wallet",
      title: "여행지갑",
      icon: HELP_ICONS.wallet,
      body: `
        <p>하단 탭의 <strong>"여행지갑"</strong>에 여권, 항공권, 숙소 바우처 같은 사진·문서를 보관해요.</p>
        <ul>
          <li>우측 하단의 <strong>"+"</strong>를 눌러 사진을 찍거나 앨범에서 선택, 또는 PDF 파일을 올려요.</li>
          <li>올리기 전에 <strong>"개인지갑"</strong>(나만 볼 수 있음)과 <strong>"공유지갑"</strong>(이 여행의 동행자도 볼 수 있음) 중 하나를 선택해요.</li>
          <li>사진은 올리기 전 용량을 아끼려고 자동으로 줄어들어요(화질 차이는 거의 느껴지지 않아요) — PDF는 원본 그대로 올라가요.</li>
          <li>카드를 누르면 크게 볼 수 있고, 올린 사람만 삭제할 수 있어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 한 번 올린 뒤에는 개인↔공유를 바꿀 수 없어요(다시 올려야 해요). 지갑은 여행마다 따로 있어서 다른 여행에서는 보이지 않고, 사진 중 일부는 이 기기(브라우저)에만 저장되어 다른 기기에서는 안 보일 수 있어요.</p>`,
    },
    {
      key: "help-invite",
      title: "동행자와 함께 쓰기",
      icon: HELP_ICONS.invite,
      body: `
        <p>가족이나 친구와 같은 여행을 함께 보고 편집할 수 있어요.</p>
        <ul>
          <li>여행 화면 우측 상단의 <strong>☰ 메뉴 → "여행 공유"</strong>를 눌러요. (여행을 만든 사람에게만 보여요)</li>
          <li>뜨는 창에서 <strong>"링크 복사"</strong> 또는 <strong>"카카오톡으로 초대하기"</strong>로 전달해요.</li>
          <li>받은 사람이 링크를 열면 자동으로 그 여행에 참여돼서 일정·가계부를 함께 볼 수 있어요.</li>
          <li>☰ 메뉴의 <strong>"동행자 관리"</strong>에서 지금 참여 중인 사람을 확인할 수 있어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 초대 링크는 <strong>7일만</strong> 유효해요 — 지나면 창을 다시 열어 새로 만들어야 해요. 함께 초대한 동행자는 이 여행의 일정과 가계부를 서로 볼 수 있다는 점을 알고 초대해주세요.</p>`,
    },
    {
      key: "help-export",
      title: "여행 내보내기",
      icon: HELP_ICONS.export,
      body: `
        <p>여행 일정과 가계부 내용을 엑셀 파일로 저장할 수 있어요.</p>
        <ul>
          <li>설정(⚙) 화면의 <strong>"여행 내보내기"</strong>를 눌러요.</li>
          <li>내보낼 여행을 고르고 확인하면 엑셀(.xlsx) 파일로 저장돼요.</li>
          <li>파일에는 <strong>"일정"</strong>과 <strong>"가계부"</strong> 두 개의 시트가 들어 있어요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 사진, 여행지갑 파일, 동행자 정보는 엑셀에 담기지 않아요 — 일정과 가계부 내용만 저장돼요.</p>`,
    },
    {
      key: "help-notification",
      title: "알림 설정",
      icon: ICONS.bell,
      body: `
        <p>일정이 다가오거나 동행자가 생기면 알림을 받을 수 있어요.</p>
        <ul>
          <li>설정(⚙) 화면 맨 위 <strong>"알림"</strong> 섹션에서 <strong>"일정 알림"</strong>(출발 임박, 다음 일정 안내)과 <strong>"초대·공유 알림"</strong>(새 멤버 가입, 초대 수락)을 각각 켜고 끌 수 있어요.</li>
          <li><strong>"알림 켜기"</strong>를 처음 누르면 먼저 안내 창이 뜨고, <strong>"허용"</strong>을 눌러야 실제로 알림 권한을 물어봐요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 아이폰은 사파리로 그냥 열면 알림을 받을 수 없고, <strong>홈 화면에 추가</strong>한 뒤에만 받을 수 있어요. 한 번 권한을 거부했다면 이 화면이 아니라 기기나 브라우저 자체의 설정에서 다시 허용해야 해요.</p>`,
    },
    {
      key: "help-account",
      title: "계정 관리",
      icon: HELP_ICONS.account,
      body: `
        <p>설정(⚙) 화면의 <strong>"계정"</strong> 섹션에서 로그아웃하거나 탈퇴할 수 있어요.</p>
        <ul>
          <li><strong>"로그아웃"</strong> — 다시 로그인하면 그동안의 여행·일정·가계부가 그대로 남아 있어요.</li>
          <li><strong>"회원 탈퇴"</strong> — 삭제될 내용을 확인하고 동의 체크 후 버튼을 누르면, 한 번 더 확인한 뒤 탈퇴가 처리돼요.</li>
        </ul>
        <p><strong>헷갈리기 쉬운 점</strong> 회원 탈퇴는 <strong>되돌릴 수 없어요</strong> — 계정, 모든 여행, 일정, 가계부, 여행지갑 파일, 초대·동행자 정보가 전부 삭제돼요. 처리 중 문제가 생겨도 구체적인 이유 없이 "고객센터로 문의해주세요"라는 안내만 나오니, 그럴 때는 설정 &gt; 고객센터 &gt; 문의하기를 이용해주세요.</p>`,
    },
  ];

  // HELP_SECTIONS 항목 하나를 collapsibleSection과 같은 모양(제목 버튼 + 캐럿)으로 감싼다. 다만 안쪽
  // 목록이 .mytrip-menu 버튼 목록이 아니라 읽기 전용 글(문단·목록)이라, legalPages.js와 같은 .legal-content
  // 를 쓴다(새 레이아웃을 만들지 않고 이미 있는 두 클래스를 섞어 쓰는 것).
  function helpSection(section) {
    const open = sectionOpen[section.key];
    return `
      <section class="simple-page-section">
        <button type="button" class="simple-page-section-title" data-toggle-section="${section.key}"
          aria-expanded="${open}" aria-controls="help-section-${section.key}">
          <span class="simple-page-section-title-text"><span class="simple-page-section-title-icon">${section.icon}</span>${section.title}</span>
          <span class="simple-page-section-caret">${ICONS.caret}</span>
        </button>
        <div class="legal-content" id="help-section-${section.key}"${open ? "" : " hidden"}>
          ${section.body}
        </div>
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
      else if (e.target.closest('[data-action="ai-usage"]')) router.navigate(router.buildPath("ai-usage"));
      else if (e.target.closest('[data-action="notice"]')) router.navigate(router.buildPath("notice"));
      else if (e.target.closest('[data-action="contact"]')) router.navigate(router.buildPath("contact"));
      else if (e.target.closest('[data-action="help"]')) router.navigate(router.buildPath("help"));
      // 문의하기(#/contact) 맨 아래 "1:1 문의하기" - contactForm.js가 index.html 로드 순서상 이 파일보다
      // 뒤에 온다, tripExport와 같은 이유로 클릭 시점에만 읽으면 순서를 안 타도 된다
      else if (e.target.closest('[data-action="contact-open"]')) window.TripLog.contactForm?.open();
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

  // 공지사항: 아직 내용 없이 자리만 잡아둔 화면("준비 중이에요") - renderNotifications와 같은 모양이다
  function renderNotice(el) {
    el.innerHTML = `${header("공지사항")}<p class="simple-page-empty">준비 중이에요.</p>`;
    bindBack(el);
  }

  // 문의하기(#/contact) 자주 묻는 질문 - 코드가 아니라 실제로 확인된 동작만 적는다(추측 금지). 질문 글자
  // 자체는 Q.를 붙이지 않는다(제목 버튼이 이미 물음표로 끝나 질문임이 분명하다). helpSection과 같은 모양을
  // 쓰되 아이콘은 없다(질문/답변엔 화면을 가리킬 아이콘이 필요 없다).
  const FAQ_ITEMS = [
    {
      key: "faq-device",
      title: "여행 데이터는 다른 기기에서도 보이나요?",
      body: `<p>일정·가계부는 계정(서버)에 저장돼서 같은 계정으로 로그인하면 다른 기기에서도 똑같이 보여요. 다만 일정에 첨부한 사진 중 일부는 이 기기(브라우저)에만 저장되는 것이 있어서, 기기를 바꾸면 안 보일 수 있어요.</p>`,
    },
    {
      key: "faq-invite",
      title: "초대 링크가 안 열려요.",
      body: `<p>초대 링크는 만든 뒤 <strong>7일</strong>만 유효해요. 지났다면 여행 화면 ☰ 메뉴의 <strong>"여행 공유"</strong>에서 새로 만들어 다시 보내주세요.</p>`,
    },
    {
      key: "faq-delete-mistake",
      title: "일정이나 가계부를 실수로 지웠어요. 복구할 수 있나요?",
      body: `<p>카드를 옆으로 쓸어넘겨 지운 항목은 확인창 없이 바로 삭제되고, <strong>따로 복구하는 기능은 없어요</strong>. 순서만 바꾸고 싶을 땐 손잡이(≡)로 끌어서 옮겨주세요.</p>`,
    },
    {
      key: "faq-ticket-scan",
      title: "항공권 사진을 올렸는데 자동으로 안 읽혀요.",
      body: `<p>사진이 흐릿하거나 항공권이 아닌 경우 자동 인식이 안 될 수 있어요. 이때는 직접 입력으로 등록해주세요. 분석에 쓰인 사진은 서버에 저장되지 않고 인식이 끝나면 바로 폐기돼요.</p>`,
    },
    {
      key: "faq-notification",
      title: "알림이 안 와요.",
      body: `<p>설정(⚙) 맨 위 "알림" 섹션에서 알림이 켜져 있는지 먼저 확인해주세요. 아이폰은 사파리로 그냥 열면 알림을 받을 수 없고 <strong>홈 화면에 추가</strong>한 뒤에만 받을 수 있어요. 한 번 권한을 거부했다면 이 화면이 아니라 기기나 브라우저 자체 설정에서 다시 허용해야 해요.</p>`,
    },
    {
      key: "faq-wallet-share",
      title: "여행지갑에 올린 사진이 다른 사람에게 보이나요?",
      body: `<p>기본값인 <strong>"개인지갑"</strong>은 본인만 볼 수 있어요. 업로드할 때 <strong>"공유지갑"</strong>을 선택한 경우에만 같은 여행의 동행자에게 보여요. 한 번 올리면 나중에 개인↔공유를 바꿀 수 없어요.</p>`,
    },
    {
      key: "faq-exchange",
      title: "환율·날씨 정보가 실제와 달라요.",
      body: `<p>환율·날씨·현지 뉴스 등은 참고용 외부 정보라 실제 값과 차이가 있을 수 있어요. 국내 여행은 환율·시차 카드가 원래 나오지 않는 것이 정상이에요.</p>`,
    },
    {
      key: "faq-export",
      title: "여행 일정과 가계부를 엑셀로 받을 수 있나요?",
      body: `<p>설정(⚙)의 <strong>"여행 내보내기"</strong>에서 가능해요. 다만 사진, 여행지갑 파일, 동행자 정보는 포함되지 않고 일정과 가계부 내용만 담겨요.</p>`,
    },
    {
      key: "faq-account-delete",
      title: "회원 탈퇴하면 어떻게 되나요?",
      body: `<p>계정, 모든 여행, 일정, 가계부, 여행지갑 파일, 초대·동행자 정보가 전부 삭제되고 <strong>되돌릴 수 없어요</strong>.</p>`,
    },
  ];

  function faqSection(item) {
    const open = sectionOpen[item.key];
    return `
      <section class="simple-page-section">
        <button type="button" class="simple-page-section-title" data-toggle-section="${item.key}"
          aria-expanded="${open}" aria-controls="faq-section-${item.key}">
          <span>${item.title}</span>
          <span class="simple-page-section-caret">${ICONS.caret}</span>
        </button>
        <div class="legal-content" id="faq-section-${item.key}"${open ? "" : " hidden"}>
          ${item.body}
        </div>
      </section>`;
  }

  // 문의하기(#/contact) - 자주 묻는 질문(FAQ)을 먼저 보여주고, 맨 아래 "1:1 문의하기" 버튼으로 직접 문의를
  // 남길 수 있다(contactForm.js가 여는 모달). 받는 메일 주소는 Edge Function(send-contact-email)의 비밀값
  // (CONTACT_EMAIL)으로만 있어서 이 화면을 포함해 클라이언트 어디에도 나타나지 않는다.
  function renderContact(el) {
    el.innerHTML = `
      ${header("문의하기")}
      <div class="legal-content"><p>자주 묻는 질문을 먼저 확인해보세요. 해결되지 않으면 맨 아래 "1:1 문의하기"로 남겨주세요.</p></div>
      ${FAQ_ITEMS.map(faqSection).join("")}
      <div class="simple-page-section">
        <button type="button" class="btn btn-save settings-permission-btn" data-action="contact-open">1:1 문의하기</button>
      </div>`;
    bindBack(el);
  }

  // 도움말(#/help) - 처음 쓰는 사람도 전체 화면을 혼자 둘러볼 수 있게, 화면별 사용법을 접고 펼치는 글로
  // 안내한다(HELP_SECTIONS 참고). 실제 화면 캡처 대신 각 화면의 탭 아이콘을 그대로 써서 어떤 화면인지
  // 알아보게 했다 - 로그인 후 실제 데이터가 있어야 의미 있는 스크린샷은 아직 넣지 않았다.
  function renderHelp(el) {
    el.innerHTML = `
      ${header("도움말")}
      <div class="legal-content"><p>아래 항목을 눌러 펼쳐보면 각 화면의 사용법을 확인할 수 있어요.</p></div>
      ${HELP_SECTIONS.map(helpSection).join("")}
      <div class="legal-content"><p>궁금한 점을 찾지 못하셨다면 설정 &gt; 고객센터 &gt; 문의하기로 알려주세요.</p></div>`;
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
         <li><button type="button" data-action="privacy-notice">개인정보 수집·이용 안내</button></li>
         <li><button type="button" data-action="ai-usage">AI 및 외부 서비스 이용 안내</button></li>`
      )}
      ${collapsibleSection(
        "account",
        "계정",
        `<li><button type="button" data-action="logout">로그아웃</button></li>
         <li class="mytrip-menu-logout"><button type="button" data-action="account-delete">회원 탈퇴</button></li>`
      )}
      ${actionTitle("trip-export", "여행 내보내기")}
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
