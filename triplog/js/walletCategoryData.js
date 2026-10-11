// @별칭 WALLET-CATEGORY-DATA · 여행지갑 카테고리 목록
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행지갑 기능(PRD v7)의 "3. 레이아웃"이 쓰는 카테고리 필터 칩 데이터.
// key는 두 곳(이 파일, supabase/migrations/006_wallet.sql의 wallet_items.category check)에서 정확히 같아야
// 한다: passport/flight/qr/lodging/etc. "전체"(ALL_KEY)는 화면에서만 쓰는 필터용 값이라 DB에는 없다.
//
// expenseCategoryData.js(항공/숙소/교통/식비/쇼핑/투어/기타)와는 다른 목록이다 — 이건 "무슨 문서인지"를
// 나누는 것이고, 그건 "무슨 지출인지"를 나누는 것이라 서로 다른 개념이다. 섞어 쓰지 않는다.
//
// WALLET_VISIBILITY: 개인지갑/공유지갑 구분(PRD 확장 — 문서를 나만 볼지, 이 문서에 연결된 여행의 멤버와
// 볼지). key는 이 파일과 supabase/migrations/007_wallet_shared.sql의 wallet_items.visibility check가 같아야
// 한다: personal/shared. DEFAULT_VISIBILITY(personal)는 업로드 폼이 새로 열릴 때의 기본 선택값이다.

(function () {
  const ALL_KEY = "all";

  // 필터 칩 순서 그대로 (PRD 3번: 전체 / 여권 / 항공권 / QR코드 / 숙소예약 / 기타)
  const WALLET_CATEGORIES = [
    { key: "passport", label: "여권", icon: "🛂" },
    { key: "flight", label: "항공권", icon: "🎫" },
    { key: "qr", label: "QR코드", icon: "🔳" },
    { key: "lodging", label: "숙소예약", icon: "🏨" },
    { key: "etc", label: "기타", icon: "📌" },
  ];

  const WALLET_VISIBILITY = [
    { key: "personal", label: "개인지갑" },
    { key: "shared", label: "공유지갑" },
  ];

  const DEFAULT_VISIBILITY = "personal";

  function getCategoryByKey(key) {
    return WALLET_CATEGORIES.find((c) => c.key === key) ?? null;
  }

  function getVisibilityByKey(key) {
    return WALLET_VISIBILITY.find((v) => v.key === key) ?? null;
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.walletCategoryData = {
    ALL_KEY,
    WALLET_CATEGORIES,
    getCategoryByKey,
    WALLET_VISIBILITY,
    DEFAULT_VISIBILITY,
    getVisibilityByKey,
  };
})();
