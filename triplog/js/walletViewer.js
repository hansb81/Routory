// @별칭 WALLET-VIEWER · 문서 상세 보기
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행지갑 카드를 누르면 여는 전체화면 보기. PRD v7 3번("카드 탭하면 전체화면 뷰어로 확대 보기")을 구현한다.
//   - 이미지: 핀치(두 손가락)·마우스 휠+Ctrl(트랙패드 확대 제스처)·더블클릭으로 확대, 손가락/마우스 드래그로 이동
//   - PDF: iframe으로 바로 보여주고, iframe이 잘 안 보이는 환경을 위해 "새 탭에서 열기" 링크도 같이 둔다
//   - 상단에 제목·카테고리·설명, "삭제"(확인 후 Storage 파일 + wallet_items 행을 함께 지움), 닫기(✕)
//
// walletPage.js가 카드를 누르면 open(item)을 부른다. 삭제에 성공하면 init()에 넘긴 콜백(walletPage.js의
// 그리드 새로고침)을 부른다. 다른 폼들과 달리 표준 .modal(420px 고정폭)이 아니라 화면 전체를 쓴다
// (기본 .modal-overlay의 padding/가운데 정렬을 걷어낸 별도 오버레이 클래스, .wallet-viewer-overlay).

(function () {
  const { getWalletFileUrl, deleteWalletItem } = window.TripLog.storage;
  const { escapeHtml } = window.TripLog.util;
  const { getCategoryByKey } = window.TripLog.walletCategoryData;
  const ui = window.TripLog.ui;
  const auth = window.TripLog.auth;

  const VIEW_URL_TTL_SEC = 300; // 그리드 썸네일보다 넉넉하게(읽거나 확대해 보는 동안 만료되지 않도록)
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  let els = null; // ensureModal이 한 번만 만든다
  let confirmEls = null; // ensureConfirmModal이 한 번만 만든다
  let onChange = () => {};
  let currentItem = null;
  let openId = 0; // 다시 열거나 닫으면 늘어나서, 그 전 열람의 서명 URL 응답은 화면에 반영하지 않는다
  let deleting = false;

  // 확대·이동 상태 (이미지일 때만 쓴다)
  let zoom = { scale: 1, x: 0, y: 0 };
  const activePointers = new Map(); // pointerId → {x, y}
  let panStart = null; // 한 손가락(또는 마우스) 드래그 시작점
  let pinchStart = null; // 두 손가락 확대 시작 거리·배율

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ---- 뷰어 창 ----

  function ensureModal() {
    if (els) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay wallet-viewer-overlay";
    overlay.dataset.alias = "WALLET-VIEWER · 문서 상세 보기";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="wallet-viewer" role="dialog" aria-modal="true" aria-labelledby="wallet-viewer-title">
        <header class="wallet-viewer-header">
          <button type="button" class="wallet-viewer-close" data-action="close" aria-label="닫기">✕</button>
          <div class="wallet-viewer-header-text">
            <h2 class="wallet-viewer-title" id="wallet-viewer-title" data-title></h2>
            <p class="wallet-viewer-meta" data-meta></p>
          </div>
          <button type="button" class="btn btn-danger wallet-viewer-delete" data-action="delete">삭제</button>
        </header>
        <p class="wallet-viewer-desc" data-desc hidden></p>
        <div class="wallet-viewer-body" data-body></div>
      </div>`;
    document.body.appendChild(overlay);

    els = {
      overlay,
      title: overlay.querySelector("[data-title]"),
      meta: overlay.querySelector("[data-meta]"),
      desc: overlay.querySelector("[data-desc]"),
      body: overlay.querySelector("[data-body]"),
      deleteBtn: overlay.querySelector('[data-action="delete"]'),
    };

    overlay.querySelector('[data-action="close"]').addEventListener("click", close);
    overlay.querySelector('[data-action="delete"]').addEventListener("click", openDeleteConfirm);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // ---- 확대·이동 (이미지 전용) ----

  function distance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function applyZoom(wrap, img) {
    img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    wrap.classList.toggle("wallet-viewer-image-wrap--zoomed", zoom.scale > 1.01);
  }

  function resetZoom(wrap, img) {
    zoom = { scale: 1, x: 0, y: 0 };
    applyZoom(wrap, img);
  }

  // 핀치(두 손가락)·드래그(한 손가락/마우스)를 Pointer Events 하나로 함께 처리한다 (터치·마우스 공용)
  function bindZoomHandlers(wrap, img) {
    wrap.addEventListener("pointerdown", (e) => {
      if (e.target !== img) return;
      try {
        img.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 이미 끝난 포인터 등 드문 경우 — 캡처 없이도 핀치·드래그 계산 자체는 그대로 동작한다 */
      }
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        panStart = { x: e.clientX, y: e.clientY, zoomX: zoom.x, zoomY: zoom.y };
      } else if (activePointers.size === 2) {
        const [p1, p2] = [...activePointers.values()];
        pinchStart = { dist: distance(p1, p2), scale: zoom.scale };
        panStart = null;
      }
    });

    wrap.addEventListener("pointermove", (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2 && pinchStart) {
        const [p1, p2] = [...activePointers.values()];
        zoom.scale = clamp(pinchStart.scale * (distance(p1, p2) / pinchStart.dist), MIN_SCALE, MAX_SCALE);
        applyZoom(wrap, img);
      } else if (activePointers.size === 1 && panStart && zoom.scale > 1) {
        zoom.x = panStart.zoomX + (e.clientX - panStart.x);
        zoom.y = panStart.zoomY + (e.clientY - panStart.y);
        applyZoom(wrap, img);
      }
    });

    const endPointer = (e) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchStart = null;
      if (activePointers.size === 1) {
        // 두 손가락 중 하나를 뗀 경우, 남은 손가락 기준으로 드래그를 이어서 시작한다
        const [p] = [...activePointers.values()];
        panStart = { x: p.x, y: p.y, zoomX: zoom.x, zoomY: zoom.y };
      } else if (activePointers.size === 0) {
        panStart = null;
        if (zoom.scale <= 1.02) resetZoom(wrap, img); // 살짝만 줄어들어도 원위치로 스냅
      }
    };
    wrap.addEventListener("pointerup", endPointer);
    wrap.addEventListener("pointercancel", endPointer);

    // 트랙패드 확대 제스처는 브라우저가 wheel + ctrlKey로 알려준다 (맥·윈도 공통)
    wrap.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoom.scale = clamp(zoom.scale - e.deltaY * 0.01, MIN_SCALE, MAX_SCALE);
        applyZoom(wrap, img);
      },
      { passive: false }
    );

    // 마우스만 쓰는 화면(트랙패드 제스처도 핀치도 없는 경우)을 위한 보조 수단
    wrap.addEventListener("dblclick", () => {
      zoom.scale > 1 ? resetZoom(wrap, img) : (zoom.scale = 2);
      applyZoom(wrap, img);
    });
  }

  // ---- 본문(이미지/PDF) 채우기 ----

  async function renderBody(item) {
    const myOpenId = openId;
    zoom = { scale: 1, x: 0, y: 0 }; // 새 문서를 열 때마다 확대·이동 상태를 초기화한다

    els.body.innerHTML = `<p class="wallet-viewer-status">불러오는 중...</p>`;
    const url = await getWalletFileUrl(item.fileUrl, VIEW_URL_TTL_SEC);
    if (myOpenId !== openId) return; // 그 사이에 닫았거나 다른 문서를 열었다

    if (!url) {
      els.body.innerHTML = `<p class="wallet-viewer-status">불러올 수 없어요. 파일이 없거나 권한이 없을 수 있어요.</p>`;
      return;
    }

    if (item.fileType === "pdf") {
      els.body.innerHTML = `
        <div class="wallet-viewer-pdf">
          <iframe class="wallet-viewer-pdf-frame" src="${escapeHtml(url)}" title="${escapeHtml(item.title)} 미리보기"></iframe>
          <a class="wallet-viewer-pdf-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">새 탭에서 열기 ↗</a>
        </div>`;
      return;
    }

    els.body.innerHTML = `
      <div class="wallet-viewer-image-wrap" data-image-wrap>
        <img class="wallet-viewer-image" data-image src="${escapeHtml(url)}" alt="" draggable="false" />
      </div>`;
    const wrap = els.body.querySelector("[data-image-wrap]");
    const img = els.body.querySelector("[data-image]");
    img.addEventListener("error", () => {
      if (myOpenId !== openId) return;
      els.body.innerHTML = `<p class="wallet-viewer-status">이미지를 불러오지 못했어요.</p>`;
    });
    bindZoomHandlers(wrap, img);
  }

  // ---- 열기/닫기 ----

  function open(item) {
    if (!item) return;
    ensureModal();
    openId += 1;
    currentItem = item;

    const meta = getCategoryByKey(item.category);
    els.title.textContent = item.title;
    els.meta.textContent = [meta ? `${meta.icon} ${meta.label}` : "", item.visibility === "shared" ? "· 공유중" : ""]
      .filter(Boolean)
      .join(" ");
    if (item.description) {
      els.desc.textContent = item.description;
      els.desc.hidden = false;
    } else {
      els.desc.hidden = true;
    }
    // 공유지갑이라 남의 문서가 보이는 경우 삭제는 그 사람만 할 수 있다(007_wallet_shared.sql의 RLS도
    // 본인만 삭제하게 막아 두었다) — 버튼 자체를 숨겨서 눌러 봤자 권한 오류가 나는 상황을 만들지 않는다.
    els.deleteBtn.hidden = item.userId !== auth.getUserId();

    els.overlay.hidden = false;
    renderBody(item);
  }

  function close() {
    if (deleting) return; // 삭제 처리 중에는 닫아서 중간에 끊기지 않게 한다
    openId += 1; // 진행 중이던 서명 URL 요청은 무시한다
    els.overlay.hidden = true;
    els.body.innerHTML = "";
    currentItem = null;
  }

  // ---- 삭제 ----

  function ensureConfirmModal() {
    if (confirmEls) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "WALLET-VIEWER-DELETE-CONFIRM · 문서 삭제 확인창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true">
        <p>이 문서를 삭제할까요? 되돌릴 수 없어요.</p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
            <button type="button" class="btn btn-danger" data-action="confirm">삭제</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    confirmEls = { overlay, confirmBtn: overlay.querySelector('[data-action="confirm"]') };
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", closeDeleteConfirm);
    confirmEls.confirmBtn.addEventListener("click", performDelete);
  }

  function openDeleteConfirm() {
    ensureConfirmModal();
    confirmEls.overlay.hidden = false;
  }

  function closeDeleteConfirm() {
    if (confirmEls) confirmEls.overlay.hidden = true;
  }

  async function performDelete() {
    if (deleting || !currentItem) return;
    const item = currentItem;
    deleting = true;
    confirmEls.confirmBtn.disabled = true;
    confirmEls.confirmBtn.textContent = "삭제 중...";

    try {
      await deleteWalletItem(item);
    } catch (err) {
      deleting = false;
      confirmEls.confirmBtn.disabled = false;
      confirmEls.confirmBtn.textContent = "삭제";
      closeDeleteConfirm();
      ui.showAlert(err.message);
      return;
    }

    deleting = false;
    confirmEls.confirmBtn.disabled = false;
    confirmEls.confirmBtn.textContent = "삭제";
    closeDeleteConfirm();
    openId += 1;
    els.overlay.hidden = true;
    currentItem = null;
    ui.showToast("문서를 삭제했어요.");
    onChange();
  }

  // onChangeCallback: 삭제에 성공했을 때 부르는 콜백 (walletPage.js가 그리드를 다시 그리는 함수를 넘긴다)
  function init(onChangeCallback) {
    onChange = typeof onChangeCallback === "function" ? onChangeCallback : () => {};
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.walletViewer = { init, open };
})();
