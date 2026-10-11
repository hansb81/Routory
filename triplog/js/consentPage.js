// @별칭 CONSENT · 약관 동의 화면 (#/consent)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 로그인에 막 성공했는데 아직 user_consents 행이 없는 사용자만 보는 화면이다 (app.js의 requireConsent
// 가드가 보낸다 - storage.hasConsent() 참고). 전체동의 + 이용약관(필수)·개인정보 수집·이용(필수)·
// 광고성 정보 수신(선택) 세 체크박스, 필수 두 개를 모두 체크해야 제출 버튼이 풀린다.
// 이용약관/개인정보처리방침 "보기"는 legalPages.js의 화면(#/terms, #/privacy)을 그대로 연다 - 거기서
// history.back()으로 누르면 바로 이 화면으로 돌아온다(router.navigate가 쌓은 히스토리 덕분에 자연히 된다).
// 제출하면 storage.saveConsent로 user_consents를 upsert하고(010_user_consents.sql, user_id가
// unique라 "최초 동의"든 "재동의"든 한 행만 남는다) #/main으로 보낸다 - 어디서 로그인했든(초대 링크 등)
// 동의 후에는 항상 메인으로 간다(요청 사항 그대로, 원래 가려던 화면으로 되돌리지 않는다).
//
// state(terms/privacy/marketing 체크 여부)는 모듈 레벨 변수라 "보기"를 눌러 다른 화면에 다녀와도 유지된다
// (definePage가 재방문마다 innerHTML을 다시 그리지만, el.dataset.bound 패턴처럼 이 값 자체는 el 밖에
// 있어서 지워지지 않는다) - 체크했다가 약관을 확인하러 나간 사용자가 되돌아와서 또 체크해야 하는 불편을 막는다.

(function () {
  const router = window.TripLog.router;
  const storage = window.TripLog.storage;

  const state = { terms: false, privacy: false, marketing: false };
  let saving = false;

  const ITEMS = [
    { role: "terms", label: "이용약관 동의", tag: "필수", view: "terms" },
    { role: "privacy", label: "개인정보 수집·이용 동의", tag: "필수", view: "privacy" },
    { role: "marketing", label: "광고성 정보 수신 동의", tag: "선택", view: null },
  ];

  function itemHtml(item) {
    return `
      <li class="consent-item">
        <label class="consent-checkbox-row">
          <input type="checkbox" data-role="${item.role}" />
          <span>${item.label} <em class="consent-tag consent-tag--${item.tag === "필수" ? "required" : "optional"}">(${item.tag})</em></span>
        </label>
        ${item.view ? `<button type="button" class="consent-view-link" data-view="${item.view}">보기</button>` : ""}
      </li>`;
  }

  function render(el) {
    el.innerHTML = `
      <section class="consent" data-alias="CONSENT-FORM · 약관 동의 폼">
        <h1 class="page-title">약관 동의</h1>
        <p class="page-note">서비스를 시작하려면 아래 약관에 동의해주세요.</p>

        <label class="consent-checkbox-row consent-all">
          <input type="checkbox" data-role="all" />
          <span>전체 동의하기</span>
        </label>

        <ul class="consent-list">${ITEMS.map(itemHtml).join("")}</ul>

        <p class="form-error" data-role="error" hidden></p>
        <button type="button" class="btn btn-save btn-block" data-action="submit" disabled>동의하고 시작하기</button>
      </section>`;

    syncCheckboxes(el);
    updateSubmitState(el);
    bind(el);
  }

  function syncCheckboxes(el) {
    ITEMS.forEach((item) => {
      const input = el.querySelector(`[data-role="${item.role}"]`);
      if (input) input.checked = state[item.role];
    });
    const allInput = el.querySelector('[data-role="all"]');
    if (allInput) allInput.checked = state.terms && state.privacy && state.marketing;
  }

  function updateSubmitState(el) {
    const btn = el.querySelector('[data-action="submit"]');
    if (btn && !saving) btn.disabled = !(state.terms && state.privacy);
  }

  function bind(el) {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";

    el.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"]');
      if (!input) return;
      const role = input.dataset.role;
      if (role === "all") state.terms = state.privacy = state.marketing = input.checked;
      else state[role] = input.checked;
      syncCheckboxes(el);
      updateSubmitState(el);
    });

    el.addEventListener("click", (e) => {
      const viewBtn = e.target.closest("[data-view]");
      if (viewBtn) return router.navigate(router.buildPath(viewBtn.dataset.view));
      if (e.target.closest('[data-action="submit"]')) submit(el);
    });
  }

  async function submit(el) {
    if (saving || !(state.terms && state.privacy)) return;
    const btn = el.querySelector('[data-action="submit"]');
    const errorEl = el.querySelector('[data-role="error"]');
    saving = true;
    btn.disabled = true;
    btn.textContent = "저장하는 중...";
    errorEl.hidden = true;

    const { TERMS_VERSION, PRIVACY_VERSION } = window.TripLog.legalPages;
    try {
      await storage.saveConsent({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, marketingAgreed: state.marketing });
    } catch (err) {
      saving = false;
      btn.disabled = false;
      btn.textContent = "동의하고 시작하기";
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      return;
    }

    saving = false;
    router.navigate(router.buildPath("main"));
  }

  router.definePage("consent", render);
})();
