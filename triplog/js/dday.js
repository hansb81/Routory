// @별칭 DDAY · D-day 표시
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// D-day 배지(#dday-badge) 렌더링과, 다른 화면의 D-day 문구를 자정마다 갱신하는 모듈 (계산은 util.ddayLabel)
// 로컬 타임존 자정마다 재계산되도록 다음 자정까지 setTimeout을 걸고, 실행 후 스스로 다시 예약한다.
// storage.js와 마찬가지로 file:// 직접 실행을 지원하기 위해 ES 모듈 대신 전역 네임스페이스를 사용한다.

(function () {
  const { getTrip } = window.TripLog.storage;
  const { ddayLabel } = window.TripLog.util;

  let badgeEl = null;
  let midnightTimer = null;
  const tracked = new Map(); // 자정마다 다시 채울 요소 → 문구를 만드는 함수

  function initDday() {
    badgeEl = document.getElementById("dday-badge");
    render();
    scheduleMidnightRefresh();
  }

  // 여행 정보가 새로 저장된 직후처럼, 자정을 기다리지 않고 즉시 재계산이 필요할 때 호출
  function refreshDday() {
    render();
  }

  // el의 문구를 compute()로 채우고, 자정이 지나면 다시 채운다. 화면에서 사라진 요소는 알아서 목록에서 뺀다.
  // (자정까지 기다리지 않고 track()이 호출될 때마다도 정리해서, my-trip 페이지를 자정 없이 계속 드나들어도
  // 떨어져나간 요소가 쌓이지 않게 한다.)
  function track(el, compute) {
    for (const trackedEl of tracked.keys()) if (!trackedEl.isConnected) tracked.delete(trackedEl);
    tracked.set(el, compute);
    el.textContent = compute();
  }

  function render() {
    for (const [el, compute] of tracked) {
      if (el.isConnected) el.textContent = compute();
      else tracked.delete(el);
    }

    if (!badgeEl) return;
    const trip = getTrip();
    badgeEl.textContent = trip?.startDate ? ddayLabel(trip.startDate) : "D-DAY";
  }

  // 다음 로컬 자정까지의 지연시간을 계산해 재계산을 예약 (DST로 하루가 23/25시간이어도 자정 시각 기준이라 안전)
  function scheduleMidnightRefresh() {
    if (midnightTimer) clearTimeout(midnightTimer);

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const delay = nextMidnight - now;

    midnightTimer = setTimeout(() => {
      render();
      scheduleMidnightRefresh();
    }, delay);
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.dday = {
    initDday,
    refreshDday,
    track,
  };
})();
