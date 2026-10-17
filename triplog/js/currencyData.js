// @별칭 CURRENCY-DATA · 가계부 통화 목록과 KRW 환산율
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 가계부 기능(PRD v6)의 "5-1) 통화 선택" 데이터. 아직 가계부 화면(js/budget.js 등)은 없고,
// 이 파일은 그 화면이 쓸 데이터만 미리 준비해 둔 것이다 (index.html에도 아직 연결하지 않았다).
//
// 통화 선택지는 항상 최대 3개다 (PRD 5-1): 원화(KRW) · 달러(USD) · 여행지 통화. FIXED_CURRENCIES가
// 앞의 둘이고, DESTINATION_CURRENCIES가 "자주 가는 여행지" 통화 목록이다. getCurrencyOptions(country)가
// 여행지 통화가 원화·달러와 겹치면(예: 여행지가 미국) 중복 없이 최대 3개를 돌려준다.
//
// country는 destinations.js의 CITIES 항목이 가진 country와 같은 한글 나라 이름이라서, Trip.destination
// ("도쿄, 일본"처럼 "<도시>, <나라>")에서 콤마 뒤를 잘라 그대로 맞춰 볼 수 있다. destinations.js를
// 읽지는 않는다(이 파일에 의존성이 없어야 어느 화면에서도 쓸 수 있다).
//
// RATES_TO_KRW: 1 단위가 몇 원인지의 대략값이다. 실시간 환율 API는 이번 범위에서 뺐다(PRD 6·7번).
//   ⚠️ 대략값이며, 주기적으로 업데이트가 필요하다. 실제 환율과 차이가 날 수 있으니 정산 등 정확한 금액이
//   필요한 곳에는 쓰지 않는다. (마지막으로 값을 넣은 기준: 2026년 상반기 대략적인 시세)

(function () {
  // 앱 어디서나 고정으로 뜨는 두 통화 (여행지가 어디든 항상 선택지에 있다)
  const FIXED_CURRENCIES = [
    { country: "대한민국", code: "KRW", symbol: "₩", nameKo: "원" },
    { country: "미국", code: "USD", symbol: "$", nameKo: "달러" },
  ];

  // 자주 가는 여행지 10~15곳의 통화 (PRD 7번: 더미로 시작, 필요하면 보강)
  const DESTINATION_CURRENCIES = [
    { country: "일본", code: "JPY", symbol: "¥", nameKo: "엔" },
    { country: "베트남", code: "VND", symbol: "₫", nameKo: "동" },
    { country: "태국", code: "THB", symbol: "฿", nameKo: "바트" },
    { country: "중국", code: "CNY", symbol: "¥", nameKo: "위안" },
    { country: "홍콩", code: "HKD", symbol: "$", nameKo: "홍콩달러" },
    { country: "대만", code: "TWD", symbol: "$", nameKo: "대만달러" },
    { country: "싱가포르", code: "SGD", symbol: "$", nameKo: "싱가포르달러" },
    { country: "말레이시아", code: "MYR", symbol: "RM", nameKo: "링깃" },
    { country: "인도네시아", code: "IDR", symbol: "Rp", nameKo: "루피아" },
    { country: "필리핀", code: "PHP", symbol: "₱", nameKo: "페소" },
    // 유럽(유로존 여러 나라가 함께 쓴다): 여행지 나라 이름이 "프랑스"·"이탈리아"처럼 달라도 찾을 수 있게
    // findByCountry가 countryAliases도 함께 본다
    { country: "유럽", code: "EUR", symbol: "€", nameKo: "유로", countryAliases: ["프랑스", "이탈리아", "스페인", "독일", "포르투갈"] },
    { country: "영국", code: "GBP", symbol: "£", nameKo: "파운드" },
    { country: "호주", code: "AUD", symbol: "$", nameKo: "호주달러" },
  ];

  // 1 단위 = 몇 원인지 (대략값, 주기적 업데이트 필요). KRW는 정의상 1.
  const RATES_TO_KRW = {
    KRW: 1,
    USD: 1350,
    JPY: 9,
    VND: 0.054,
    THB: 38,
    CNY: 190,
    HKD: 173,
    TWD: 42,
    SGD: 1000,
    MYR: 300,
    IDR: 0.085,
    PHP: 24,
    EUR: 1470,
    GBP: 1720,
    AUD: 890,
  };

  const ALL_CURRENCIES = [...FIXED_CURRENCIES, ...DESTINATION_CURRENCIES];

  function findByCode(code) {
    return ALL_CURRENCIES.find((c) => c.code === code) ?? null;
  }

  // Trip.destination의 나라 이름(예: "도쿄, 일본"의 "일본")으로 여행지 통화를 찾는다. 없으면 null.
  function findByCountry(country) {
    if (!country) return null;
    return DESTINATION_CURRENCIES.find((c) => c.country === country || c.countryAliases?.includes(country)) ?? null;
  }

  // PRD 5-1의 "원화, 달러, 여행지 통화 3개(중복 제외)" 선택지. country는 나라 이름(findByCountry 참고).
  function getCurrencyOptions(country) {
    const options = [...FIXED_CURRENCIES];
    const destCurrency = findByCountry(country);
    if (destCurrency && !options.some((c) => c.code === destCurrency.code)) options.push(destCurrency);
    return options;
  }

  // PRD v12(여행지 확장) 이후: destinations/trips가 이미 확정해 둔 ISO 통화 코드로 바로 선택지를 만든다 -
  // 나라 이름을 이 파일의 13개국 표와 맞춰보는 getCurrencyOptions와 달리, 그 표에 없는 통화(체코 CZK,
  // 스위스 CHF 등)도 code만 맞으면 선택지에 들어간다. 표에 있으면(findByCode) 기호·한글 이름을 쓰고,
  // 없으면 기호·이름 자리에 코드 자체를 보여준다(countryLabel은 formatOption의 "국가명" 자리에 쓸 값 -
  // trip.destination 문자열의 나라 이름을 그대로 넘기면 된다). code가 없으면(통화를 모르는 나라) 원화·
  // 달러 2개만 돌려준다.
  function getCurrencyOptionsByCode(code, countryLabel) {
    const options = [...FIXED_CURRENCIES];
    if (!code) return options;
    const destCurrency = findByCode(code) ?? { country: countryLabel ?? code, code, symbol: code, nameKo: code };
    if (!options.some((c) => c.code === destCurrency.code)) options.push(destCurrency);
    return options;
  }

  // 환율표에 없는 통화면 null (호출한 쪽에서 "환산 안 됨"으로 처리해야 한다)
  function getRateToKrw(code) {
    return RATES_TO_KRW[code] ?? null;
  }

  // amount(그 통화 금액) → KRW 근사값. 소수점은 원 단위로 반올림한다. 환율을 모르면 null.
  function toKrw(amount, code) {
    const rate = getRateToKrw(code);
    if (typeof rate !== "number" || !Number.isFinite(amount)) return null;
    return Math.round(amount * rate);
  }

  // "국가명 - 통화기호(통화기호 한글)" 형식 (PRD 5-1 예시: "미국 - $(달러)")
  function formatOption(currency) {
    return `${currency.country} - ${currency.symbol}(${currency.nameKo})`;
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.currencyData = {
    FIXED_CURRENCIES,
    DESTINATION_CURRENCIES,
    RATES_TO_KRW,
    findByCode,
    findByCountry,
    getCurrencyOptions,
    getCurrencyOptionsByCode,
    toKrw,
    formatOption,
  };
})();
