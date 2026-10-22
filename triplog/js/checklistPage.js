// @별칭 CHECKLIST · 체크리스트 화면 (#/checklist/:id)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// SHELL의 하단 탭 "체크리스트"(가계부 옆)에서 들어오는 새 화면. 가계부 화면(budgetPage.js)과 같은 구조
// (모달이 아니라 전체 화면, 고정 헤더+스크롤 목록, 카드 스와이프로 삭제)를 따르되, Day 대신 카테고리별로
// 묶는다. 카테고리는 더 이상 고정 5개가 아니라 storage.js의 checklist_categories 테이블 행(여행마다
// 따로) - 기본값은 "할 일"/"준비물" 2개(checklistCategoryData.js#DEFAULT_CHECKLIST_CATEGORIES, 여행마다
// 처음 한 번만 깔린다), 헤더 우측 상단 "+" 버튼으로 더 추가할 수 있고, 카테고리 헤더를 좌로 스와이프하면
// 확인창을 거쳐 삭제할 수 있다(삭제하면 그 안의 항목도 서버에서 cascade로 함께 지워진다).
//
// 카테고리는 각각 접고 펼 수 있고(기본값: 맨 앞 카테고리만 열림, commonPages.js의 helpSection과 같은 "열림
// 상태를 DOM에서 바로 토글, 전체 재렌더링은 안 함" 방식), 항목은 체크박스로 완료 표시, 좌우 스와이프로 삭제
// (budgetPage.js와 같은 제스처, 이 화면 전용으로 다시 구현 - "화면마다 자기 제스처를 직접 구현한다"는
// 이 저장소의 관례, budgetPage.js 상단 주석 참고), 끝의 ≡ 손잡이를 끌어 같은 카테고리 안에서 순서를
// 바꿀 수 있다(timelineDrag.js의 드래그 손잡이와 같은 원리이지만 한 카테고리 목록 안으로만 좁힌 단순
// 버전 - 자동 스크롤은 없다). 항목 제목이 길면 줄여 보이지 않고 그냥 줄바꿈된다(한 줄 고정 높이가 아니다).
//
// 데이터는 storage.js의 loadChecklistCategories/getChecklistCategories(카테고리 읽기)와
// addChecklistCategory/deleteChecklistCategory(카테고리 쓰기), loadChecklistItems/getChecklistItems(항목
// 읽기)와 addChecklistItem/updateChecklistItem/deleteChecklistItem/reorderChecklistItems(항목 쓰기)를
// 쓴다. 이 여행에 체크리스트 카테고리가 하나도 없으면(한 번도 안 열어본 여행) storage.ensureChecklistSeeded가
// 기본 카테고리·준비물을 한 번만 깔아준다 - 038_checklist.sql의 checklist_seeds 마커 테이블 설명 참고.

