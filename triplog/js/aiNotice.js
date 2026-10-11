// @별칭 AI-NOTICE · AI 분석 안내 모달 (항공권 OCR · 여행 가져오기 공용, 최초 1회)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// flight.js(항공권 사진 OCR, 새 항공편의 "선택" 화면을 열 때)와 tripImport.js(여행 가져오기 모달을 열 때)
// 둘 다, 그 기능 화면에 처음 들어가는 순간 이 안내를 한 번만 보여준다 - 사진/파일이 AI 분석 서비스로
// 전송될 수 있다는 사실과 "저장되지 않는다", "결과는 참고용"이라는 점을 미리 알려준다.
// 메시지가 두 기능 공통(둘 다 "사진/파일을 AI로 분석한다"는 같은 성격이라)이라, 어느 한쪽에서 "확인했습니다"를
// 누르면 다른 쪽에서도 다시 보여주지 않는다 - 안내 자체가 기능별이 아니라 "이 앱이 AI 분석을 쓴다"는 사실에
// 대한 것이기 때문이다.
// "사용자별로" 기억해야 해서(요청 사항) 로그인한 사용자의 id를 localStorage 키에 넣는다 - 같은 브라우저를
// 여러 계정이 번갈아 쓰면 계정마다 따로 한 번씩 보게 된다(storage.js가 계정이 바뀌면 캐시를 통째로 바꾸는
// 것과 같은 결의 "사용자별" 취급). 로그인 정보를 못 읽는 드문 경우에는 계정 구분 없는 공용 키로 대신한다 -
// 그래도 "한 번은 보여준다"는 핵심은 지켜진다.
//
// 닫는 방법은 '확인했습니다' 버튼뿐이다(배경 클릭·Escape로는 안 닫힌다) - 일회성 고지라 실수로 안 보고
// 넘기는 일을 막으려는 의도적인 선택이다(다른 모달들의 "배경 클릭/Escape로 취소" 관례와 다르다).

(function () {
  const auth = window.TripLog.auth;

  const MESSAGE =
    "선택한 이미지는 정보를 자동으로 인식하기 위해 AI 분석 서비스로 전송될 수 있으며, 분석 후 저장되지 않습니다. 분석 결과는 참고용이니 실제 정보를 꼭 확인해주세요.";

  function storageKey() {
    const userId = auth?.getUserId?.();
    return userId ? `triplog.aiNotice.seen.${userId}` : "triplog.aiNotice.seen";
  }

  function hasSeen() {
    try {
      return localStorage.getItem(storageKey()) === "1";
    } catch (err) {
      return false; // 저장소를 못 읽으면(사생활 보호 모드 등) 매번 보여준다 - "한 번은 꼭 보여준다" 쪽이 안전하다
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(storageKey(), "1");
    } catch (err) {
      /* 저장하지 못해도 이번 화면만 넘어가면 그만이다 - 다음에 또 보일 뿐 기능이 막히지는 않는다 */
    }
  }

  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "AI-NOTICE-CONFIRM · AI 분석 안내";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ai-notice-title">
        <h2 class="modal-title" id="ai-notice-title">AI 분석 안내</h2>
        <p class="trip-exit-note">${MESSAGE}</p>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-save" data-action="confirm">확인했습니다</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (!e.target.closest('[data-action="confirm"]')) return;
      markSeen();
      overlay.hidden = true;
    });
    return overlay;
  }

  // flight.js/tripImport.js가 자기 화면(새 항공편 선택 화면 / 여행 가져오기 모달)을 열 때마다 이것만
  // 부르면 된다 - 이미 확인한 적이 있으면 아무 일도 하지 않는다(모달을 만들지도 않는다).
  function showOnce() {
    if (hasSeen()) return;
    ensureOverlay().hidden = false;
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.aiNotice = { showOnce };
})();
