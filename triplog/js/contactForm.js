// @별칭 CONTACT-FORM · 1:1 문의하기 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 설정(#/settings) > 고객센터 > 문의하기(#/contact, commonPages.js) 맨 아래 "1:1 문의하기" 버튼이 여는 창.
// tripExport.js/walletForm.js와 같은 "document.body에 직접 모달 오버레이를 붙이는" 패턴이다(index.html에
// 이 화면을 위한 정적 마크업이 없다). 흐름은 한 단계뿐: 제목 + 내용을 입력하고 "문의하기"를 누르면 Edge
// Function send-contact-email을 호출한다 - 실제 이메일 발송은 그 함수(서버)가 담당하고, 받는 메일 주소는
// 그 함수의 비밀값(CONTACT_EMAIL)으로만 존재해서 이 파일을 포함해 클라이언트 어디에도 나타나지 않는다.
// 함수는 로그인한 사용자만 부를 수 있고(analyze-ticket과 같은 isSignedIn 검사), 호출자의 이메일을 토큰에서
// 읽어 "답장(Reply-To)"으로 실어 보내므로 받는 사람이 그대로 답장하면 문의한 사람에게 간다.

(function () {
  const supabase = window.TripLog.supabase;
  const ui = window.TripLog.ui;

  const MAX_TITLE = 100;
  const MAX_CONTENT = 2000;

  let els = null; // ensureModal이 한 번만 만든다
  let saving = false;

  function ensureModal() {
    if (els) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "CONTACT-FORM · 1:1 문의하기 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="contact-form-title">
        <h2 class="modal-title" id="contact-form-title">1:1 문의하기</h2>
        <form novalidate>
          <div class="form-field">
            <label for="contact-form-title-input">제목 *</label>
            <input type="text" id="contact-form-title-input" data-title placeholder="무엇이 궁금하신가요?" maxlength="${MAX_TITLE}" autocomplete="off" />
          </div>

          <div class="form-field">
            <label for="contact-form-content">내용 *</label>
            <textarea id="contact-form-content" data-content rows="6" maxlength="${MAX_CONTENT}" placeholder="궁금한 점이나 불편했던 점을 자세히 적어주세요."></textarea>
          </div>

          <p class="form-error" data-error hidden></p>

          <div class="modal-actions">
            <div class="modal-actions-right">
              <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
              <button type="submit" class="btn btn-save" data-save>문의하기</button>
            </div>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    els = {
      overlay,
      form: overlay.querySelector("form"),
      title: overlay.querySelector("[data-title]"),
      content: overlay.querySelector("[data-content]"),
      error: overlay.querySelector("[data-error]"),
      saveBtn: overlay.querySelector("[data-save]"),
    };

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    els.form.addEventListener("submit", handleSubmit);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  function open() {
    ensureModal();
    saving = false;
    els.form.reset();
    clearError();
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "문의하기";
    els.overlay.hidden = false;
    els.title.focus();
  }

  function close() {
    if (saving) return; // 보내는 중에는 창을 닫아 중간에 끊기지 않게 한다
    if (els) els.overlay.hidden = true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;

    const title = els.title.value.trim();
    const content = els.content.value.trim();
    if (!title) return showError("제목을 입력해주세요.");
    if (!content) return showError("내용을 입력해주세요.");

    clearError();
    saving = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = "보내는 중...";

    try {
      const { data, error } = await supabase.functions.invoke("send-contact-email", { body: { title, content } });
      if (error || !data?.ok) throw new Error(data?.error || "문의를 보내지 못했어요. 잠시 후 다시 시도해주세요.");
    } catch (err) {
      showError(err.message || "문의를 보내지 못했어요. 잠시 후 다시 시도해주세요.");
      saving = false;
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = "문의하기";
      return;
    }

    saving = false;
    els.overlay.hidden = true;
    ui.showToast("문의가 접수됐어요. 확인 후 답변드릴게요.");
  }

  // ui.js의 알럿과 같은 이유 - 화면이 바뀌면(뒤로 가기 등) 모달이 다른 화면 위에 남지 않게 한다
  window.addEventListener("hashchange", () => {
    if (saving) return;
    if (els) els.overlay.hidden = true;
  });

  window.TripLog = window.TripLog || {};
  window.TripLog.contactForm = { open };
})();
