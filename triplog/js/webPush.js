// @별칭 WEB-PUSH · 브라우저 푸시 구독/해제 (device_tokens, 031_push_notifications.sql)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 웹(PC/안드로이드 크롬·엣지, iOS 16.4+ PWA)에서만 동작한다 - 네이티브 앱(Capacitor)은 이 파일을 거치지
// 않고 pushNotifications.js(FCM)를 쓴다. isSupported()가 auth.isNativeApp()이면 항상 false를 돌려줘서
// (Capacitor.isNativePlatform() 분기, 요청 4번) 네이티브 웹뷰 안에서 이 코드가 실행되더라도 아무 일도
// 하지 않는다.
//
// 흐름: commonPages.js(설정 > 알림)의 사전 안내 모달에서 '허용'을 누르면 subscribe()를 부른다 →
// Notification.requestPermission() → 허용되면 service worker(/sw.js, 사이트 루트 - scope가 전체
// origin이어야 해서다)를 등록하고 pushManager.subscribe({userVisibleOnly:true, applicationServerKey})
// → 받은 PushSubscription을 JSON으로 device_tokens에 upsert(platform:'web')한다.
//
// 이 브라우저가 마지막으로 저장한 구독 JSON은 localStorage(TOKEN_KEY)에 남겨 둔다 - 로그아웃 시 지울
// device_tokens 행이 "이 브라우저가 구독한 그 행"인지 알아야 하는데, unsubscribe() 이후에는
// getSubscription()으로 다시 물어볼 수 없어서(이미 끊겼다) 구독 시점에 적어 둔 값을 쓴다
// (pushNotifications.js가 FCM 토큰을 localStorage에 남겨 두는 것과 같은 이유·같은 패턴).

(function () {
  const auth = window.TripLog.auth;
  const supabase = window.TripLog.supabase;

  const SW_URL = "/sw.js";
  const TOKEN_KEY = "triplog.webPushToken";
  const PLATFORM = "web";

  let swRegistration = null;

  // Capacitor 네이티브 앱에서는 항상 false(요청 4번) - 웹뷰 안에 PushManager가 있어도 이 경로는 쓰지 않는다.
  function isSupported() {
    return (
      !auth.isNativeApp() &&
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof window !== "undefined" &&
      "PushManager" in window &&
      typeof Notification !== "undefined"
    );
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
      /* 저장소를 못 쓰는 환경이면 다음 로그아웃 때 구독 행을 못 지울 뿐, 구독 자체는 그대로 된다 */
    }
  }

  // VAPID 공개키(base64url, config.js#vapidPublicKey)를 pushManager.subscribe가 요구하는
  // Uint8Array(applicationServerKey)로 바꾼다. 표준적인 변환 방식(패딩 보정 + base64url → base64)이다.
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function ensureServiceWorker() {
    if (swRegistration) return swRegistration;
    try {
      swRegistration = await navigator.serviceWorker.register(SW_URL);
      return swRegistration;
    } catch (err) {
      console.warn("[webPush] 서비스 워커 등록 실패", err);
      return null;
    }
  }

  async function upsertSubscription(token) {
    const userId = auth?.getUserId() ?? null;
    if (!userId || !token) return;
    const { error } = await supabase.from("device_tokens").upsert({ user_id: userId, platform: PLATFORM, token }, { onConflict: "user_id,token" });
    if (error) {
      console.warn("[webPush] 구독 저장 실패", error);
      return;
    }
    saveToken(token);
  }

  // 설정 화면의 사전 안내 모달에서 '허용'을 누른 뒤 호출한다 - 실제 브라우저 알림 권한을 묻고, 허용된
  // 경우에만 서비스 워커 등록 → 구독 → 저장으로 이어간다.
  async function subscribe() {
    if (!isSupported()) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const registration = await ensureServiceWorker();
    if (!registration) return;

    const vapidKey = window.TripLogConfig?.vapidPublicKey;
    if (!vapidKey) {
      console.warn("[webPush] vapidPublicKey가 설정되지 않았어요 (triplog/js/config.js)");
      return;
    }

    let subscription;
    try {
      subscription = (await registration.pushManager.getSubscription()) || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
    } catch (err) {
      console.warn("[webPush] 구독 실패", err);
      return;
    }

    await upsertSubscription(JSON.stringify(subscription.toJSON()));
  }

  // 로그아웃 시 호출한다 - 이 브라우저의 구독을 끊고(unsubscribe), device_tokens에서도 그 행을 지운다
  // (요청 5번 - 다음에 이 브라우저로 로그인하는 사람에게 이전 사용자의 알림이 가지 않게 하려는 것과 같은
  // 이유). 구독 해제가 실패해도 DB 행 삭제는 시도한다 - 어느 한쪽이 실패해도 로그아웃 자체를 막지 않는다.
  async function unsubscribeAndRemove() {
    if (!isSupported()) return;
    const token = readSavedToken();

    try {
      const registration = swRegistration || (await navigator.serviceWorker.getRegistration(SW_URL));
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch (err) {
      console.warn("[webPush] 구독 해제 실패", err);
    }

    const userId = auth?.getUserId() ?? null;
    if (userId && token) {
      const { error } = await supabase.from("device_tokens").delete().eq("user_id", userId).eq("token", token);
      if (error) console.warn("[webPush] 구독 행 삭제 실패", error);
    }
    saveToken(null);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.webPush = { isSupported, subscribe, unsubscribeAndRemove };
})();
