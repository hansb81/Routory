// @별칭 WALLET · 여행지갑 화면 (#/wallet/:id)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// PRD v7 "여행지갑 기능"의 메인 화면: 개인지갑 섹션 + 공유지갑 섹션을 위아래로 나란히 보여주는 2열 카드
// 그리드. 019_wallet_trip_required.sql부터 여행별로 따로 쌓이므로 다른 셸 화면(일정/가계부 등)과 같은
// :id가 있다 (SHELL의 하단 탭 "여행지갑"에서 들어온다, tripShell.js - 원래는 schedule 페이지의
// QUICK-MENU 버튼이었다). 카테고리 필터는 이 화면에는 없고 문서 등록 팝업(walletForm.js)의 카테고리
// 선택에만 있다.
//
// 개인지갑/공유지갑(007_wallet_shared.sql): 개인지갑은 나만 보이는 문서, 공유지갑은 이 여행의 멤버에게도
// 보이는 문서(다른 멤버가 올린 공유 문서도 여기 나타난다)다. 둘 다 이제 "지금 보는 이 여행"에만 쌓인다 -
// 예전에는 개인지갑 문서가 여행과 무관한 공통 보관함이라 모든 여행에서 똑같이 보였는데, 사용자 피드백
// ("여행별로 파일 따로 관리")에 따라 바꿨다: 개인지갑도 "나만 보이는" 것과 "이 여행 것"을 모두 만족해야
// 보인다. 두 섹션은 walletForm.js가 업로드할 때 고르는 값을 그대로 나눠서 보여줄 뿐이다 — 문서 자체를
// 나중에 개인↔공유로 옮기는 기능은 없다. 좌우 탭으로 전환하는 대신 한 화면 안에서 위(개인지갑)·아래
// (공유지갑) 순서로 늘 함께 보이므로, 개인지갑에 문서가 많아질수록 공유지갑 섹션은 자연히 아래로 밀려난다.
//
// 목록은 storage.getWalletItems()가 돌려주는 전체 캐시(여러 여행이 섞여 있을 수 있다)에서 trip.id로 거른
// 것으로 채운다 - budgetPage.js가 getExpenses()를 trip.id로 거르는 것과 같은 방식. 화면에 처음 들어올 때
// storage.loadWalletItems(trip.id)로 서버에서 이 여행 몫만 받는다(RLS가 "내 것 + 내가 멤버인 이 여행에
// 공유된 것"만 돌려준다 — budgetPage.js가 loadExpenses/isExpensesLoaded를 쓰는 것과 같은 패턴: 처음 보면
// "불러오는 중" 문구, 받아 온 적 있으면 캐시로 먼저 그린 뒤 새로 고친다). "+" 버튼의 업로드(walletForm.js)가
// 성공하면 그 결과가 같은 캐시에 바로 더해진다. 카드를 누르면 walletViewer.js의 전체화면 보기가 연다
// (제목/카테고리/설명, 확대·이동, 삭제).
//
// 이미지 미리보기는 Storage의 getPublicUrl이 아니라 storage.js#getWalletFileUrl(→ createSignedUrl)을
// 쓴다 — 'wallet' 버킷이 private라서 공개 URL이 없고, 그때그때 짧게 유효한 서명된 URL을 새로 받아야
// 한다. 전체화면 보기도 같은 함수를 쓴다(더 긴 유효시간으로).

