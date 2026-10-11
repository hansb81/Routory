// @별칭 UI · 알럿창 · 토스트
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여러 화면이 함께 쓰는 작은 UI 조각: 확인이 필요한 알럿(showAlert)과 잠깐 떴다 사라지는 토스트(showToast).
// window.alert()는 브라우저 자체 창이라 디자인을 못 맞추고 화면 조작을 막으므로, 앱의 모달 스타일로 직접 만든다.

(function () {
  let overlay = null;
  let messageEl = null;
  let okButton = null;

  function ensureAlert() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "modal-overlay alert-overlay";
    overlay.dataset.alias = "UI-ALERT · 알럿창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-describedby="ui-alert-message">
        <p id="ui-alert-message" class="alert-message"></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-save">확인</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    messageEl = overlay.querySelector(".alert-message");
    okButton = overlay.querySelector("button");
    okButton.addEventListener("click", closeAlert);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAlert();
    });
    // 뒤로 가기 등으로 화면이 바뀌면 알럿이 다른 화면 위에 남지 않게 한다
    window.addEventListener("hashchange", closeAlert);
  }

  // 메시지 한 줄과 [확인] 버튼이 있는 알럿을 띄운다
  function showAlert(message) {
    ensureAlert();
    messageEl.textContent = message;
    overlay.hidden = false;
    okButton.focus();
  }

  function closeAlert() {
    if (overlay) overlay.hidden = true;
  }

  // 아직 구현하지 않은 기능 버튼용 안내
  function showComingSoon(featureName) {
    showAlert(`${featureName} 기능은 추후 구현 예정이에요.`);
  }

  // 화면을 막지 않고 잠깐 보였다 사라지는 안내 (index.html의 #toast)
  let toastTimer = null;

  function showToast(message) {
    const toastEl = document.getElementById("toast");
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.ui = { showAlert, showComingSoon, showToast };
})();
