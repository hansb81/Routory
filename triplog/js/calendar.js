// @별칭 CALENDAR · 달력 (여행 기간·숙소 날짜 공용)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 한 달 달력 마크업과 범위(시작~끝) 선택 규칙을 담당하는 공용 컴포넌트.
// 여행 기간 선택(tripSetup)과 체크인/체크아웃 선택(lodging)이 함께 쓴다.
// 이벤트 처리는 각 모듈이 한다: 날짜 버튼은 data-date, 이전/다음 달 버튼은 data-cal-nav(-1 | 1)를 가진다.

(function () {
  const { WEEKDAYS, toDateKey } = window.TripLog.util;

  // start/end: 선택된 범위(YYYY-MM-DD 또는 null), isDisabled(key): 선택 불가 날짜 여부(선택 사항)
  function monthHtml({ year, month, start, end, isDisabled }) {
    const todayKey = toDateKey(new Date());
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(`<span class="cal-cell cal-cell--empty"></span>`);

    for (let d = 1; d <= daysInMonth; d++) {
      const key = toDateKey(new Date(year, month, d));
      const disabled = Boolean(isDisabled?.(key));
      const isStart = key === start;
      const isEnd = key === end;
      const inRange = start && end && key > start && key < end;
      const classes = [
        "cal-cell",
        "cal-day",
        isStart && "cal-day--start",
        isEnd && "cal-day--end",
        inRange && "cal-day--range",
        start && end && (isStart || isEnd || inRange) && "cal-day--in-trip",
        key === todayKey && "cal-day--today",
        disabled && "cal-day--disabled",
      ]
        .filter(Boolean)
        .join(" ");
      cells.push(`<button type="button" class="${classes}" data-date="${key}"${disabled ? " disabled" : ""}>${d}</button>`);
    }

    return `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-cal-nav="-1" aria-label="이전 달">‹</button>
        <span class="cal-month">${year}년 ${month + 1}월</span>
        <button type="button" class="cal-nav" data-cal-nav="1" aria-label="다음 달">›</button>
      </div>
      <div class="cal-grid cal-weekdays">
        ${WEEKDAYS.map((w) => `<span class="cal-cell cal-weekday">${w}</span>`).join("")}
      </div>
      <div class="cal-grid">${cells.join("")}</div>`;
  }

  // 날짜를 눌렀을 때의 새 범위. 처음이거나 범위가 완성된 뒤, 또는 시작일보다 이른 날짜를 누르면 그 날짜부터 다시 시작하고,
  // 시작일을 다시 누르면 끝날짜만 지우고, 그 밖에는 끝날짜로 정한다.
  function pickRange({ start, end }, key) {
    if (!start || end || key < start) return { start: key, end: null };
    if (key === start) return { start, end: null };
    return { start, end: key };
  }

  function shiftMonth({ year, month }, delta) {
    const next = new Date(year, month + delta, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.calendar = { monthHtml, pickRange, shiftMonth };
})();
