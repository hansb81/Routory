// @별칭 GOOGLE-MAPS · 구글 지도·장소 검색 호출
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// Google Maps Platform 연동을 한곳에 모은 모듈: Maps JavaScript API 로더와 Geocoding·Places(New) 조회.
// 지도가 필요한 모든 기능(지도에서 장소 선택, 숙소 검색·인기 숙소)이 이 모듈만 통해서 구글을 쓴다.
// 결과는 구글 객체가 아니라 평범한 { name, lat, lng, ... } 객체로 돌려줘서 호출부가 구글 타입에 묶이지 않게 한다.
// API 키는 config.js의 TripLogConfig.googleMapsApiKey.

(function () {
  const PLACE_FIELDS = [
    "id",
    "displayName",
    "location",
    "rating",
    "userRatingCount",
    "shortFormattedAddress",
    "primaryType",
    "primaryTypeDisplayName",
  ];

  let loading = null;
  const authFailureListeners = [];
  const geocodeCache = new Map();

  class MapsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // ---- 로더 ----

  function isReady() {
    return Boolean(window.google?.maps?.importLibrary);
  }

  // Maps JavaScript API 스크립트를 처음 필요할 때 한 번만 불러온다 (지도를 열기 전에는 요청도 요금도 없다)
  function load() {
    if (isReady()) return Promise.resolve(window.google.maps);
    if (loading) return loading;

    const key = window.TripLogConfig?.googleMapsApiKey;
    if (!key) return Promise.reject(new MapsError("NO_KEY", "Google 지도 API 키가 설정되지 않았어요."));

    loading = new Promise((resolve, reject) => {
      // 키가 잘못됐거나 허용되지 않은 주소에서 열면 스크립트는 로드되고, 그 뒤에 구글이 이 함수를 부른다
      window.gm_authFailure = () => authFailureListeners.forEach((fn) => fn());

      window.__triplogGoogleMapsReady = () => resolve(window.google.maps);
      const script = document.createElement("script");
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
        `&loading=async&v=weekly&language=ko&callback=__triplogGoogleMapsReady`;
      script.async = true;
      script.onerror = () => reject(new MapsError("LOAD_FAILED", "Google 지도 스크립트를 불러오지 못했어요."));
      document.head.appendChild(script);
    });
    loading.catch(() => {
      loading = null; // 실패하면 다음에 다시 시도할 수 있게 한다
    });
    return loading;
  }

  async function library(name) {
    await load();
    return window.google.maps.importLibrary(name);
  }

  function onAuthFailure(listener) {
    authFailureListeners.push(listener);
  }

  // 화면에 그대로 보여줄 수 있는 한국어 안내 (원인별)
  function errorMessage(err) {
    const code = err?.code ?? "";
    const text = String(err?.message ?? err ?? "");
    if (code === "NO_KEY") return "Google 지도 API 키가 설정되지 않았어요. js/config.js를 확인해주세요.";
    if (code === "LOAD_FAILED") return "Google 지도를 불러오지 못했어요. 인터넷 연결을 확인해주세요.";
    if (code === "AUTH_FAILED" || /referer|api ?key|InvalidKey/i.test(text)) {
      return "Google 지도 API 키 인증에 실패했어요. 키의 사용 제한(허용 주소)을 확인해주세요.";
    }
    if (/PERMISSION_DENIED|REQUEST_DENIED|not activated|not enabled|has not been used/i.test(text)) {
      return "Google 지도 API가 사용 설정되어 있지 않아요. Geocoding API와 Places API (New)를 확인해주세요.";
    }
    if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|quota/i.test(text)) {
      return "Google 지도 API 사용량 한도를 넘었어요. 잠시 뒤 다시 시도해주세요.";
    }
    return "Google 지도 요청에 실패했어요. 잠시 뒤 다시 시도해주세요.";
  }

  // 키의 허용 주소에 맞지 않는 곳에서 부르면 Geocoder가 오류 없이 빈 응답을 돌려준다 → 인증 실패로 안내한다
  function requireResponse(response) {
    if (!response) throw new MapsError("AUTH_FAILED", "Geocoding 응답이 비어 있어요.");
    return response;
  }

  const isZeroResults = (err) => /ZERO_RESULTS/.test(String(err?.code ?? err?.message ?? err));

  // ---- Geocoding ----

  // 주소·여행지 이름 → { lat, lng }. 결과가 없으면 null. 같은 주소는 다시 묻지 않는다.
  async function geocodeAddress(address) {
    if (geocodeCache.has(address)) return geocodeCache.get(address);
    const { Geocoder } = await library("geocoding");
    let result = null;
    try {
      const { results } = requireResponse(await new Geocoder().geocode({ address }));
      const location = results?.[0]?.geometry?.location;
      result = location ? { lat: location.lat(), lng: location.lng() } : null;
    } catch (err) {
      if (!isZeroResults(err)) throw err;
    }
    geocodeCache.set(address, result);
    return result;
  }

  // 좌표 → 주소 문자열 (없으면 null)
  async function reverseGeocode(lat, lng) {
    const { Geocoder } = await library("geocoding");
    try {
      const { results } = requireResponse(await new Geocoder().geocode({ location: { lat, lng } }));
      // 플러스 코드("8Q7X+...")만 있는 결과(바다 한가운데 등)는 사람이 읽을 수 없어서 결과 없음으로 본다
      const best = (results ?? []).find((r) => !r.types?.includes("plus_code"));
      // 주소 맨 앞에 붙는 플러스 코드("2VH2+4WM, ")는 떼고 사람이 읽는 주소만 남긴다
      return best?.formatted_address?.replace(/^[0-9A-Z]{4,8}\+[0-9A-Z]{2,4},?\s*/, "") || null;
    } catch (err) {
      if (isZeroResults(err)) return null;
      throw err;
    }
  }

  // ---- Places (New) ----

  function toPlace(p) {
    return {
      id: p.id,
      name: p.displayName ?? "",
      address: p.shortFormattedAddress ?? "",
      lat: p.location?.lat(),
      lng: p.location?.lng(),
      rating: typeof p.rating === "number" ? p.rating : null,
      ratingCount: p.userRatingCount ?? 0,
      primaryType: p.primaryType ?? "",
      typeLabel: p.primaryTypeDisplayName ?? "",
    };
  }

  // 지도에 보이는 장소(POI)를 눌렀을 때 그 장소의 이름과 좌표를 가져온다
  async function placeDetails(placeId) {
    const { Place } = await library("places");
    const place = new Place({ id: placeId, requestedLanguage: "ko" });
    await place.fetchFields({ fields: ["displayName", "location", "formattedAddress"] });
    return {
      name: place.displayName ?? "",
      address: place.formattedAddress ?? "",
      lat: place.location.lat(),
      lng: place.location.lng(),
    };
  }

  // 검색어로 장소 찾기. center/radius가 있으면 그 주변을 우선한다.
  // includedType(예: "lodging")을 주면 그 유형만 돌려준다.
  async function searchText(query, { center, radius = 20000, includedType, max = 10 } = {}) {
    const { Place } = await library("places");
    const request = { textQuery: query, fields: PLACE_FIELDS, language: "ko", maxResultCount: max };
    if (center) request.locationBias = { center, radius };
    if (includedType) {
      request.includedType = includedType;
      request.useStrictTypeFiltering = true;
    }
    const { places } = await Place.searchByText(request);
    return places.map(toPlace);
  }

  // center 주변(radius 미터 안)의 장소를 인기순으로 찾는다. types는 구글 장소 유형 목록.
  // includedTypes가 아니라 includedPrimaryTypes를 쓴다: Places API(New)의 "types"는 장소가 겸하는 모든
  // 유형을 담고 있어서(예: 백화점 안 식당가 때문에 "니혼바시 다카시마야" 같은 백화점도 types 배열에
  // "restaurant"가 섞여 들어간다), includedTypes(어느 하나라도 포함되면 매치)로 필터링하면 "restaurant"를
  // 요청했는데 primaryType이 department_store/store인 결과가 섞여 나온다 - 실제로 확인한 문제다(2026-09-30,
  // 나의 여행 화면 "주변 맛집/볼거리" 카드가 도쿄역 근처에서 백화점·영화관만 보여주는 걸로 발견). primaryType
  // 하나만 보는 includedPrimaryTypes로 바꾸면 실제로 식당/카페/관광명소인 장소만 온다.
  async function searchNearby({ center, radius, types, max = 20 }) {
    const { Place, SearchNearbyRankPreference } = await library("places");
    const { places } = await Place.searchNearby({
      fields: PLACE_FIELDS,
      locationRestriction: { center, radius },
      includedPrimaryTypes: types,
      maxResultCount: max,
      language: "ko",
      rankPreference: SearchNearbyRankPreference.POPULARITY,
    });
    return places.map(toPlace);
  }

  // ---- Routes (Distance Matrix) ----

  // origin({lat,lng}) → destination(주소 문자열 또는 {lat,lng}) 자동차 이동 시간. 구글이 경로를 못 찾으면(공항
  // 이름을 못 알아듣는 등) null. Distance Matrix API를 따로 사용 설정해야 한다 (config.js 맨 위 주석 참고).
  async function travelDurationTo(origin, destination) {
    const { DistanceMatrixService, TravelMode } = await library("routes");
    const response = await new DistanceMatrixService().getDistanceMatrix({
      origins: [origin],
      destinations: [destination],
      travelMode: TravelMode.DRIVING,
      language: "ko",
    });
    const element = response?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") return null;
    return {
      durationText: element.duration?.text ?? null,
      durationSeconds: element.duration?.value ?? null,
      distanceText: element.distance?.text ?? null,
    };
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.googleMaps = {
    load,
    onAuthFailure,
    errorMessage,
    geocodeAddress,
    reverseGeocode,
    placeDetails,
    searchText,
    searchNearby,
    travelDurationTo,
  };
})();
