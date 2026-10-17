// @별칭 PUSH-NOTIFICATIONS · 네이티브 푸시 토큰 등록/해제 (device_tokens, 031_push_notifications.sql)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// Capacitor Android 앱에서만 동작한다(PRD v11 1번 표 - 웹 Web Push는 별도 트랙, 이 파일이 다루지 않는다).
// auth.js/flight.js와 같은 방식으로 @capacitor/push-notifications의 JS 패키지를 따로 불러오지 않고,
// 네이티브 브리지가 항상 올려 두는 범용 플러그인 프록시(window.Capacitor.Plugins.PushNotifications)를 쓴다
// (mobile/의 package.json에 설치해 두면 네이티브 쪽 등록만으로 충분하다 - mobile-capacitor.md 참고).
//
// 흐름: commonPages.js(설정 > 알림)의 사전 안내 모달에서 '허용'을 누르면 requestAndRegister()를 부른다 →
// PushNotifications.requestPermissions()로 실제 OS 권한을 묻고 → 허용됐으면 register()(알림 채널을 먼저
// 만들고 FCM에 등록을 요청) → 'registration' 이벤트로 받은 토큰을 device_tokens에 upsert한다. 등록 자체가
// 실패하면('registrationError') 콘솔에 남기고, 설정 화면이 onError 구독으로 안내 문구를 다시 그린다.
//
// 이 기기가 마지막으로 등록한 토큰 값은 localStorage(TOKEN_KEY)에 남겨 둔다 - 로그아웃/회원 탈퇴 "직전에"
// device_tokens에서 지울 행이 "이 기기가 등록한 그 토큰"인지 알아야 하는데, register()를 다시 불러서까지
// 알아낼 필요 없이(그러면 또 OS 권한 흐름을 탄다) 그냥 마지막으로 성공한 값을 기억해 두는 쪽이 간단하다.

