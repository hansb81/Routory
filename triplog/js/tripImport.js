// @별칭 TRIP-IMPORT-MODAL · 여행 가져오기 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행 가져오기 모달(PRD v8): 파일/텍스트/사진 탭 중 하나(또는 여러 개)로 자료를 모아 analyze-trip-import
// Edge Function에 보내고, 일정·가계부 후보를 받아온다. MAIN(새 여행 만들기 옆)과 SCHEDULE(가져오기 버튼)
// 양쪽에서 같은 모달을 쓰되 open({ mode, tripId })의 mode로 구분한다:
//   - "create": MAIN에서 연다. 분석 결과로 새 여행을 만든다(tripId 없음).
//   - "append": SCHEDULE에서 연다. 지금 보는 여행(tripId)에 일정·가계부를 추가/갱신한다.
//
// 파일 탭과 사진 탭은 결과적으로 같은 자리(state.attachment)를 채운다 - analyze-trip-import가 imageBase64를
// 하나만 받기 때문에, 파일을 골랐다가 사진을 다시 고르면(또는 그 반대) 나중 것이 앞의 것을 대체한다. 텍스트는
// 별개 자리(텍스트어리아 값)라서 첨부와 함께 보낼 수 있다(사진+텍스트를 같이 분석하는 것도 지원한다).
//
// 사진 고르기는 flight.js의 항공권 사진과 같은 원칙: 네이티브 앱(auth.isNativeApp())은 @capacitor/camera의
// getPhoto()를, 웹은 <input type="file">을 쓴다. 파일 탭(PDF 포함)은 네이티브에서도 일반 파일 선택기가
// 그대로 동작해서 따로 분기하지 않는다.
//
// 이 파일은 모달 UI와 분석 호출(로딩 상태 포함)까지만 구현한다. 분석 결과를 보여주는 미리보기/수정 화면은
// tripImportPreview.js에 따로 있다 - 그 파일이 로드 시점에 스스로 tripImport.init(open)을 불러 onAnalyzed를
// 자기 open()으로 덮어쓴다(walletPage.js가 walletForm.js/walletViewer.js를 잇는 것과 같은 패턴이라, 이
// 파일은 tripImportPreview.js의 존재를 모른다). onAnalyzed가 없을 때만(예: init 전에 호출된 경우) 결과
// 개수를 토스트로 보여주고 닫는 폴백이 남아 있다.
// 사진/파일은 base64로 바꿔서 보내기만 하고 어디에도 저장하지 않는다(항공권 기능과 같은 원칙).

