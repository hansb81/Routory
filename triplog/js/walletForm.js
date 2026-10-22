// @별칭 WALLET-FORM · 문서 업로드 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행지갑(#/wallet/:id)의 "+" 버튼이 여는 업로드 폼. PRD v7 4번 흐름을 구현한다:
//   1) 개인지갑 / 공유지갑 중 하나를 고른다 (기본값 개인지갑; 공유지갑은 지금 보던 여행의 멤버에게 공개된다)
//   2) 사진에서 선택 / 직접 찍기 / PDF·파일 선택 중 하나로 파일을 고른다
//   3) 미리보기 (사진은 그대로, PDF는 파일명만)
//   4) 카테고리(칩) · 제목(필수) · 설명(선택)
//   5) 저장 → Storage 업로드 + wallet_items 기록 (storage.js#addWalletItem)
// walletPage.js가 "+"를 누르면 open()을 부른다. 저장에 성공하면 init()에 넘긴 콜백(walletPage.js의
// 그리드 새로고침)을 부른다. expenseForm.js와 같은 모양의 모듈이다(ensureModal 한 번, open/close, 검증).
//
// 019_wallet_trip_required.sql부터 개인지갑/공유지갑 둘 다 "지금 보던 여행"(storage.getTrip(), 여행지갑은
// 이제 늘 그 여행의 #/wallet/:id로 들어오므로 항상 남아 있다)에 저장한다 — 개인지갑도 더 이상 여행과
// 무관한 공통 보관함이 아니라 그 여행에만 쌓인다. 그 여행이 없으면(이론상 주소창에 #/wallet을 id 없이
// 직접 쳐서 들어온 경우 정도인데, 라우터가 :id를 요구하게 되어 있어 실제로는 거의 안 일어난다) 저장 시점에
// 막는다(handleSubmit).

