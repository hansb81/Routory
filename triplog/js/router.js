// @별칭 ROUTER · 화면 이동 · 접근 제한
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 해시(#/경로) 기반의 간단한 SPA 라우터. 빌드 도구 없이 file:// 에서도 동작한다.
// 라우트가 화면 하나에 대응하고, 화면 전환은 해당 화면의 DOM만 보이게(hidden 해제) 하는 방식이다.
//
//   #/main             메인
//   #/past-trips       지난 여행 (MAIN-MENU의 "지난 여행"에서 들어온다, mainPage.js)
//   #/travel-feed      여행 소식 전체 목록 (메인 화면 '여행 소식'의 "더보기", travelFeed.js). ?kind=safety|benefit&scope=domestic|overseas
//   #/discover-city/:id 도시 정보 (메인 화면 '어디로 떠나볼까요?' 카드를 누르면 온다, travelFeed.js). 여행을
//                      바로 만들지 않는 순수 정보 화면 - get_city_detail(id) 하나로 전부 그린다.
//   #/my-trip/:id      나의 여행 (지금은 빈 화면 — 상단바·하단탭바·메뉴는 tripShell.js가 그린다)
//   #/schedule/:id     일정 타임라인 (index.html에 이미 있는 화면)
//   #/login            로그인 (구글/카카오 소셜 로그인). #/login?redirect=/경로 로 열면 로그인 뒤 그 경로로 돌아간다
//   #/consent          약관 동의 (로그인은 했지만 user_consents 행이 아직 없는 사용자만 거친다, consentPage.js)
//   #/invite/:code     초대 링크로 여행에 참여
//   #/budget/:id       가계부
//   #/wallet/:id       여행지갑 (이 여행에 올린 문서만 보여준다 — 개인지갑도 공유지갑도 여행별로 따로 쌓인다)
//   #/lodging/:id      숙소 추가 (일정 화면의 QUICK-MENU "+ 숙소"에서 들어온다)
//   #/notifications    알림 (MAIN-MENU·SHELL MYTRIP-MENU 공용, commonPages.js)
//   #/settings         설정 (위와 같은 공용 화면)
//   #/terms            이용약관 (정적 화면, legalPages.js) - 로그인 없이도 볼 수 있다(로그인 가드 없음)
//   #/privacy          개인정보처리방침 (위와 같음)
//   #/account-delete   회원 탈퇴 (설정 > 계정에서 들어온다, accountDeletePage.js)
//   #/notice           공지사항 (설정 > 고객센터, commonPages.js) - 아직 "준비 중" 자리표시자 화면
//   #/contact          문의하기 (위와 같은 자리)
//   #/help             도움말 (위와 같은 자리)
//
// 알 수 없는 경로나 빈 해시는 기본 경로(/main)로 보낸다.
// 화면 내용은 definePage(name, render)로 등록한다. 등록하지 않은 화면은 라우팅 확인용 자리표시자를 보여준다.
// beforeEnter(name, guard)로 화면에 들어가기 전 조건을 검사할 수 있다 (guard가 경로 문자열을 돌려주면 그 경로로 교체 이동).

(function () {
  const DEFAULT_PATH = "/main";

  const ROUTES = [
    { name: "main", path: "/main", title: "메인" },
    { name: "past-trips", path: "/past-trips", title: "지난 여행" }, // MAIN-MENU의 "지난 여행"에서 들어온다 (mainPage.js)
    { name: "travel-feed", path: "/travel-feed", title: "여행 소식" }, // 메인 화면 '여행 소식' 영역의 "더보기" (travelFeed.js). ?kind=safety|benefit&scope=domestic|overseas 쿼리로 들어온다
    { name: "discover-city", path: "/discover-city/:id", title: "도시 정보" }, // '어디로 떠나볼까요?' 카드 (travelFeed.js) - 여행 만들기로 바로 가지 않는 정보 화면
    { name: "my-trip", path: "/my-trip/:id", title: "나의 여행" },
    { name: "schedule", path: "/schedule/:id", title: "일정" },
    { name: "login", path: "/login", title: "로그인" },
    { name: "consent", path: "/consent", title: "약관 동의" }, // 로그인은 했지만 아직 동의하지 않은 사용자만 거친다 (consentPage.js)
    { name: "invite", path: "/invite/:code", title: "초대" },
    { name: "budget", path: "/budget/:id", title: "가계부" },
    { name: "wallet", path: "/wallet/:id", title: "여행지갑" }, // 여행별로 따로 쌓이므로 다른 셸 화면들과 같은 :id가 있다
    { name: "lodging", path: "/lodging/:id", title: "숙소" },
    { name: "notifications", path: "/notifications", title: "알림" }, // MAIN-MENU·SHELL의 MYTRIP-MENU 양쪽에서 여는 공용 화면 (commonPages.js)
    { name: "settings", path: "/settings", title: "설정" }, // 위와 같은 공용 화면 쌍
    { name: "terms", path: "/terms", title: "이용약관" }, // 정적 화면 (legalPages.js), 로그인 가드 없음
    { name: "privacy", path: "/privacy", title: "개인정보처리방침" }, // 위와 같음
    { name: "account-delete", path: "/account-delete", title: "회원 탈퇴" }, // 설정 > 계정에서 들어온다 (accountDeletePage.js)
    { name: "notice", path: "/notice", title: "공지사항" }, // 설정 > 고객센터 (commonPages.js), 아직 "준비 중" 자리표시자
    { name: "contact", path: "/contact", title: "문의하기" }, // 위와 같은 자리
    { name: "help", path: "/help", title: "도움말" }, // 위와 같은 자리
  ].map(compileRoute);

  // 화면(라우트)별 별칭: comments.html 참고
  const PAGE_ALIASES = {
    main: "MAIN · 메인 화면",
    "past-trips": "PAST-TRIPS · 지난 여행 화면",
    "travel-feed": "TRAVEL-FEED-PAGE · 여행 소식 전체 목록 화면",
    "discover-city": "DISCOVER-CITY · 도시 정보 화면",
    "my-trip": "MYTRIP · 나의 여행 화면",
    login: "LOGIN · 로그인 화면",
    consent: "CONSENT · 약관 동의 화면",
    invite: "INVITE-PAGE · 초대 수락 화면",
    budget: "BUDGET · 가계부 화면",
    wallet: "WALLET · 여행지갑 화면",
    lodging: "LODGING · 숙소 추가 화면",
    notifications: "NOTIFICATIONS · 알림 화면",
    settings: "SETTINGS · 설정 화면",
    terms: "TERMS · 이용약관 화면",
    privacy: "PRIVACY · 개인정보처리방침 화면",
    "account-delete": "ACCOUNT-DELETE · 회원 탈퇴 화면",
    notice: "NOTICE · 공지사항 화면",
    contact: "CONTACT · 문의하기 화면",
    help: "HELP · 도움말 화면",
  };

  // 라우트 이름 → 그 화면이 차지하는 DOM 요소들
  const pages = {};
  const renderers = {};
  const guards = {};
  const enterHooks = {};
  const leaveHooks = {};
  let current = null; // { route, path, params }

  // ---- 경로 매칭 ----

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // "/my-trip/:id" → 정규식과 파라미터 이름 목록
  function compileRoute(route) {
    const keys = [];
    const source = route.path
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        if (!segment.startsWith(":")) return escapeRegExp(segment);
        keys.push(segment.slice(1));
        return "([^/]+)";
      })
      .join("/");
    return { ...route, keys, regex: new RegExp(`^/${source}$`) };
  }

  // 경로에 맞는 라우트와 파라미터를 돌려준다. 없으면 null.
  function match(path) {
    for (const route of ROUTES) {
      const m = route.regex.exec(path);
      if (!m) continue;
      try {
        const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(m[i + 1])]));
        return { route, path, params };
      } catch (err) {
        return null; // 잘못된 퍼센트 인코딩
      }
    }
    return null;
  }

  // 라우트 이름과 파라미터로 경로를 만든다: buildPath("schedule", { id: "abc" }) → "/schedule/abc"
  function buildPath(name, params = {}) {
    const route = ROUTES.find((r) => r.name === name);
    if (!route) throw new Error(`알 수 없는 라우트: ${name}`);
    return route.path.replace(/:(\w+)/g, (_, key) => encodeURIComponent(params[key] ?? ""));
  }

  // location.hash → "/main" 형태로 정규화 (쿼리스트링과 끝의 슬래시는 무시)
  function readPath() {
    let path = location.hash.replace(/^#/, "").split("?")[0];
    if (!path.startsWith("/")) path = `/${path}`;
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path;
  }

  // 해시의 쿼리스트링: "#/login?redirect=/invite/abc" → URLSearchParams
  function query() {
    return new URLSearchParams(location.hash.split("?")[1] ?? "");
  }

  // 로그인 뒤 돌아갈 경로로 써도 되는 값만 통과시킨다 (앱 안의 알려진 화면이고 로그인 화면이 아닌 것). 아니면 null.
  // 바깥 주소나 이상한 값으로 엉뚱한 곳에 보내지 않으려는 검사다.
  function safeRedirect(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
    const found = match(value.split(/[?#]/)[0].replace(/(.)\/+$/, "$1"));
    return found && found.route.name !== "login" ? found.path : null;
  }

  // ---- 화면 DOM ----

  function createPage(name) {
    const el = document.createElement("main");
    el.className = "page";
    el.dataset.alias = PAGE_ALIASES[name] ?? name; // 별칭 보기(aliasView)용 이름표
    el.dataset.page = name;
    el.hidden = true;
    document.getElementById("timeline").after(el);
    return el;
  }

  function pageElements(name) {
    if (name === "schedule") {
      // 일정 화면은 index.html에 원래 있던 헤더+메뉴와 타임라인이다
      return [document.querySelector(".app-top"), document.getElementById("timeline")].filter(Boolean);
    }
    if (!pages[name]) pages[name] = [createPage(name)];
    return pages[name];
  }

  function showPage(name, visible) {
    pageElements(name).forEach((el) => (el.hidden = !visible));
  }

  // 아직 화면을 등록하지 않은 라우트용 자리표시자
  function renderPlaceholder(el, { route }) {
    el.innerHTML = `<h1 class="page-title">${route.title}</h1><p class="page-note">내용 준비 중</p>`;
  }

  function renderPage(found) {
    const name = found.route.name;
    if (name === "schedule") return; // 일정 화면은 index.html의 기존 화면을 그대로 쓴다
    const el = pageElements(name)[0];
    (renderers[name] ?? renderPlaceholder)(el, found);
  }

  // ---- 화면 전환 ----

  function run(hooks, name, arg) {
    (hooks[name] ?? []).forEach((fn) => fn(arg));
  }

  function render() {
    const found = match(readPath());
    if (!found) {
      // 히스토리에 잘못된 경로를 남기지 않도록 기본 경로로 교체한다 (replaceState는 hashchange를 일으키지 않는다)
      history.replaceState(null, "", `#${DEFAULT_PATH}`);
      return render();
    }

    // 들어갈 수 없는 화면이면(예: 없는 여행) 가드가 돌려준 경로로 교체한다
    for (const guard of guards[found.route.name] ?? []) {
      const result = guard(found);
      if (typeof result === "string") {
        history.replaceState(null, "", `#${result}`);
        return render();
      }
    }

    if (current) run(leaveHooks, current.route.name, current);

    current = found;
    renderPage(found);
    // 첫 진입 때는 index.html의 일정 화면이 처음부터 보이는 상태라서, 매번 모든 화면의 표시 여부를 맞춘다
    ROUTES.forEach((route) => showPage(route.name, route.name === found.route.name));
    document.title = `Routory · ${found.route.title}`;
    window.scrollTo(0, 0);
    run(enterHooks, found.route.name, found);
  }

  // path로 이동한다. replace가 true면 뒤로 가기 기록을 남기지 않는다.
  function navigate(path, { replace = false } = {}) {
    if (path === readPath()) return;
    if (replace) {
      history.replaceState(null, "", `#${path}`);
      render();
    } else {
      location.hash = path; // hashchange가 render를 부른다
    }
  }

  function start() {
    window.addEventListener("hashchange", render);
    render();
  }

  // 화면 내용을 그리는 함수 등록: render(el, { route, path, params }). 화면에 들어올 때마다 호출된다.
  function definePage(name, renderFn) {
    renderers[name] = renderFn;
  }

  // guard({ route, path, params })가 true면 통과, 경로 문자열이면 그 경로로 교체 이동
  function beforeEnter(name, guard) {
    (guards[name] ??= []).push(guard);
  }

  function onEnter(name, fn) {
    (enterHooks[name] ??= []).push(fn);
  }

  function onLeave(name, fn) {
    (leaveHooks[name] ??= []).push(fn);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.router = {
    start,
    navigate,
    buildPath,
    query,
    readPath,
    safeRedirect,
    definePage,
    beforeEnter,
    onEnter,
    onLeave,
    current: () => current,
  };
})();
