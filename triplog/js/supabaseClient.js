// @별칭 SUPABASE · Supabase 서버 연결
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// Supabase 클라이언트 초기화. index.html에서 supabase-js(UMD, window.supabase)를 먼저 불러온 뒤에 실행된다.
// 다른 파일에서는 window.TripLog.supabase로 가져다 쓴다 (이 프로젝트는 ES 모듈을 쓰지 않는다).
// 브라우저 콘솔에서 연결을 확인하려면: await TripLog.supabase.auth.getSession()

(function () {
  const SUPABASE_URL = "https://ffzjgiknrrgwvgobybdq.supabase.co";

  // anon(공개) 키는 비밀값이 아니다: 브라우저에서 Supabase에 요청하려면 이 키가 페이지에 실려야 해서
  // 누구나 페이지 소스로 볼 수 있고, 그것이 정상적인 사용 방식이다.
  // 데이터 보호는 이 키를 숨기는 것이 아니라 Supabase 테이블의 RLS(Row Level Security) 정책이 맡는다.
  // RLS를 켜지 않은 테이블은 이 키로 누구나 읽고 쓸 수 있으니, 테이블을 만들 때 반드시 RLS를 켜고 정책을 걸 것.
  // 반대로 service_role 키는 RLS를 무시하는 관리자 키라서 절대 이 코드에 넣으면 안 된다.
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmempnaWtucnJnd3Znb2J5YmRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4ODY5MjksImV4cCI6MjEwNTQ2MjkyOX0.65VHeuLTokig13dfWoNQtqBLG9AthDQO_UGSN8Vn7DQ";

  // flowType "pkce": 소셜 로그인 후 돌아올 때 로그인 결과를 URL 해시(#access_token=...)가 아니라 쿼리(?code=...)로 받는다.
  // 기본값(implicit)은 해시로 받는데, 이 앱은 해시 라우터(#/main)라서 redirectTo의 "#/main" 뒤에 토큰이 붙어 읽지 못하고,
  // 읽더라도 supabase-js가 location.hash를 비워 버려 화면 주소가 지워진다. pkce는 code만 쿼리에서 지우고 #/main은 그대로 둔다.
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: "pkce" },
  });

  window.TripLog = window.TripLog || {};
  window.TripLog.supabase = supabase;
})();
