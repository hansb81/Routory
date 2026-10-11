// @별칭 TIMELINE-DRAG · 타임라인 카드 드래그 핸들로 순서 바꾸기(다른 Day로도) · 스와이프해서 삭제하기
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 일반 일정 카드(장소·메모, `.timeline-item[data-plain="1"]`)에서만 동작한다. 항공편(출발시간순)과
// 숙소(항상 맨 아래)는 자체 정렬 규칙이 있고 각자의 삭제 방법(항공편 상세 화면, 숙소는 수정 폼의 삭제
// 버튼)이 이미 있어서 대상이 아니다 - app.js#renderItemCard가 그 두 종류만 `.timeline-item-wrap`으로
// 감싸지 않고 data-plain도 "0"으로 둔다.
//
// 두 제스처는 완전히 다른 입력에서 시작해서 서로 헷갈릴 일이 없다:
//   - 순서 바꾸기: 카드 오른쪽 끝의 드래그 핸들(.item-drag-handle, 3줄 아이콘)을 누르면 곧바로 시작된다
//     (길게 누르기 없음). 세로로 옮기면 같은 Day 안에서 순서가 바뀌고, 다른 Day의 칸까지 넘어가면 그
//     Day로 옮겨진다(일정이 없는 Day도 점선 칸으로 표시돼 놓을 수 있다).
//   - 스와이프 삭제: 카드 몸통(핸들 제외)을 가로로 밀면 시작된다.
// 실제 서버 저장(순서/날짜 반영, 삭제)은 app.js가 넘겨준 onReorder/onDelete 콜백이 맡는다 - 이 파일은
// 화면 위에서 카드를 옮기고 스와이프를 보여주는 제스처 인식·연출만 담당한다.

