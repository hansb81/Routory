// @별칭 PERMISSION-PROMPT · 카메라 권한 안내 모달 (CAMERA-PERMISSION-CONFIRM)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// flight.js(항공권 사진 "직접 찍기")와 tripImport.js(여행 가져오기 "사진" 탭 "직접 찍기") 둘 다, 실제
// 카메라를 열기 직전에 이 안내 모달을 한 번 보여준다 - OS 권한 팝업이 왜 뜨는지 먼저 설명해서 거부율을
// 낮추려는 목적이다(갑자기 뜨는 권한 팝업보다 이유를 먼저 보여주는 쪽이 허용률이 높다는, 앱스토어 심사
// 가이드에서도 흔히 권장하는 패턴). "사진에서 선택"(갤러리) 버튼에는 적용하지 않는다 - 카메라 권한과
// 무관해서다.
//
// 네이티브 앱에서는 이미 거부한 적이 있는지 @capacitor/camera의 checkPermissions()로 미리 확인한다 -
// 한 번 거부(특히 안드로이드의 "다시 묻지 않음")되면 getPhoto()를 다시 불러도 OS가 권한 팝업 자체를
// 다시 띄워주지 않는 경우가 많아서, 그럴 땐 '허용' 버튼 대신 "설정에서 권한을 허용해주세요" 안내로
// 바꾸고 실제 getPhoto 호출은 하지 않는다(요청 3번).
// 웹은 <input type="file" capture>가 쓰는 권한 상태를 미리 조회할 표준 방법이 없다 - 항상 안내 모달만
// 보여주고, 실제로 막혀 있다면 그 다음은 브라우저/OS 자체의 안내에 맡긴다.
//
// SHELL의 MYTRIP-EXIT-CONFIRM · accountDeletePage.js의 확인창과 같은 .modal-overlay/.modal-confirm 구조를
// 그대로 재사용한다(Conventions의 "새 레이아웃을 만들지 않는다" 원칙) - 새 CSS가 필요 없다.

(function () {
  const CAMERA_MESSAGE = "항공권/여행 정보 촬영을 위해 카메라 권한이 필요합니다.";
  const DENIED_MESSAGE = "설정에서 권한을 허용해주세요.";

  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "CAMERA-PERMISSION-CONFIRM · 카메라 권한 안내";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="camera-permission-title">
        <h2 class="modal-title" id="camera-permission-title"></h2>
        <p class="trip-exit-note" data-role="note"></p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-cancel" data-action="close">닫기</button>
            <button type="button" class="btn btn-save" data-action="allow">허용</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="close"]')) close();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    return overlay;
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  // 네이티브에서만 미리 확인할 수 있다. 웹이거나(window.Capacitor 자체가 없다, CLAUDE.md의 isNativeApp 설명
  // 참고) 플러그인이 없으면 undefined를 거쳐 null(모름)로 떨어진다 - 호출한 쪽은 "거부된 적 없다"로
  // 간주해 그냥 평소 안내 모달을 보여준다(막혀 있으면 getPhoto 자체가 실패를 돌려주므로 안전하다).
  async function cameraPermissionState() {
    try {
      const Camera = window.Capacitor?.Plugins?.Camera;
      if (!Camera?.checkPermissions) return null;
      const { camera } = await Camera.checkPermissions();
      return camera ?? null; // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'limited'
    } catch (err) {
      console.warn("[permissionPrompt] 카메라 권한 상태 확인 실패", err);
      return null;
    }
  }

  // "직접 찍기" 버튼을 누른 직후 호출한다. 거부된 적이 없으면(또는 모르면) 안내 모달을 보여주고, '허용'을
  // 누르면 onAllow()를 불러 실제 카메라(getPhoto 또는 file input)를 연다. 이미 거부된 상태(네이티브만
  // 확인 가능)면 onAllow를 아예 부르지 않고 "설정에서 허용해주세요" 안내만 보여준다.
  async function askCamera(onAllow) {
    const state = await cameraPermissionState();
    const el = ensureOverlay();
    const titleEl = el.querySelector("#camera-permission-title");
    const noteEl = el.querySelector('[data-role="note"]');
    const allowBtn = el.querySelector('[data-action="allow"]');

    if (state === "denied") {
      titleEl.textContent = "카메라 권한이 꺼져 있어요";
      noteEl.textContent = DENIED_MESSAGE;
      allowBtn.hidden = true;
    } else {
      titleEl.textContent = "카메라 권한이 필요해요";
      noteEl.textContent = CAMERA_MESSAGE;
      allowBtn.hidden = false;
      allowBtn.onclick = () => {
        close();
        onAllow();
      };
    }
    el.hidden = false;
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.permissionPrompt = { askCamera };
})();