(function () {
  const supabase = window.TripLog.supabase;
  const auth = window.TripLog.auth;
  const ui = window.TripLog.ui;
  const permissionPrompt = window.TripLog.permissionPrompt;
  const aiNotice = window.TripLog.aiNotice;
  // storage.js는 이 파일보다 나중에 로드된다(index.html 순서) - 미리 꺼내 두지 않고 쓸 때마다 그때 읽는다.

  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // analyze-trip-import의 base64 한도(약 10MB)와 맞춘다
  const FAIL_MESSAGE = "분석에 실패했어요. 직접 입력해주세요"; // Edge Function이 돌려주는 문구와 그대로 맞춘다

  let onAnalyzed; // init()으로 다음 단계(미리보기 화면)가 이어붙인다. 아직 아무도 안 붙였으면 defaultOnAnalyzed를 쓴다.

  const state = {
    mode: "create", // "create" | "append"
    tripId: null,
    tab: "file", // "file" | "text" | "photo"
    attachment: null, // { mime, base64, kind: "file"|"photo", label } - 파일탭·사진탭이 공유하는 첨부 한 칸
    attachmentReadId: 0,
    loading: false,
  };

  const els = {
    overlay: document.getElementById("trip-import-overlay"),
    close: document.getElementById("trip-import-close"),
    tabs: document.querySelectorAll(".trip-import-tab"),
    panelFile: document.getElementById("trip-import-panel-file"),
    panelText: document.getElementById("trip-import-panel-text"),
    panelPhoto: document.getElementById("trip-import-panel-photo"),

    filePick: document.getElementById("trip-import-file-pick"),
    fileInput: document.getElementById("trip-import-file-input"),
    filePreview: document.getElementById("trip-import-file-preview"),
    fileName: document.getElementById("trip-import-file-name"),
    fileClear: document.getElementById("trip-import-file-clear"),

    textarea: document.getElementById("trip-import-textarea"),

    photoPick: document.getElementById("trip-import-photo-pick"),
    photoCamera: document.getElementById("trip-import-photo-camera"),
    photoFile: document.getElementById("trip-import-photo-file"),
    photoCameraFile: document.getElementById("trip-import-photo-camera-file"),
    photoPreview: document.getElementById("trip-import-photo-preview"),
    photoImg: document.getElementById("trip-import-photo-img"),
    photoClear: document.getElementById("trip-import-photo-clear"),

    status: document.getElementById("trip-import-status"),
    error: document.getElementById("trip-import-error"),
    submit: document.getElementById("trip-import-submit"),
  };

  const CAMERA_SOURCE = { CAMERA: "CAMERA", PHOTOS: "PHOTOS" }; // flight.js와 같은 리터럴 값

  // ---- 열기/닫기 ----

  function open({ mode, tripId } = {}) {
    state.mode = mode === "append" ? "append" : "create";
    state.tripId = state.mode === "append" ? tripId ?? null : null;
    state.tab = "file";
    state.loading = false;
    clearAttachment();
    els.textarea.value = "";
    hideError();
    aiNotice.showOnce(); // 여행 가져오기 모달을 여는 시점 - 이미 봤으면 아무 일도 안 한다
    els.overlay.hidden = false;
    render();
  }

  function close() {
    if (state.loading) return; // 분석 중에는 닫지 못하게 한다(요청이 붕 떠버리지 않도록)
    els.overlay.hidden = true;
    state.attachmentReadId += 1; // 진행 중이던 읽기 결과는 버린다
  }

  // ---- 탭 ----

  function switchTab(tab) {
    state.tab = tab;
    render();
  }

  function render() {
    els.tabs.forEach((btn) => {
      const active = btn.dataset.tab === state.tab;
      btn.classList.toggle("trip-import-tab--active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    els.panelFile.hidden = state.tab !== "file";
    els.panelText.hidden = state.tab !== "text";
    els.panelPhoto.hidden = state.tab !== "photo";

    // 첨부는 한 칸을 파일탭·사진탭이 나눠 쓰므로, 지금 들어 있는 게 어느 쪽 것인지에 맞는 미리보기만 보여준다
    els.filePreview.hidden = state.attachment?.kind !== "file";
    els.photoPreview.hidden = state.attachment?.kind !== "photo";

    els.submit.disabled = state.loading;
    els.submit.textContent = state.loading ? "분석 중..." : "분석하기";
    els.close.disabled = state.loading;
  }

  // ---- 첨부(파일/사진) 공통 처리 ----

  // 고른 파일/사진과 미리보기를 모두 비운다(진행 중이던 읽기도 버린다). 텍스트어리아 값은 건드리지 않는다.
  function clearAttachment() {
    state.attachmentReadId += 1;
    state.attachment = null;
    els.fileInput.value = "";
    els.photoFile.value = "";
    els.photoCameraFile.value = "";
    els.photoImg.removeAttribute("src");
    hideError();
    render();
  }

  // 웹(FileReader)과 네이티브(Camera.getPhoto)가 만든 "data:mime;base64,..." 문자열을 여기서 합친다.
  // forcedMime: 파일의 file.type을 못 믿을 때(아래 readAttachmentFile 참고) 확실한 값을 강제로 넣는다.
  function applyAttachmentDataUrl(dataUrl, label, kind, readId, forcedMime) {
    if (readId !== state.attachmentReadId) return; // 그 사이 다른 파일을 고르거나 창을 닫았다
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const approxBytes = Math.ceil((base64.length * 3) / 4);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      state.attachment = null;
      showError("파일이 너무 커요. 10MB 이하로 선택해주세요.");
      return render();
    }
    const mime = forcedMime || /^data:([^;]+);/.exec(dataUrl)?.[1] || "application/octet-stream";
    state.attachment = { mime, base64, kind, label };
    if (kind === "file") els.fileName.textContent = label;
    else els.photoImg.src = dataUrl;
    hideError();
    render();
  }

  // ---- 파일 탭 (PDF/이미지, 네이티브도 일반 파일 선택기라 분기 없음) ----

  function readAttachmentFile(file, kind) {
    if (!file) return;
    // file.type만 믿지 않는다: 일부 파일 제공자(안드로이드의 "다운로드"/클라우드 앱 등 content:// 경로로 넘어오는
    // 파일 선택기, 확장자 연결이 꼬인 일부 환경)는 실제로 PDF인데도 file.type이 비어 있거나
    // "application/octet-stream"으로 온다 - 이럴 땐 파일 이름의 .pdf 확장자로도 PDF를 인정한다
    // (안 그러면 진짜 PDF를 선택했는데도 "PDF 또는 이미지 파일만 선택할 수 있어요"로 막혀 버린다).
    const looksLikePdfExt = /\.pdf$/i.test(file.name || "");
    const untypedOrGeneric = !file.type || file.type === "application/octet-stream";
    const isPdf = file.type === "application/pdf" || (looksLikePdfExt && untypedOrGeneric);
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      showError("PDF 또는 이미지 파일만 선택할 수 있어요.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showError("파일이 너무 커요. 10MB 이하로 선택해주세요.");
      return;
    }

    clearAttachment();
    const readId = state.attachmentReadId; // clearAttachment가 번호를 올렸으므로, 이 값이 "이번 읽기"의 번호다
    const reader = new FileReader();
    // file.type이 비어 있으면 브라우저가 만드는 data URL도 mime이 비거나 부정확할 수 있어서, 확장자로
    // PDF임을 확인한 경우에는 "application/pdf"를 그대로 강제한다(서버도 base64 내용으로 한 번 더 확인하지만,
    // 여기서 정확한 값을 보내는 게 우선이다).
    const forcedMime = isPdf && untypedOrGeneric ? "application/pdf" : undefined;
    reader.onload = () => applyAttachmentDataUrl(String(reader.result), file.name, kind, readId, forcedMime);
    reader.onerror = () => {
      if (readId !== state.attachmentReadId) return;
      showError("파일을 읽지 못했어요. 다시 선택해주세요.");
    };
    reader.readAsDataURL(file);
  }

  // ---- 사진 탭 (네이티브: @capacitor/camera / 웹: <input type="file">) ----

  // flight.js의 captureTicketPhoto와 같은 방식. getPhoto는 Capacitor 8.1부터 takePhoto/chooseFromGallery에
  // 자리를 내주는 중이라 문서상 @deprecated지만, resultType: "dataUrl"로 base64까지 바로 주는 유일한
  // 메서드라서 그대로 쓴다. 번들러가 없어서 네이티브 브리지가 올려 두는 범용 프록시를 그대로 쓴다.
  async function capturePhoto(source) {
    clearAttachment();
    const readId = state.attachmentReadId;
    try {
      const photo = await window.Capacitor.Plugins.Camera.getPhoto({
        resultType: "dataUrl",
        source,
        quality: 85,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (readId !== state.attachmentReadId) return;
      if (!photo?.dataUrl) return showError("사진을 가져오지 못했어요. 다시 시도해주세요.");
      applyAttachmentDataUrl(photo.dataUrl, "사진", "photo", readId);
    } catch (err) {
      if (readId !== state.attachmentReadId) return;
      // 사용자가 취소했을 때도 여기로 온다("User cancelled photos app") - 오류로 보여주지 않고 조용히 넘어간다.
      if (!/cancel/i.test(err?.message ?? "")) showError("사진을 가져오지 못했어요. 다시 시도해주세요.");
    }
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

  function showStatus(message) {
    els.status.textContent = message;
    els.status.hidden = !message;
  }

  // ---- 분석하기 ----

  async function handleSubmit() {
    if (state.loading) return;
    const text = els.textarea.value.trim();
    if (!state.attachment && !text) {
      return showError("파일·사진을 선택하거나 텍스트를 입력해주세요.");
    }

    hideError();
    state.loading = true;
    showStatus("항공권과 마찬가지로, 사진·파일은 분석에만 쓰이고 저장되지 않아요.");
    render();

    const body = {};
    if (state.attachment) {
      body.imageBase64 = state.attachment.base64;
      body.mimeType = state.attachment.mime;
    }
    if (text) body.text = text;
    // append 모드(기존 여행에 더하기)면 그 여행의 저장된 시작일을 같이 보낸다 - 자료가 "1일차"처럼 달력
    // 날짜 없이 상대적으로만 날짜를 표현할 때 Gemini가 dayOffset을 계산할 근거가 된다(analyze-trip-import
    // 참고). create 모드는 여행이 아직 없어서 안 보낸다.
    if (state.mode === "append" && state.tripId) {
      const trip = window.TripLog.storage?.getTripById?.(state.tripId);
      if (trip?.startDate) body.tripStartDate = trip.startDate;
    }

    let result = null;
    try {
      const { data, error } = await supabase.functions.invoke("analyze-trip-import", { body });
      if (error) console.warn("[tripImport] 분석 요청 실패", error.name);
      else if (data && typeof data === "object" && !data.error) result = data;
    } catch (err) {
      console.warn("[tripImport] 분석 요청 실패", err?.name);
    }

    state.loading = false;
    showStatus("");

    if (!result) {
      render();
      return showError(FAIL_MESSAGE);
    }

    close();
    onAnalyzed({ mode: state.mode, tripId: state.tripId, result });
  }

  // ---- 이벤트 ----

  function init(onAnalyzedCallback) {
    onAnalyzed = typeof onAnalyzedCallback === "function" ? onAnalyzedCallback : defaultOnAnalyzed;
  }

  // init()을 아직 아무도 부르지 않았거나(다음 단계 화면이 없을 때) onAnalyzed를 안 넘겼을 때의 임시 동작:
  // 결과가 오긴 왔다는 걸 확인할 수 있게 개수만 토스트로 보여준다. 실제 미리보기 화면은 다음 단계에서 연결한다.
  function defaultOnAnalyzed({ result }) {
    const parts = [];
    if (result.trip) parts.push("여행 정보");
    if (result.scheduleItems.length) parts.push(`일정 ${result.scheduleItems.length}개`);
    if (result.expenses.length) parts.push(`비용 ${result.expenses.length}개`);
    ui.showToast(parts.length ? `${parts.join(", ")}를 찾았어요. (미리보기 화면은 다음 단계에서 연결됩니다)` : "분석 결과가 비어 있어요.");
  }
  onAnalyzed = defaultOnAnalyzed;

  document.querySelectorAll(".trip-import-tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  els.filePick.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = "";
    readAttachmentFile(file, "file");
  });
  els.fileClear.addEventListener("click", clearAttachment);

  els.photoPick.addEventListener("click", () => {
    if (auth.isNativeApp()) capturePhoto(CAMERA_SOURCE.PHOTOS);
    else els.photoFile.click();
  });
  els.photoCamera.addEventListener("click", () => {
    // flight.js의 "직접 찍기"와 같은 이유로, 실제 카메라를 열기 전에 권한 안내 모달을 한 번 보여준다
    // (permissionPrompt.js 참고) - "사진에서 선택"(photoPick)에는 적용하지 않는다.
    permissionPrompt.askCamera(() => {
      if (auth.isNativeApp()) capturePhoto(CAMERA_SOURCE.CAMERA);
      else els.photoCameraFile.click();
    });
  });
  [els.photoFile, els.photoCameraFile].forEach((input) =>
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      readAttachmentFile(file, "photo");
    })
  );
  els.photoClear.addEventListener("click", clearAttachment);

  els.textarea.addEventListener("input", hideError);
  els.submit.addEventListener("click", handleSubmit);
  els.close.addEventListener("click", close);

  window.TripLog = window.TripLog || {};
  window.TripLog.tripImport = { init, open, close };
})();
