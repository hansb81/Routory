// naver-callback.html의 콜백 처리 로직. 원래 그 파일 안의 인라인 <script>였으나, Vercel에
// Content-Security-Policy를 걸면서(script-src에 'unsafe-inline' 없이) 외부 파일로 분리했다
// (2026-10-19 보안 점검 DEP-01) — 로직은 그대로다.
//
// 이 페이지는 해시(#) 라우터 밖의 순수 경로(/auth/naver-callback)로 열린다. 네이버가 인가 코드를
// ?code=...&state=...로 이 주소에 그대로 돌려주기 때문이다 — 해시 라우터 안(#/...)이면 그 쿼리스트링이
// 해시 뒤로 가서 이 페이지가 읽을 수 없다. js/loginPage.js#naverSignIn이 인가 요청을 보내기 직전
// sessionStorage에 저장해 둔 state 값과 대조해 CSRF를 확인한다(한 번 확인하면 바로 지운다).
//
// 성공/실패 모두 이 페이지에 머무르지 않고 앱(index.html)으로 돌아간다:
//   성공 → /#/main (거기서 이미 로그인한 상태로 보인다 — 세션은 아래 verifyOtp가 localStorage에 남겨 둔다.
//          app.js가 시작하면서 auth.takePostLoginPath()로, 로그인 전에 저장해 둔 경로가 있으면 마저 그리로 보낸다)
//   실패 → /#/login?error=...&error_description=... (구글/카카오 실패와 같은 방식 — loginPage.js가
//          auth.js#takeCallbackError()로 이 값을 한 번 읽어 보여준다. 이 페이지 자체에 에러 UI를 새로
//          만들 필요가 없다)
(function () {
  const SUPABASE_URL = "https://ffzjgiknrrgwvgobybdq.supabase.co";
  // triplog/js/supabaseClient.js와 같은 값. anon 키는 비밀값이 아니다(그 파일의 설명 참고).
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmempnaWtucnJnd3Znb2J5YmRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4ODY5MjksImV4cCI6MjEwNTQ2MjkyOX0.65VHeuLTokig13dfWoNQtqBLG9AthDQO_UGSN8Vn7DQ";
  const STATE_KEY = "triplog.naverOAuthState";

  const titleEl = document.getElementById("status-title");
  const noteEl = document.getElementById("status-note");

  function setStatus(title, note) {
    titleEl.textContent = title;
    noteEl.textContent = note;
  }

  function goToLogin(errorCode, errorDescription) {
    const params = new URLSearchParams();
    if (errorCode) params.set("error", errorCode);
    if (errorDescription) params.set("error_description", errorDescription);
    const query = params.toString();
    window.location.href = `${window.location.origin}/#/login${query ? `?${query}` : ""}`;
  }

  function goToMain() {
    window.location.href = `${window.location.origin}/#/main`;
  }

  async function run() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const naverErrorCode = params.get("error");
    const naverErrorDescription = params.get("error_description");

    let savedState = null;
    try {
      savedState = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY); // 한 번 확인하고 나면 필요 없는 값이라(성공하든 실패하든) 바로 지운다
    } catch (err) {
      // 세션 저장소를 못 읽어도(예: state를 저장하지 못했던 경우) 아래에서 그냥 불일치로 처리된다
    }

    // 1) 네이버가 오류를 돌려줬거나, code가 없거나, state가 안 맞으면 여기서 멈춘다 (CSRF 확인)
    if (naverErrorCode || naverErrorDescription) {
      console.warn("[naver-callback] 네이버 로그인에서 오류를 돌려주었습니다.", { naverErrorCode, naverErrorDescription });
      setStatus("네이버 로그인에 실패했어요.", "로그인 화면으로 돌아가요…");
      return goToLogin(naverErrorCode || "naver_failed", naverErrorDescription);
    }
    if (!code) {
      setStatus("네이버 로그인에 실패했어요.", "로그인 화면으로 돌아가요…");
      return goToLogin("naver_no_code", "인가 코드를 받지 못했어요.");
    }
    if (!savedState || state !== savedState) {
      console.warn("[naver-callback] state 값이 일치하지 않습니다.", { state, savedState });
      setStatus("네이버 로그인에 실패했어요.", "로그인 화면으로 돌아가요…");
      return goToLogin("naver_state_mismatch", "요청 정보가 일치하지 않아요. 다시 시도해주세요.");
    }

    setStatus("네이버 로그인 처리 중이에요…", "잠시만 기다려주세요.");

    // detectSessionInUrl은 끈다 — 이 주소의 ?code=는 네이버 인가 코드지 Supabase의 PKCE code가 아니라서,
    // supabase-js가 이 값으로 자기 나름의 세션 교환을 시도하게 두면 안 된다. 세션은 아래 verifyOtp로만 만든다.
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, detectSessionInUrl: false },
    });

    // 2) naver-login Edge Function에 code(+state)를 넘기고 hashedToken을 받는다
    let hashedToken;
    try {
      const { data, error } = await supabase.functions.invoke("naver-login", { body: { code, state } });
      if (error || data?.error || !data?.hashedToken) {
        throw new Error(data?.error || error?.message || "naver-login 함수 호출에 실패했어요");
      }
      hashedToken = data.hashedToken;
    } catch (err) {
      console.error("[naver-callback] naver-login 함수 호출 실패", err);
      setStatus("네이버 로그인에 실패했어요.", "로그인 화면으로 돌아가요…");
      return goToLogin("naver_login_failed", "로그인 처리 중 오류가 발생했어요.");
    }

    // 3) 받은 토큰으로 실제 로그인 세션을 만든다 (email/비밀번호 없이, token_hash만으로 확인)
    try {
      const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: hashedToken });
      if (error) throw error;
    } catch (err) {
      console.error("[naver-callback] verifyOtp 실패", err);
      setStatus("네이버 로그인에 실패했어요.", "로그인 화면으로 돌아가요…");
      return goToLogin("naver_verify_failed", "로그인을 완료하지 못했어요.");
    }

    // 4) 성공: verifyOtp가 만든 세션은 supabase-js가 localStorage에 남겨 두므로, 메인 페이지로 이동하면
    // 거기서 새로 만들어지는 TripLog.supabase 클라이언트가 그 세션을 그대로 이어받는다(같은 프로젝트 URL을
    // 쓰는 한 클라이언트 인스턴스가 달라도 같은 localStorage 키를 공유한다).
    setStatus("로그인됐어요!", "메인 화면으로 이동해요…");
    goToMain();
  }

  run();
})();
