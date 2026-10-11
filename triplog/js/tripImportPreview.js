// @별칭 TRIP-IMPORT-PREVIEW · 여행 가져오기 미리보기 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// tripImport.js(analyze-trip-import 호출)의 결과를 사람이 확인·수정하는 화면(PRD v8). tripImport.js는
// 이 화면을 모르고, 이 파일이 자기 load 시점에 tripImport.init(open)으로 스스로를 이어붙인다
// (walletPage.js가 walletForm.init/walletViewer.init을 부르는 것과 같은, "나중에 로드되는 화면이 먼저
// 로드된 입력 모듈을 초기화한다" 패턴 — 그래서 storage/myTripData/expenseCategoryData처럼 늦게 로드되는
// 것들에 의존해도 되고, index.html의 load 순서도 그 반대로는 못 만든다).
//
// 일정·비용은 각각 수정 가능한 카드 목록으로 보여준다. 카드 자체가 곧 입력칸(별도 수정 모달 없음)이라,
// 글자를 고치면 즉시 state에 반영되고(구조가 안 바뀌니 다시 그리지 않는다), ✕를 누르면 그 카드만 배열에서
// 빼고 통째로 다시 그린다(인덱스가 밀리므로). mode: "create"일 때는 위에 여행 정보(제목·여행지·시작일·
// 종료일) 입력칸도 보여준다 - AI가 못 찾은 값은 빈칸으로 시작하고, 넷 다 채워야 '등록하기'가 눌린다.
//
// mode: "append"일 때는 열자마자 그 여행의 기존 일정·비용을 서버에서 다시 받아(storage.loadItems/
// loadExpenses, 캐시가 오래됐을 수 있어서) 같은 날짜 + 같은 제목(공백·대소문자 무시)인 카드에 "기존 항목
// 교체됨" 배지를 붙인다(matchedId에 그 기존 행의 id를 남겨 둔다 - 다음 단계가 insert 대신 update할 때 쓴다).
// 일정의 "제목"은 실제 schedule_items에는 보통 없고(이 앱은 place를 쓴다 - storage.js#rowToItem 참고)
// AI가 뽑은 title만 있어서, 기존 항목 쪽은 place를 우선하고 없으면 title로 비교한다.
//
// '등록하기'는 실제로 저장한다(PRD v8 마지막 단계):
//   - mode "create": storage.createTrip으로 여행을 먼저 만들고, 그 tripId로 scheduleItems/expenses를 순서대로 insert
//   - mode "append": matchedId가 있는 카드는 update, 없는 카드는 insert (matchedId는 markDuplicates가 붙여 둔 기존 행 id)
//   - 비용은 currencyData.toKrw(amount, currency)로 krw_amount도 함께 계산해서 보낸다(PRD v6과 같은 계산)
// 항목 하나가 실패해도 나머지는 계속 진행한다(순서대로, 하나씩 기다리며) - 끝나면 성공/실패 개수와 실패 사유를
// 보여주고, 이미 성공한 항목은 목록에서 지워서(재시도해도 두 번 저장되지 않게) 실패한 것만 다시 시도할 수 있게
// 남겨 둔다. 전부 성공하면 창을 닫고 mode에 따라 그 여행 화면으로 이동한다(handleSubmit 참고).

