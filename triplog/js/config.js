// @별칭 CONFIG · 설정값 (API 키, 로그인 필수 여부)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 앱 설정. Google Maps Platform API 키는 브라우저에서 쓰는 키라서 페이지 소스에 그대로 보인다.
// 그래서 Google Cloud 콘솔에서 이 키에 다음 제한을 꼭 걸어 두어야 한다.
//   - 애플리케이션 제한: 웹사이트(HTTP 리퍼러) → 이 앱을 여는 주소만 허용
//   - API 제한: Maps JavaScript API, Geocoding API, Places API (New), Distance Matrix API만 허용
//     (Distance Matrix API는 나의 여행 화면의 "공항 이동 교통상황" 카드 — googleMaps.js#travelDurationTo — 가
//     새로 쓰기 시작한 것이라, 이전에 이 키를 만들었다면 Google Cloud 콘솔에서 따로 사용 설정을 켜야 한다.)
// 이 파일은 다른 사람에게 공유하거나 공개 저장소에 올리지 않는다.

window.TripLogConfig = {
  googleMapsApiKey: "AIzaSyDjTI2MWG2oISZOg2lOvXxNlxfqM2IYEOM",
  // true면 로그인해야 앱을 쓸 수 있다 (로그인하지 않으면 #/login으로 보낸다). 소셜 로그인 설정이 아직 안 끝나
  // 로그인이 안 될 때 앱에서 잠기지 않으려면 false로 바꾼다. (file://로 연 화면은 소셜 로그인이 안 돼서 항상 요구하지 않는다)
  requireLogin: true,
  // 카카오톡 공유(초대하기)용 카카오 "JavaScript 키". 브라우저에서 쓰는 키라서 페이지 소스에 그대로 보인다.
  // 카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키의 "JavaScript 키"이고, Supabase 카카오 로그인에 넣은 "REST API 키"와는 다른 키다
  // (같은 앱이면 키만 다르고 앱은 같다). 같은 화면의 플랫폼 → Web에 이 앱을 여는 주소(http://localhost:8080, https://triplog-nu.vercel.app)를
  // 등록해야 하고, 공유하는 초대 링크의 주소도 그 등록된 주소여야 한다.
  kakaoJsKey: "2c48fbf56bf48bdd3c8e0d6a946a515c",
  // 카카오톡 공유 카드의 대표 이미지. 카카오 서버가 가져가므로 인터넷에서 열리는 주소여야 한다 (localhost는 안 된다).
  // 지금은 자리표시용 그라데이션 이미지(triplog/img/invite-share.png)이고, 배포해야 이 주소로 열린다. 나중에 원하는 이미지로 바꾸면 된다.
  inviteImageUrl: "https://triplog-nu.vercel.app/img/invite-share.png",
  // 네이버 로그인(OAuth2.0) "Client ID". 인가 요청 URL에 그대로 실려 브라우저 주소창에 노출되는 값이라
  // 공개돼도 되는 값이고(구글/카카오 키와 같은 취급), 네이버 디벨로퍼스 → 애플리케이션 등록 정보에서 확인한다.
  // 실제 로그인이 되려면 이 자리표시 값을 발급받은 Client ID로 바꾸고, 네이버 디벨로퍼스의 "서비스 URL"과
  // "Callback URL"에 이 앱을 여는 모든 주소 + "/auth/naver-callback"을 등록해야 한다
  // (예: http://localhost:8080/auth/naver-callback, https://triplog-nu.vercel.app/auth/naver-callback).
  naverClientId: "ITn2zRtV9zlrTxqp7pTT",
};