(function () {
  const storage = window.TripLog.storage;
  const {
    getTripById,
    loadChecklistCategories,
    getChecklistCategories,
    addChecklistCategory,
    deleteChecklistCategory,
    loadChecklistItems,
    getChecklistItems,
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    reorderChecklistItems,
    ensureChecklistSeeded,
  } = storage;
  const { escapeHtml } = window.TripLog.util;
  const ui = window.TripLog.ui;
  const router = window.TripLog.router;

  let loadRunId = 0;
  let openState = {}; // { [categoryId]: boolean } - 화면에 새로 들어올 때마다 기본값으로 다시 정한다

  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const HANDLE_ICON = icon('<path d="M4 7h16M4 12h16M4 17h16"/>');
  const CARET_ICON = icon('<path d="M6 9l6 6 6-6"/>');
  const PLUS_ICON = icon('<path d="M12 5v14M5 12h14"/>');

  function categoriesForTrip(tripId) {
    return getChecklistCategories()
      .filter((cat) => cat.tripId === tripId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function buildDefaultOpenState(categories) {
    const state = {};
    categories.forEach((cat, index) => {
      state[cat.id] = index === 0; // 맨 앞 카테고리만 기본으로 열려 있다
    });
    return state;
  }

  function itemsForTrip(tripId) {
    return getChecklistItems().filter((item) => item.tripId === tripId);
  }

  // ---- 목록 그리기 ----

  function checklistItemHtml(item) {
    return `
      <li class="checklist-item-wrap" data-id="${escapeHtml(item.id)}">
        <div class="checklist-item-delete-bg" aria-hidden="true"><span>삭제</span></div>
        <label class="checklist-item${item.checked ? " checklist-item--checked" : ""}" data-id="${escapeHtml(item.id)}">
          <input type="checkbox" class="checklist-item-checkbox" data-action="toggle-item" data-id="${escapeHtml(item.id)}" ${item.checked ? "checked" : ""} />
          <span class="checklist-item-title">${escapeHtml(item.title)}</span>
          <button type="button" class="checklist-item-handle" aria-label="끌어서 순서 바꾸기" tabindex="-1">${HANDLE_ICON}</button>
        </label>
      </li>`;
  }

  // 카테고리 헤더만 감싸는 별도 wrap(.checklist-category-header-wrap) - 스와이프로 미는 대상을 헤더 버튼
  // 하나로 좁혀서 (1) 삭제 배경이 헤더 높이만큼만 보이게 하고(본문이 열려 길어도 삭제 배경이 카드 전체
  // 높이로 늘어나지 않는다) (2) 포인터 캡처를 실제 누른 버튼 자신에게 걸어 클릭 이벤트가 그 조상(section)
  // 으로 다시 타겟팅되는 브라우저 동작 때문에 열기/닫기 클릭이 먹통되는 문제를 피한다.
  function categorySectionHtml(cat, items) {
    const open = Boolean(openState[cat.id]);
    const checkedCount = items.filter((item) => item.checked).length;
    return `
      <section class="checklist-category" data-category-id="${escapeHtml(cat.id)}">
        <div class="checklist-category-header-wrap" data-id="${escapeHtml(cat.id)}">
          <div class="checklist-category-delete-bg" aria-hidden="true"><span>삭제</span></div>
          <button type="button" class="checklist-category-header" data-action="toggle-category" data-category-id="${escapeHtml(cat.id)}" aria-expanded="${open}" aria-controls="checklist-body-${escapeHtml(cat.id)}">
            <span class="checklist-category-title">${escapeHtml(cat.label)}</span>
            <span class="checklist-category-count">${checkedCount}/${items.length}</span>
            <span class="checklist-category-caret" aria-hidden="true">${CARET_ICON}</span>
          </button>
        </div>
        <div class="checklist-category-body" id="checklist-body-${escapeHtml(cat.id)}"${open ? "" : " hidden"}>
          ${items.length ? `<ul class="checklist-list">${items.map(checklistItemHtml).join("")}</ul>` : `<p class="checklist-empty">아직 담은 항목이 없어요.</p>`}
          <button type="button" class="checklist-add-btn" data-action="add-item" data-category-id="${escapeHtml(cat.id)}">+ 추가하기</button>
        </div>
      </section>`;
  }

  function renderList(el, trip, loading) {
    const listEl = el.querySelector("[data-checklist-list]");
    if (loading) {
      listEl.innerHTML = `<p class="checklist-loading">체크리스트를 불러오는 중이에요...</p>`;
      return;
    }
    const categories = categoriesForTrip(trip.id);
    const items = itemsForTrip(trip.id);
    listEl.innerHTML = categories.length
      ? categories.map((cat) => categorySectionHtml(cat, items.filter((item) => item.categoryId === cat.id))).join("")
      : `<p class="checklist-empty">아직 카테고리가 없어요. 오른쪽 위 + 버튼으로 추가해보세요.</p>`;
  }

  // 지금 화면에 체크리스트 화면이 보이고 있으면 캐시 기준으로 다시 그린다 - budgetPage.js#refreshVisible과 같은 방식.
  function refreshVisible() {
    const el = document.querySelector('[data-page="checklist"]');
    if (!el || el.hidden) return;
    const trip = getTripById(el.dataset.tripId);
    if (trip) renderList(el, trip, false);
  }

  // ---- 완료 체크 토글 ----

  async function toggleChecked(id, checked) {
    try {
      await updateChecklistItem(id, { checked });
    } catch (err) {
      ui.showToast(err.message);
    } finally {
      refreshVisible();
    }
  }

  // ---- 항목 추가 창 ----

  let addOverlay = null;
  let addTargetCategoryId = null;
  let adding = false;

  function ensureAddOverlay() {
    if (addOverlay) return;
    addOverlay = document.createElement("div");
    addOverlay.className = "modal-overlay";
    addOverlay.dataset.alias = "CHECKLIST-ADD-ITEM · 체크리스트 항목 추가 창";
    addOverlay.hidden = true;
    addOverlay.innerHTML = `
      <div class="modal modal-confirm checklist-add-modal" role="dialog" aria-modal="true" aria-labelledby="checklist-add-title">
        <h2 class="modal-title" id="checklist-add-title">항목 추가</h2>
        <input type="text" class="search-input" id="checklist-add-input" maxlength="40" placeholder="예: 우산" autocomplete="off" />
        <p class="form-error" id="checklist-add-error" hidden></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="checklist-add-cancel">취소</button>
            <button type="button" class="btn btn-save" data-action="checklist-add-save">추가</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(addOverlay);

    addOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="checklist-add-cancel"]')) closeAddOverlay();
      else if (e.target.closest('[data-action="checklist-add-save"]')) submitAddItem();
    });
    addOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAddOverlay();
      // 입력칸에서 누른 Enter만 추가로 본다 - 취소/추가 버튼에 포커스가 있을 때 누르면 그 버튼의 자기
      // 클릭으로만 처리되게 둔다(안 그러면 "취소" 버튼에서 Enter를 눌러도 추가가 같이 실행된다).
      else if (e.key === "Enter" && e.target.id === "checklist-add-input") submitAddItem();
    });
  }

  function openAddOverlay(categoryId) {
    ensureAddOverlay();
    addTargetCategoryId = categoryId;
    const input = addOverlay.querySelector("#checklist-add-input");
    input.value = "";
    addOverlay.querySelector("#checklist-add-error").hidden = true;
    addOverlay.hidden = false;
    input.focus();
  }

  function closeAddOverlay() {
    if (addOverlay) addOverlay.hidden = true;
    addTargetCategoryId = null;
  }

  async function submitAddItem() {
    if (adding || !addTargetCategoryId) return;
    const el = document.querySelector('[data-page="checklist"]');
    const trip = el ? getTripById(el.dataset.tripId) : null;
    if (!trip) return closeAddOverlay();

    const input = addOverlay.querySelector("#checklist-add-input");
    const errorEl = addOverlay.querySelector("#checklist-add-error");
    const title = input.value.trim();
    if (!title) {
      errorEl.textContent = "이름을 입력해주세요.";
      errorEl.hidden = false;
      return;
    }

    adding = true;
    try {
      await addChecklistItem({ tripId: trip.id, categoryId: addTargetCategoryId, title });
      closeAddOverlay();
      refreshVisible();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      adding = false;
    }
  }

  // ---- 카테고리 추가 창 (헤더 우측 상단 "+" 버튼) ----

  let addCategoryOverlay = null;
  let addingCategory = false;

  function ensureAddCategoryOverlay() {
    if (addCategoryOverlay) return;
    addCategoryOverlay = document.createElement("div");
    addCategoryOverlay.className = "modal-overlay";
    addCategoryOverlay.dataset.alias = "CHECKLIST-ADD-CATEGORY · 체크리스트 카테고리 추가 창";
    addCategoryOverlay.hidden = true;
    addCategoryOverlay.innerHTML = `
      <div class="modal modal-confirm checklist-add-modal" role="dialog" aria-modal="true" aria-labelledby="checklist-category-add-title">
        <h2 class="modal-title" id="checklist-category-add-title">카테고리 추가</h2>
        <input type="text" class="search-input" id="checklist-category-add-input" maxlength="20" placeholder="예: 쇼핑 리스트" autocomplete="off" />
        <p class="form-error" id="checklist-category-add-error" hidden></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="checklist-category-add-cancel">취소</button>
            <button type="button" class="btn btn-save" data-action="checklist-category-add-save">추가</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(addCategoryOverlay);

    addCategoryOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="checklist-category-add-cancel"]')) closeAddCategoryOverlay();
      else if (e.target.closest('[data-action="checklist-category-add-save"]')) submitAddCategory();
    });
    addCategoryOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAddCategoryOverlay();
      else if (e.key === "Enter" && e.target.id === "checklist-category-add-input") submitAddCategory();
    });
  }

  function openAddCategoryOverlay() {
    ensureAddCategoryOverlay();
    const input = addCategoryOverlay.querySelector("#checklist-category-add-input");
    input.value = "";
    addCategoryOverlay.querySelector("#checklist-category-add-error").hidden = true;
    addCategoryOverlay.hidden = false;
    input.focus();
  }

  function closeAddCategoryOverlay() {
    if (addCategoryOverlay) addCategoryOverlay.hidden = true;
  }

  async function submitAddCategory() {
    if (addingCategory) return;
    const el = document.querySelector('[data-page="checklist"]');
    const trip = el ? getTripById(el.dataset.tripId) : null;
    if (!trip) return closeAddCategoryOverlay();

    const input = addCategoryOverlay.querySelector("#checklist-category-add-input");
    const errorEl = addCategoryOverlay.querySelector("#checklist-category-add-error");
    const label = input.value.trim();
    if (!label) {
      errorEl.textContent = "이름을 입력해주세요.";
      errorEl.hidden = false;
      return;
    }

    addingCategory = true;
    try {
      const category = await addChecklistCategory({ tripId: trip.id, label });
      openState[category.id] = true; // 새로 만든 카테고리는 바로 열어서 보여준다
      closeAddCategoryOverlay();
      refreshVisible();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      addingCategory = false;
    }
  }

  // ---- 카테고리 삭제 확인창 (헤더 스와이프, mainPage.js의 여행 카드 스와이프 삭제 확인창과 같은 패턴) ----

  const CATEGORY_SWIPE_REVEAL_PX = 84; // 확인창이 뜨는 동안 카드가 멈춰 있을 자리(삭제 글자가 드러날 만큼)

  let categoryDeleteOverlay = null;
  let categoryDeleteTarget = null; // { id, card } - 취소하면 card를 제자리로 되돌린다
  let categoryDeleting = false;

  function ensureCategoryDeleteOverlay() {
    if (categoryDeleteOverlay) return;
    categoryDeleteOverlay = document.createElement("div");
    categoryDeleteOverlay.className = "modal-overlay";
    categoryDeleteOverlay.dataset.alias = "CHECKLIST-CATEGORY-DELETE-CONFIRM · 카테고리 스와이프 삭제 확인창";
    categoryDeleteOverlay.hidden = true;
    categoryDeleteOverlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="checklist-category-delete-title">
        <h2 class="modal-title" id="checklist-category-delete-title">정말 삭제하시겠습니까?</h2>
        <p class="trip-exit-note" data-note></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
            <button type="button" class="btn btn-danger" data-action="ok">삭제</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(categoryDeleteOverlay);

    categoryDeleteOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="cancel"]')) closeCategoryDeleteOverlay();
      else if (e.target.closest('[data-action="ok"]')) performCategoryDelete();
    });
    categoryDeleteOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCategoryDeleteOverlay();
    });
  }

  function openCategoryDeleteConfirm(id, card) {
    ensureCategoryDeleteOverlay();
    categoryDeleteTarget = { id, card };
    const category = getChecklistCategories().find((cat) => cat.id === id);
    const label = category?.label || "카테고리";
    categoryDeleteOverlay.querySelector("[data-note]").textContent = `'${label}' 카테고리와 그 안의 모든 항목이 함께 삭제돼요. 되돌릴 수 없어요.`;
    categoryDeleteOverlay.hidden = false;
    categoryDeleteOverlay.querySelector('[data-action="cancel"]').focus();
  }

  // 취소(또는 Esc)로 닫을 때만 카드를 제자리로 되돌린다 - 삭제 성공 후에는 목록이 통째로 다시 그려져서
  // card가 이미 화면에서 떨어져 나간 뒤라 되돌릴 대상이 없다(performCategoryDelete에서 직접 처리).
  function closeCategoryDeleteOverlay() {
    if (categoryDeleteOverlay) categoryDeleteOverlay.hidden = true;
    if (categoryDeleting) return;
    if (categoryDeleteTarget) snapBack(categoryDeleteTarget.card);
    categoryDeleteTarget = null;
  }

  async function performCategoryDelete() {
    if (!categoryDeleteTarget || categoryDeleting) return;
    const { id } = categoryDeleteTarget;
    const okBtn = categoryDeleteOverlay.querySelector('[data-action="ok"]');
    categoryDeleting = true;
    okBtn.disabled = true;
    okBtn.textContent = "삭제 중...";
    try {
      await deleteChecklistCategory(id);
    } catch (err) {
      ui.showToast(err.message);
      categoryDeleting = false;
      okBtn.disabled = false;
      okBtn.textContent = "삭제";
      return; // 모달은 열어 둔다 - 실패해도 다시 시도할 수 있게
    }
    categoryDeleting = false;
    categoryDeleteOverlay.hidden = true;
    delete openState[id];
    categoryDeleteTarget = null;
    refreshVisible();
  }

  // ---- 항목/카테고리 카드 스와이프 삭제 · 손잡이로 순서 바꾸기 ----
  // budgetPage.js의 스와이프 삭제, timelineDrag.js의 드래그 손잡이를 이 화면용으로 다시 구현한 것(한
  // 카테고리 목록 안에서만 순서를 바꾸는 단순화된 버전 - 카테고리를 넘나드는 이동, 자동 스크롤은 없다).
  // 카테고리 헤더를 스와이프하면(gesture.kind === "category") 항목과 달리 끝까지 밀어도 바로 지워지지
  // 않고 mainPage.js의 여행 카드 스와이프와 같은 방식으로 확인창을 띄운다 - 카테고리는 그 안의 항목까지
  // 통째로 사라지는, 되돌릴 수 없는 더 무거운 동작이라서다.

  const SWIPE_START_PX = 10;
  const SWIPE_DELETE_RATIO = 0.5;

  let gesture = null; // { pointerId, wrap, card, capTarget, id, startX, startY, mode, kind: "item"|"category", confirming? }

  function suppressNextClick(card) {
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      card.removeEventListener("click", handler, true);
    };
    card.addEventListener("click", handler, true);
  }

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (gesture) return;

    const handle = e.target.closest(".checklist-item-handle");
    if (handle) {
      const wrap = handle.closest(".checklist-item-wrap");
      if (!wrap) return;
      e.preventDefault();
      beginGesture(wrap, e, "dragging", "item", null, handle);
      startDrag();
      return;
    }

    const itemWrap = e.target.closest(".checklist-item-wrap");
    if (itemWrap) {
      beginGesture(itemWrap, e, "pending-swipe", "item");
      return;
    }

    const categoryHeader = e.target.closest(".checklist-category-header");
    if (categoryHeader) {
      const wrap = categoryHeader.closest(".checklist-category-header-wrap");
      if (!wrap) return;
      // card(미는 대상)와 capTarget(포인터 캡처 대상)을 모두 헤더 버튼 자신으로 둔다 - 캡처를 그 조상
      // (card가 섹션 전체였을 때)에 걸면 release 시 click 이벤트가 그 조상으로 다시 타겟팅되어, 클릭
      // 위임 핸들러의 closest('[data-action="toggle-category"]')가 못 찾는 버그가 있었다.
      beginGesture(wrap, e, "pending-swipe", "category", categoryHeader);
    }
  }

  function beginGesture(wrap, e, mode, kind, cardOverride, capTargetOverride) {
    const card = cardOverride || wrap.querySelector(".checklist-item");
    const capTarget = capTargetOverride || card;
    gesture = { pointerId: e.pointerId, wrap, card, capTarget, id: wrap.dataset.id, startX: e.clientX, startY: e.clientY, mode, kind };
    try {
      capTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 이미 풀렸거나 못 잡는 환경이면 무시 - 아래 리스너는 document에 걸려 있어 상관없다 */
    }
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  }

  function handlePointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    if (gesture.confirming) return; // 카테고리 삭제 확인창이 뜬 다음엔 손가락이 더 움직여도 무시한다
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (gesture.mode === "pending-swipe") {
      if (Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy)) startSwipe();
      return;
    }
    if (gesture.mode === "swiping") {
      e.preventDefault();
      updateSwipe(dx);
      return;
    }
    if (gesture.mode === "dragging") {
      e.preventDefault();
      updateDrag(e.clientY);
    }
  }

  function handlePointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    if (gesture.mode === "swiping") finishSwipe();
    else if (gesture.mode === "dragging") finishDrag();
    cleanup();
  }

  function handlePointerCancel(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    if (gesture.mode === "swiping" && !gesture.confirming) snapBack(gesture.card);
    else if (gesture.mode === "dragging") cancelDrag();
    cleanup();
  }

  function cleanup() {
    if (!gesture) return;
    const { capTarget, pointerId } = gesture;
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
    try {
      capTarget.releasePointerCapture(pointerId);
    } catch (err) {
      /* 이미 풀렸으면 무시 */
    }
    gesture = null;
  }

  // 화면을 벗어날 때(router.onLeave) 진행 중인 제스처를 강제로 끝낸다 - timelineDrag.js#cancel과 같은 이유.
  function cancelGesture() {
    if (!gesture) return;
    if (gesture.mode === "swiping" && !gesture.confirming) snapBack(gesture.card);
    else if (gesture.mode === "dragging") cancelDrag();
    cleanup();
  }

  // ---- 스와이프 삭제 (항목은 바로 삭제, 카테고리는 확인창) ----

  function startSwipe() {
    gesture.mode = "swiping";
    gesture.cardWidth = gesture.wrap.getBoundingClientRect().width;
    suppressNextClick(gesture.card);
  }

  function currentTransformX(card) {
    return card.style.transform ? parseFloat(card.style.transform.replace(/[^-\d.]/g, "")) || 0 : 0;
  }

  function updateSwipe(dx) {
    const x = Math.min(0, dx);
    gesture.card.style.transform = `translateX(${x}px)`;
    if (!gesture.cardWidth || Math.abs(x) < gesture.cardWidth * SWIPE_DELETE_RATIO) return;
    if (gesture.kind === "category") confirmCategorySwipeDelete();
    else commitSwipeDelete();
  }

  function finishSwipe() {
    if (gesture.kind === "category") {
      if (gesture.confirming) return; // 이미 확인창을 띄웠다
      const x = currentTransformX(gesture.card);
      if (gesture.cardWidth && Math.abs(x) >= gesture.cardWidth * SWIPE_DELETE_RATIO) confirmCategorySwipeDelete();
      else snapBack(gesture.card);
      return;
    }
    if (gesture.deleted) return;
    const x = currentTransformX(gesture.card);
    if (gesture.cardWidth && Math.abs(x) >= gesture.cardWidth * SWIPE_DELETE_RATIO) commitSwipeDelete();
    else snapBack(gesture.card);
  }

  function snapBack(card) {
    card.style.transition = "transform 0.2s ease";
    card.style.transform = "";
    setTimeout(() => {
      card.style.transition = "";
    }, 220);
  }

  function commitSwipeDelete() {
    if (gesture.deleted) return;
    gesture.deleted = true;
    const { wrap, card, id } = gesture;
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
    setTimeout(() => deleteItemById(id), 240);
  }

  async function deleteItemById(id) {
    try {
      await deleteChecklistItem(id);
    } catch (err) {
      ui.showToast(err.message);
    } finally {
      refreshVisible();
    }
  }

  // 카테고리는 끝까지 밀어도 바로 안 지우고, 삭제 글자가 드러나는 자리에서 멈춘 채 확인창을 띄운다
  // (mainPage.js의 여행 카드 스와이프 삭제 확인창과 같은 패턴).
  function confirmCategorySwipeDelete() {
    if (gesture.confirming) return;
    gesture.confirming = true;
    const { card, id } = gesture;
    card.style.transition = "transform 0.15s ease";
    card.style.transform = `translateX(-${CATEGORY_SWIPE_REVEAL_PX}px)`;
    openCategoryDeleteConfirm(id, card);
  }

  // ---- 손잡이로 순서 바꾸기(같은 카테고리 목록 안에서만) ----

  const FLIP_MS = 180;

  function startDrag() {
    const { wrap, card } = gesture;
    suppressNextClick(card);
    const listEl = wrap.closest(".checklist-list");
    const rect = wrap.getBoundingClientRect();

    gesture.listEl = listEl;
    gesture.originalNextSibling = wrap.nextSibling;

    const placeholder = document.createElement("li");
    placeholder.className = "checklist-item-wrap-placeholder";
    placeholder.style.height = `${rect.height}px`;
    wrap.parentNode.insertBefore(placeholder, wrap);
    gesture.placeholder = placeholder;

    gesture.dragStartTop = rect.top;
    gesture.dragStartClientY = gesture.startY;

    wrap.classList.add("is-dragging");
    wrap.style.position = "fixed";
    wrap.style.left = `${rect.left}px`;
    wrap.style.top = `${rect.top}px`;
    wrap.style.width = `${rect.width}px`;
    wrap.style.touchAction = "none";
    listEl?.classList.add("checklist-list--reordering");
  }

  function updateDrag(clientY) {
    const newTop = gesture.dragStartTop + (clientY - gesture.dragStartClientY);
    gesture.wrap.style.top = `${newTop}px`;
    if (!gesture.listEl) return;
    const floatCenter = newTop + gesture.wrap.getBoundingClientRect().height / 2;
    reorderPlaceholder(floatCenter);
  }

  function reorderPlaceholder(floatCenter) {
    const { listEl, wrap, placeholder } = gesture;
    const siblings = [...listEl.querySelectorAll(".checklist-item-wrap")].filter((el) => el !== wrap);
    let target = null;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (floatCenter < r.top + r.height / 2) {
        target = sib;
        break;
      }
    }

    const currentNext = placeholder.nextElementSibling;
    const wantsBeforeTarget = target ? target !== currentNext : Boolean(currentNext);
    if (!wantsBeforeTarget) return;

    const firstRects = new Map(siblings.map((el) => [el, el.getBoundingClientRect()]));
    if (target) listEl.insertBefore(placeholder, target);
    else listEl.appendChild(placeholder);

    for (const sib of siblings) {
      const first = firstRects.get(sib);
      const last = sib.getBoundingClientRect();
      const deltaY = first.top - last.top;
      if (!deltaY) continue;
      sib.style.transition = "none";
      sib.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        sib.style.transition = `transform ${FLIP_MS}ms ease`;
        sib.style.transform = "";
      });
    }
  }

  function resetWrapVisuals(wrap) {
    wrap.classList.remove("is-dragging");
    wrap.style.position = "";
    wrap.style.left = "";
    wrap.style.top = "";
    wrap.style.width = "";
    wrap.style.touchAction = "";
  }

  function revertToOriginalPosition() {
    const { wrap, placeholder, originalNextSibling, listEl } = gesture;
    placeholder?.remove();
    if (listEl?.isConnected) {
      if (originalNextSibling && originalNextSibling.parentNode === listEl) listEl.insertBefore(wrap, originalNextSibling);
      else listEl.appendChild(wrap);
    }
    resetWrapVisuals(wrap);
  }

  function cancelDrag() {
    gesture.listEl?.classList.remove("checklist-list--reordering");
    revertToOriginalPosition();
  }

  function finishDrag() {
    const { wrap, listEl, placeholder } = gesture;
    listEl?.classList.remove("checklist-list--reordering");

    const isValid = Boolean(listEl) && placeholder?.parentNode === listEl && listEl.isConnected;
    if (!isValid) {
      revertToOriginalPosition();
      return;
    }

    placeholder.parentNode.insertBefore(wrap, placeholder);
    placeholder.remove();
    resetWrapVisuals(wrap);

    const orderedIds = [...listEl.querySelectorAll(".checklist-item-wrap")].map((el) => el.dataset.id);
    commitReorder(orderedIds);
  }

  async function commitReorder(orderedIds) {
    try {
      await reorderChecklistItems(orderedIds);
    } catch (err) {
      ui.showToast(err.message);
    } finally {
      refreshVisible();
    }
  }

  // ---- 화면 ----

  async function render(el, { params }) {
    const trip = getTripById(params.id);
    if (!trip) return; // 가드가 이미 걸러내므로 여기까지 오지 않는다
    el.dataset.tripId = trip.id;
    const runId = ++loadRunId;
    openState = buildDefaultOpenState(categoriesForTrip(trip.id)); // 화면에 새로 들어올 때마다 "맨 앞 카테고리만 열림"으로 다시 시작한다

    el.innerHTML = `
      <div class="checklist-shell">
        <header class="checklist-header">
          <div class="checklist-header-row">
            <div class="checklist-header-text">
              <h1 class="checklist-title">체크리스트</h1>
              <p class="checklist-subtitle">${escapeHtml(trip.title || trip.destination || "")}</p>
            </div>
            <button type="button" class="checklist-category-add-btn" data-action="add-category" aria-label="카테고리 추가">${PLUS_ICON}</button>
          </div>
        </header>
        <div class="checklist-scroll" data-checklist-list></div>
      </div>`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("pointerdown", handlePointerDown);
      el.addEventListener("change", (e) => {
        const checkbox = e.target.closest('[data-action="toggle-item"]');
        if (checkbox) toggleChecked(checkbox.dataset.id, checkbox.checked);
      });
      el.addEventListener("click", (e) => {
        const addCategoryBtn = e.target.closest('[data-action="add-category"]');
        if (addCategoryBtn) return openAddCategoryOverlay();

        const toggleBtn = e.target.closest('[data-action="toggle-category"]');
        if (toggleBtn) {
          const key = toggleBtn.dataset.categoryId;
          openState[key] = !openState[key];
          toggleBtn.setAttribute("aria-expanded", String(openState[key]));
          const body = document.getElementById(toggleBtn.getAttribute("aria-controls"));
          if (body) body.hidden = !openState[key];
          return;
        }
        const addBtn = e.target.closest('[data-action="add-item"]');
        if (addBtn) openAddOverlay(addBtn.dataset.categoryId);
      });
    }

    // 처음 보는 여행이면 "불러오는 중" 문구를 먼저 보여주고, 받아 둔 적 있으면 캐시로 먼저 그린 뒤 새로 고친다
    const alreadyLoaded = storage.isChecklistCategoriesLoaded(trip.id) && storage.isChecklistLoaded(trip.id);
    renderList(el, trip, !alreadyLoaded);

    try {
      await Promise.all([loadChecklistCategories(trip.id), loadChecklistItems(trip.id)]);
      if (runId === loadRunId && categoriesForTrip(trip.id).length === 0 && itemsForTrip(trip.id).length === 0) {
        await ensureChecklistSeeded(trip.id);
      }
    } catch (err) {
      if (runId === loadRunId) ui.showToast(err.message);
    }
    if (runId !== loadRunId || el.dataset.tripId !== trip.id) return; // 그 사이에 떠났거나 다른 여행으로 옮겼다
    openState = { ...buildDefaultOpenState(categoriesForTrip(trip.id)), ...openState }; // 새로 시딩된 카테고리의 기본 열림 상태를 채운다(이미 정해둔 건 그대로)
    renderList(el, trip, false);
  }

  router.definePage("checklist", render);
  router.onLeave("checklist", () => {
    cancelGesture();
    closeAddOverlay();
    closeAddCategoryOverlay();
    closeCategoryDeleteOverlay();
  });

  window.TripLog = window.TripLog || {};
  window.TripLog.checklistPage = {};
})();