(function () {
  const storage = window.TripLog.storage;
  const { escapeHtml, addDays } = window.TripLog.util;
  const { CATEGORY_META } = window.TripLog.myTripData;
  const { EXPENSE_CATEGORIES } = window.TripLog.expenseCategoryData;
  const { toKrw } = window.TripLog.currencyData;
  const router = window.TripLog.router;
  const ui = window.TripLog.ui;
  const tripImport = window.TripLog.tripImport;

  // scheduleItems의 category 6개(myTripData.CATEGORY_META의 "all"을 뺀 나머지) - analyze-trip-import의
  // 스키마와 같다. expenses는 expenseCategoryData.EXPENSE_CATEGORIES(7개)를 그대로 쓴다(서로 다른 목록이다).
  const SCHEDULE_CATEGORY_KEYS = ["flight", "lodging", "meal", "sightseeing", "shopping", "etc"];

  const state = {
    mode: "create", // "create" | "append" - "create"로 열어도 저장 도중 여행이 만들어지고 나면 "append"로 바뀐다(아래 handleSubmit)
    tripId: null,
    createdTitle: null, // 이번에 새로 만든 여행의 제목(성공 토스트에 쓴다). append로 열었으면 계속 null.
    trip: { title: "", destination: "", startDate: "", endDate: "" }, // mode "create"일 때만 쓴다
    tripStartDate: null, // mode "append"일 때만 쓴다 - 그 여행의 이미 저장된 시작일(resolveDayOffsets가 쓴다)
    scheduleItems: [], // [{ date, dayOffset, time, category, title, place, memo, matchedId }]
    expenses: [], // [{ dayKey, dayOffset, amount, currency, category, title, matchedId }]
  };

  const els = {
    overlay: document.getElementById("trip-import-preview-overlay"),
    close: document.getElementById("trip-import-preview-close"),
    body: document.getElementById("trip-import-preview-body"),
    error: document.getElementById("trip-import-preview-error"),
    submit: document.getElementById("trip-import-preview-submit"),
  };

  // 공백 다 빼고 소문자로 - "공백/대소문자 무시하고 일치"(PRD v8 6번)
  const normalize = (value) => (value ?? "").replace(/\s+/g, "").toLowerCase();

  // ---- 열기/닫기 ----

  async function open({ mode, tripId, result }) {
    state.mode = mode === "append" ? "append" : "create";
    state.tripId = state.mode === "append" ? tripId ?? null : null;
    state.createdTitle = null;
    state.trip = {
      title: result?.trip?.title ?? "",
      destination: result?.trip?.destination ?? "",
      startDate: result?.trip?.startDate ?? "",
      endDate: result?.trip?.endDate ?? "",
    };
    // append면 그 여행의 이미 저장된 시작일을 알아 둔다(캐시에서 동기로 읽는다) - "1일차"처럼 상대적으로만
    // 표현된 날짜(dayOffset)를 실제 날짜로 바로 계산하는 데 쓴다.
    state.tripStartDate = state.mode === "append" && state.tripId ? (storage.getTripById(state.tripId)?.startDate ?? null) : null;
    state.scheduleItems = (result?.scheduleItems ?? []).map((item) => ({ ...item, matchedId: null }));
    state.expenses = (result?.expenses ?? []).map((expense) => ({ ...expense, matchedId: null }));
    resolveDayOffsets(); // create 모드도 AI가 trip.startDate를 함께 읽었으면 바로 계산된다

    hideError();
    els.overlay.hidden = false;
    render(); // 중복 표시는 서버 조회가 끝난 뒤에 따로 한 번 더 그린다 - 그 전에도 카드는 바로 보여준다

    if (state.mode === "append" && state.tripId) await markDuplicates(state.tripId);
  }

  // "1일차"/"Day 2"처럼 달력 날짜 없이 상대 표현만 있던 항목(dayOffset)을, 실제로 아는 여행 시작일(append면
  // 그 여행의 저장된 시작일, create면 사용자가 위 여행 정보 칸에 입력/수정한 시작일)로 실제 날짜를 계산해
  // 채운다. 이미 date/dayKey가 있는 항목이나(달력 날짜를 읽었으면 dayOffset은 애초에 null) 시작일을 아직
  // 모르는 동안은 아무것도 하지 않고 그대로 둔다(사용자가 직접 채울 수 있게). 이미 채운 값은 다시 덮어쓰지
  // 않는다 - 사용자가 고친 뒤에 시작일이 또 바뀌어도 그 수정은 그대로 남는다.
  function knownStartDate() {
    return state.mode === "create" ? state.trip.startDate || null : state.tripStartDate;
  }

  function resolveDayOffsets() {
    const startDate = knownStartDate();
    if (!startDate) return false;
    let changed = false;
    state.scheduleItems.forEach((item) => {
      if (!item.date && Number.isInteger(item.dayOffset)) {
        item.date = addDays(startDate, item.dayOffset);
        changed = true;
      }
    });
    state.expenses.forEach((item) => {
      if (!item.dayKey && Number.isInteger(item.dayOffset)) {
        item.dayKey = addDays(startDate, item.dayOffset);
        changed = true;
      }
    });
    return changed;
  }

  function close() {
    els.overlay.hidden = true;
  }

  // 지금 여행의 기존 일정·비용을 서버에서 다시 받아(캐시가 오래됐을 수 있어서) 같은 날짜+제목인 카드를 표시한다.
  async function markDuplicates(tripId) {
    let existingItems = [];
    let existingExpenses = [];
    try {
      [existingItems, existingExpenses] = await Promise.all([storage.loadItems(tripId), storage.loadExpenses(tripId)]);
    } catch (err) {
      return; // 기존 목록을 못 받아도 미리보기 자체는 그대로 둔다 - 중복 표시만 못 할 뿐
    }
    if (state.tripId !== tripId) return; // 그 사이 창을 닫고 다른 여행으로 다시 열었을 수 있다

    state.scheduleItems.forEach((item) => {
      const match = existingItems.find((ex) => ex.date === item.date && normalize(ex.place || ex.title) === normalize(item.place || item.title));
      item.matchedId = match?.id ?? null;
    });
    state.expenses.forEach((expense) => {
      const match = existingExpenses.find((ex) => ex.dayKey === expense.dayKey && normalize(ex.title) === normalize(expense.title));
      expense.matchedId = match?.id ?? null;
    });
    render();
  }

  // ---- 화면 ----

  function tripFormHtml() {
    const t = state.trip;
    return `
      <section class="trip-import-preview-tripform" data-section="trip">
        <p class="trip-import-preview-section-title">여행 정보</p>
        <input type="text" class="trip-import-preview-input" data-trip-field="title" placeholder="여행 제목 (필수)" value="${escapeHtml(t.title)}" />
        <input type="text" class="trip-import-preview-input" data-trip-field="destination" placeholder="여행지 (필수)" value="${escapeHtml(t.destination)}" />
        <div class="trip-import-preview-row">
          <input type="date" class="trip-import-preview-input" data-trip-field="startDate" aria-label="시작일" value="${escapeHtml(t.startDate)}" />
          <input type="date" class="trip-import-preview-input" data-trip-field="endDate" aria-label="종료일" value="${escapeHtml(t.endDate)}" />
        </div>
      </section>`;
  }

  function categoryOptionsHtml(options, selected) {
    const items = options
      .map(({ key, icon, label }) => `<option value="${key}"${key === selected ? " selected" : ""}>${icon} ${escapeHtml(label)}</option>`)
      .join("");
    return `<option value=""${selected ? "" : " selected"}>카테고리 미정</option>${items}`;
  }

  const scheduleCategoryOptionsHtml = (selected) =>
    categoryOptionsHtml(
      SCHEDULE_CATEGORY_KEYS.map((key) => ({ key, ...CATEGORY_META[key] })),
      selected
    );
  const expenseCategoryOptionsHtml = (selected) => categoryOptionsHtml(EXPENSE_CATEGORIES, selected);

  // "1일차"/"Day 2"처럼 달력 날짜 없이 상대 표현만 있던 항목에 붙이는 안내 배지 - dateField는 이 항목에서
  // 실제 날짜가 들어가는 칸 이름("date" 또는 "dayKey")이다. resolveDayOffsets가 이미 채웠으면 그 사실을,
  // 아직 여행 시작일을 몰라 못 채웠으면 시작일을 입력하면 채워진다는 안내를 보여준다.
  function dayOffsetBadgeHtml(item, dateField) {
    if (!Number.isInteger(item.dayOffset)) return "";
    const nth = item.dayOffset + 1;
    return item[dateField]
      ? `<span class="trip-import-preview-badge trip-import-preview-badge--info">${nth}일차로 인식해서 날짜를 채웠어요</span>`
      : `<span class="trip-import-preview-badge trip-import-preview-badge--info">${nth}일차 - 여행 시작일을 입력하면 날짜가 채워져요</span>`;
  }

  function scheduleCardHtml(item, index) {
    return `
      <div class="trip-import-preview-card" data-kind="scheduleItems" data-index="${index}">
        <div class="trip-import-preview-card-head">
          <input type="date" class="trip-import-preview-input" data-field="date" aria-label="날짜" value="${escapeHtml(item.date ?? "")}" />
          <button type="button" class="trip-import-preview-remove" data-action="remove" aria-label="이 일정 빼기">✕</button>
        </div>
        ${item.matchedId ? `<span class="trip-import-preview-badge">기존 일정 교체됨</span>` : ""}
        ${dayOffsetBadgeHtml(item, "date")}
        <select class="trip-import-preview-select" data-field="category" aria-label="카테고리">${scheduleCategoryOptionsHtml(item.category)}</select>
        <input type="text" class="trip-import-preview-input" data-field="title" placeholder="제목" value="${escapeHtml(item.title ?? "")}" />
        <div class="trip-import-preview-row">
          <input type="time" class="trip-import-preview-input" data-field="time" aria-label="시간" value="${escapeHtml(item.time ?? "")}" />
          <input type="text" class="trip-import-preview-input" data-field="place" placeholder="장소" value="${escapeHtml(item.place ?? "")}" />
        </div>
        <textarea class="trip-import-preview-input" data-field="memo" placeholder="메모">${escapeHtml(item.memo ?? "")}</textarea>
      </div>`;
  }

  function expenseCardHtml(item, index) {
    return `
      <div class="trip-import-preview-card" data-kind="expenses" data-index="${index}">
        <div class="trip-import-preview-card-head">
          <input type="text" class="trip-import-preview-input" data-field="dayKey" placeholder="YYYY-MM-DD 또는 prep" aria-label="날짜" value="${escapeHtml(item.dayKey ?? "")}" />
          <button type="button" class="trip-import-preview-remove" data-action="remove" aria-label="이 비용 빼기">✕</button>
        </div>
        ${item.matchedId ? `<span class="trip-import-preview-badge">기존 비용 교체됨</span>` : ""}
        ${dayOffsetBadgeHtml(item, "dayKey")}
        <select class="trip-import-preview-select" data-field="category" aria-label="카테고리">${expenseCategoryOptionsHtml(item.category)}</select>
        <input type="text" class="trip-import-preview-input" data-field="title" placeholder="제목" value="${escapeHtml(item.title ?? "")}" />
        <div class="trip-import-preview-row">
          <input type="number" class="trip-import-preview-input" data-field="amount" placeholder="금액" min="0" step="1" aria-label="금액" value="${item.amount ?? ""}" />
          <input type="text" class="trip-import-preview-input" data-field="currency" placeholder="통화" maxlength="3" aria-label="통화" value="${escapeHtml(item.currency ?? "")}" />
        </div>
      </div>`;
  }

  function sectionHtml(label, list, cardHtmlFn) {
    return `
      <section class="trip-import-preview-section">
        <p class="trip-import-preview-section-title">${label} (${list.length})</p>
        ${
          list.length
            ? `<div class="trip-import-preview-list">${list.map(cardHtmlFn).join("")}</div>`
            : `<p class="trip-import-preview-empty">추출된 ${label}이 없어요.</p>`
        }
      </section>`;
  }

  function render() {
    els.body.innerHTML = [
      state.mode === "create" ? tripFormHtml() : "",
      sectionHtml("일정", state.scheduleItems, scheduleCardHtml),
      sectionHtml("비용", state.expenses, expenseCardHtml),
    ].join("");
    updateSubmitState();
  }

  function updateSubmitState() {
    if (state.mode !== "create") return void (els.submit.disabled = false);
    const t = state.trip;
    els.submit.disabled = !(t.title.trim() && t.destination.trim() && t.startDate && t.endDate);
  }

  // ---- 오류 표시 ----

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  // ---- 저장 ----

  // 일정 카드 하나를 저장한다. schedule_items는 title/time/category 칸이 없다(storage.js#addItem 참고 -
  // 일반 일정은 date/place/lat/lng/memo만 쓴다, 이 앱의 모든 "장소 추가"가 그렇다. 항공편처럼 item.flight가
  // 있어야 category가 붙는데, AI가 읽은 category는 그런 구조화된 값이 아니라서 항공편으로 만들 수 없다).
  // 그래서 place를 못 읽었으면 title을 place 자리에 대신 넣고(이미 화면 표시가 place를 우선하고 title을
  // 대체값으로 쓰는 것과 같은 순서), time은 memo 앞에 붙여 정보가 사라지지 않게만 한다.
  async function saveScheduleItem(tripId, item) {
    const date = (item.date ?? "").trim();
    if (!date) throw new Error("날짜가 없어요.");
    const place = (item.place ?? "").trim() || (item.title ?? "").trim() || null;
    const memo = [item.time, item.memo].map((v) => (v ?? "").trim()).filter(Boolean).join(" · ") || null;

    if (item.matchedId) await storage.updateItem(item.matchedId, { date, place, memo });
    else await storage.addItem({ tripId, date, place, memo });
  }

  // 비용 카드 하나를 저장한다. expenses.category/title은 not null이라 AI가 못 읽었으면 기본값을 넣는다
  // (그래야 화면에서 직접 채우지 않은 채로 눌러도 DB 제약에서 막히지 않는다 - 카테고리는 "etc", 제목은
  // "가져온 비용"). krw_amount는 currencyData.toKrw로 여기서 계산해서 함께 보낸다(PRD v6·가계부와 같은 계산,
  // 모르는 통화면 null - expenseForm.js도 같은 함수를 쓴다).
  async function saveExpense(tripId, item) {
    const dayKey = (item.dayKey ?? "").trim();
    const amount = Number(item.amount);
    if (!dayKey) throw new Error("날짜가 없어요.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("금액이 올바르지 않아요.");

    const currency = (item.currency ?? "").trim().toUpperCase() || "KRW";
    const category = item.category || "etc";
    const title = (item.title ?? "").trim() || "가져온 비용";
    const payload = { dayKey, amount, currency, krwAmount: toKrw(amount, currency), category, title };

    if (item.matchedId) await storage.updateExpense(item.matchedId, payload);
    else await storage.addExpense({ tripId, ...payload });
  }

  // list의 항목을 하나씩 순서대로 저장한다(동시에 여러 개를 보내지 않는다). 실패해도 멈추지 않고 계속 진행하며,
  // 성공한 항목과 실패한 항목(사유 포함)을 따로 모아 돌려준다.
  async function saveSequentially(list, saveFn, tripId) {
    const succeeded = [];
    const failed = [];
    for (const item of list) {
      try {
        await saveFn(tripId, item);
        succeeded.push(item);
      } catch (err) {
        failed.push({ item, reason: err.message });
      }
    }
    return { succeeded, failed };
  }

  // 부분 실패했을 때 보여줄 요약: 몇 개 중 몇 개를 저장했는지 + 실패한 항목의 제목과 이유(최대 3개까지만,
  // 너무 길어지지 않게).
  function summarizeFailures(scheduleResult, expenseResult) {
    const counts = [];
    if (scheduleResult.succeeded.length || scheduleResult.failed.length) {
      counts.push(`일정 ${scheduleResult.succeeded.length}/${scheduleResult.succeeded.length + scheduleResult.failed.length}개`);
    }
    if (expenseResult.succeeded.length || expenseResult.failed.length) {
      counts.push(`비용 ${expenseResult.succeeded.length}/${expenseResult.succeeded.length + expenseResult.failed.length}개`);
    }
    const reasons = [...scheduleResult.failed, ...expenseResult.failed]
      .slice(0, 3)
      .map((f) => `'${f.item.title || f.item.place || "(제목 없음)"}': ${f.reason}`)
      .join(" / ");
    return `${counts.join(", ")} 저장했어요. 저장된 항목은 목록에서 빠졌어요 - 나머지만 고쳐서 다시 눌러주세요. (${reasons})`;
  }

  async function handleSubmit() {
    hideError();
    if (state.mode === "create") {
      const t = state.trip;
      if (!t.title.trim() || !t.destination.trim() || !t.startDate || !t.endDate) {
        return showError("여행 제목·여행지·시작일·종료일을 모두 입력해주세요.");
      }
    } else if (state.scheduleItems.length === 0 && state.expenses.length === 0) {
      return showError("가져올 일정·비용이 없어요.");
    }

    setSaving(true);
    try {
      // create로 열었어도, 여행 자체는 여기서 한 번만 만든다 - 그 뒤로는(이번 시도에서 일부가 실패해서
      // 다시 눌러도) 같은 tripId에 이어서 저장한다(append와 같은 동작), 여행을 두 번 만들지 않도록.
      if (state.mode === "create") {
        const t = state.trip;
        try {
          const trip = await storage.createTrip({
            title: t.title.trim(),
            destination: t.destination.trim(),
            cityId: null, // destinations.js가 아는 도시가 아닐 수 있어서(자유 입력) 비워 둔다 - 항공편·숙소의 도시 추천만 못 받는다
            startDate: t.startDate,
            endDate: t.endDate,
          });
          state.tripId = trip.id;
          state.createdTitle = trip.title;
          state.mode = "append";
        } catch (err) {
          return showError(`여행을 만들지 못했어요: ${err.message}`);
        }
      }

      const tripId = state.tripId;
      const scheduleResult = await saveSequentially(state.scheduleItems, saveScheduleItem, tripId);
      const expenseResult = await saveSequentially(state.expenses, saveExpense, tripId);

      if (scheduleResult.failed.length || expenseResult.failed.length) {
        // 성공한 것만 목록에서 지운다 - 실패한 것만 남겨 두고 다시 등록하기를 눌러도 이미 성공한 게 두 번 저장되지 않는다.
        state.scheduleItems = scheduleResult.failed.map((f) => f.item);
        state.expenses = expenseResult.failed.map((f) => f.item);
        render();
        return showError(summarizeFailures(scheduleResult, expenseResult));
      }

      close();
      ui.showToast(
        state.createdTitle
          ? `'${state.createdTitle}' 여행을 만들었어요. (일정 ${scheduleResult.succeeded.length}개, 비용 ${expenseResult.succeeded.length}개)`
          : `가져오기를 완료했어요. (일정 ${scheduleResult.succeeded.length}개, 비용 ${expenseResult.succeeded.length}개)`
      );
      // 새로 만든 여행이든 기존 여행에 더한 거든, 결과를 보여줄 곳은 그 여행의 일정 화면이다
      router.navigate(router.buildPath("schedule", { id: tripId }));
    } finally {
      setSaving(false);
    }
  }

  function setSaving(saving) {
    els.close.disabled = saving;
    if (saving) {
      els.submit.disabled = true;
      els.submit.textContent = "저장 중...";
    } else {
      els.submit.textContent = "등록하기";
      updateSubmitState(); // mode/trip 값이 바뀌었을 수 있으니(create → append) 버튼 활성화 여부를 다시 계산한다
    }
  }

  // ---- 이벤트 ----

  // 카드는 구조(개수·순서)가 안 바뀌는 한 다시 그리지 않는다 - 글자를 고치는 즉시 state에만 반영한다.
  els.body.addEventListener("input", (e) => {
    const tripField = e.target.dataset.tripField;
    if (tripField) {
      state.trip[tripField] = e.target.value;
      return updateSubmitState();
    }
    const card = e.target.closest(".trip-import-preview-card");
    const field = e.target.dataset.field;
    if (!card || !field) return;
    const item = state[card.dataset.kind]?.[Number(card.dataset.index)];
    if (!item) return;
    item[field] = field === "amount" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value;
  });

  // 여행 시작일을 다 고르고 나면(change - 매 글자마다 다시 그려서 입력 중 포커스가 끊기지 않게 input 대신
  // 이걸 쓴다) "1일차"처럼 dayOffset만 있던 일정·비용 카드에 실제 날짜를 채운다(mode "create"일 때만 의미가
  // 있다 - append는 시작일이 이미 정해져 있어 open() 때 한 번만 계산한다).
  els.body.addEventListener("change", (e) => {
    if (e.target.dataset.tripField === "startDate" && resolveDayOffsets()) render();
  });

  // ✕: 그 카드만 배열에서 빼고 통째로 다시 그린다(나머지 카드의 data-index가 앞으로 밀리므로).
  els.body.addEventListener("click", (e) => {
    const removeBtn = e.target.closest('[data-action="remove"]');
    if (!removeBtn) return;
    const card = removeBtn.closest(".trip-import-preview-card");
    state[card.dataset.kind].splice(Number(card.dataset.index), 1);
    render();
  });

  els.close.addEventListener("click", close);
  els.submit.addEventListener("click", handleSubmit);

  // tripImport.js(입력 모달)는 이 화면을 모른다 - 여기서 스스로 이어붙인다(walletPage.js가 walletForm.init을
  // 부르는 것과 같은 방식).
  tripImport.init(open);

  window.TripLog = window.TripLog || {};
  window.TripLog.tripImportPreview = { open };
})();
