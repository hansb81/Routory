// @별칭 LOGIN · 로그인 화면 (#/login)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 로그인 화면(#/login): 구글/카카오/네이버 소셜 로그인 버튼.
// 구글/카카오는 supabase.auth.signInWithOAuth가 해당 소셜 로그인 페이지를 연다 — 웹은 이 창 자체를 그 페이지로
// 옮기고, 로그인이 끝나면 redirectTo(auth.oauthRedirectTo())의 지금 주소(#/main)로 돌아온다. 세션을 만드는
// 일(URL의 code 교환)은 supabase-js가 알아서 하므로 별도의 콜백 화면은 없다(해시 라우터와 함께 쓰려고
// supabaseClient.js에서 flowType을 "pkce"로 지정했다).
// 네이티브 앱은 이 창(앱 내장 웹뷰) 안에서 열지 않는다 — 구글이 앱에 내장된 웹뷰에서 여는 로그인 페이지를
// disallowed_useragent로 막기 때문에, skipBrowserRedirect:true로 이동을 막고 받은 URL을 @capacitor/browser로
// 진짜 시스템 브라우저(Custom Tabs)에 연다. 로그인이 끝나면 routory://auth-callback 딥링크로 돌아오고
// (auth.js#initDeepLinks가 받아서 이 탭도 닫는다).
// 네이버는 Supabase의 소셜 로그인 제공자 목록에 없어서 signInWithOAuth를 못 쓰고, 아래 naverSignIn()이
// 네이버 OAuth2.0 인가 코드 요청을 직접 연다. 돌아올 곳은 해시 라우터 밖의 순수 경로(auth/naver-callback.html,
// /auth/naver-callback으로 열린다)이고, 지금은 code/state를 받아서 보여주기만 한다 — 그 code를 실제 로그인
// 세션으로 바꾸는 서버 쪽 작업(네이버 토큰 교환에 필요한 클라이언트 시크릿을 다루는 Edge Function과, Supabase
// 세션을 만들어 붙이는 절차)은 아직 없다.

