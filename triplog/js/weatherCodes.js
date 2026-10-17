// @별칭 WEATHER-CODES · 날씨 코드 라벨
// WMO 날씨 코드(open-meteo) -> 한글 아이콘/라벨 매핑을 한 곳의 상수로 모아 둔다. '어디로 떠나볼까요' 도시
// 카드가 city_weather_cache.weather_code(refresh-city-weather Edge Function이 Open-Meteo에서 받아 캐시한
// 값)를 "맑음"/"비" 같은 문구로 보여줄 때 이 모듈을 쓴다.
//
// myTripPage.js#WEATHER_CODE_LABELS와 값이 완전히 같다(둘 다 open-meteo의 같은 코드 체계). 그 파일은
// 이미 동작 중인 기존 날씨 카드라 이번 작업 범위에서는 건드리지 않고 그대로 뒀다 — 지금은 같은 매핑이
// 두 곳에 있는 상태다. 나중에 myTripPage.js도 이 모듈을 쓰도록 통합할 수 있지만, 그건 별도 리팩터링
// 작업이다.
//
// index.html에서 travelFeed.js 바로 앞에 로드된다(travelFeed.js#discoverCardHtml/renderDiscoverDetail이 쓴다).

(function () {
  const WEATHER_CODE_LABELS = {
    0: { icon: "☀️", label: "맑음" },
    1: { icon: "🌤️", label: "대체로 맑음" },
    2: { icon: "⛅", label: "구름 조금" },
    3: { icon: "☁️", label: "흐림" },
    45: { icon: "🌫️", label: "안개" },
    48: { icon: "🌫️", label: "안개" },
    51: { icon: "🌦️", label: "약한 이슬비" },
    53: { icon: "🌦️", label: "이슬비" },
    55: { icon: "🌦️", label: "강한 이슬비" },
    56: { icon: "🌦️", label: "언 이슬비" },
    57: { icon: "🌦️", label: "언 이슬비" },
    61: { icon: "🌧️", label: "약한 비" },
    63: { icon: "🌧️", label: "비" },
    65: { icon: "🌧️", label: "강한 비" },
    66: { icon: "🌧️", label: "언 비" },
    67: { icon: "🌧️", label: "언 비" },
    71: { icon: "🌨️", label: "약한 눈" },
    73: { icon: "🌨️", label: "눈" },
    75: { icon: "🌨️", label: "강한 눈" },
    77: { icon: "🌨️", label: "싸락눈" },
    80: { icon: "🌦️", label: "약한 소나기" },
    81: { icon: "🌦️", label: "소나기" },
    82: { icon: "🌦️", label: "강한 소나기" },
    85: { icon: "🌨️", label: "약한 소낙눈" },
    86: { icon: "🌨️", label: "소낙눈" },
    95: { icon: "⛈️", label: "뇌우" },
    96: { icon: "⛈️", label: "우박 동반 뇌우" },
    99: { icon: "⛈️", label: "우박 동반 뇌우" },
  };

  function weatherLabel(code) {
    return WEATHER_CODE_LABELS[code] ?? { icon: "🌡️", label: "정보 없음" };
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.weatherCodes = { WEATHER_CODE_LABELS, weatherLabel };
})();