(function () {
  const auth = window.TripLog.auth;
  const supabase = window.TripLog.supabase;

  const TOKEN_KEY = "triplog.pushToken";
  const CHANNEL_ID = "routory-default";
  const PLATFORM = "android"; // 이 모듈은 Android 전용이다(캡시터 iOS 플랫폼은 아직 없음, mobile-capacitor.md)

  let registered = false; // register()를 부를 때마다 리스너를 중복으로 걸지 않으려는 가드
  let lastError = null; // 설정 화면이 "알림 등록에 실패했어요"를 보여줄지 판단하는 값
  const errorListeners = new Set();

  function isSupported() {
    return Boolean(window.Capacitor?.isNativePlatform?.()) && Boolean(window.Capacitor?.Plugins?.PushNotifications);
  }

  function plugin() {
    return window.Capacitor.Plugins.PushNotifications;
  }

  function readSavedToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null;
    }
  }

  function saveToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* 저장소를 못 쓰는 환경이면 다음 로그아웃 때 토큰 행을 못 지울 뿐, 등록 자체는 그대로 된다 */
    }
  }

  // Android 8+(API 26+)은 채널이 없으면 알림이 아예 뜨지 않는다. register()에서 매번 먼저 부르지만,
  // 같은 id로 다시 만들어도 OS는 최초 생성 값을 그대로 쓴다(이름/중요도를 바꾸려면 새 채널 id가 필요하다 -
  // OS 쪽 제약이지 이 코드의 버그가 아니다).
  async function ensureChannel() {
    try {
      await plugin().createChannel({
        id: CHANNEL_ID,
        name: "기본 알림",
        description: "출발 임박, 다음 일정, 초대·공유, 공지사항 알림",
        importance: 4, // IMPORTANCE_HIGH - 헤드업으로 보여준다
        visibility: 1, // VISIBILITY_PUBLIC
      });
    } catch (err) {
      console.warn("[pushNotifications] 알림 채널 생성 실패", err);
    }
  }

  // user_id가 로그인 상태에서 받은 값이라 upsert 시점에 반드시 있어야 한다 - 'registration' 이벤트는
  // 로그인 여부와 무관하게 올 수 있어서(네이티브 쪽 타이밍) 방어적으로 다시 확인한다.
  async function upsertToken(token) {
    const userId = auth?.getUserId() ?? null;
    if (!userId || !token) return;
    const { error } = await supabase.from("device_tokens").upsert({ user_id: userId, platform: PLATFORM, token }, { onConflict: "user_id,token" });
    if (error) {
      console.warn("[pushNotifications] 토큰 저장 실패", error);
      return;
    }
    saveToken(token);
  }

  function notifyError() {
    errorListeners.forEach((fn) => {
      try {
        fn(lastError);
      } catch (err) {
        console.warn("[pushNotifications] onError 콜백 오류", err);
      }
    });
  }

  // send-notification이 FCM data payload에 실어 보내는 url(해시 경로, 예: "/#/my-trip/<id>")로
  // 앱 안에서 이동한다 - router.navigate()는 앞의 "#"이 없는 경로를 기대해서(router.js 참고) 잘라낸다.
  // sw.js의 notificationclick이 웹에서 쓰는 것과 같은 url 규칙(해시 라우팅)을 네이티브에서도 그대로 쓴다.
  function navigateToNotificationUrl(url) {
    if (!url) return;
    const hashIndex = url.indexOf("#");
    const path = hashIndex >= 0 ? url.slice(hashIndex + 1) : url;
    window.TripLog.router?.navigate(path);
  }

  function bindListeners() {
    const Push = plugin();
    Push.addListener("registration", (result) => {
      lastError = null;
      upsertToken(result?.value ?? null);
    });
    Push.addListener("registrationError", (err) => {
      console.warn("[pushNotifications] 등록 실패", err);
      lastError = err ?? { message: "unknown" };
      notifyError();
    });
    // 알림을 눌러서(앱이 꺼져 있다가 그걸로 켜졌든, 백그라운드에 있다가 포그라운드로 왔든) 연 경우 -
    // Capacitor는 콜드 스타트로 앱을 띄운 탭까지도 리스너를 등록하면 그때 한 번 전달해 준다(네이티브
    // 쪽이 띄운 시점의 알림 정보를 들고 있다가 넘겨주는 방식 - 공식 문서 기준으로 짰고, 실제 기기에서
    // 콜드 스타트 케이스까지 확인하지는 못했다).
    Push.addListener("pushNotificationActionPerformed", (action) => {
      try {
        navigateToNotificationUrl(action?.notification?.data?.url);
      } catch (err) {
        console.warn("[pushNotifications] 알림 탭 처리 실패", err);
      }
    });
  }

  // 채널을 만들고 FCM 등록을 요청한다. OS 권한 자체는 이미 허용돼 있어야 한다(requestAndRegister 또는
  // 앱 시작 시 refreshIfAlreadyGranted가 먼저 확인한다) - register() 혼자서는 권한 팝업을 띄우지 않는다.
  async function register() {
    if (!isSupported()) return;
    if (!registered) {
      bindListeners();
      registered = true;
    }
    await ensureChannel();
    await plugin().register();
  }

  // 설정 화면의 사전 안내 모달에서 '허용'을 누른 뒤 호출한다 - 실제 OS 권한을 묻고, 허용된 경우에만 register()로 이어간다.
  async function requestAndRegister() {
    if (!isSupported()) return;
    const result = await plugin().requestPermissions();
    if (result?.receive === "granted") await register();
  }

  // 앱 시작 시: 이전에 이미 권한을 허용해 둔 상태라면(OS 권한은 살아 있는데 토큰이 바뀌었을 수 있다 - 기기
  // 재설치, FCM 쪽 토큰 로테이션 등) register()를 다시 불러 갱신한다. 권한이 없는 상태(한 번도 안 물어봤거나
  // 거부됨)에서는 아무것도 하지 않는다 - 새로 권한을 묻는 건 사용자가 설정 화면에서 "알림 켜기"를 직접
  // 눌러야만 한다(요청 2번과 같은 원칙 - 앱이 먼저 OS 팝업을 띄우지 않는다).
  async function refreshIfAlreadyGranted() {
    if (!isSupported()) return;
    try {
      const { receive } = await plugin().checkPermissions();
      if (receive === "granted") await register();
    } catch (err) {
      console.warn("[pushNotifications] 시작 시 권한 확인 실패", err);
    }
  }

  // 로그아웃/회원 탈퇴 직전에 호출한다 - 이 기기가 등록해 둔 토큰 행만 지운다(다른 기기나 다른 사용자의
  // 토큰은 건드리지 않는다). 같은 기기에 다음에 로그인하는 사람에게 이전 사용자의 알림이 가지 않게 하려는
  // 목적이라, 실패해도 로그아웃/탈퇴 자체를 막지 않는다 - 조용히 넘어간다(지워지지 않은 행은 031의
  // auth.users FK on delete cascade로 계정이 실제로 삭제될 때는 어차피 정리된다).
  async function removeDeviceToken() {
    const userId = auth?.getUserId() ?? null;
    const token = readSavedToken();
    if (!userId || !token) return;
    const { error } = await supabase.from("device_tokens").delete().eq("user_id", userId).eq("token", token);
    if (error) {
      console.warn("[pushNotifications] 토큰 삭제 실패", error);
      return;
    }
    saveToken(null);
  }

  function getLastError() {
    return lastError;
  }

  function onError(fn) {
    errorListeners.add(fn);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.pushNotifications = {
    isSupported,
    requestAndRegister,
    refreshIfAlreadyGranted,
    removeDeviceToken,
    getLastError,
    onError,
  };
})();