(function () {
  const router = window.TripLog.router;
  const supabase = window.TripLog.supabase;
  const auth = window.TripLog.auth;
  const util = window.TripLog.util;

  const NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize";
  const NAVER_STATE_KEY = "triplog.naverOAuthState"; // 콜백 페이지가 CSRF 확인에 쓴다 (auth/naver-callback.html)

  function naverRedirectUri() {
    return `${window.location.origin}/auth/naver-callback`;
  }

  function naverSignIn() {
    const clientId = window.TripLogConfig?.naverClientId;
    if (!clientId) throw new Error("naverClientId가 설정되지 않았어요 (config.js 참고)");

    const state = util.generateId();
    try {
      sessionStorage.setItem(NAVER_STATE_KEY, state);
    } catch (err) {
      // 세션 저장소를 못 쓰면(사생활 보호 모드 등) 콜백에서 state를 확인할 수 없다 — 그래도 로그인 시도 자체는 막지 않는다
      console.warn("[login] 네이버 로그인 state를 sessionStorage에 저장하지 못했습니다.", err);
    }

    const url = new URL(NAVER_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", naverRedirectUri());
    url.searchParams.set("state", state);
    window.location.href = url.toString();
  }

  // 버튼 왼쪽에 들어가는 각 서비스의 대표 이미지. 파일을 따로 받지 않도록 SVG를 그대로 넣었다 (버튼 색은 style.css의 --brand-* 토큰).
  const ICONS = {
    google: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
    kakao: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.86 5.32 4.66 6.74l-.96 3.52c-.08.3.26.53.52.36l4.18-2.76c.53.07 1.06.1 1.6.1 5.52 0 10-3.58 10-8S17.52 3 12 3z"/></svg>`,
    naver: `<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="#FFFFFF" d="M13.56 10.7 6.16 0H0v20h6.44V9.3L13.84 20H20V0h-6.44z"/></svg>`,
  };

  const PROVIDERS = [
    { id: "google", label: "구글로 시작하기" },
    { id: "kakao", label: "카카오로 시작하기" },
    { id: "naver", label: "네이버로 시작하기" },
  ];

  // 카카오톡으로 받은 초대 링크는 카카오톡 안의 브라우저(웹뷰)에서 열린다. 구글은 보안 정책상 웹뷰에서의 로그인을 막으므로(403 disallowed_useragent)
  // 그 안에서는 카카오로 시작하거나 기본 브라우저로 열도록 미리 알려준다.
  function inAppBrowserNote() {
    if (!/KAKAOTALK/i.test(navigator.userAgent)) return "";
    return `<p class="page-note login-note">카카오톡 안에서는 구글 로그인이 막힐 수 있어요. '카카오로 시작하기'를 누르거나, 오른쪽 아래 메뉴에서 기본 브라우저로 열어주세요.</p>`;
  }

  function render(pageEl) {
    pageEl.innerHTML = `
      <section class="login" data-alias="LOGIN-BUTTONS · 소셜 로그인 버튼">
        <h1 class="page-title">Routory</h1>
        <p class="page-note">소셜 계정으로 로그인하고 여행을 시작하세요.</p>
        <img class="login-icon" src="img/login-icon.png" alt="Routory" />
        <div class="login-buttons">
          ${PROVIDERS.map(
            (p) => `
            <button type="button" class="login-btn login-btn--${p.id}" data-provider="${p.id}">
              <span class="login-btn-icon">${ICONS[p.id]}</span>
              <span class="login-btn-label">${p.label}</span>
            </button>`
          ).join("")}
        </div>
        <p class="login-error" role="alert" hidden></p>
        ${inAppBrowserNote()}
      </section>
    `;

    const errorEl = pageEl.querySelector(".login-error");
    // 소셜 로그인에서 돌아오며 실패했다면 이유를 보여준다 (auth.js가 돌아온 주소에서 붙잡아 둔 것)
    const failed = auth.takeCallbackError();
    if (failed) showError(errorEl, `로그인에 실패했어요.${failed.description || failed.code ? ` (${failed.description || failed.code})` : ""}`);

    pageEl.querySelector(".login-buttons").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-provider]");
      if (!btn) return;
      if (btn.dataset.provider === "naver") return startNaverSignIn(pageEl, errorEl);
      signIn(btn.dataset.provider, pageEl, errorEl);
    });
  }

  function showError(errorEl, message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function setBusy(pageEl, busy) {
    pageEl.querySelectorAll(".login-btn").forEach((btn) => (btn.disabled = busy));
  }

  async function signIn(provider, pageEl, errorEl) {
    errorEl.hidden = true;
    // file://로 연 페이지는 주소(origin)가 없어서 로그인 후 돌아올 곳이 없다
    if (!/^https?:$/.test(window.location.protocol)) {
      showError(errorEl, "파일로 직접 연 화면에서는 로그인할 수 없어요. http://localhost:8080/ 처럼 서버 주소로 열어주세요.");
      return;
    }

    setBusy(pageEl, true); // 이동하는 동안 두 번 누르지 않게 한다
    try {
      // 초대 링크 등에서 넘어왔다면(#/login?redirect=/invite/abc) 소셜 로그인을 다녀온 뒤 그 경로로 돌아가게 기억해 둔다 (없으면 지운다)
      auth.savePostLoginPath(router.safeRedirect(router.query().get("redirect")));
      const native = auth.isNativeApp();
      // 네이티브 앱은 이 창(앱 내장 웹뷰) 안에서 옮기지 않고 URL만 받는다: 구글이 앱에 내장된 웹뷰에서 여는
      // 로그인 페이지를 막기 때문(disallowed_useragent) — 실제로 여는 건 아래에서 진짜 외부 브라우저로 한다.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: auth.oauthRedirectTo(), skipBrowserRedirect: native },
      });
      if (error) throw error;
      if (native) {
        // Custom Tabs(진짜 시스템 브라우저)로 연다. 로그인이 끝나면 routory://auth-callback 딥링크로
        // 돌아오고(auth.js#handleDeepLink가 받아서 이 탭도 닫는다), 취소하고 그냥 닫아도 여기서 이미
        // 버튼을 풀어놨으니 다시 누를 수 있다(Custom Tabs가 화면을 덮고 있는 동안은 이 버튼을 누를 수 없다).
        await window.Capacitor.Plugins.Browser.open({ url: data.url });
        setBusy(pageEl, false);
      }
      // 성공하면(웹은 페이지 이동, 네이티브는 외부 브라우저가 열림) 여기서 더 할 일이 없다
    } catch (err) {
      console.warn("[login] 소셜 로그인 시작 실패", err);
      setBusy(pageEl, false);
      showError(errorEl, "로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해주세요.");
    }
  }

  // 네이버는 signInWithOAuth를 못 쓰므로(위 파일 상단 설명 참고) naverSignIn()으로 직접 인가 요청을 연다.
  // 비동기 네트워크 호출 없이 바로 페이지를 옮기므로, 실패는 요청을 만드는 단계(예: client_id 미설정)에서만 난다.
  function startNaverSignIn(pageEl, errorEl) {
    errorEl.hidden = true;
    if (!/^https?:$/.test(window.location.protocol)) {
      showError(errorEl, "파일로 직접 연 화면에서는 로그인할 수 없어요. http://localhost:8080/ 처럼 서버 주소로 열어주세요.");
      return;
    }
    setBusy(pageEl, true); // 페이지를 떠나기 전 두 번 누르지 않게 한다
    try {
      // 초대 링크 등에서 넘어왔다면 로그인 뒤 그 경로로 돌아가게 기억해 둔다 (다른 제공자와 동일한 규칙)
      auth.savePostLoginPath(router.safeRedirect(router.query().get("redirect")));
      naverSignIn(); // 성공하면 네이버 로그인 페이지로 이동하므로 여기서 더 할 일이 없다
    } catch (err) {
      console.warn("[login] 네이버 로그인 시작 실패", err);
      setBusy(pageEl, false);
      showError(errorEl, "로그인을 시작하지 못했어요. 잠시 뒤 다시 시도해주세요.");
    }
  }

  // 소셜 로그인 페이지에서 뒤로 가기로 돌아오면 브라우저가 이 화면을 그대로(버튼이 눌린 채) 복원할 수 있다
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) document.querySelectorAll(".login-btn").forEach((btn) => (btn.disabled = false));
  });

  router.definePage("login", render);
})();