(function () {
  const SWIPE_START_PX = 10; // 이만큼 가로로 움직이면 스와이프 삭제로 확정한다
  const SWIPE_DELETE_RATIO = 0.5; // 카드 너비의 이 비율 이상 스와이프하면 자동 삭제
  const FLIP_MS = 180;
  const AUTO_SCROLL_EDGE_PX = 64; // 화면 위/아래 이 안쪽으로 들어오면 자동 스크롤을 시작한다
  const AUTO_SCROLL_MAX_PX = 16; // 자동 스크롤 프레임당 최대 픽셀(가장자리에 딱 붙었을 때)

  let onReorder = () => {};
  let onDelete = () => {};
  let timelineEl = null;

  // 지금 진행 중인 제스처의 상태 (없으면 null). 한 번에 하나의 포인터만 다룬다.
  let g = null;

  function init(el, handlers) {
    timelineEl = el;
    onReorder = handlers?.onReorder ?? (() => {});
    onDelete = handlers?.onDelete ?? (() => {});
    timelineEl.addEventListener("pointerdown", handlePointerDown);
  }

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // 마우스 왼쪽 버튼(또는 터치/펜)만
    if (g) return; // 이미 다른 포인터를 다루는 중

    const handle = e.target.closest(".item-drag-handle");
    if (handle) {
      const card = handle.closest('.timeline-item[data-plain="1"]');
      if (!card) return;
      e.preventDefault(); // 버튼의 기본 포커스/스크롤 동작을 막는다 - 여기서부터는 전부 우리가 다룬다
      beginGesture(card, e, "dragging");
      startDrag();
      return;
    }

    const card = e.target.closest('.timeline-item[data-plain="1"]');
    if (!card) return;
    beginGesture(card, e, "pending-swipe");
  }

  function beginGesture(card, e, mode) {
    const wrap = card.closest(".timeline-item-wrap");
    g = {
      pointerId: e.pointerId,
      card,
      wrap,
      id: card.dataset.id,
      startX: e.clientX,
      startY: e.clientY,
      mode,
    };
    const capTarget = e.target.closest(".item-drag-handle") || card;
    g.capTarget = capTarget;
    try {
      capTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 이미 풀렸거나 이 포인터를 못 잡는 환경이면 무시 - 아래 리스너는 document에 걸려 있어 상관없다 */
    }
    // move/up/cancel을 capTarget이 아니라 document에 건다 - setPointerCapture는 일부 모바일 웹뷰에서
    // wrap을 다른 Day 칸으로 appendChild할 때처럼 예상 못한 순간에 스스로 풀릴 수 있는데, 그러면 이후
    // 이벤트가 capTarget으로 오지 않을 수 있다. document 리스너는 캡처 여부와 무관하게(이벤트가 어디로
    // 튀든 document까지는 버블링된다) pointerId만 맞으면 항상 받히므로, 캡처가 깨져도 제스처가 끊기지
    // 않는다 - 이게 깨지면 g가 영영 안 지워져 다음 제스처가 전부 씹히는(핸들을 눌러도 반응 없는) 상태가 된다.
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    // 그래도 혹시 이후로 어떤 포인터 이벤트도 다시 오지 않는 경우(예: 드래그 도중 앱이 백그라운드로 밀려나
    // OS가 터치 시퀀스를 통째로 삼키는 경우)에 대비해, 화면이 숨겨지면 지금까지 옮긴 자리로 마무리해 둔다.
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function handlePointerMove(e) {
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.mode === "pending-swipe") {
      if (Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy)) startSwipe();
      return; // 세로로 조금 움직이는 것 정도는 그냥 스크롤이 되게 둔다(아무 것도 안 막는다)
    }

    if (g.mode === "swiping") {
      e.preventDefault();
      updateSwipe(dx);
      return;
    }

    if (g.mode === "dragging") {
      e.preventDefault();
      updateDrag(e.clientY);
    }
  }

  function handlePointerUp(e) {
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.mode === "swiping") finishSwipe();
    else if (g.mode === "dragging") finishDrag();
    cleanup();
  }

  function handlePointerCancel(e) {
    if (!g || e.pointerId !== g.pointerId) return;
    // 드래그 도중 pointercancel은 생각보다 흔하게 온다(예: 모바일에서 브라우저가 제스처를 잠깐 재해석할 때) -
    // 매번 잡기 전 원래 자리로 확 되돌리면 손 밑에서 카드가 튀는 것처럼 느껴져 오히려 부자연스럽다. 지금까지
    // 옮겨 놓은 자리를 그대로 인정하고(finishDrag), DOM이 실제로 망가진 경우에만 finishDrag 내부의 검증이
    // 원위치로 되돌린다 - "이상한 위치"는 그렇게 실제로 깨진 상태만 가리키게 좁혔다.
    if (g.mode === "swiping") snapSwipeBack();
    else if (g.mode === "dragging") finishDrag();
    cleanup();
  }

  function handleVisibilityChange() {
    if (!g || !document.hidden) return;
    if (g.mode === "swiping") snapSwipeBack();
    else if (g.mode === "dragging") finishDrag();
    cleanup();
  }

  function cleanup() {
    if (!g) return;
    const { capTarget } = g;
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    try {
      capTarget.releasePointerCapture(g.pointerId);
    } catch (err) {
      /* 이미 풀렸으면 무시 */
    }
    g = null;
  }

  // 진행 중인 제스처를 밖에서(예: 일정 화면을 벗어날 때) 강제로 끝낸다. 드래그는 원위치로 되돌린다.
  function cancel() {
    if (!g) return;
    if (g.mode === "swiping") snapSwipeBack();
    else if (g.mode === "dragging") cancelDrag();
    cleanup();
  }

  // 마우스는 눌렀던 자리에서 떼면(움직인 거리와 무관하게) 브라우저가 click을 그대로 발생시킨다 - 스와이프나
  // 드래그를 마친 바로 다음에 카드가 열리는 것을 막기 위해, 그 다음 click 한 번만 가로채 무시한다.
  function suppressNextClick(card) {
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      card.removeEventListener("click", handler, true);
    };
    card.addEventListener("click", handler, true);
  }

  // ---- 스와이프 삭제 ----

  function startSwipe() {
    g.mode = "swiping";
    g.card.classList.add("is-swiping");
    g.cardWidth = g.wrap.getBoundingClientRect().width;
    suppressNextClick(g.card);
  }

  function updateSwipe(dx) {
    const x = Math.min(0, dx); // 오른쪽으로는 못 밀리게(왼쪽으로 스와이프해야 삭제 박스가 드러난다)
    g.card.style.transform = `translateX(${x}px)`;
    if (g.cardWidth && Math.abs(x) >= g.cardWidth * SWIPE_DELETE_RATIO) {
      commitDelete();
    }
  }

  function finishSwipe() {
    if (g.deleted) return; // updateSwipe 도중 이미 반 이상 넘어가 지워졌다
    const x = g.card.style.transform ? parseFloat(g.card.style.transform.replace(/[^-\d.]/g, "")) || 0 : 0;
    if (g.cardWidth && Math.abs(x) >= g.cardWidth * SWIPE_DELETE_RATIO) commitDelete();
    else snapSwipeBack();
  }

  function snapSwipeBack() {
    g.card.style.transition = "transform 0.2s ease";
    g.card.style.transform = "";
    g.card.classList.remove("is-swiping");
    const card = g.card;
    setTimeout(() => {
      card.style.transition = "";
    }, 220);
  }

  function commitDelete() {
    if (g.deleted) return;
    g.deleted = true;
    // g는 pointerup 직후 cleanup()이 즉시 null로 되돌리는 모듈 변수라, requestAnimationFrame/setTimeout
    // 콜백이 나중에 실행될 때 g.card 등을 다시 읽으면 이미 null일 수 있다 - 그 전에 지역 변수로 떼어 둔다.
    const { wrap, card, id } = g;
    wrap.classList.add("is-deleting");
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
    setTimeout(() => onDelete(id), 240);
  }

  // ---- 순서 바꾸기(드래그 핸들) ----

  function startDrag() {
    const { wrap, card } = g;
    suppressNextClick(card);

    const dayContainer = wrap.closest(".date-items");
    const rect = wrap.getBoundingClientRect();

    // 취소되거나 이상한 상태로 끝났을 때 되돌아갈 "원래 자리" - placeholder를 끼워 넣기 전, wrap이 아직
    // 원래 흐름 안에 있을 때의 부모/다음-형제를 잡아 둔다(placeholder 위치는 드래그 중 Day를 넘나들며 계속
    // 바뀌므로 되돌아갈 기준으로 쓸 수 없다).
    g.originalParent = wrap.parentNode;
    g.originalNextSibling = wrap.nextSibling;

    const placeholder = document.createElement("div");
    placeholder.className = "timeline-item-wrap-placeholder";
    placeholder.style.height = `${rect.height}px`;
    wrap.parentNode.insertBefore(placeholder, wrap);

    g.dayContainer = dayContainer;
    g.originalDate = dayContainer?.dataset.date ?? null;
    g.placeholder = placeholder;
    g.dragStartTop = rect.top;
    g.dragStartClientY = g.startY;
    g.lastClientY = g.startY;
    g.autoScrollSpeed = 0;
    g.autoScrollTimer = null;

    wrap.classList.add("is-dragging");
    wrap.style.position = "fixed";
    wrap.style.left = `${rect.left}px`;
    wrap.style.top = `${rect.top}px`;
    wrap.style.width = `${rect.width}px`;
    wrap.style.touchAction = "none";

    timelineEl.classList.add("is-reordering");
    dayContainer?.classList.add("date-items--drop-target");

    // 드래그 중엔 세로 스크롤이 오직 아래 자동 스크롤(가장자리 접근)로만 일어나야 한다 - 마우스 휠이나 다른
    // 손가락으로 페이지가 따로 스크롤되면, position:fixed인 카드는 화면에 그대로 떠 있는데 Day 칸들만 밑에서
    // 움직여 "멈추고 떠 있는" 것처럼 보이고(다음 pointermove가 와야만 다시 맞아떨어진다), 모바일에서는 그
    // 와중에 포인터 캡처까지 놓쳐 완전히 먹통이 되는 사례가 있었다.
    lockPageScroll();
  }

  // 지금 세로 위치(clientY)와 가장 가까운 Day 칸을 찾는다 - 그 칸 범위 안이면 거리 0, 위/아래로 벗어나 있으면
  // 가장 가까운 쪽까지의 거리. Day 사이 빈틈(헤더·버튼 영역)에 있을 때도 항상 어느 한 칸으로 정해진다.
  function findDayContainerAt(clientY) {
    const containers = [...timelineEl.querySelectorAll(".date-items")];
    let best = null;
    let bestDist = Infinity;
    for (const el of containers) {
      const r = el.getBoundingClientRect();
      const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  }

  function updateDrag(clientY) {
    g.lastClientY = clientY;
    const newTop = g.dragStartTop + (clientY - g.dragStartClientY);
    g.wrap.style.top = `${newTop}px`;

    const nextContainer = findDayContainerAt(clientY);
    if (nextContainer && nextContainer !== g.dayContainer) {
      g.dayContainer?.classList.remove("date-items--drop-target");
      nextContainer.appendChild(g.placeholder);
      nextContainer.appendChild(g.wrap); // position: fixed라 화면 위치는 그대로다 - 나중에 원래 흐름에 되돌릴 부모만 맞춰 둔다
      g.dayContainer = nextContainer;
      nextContainer.classList.add("date-items--drop-target");
    }
    if (!g.dayContainer) return;

    const floatRect = g.wrap.getBoundingClientRect();
    const floatCenter = newTop + floatRect.height / 2;
    reorderPlaceholder(floatCenter);

    updateAutoScroll(clientY);
  }

  // ---- 드래그 중 자동 스크롤(가장자리 접근 시에만) ----

  // 화면 상단 고정 헤더(.app-top)와 SHELL 하단 탭바(.mytrip-tabs) 사이가 실제로 카드를 놓을 수 있는 영역이다 -
  // 이 둘이 없는 화면/시점이면 그냥 창 위아래 끝을 기준으로 삼는다.
  function getScrollEdgeBounds() {
    const topRect = document.querySelector(".app-top")?.getBoundingClientRect();
    const bottomRect = document.querySelector(".mytrip-tabs")?.getBoundingClientRect();
    // 조상이 [hidden]이면 getBoundingClientRect가 사방 0인 박스를 주므로, 그 경우엔 화면 끝을 그대로 쓴다.
    return {
      top: topRect?.height ? topRect.bottom : 0,
      bottom: bottomRect?.height ? bottomRect.top : window.innerHeight,
    };
  }

  function autoScrollSpeedFor(clientY) {
    const { top, bottom } = getScrollEdgeBounds();
    if (clientY < top + AUTO_SCROLL_EDGE_PX) {
      const depth = Math.min(1, (top + AUTO_SCROLL_EDGE_PX - clientY) / AUTO_SCROLL_EDGE_PX);
      return -Math.max(1, Math.round(depth * AUTO_SCROLL_MAX_PX));
    }
    if (clientY > bottom - AUTO_SCROLL_EDGE_PX) {
      const depth = Math.min(1, (clientY - (bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX);
      return Math.max(1, Math.round(depth * AUTO_SCROLL_MAX_PX));
    }
    return 0;
  }

  const AUTO_SCROLL_INTERVAL_MS = 16; // 대략 60fps 간격

  function updateAutoScroll(clientY) {
    g.autoScrollSpeed = autoScrollSpeedFor(clientY);
    if (g.autoScrollSpeed && g.autoScrollTimer == null) {
      // requestAnimationFrame이 아니라 setInterval을 쓴다 - rAF는 문서가 실제로 화면에 그려지고 있을
      // 때만 도는데(예: 탭이 백그라운드/비가시 상태면 아예 멈춘다), 자동 스크롤은 그런 상태에서도 계속
      // 눌려 있는 동안 계속 일어나야 하는 동작이라 화면 갱신 타이밍에 얽매일 이유가 없다.
      g.autoScrollTimer = setInterval(autoScrollTick, AUTO_SCROLL_INTERVAL_MS);
    } else if (!g.autoScrollSpeed && g.autoScrollTimer != null) {
      clearInterval(g.autoScrollTimer);
      g.autoScrollTimer = null;
    }
  }

  function autoScrollTick() {
    if (!g || !g.autoScrollSpeed) {
      stopAutoScroll();
      return;
    }
    window.scrollBy(0, g.autoScrollSpeed);
    // 포인터는(가장자리에 붙어) 그대로인데 스크롤만 계속 일어나므로, 같은 clientY로 Day 칸/순서를 다시
    // 맞춘다 - 그래야 카드는 화면에 가만히 떠 있고 밑에서 목록만 흘러가는(자동 스크롤 드래그의) 모양이 된다.
    updateDrag(g.lastClientY);
  }

  function stopAutoScroll() {
    if (g?.autoScrollTimer != null) clearInterval(g.autoScrollTimer);
    if (g) {
      g.autoScrollTimer = null;
      g.autoScrollSpeed = 0;
    }
  }

  // 드래그 중엔 휠/터치로 인한 페이지 스크롤을 전부 막는다(세로 이동은 위 자동 스크롤로만 일어난다) - 이걸
  // 막지 않으면 다른 손가락(모바일)이나 마우스 휠(PC)로 페이지가 따로 스크롤될 수 있었다.
  function preventScrollEvent(e) {
    e.preventDefault();
  }

  function lockPageScroll() {
    document.addEventListener("wheel", preventScrollEvent, { passive: false });
    document.addEventListener("touchmove", preventScrollEvent, { passive: false });
  }

  function unlockPageScroll() {
    document.removeEventListener("wheel", preventScrollEvent, { passive: false });
    document.removeEventListener("touchmove", preventScrollEvent, { passive: false });
  }

  function reorderPlaceholder(floatCenter) {
    const { dayContainer, wrap, placeholder } = g;
    const siblings = [...dayContainer.querySelectorAll(".timeline-item-wrap")].filter((el) => el !== wrap);
    let target = null; // 이 요소 "앞"에 placeholder를 두어야 한다
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (floatCenter < r.top + r.height / 2) {
        target = sib;
        break;
      }
    }

    const currentNext = placeholder.nextElementSibling;
    const wantsBeforeTarget = target ? target !== currentNext : Boolean(currentNext);
    if (!wantsBeforeTarget) return; // 이미 원하는 자리에 있다

    const firstRects = new Map(siblings.map((el) => [el, el.getBoundingClientRect()]));
    if (target) dayContainer.insertBefore(placeholder, target);
    else dayContainer.appendChild(placeholder);

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

  // 드래그 공통 뒷정리(끝난 이유와 무관하게 항상 해야 하는 것들) - 커밋할지 되돌릴지는 각자가 따로 한다.
  function endDragCommon() {
    stopAutoScroll();
    unlockPageScroll();
    timelineEl.classList.remove("is-reordering");
    timelineEl.querySelectorAll(".date-items--drop-target").forEach((el) => el.classList.remove("date-items--drop-target"));
  }

  function resetWrapVisuals(wrap) {
    wrap.classList.remove("is-dragging");
    wrap.style.position = "";
    wrap.style.left = "";
    wrap.style.top = "";
    wrap.style.width = "";
    wrap.style.touchAction = "";
  }

  // 잡기 전 원래 있던 자리로 되돌린다 - pointercancel/캡처 유실처럼 제스처가 비정상으로 끝났을 때 쓴다.
  function revertToOriginalPosition() {
    const { wrap, placeholder, originalParent, originalNextSibling } = g;
    placeholder?.remove();
    if (originalParent && originalParent.isConnected) {
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(wrap, originalNextSibling);
      } else {
        originalParent.appendChild(wrap);
      }
    }
    resetWrapVisuals(wrap);
  }

  function cancelDrag() {
    endDragCommon();
    revertToOriginalPosition();
  }

  function finishDrag() {
    const { wrap, dayContainer, placeholder, originalDate, id } = g;
    endDragCommon();

    // placeholder가 여전히 dayContainer 밑에 붙어 있고 dayContainer 자체도 여전히 타임라인 안에 있어야
    // 정상 상태다 - 드래그 도중 바깥에서(예: 백그라운드 새로고침) 타임라인이 통째로 다시 그려졌다면 이 참조들이
    // 서로 어긋나 있을 수 있으므로, 그런 "이상한 위치"에 커밋하는 대신 원래 자리로 되돌린다.
    const isValid = Boolean(dayContainer) && placeholder?.parentNode === dayContainer && timelineEl.contains(dayContainer);
    if (!isValid) {
      revertToOriginalPosition();
      return;
    }

    placeholder.parentNode.insertBefore(wrap, placeholder);
    placeholder.remove();
    resetWrapVisuals(wrap);

    const orderedIds = [...dayContainer.querySelectorAll('.timeline-item[data-plain="1"]')].map((el) => el.dataset.id);
    const newDate = dayContainer.dataset.date;
    const dateChange = newDate && newDate !== originalDate ? { id, date: newDate } : null;
    onReorder(orderedIds, dateChange);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.timelineDrag = { init, cancel };
})();
