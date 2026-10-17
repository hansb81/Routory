// @별칭 ACCOUNT-DELETE · 회원 탈퇴 화면 (#/account-delete)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 설정(#/settings) > 계정 섹션의 "회원 탈퇴"가 연다. 지워질 데이터 목록을 안내하고, 확인 체크박스를 눌러야
// "회원 탈퇴" 버튼이 풀린다. 그 버튼은 바로 지우지 않고 최종 확인창(ACCOUNT-DELETE-CONFIRM, '취소'/'탈퇴하기')을
// 한 번 더 띄운다 - 되돌릴 수 없는 작업이라 tripShell.js의 MYTRIP-EXIT-CONFIRM(여행 삭제/나가기)과 같은
// "메뉴에서 한 번 + 확인창에서 한 번" 2단계 확인 규칙을 그대로 따른다.
// 실제 삭제는 클라이언트가 하지 않는다 - auth.users를 지울 권한(Admin API)은 service_role 키로만 쓸 수 있어서,
// Edge Function 'delete-account'를 호출한다(supabase/functions/delete-account/README.md 참고 - 여행지갑
// 파일·가계부·일정·여행 멤버십·소유한 여행·초대·약관 동의를 순서대로 지운 다음 auth.admin.deleteUser를 부른다).
// 실패 원인과 무관하게 항상 같은 안내("탈퇴 처리 중 문제가 발생했습니다. 고객센터로 문의해주세요")만
// 보여준다 - 실제 원인(어느 단계에서 막혔는지)은 콘솔과 Edge Function 로그에만 남긴다. 성공하면 이 브라우저의
// 로컬 세션도 정리(auth.signOut)하고 #/login으로 보낸다 - 서버 계정은 이미 없어졌으니 세션도 맞춰 비워야 한다.
// 체크박스 상태는 화면에 들어올 때마다 초기화된다(일부러 - 재방문마다 다시 확인받는다, consentPage.js의
// "state를 유지한다"와는 반대되는 선택이지만 둘 다 의도적이다: 거긴 약관 "보기"를 눌러 잠깐 나갔다 온 것뿐이고,
// 여긴 아예 새로 들어온 방문이라 다시 확인받는 쪽이 맞다).

