// @별칭 AUTH · 로그인 상태 · 로그인 뒤 돌아갈 경로
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 로그인 상태. Supabase 세션을 앱이 시작될 때 한 번 읽어 두고, 이후 로그인/로그아웃/토큰 갱신 이벤트
// (supabase.auth.onAuthStateChange)로 갱신해서 이 모듈에 "현재 사용자"로 들고 있는다.
// 라우터의 화면 보호(guard)는 동기 함수라서 매번 getSession()을 기다릴 수 없어, 여기 캐시해 둔 값을 쓴다.
// 화면 보호 규칙 자체(로그인 안 했으면 #/login으로)는 app.js#initRouting에 있다.
//
// 네이티브 앱(Capacitor)에서의 소셜 로그인: 웹은 supabase-js가 돌아온 주소(?code=...)를 페이지 로드 시점에
// 알아서 세션으로 바꾸지만(supabaseClient.js의 flowType "pkce"), 네이티브 앱은 시스템 브라우저에서 돌아올 때
// 페이지가 다시 로드되지 않고 커스텀 URL 스킴(routory://auth-callback)으로 OS가 앱을 깨우기만 한다. 그래서
// oauthRedirectTo()로 네이티브에서는 이 스킴을 쓰고, initDeepLinks()가 @capacitor/app의 appUrlOpen 이벤트로
// 그 주소를 받아 code를 직접 세션으로 바꾼다(handleDeepLink). 번들러가 없는 프로젝트라 @capacitor/app의 JS를
// 따로 불러오지 않고, 네이티브 브리지가 늘 올려 두는 범용 프록시 window.Capacitor.Plugins.App을 그대로 쓴다
// (mobile/의 package.json에 @capacitor/app을 설치해 두면 네이티브 쪽 플러그인 등록만으로 충분하다).
// AndroidManifest.xml의 intent-filter(scheme "routory")가 이 URL을 앱으로 라우팅한다.
// "시스템 브라우저에서" 라고 한 건 실제로 loginPage.js가 로그인 URL을 앱 내장 웹뷰가 아니라 @capacitor/browser로
// 연 Custom Tabs에 열기 때문이다(구글이 내장 웹뷰의 로그인 페이지를 disallowed_useragent로 막아서 — Login
// page 참고). handleDeepLink는 돌아오자마자 그 브라우저 탭도 Capacitor.Plugins.Browser.close()로 닫는다.

