// @별칭 BUDGET · 가계부 화면 (#/budget/:id)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// PRD v6 "가계부 기능"의 메인 목록 화면. 모달이 아니라 새 화면(#/budget/:id)이고, 일정 화면과 같은 구조로
// "여행준비" + Day1~DayN 섹션을 만들고, 각 섹션 안에 그 날짜(day_key)의 지출을 카드로 늘어놓는다.
// 이번 단계는 목록·합계만 만든다. "비용 추가" 버튼은 다음 단계에서 만들 입력 폼이 붙을 자리만 잡아 둔다
// (openAddExpense가 그 연결 지점이다. 지금은 ui.showComingSoon만 부른다).
//
// 데이터는 storage.js의 loadExpenses/getExpenses를 쓴다 (읽기 전용; 추가·수정·삭제는 다음 단계에서 만든다).
// expenses는 supabase/migrations/005_budget.sql이 있어야 조회된다 — 없으면 storage.loadExpenses가 던지는
// 한국어 오류를 토스트로 보여준다.

(function () {
  const storage = window.TripLog.storage;
  const { getTripById, loadExpenses, getExpenses, isExpensesLoaded, deleteExpense } = storage;
  const { escapeHtml, getTripDays } = window.TripLog.util;
  const { getCategoryByKey } = window.TripLog.expenseCategoryData;
  const { findByCode } = window.TripLog.currencyData;
  const ui = window.TripLog.ui;
  const router = window.TripLog.router;

  let loadRunId = 0;

  // "여행준비" + Day1~DayN. 여행 기간이 없으면(여행 정보를 못 찾은 경우) "여행준비"만 남는다.
  function buildSections(trip) {
    const days = getTripDays(trip).map((day) => ({ dayKey: day.date, title: `Day ${day.number}`, sub: day.label }));
    return [{ dayKey: "prep", title: "여행준비" }, ...days];
  }

  // "$45"처럼 통화 기호 + 금액 (합계와 달리 기호와 숫자 사이를 띄우지 않는다: PRD 5-2 카드 표기 예시대로)
  function formatAmount(expense) {
    const symbol = findByCode(expense.currency)?.symbol ?? expense.currency;
    const amount = Number.isFinite(expense.amount) ? expense.amount.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : expense.amount;
    return `${symbol}${amount}`;
  }

  // 스와이프 삭제로 감싸는 래퍼(.budget-item-wrap) - 일정 화면의 .timeline-item-wrap/.item-delete-bg,
  // 메인 화면 여행 카드의 .trip-card-wrap/.trip-card-delete-bg와 같은 원리(뒤에 숨은 삭제 배경이 카드가
  // 밀린 만큼만 드러난다)이다. 다만 여행 삭제처럼 확인창을 띄우지 않고, 일정 카드와 똑같이 카드 너비의
  // 반 이상 밀리면 그 자리에서 바로 지운다(아래 commitSwipeDelete).
  function expenseItemHtml(expense) {
    const meta = getCategoryByKey(expense.category);
    return `
      <li class="budget-item-wrap" data-id="${escapeHtml(expense.id)}">
        <div class="budget-item-delete-bg" aria-hidden="true"><span>삭제</span></div>
        <div class="budget-item" data-id="${escapeHtml(expense.id)}" data-action="edit-expense">
          <span class="budget-item-icon" aria-hidden="true">${meta?.icon ?? "📌"}</span>
          <span class="budget-item-title">${escapeHtml(expense.title)}</span>
          <span class="budget-item-amount">${escapeHtml(formatAmount(expense))}</span>
        </div>
      </li>`;
  }

  function sectionHtml(section, expenses) {
    const body = expenses.length
      ? `<ul class="budget-list">${expenses.map(expenseItemHtml).join("")}</ul>`
      : `<p class="budget-empty">아직 기록된 비용이 없어요.</p>`;

    return `
      <section class="budget-day-section">
        <h2 class="budget-day-header">
          <span class="budget-day-title">${escapeHtml(section.title)}</span>
          ${section.sub ? `<span class="budget-day-sub">${escapeHtml(section.sub)}</span>` : ""}
        </h2>
        ${body}
        <button type="button" class="budget-add-btn" data-action="add-expense" data-day-key="${escapeHtml(section.dayKey)}">+ 비용 추가</button>
      </section>`;
  }

  // "₩ 1,234,000" (합계는 기호와 숫자 사이를 띄운다: PRD 4번 표기 예시대로)
  function formatTotal(krw) {
    return `₩ ${Math.round(krw).toLocaleString("ko-KR")}`;
  }

  function totalKrw(expenses) {
    return expenses.reduce((sum, expense) => sum + (typeof expense.krwAmount === "number" ? expense.krwAmount : 0), 0);
  }

  function renderList(el, trip, loading) {
    const expenses = getExpenses().filter((expense) => expense.tripId === trip.id);
    const sections = buildSections(trip);
    const byDayKey = new Map(sections.map((section) => [section.dayKey, []]));

    // day_key가 지금의 여행 기간과 안 맞는 지출(예: 나중에 여행 날짜를 바꾼 경우)도 잃어버리지 않게, 맨 뒤에
    // 별도 섹션으로 붙인다. 정상적인 경우라면 이 섹션은 비어 있어서 나타나지 않는다.
    const strayExpenses = [];
    for (const expense of expenses) {
      if (byDayKey.has(expense.dayKey)) byDayKey.get(expense.dayKey).push(expense);
      else strayExpenses.push(expense);
    }

    const listEl = el.querySelector("[data-budget-list]");
    listEl.innerHTML = loading
      ? `<p class="budget-loading">지출을 불러오는 중이에요...</p>`
      : sections.map((section) => sectionHtml(section, byDayKey.get(section.dayKey))).join("") +
        (strayExpenses.length ? sectionHtml({ dayKey: "etc", title: "그 외" }, strayExpenses) : "");

    el.querySelector("[data-budget-total]").textContent = loading ? "계산 중..." : formatTotal(totalKrw(expenses));
  }

  // ---- 비용 카드 스와이프해서 삭제 ----
  // 일정 화면의 스와이프 삭제(timelineDrag.js)와 같은 제스처: 가로로 SWIPE_START_PX 이상 밀면 확정되고
  // 카드는 손가락을 1:1로 따라가다가, 카드 너비의 반(SWIPE_DELETE_RATIO) 이상 밀리면 그 자리에서 바로
  // 지운다(메인 화면 여행 카드처럼 확인창을 띄우지 않는다 - 비용 하나 삭제는 여행 삭제만큼 무겁지 않다).
  const SWIPE_START_PX = 10;
  const SWIPE_DELETE_RATIO = 0.5;

  let swipe = null; // 진행 중인 스와이프 제스처(한 번에 하나) - { pointerId, wrap, card, id, startX, startY, mode, width, deleted }

  // 마우스는 눌렀던 자리에서 떼면 움직인 거리와 무관하게 click을 그대로 내므로, 스와이프가 확정된 다음의
  // click 한 번만 가로채 막아 수정 폼이 곧바로 열리는 것을 막는다(일정 화면과 같은 이유).
  function suppressNextClick(card) {
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      card.removeEventListener("click", handler, true);
    };
    card.addEventListener("click", handler, true);
  }

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // 마우스 왼쪽 버튼(또는 터치/펜)만
    if (swipe) return;
    const wrap = e.target.closest(".budget-item-wrap");
    if (!wrap) return;
    const card = wrap.querySelector(".budget-item");
    swipe = { pointerId: e.pointerId, wrap, card, id: wrap.dataset.id, startX: e.clientX, startY: e.clientY, mode: "pending" };
    try {
      card.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 이미 풀렸거나 못 잡는 환경이면 무시 - 아래 리스너는 document에 걸려 있어 상관없다 */
    }
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  }

  function handlePointerMove(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    if (swipe.deleted) return;
    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;

    if (swipe.mode === "pending") {
      if (Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy)) {
        swipe.mode = "swiping";
        swipe.width = swipe.wrap.getBoundingClientRect().width;
        suppressNextClick(swipe.card);
      }
      return; // 세로로 조금 움직이는 것 정도는 그냥 스크롤이 되게 둔다
    }

    e.preventDefault();
    const x = Math.min(0, dx); // 오른쪽으로는 못 밀리게(왼쪽으로 스와이프해야 삭제 박스가 드러난다)
    swipe.card.style.transform = `translateX(${x}px)`;
    if (swipe.width && Math.abs(x) >= swipe.width * SWIPE_DELETE_RATIO) commitSwipeDelete();
  }

  function handlePointerUp(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    if (swipe.mode === "swiping" && !swipe.deleted) snapSwipeBack(swipe.card);
    cleanupSwipe();
  }

  function handlePointerCancel(e) {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    if (swipe.mode === "swiping" && !swipe.deleted) snapSwipeBack(swipe.card);
    cleanupSwipe();
  }

  function cleanupSwipe() {
    if (!swipe) return;
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
    try {
      swipe.card.releasePointerCapture(swipe.pointerId);
    } catch (err) {
      /* 이미 풀렸으면 무시 */
    }
    swipe = null;
  }

  function snapSwipeBack(card) {
    card.style.transition = "transform 0.2s ease";
    card.style.transform = "";
    setTimeout(() => {
      card.style.transition = "";
    }, 220);
  }

  // 카드를 왼쪽 바깥으로 밀어내며 사라지게 한 다음(타임라인 스와이프 삭제와 같은 연출) 서버에서 실제로 지운다.
  function commitSwipeDelete() {
    if (swipe.deleted) return;
    swipe.deleted = true;
    const { wrap, card, id } = swipe;
    wrap.style.transition = "transform 0.22s ease, opacity 0.22s ease, height 0.22s ease 0.05s, margin 0.22s ease 0.05s";
    const rect = wrap.getBoundingClientRect();
    wrap.style.height = `${rect.height}px`;
    requestAnimationFrame(() => {
      card.style.transform = "translateX(-100%)";
      wrap.style.opacity = "0";
      wrap.style.height = "0px";
      wrap.style.marginTop = "0";
      wrap.style.marginBottom = "0";
    });
    setTimeout(() => deleteExpenseById(id), 240);
  }

  // 실패하든 성공하든 화면이 보이고 있으면 캐시 기준으로 다시 그린다 - 성공하면 지출이 빠진 목록·합계가,
  // 실패하면(토스트로 사유를 보여준 뒤) 밀려 있던 카드가 원래대로 돌아온다.
  async function deleteExpenseById(id) {
    try {
      await deleteExpense(id);
    } catch (err) {
      ui.showToast(err.message);
    } finally {
      refreshVisible();
    }
  }

  // "+ 비용 추가"를 누르면(또는 기존 지출 카드를 눌러 수정하면) expenseForm.js의 창을 연다.
  // 저장되면 refreshVisible이 화면을 다시 그린다 (expenseForm.js#init에 넘겨 둔다).
  function openAddExpense(trip, dayKey) {
    window.TripLog.expenseForm.open({ trip, dayKey });
  }

  // 지금 화면에 가계부 화면이 보이고 있으면(다른 화면으로 옮기지 않았으면) 캐시 기준으로 다시 그린다.
  // expenseForm이 저장에 성공했을 때 부르는 콜백이다. loadExpenses를 다시 하지 않아도, addExpense가 이미
  // 캐시(expensesCache)에 새 지출을 넣어 두었으므로 getExpenses()가 바로 최신 상태를 돌려준다.
  function refreshVisible() {
    const el = document.querySelector('[data-page="budget"]');
    if (!el || el.hidden) return;
    const trip = getTripById(el.dataset.tripId);
    if (trip) renderList(el, trip, false);
  }

  async function render(el, { params }) {
    const trip = getTripById(params.id);
    if (!trip) return; // 가드가 이미 걸러내므로 여기까지 오지 않는다
    el.dataset.tripId = trip.id;
    const runId = ++loadRunId;

    el.innerHTML = `
      <div class="budget-shell">
        <header class="budget-header">
          <div class="budget-header-text">
            <h1 class="budget-title">가계부</h1>
            <p class="budget-subtitle">${escapeHtml(trip.title || trip.destination || "")}</p>
          </div>
        </header>
        <div class="budget-scroll" data-budget-list></div>
        <div class="budget-total-bar">
          <span class="budget-total-label">전체 지출</span>
          <span class="budget-total-amount" data-budget-total>계산 중...</span>
        </div>
      </div>`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("pointerdown", handlePointerDown);
      el.addEventListener("click", (e) => {
        const addBtn = e.target.closest('[data-action="add-expense"]');
        if (addBtn) {
          const trip = getTripById(el.dataset.tripId);
          if (trip) openAddExpense(trip, addBtn.dataset.dayKey);
          return;
        }
        const item = e.target.closest('[data-action="edit-expense"]');
        if (item) {
          const trip = getTripById(el.dataset.tripId);
          const expense = getExpenses().find((exp) => exp.id === item.dataset.id);
          if (trip && expense) window.TripLog.expenseForm.open({ trip, expense });
        }
      });
    }

    // 처음 보는 여행이면 "불러오는 중" 문구를 먼저 보여주고, 받아 둔 적 있으면 캐시로 먼저 그린 뒤 새로 고친다
    renderList(el, trip, !isExpensesLoaded(trip.id));

    try {
      await loadExpenses(trip.id);
    } catch (err) {
      if (runId === loadRunId) ui.showToast(err.message);
    }
    if (runId !== loadRunId || el.dataset.tripId !== trip.id) return; // 그 사이에 떠났거나 다른 여행으로 옮겼다
    renderList(el, trip, false);
  }

  window.TripLog.expenseForm.init(refreshVisible);
  router.definePage("budget", render);
})();
