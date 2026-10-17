// @별칭 EXPENSE-FORM · 비용 추가 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 가계부(#/budget/:id)의 비용 추가/수정 폼. PRD v6 5번을 전부 구현한다:
//   5-1 통화·금액, 5-2 날짜, 5-3 결제수단, 5-4 제목, 5-5 카테고리, 5-6 여행 멤버(결제자/더치페이 - 각각 다중
//   선택, "+ 추가"로 여행 멤버가 아닌 사람도 이름만으로 넣을 수 있다), 5-7 메모.
// schedule.js#openModal(item, {...})와 같은 방식으로 하나의 창을 추가/수정 둘 다에 쓴다: open({ trip, dayKey })
// 로 열면 추가, open({ trip, expense })로 열면(budgetPage.js가 지출 카드를 눌렀을 때) 그 값으로 채워진 수정
// 폼이 된다. 저장 버튼을 누르면 수정 중이면 storage.updateExpense, 아니면 storage.addExpense를 부른다.
//
// budgetPage.js가 "+ 비용 추가"를 누르면 open({ trip, dayKey })를, 지출 카드를 누르면
// open({ trip, expense })를 부른다. 저장에 성공하면 init()에 넘긴 콜백(budgetPage.js의 목록 새로고침)을 부른다.

(function () {
  const { addExpense, updateExpense, loadMembers } = window.TripLog.storage;
  const { escapeHtml, getTripDays, generateId } = window.TripLog.util;
  const currencyData = window.TripLog.currencyData;
  const { EXPENSE_CATEGORIES } = window.TripLog.expenseCategoryData;
  const auth = window.TripLog.auth;

  let onChange = () => {};
  let els = null; // ensureModal이 한 번만 만든다
  let addEls = null; // ensureAddMemberModal이 한 번만 만든다 ("인원 추가" 작은 팝업)
  let state = {
    trip: null,
    days: [],
    currencyCode: "KRW",
    dayKey: null,
    categoryKey: null,
    members: [],
    payerIds: new Set(),
    splitIds: new Set(),
    editingId: null,
    editingExpense: null,
    saving: false,
  };
  let membersRequestId = 0;

  // 로컬로 추가한("+ 추가") 참여자의 아바타 색 - 서버에 저장되는 값이 아니라 이 화면에서만 쓰는 장식용
  // 랜덤 배정이라, Day 색상(--route-1..6)처럼 "여러 색이 한 화면에 동시에 다 보여도 서로 구별되는지"를
  // 스크립트로 검증해야 하는 다색 데이터 세트가 아니다 - 사람 수가 적고(여행 동행자 수준) 그저 매번 다른
  // 느낌을 주는 장식 색이면 충분하다.
  const GUEST_PALETTE = [
    { bg: "#ffd6cc", ink: "#7a2e12" },
    { bg: "#d8e8ff", ink: "#1d3f70" },
    { bg: "#e3d8ff", ink: "#3f2a70" },
    { bg: "#d3f5df", ink: "#1f5c34" },
    { bg: "#fff1c2", ink: "#7a5d00" },
    { bg: "#ffd9ec", ink: "#7a1b4e" },
  ];

  function randomGuestColor() {
    return GUEST_PALETTE[Math.floor(Math.random() * GUEST_PALETTE.length)];
  }

  function hideAllTooltips() {
    els?.overlay.querySelectorAll("[data-tooltip]").forEach((t) => (t.hidden = true));
  }

  function ensureModal() {
    if (els) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "EXPENSE-FORM · 비용 추가 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
        <h2 class="modal-title" id="expense-modal-title">비용 추가</h2>
        <form novalidate>
          <div class="form-field">
            <div class="expense-currency-row">
              <div class="expense-currency-picker" data-currency-picker>
                <button type="button" class="expense-currency-trigger" data-action="currency-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="통화 선택">
                  <span data-currency-trigger-text></span>
                  <span class="expense-currency-caret" aria-hidden="true">▾</span>
                </button>
                <ul class="expense-currency-list" data-currency-list hidden role="listbox" aria-label="통화 선택"></ul>
              </div>
              <input type="number" inputmode="decimal" min="0" step="any" class="expense-amount-input" data-amount placeholder="금액" aria-label="금액" />
            </div>
          </div>

          <div class="form-field">
            <div class="expense-day-picker" data-day-picker>
              <button type="button" class="expense-day-trigger" data-action="day-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="날짜 선택">
                <span data-day-trigger-text></span>
                <span class="expense-day-caret" aria-hidden="true">▾</span>
              </button>
              <ul class="expense-day-list" data-day-list hidden role="listbox" aria-label="날짜 선택"></ul>
            </div>
          </div>

          <div class="form-field">
            <div class="expense-payment-row" role="radiogroup" aria-label="결제수단">
              <label class="expense-radio"><input type="radio" name="expense-payment" value="cash" /> 현금</label>
              <label class="expense-radio"><input type="radio" name="expense-payment" value="card" /> 카드</label>
            </div>
          </div>

          <div class="form-field">
            <input type="text" id="expense-title" data-title placeholder="제목 입력" aria-label="제목" autocomplete="off" />
          </div>

          <div class="form-field">
            <div class="expense-category-chips" data-category-chips role="radiogroup" aria-label="카테고리"></div>
          </div>

          <div class="form-field">
            <div class="expense-member-role" data-role="payer">
              <div class="expense-member-role-label">
                <span>결제자</span>
                <span class="expense-member-info-wrap">
                  <button type="button" class="expense-member-info" data-action="info-toggle" aria-label="결제자 안내">ⓘ</button>
                  <span class="expense-member-tooltip" data-tooltip hidden>결제한 사람을 체크하세요</span>
                </span>
              </div>
              <div class="expense-member-row-scroll" data-member-row="payer"></div>
            </div>
            <div class="expense-member-role" data-role="split">
              <div class="expense-member-role-label">
                <span>더치페이</span>
                <span class="expense-member-info-wrap">
                  <button type="button" class="expense-member-info" data-action="info-toggle" aria-label="더치페이 안내">ⓘ</button>
                  <span class="expense-member-tooltip" data-tooltip hidden>같이 낼 사람을 체크하세요</span>
                </span>
              </div>
              <div class="expense-member-row-scroll" data-member-row="split"></div>
            </div>
          </div>

          <div class="form-field">
            <label for="expense-memo">메모</label>
            <textarea id="expense-memo" data-memo rows="2" placeholder="메모를 남겨보세요 (선택)"></textarea>
          </div>

          <p class="form-error" data-error hidden></p>

          <div class="modal-actions">
            <div class="modal-actions-right">
              <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
              <button type="submit" class="btn btn-save" data-save>저장</button>
            </div>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    els = {
      overlay,
      modalTitle: overlay.querySelector("#expense-modal-title"),
      form: overlay.querySelector("form"),
      amount: overlay.querySelector("[data-amount]"),
      title: overlay.querySelector("[data-title]"),
      memo: overlay.querySelector("[data-memo]"),
      error: overlay.querySelector("[data-error]"),
      saveBtn: overlay.querySelector("[data-save]"),
      dayPicker: overlay.querySelector("[data-day-picker]"),
      dayTrigger: overlay.querySelector('[data-action="day-toggle"]'),
      dayTriggerText: overlay.querySelector("[data-day-trigger-text]"),
      dayList: overlay.querySelector("[data-day-list]"),
      categoryChips: overlay.querySelector("[data-category-chips]"),
      memberRowPayer: overlay.querySelector('[data-member-row="payer"]'),
      memberRowSplit: overlay.querySelector('[data-member-row="split"]'),
      currencyPicker: overlay.querySelector("[data-currency-picker]"),
      currencyTrigger: overlay.querySelector('[data-action="currency-toggle"]'),
      currencyTriggerText: overlay.querySelector("[data-currency-trigger-text]"),
      currencyList: overlay.querySelector("[data-currency-list]"),
    };

    els.currencyTrigger.addEventListener("click", () => setCurrencyOpen(els.currencyList.hidden));
    els.currencyList.addEventListener("click", (e) => {
      const option = e.target.closest("[data-code]");
      if (option) selectCurrency(option.dataset.code);
    });

    els.dayTrigger.addEventListener("click", () => setDayOpen(els.dayList.hidden));
    els.dayList.addEventListener("click", (e) => {
      const option = e.target.closest("[data-day-key]");
      if (option) selectDay(option.dataset.dayKey);
    });

    // 통화·날짜 드롭다운 밖을 누르면 닫는다 (모달을 여닫는 것과 상관없이 항상 걸어 두고, 창이 닫혀 있을 때는 아무 일도 안 한다).
    // 한쪽 트리거를 누르면 그 클릭이 문서까지 버블링돼 다른 쪽 드롭다운은 "바깥 클릭"으로 자동 닫힌다.
    document.addEventListener("click", (e) => {
      if (overlay.hidden) return;
      if (!els.currencyPicker.contains(e.target)) setCurrencyOpen(false);
      if (!els.dayPicker.contains(e.target)) setDayOpen(false);
      if (!e.target.closest(".expense-member-info-wrap")) hideAllTooltips();
    });

    // 결제자/더치페이 옆 ⓘ: 누르면 그 위에 말풍선으로 짧은 안내가 뜬다 (한 번에 하나만).
    overlay.addEventListener("click", (e) => {
      const infoBtn = e.target.closest('[data-action="info-toggle"]');
      if (!infoBtn) return;
      const tooltip = infoBtn.parentElement.querySelector("[data-tooltip]");
      const wasHidden = tooltip.hidden;
      hideAllTooltips();
      tooltip.hidden = !wasHidden;
    });

    els.categoryChips.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-category-key]");
      if (chip) selectCategory(chip.dataset.categoryKey);
    });

    els.memberRowPayer.addEventListener("click", (e) => handleMemberRowClick(e, "payer"));
    els.memberRowSplit.addEventListener("click", (e) => handleMemberRowClick(e, "split"));

    // 프로필 사진을 못 불러오면(error는 버블링되지 않아 캡처로 받는다) 사진을 치워 깔아 둔 글자가 보이게 한다
    overlay.addEventListener(
      "error",
      (e) => {
        if (e.target.matches?.(".member-avatar img")) e.target.remove();
      },
      true
    );

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    els.form.addEventListener("submit", handleSubmit);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // ---- 통화 드롭다운 (5-1) ----

  // PRD 5-1: 원화·달러·여행지 통화 (여행지 통화가 원화·달러와 겹치면 제외). destinationId가 있는(PRD v12
  // 이후) 여행은 이미 확정해 둔 trip.currency(ISO 코드)를 그대로 쓴다 - destination 문자열 나라 이름을
  // 13개국 표와 맞춰보는 옛 방식(getCurrencyOptions)은 새로 늘어난 도시 대부분을 못 찾기 때문이다. 국내·
  // 옛 방식 여행은 여전히 destination("도쿄, 일본"처럼 "<도시>, <나라>")의 콤마 뒤 나라 이름으로 찾는다.
  function currencyOptions() {
    const country = (state.trip?.destination ?? "").split(",").pop()?.trim();
    if (state.trip?.destinationId) return currencyData.getCurrencyOptionsByCode(state.trip.currency, country);
    return currencyData.getCurrencyOptions(country);
  }

  function renderCurrencyList() {
    const options = currencyOptions();
    els.currencyList.innerHTML = options
      .map(
        (currency) => `
        <li role="option" aria-selected="${currency.code === state.currencyCode}"
          class="expense-currency-option${currency.code === state.currencyCode ? " expense-currency-option--active" : ""}"
          data-code="${currency.code}">${escapeHtml(currencyData.formatOption(currency))}</li>`
      )
      .join("");
    const selected = options.find((currency) => currency.code === state.currencyCode) ?? options[0];
    els.currencyTriggerText.textContent = selected ? `${selected.symbol} ${selected.code}` : state.currencyCode;
  }

  function setCurrencyOpen(open) {
    els.currencyList.hidden = !open;
    els.currencyTrigger.setAttribute("aria-expanded", String(open));
  }

  function selectCurrency(code) {
    state.currencyCode = code;
    renderCurrencyList();
    setCurrencyOpen(false);
  }

  // ---- 날짜(Day) 드롭다운 (5-2): 한 번에 다 보여주지 않고, 통화 선택과 같은 토글형 목록으로 고른다 ----

  function buildDayOptions(trip) {
    const days = getTripDays(trip).map((day) => ({ dayKey: day.date, label: `Day ${day.number} · ${day.label}` }));
    return [{ dayKey: "prep", label: "여행준비" }, ...days];
  }

  function renderDayList() {
    els.dayList.innerHTML = state.days
      .map(
        (day) => `
        <li role="option" aria-selected="${day.dayKey === state.dayKey}"
          class="expense-day-option${day.dayKey === state.dayKey ? " expense-day-option--active" : ""}"
          data-day-key="${escapeHtml(day.dayKey)}">${escapeHtml(day.label)}</li>`
      )
      .join("");
    const selected = state.days.find((day) => day.dayKey === state.dayKey);
    els.dayTriggerText.textContent = selected?.label ?? "날짜 선택";
  }

  function setDayOpen(open) {
    els.dayList.hidden = !open;
    els.dayTrigger.setAttribute("aria-expanded", String(open));
  }

  function selectDay(dayKey) {
    state.dayKey = dayKey;
    renderDayList();
    setDayOpen(false);
  }

  // ---- 카테고리 (5-5): 7개, 원형 아이콘 + 아래에 작은 글자로 라벨. 한 줄에 다 안 들어가면 가로로 스크롤된다
  // (.expense-category-chips가 overflow-x:auto) ----

  function renderCategoryChips() {
    els.categoryChips.innerHTML = EXPENSE_CATEGORIES.map(
      (category) => `
        <button type="button" role="radio" aria-checked="${category.key === state.categoryKey}"
          class="expense-category-item${category.key === state.categoryKey ? " expense-category-item--active" : ""}"
          data-category-key="${category.key}">
          <span class="expense-category-icon" aria-hidden="true">${category.icon}</span>
          <span class="expense-category-label">${escapeHtml(category.label)}</span>
        </button>`
    ).join("");
  }

  function selectCategory(key) {
    state.categoryKey = key;
    renderCategoryChips();
  }

  // ---- 여행 멤버: 결제/나누기 (5-6) ----

  // 서버 함수(003_member_profiles.sql)가 없으면 이름이 비어 오니, 최소한 내 이름·사진은 로그인 정보로 채운다
  // (tripMembers.js#withSelf와 같은 방식)
  function withSelf(members) {
    const myId = auth.getUserId();
    const profile = auth.getProfile();
    return members.map((m) => (m.userId === myId && profile ? { ...m, name: m.name || profile.name, avatarUrl: m.avatarUrl || profile.avatarUrl } : m));
  }

  function memberDisplayName(member) {
    return member.name || "이름 없는 멤버";
  }

  // 결제자/더치페이 각각 모든 멤버를 아바타+이름 칩으로 보여주고(옆으로 스크롤), 탭하면 다중 선택 토글된다
  // (state.payerIds/splitIds가 실제 선택 상태를 들고 있다 - 체크박스가 아니라 이 Set이 정답).
  function chipHtml(member, selected) {
    const name = memberDisplayName(member);
    const initial = (member.name || "?").slice(0, 1);
    const avatarStyle = member.isGuest ? ` style="background:${member.bg}"` : "";
    const initialStyle = member.isGuest ? ` style="color:${member.ink}"` : "";
    return `
      <div class="expense-member-chip" data-user-id="${escapeHtml(member.userId)}">
        <button type="button" class="expense-member-chip-btn${selected ? " expense-member-chip-btn--active" : ""}"
          role="checkbox" aria-checked="${selected}" data-action="toggle-member" aria-label="${escapeHtml(name)}">
          <span class="member-avatar"${avatarStyle}>
            <span class="member-avatar-initial"${initialStyle}>${escapeHtml(initial)}</span>
            ${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : ""}
          </span>
          <span class="expense-member-chip-name">${escapeHtml(name)}</span>
        </button>
        ${member.isGuest ? `<button type="button" class="expense-member-chip-remove" data-action="remove-guest" aria-label="${escapeHtml(name)} 삭제">×</button>` : ""}
      </div>`;
  }

  function addChipHtml() {
    return `
      <button type="button" class="expense-member-add" data-action="add-member" aria-label="멤버 추가">
        <span class="expense-member-add-avatar" aria-hidden="true">+</span>
      </button>`;
  }

  function renderMemberRow(role) {
    const container = role === "payer" ? els.memberRowPayer : els.memberRowSplit;
    const set = role === "payer" ? state.payerIds : state.splitIds;
    container.innerHTML = state.members.map((member) => chipHtml(member, set.has(member.userId))).join("") + addChipHtml();
  }

  function renderMembers() {
    renderMemberRow("payer");
    renderMemberRow("split");
  }

  function handleMemberRowClick(e, role) {
    const removeBtn = e.target.closest('[data-action="remove-guest"]');
    if (removeBtn) {
      const userId = removeBtn.closest("[data-user-id]")?.dataset.userId;
      if (userId) removeGuestMember(userId);
      return;
    }
    const addBtn = e.target.closest('[data-action="add-member"]');
    if (addBtn) {
      openAddMemberPopup();
      return;
    }
    const toggleBtn = e.target.closest('[data-action="toggle-member"]');
    if (toggleBtn) {
      const userId = toggleBtn.closest("[data-user-id]")?.dataset.userId;
      if (userId) toggleMember(role, userId);
    }
  }

  function toggleMember(role, userId) {
    const set = role === "payer" ? state.payerIds : state.splitIds;
    if (set.has(userId)) set.delete(userId);
    else set.add(userId);
    renderMembers();
  }

  // "추가한 멤버"만 삭제할 수 있다(실제 여행 멤버는 못 지운다) - 결제자·더치페이 선택에서도 함께 빠진다.
  function removeGuestMember(userId) {
    state.members = state.members.filter((member) => member.userId !== userId);
    state.payerIds.delete(userId);
    state.splitIds.delete(userId);
    renderMembers();
  }

  // 수정 폼을 열었을 때 payerIds/splitIds에 있지만 이번에 불러온 실제 멤버 목록에는 없는 id(예: 지난번에
  // "+ 추가"로 넣었던 사람 - 이 화면을 벗어나면 이름은 기억하지 않는다)는 "이름 없는 멤버"로 되살려서
  // 선택이 화면에서 사라지지 않게 한다.
  function reconcileGuestMembers() {
    const known = new Set(state.members.map((member) => member.userId));
    [...state.payerIds, ...state.splitIds].forEach((userId) => {
      if (known.has(userId)) return;
      const { bg, ink } = randomGuestColor();
      state.members.push({ userId, name: "이름 없는 멤버", avatarUrl: null, isGuest: true, bg, ink });
      known.add(userId);
    });
  }

  // 멤버 목록을 서버에서 받는다. 창을 다시 열면(또는 닫으면) membersRequestId가 늘어나서 늦게 도착한 응답은 버린다.
  async function loadMembersForForm(tripId) {
    const requestId = ++membersRequestId;
    els.memberRowPayer.innerHTML = els.memberRowSplit.innerHTML = `<p class="expense-member-status">멤버를 불러오는 중이에요...</p>`;

    let members;
    try {
      members = await loadMembers(tripId);
    } catch (err) {
      if (requestId !== membersRequestId) return;
      els.memberRowPayer.innerHTML = els.memberRowSplit.innerHTML = `<p class="expense-member-status">${escapeHtml(err.message)}</p>`;
      return;
    }
    if (requestId !== membersRequestId) return; // 그 사이에 창을 닫았거나 다시 열었다

    state.members = withSelf(members);
    reconcileGuestMembers();
    renderMembers();
  }

  // ---- "+ 추가": 여행에 없는 인원을 이름만으로 추가하는 작은 팝업 ----

  function ensureAddMemberModal() {
    if (addEls) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "EXPENSE-FORM · 인원 추가 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-confirm" role="dialog" aria-modal="true" aria-labelledby="expense-add-member-title">
        <h2 class="modal-title" id="expense-add-member-title">인원 추가</h2>
        <div class="form-field">
          <input type="text" class="expense-add-member-input" placeholder="예: 봉식이" autocomplete="off" />
        </div>
        <p class="form-error" data-add-member-error hidden></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
            <button type="button" class="btn expense-add-member-save" data-action="save">저장</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    addEls = {
      overlay,
      input: overlay.querySelector(".expense-add-member-input"),
      error: overlay.querySelector("[data-add-member-error]"),
      saveBtn: overlay.querySelector(".expense-add-member-save"),
    };

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", closeAddMemberPopup);
    addEls.saveBtn.addEventListener("click", saveNewGuestMember);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAddMemberPopup();
      if (e.key === "Enter") {
        e.preventDefault();
        saveNewGuestMember();
      }
    });
  }

  function openAddMemberPopup() {
    ensureAddMemberModal();
    addEls.input.value = "";
    addEls.error.hidden = true;
    addEls.overlay.hidden = false;
    requestAnimationFrame(() => addEls.input.focus());
  }

  function closeAddMemberPopup() {
    if (addEls) addEls.overlay.hidden = true;
  }

  // 저장하면 결제자·더치페이 둘 다에 추가된다(PRD: "저장 하면 결제자와 더치페이에 둘다 추가된다")
  function saveNewGuestMember() {
    const name = addEls.input.value.trim();
    if (!name) {
      addEls.error.textContent = "이름을 입력해주세요.";
      addEls.error.hidden = false;
      return;
    }
    const userId = generateId();
    const { bg, ink } = randomGuestColor();
    state.members.push({ userId, name, avatarUrl: null, isGuest: true, bg, ink });
    state.payerIds.add(userId);
    state.splitIds.add(userId);
    closeAddMemberPopup();
    renderMembers();
  }

  // ---- 오류 표시 ----

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  // ---- 열기/닫기 ----

  // trip: 지출을 등록/수정할 여행 (필수). dayKey: 새로 추가할 때 기본 선택할 날짜(생략하면 첫 번째 섹션).
  // expense: 이미 있는 지출을 넘기면 그 값으로 채워진 "수정" 폼이 된다 (dayKey는 무시하고 expense.dayKey를 쓴다).
  function open({ trip, dayKey, expense } = {}) {
    if (!trip) return;
    ensureModal();

    const days = buildDayOptions(trip);
    const initialDayKey = expense?.dayKey ?? (days.some((d) => d.dayKey === dayKey) ? dayKey : days[0].dayKey);

    state = {
      trip,
      days,
      currencyCode: expense?.currency ?? "KRW",
      dayKey: initialDayKey,
      categoryKey: expense?.category ?? null,
      members: [],
      payerIds: new Set(expense?.payerIds ?? []),
      splitIds: new Set(expense?.splitIds ?? []),
      editingId: expense?.id ?? null,
      editingExpense: expense ?? null,
      saving: false,
    };

    els.form.reset();
    els.amount.value = expense ? String(expense.amount) : "";
    els.title.value = expense?.title ?? "";
    els.memo.value = expense?.memo ?? "";
    clearError();

    els.modalTitle.textContent = expense ? "비용 수정" : "비용 추가";
    renderCurrencyList();
    setCurrencyOpen(false);
    setDayOpen(false);
    renderDayList();
    renderCategoryChips();
    if (expense?.paymentMethod) {
      const radio = els.form.querySelector(`input[name="expense-payment"][value="${expense.paymentMethod}"]`);
      if (radio) radio.checked = true;
    }

    els.overlay.hidden = false;
    requestAnimationFrame(() => els.amount.focus());

    loadMembersForForm(trip.id);
  }

  function close() {
    if (state.saving) return; // 저장 중에는 창을 닫아 중간에 끊기지 않게 한다
    membersRequestId += 1; // 진행 중이던 멤버 조회 결과는 무시한다
    closeAddMemberPopup();
    hideAllTooltips();
    els.overlay.hidden = true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (state.saving) return;

    const amount = parseFloat(els.amount.value);
    const title = els.title.value.trim();
    const paymentMethod = els.form.querySelector('input[name="expense-payment"]:checked')?.value ?? null;
    const memo = els.memo.value.trim();

    if (!Number.isFinite(amount) || amount <= 0) return showError("금액을 올바르게 입력해주세요.");
    if (!state.dayKey) return showError("날짜를 선택해주세요.");
    if (!paymentMethod) return showError("결제수단을 선택해주세요.");
    if (!title) return showError("제목을 입력해주세요.");
    if (!state.categoryKey) return showError("카테고리를 선택해주세요.");

    clearError();
    state.saving = true;
    els.saveBtn.disabled = true;

    const payload = {
      dayKey: state.dayKey,
      amount,
      currency: state.currencyCode,
      krwAmount: currencyData.toKrw(amount, state.currencyCode), // 저장 시점 환율로 환산 (PRD 6번), 모르는 통화면 null
      paymentMethod,
      title,
      category: state.categoryKey,
      payerIds: [...state.payerIds],
      splitIds: [...state.splitIds],
      memo,
    };

    try {
      if (state.editingId) await updateExpense(state.editingId, payload);
      else await addExpense({ tripId: state.trip.id, ...payload });
    } catch (err) {
      showError(err.message);
      return;
    } finally {
      state.saving = false;
      els.saveBtn.disabled = false;
    }

    els.overlay.hidden = true;
    onChange();
  }

  // onChangeCallback: 저장에 성공했을 때 부르는 콜백 (budgetPage.js가 목록을 다시 그리는 함수를 넘긴다)
  function init(onChangeCallback) {
    onChange = typeof onChangeCallback === "function" ? onChangeCallback : () => {};
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.expenseForm = { init, open };
})();
