// @별칭 LODGING-DATA · 숙소 검색 (구글 장소)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 숙소 검색(지도에서 찾기) 조회. Google Places(New)를 쓴다 (googleMaps.js를 통해서, 인터넷 연결 필요).
// - 지도에서 찾기: 검색은 숙소 유형으로만 찾되(findOnMap) 숙소로 안 잡히는 곳(에어비앤비 등)은 주소
//   지오코딩으로 대신 위치만 찾아준다. 지도에 주변 숙소를 마커로 미리 깔아 두던 기능(인기 숙소 포함)은
//   빠졌다 - 검색해서 고른 숙소만 지도에 표시한다.
// Places 콘텐츠는 이용약관상 저장소에 오래 보관하면 안 되므로, 같은 화면을 다시 열 때 쓰는 메모리 캐시만 둔다.

(function () {
  const gmaps = window.TripLog.googleMaps;

  const SEARCH_RADIUS_M = 30000;
  const LODGING = "lodging";

  // 예전 버전이 localStorage에 남겨 둔 OpenStreetMap 기반 인기 숙소 캐시는 더 쓰지 않으므로 지운다
  try {
    localStorage.removeItem("triplog.lodging.popular");
  } catch (err) {
    /* 저장소를 못 쓰는 환경이면 지울 것도 없다 */
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const a =
      Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
  }

  // "오사카, 일본" → "오사카"
  function placeName(trip) {
    return (trip?.destination ?? "").split(",")[0].trim();
  }

  async function getCenter(trip) {
    const destination = trip?.destination ?? "";
    return destination ? gmaps.geocodeAddress(destination) : null;
  }

  function toItem(place, center) {
    return {
      id: place.id,
      placeId: place.id,
      name: place.name,
      subName: "",
      typeLabel: place.typeLabel || "숙소",
      rating: place.rating,
      ratingCount: place.ratingCount,
      address: place.address,
      distanceKm: center ? haversineKm(center.lat, center.lng, place.lat, place.lng) : null,
      lat: place.lat,
      lng: place.lng,
    };
  }

  // 검색어 앞에 도시 이름을 붙여서(이미 있으면 그대로 둔다) 그 도시의 숙소로 좁힌 뒤 lodging 유형만 찾는다
  async function searchLodgingNear(center, cityName, rawQuery) {
    const textQuery = !cityName || rawQuery.includes(cityName) ? rawQuery : `${cityName} ${rawQuery}`;
    const places = await gmaps.searchText(textQuery, {
      center,
      radius: SEARCH_RADIUS_M,
      includedType: LODGING,
      max: 20,
    });
    return places.map((p) => toItem(p, center));
  }

  // 지도에서 찾기의 검색창: 숙소 유형으로만 찾는다. 결과가 없으면(에어비앤비처럼 숙소로 안 잡히는 곳일 수
  // 있어서) 주소로라도 위치를 찾아 "주소로 찾은 위치"를 하나 돌려준다 — 진짜 숙소인지는 확인되지 않은
  // 채로 사용자가 직접 고르는 값이라 isAddressOnly로 표시해 둔다.
  async function findOnMap(center, cityName, rawQuery) {
    try {
      const items = await searchLodgingNear(center, cityName, rawQuery);
      if (items.length) return { status: "ok", items };

      const point = await gmaps.geocodeAddress(rawQuery);
      if (!point) return { status: "ok", items: [] };
      return {
        status: "ok",
        items: [
          {
            id: null,
            placeId: null,
            name: rawQuery,
            subName: "",
            typeLabel: "주소로 찾은 위치",
            rating: null,
            ratingCount: 0,
            address: null,
            distanceKm: haversineKm(center.lat, center.lng, point.lat, point.lng),
            lat: point.lat,
            lng: point.lng,
            isAddressOnly: true,
          },
        ],
      };
    } catch (err) {
      console.warn("[lodging] 지도 검색 실패", err);
      return { status: "error", items: [], message: gmaps.errorMessage(err) };
    }
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.lodgingData = { findOnMap, getCenter, placeName };
})();