(function () {
  const storage = window.TripLog.storage;
  const { getTripById } = storage;
  const { escapeHtml } = window.TripLog.util;
  const { getCategoryByKey, WALLET_VISIBILITY, getVisibilityByKey } = window.TripLog.walletCategoryData;
  const router = window.TripLog.router;
  const ui = window.TripLog.ui;

  const SIGNED_URL_TTL_SEC = 60; // 그리드 썸네일은 화면에 보여주는 동안만 유효하면 되므로 짧게 잡는다

  let hydrateId = 0; // 그리드를 다시 그리면 늘어나서, 그 전 그리드에 대한 서명 URL 응답은 화면에 반영하지 않는다
  let loadRunId = 0; // 화면을 떠나거나 다시 들어오면 늘어나서, 그 전 서버 응답의 결과로 화면을 덮어쓰지 않는다

  // ---- 카드 그리드 ----

  // 파일명만 뽑는다: "abc123/dummy-boarding-pass.pdf" → "dummy-boarding-pass.pdf"
  function fileNameOf(path) {
    return path.split("/").pop() || path;
  }

  function cardHtml(item) {
    const meta = getCategoryByKey(item.category);
    const preview =
      item.fileType === "pdf"
        ? `<div class="wallet-card-pdf">
             <span class="wallet-card-pdf-icon" aria-hidden="true">📄</span>
             <span class="wallet-card-pdf-name">${escapeHtml(fileNameOf(item.fileUrl))}</span>
           </div>`
        : `<div class="wallet-card-image" data-preview data-file-url="${escapeHtml(item.fileUrl)}">
             <span class="wallet-card-status">불러오는 중...</span>
           </div>`;

    return `
      <li class="wallet-card" data-id="${item.id}" data-action="open-item">
        <span class="wallet-card-cat" aria-hidden="true" title="${escapeHtml(meta?.label ?? "")}">${meta?.icon ?? "📌"}</span>
        ${preview}
        <p class="wallet-card-title">${escapeHtml(item.title)}</p>
      </li>`;
  }

  // 개인지갑/공유지갑 한 섹션(제목 + 그 지갑의 카드 그리드, 없으면 안내 문구)을 그린다 - 탭으로 전환하는
  // 대신 두 섹션이 늘 위아래로 함께 보인다.
  function sectionHtml(visibility, items) {
    const label = getVisibilityByKey(visibility)?.label ?? "";
    const body = items.length
      ? `<ul class="wallet-grid">${items.map(cardHtml).join("")}</ul>`
      : `<p class="wallet-empty">아직 등록된 문서가 없어요.</p>`;
    return `
      <section class="wallet-section" data-visibility="${visibility}">
        <h2 class="wallet-section-title">${escapeHtml(label)}</h2>
        ${body}
      </section>`;
  }

  function bodyHtml(itemsByVisibility, loading) {
    if (loading) return `<p class="wallet-empty">문서를 불러오는 중이에요...</p>`;
    return WALLET_VISIBILITY.map((v) => sectionHtml(v.key, itemsByVisibility[v.key])).join("");
  }

  // 이미지 카드에 실제 사진을 채운다. private 버킷이라 경로만으로는 못 열고, 서명된 URL을 받아야 한다.
  async function hydrateImages(container) {
    const myHydrateId = hydrateId;
    const previews = [...container.querySelectorAll("[data-preview]")];
    await Promise.all(
      previews.map(async (el) => {
        const url = await storage.getWalletFileUrl(el.dataset.fileUrl, SIGNED_URL_TTL_SEC);
        if (myHydrateId !== hydrateId || !el.isConnected) return; // 그 사이에 필터를 바꿨거나 화면을 떠났다

        if (url) {
          el.innerHTML = `<img src="${escapeHtml(url)}" alt="" />`;
        } else {
          el.innerHTML = `<span class="wallet-card-status wallet-card-status--error">🖼️<br />불러올 수 없어요</span>`;
        }
      })
    );
  }

  function render(el, trip, loading) {
    hydrateId += 1;
    el.dataset.tripId = trip.id;
    const tripItems = storage.getWalletItems().filter((item) => item.tripId === trip.id);
    const itemsByVisibility = Object.fromEntries(
      WALLET_VISIBILITY.map((v) => [v.key, tripItems.filter((item) => item.visibility === v.key)])
    );

    el.innerHTML = `
      <div class="wallet-shell">
        <header class="wallet-header">
          <h1 class="wallet-title">여행지갑</h1>
        </header>
        <div class="wallet-scroll" data-wallet-body>${bodyHtml(itemsByVisibility, loading)}</div>
        <button type="button" class="wallet-fab" data-action="add" aria-label="문서 추가">+</button>
      </div>`;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="add"]')) {
          window.TripLog.walletForm.open();
          return;
        }
        const card = e.target.closest('[data-action="open-item"]');
        if (card) {
          const item = storage.getWalletItems().find((x) => x.id === card.dataset.id);
          if (item) window.TripLog.walletViewer.open(item);
        }
      });
    }

    if (!loading) hydrateImages(el.querySelector("[data-wallet-body]"));
  }

  // 지금 여행지갑 화면이 보이고 있으면(다른 화면으로 옮기지 않았으면) 캐시 기준으로 다시 그린다.
  // walletForm.js(업로드)·walletViewer.js(삭제)가 성공했을 때 부르는 콜백이다 — 이미 그 함수들이 캐시를
  // 바로 고쳐 두므로 다시 불러올 필요 없이 render만 하면 된다 (budgetPage.js의 refreshVisible과 같은 방식).
  function refreshVisible() {
    const el = document.querySelector('[data-page="wallet"]');
    if (!el || el.hidden) return;
    const trip = getTripById(el.dataset.tripId);
    if (trip) render(el, trip, !storage.isWalletItemsLoaded(trip.id));
  }

  // 처음 보면 "불러오는 중" 문구를 먼저 보여주고, 받아 둔 적 있으면 캐시로 먼저 그린 뒤 새로 고친다
  // (budgetPage.js#render와 같은 패턴).
  async function enter(el, { params }) {
    const trip = getTripById(params.id);
    if (!trip) return; // requireTrip 가드가 이미 걸러내므로 여기까지 오지 않는다
    const runId = ++loadRunId;
    render(el, trip, !storage.isWalletItemsLoaded(trip.id));

    try {
      await storage.loadWalletItems(trip.id);
    } catch (err) {
      if (runId === loadRunId) ui.showToast(err.message);
      return;
    }
    if (runId !== loadRunId || el.dataset.tripId !== trip.id) return; // 그 사이에 떠났거나 다른 여행으로 옮겼다
    render(el, trip, false);
  }

  window.TripLog.walletForm.init(refreshVisible);
  window.TripLog.walletViewer.init(refreshVisible);
  router.definePage("wallet", enter);
})();
