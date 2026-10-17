// Routory 서비스 워커 - 웹 푸시 전용(triplog/js/webPush.js가 navigator.serviceWorker.register("/sw.js")로
// 등록한다). 사이트 루트(/)에 있어야 한다 - 서비스 워커의 기본 scope는 "이 파일이 있는 경로 아래 전체"라서,
// img/ 등 하위 폴더에 두면 그 밑으로만 적용되고 /#/my-trip/... 같은 앱의 다른 경로는 제어하지 못한다.
// 빌드 도구 없는 바닐라 JS 구조를 그대로 따른다 - ES 모듈 import 없이 self.addEventListener만 쓴다.
// 오프라인 캐싱(install/activate의 캐시 전략)은 다루지 않는다 - serve.py/Vercel 둘 다 이미 캐시 없이
// 최신 파일을 주고 있고(docs/testing.md), 이 서비스 워커가 할 일은 푸시 수신/클릭 처리뿐이다.

// payload는 서버(향후 만들 Edge Function 'send-notification')가 web-push로 보내는 JSON이다.
// 형태: { title, body, url, icon? } - url은 해당 여행 화면의 해시 경로(예: "/#/my-trip/<id>").
// JSON이 아니거나(payload 없음 등) 파싱에 실패해도 알림 자체는 보여준다 - 빈 알림보다 낫다.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: "Routory", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Routory";
  const options = {
    body: payload.body || "",
    // 전용 앱 아이콘(192/512 등) 자산이 아직 없어서, 로그인 화면에 이미 쓰는 512x512 아이콘을 재사용한다.
    icon: payload.icon || "/img/login-icon.png",
    badge: payload.badge || "/img/login-icon.png",
    data: { url: payload.url || "/#/main" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림을 누르면: 같은 origin의 열려 있는 탭이 있으면 그 탭을 포커스하고 그 경로로 옮긴다(새 탭을 또
// 띄우지 않는다). 열린 탭이 없으면 새 창을 연다.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url || "/#/main";
  const targetUrl = new URL(targetPath, self.location.origin);

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windowClients) {
        if (new URL(client.url).origin !== targetUrl.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(targetUrl.href);
          } catch (err) {
            /* 포커스는 이미 됐으니 경로 이동만 실패해도 치명적이지 않다 */
          }
        }
        return;
      }
      await self.clients.openWindow(targetUrl.href);
    })()
  );
});