(function () {
  const supabase = window.TripLog.supabase;
  const ui = window.TripLog.ui;
  const INIT_TIMEOUT_MS = 5000; // 세션을 읽는 데 이보다 오래 걸리면 일단 로그인 안 한 것으로 시작한다 (늦게 알려지면 이벤트로 바로잡힌다)
  const NATIVE_REDIRECT_URL = "routory://auth-callback";

  let session = null;
  const listeners = [];

  // 소셜 로그인에서 돌아온 주소에 오류가 실려 있으면(예: 이메일을 못 가져옴, 동의 취소) 그 내용을 붙잡아 둔다.
  // 돌아온 주소는 곧 라우터가 다른 주소로 바꿔 버리고 supabase-js도 정리하므로, 스크립트가 실행되는 지금 읽어야 한다.
  // 오류는 쿼리(?error=...)나 해시(#error=..., #/main#error=...) 어디로든 올 수 있다.
  let callbackError = readCallbackError();

  function readCallbackError() {
    const href = window.location.href;
    const pick = (key) => {
      const match = new RegExp(`[?#&]${key}=([^&#]*)`).exec(href);
      if (!match) return null;
      try {
        return decodeURIComponent(match[1].replace(/\+/g, " "));
      } catch (err) {
        return match[1];
      }
    };
    const description = pick("error_description");
    const code = pick("error_code") ?? pick("error");
    if (!description && !code) return null;
    console.warn("[auth] 소셜 로그인에서 돌아오며 오류가 왔습니다.", { code, description });
    return { code, description };
  }

  // 로그인 화면이 한 번만 보여주도록 꺼내면서 비운다
  function takeCallbackError() {
    const error = callbackError;
    callbackError = null;
    return error;
  }

  // 로그인을 요구하는지. config의 requireLogin을 false로 하면 끌 수 있고,
  // file://로 연 화면은 소셜 로그인이 안 되는 주소라서 요구하지 않는다.
  function isRequired() {
    return window.TripLogConfig?.requireLogin !== false && /^https?:$/.test(window.location.protocol);
  }

  // 네이티브 앱(Capacitor)에서 실행 중인지. 웹에서는 window.Capacitor가 아예 없다(스크립트를 따로 불러오지 않으므로).
  function isNativeApp() {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  }

  // 소셜 로그인 뒤 돌아올 주소: 네이티브 앱은 커스텀 URL 스킴(딥링크), 웹은 지금 화면 주소(origin)로 돌아온다.
  function oauthRedirectTo() {
    return isNativeApp() ? NATIVE_REDIRECT_URL : `${window.location.origin}/#/main`;
  }

  // 네이티브 앱이 routory://auth-callback?code=...로 돌아오면(웹의 ?code=...와 같은 값, PKCE) 여기서 세션으로 바꾼다.
  // 성공하면 아래 onAuthStateChange가 SIGNED_IN을 알려서 화면은 그 쪽(app.js의 auth.onChange)에서 옮겨진다.
  async function handleDeepLink(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return; // routory:// 스킴이 아닌 다른 딥링크(다른 기능이 나중에 추가되면)는 여기서 다루지 않는다
    }
    // 로그인은 @capacitor/browser로 연 외부 브라우저(Custom Tabs)에서 끝나고 돌아온 것이므로, 이제 그 탭은
    // 필요 없다 — 실패해도 닫아 버린다(열려 있지 않을 때 불러도 그냥 조용히 끝난다).
    window.Capacitor.Plugins.Browser?.close().catch(() => {});

    const code = parsed.searchParams.get("code");
    const errorDescription = parsed.searchParams.get("error_description");
    const errorCode = parsed.searchParams.get("error_code") ?? parsed.searchParams.get("error");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn("[auth] 딥링크의 코드를 세션으로 바꾸지 못했습니다.", error);
        ui.showToast("로그인에 실패했어요. 다시 시도해주세요.");
      }
    } else if (errorCode || errorDescription) {
      console.warn("[auth] 딥링크로 돌아오며 오류가 왔습니다.", { errorCode, errorDescription });
      ui.showToast(`로그인에 실패했어요.${errorDescription ? ` (${errorDescription})` : ""}`);
    }
  }

  // 네이티브 앱에서만 딥링크를 받는다. @capacitor/app의 JS 패키지를 따로 불러오지 않고(번들러가 없어서),
  // 네이티브 브리지가 항상 올려 두는 범용 플러그인 프록시(window.Capacitor.Plugins.<이름>)를 그대로 쓴다.
  function initDeepLinks() {
    if (!isNativeApp()) return;
    window.Capacitor.Plugins.App.addListener("appUrlOpen", ({ url }) => handleDeepLink(url));
  }

  // 세션을 읽는다. 소셜 로그인에서 돌아온 직후(?code=...)라면 supabase-js가 코드를 세션으로 바꾸는 것까지 기다려 준다.
  async function init() {
    const read = supabase.auth
      .getSession()
      .then(({ data, error }) => {
        session = data.session;
        if (error) {
          // 코드를 세션으로 바꾸다 실패한 경우 등. 로그인 화면에서 이유를 보여줄 수 있게 남긴다.
          console.warn("[auth] 세션을 만들지 못했습니다.", error);
          callbackError ??= { code: error.code ?? error.name ?? null, description: error.message ?? null };
        }
      })
      .catch((err) => {
        console.warn("[auth] 세션을 읽지 못했습니다.", err);
        session = null;
      });
    await Promise.race([read, new Promise((resolve) => setTimeout(resolve, INIT_TIMEOUT_MS))]);

    // 콜백 안에서 supabase 함수를 기다리면 멈출 수 있으니, 여기서는 값만 저장하고 알린다
    supabase.auth.onAuthStateChange((event, next) => {
      session = next;
      listeners.forEach((fn) => fn(event, next));
    });
  }

  // 로그인이 필요한 화면(예: 초대 링크)에서 로그인 화면으로 왔을 때, 소셜 로그인 페이지를 다녀온 뒤 돌아갈 경로를 기억한다.
  // 소셜 로그인은 페이지를 통째로 떠났다 돌아오므로 메모리 대신 localStorage에 둔다. 오래된 값은 쓰지 않는다.
  const POST_LOGIN_KEY = "triplog.postLoginPath";
  const POST_LOGIN_MAX_AGE_MS = 15 * 60 * 1000;

  function savePostLoginPath(path) {
    try {
      if (path) localStorage.setItem(POST_LOGIN_KEY, JSON.stringify({ path, at: Date.now() }));
      else localStorage.removeItem(POST_LOGIN_KEY);
    } catch (err) {
      /* 저장소를 못 쓰면 로그인 뒤에 메인으로 간다 */
    }
  }

  // 기억해 둔 경로를 꺼내면서 지운다 (없거나 오래됐으면 null). 경로가 안전한지는 부르는 쪽이 router.safeRedirect로 검사한다.
  function takePostLoginPath() {
    try {
      const saved = JSON.parse(localStorage.getItem(POST_LOGIN_KEY) || "null");
      localStorage.removeItem(POST_LOGIN_KEY);
      return saved && typeof saved.path === "string" && Date.now() - saved.at < POST_LOGIN_MAX_AGE_MS ? saved.path : null;
    } catch (err) {
      return null;
    }
  }

  const isLoggedIn = () => Boolean(session);
  const getUserId = () => session?.user?.id ?? null;

  // 소셜 계정의 표시용 정보. 제공자마다 user_metadata의 필드 이름이 달라서 후보를 차례로 본다.
  //   이름: 구글은 full_name/name, 카카오는 name/nickname 쪽으로 오는 경우가 많다
  //   사진: 구글은 avatar_url/picture, 카카오는 avatar_url/profile_image 쪽
  function getProfile() {
    const user = session?.user;
    if (!user) return null;
    const meta = user.user_metadata ?? {};
    const email = user.email ?? meta.email ?? null;
    const avatar = meta.avatar_url || meta.picture || meta.profile_image || meta.profile_image_url || null;
    return {
      id: user.id,
      name: meta.full_name || meta.name || meta.nickname || meta.preferred_username || meta.user_name || (email ? email.split("@")[0] : null),
      email,
      avatarUrl: typeof avatar === "string" && /^https?:\/\//.test(avatar) ? avatar : null,
      provider: user.app_metadata?.provider ?? null,
    };
  }

  // 이 브라우저에서만 로그아웃한다 (다른 기기의 로그인은 그대로 둔다)
  function signOut() {
    return supabase.auth.signOut({ scope: "local" });
  }

  // fn(event, session): SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED ...
  function onChange(fn) {
    listeners.push(fn);
  }

  // 딥링크 수신은 세션을 읽는 init()을 기다릴 필요가 없다(전역 리스너 등록일 뿐이라 동기로 바로 걸어 둔다).
  initDeepLinks();

  window.TripLog = window.TripLog || {};
  window.TripLog.auth = {
    savePostLoginPath,
    takePostLoginPath,
    init,
    isRequired,
    isNativeApp,
    oauthRedirectTo,
    isLoggedIn,
    getUserId,
    getProfile,
    signOut,
    onChange,
    takeCallbackError,
  };
})();
