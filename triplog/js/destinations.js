// @별칭 DESTINATIONS · 여행지(도시) 목록
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행지 선택 1단계에서 사용하는 지역/도시 데이터.
// 나라·도시를 늘리려면 OVERSEAS_GROUPS에 서브탭을 추가하고 CITIES에 항목을 추가하면 된다.
// wiki: 대표 이미지를 가져올 영문 위키백과 문서 제목

(function () {
  const REGIONS = [
    { id: "overseas", label: "해외" },
    { id: "domestic", label: "국내" },
  ];

  const OVERSEAS_GROUPS = [
    { id: "all", label: "전체" },
    { id: "japan", label: "일본" },
    { id: "sea", label: "동남아시아" },
    { id: "china", label: "중국" },
  ];

  const CITIES = [
    // 일본
    { id: "tokyo", name: "도쿄", country: "일본", region: "overseas", group: "japan", wiki: "Tokyo" },
    { id: "osaka", name: "오사카", country: "일본", region: "overseas", group: "japan", wiki: "Osaka" },
    { id: "kyoto", name: "교토", country: "일본", region: "overseas", group: "japan", wiki: "Kyoto" },
    { id: "fukuoka", name: "후쿠오카", country: "일본", region: "overseas", group: "japan", wiki: "Fukuoka" },
    { id: "sapporo", name: "삿포로", country: "일본", region: "overseas", group: "japan", wiki: "Sapporo" },
    { id: "naha", name: "오키나와(나하)", country: "일본", region: "overseas", group: "japan", wiki: "Naha" },

    // 동남아시아
    { id: "bangkok", name: "방콕", country: "태국", region: "overseas", group: "sea", wiki: "Bangkok" },
    { id: "chiangmai", name: "치앙마이", country: "태국", region: "overseas", group: "sea", wiki: "Chiang_Mai" },
    { id: "danang", name: "다낭", country: "베트남", region: "overseas", group: "sea", wiki: "Da_Nang" },
    { id: "hanoi", name: "하노이", country: "베트남", region: "overseas", group: "sea", wiki: "Hanoi" },
    { id: "hochiminh", name: "호치민", country: "베트남", region: "overseas", group: "sea", wiki: "Ho_Chi_Minh_City" },
    { id: "phuquoc", name: "푸꾸옥", country: "베트남", region: "overseas", group: "sea", wiki: "Phú_Quốc" },
    { id: "cebu", name: "세부", country: "필리핀", region: "overseas", group: "sea", wiki: "Cebu_City" },
    { id: "boracay", name: "보라카이", country: "필리핀", region: "overseas", group: "sea", wiki: "Boracay" },
    { id: "singapore", name: "싱가포르", country: "싱가포르", region: "overseas", group: "sea", wiki: "Singapore" },
    { id: "kualalumpur", name: "쿠알라룸푸르", country: "말레이시아", region: "overseas", group: "sea", wiki: "Kuala_Lumpur" },
    { id: "kotakinabalu", name: "코타키나발루", country: "말레이시아", region: "overseas", group: "sea", wiki: "Kota_Kinabalu" },
    { id: "bali", name: "발리", country: "인도네시아", region: "overseas", group: "sea", wiki: "Bali" },

    // 중국
    { id: "beijing", name: "베이징", country: "중국", region: "overseas", group: "china", wiki: "Beijing" },
    { id: "shanghai", name: "상하이", country: "중국", region: "overseas", group: "china", wiki: "Shanghai" },
    { id: "chengdu", name: "청두", country: "중국", region: "overseas", group: "china", wiki: "Chengdu" },
    { id: "xian", name: "시안", country: "중국", region: "overseas", group: "china", wiki: "Xi'an" },
    { id: "qingdao", name: "칭다오", country: "중국", region: "overseas", group: "china", wiki: "Qingdao" },
    { id: "zhangjiajie", name: "장가계", country: "중국", region: "overseas", group: "china", wiki: "Zhangjiajie" },

    // 국내
    { id: "seoul", name: "서울", country: "대한민국", region: "domestic", group: "korea", wiki: "Seoul" },
    { id: "busan", name: "부산", country: "대한민국", region: "domestic", group: "korea", wiki: "Busan" },
    { id: "jeju", name: "제주", country: "대한민국", region: "domestic", group: "korea", wiki: "Jeju_City" },
    { id: "gangneung", name: "강릉", country: "대한민국", region: "domestic", group: "korea", wiki: "Gangneung" },
    { id: "sokcho", name: "속초", country: "대한민국", region: "domestic", group: "korea", wiki: "Sokcho" },
    { id: "gyeongju", name: "경주", country: "대한민국", region: "domestic", group: "korea", wiki: "Gyeongju" },
    { id: "jeonju", name: "전주", country: "대한민국", region: "domestic", group: "korea", wiki: "Jeonju" },
    { id: "yeosu", name: "여수", country: "대한민국", region: "domestic", group: "korea", wiki: "Yeosu" },
  ];

  function getCities(regionId, groupId) {
    return CITIES.filter(
      (city) => city.region === regionId && (groupId === "all" || city.group === groupId)
    );
  }

  // 도시명·나라·영문명(위키 제목)에 검색어가 포함된 도시를 지역 구분 없이 모두 찾는다
  function searchCities(query) {
    const normalize = (v) => v.toLowerCase().replace(/[\s_]/g, "");
    const q = normalize(query);
    if (!q) return [];
    return CITIES.filter((city) => [city.name, city.country, city.wiki].some((v) => normalize(v).includes(q)));
  }

  function getCityById(id) {
    return CITIES.find((city) => city.id === id) ?? null;
  }

  // 대표 이미지: 위키백과 요약 API의 썸네일. 실패하면 null을 돌려주고 호출부가 플레이스홀더를 보여준다.
  const imageCache = new Map();

  function fetchCityImage(city) {
    if (imageCache.has(city.id)) return imageCache.get(city.id);

    const promise = fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city.wiki)}`
    )
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
    searchCities,
    getCityById,
    fetchCityImage,
  };
})();
