// @별칭 MYTRIP-DATA · 카테고리 아이콘·이름
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 원래는 나의 여행 화면의 카테고리 탭·추천 카드 더미 데이터까지 있었지만, 그 화면 내용이 정리되면서
// 지금은 tripImportPreview.js가 쓰는 카테고리 아이콘·이름(CATEGORY_META)만 남아 있다.
// 색은 style.css의 [data-category] → --cat-color가 정한다.

(function () {
  const CATEGORY_META = {
    all: { icon: "🧭", label: "전체" },
    flight: { icon: "✈️", label: "항공" },
    lodging: { icon: "🏨", label: "숙소" },
    meal: { icon: "🍽️", label: "식사" },
    sightseeing: { icon: "📷", label: "관광" },
    shopping: { icon: "🛍️", label: "쇼핑" },
    etc: { icon: "📌", label: "기타" },
  };

  window.TripLog = window.TripLog || {};
  window.TripLog.myTripData = { CATEGORY_META };
})();