(function () {
  const storage = window.TripLog.storage;
  const { addWalletItem } = storage;
  const { escapeHtml } = window.TripLog.util;
  const { WALLET_CATEGORIES, WALLET_VISIBILITY, DEFAULT_VISIBILITY } = window.TripLog.walletCategoryData;

  const MAX_FILE_BYTES = 10 * 1024 * 1024; // PRD 4-5: 개당 최대 10MB (압축 전 원본 기준)
  const WALLET_IMAGE_MAX_DIMENSION = 1920; // 압축 후 긴 변 최대 길이(px)
  const WALLET_IMAGE_QUALITY = 0.82; // JPEG 재인코딩 품질

  let onChange = () => {};
  let els = null; // ensureModal이 한 번만 만든다
  let fileToken = 0; // 압축이 끝나기 전에 다른 파일을 고르면 이전 결과를 버리기 위한 토큰 (hydrateId와 같은 패턴)
  let state = { file: null, fileType: null, previewUrl: null, categoryKey: null, visibility: DEFAULT_VISIBILITY, saving: false, compressing: false };

  function ensureModal() {
    if (els) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "WALLET-FORM · 문서 업로드 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal wallet-form-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-form-title">
        <h2 class="modal-title" id="wallet-form-title">문서 추가</h2>
        <form novalidate>
          <div class="form-field">
            <div class="wallet-form-visibility-row" role="radiogroup" aria-label="저장 위치" data-visibility-tabs></div>
          </div>

          <div class="form-field">
            <label>파일 선택 *</label>
            <div class="wallet-picker-row">
              <button type="button" class="wallet-picker-btn" data-action="pick-gallery"><span aria-hidden="true">📷</span>사진에서 선택</button>
              <button type="button" class="wallet-picker-btn" data-action="pick-camera"><span aria-hidden="true">📸</span>직접 찍기</button>
              <button type="button" class="wallet-picker-btn" data-action="pick-file"><span aria-hidden="true">📄</span>PDF·파일 선택</button>
            </div>
            <input type="file" data-input-gallery accept="image/*" hidden />
            <input type="file" data-input-camera accept="image/*" capture="environment" hidden />
            <input type="file" data-input-file accept="image/*,application/pdf" hidden />
            <div class="wallet-form-preview" data-preview hidden></div>
          </div>

          <div class="form-field">
            <label>카테고리 *</label>
            <div class="wallet-form-category-chips" data-category-chips role="radiogroup" aria-label="카테고리"></div>
          </div>

          <div class="form-field">
            <label for="wallet-form-title-input">제목 *</label>
            <input type="text" id="wallet-form-title-input" data-title placeholder="예: 여권" autocomplete="off" />
          </div>

          <div class="form-field">
            <label for="wallet-form-desc">설명</label>
            <textarea id="wallet-form-desc" data-description rows="2" placeholder="설명을 남겨보세요 (선택)"></textarea>
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
      form: overlay.querySelector("form"),
      title: overlay.querySelector("[data-title]"),
      description: overlay.querySelector("[data-description]"),
      error: overlay.querySelector("[data-error]"),
      saveBtn: overlay.querySelector("[data-save]"),
      preview: overlay.querySelector("[data-preview]"),
      visibilityTabs: overlay.querySelector("[data-visibility-tabs]"),
      categoryChips: overlay.querySelector("[data-category-chips]"),
      inputGallery: overlay.querySelector("[data-input-gallery]"),
      inputCamera: overlay.querySelector("[data-input-camera]"),
      inputFile: overlay.querySelector("[data-input-file]"),
    };

    overlay.querySelector('[data-action="pick-gallery"]').addEventListener("click", () => els.inputGallery.click());
    overlay.querySelector('[data-action="pick-camera"]').addEventListener("click", () => els.inputCamera.click());
    overlay.querySelector('[data-action="pick-file"]').addEventListener("click", () => els.inputFile.click());
    [els.inputGallery, els.inputCamera, els.inputFile].forEach((input) => {
      input.addEventListener("change", () => {
        handleFileChosen(input.files[0]);
        input.value = ""; // 같은 파일을 다시 골라도 change가 또 일어나게 비워 둔다
      });
    });

    els.preview.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="clear-file"]')) clearFile();
    });
    els.visibilityTabs.addEventListener("change", (e) => {
      const input = e.target.closest('input[name="wallet-form-visibility"]');
      if (input) selectVisibility(input.value);
    });
    els.categoryChips.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-category-key]");
      if (chip) selectCategory(chip.dataset.categoryKey);
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    els.form.addEventListener("submit", handleSubmit);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // ---- 파일 선택 · 미리보기 ----

  // Storage 무료 플랜(프로젝트 전체 1GB)을 사진 원본(수 MB~10MB대)이 빨리 채우는 걸 막으려고, 올리기 전에
  // 긴 변을 WALLET_IMAGE_MAX_DIMENSION 이하로 줄이고 JPEG로 재인코딩한다. createImageBitmap에
  // imageOrientation: "from-image"를 줘서 디코딩 - 안 주면 모바일 카메라 사진의 EXIF 회전 정보가 무시돼서
  // canvas에 그릴 때 세로로 찍은 사진이 가로로 돌아간 채 저장된다(데스크톱 파일 선택엔 보통 이 메타데이터가
  // 없어서 안 드러나던 문제). PDF는 압축 대상이 아니다(그대로 올린다).
  async function compressImage(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, WALLET_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", WALLET_IMAGE_QUALITY));
      if (!blob || blob.size >= file.size) return file; // 이미 작은 사진 등 압축이 더 커지면 원본을 그대로 쓴다

      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  }

  async function handleFileChosen(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showError("파일 용량은 10MB를 넘을 수 없어요.");
      return;
    }
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      showError("사진(PNG·JPG) 또는 PDF 파일만 올릴 수 있어요.");
      return;
    }

    clearError();
    const token = ++fileToken;
    state.compressing = false; // 새로 고른 파일이 이전 선택(압축 중이었을 수도 있는)의 스피너를 덮어쓴다

    let finalFile = file;
    if (isImage) {
      state.compressing = true;
      renderPreview();
      try {
        finalFile = await compressImage(file);
      } catch {
        finalFile = file; // 압축 실패(지원 안 하는 브라우저/손상된 파일 등) 시 원본을 그대로 올린다
      }
      if (token !== fileToken) return; // 그사이 다른 파일을 골랐으면 이 결과는 버린다 (그 파일이 이미 compressing을 자기 상태로 바꿔놨다)
      state.compressing = false;
    }

    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = finalFile;
    state.fileType = isImage ? "image" : "pdf";
    state.previewUrl = isImage ? URL.createObjectURL(finalFile) : null;
    renderPreview();
  }

  function clearFile() {
    fileToken++; // 압축이 진행 중이었다면 그 결과를 버린다
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = null;
    state.fileType = null;
    state.previewUrl = null;
    state.compressing = false;
    renderPreview();
  }

  // 사진은 그대로 보여주고, PDF는 파일명만 보여준다 (PRD 4-2); 압축 중에는 안내 문구만 보여준다
  function renderPreview() {
    updateSaveDisabled();
    if (state.compressing) {
      els.preview.hidden = false;
      els.preview.innerHTML = `<span class="wallet-preview-status">압축 중...</span>`;
      return;
    }
    if (!state.file) {
      els.preview.hidden = true;
      els.preview.innerHTML = "";
      return;
    }
    els.preview.hidden = false;
    const body =
      state.fileType === "image"
        ? `<img src="${state.previewUrl}" alt="" />`
        : `<span class="wallet-preview-pdf"><span aria-hidden="true">📄</span>${escapeHtml(state.file.name)}</span>`;
    els.preview.innerHTML = `${body}<button type="button" class="wallet-preview-clear" data-action="clear-file" aria-label="선택한 파일 지우기">✕</button>`;
  }

  // ---- 저장 위치: 개인지갑/공유지갑 (동그란 라디오 버튼, 기본은 개인지갑에 포커스) ----
  // 공유지갑은 지금 보던 여행의 멤버와 공유되므로, 그 여행이 없으면(storage.getTrip() null) 고를 대상이
  // 없어 목록 자체에서 뺀다 — 개인지갑도 이제 그 여행에 저장되지만(위 파일 머리 설명), 멤버 공개 여부와는
  // 무관해서 여행이 없어도 고를 수 있다(실제로는 라우터가 :id를 요구해 이 경우가 거의 없다).

  function renderVisibilityTabs() {
    const trip = storage.getTrip();
    const options = trip ? WALLET_VISIBILITY : WALLET_VISIBILITY.filter((v) => v.key !== "shared");
    els.visibilityTabs.innerHTML = options
      .map(
        (v) => `
        <label class="wallet-form-visibility-radio">
          <input type="radio" name="wallet-form-visibility" value="${v.key}" ${v.key === state.visibility ? "checked" : ""} />
          ${escapeHtml(v.label)}
        </label>`
      )
      .join("");
  }

  function selectVisibility(key) {
    state.visibility = key;
  }

  // ---- 카테고리 칩 (PRD 4-3): expenseForm.js의 카테고리 선택과 같은 모양이다 ----

  function renderCategoryChips() {
    els.categoryChips.innerHTML = WALLET_CATEGORIES.map(
      (category) => `
        <button type="button" role="radio" aria-checked="${category.key === state.categoryKey}"
          class="wallet-form-category-item${category.key === state.categoryKey ? " wallet-form-category-item--active" : ""}"
          data-category-key="${category.key}">
          <span class="wallet-form-category-icon" aria-hidden="true">${category.icon}</span>
          <span class="wallet-form-category-label">${escapeHtml(category.label)}</span>
        </button>`
    ).join("");
  }

  function selectCategory(key) {
    state.categoryKey = key;
    renderCategoryChips();
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

  // 압축 중이거나 업로드 중에는 저장 버튼을 눌러도 아직 준비되지 않은 파일이 제출되지 않게 막는다
  function updateSaveDisabled() {
    els.saveBtn.disabled = state.compressing || state.saving;
  }

  // ---- 열기/닫기 ----

  function open() {
    ensureModal();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    fileToken++; // 열려 있던 창에서 압축이 진행 중이었다면 그 결과를 버린다
    state = { file: null, fileType: null, previewUrl: null, categoryKey: null, visibility: DEFAULT_VISIBILITY, saving: false, compressing: false };

    els.form.reset();
    els.title.value = "";
    els.description.value = "";
    clearError();
    renderPreview();
    renderVisibilityTabs();
    renderCategoryChips();

    els.overlay.hidden = false;
  }

  function close() {
    if (state.saving || state.compressing) return; // 업로드/압축 중에는 창을 닫아 중간에 끊기지 않게 한다
    els.overlay.hidden = true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (state.saving || state.compressing) return;

    const title = els.title.value.trim();
    const description = els.description.value.trim();

    if (!state.file) return showError("사진 또는 PDF 파일을 선택해주세요.");
    if (state.file.size > MAX_FILE_BYTES) return showError("파일 용량은 10MB를 넘을 수 없어요."); // 선택 시 이미 막지만, 저장 시에도 한 번 더 확인한다
    if (!state.categoryKey) return showError("카테고리를 선택해주세요.");
    if (!title) return showError("제목을 입력해주세요.");

    const tripId = storage.getTrip()?.id ?? null;
    if (!tripId) return showError("문서를 올릴 여행을 찾을 수 없어요. 여행 화면에서 다시 열어주세요.");

    clearError();
    state.saving = true;
    updateSaveDisabled();
    els.saveBtn.textContent = "업로드 중...";

    try {
      await addWalletItem({ file: state.file, category: state.categoryKey, title, description, visibility: state.visibility, tripId });
    } catch (err) {
      showError(err.message);
      return;
    } finally {
      state.saving = false;
      updateSaveDisabled();
      els.saveBtn.textContent = "저장";
    }

    els.overlay.hidden = true;
    onChange();
  }

  // onChangeCallback: 저장에 성공했을 때 부르는 콜백 (walletPage.js가 그리드를 다시 그리는 함수를 넘긴다)
  function init(onChangeCallback) {
    onChange = typeof onChangeCallback === "function" ? onChangeCallback : () => {};
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.walletForm = { init, open };
})();
