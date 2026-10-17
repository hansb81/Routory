// @별칭 DESTINATIONS · 여행지(도시) 목록
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행지 선택 1단계에서 쓰는 지역/도시 데이터 (PRD v12 - 여행지 확장·도시 검색).
//
// 1차 탭은 해외/국내(해외가 먼저), 해외를 고르면 2차 탭(OVERSEAS_GROUPS)으로 10개 지역이 더 나온다 -
// 기존(PRD v12 이전) 2단 구조로 되돌린 것. 국내는 이번 작업에서도 안 건드린다: 여전히 이 파일의 코드
// 상수(DOMESTIC_CITIES)다. 해외 10개 지역(일본/동남아/중국/대만/유럽/북미/오세아니아/중동/중미·카리브/
// 남미)은 코드 상수가 아니라 Supabase destinations 테이블(source='preset', 014~016_destinations*.sql)에서
// 불러온다 - 앱 배포 없이 서버에서 도시를 추가·수정할 수 있게 하기 위해서다. 좌표·시간대는 목록 표시에
// 쓰지 않는다(이름·대표 이미지만) - 실제 확정은 도시를 고를 때 search-destination의 select 액션이 한다
// (tripSetup.js#resolveCity).

(function () {
  const supabase = window.TripLog.supabase;

  // 국내 탭 (기존 그대로 - 좌표 없음, 위키 썸네일만)
  const DOMESTIC_CITIES = [
    { id: "seoul", name: "서울", country: "대한민국", region: "domestic", wiki: "Seoul" },
    { id: "busan", name: "부산", country: "대한민국", region: "domestic", wiki: "Busan" },
    { id: "jeju", name: "제주", country: "대한민국", region: "domestic", wiki: "Jeju_City" },
    { id: "gangneung", name: "강릉", country: "대한민국", region: "domestic", wiki: "Gangneung" },
    { id: "sokcho", name: "속초", country: "대한민국", region: "domestic", wiki: "Sokcho" },
    { id: "gyeongju", name: "경주", country: "대한민국", region: "domestic", wiki: "Gyeongju" },
    { id: "jeonju", name: "전주", country: "대한민국", region: "domestic", wiki: "Jeonju" },
    { id: "yeosu", name: "여수", country: "대한민국", region: "domestic", wiki: "Yeosu" },
  ];

  // 1차 탭: 기존처럼 해외/국내로 나누고 해외가 먼저 (요청대로 되돌림)
  const REGIONS = [
    { id: "overseas", label: "해외" },
    { id: "domestic", label: "국내" },
  ];

  // 2차 탭: 해외를 골랐을 때만 보이는 지역 그룹 (PRD v12 2번, 이용 빈도 순)
  const OVERSEAS_GROUPS = [
    { id: "japan", label: "일본" },
    { id: "sea", label: "동남아" },
    { id: "china", label: "중국" },
    { id: "taiwan", label: "대만" },
    { id: "europe", label: "유럽" },
    { id: "north_america", label: "북미" },
    { id: "oceania", label: "오세아니아" },
    { id: "middle_east", label: "중동" },
    { id: "central_america_caribbean", label: "중미·카리브" },
    { id: "south_america", label: "남미" },
  ];

  // country_currency(014_destinations.sql)의 국가명 중, 이번 프리셋 70개가 실제로 쓰는 나라만 (목록 표시용)
  const COUNTRY_LABELS = {
    JP: "일본", TH: "태국", VN: "베트남", PH: "필리핀", SG: "싱가포르", MY: "말레이시아", ID: "인도네시아",
    CN: "중국", TW: "대만",
    FR: "프랑스", GB: "영국", IT: "이탈리아", ES: "스페인", CZ: "체코", CH: "스위스", AT: "오스트리아",
    US: "미국", CA: "캐나다",
    AU: "호주", NZ: "뉴질랜드", GU: "괌", MP: "북마리아나제도(사이판)",
    AE: "아랍에미리트", TR: "터키", QA: "카타르", IL: "이스라엘", EG: "이집트",
    MX: "멕시코", CU: "쿠바", DO: "도미니카공화국", PA: "파나마", CR: "코스타리카",
    BR: "브라질", AR: "아르헨티나", PE: "페루", CL: "칠레", CO: "콜롬비아",
  };
  const countryLabel = (code) => COUNTRY_LABELS[code] ?? code;

  // ---- 해외 프리셋 로딩 (destinations 테이블) ----

  let presetCities = null; // 로딩 끝나면 배열, 그 전엔 null
  let presetLoadError = null;
  let presetLoadPromise = null;

  function presetCityFromRow(row) {
    return {
      id: row.id, // uuid
      name: row.name_ko,
      nameEn: row.name_en,
      country: countryLabel(row.country_code),
      region: row.region,
      isDbPreset: true, // 국내(DOMESTIC_CITIES)와 구분용 - select 액션 호출이 필요한 쪽
      wiki: row.name_en?.replace(/ /g, "_"), // 대표 이미지(fetchCityImage)용 - 영문 위키 제목 추정값. 없거나 틀려도(동명이인 등) 이미지만 안 나오고 조용히 넘어간다
    };
  }

  // 여러 곳에서 동시에 불러도 요청은 한 번만 나간다. 실패해도 다시 던지지 않고 presetLoadError만 남긴다
  // (호출한 쪽이 getPresetLoadError()로 확인해서 재시도 버튼을 보여준다).
  function loadPresets() {
    if (presetCities) return Promise.resolve(presetCities);
    if (presetLoadPromise) return presetLoadPromise;

    presetLoadError = null;
    presetLoadPromise = supabase
      .from("destinations")
      .select("id,name_ko,name_en,country_code,region,sort_order")
      .eq("source", "preset")
      .order("region", { ascending: true })
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        presetLoadPromise = null;
        if (error) {
          presetLoadError = "여행지 목록을 불러오지 못했어요.";
          return [];
        }
        presetCities = (data ?? []).map(presetCityFromRow);
        return presetCities;
      })
      .catch(() => {
        presetLoadPromise = null;
        presetLoadError = "여행지 목록을 불러오지 못했어요.";
        return [];
      });
    return presetLoadPromise;
  }

  const isPresetsLoaded = () => presetCities !== null;
  const getPresetLoadError = () => presetLoadError;

  // 실패 후 재시도: 상태를 "로딩 전"으로 되돌리고 다시 불러온다
  function retryLoadPresets() {
    presetCities = null;
    presetLoadError = null;
    return loadPresets();
  }

  // ---- 조회 ----

  // regionId가 "domestic"이면 groupId는 보지 않는다(국내는 하위 탭이 없다). "overseas"면 groupId(지역
  // 그룹 키 - OVERSEAS_GROUPS 참고)로 좁힌다.
  function getCities(regionId, groupId) {
    if (regionId === "domestic") return DOMESTIC_CITIES;
    return (presetCities ?? []).filter((city) => city.region === groupId);
  }

  function getCityById(id) {
    return DOMESTIC_CITIES.find((city) => city.id === id) ?? (presetCities ?? []).find((city) => city.id === id) ?? null;
  }

  // 대표 이미지: 위키백과 요약 API의 썸네일(저작권 걱정 없는 자유 이용 라이선스 이미지만 올라가는 곳) -
  // city.wiki(영문 위키 제목)가 있는 도시만. 국내는 미리 정해둔 제목, 해외 프리셋은 name_en에서 추정한
  // 제목이라 가끔 틀리거나(동명이인 등) 못 찾을 수 있는데, 그러면 썸네일 없이 기본 핀 아이콘으로 조용히
  // 넘어간다(실패를 에러로 다루지 않는다).
  const imageCache = new Map();

  function fetchCityImage(city) {
    if (!city.wiki) return Promise.resolve(null);
    if (imageCache.has(city.id)) return imageCache.get(city.id);

    const promise = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city.wiki)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.thumbnail?.source ?? null)
      .catch(() => null);

    // 일시적으로 실패한(null) 결과는 캐시에 남기지 않아서, 다음에 목록을 열 때 다시 시도한다
    promise.then((url) => {
      if (!url) imageCache.delete(city.id);
    });
    imageCache.set(city.id, promise);
    return promise;
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.destinations = {
    REGIONS,
    OVERSEAS_GROUPS,
    getCities,
    getCityById,
    fetchCityImage,
    loadPresets,
    isPresetsLoaded,
    getPresetLoadError,
    retryLoadPresets,
    countryLabel, // travelFeed.js의 '어디로 떠나볼까요' 카드가 country_code만 갖고 있어서 재사용한다 - 이 70개
    // 프리셋 국가 밖이면(관리자가 임의 국가코드를 넣은 경우) 코드를 그대로 보여준다(위 countryLabel 정의 참고)
  };
})();
