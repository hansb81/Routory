// @별칭 TRIP-EXPORT · 여행 내보내기(엑셀) 모달
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 설정(#/settings) > "여행 내보내기"가 여는 모달. accountDeletePage.js의 확인창처럼 document.body에 직접
// 오버레이를 붙이는 방식이다(index.html에는 이 화면을 위한 정적 마크업이 없다). 흐름은 두 단계:
//   1) 여행 고르기(.pick-list, tripSetup.js의 도시 목록과 같은 클래스) - storage.getAllTrips()를 보여준다.
//   2) 확인창("선택한 여행을 내보내시겠어요?") - 누르면 그 여행의 일정(schedule_items)과 가계부(expenses)만
//      한 엑셀 파일(시트 두 장: 일정/가계부)로 묶어 저장한다. 사진·여행지갑 파일 등은 내보내지 않는다.
//
// 엑셀 생성은 SheetJS(xlsx)를 쓴다 - invite.js가 카카오 SDK를 불러오는 것과 같은 방식으로, 이 모달을 처음
// 열 때만 CDN에서 lazy-load한다(안 쓰는 방문에서는 내려받지 않는다). integrity 해시도 그 패턴을 그대로 따른다.
//
// 저장 위치는 두 갈래로 나뉜다(PC/모바일 요구사항):
//   - PC의 Chrome/Edge 등 File System Access API(window.showSaveFilePicker)를 지원하는 브라우저는 그 API로
//     실제 "저장 위치 선택" 창을 띄운다.
//   - 그 API가 없는 브라우저(모바일 브라우저 전반, 구형/다른 브라우저, 그리고 네이티브 앱의 WebView도 여기
//     해당된다 - Capacitor는 이 API를 지원하지 않는다)는 평범한 <a download> 클릭으로 떨어진다 - 브라우저
//     자신의 "다운로드" 또는 "파일에 저장" 동작을 그대로 쓰는 것이라, 이 앱이 따로 저장 위치 UI를 만들
//     필요가 없다(요구사항의 "모바일 버전: 파일에 저장"을 이 폴백이 만족한다). 네이티브 전용 파일 저장
//     플러그인(@capacitor/filesystem 등)은 이번 범위에서 추가하지 않았다 - 추가하려면 mobile/package.json에
//     새 의존성을 넣고 npx cap sync까지 필요한 더 큰 작업이라서다.
// File System Access API를 쓰다가 사용자가 저장 창을 취소하면(AbortError) 오류로 보여주지 않고 조용히
// 확인창을 그대로 둔다(다시 "내보내기"를 누르면 된다).

(function () {
  const storage = window.TripLog.storage;
  const ui = window.TripLog.ui;
  const { escapeHtml } = window.TripLog.util;
  const myTripData = window.TripLog.myTripData;
  const expenseCategoryData = window.TripLog.expenseCategoryData;
  const flight = window.TripLog.flight;

  // ---- SheetJS(xlsx) lazy-load (invite.js의 loadKakao와 같은 패턴) ----
  const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  const XLSX_INTEGRITY = "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw";
  let xlsxLoading = null;

  function ensureXlsxLib() {
    if (window.XLSX) return Promise.resolve(true);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = XLSX_URL;
        script.integrity = XLSX_INTEGRITY;
        script.crossOrigin = "anonymous";
        script.onload = () => resolve(Boolean(window.XLSX));
        script.onerror = () => {
          xlsxLoading = null; // 다음에 다시 시도할 수 있게 한다
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }
    return xlsxLoading;
  }

  // ---- 여행 목록 모달 ----

  let listOverlay = null;
  let loadingList = false;

  function ensureListModal() {
    if (listOverlay) return;
    listOverlay = document.createElement("div");
    listOverlay.className = "modal-overlay";
    listOverlay.dataset.alias = "TRIP-EXPORT-LIST · 여행 내보내기 - 여행 고르기";
    listOverlay.hidden = true;
    listOverlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="trip-export-title">
        <h2 class="modal-title" id="trip-export-title">여행 내보내기</h2>
        <p class="simple-page-empty" data-role="note">일정과 가계부를 엑셀 파일로 내보낼 여행을 선택해주세요.</p>
        <ul class="pick-list" data-role="list"></ul>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="close">닫기</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(listOverlay);

    listOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="close"]')) return closeList();
      const tripId = e.target.closest("[data-select-trip]")?.dataset.selectTrip;
      if (tripId) openConfirm(tripId);
    });
    listOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeList();
    });
  }

  const dotted = (dateKey) => dateKey.replaceAll("-", ".");

  // mainPage.js#formatPeriod의 간단한 버전(며칠인지는 필요 없다 - 목록에서는 기간만 보면 된다)
  function periodLabel(trip) {
    const end = trip.endDate || trip.startDate;
    return end === trip.startDate ? dotted(trip.startDate) : `${dotted(trip.startDate)} ~ ${dotted(end)}`;
  }

  function tripItemHtml(trip) {
    const name = trip.destination || trip.title || "여행";
    return `
      <li class="pick-item">
        <div class="pick-info">
          <span class="pick-name">${escapeHtml(name)}</span>
          <span class="pick-sub">${escapeHtml(periodLabel(trip))}</span>
        </div>
        <button type="button" class="pick-btn" data-select-trip="${escapeHtml(trip.id)}">내보내기</button>
      </li>`;
  }

  function renderList() {
    const listEl = listOverlay.querySelector('[data-role="list"]');
    if (loadingList) {
      listEl.innerHTML = `<li class="pick-empty">여행 목록을 불러오는 중...</li>`;
      return;
    }
    const trips = storage.getAllTrips();
    listEl.innerHTML = trips.length ? trips.map(tripItemHtml).join("") : `<li class="pick-empty">내보낼 여행이 없어요.</li>`;
  }

  async function open() {
    ensureListModal();
    listOverlay.hidden = false;
    loadingList = true;
    renderList();
    try {
      await storage.refreshTrips();
    } catch (err) {
      console.warn("[tripExport] 여행 목록 불러오기 실패", err);
    }
    loadingList = false;
    renderList();
  }

  function closeList() {
    if (exporting) return; // 내보내는 중에는 창이 붕 떠버리지 않게 닫지 못하게 한다
    if (listOverlay) listOverlay.hidden = true;
  }

  // ---- 확인창 ----

  let confirmOverlay = null;
  let exporting = false;
  let selectedTripId = null;

  function ensureConfirmModal() {
    if (confirmOverlay) return;
    confirmOverlay = document.createElement("div");
    confirmOverlay.className = "modal-overlay";
    confirmOverlay.dataset.alias = "TRIP-EXPORT-CONFIRM · 여행 내보내기 확인창";
    confirmOverlay.hidden = true;
    confirmOverlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="trip-export-confirm-title">
        <h2 class="modal-title" id="trip-export-confirm-title">선택한 여행을 내보내시겠어요?</h2>
        <p class="trip-exit-note">일정과 가계부만 엑셀 파일로 내보낼 수 있어요.</p>
        <p class="form-error" data-role="error" hidden></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="cancel">취소</button>
            <button type="button" class="btn btn-save" data-action="confirm">내보내기</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(confirmOverlay);

    confirmOverlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="cancel"]')) closeConfirm();
      else if (e.target.closest('[data-action="confirm"]')) performExport();
    });
    confirmOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !exporting) closeConfirm();
    });
  }

  // 여행 고르기 모달은 뒤에 그대로 둔다 - aiNotice.js와 같은 "같은 z-index에서 나중에 붙인 요소가 위에
  // 그려진다" 규칙으로 확인창이 그 위에 뜬다(취소하면 다시 목록이 보인다).
  function openConfirm(tripId) {
    ensureConfirmModal();
    selectedTripId = tripId;
    confirmOverlay.querySelector('[data-role="error"]').hidden = true;
    const okBtn = confirmOverlay.querySelector('[data-action="confirm"]');
    okBtn.disabled = false;
    okBtn.textContent = "내보내기";
    confirmOverlay.hidden = false;
  }

  function closeConfirm() {
    if (exporting || !confirmOverlay) return;
    confirmOverlay.hidden = true;
  }

  // ---- 데이터 → 엑셀 ----

  function sanitizeFileName(name) {
    // 윈도우·macOS·안드로이드에서 공통으로 못 쓰는 문자만 뺀다(한글·공백은 그대로 둔다 - 여행 제목은
    // 대부분 한글이라 walletForm.js의 영문 전용 sanitize를 그대로 쓸 수 없다).
    const cleaned = (name || "").replace(/[\\/:*?"<>|]/g, "").trim();
    return cleaned || "여행";
  }

  function compareByDateThenOrder(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ao = a.sortOrder ?? 0;
    const bo = b.sortOrder ?? 0;
    if (ao !== bo) return ao - bo;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  }

  // app.js#renderItemCard와 같은 대표 텍스트·카테고리 대체 규칙(장소 → title → 메모, 항공편은 flight.summary)
  function scheduleRowFor(item) {
    const primary = item.flight ? flight.summary(item) : item.place || item.title || item.memo || "";
    const time = item.flight ? item.flight.depTime || "" : item.time ? item.time.slice(0, 5) : "";
    const category = item.flight ? "항공" : item.lodging ? "숙소" : myTripData.CATEGORY_META[item.category]?.label ?? "";
    const memo = !item.flight && item.memo && item.memo !== primary ? item.memo : "";
    return [item.date, time, primary, category, memo];
  }

  // dayKey가 "prep"(여행준비)이면 빈 문자열로 치환해 날짜보다 앞서 정렬되게 한다
  function compareExpenses(a, b) {
    const da = a.dayKey === "prep" ? "" : a.dayKey;
    const db = b.dayKey === "prep" ? "" : b.dayKey;
    if (da !== db) return da < db ? -1 : 1;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  }

  function expenseRowFor(expense) {
    const dayLabel = expense.dayKey === "prep" ? "여행준비" : expense.dayKey;
    const category = expenseCategoryData.getCategoryByKey(expense.category)?.label ?? expense.category ?? "";
    const payment = expense.paymentMethod === "card" ? "카드" : expense.paymentMethod === "cash" ? "현금" : "";
    return [dayLabel, category, expense.title, payment, expense.currency, expense.amount, expense.krwAmount ?? "", expense.memo || ""];
  }

  function buildWorkbook(items, expenses) {
    const scheduleRows = [["날짜", "시간", "제목 · 장소", "카테고리", "메모"], ...[...items].sort(compareByDateThenOrder).map(scheduleRowFor)];
    const expenseRows = [
      ["날짜", "카테고리", "제목", "결제수단", "통화", "금액", "원화 환산", "메모"],
      ...[...expenses].sort(compareExpenses).map(expenseRowFor),
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(scheduleRows), "일정");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(expenseRows), "가계부");
    return wb;
  }

  // 위 파일 설명 참고: PC는 저장 위치를 고르는 창을, 그 API가 없으면(모바일 등) 평범한 다운로드를 쓴다.
  async function saveWorkbook(wb, suggestedName) {
    const bytes = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: "Excel 파일",
              accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err?.name === "AbortError") throw err; // 사용자가 저장을 취소했다 - 그대로 올려서 호출부가 조용히 처리한다
        // 그 외 실패(권한 등)는 아래 다운로드 방식으로 다시 시도한다
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function performExport() {
    if (exporting) return;
    const trip = storage.getTripById(selectedTripId);
    if (!trip) return closeConfirm();

    const okBtn = confirmOverlay.querySelector('[data-action="confirm"]');
    const errorEl = confirmOverlay.querySelector('[data-role="error"]');
    exporting = true;
    errorEl.hidden = true;
    okBtn.disabled = true;
    okBtn.textContent = "내보내는 중...";

    try {
      await Promise.all([storage.loadItems(trip.id), storage.loadExpenses(trip.id)]);
      const items = storage.getItems().filter((item) => item.tripId === trip.id);
      const expenses = storage.getExpenses().filter((expense) => expense.tripId === trip.id);

      const libOk = await ensureXlsxLib();
      if (!libOk) throw new Error("엑셀 기능을 불러오지 못했어요.");

      const wb = buildWorkbook(items, expenses);
      const fileName = `${sanitizeFileName(trip.title || trip.destination)}_여행기록.xlsx`;
      await saveWorkbook(wb, fileName);
    } catch (err) {
      exporting = false;
      okBtn.disabled = false;
      okBtn.textContent = "내보내기";
      if (err?.name === "AbortError") return; // 저장 창을 취소한 것 - 오류로 보여주지 않는다
      console.warn("[tripExport] 내보내기 실패", err);
      errorEl.textContent = "내보내기에 실패했어요. 잠시 후 다시 시도해주세요.";
      errorEl.hidden = false;
      return;
    }

    exporting = false;
    confirmOverlay.hidden = true;
    listOverlay.hidden = true;
    ui.showToast("엑셀 파일로 내보냈어요.");
  }

  // ui.js의 알럿과 같은 이유 - 화면이 바뀌면(뒤로 가기 등) 모달이 다른 화면 위에 남지 않게 한다
  window.addEventListener("hashchange", () => {
    if (exporting) return;
    if (listOverlay) listOverlay.hidden = true;
    if (confirmOverlay) confirmOverlay.hidden = true;
  });

  window.TripLog = window.TripLog || {};
  window.TripLog.tripExport = { open };
})();
