// @별칭 UTIL · 공용 도구 (날짜 계산·id·문자 이스케이프)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여러 모듈이 함께 쓰는 작은 유틸. 다른 스크립트보다 먼저 로드돼야 한다.

(function () {
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // 로컬 타임존 기준 "YYYY-MM-DD"
  function toDateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // "2026-11-14" → "11.14"
  function shortDate(key) {
    const [, m, d] = key.split("-");
    return `${Number(m)}.${Number(d)}`;
  }

  // "2026-11-14" + 2 → "2026-11-16" (offset이 음수면 이전 날짜도 된다)
  function addDays(dateKey, offset) {
    const d = new Date(`${dateKey}T00:00:00`);
    d.setDate(d.getDate() + offset);
    return toDateKey(d);
  }

  function nightsBetween(fromKey, toKey) {
    return Math.round((new Date(`${toKey}T00:00:00Z`) - new Date(`${fromKey}T00:00:00Z`)) / 86400000);
  }

  // 오늘부터 dateKey까지 남은 일수 (오늘이면 0, 지났으면 음수). 로컬 타임존 자정 기준.
  function daysUntil(dateKey) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((new Date(`${dateKey}T00:00:00`) - today) / 86400000);
  }

  // 시작일 기준 D-day 표기: "D-55" | "D-DAY" | "D+3"
  function ddayLabel(startDate) {
    const days = daysUntil(startDate);
    if (days > 0) return `D-${days}`;
    return days === 0 ? "D-DAY" : `D+${-days}`;
  }

  // 여행 시작일~종료일의 모든 날짜. number는 Day 번호, label은 "11.14(토)"
  function getTripDays(trip) {
    if (!trip?.startDate) return [];
    const start = new Date(`${trip.startDate}T00:00:00`);
    const end = trip.endDate ? new Date(`${trip.endDate}T00:00:00`) : start;
    if (Number.isNaN(start.getTime())) return [];

    const days = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      days.push({
        date: toDateKey(cursor),
        number: days.length + 1,
        label: `${cursor.getMonth() + 1}.${cursor.getDate()}(${WEEKDAYS[cursor.getDay()]})`,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  // 두 좌표({lat, lng}) 사이의 직선거리(km). 지도상 최단거리(대원거리)를 구하는 haversine 공식.
  // dayMap.js(지도 마커)와 app.js(타임라인 카드 사이 거리 표시)가 함께 쓴다.
  function haversineKm(a, b) {
    const toRad = (v) => (v * Math.PI) / 180;
    const h =
      Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.util = {
    WEEKDAYS,
    escapeHtml,
    generateId,
    pad,
    toDateKey,
    shortDate,
    addDays,
    nightsBetween,
    daysUntil,
    ddayLabel,
    getTripDays,
    haversineKm,
  };
})();
