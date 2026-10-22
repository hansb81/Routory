// account-deletion.html의 폼 제출 로직. 원래 그 파일 안의 인라인 <script>였으나, Vercel에 Content-Security-Policy를
// 걸면서(script-src에 'unsafe-inline' 없이) 외부 파일로 분리했다(2026-10-19 보안 점검 DEP-01) — 로직은 그대로다.
(function () {
  // triplog/js/supabaseClient.js와 같은 값. anon 키는 비밀값이 아니다(그 파일의 설명 참고) — 데이터
  // 보호는 012_account_deletion_requests.sql의 RLS(쓰기 전용, 조회 불가)가 맡는다.
  const SUPABASE_URL = "https://ffzjgiknrrgwvgobybdq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmempnaWtucnJnd3Znb2J5YmRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4ODY5MjksImV4cCI6MjEwNTQ2MjkyOX0.65VHeuLTokig13dfWoNQtqBLG9AthDQO_UGSN8Vn7DQ";
  // 이 페이지는 로그인하지 않은 사람도 열어야 해서(요청 3번) 세션을 만들거나 유지할 필요가 없다 —
  // persistSession/detectSessionInUrl을 모두 꺼서 이 요청 하나만 보내는 일회용 클라이언트로 쓴다.
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });

  const form = document.getElementById("form");
  const statusEl = document.getElementById("status");
  const submitBtn = document.getElementById("submit-btn");

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.className = "status " + (isError ? "status--error" : "status--success");
    statusEl.hidden = false;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    statusEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "보내는 중...";

    const email = document.getElementById("email").value.trim();
    const provider = document.getElementById("provider").value || null;
    const message = document.getElementById("message").value.trim() || null;

    try {
      const { error } = await supabase
        .from("account_deletion_requests")
        .insert({ email: email, login_provider: provider, message: message });
      if (error) throw error;
    } catch (err) {
      console.warn("[account-deletion] 요청 접수 실패", err);
      submitBtn.disabled = false;
      submitBtn.textContent = "삭제 요청 보내기";
      // 012 마이그레이션을 아직 실행하지 않았으면(테이블 없음) 여기로 떨어진다 - 사람이 보는 메시지는
      // 내부 사정 대신 "잠시 후 다시 시도"로 통일한다(accountDeletePage.js와 같은 원칙).
      showStatus("요청을 보내지 못했어요. 잠시 후 다시 시도해주시거나, 다른 방법으로 문의해주세요.", true);
      return;
    }

    form.hidden = true;
    document.getElementById("done").hidden = false;
  });
})();
