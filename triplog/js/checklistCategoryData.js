// @별칭 CHECKLIST-CATEGORY-DATA · 체크리스트 기본 카테고리 · 기본 항목 목록
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 체크리스트 기능이 여행마다 처음 한 번만 깔아 주는 기본 카테고리 2개(할 일/준비물)와 그 안의 기본 항목.
// 카테고리는 더 이상 고정된 키가 아니라 supabase/migrations/038_checklist.sql의 checklist_categories
// 테이블 행(trip마다 따로) - 사용자가 체크리스트 화면에서 "+"로 더 추가하거나 스와이프로 지울 수 있다.
// 여기 있는 라벨/항목은 "처음 한 번 심을 값"일 뿐이고, storage.js#ensureChecklistSeeded가 checklist_seeds
// 마커 기준으로 딱 한 번만 쓴다 - 이 파일을 나중에 바꿔도 이미 시딩된 여행에는 영향이 없다.

(function () {
  const DEFAULT_CHECKLIST_CATEGORIES = [
    { label: "할 일", defaultItems: ["여행자 보험 가입", "트래블 카드 신청", "호텔 찾기", "항공권 예약"] },
    { label: "준비물", defaultItems: ["핸드폰 충전기", "여권", "보조배터리", "수영복", "상비약"] },
  ];

  window.TripLog = window.TripLog || {};
  window.TripLog.checklistCategoryData = { DEFAULT_CHECKLIST_CATEGORIES };
})();
