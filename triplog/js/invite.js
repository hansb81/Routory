// @별칭 INVITE · 여행 공유(초대) 창 · 카카오톡 공유
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// SHELL의 우측 슬라이드 메뉴(MYTRIP-MENU, tripShell.js) '여행 공유' 항목: 현재 여행의 초대 코드를 찾거나 만들어
// 링크(https://도메인/#/invite/코드)를 복사한다. 코드는 trip_invites 테이블에 저장한다(유효기간 7일은 테이블 기본값).
// 유효한 코드가 이미 있으면 그것을 다시 쓴다.
// 초대 코드를 만들고 조회하는 것은 RLS상 여행을 만든 사람(owner)만 할 수 있어서, tripShell.js도 이 메뉴 항목을
// owner에게만 보여준다.
// '카카오톡으로 초대하기'는 카카오 JS SDK(Kakao.Share.sendDefault, feed 템플릿)로 같은 초대 링크를 보낸다.
// 링크를 열었을 때 초대를 받는 화면은 invitePage.js(#/invite/:code)다.
// storage.js와 마찬가지로 file:// 직접 실행을 지원하기 위해 ES 모듈 대신 전역 네임스페이스를 사용한다.

(function () {
  const supabase = window.TripLog.supabase;
  const { getTrip } = window.TripLog.storage;
  const auth = window.TripLog.auth;
  const ui = window.TripLog.ui;

  // 헷갈리는 글자(0/o, 1/l/i)를 뺀 소문자·숫자. 8자리라 31^8 가지다 (초대 코드는 그 여행을 고칠 권한을 주므로 무작위로 만든다).
  const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
  const CODE_LENGTH = 8;
  const MAX_ATTEMPTS = 3;
  const COPY_TIMEOUT_MS = 2500;

  const els = {
    overlay: document.getElementById("invite-overlay"),
    status: document.getElementById("invite-status"),
    linkBox: document.getElementById("invite-link-box"),
    link: document.getElementById("invite-link"),
    copy: document.getElementById("invite-copy"),
    kakao: document.getElementById("invite-kakao"),
    close: document.getElementById("invite-close"),
  };

  let requestId = 0;
  let currentUrl = null; // 지금 창에 보이는 초대 링크 (카카오 공유가 그대로 쓴다)

  // ---- 카카오 SDK ----

  // 카카오 SDK(약 85KB)는 초대창을 처음 열 때 불러온다: 초대를 안 쓰는 방문에서는 내려받지 않는다.
  // 버전을 올리면 integrity(무결성 해시)도 새 파일로 다시 계산해서 바꿔야 한다.
  const KAKAO_SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
  const KAKAO_SDK_INTEGRITY = "sha384-DKYJZ8NLiK8MN4/C5P2dtSmLQ4KwPaoqAfyA/DfmEc1VDxu4yyC7wy6K1Hs90nka";
  let kakaoLoading = null;

  // 카카오 SDK를 JavaScript 키로 한 번 초기화한다. 못 하면 false (SDK가 아직 없거나 키가 없음).
  function initKakao() {
    const key = window.TripLogConfig?.kakaoJsKey;
    if (!window.Kakao || !key) return false;
    try {
      if (!window.Kakao.isInitialized()) window.Kakao.init(key);
      return window.Kakao.isInitialized();
    } catch (err) {
      console.warn("[invite] 카카오 SDK 초기화 실패", err);
      return false;
    }
  }

  // SDK 스크립트를 불러오고 초기화한다 (이미 불러왔거나 불러오는 중이면 그 결과를 그대로 돌려준다). 실패하면 false.
  function loadKakao() {
    if (window.Kakao) return Promise.resolve(initKakao());
    if (!kakaoLoading) {
      kakaoLoading = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = KAKAO_SDK_URL;
        script.integrity = KAKAO_SDK_INTEGRITY;
        script.crossOrigin = "anonymous";
        script.onload = () => resolve(initKakao());
        script.onerror = () => {
          kakaoLoading = null; // 다음에 다시 시도할 수 있게 한다
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }
    return kakaoLoading;
  }

  function makeCode() {
    // crypto.randomUUID와 달리 getRandomValues는 http(폰 테스트 주소)에서도 쓸 수 있다
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  }

  function fail(error, what) {
    console.warn(`[invite] ${what} 실패`, error);
    const code = error?.code;
    const message =
      code === "PGRST205" || code === "42P01"
        ? "서버에 초대 테이블이 아직 없어요. supabase/migrations의 SQL을 먼저 실행해주세요."
        : code === "42501"
        ? "초대 링크는 여행을 만든 사람만 만들 수 있어요."
        : "초대 링크를 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.";
    return new Error(message);
  }

  // 아직 만료되지 않은 초대 코드 (없으면 null). 여러 개면 가장 오래 남은 것.
  async function findValidCode(tripId) {
    const { data, error } = await supabase
      .from("trip_invites")
      .select("invite_code")
      .eq("trip_id", tripId)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1);
    if (error) throw fail(error, "초대 코드 조회");
    return data?.[0]?.invite_code ?? null;
  }

  // 새 코드를 저장한다. 코드가 이미 있는 값과 겹치면(unique 위반) 다른 코드로 다시 시도한다.
  async function createCode(tripId) {
    const userId = auth.getUserId();
    if (!userId) throw new Error("로그인이 필요해요. 로그인한 뒤 다시 시도해주세요.");

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const inviteCode = makeCode();
      const { error } = await supabase
        .from("trip_invites")
        .insert({ trip_id: tripId, invite_code: inviteCode, created_by: userId });
      if (!error) return inviteCode;
      if (error.code !== "23505") throw fail(error, "초대 코드 저장");
    }
    throw new Error("초대 링크를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
  }

  function buildUrl(inviteCode) {
    return `${location.origin}${location.pathname}#/invite/${inviteCode}`;
  }

  async function getInviteUrl(tripId) {
    const inviteCode = (await findValidCode(tripId)) ?? (await createCode(tripId));
    return buildUrl(inviteCode);
  }

  // ---- 복사 ----

  // 클릭한 직후(사용자 동작 안)에 시작해야 한다: 서버 응답을 기다린 뒤에 복사하면 사파리는 막는다.
  // 그래서 ClipboardItem에 "나중에 정해질 텍스트"(Promise)를 넘긴다.
  function copyWhenReady(urlPromise) {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const blob = urlPromise.then((url) => new Blob([url], { type: "text/plain" }));
      return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    }
    if (navigator.clipboard?.writeText) return urlPromise.then((url) => navigator.clipboard.writeText(url));
    return Promise.reject(new Error("클립보드를 쓸 수 없어요"));
  }

  // '링크 복사' 버튼용: 클립보드 API가 없는 환경(http 주소 등)에서는 입력칸을 선택해 복사 명령을 쓴다
  async function copyNow(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch (err) {
      els.link.focus();
      els.link.select();
      try {
        return document.execCommand("copy");
      } catch (err2) {
        return false;
      }
    }
  }

  // ---- 창 ----

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle("invite-status--error", isError);
    els.status.hidden = !message;
  }

  function showLink(url) {
    currentUrl = url;
    els.link.value = url;
    els.linkBox.hidden = false;
  }

  async function openInvite() {
    const trip = getTrip();
    if (!trip) return;
    if (location.protocol === "file:") {
      ui.showAlert("초대 링크는 웹 주소(http 또는 https)로 열었을 때만 만들 수 있어요.");
      return;
    }

    loadKakao(); // 링크를 만드는 동안 카카오 SDK도 미리 받아 둔다
    const myRequest = ++requestId;
    els.linkBox.hidden = true;
    els.link.value = "";
    currentUrl = null;
    setStatus("초대 링크를 만드는 중이에요...");
    els.overlay.hidden = false;

    const urlPromise = getInviteUrl(trip.id);
    const copyPromise = copyWhenReady(urlPromise);
    copyPromise.catch(() => {}); // 결과는 아래에서 받지만, 그 전에 실패해도 '처리되지 않은 오류'로 남지 않게 한다

    let url;
    try {
      url = await urlPromise;
    } catch (err) {
      copyPromise.catch(() => {});
      if (myRequest === requestId) setStatus(err.message, true);
      return;
    }
    if (myRequest !== requestId) return; // 그 사이에 창을 닫았거나 다시 열었다

    showLink(url);
    setStatus("링크를 만들었어요. 복사하는 중이에요...");
    // 창에 포커스가 없으면 브라우저가 복사 요청을 끝내지 않고 붙잡아 둘 수 있어서, 오래 걸리면 실패로 보고 직접 복사하게 한다
    const copied = await Promise.race([
      copyPromise.then(
        () => true,
        () => false
      ),
      new Promise((resolve) => setTimeout(() => resolve(false), COPY_TIMEOUT_MS)),
    ]);
    if (myRequest !== requestId) return;
    if (copied) {
      setStatus("링크를 만들었어요. 초대할 사람에게 붙여넣어 보내주세요. (7일 동안 쓸 수 있어요)");
      ui.showToast("링크가 복사되었어요");
    } else {
      setStatus("자동으로 복사하지 못했어요. 아래 링크를 직접 복사해주세요.", true);
      els.link.focus();
      els.link.select();
    }
  }

  // 창에 있는 초대 링크를 카카오톡으로 보낸다. 카카오톡이 없는 환경(데스크톱 등)은 SDK가 설치 안내나 웹 공유 창으로 이어 준다.
  // 팝업이 막히지 않도록 링크를 다시 만들지 않고, 창을 열 때 이미 만들어 둔 링크를 바로 쓴다.
  function shareToKakao() {
    const trip = getTrip();
    if (!initKakao()) {
      // 창을 열 때 시작한 SDK 불러오기가 아직 안 끝났거나 실패했다. 사용자 동작 안에서 바로 열어야 팝업이 막히지 않아서 여기서 기다리지 않는다.
      loadKakao();
      ui.showToast("카카오톡 공유를 준비하는 중이에요. 잠시 뒤 다시 눌러주세요.");
      return;
    }
    if (!trip || !currentUrl) {
      ui.showToast("초대 링크를 만드는 중이에요. 잠시 뒤 다시 눌러주세요.");
      return;
    }

    // "도쿄, 일본" → "도쿄". 여행지가 없으면 여행 제목을 쓴다.
    const place = (trip.destination || "").split(",")[0].trim() || trip.title || "Routory";
    const link = { mobileWebUrl: currentUrl, webUrl: currentUrl };
    try {
      window.Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: `${place} 여행에 초대합니다`,
          description: "함께 일정을 관리해보세요",
          imageUrl: window.TripLogConfig?.inviteImageUrl,
          link,
        },
        buttons: [{ title: "여행 참여하기", link }],
      });
    } catch (err) {
      console.warn("[invite] 카카오톡 공유 실패", err);
      ui.showAlert("카카오톡으로 보내지 못했어요. 위의 링크를 복사해서 직접 보내주세요.");
    }
  }

  function closeInvite() {
    requestId += 1;
    els.overlay.hidden = true;
  }

  els.close.addEventListener("click", closeInvite);
  els.copy.addEventListener("click", async () => {
    if (await copyNow(els.link.value)) {
      setStatus("링크를 복사했어요. 초대할 사람에게 붙여넣어 보내주세요.");
      ui.showToast("링크가 복사되었어요");
    } else {
      ui.showToast("복사하지 못했어요. 링크를 길게 눌러 직접 복사해주세요.");
    }
  });
  els.kakao.addEventListener("click", shareToKakao);

  window.TripLog = window.TripLog || {};
  window.TripLog.invite = { open: openInvite };
})();
