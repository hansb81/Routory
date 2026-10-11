// @별칭 EXPENSE-CATEGORY-DATA · 가계부 지출 카테고리 목록
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 가계부 기능(PRD v6)의 "5-5) 카테고리" 데이터. 아직 가계부 화면은 없고, 이 파일은 그 화면과
// supabase/migrations/005_budget.sql(expenses.category의 check 제약)이 함께 쓸 7개 값을 미리 정의해 둔다.
// key는 두 곳(이 파일, 005_budget.sql)에서 정확히 같아야 한다: flight/lodging/transport/meal/shopping/tour/etc.
//
// myTripData.js에도 CATEGORY_META(전체/항공/숙소/식사/관광/쇼핑/기타)가 있지만, 그건 나의 여행 화면의
// 추천 목록 카테고리라서 이것과는 다른 목록이다(예: "교통"·"투어"가 없고 "관광"이 있다). 섞어 쓰지 않는다.

(function () {
  // 가로 스크롤 칩으로 보여줄 순서 그대로 (PRD 5-5)
  const EXPENSE_CATEGORIES = [
    { key: "flight", label: "항공", icon: "✈️" },
    { key: "lodging", label: "숙소", icon: "🏨" },
    { key: "transport", label: "교통", icon: "🚗" },
    { key: "meal", label: "식비", icon: "🍽️" },
    { key: "shopping", label: "쇼핑", icon: "🛍️" },
    { key: "tour", label: "투어", icon: "🎫" },
    { key: "etc", label: "기타", icon: "📌" },
  ];

  function getCategoryByKey(key) {
    return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? null;
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.expenseCategoryData = { EXPENSE_CATEGORIES, getCategoryByKey };
})();