(function () {
  const router = window.TripLog.router;
  const supabase = window.TripLog.supabase;
  const auth = window.TripLog.auth;
  const ui = window.TripLog.ui;

  const BACK_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  // Routory가 실제로 다루는 데이터(CLAUDE.md의 Privacy pages 데이터 분류와 같은 6가지)를 그대로 옮겼다 -
  // legalPages.js의 개인정보처리방침 "1. 수집하는 개인정보 항목"과 짝이 맞아야 하므로 그 분류를 따른다.
  const DATA_ITEMS = [
    "계정 정보(이름, 이메일, 프로필 사진 등 로그인 정보)",
    "등록한 모든 여행 계획(제목, 목적지, 기간)",
    "여행 일정(장소, 메모, 항공편 등)",
    "가계부(지출) 기록",
    "여행지갑에 올린 파일(여권, 항공권, QR코드 등)",
    "초대 링크와 함께한 동행자(멤버) 정보",
  ];

  let checked = false;

  function render(el) {
    checked = false; // 새로 들어올 때마다 다시 확인받는다 (위 파일 설명 참고)
    el.innerHTML = `
      <header class="simple-page-header">
        <button type="button" class="mytrip-icon-btn mytrip-icon-btn--dark" data-action="back" aria-label="뒤로">${BACK_ICON}</button>
        <h1 class="simple-page-title">회원 탈퇴</h1>
      </header>
      <div class="legal-content">
        <p>회원 탈퇴를 진행하면 아래 정보가 모두 영구히 삭제되며, 되돌릴 수 없어요.</p>
        <ul>${DATA_ITEMS.map((text) => `<li>${text}</li>`).join("")}</ul>
      </div>
      <label class="consent-checkbox-row account-delete-check">
        <input type="checkbox" data-role="confirm" />
        <span>위 내용을 확인했으며, 삭제에 동의해요</span>
      </label>
      <button type="button" class="btn btn-danger btn-block" data-action="open-confirm" disabled>회원 탈퇴</button>`;
    bind(el);
  }

  function bind(el) {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";

    el.addEventListener("change", (e) => {
      if (!e.target.matches('[data-role="confirm"]')) return;
      checked = e.target.checked;
      el.querySelector('[data-action="open-confirm"]').disabled = !checked;
    });

    el.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="back"]')) history.back();
      else if (e.target.closest('[data-action="open-confirm"]') && checked) openConfirmModal();
    });
  }

  // ---- 최종 확인창(ACCOUNT-DELETE-CONFIRM): '취소' / '탈퇴하기' ----

  let confirmOverlay = null;
  let deleting = false;

  function ensureConfirmModal() {
    if (confirmOverlay) return;
    confirmOverlay = document.createElement("div");
    confirmOverlay.className = "modal-overlay";
    confirmOverlay.dataset.alias = "ACCOUNT-DELETE-CONFIRM · 회원 탈퇴 최종 확인창";
    confirmOverlay.hidden = true;
    confirmOverlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="account-delete-confirm-title">
        <h2 class="modal-title" id="account-delete-confirm-title">정말 탈퇴하시겠어요?</h2>
        <p class="trip-exit-note">탈퇴하면 계정과 모든 데이터가 영구히 삭제되고 되돌릴 수 없어요.</p>
        <p class="form-error" data-role="error" hidden></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
            <button type="button" class="btn btn-danger" data-action="confirm">탈퇴하기</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(confirmOverlay);

    confirmOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="cancel"]')) closeConfirmModal();
      else if (e.target.closest('[data-action="confirm"]')) performDelete();
    });
    confirmOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !deleting) closeConfirmModal();
    });
  }

  function openConfirmModal() {
    ensureConfirmModal();
    confirmOverlay.querySelector('[data-role="error"]').hidden = true;
    confirmOverlay.hidden = false;
    confirmOverlay.querySelector('[data-action="cancel"]').focus();
  }

  function closeConfirmModal() {
    if (deleting || !confirmOverlay) return;
    confirmOverlay.hidden = true;
  }

  // Edge Function 'delete-account' 호출 - 클라이언트는 auth.users를 지울 권한이 없어서다(위 파일 설명 참고).
  // 로그인한 사용자의 토큰이 supabase-js에 의해 자동으로 실려 가므로, 누구를 지울지는 따로 넘기지 않는다
  // (그 함수가 토큰에서 직접 읽는다 - "자기 자신만" 지울 수 있게 하려는 의도적인 설계).
  async function performDelete() {
    if (deleting) return;
    const okBtn = confirmOverlay.querySelector('[data-action="confirm"]');
    const errorEl = confirmOverlay.querySelector('[data-role="error"]');
    deleting = true;
    errorEl.hidden = true;
    okBtn.disabled = true;
    okBtn.textContent = "탈퇴하는 중...";

    // 탈퇴 처리 직전에 이 기기/브라우저의 푸시 토큰(또는 구독) 행을 지운다 - 로그아웃(commonPages.js)과
    // 같은 이유. delete-account 자체도 계정이 실제로 삭제되면 031의 auth.users FK on delete cascade로
    // device_tokens 행은 결국 지워지지만, 웹은 실제 브라우저 구독(unsubscribe)까지 끊어야 해서 DB 행
    // cascade만으로는 부족하다 - 둘 다 실패해도 조용히 넘어가고 탈퇴 흐름을 막지 않는다.
    await window.TripLog.pushNotifications?.removeDeviceToken?.();
    await window.TripLog.webPush?.unsubscribeAndRemove?.();

    try {
      const { data, error } = await supabase.functions.invoke("delete-account");
      if (error || data?.error) throw new Error(data?.error || error.message);
    } catch (err) {
      // 실패 원인(네트워크 오류든, Edge Function이 돌려준 구체적인 단계별 오류든)과 무관하게 항상 같은
      // 안내만 보여준다 - 내부 사정(어느 테이블에서 실패했는지 등)을 사용자에게 노출하지 않기 위해서다.
      // 실제 원인은 콘솔과 Edge Function 로그(supabase/functions/delete-account 참고)에 남아 있다.
      console.warn("[account-delete] 탈퇴 처리 실패", err);
      deleting = false;
      okBtn.disabled = false;
      okBtn.textContent = "탈퇴하기";
      errorEl.textContent = "탈퇴 처리 중 문제가 발생했습니다. 고객센터로 문의해주세요.";
      errorEl.hidden = false;
      return; // 확인창은 열어 둔다 - 실패해도 다시 시도할 수 있게
    }

    deleting = false;
    confirmOverlay.hidden = true;
    await auth.signOut(); // 서버 계정은 이미 없어졌으니 이 브라우저의 로컬 세션도 정리한다
    ui.showToast("회원 탈퇴가 완료되었어요.");
    router.navigate(router.buildPath("login"));
  }

  router.definePage("account-delete", render);
  // 뒤로 가기 등으로 떠날 때 확인창이 다른 화면 위에 남지 않게 한다 (schedule.js의 closeAllOverlays와 같은 이유)
  router.onLeave("account-delete", () => {
    if (confirmOverlay) confirmOverlay.hidden = true;
  });
})();
