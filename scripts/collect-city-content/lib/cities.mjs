// discover_cities 조회 공통 헬퍼 - collect-months.mjs/collect-highlights.mjs가 둘 다 쓴다.
//
// is_active 여부로 거르지 않는다(collect-city-images/collect.mjs와 같은 이유) - "승인 대기" 상태인
// 도시도 게시 전에 콘텐츠를 채워야 하므로 대상에서 빼면 안 된다.
//
// destinations.lat/lng가 없는 행은 기후/지오서치 둘 다 쓸 수 없어 처음부터 제외한다 - discover_cities에
// 연결되는 도시는 search-destination의 select 액션을 거쳐야만 저장되고, 그 액션은 좌표를 못 구하면 저장
// 자체를 실패시키므로(027_discover_cities.sql 주석 참고) 정상적으로는 전부 좌표가 있어야 한다. 그래도
// 방어적으로 한 번 더 걸러낸다.
export async function fetchCities(supabase, cityFilter) {
  const { data, error } = await supabase
    .from("discover_cities")
    .select("id, is_active, destinations(id, name_ko, name_en, country_code, lat, lng)");
  if (error) throw error;

  const rows = (data || [])
    .filter((row) => row.destinations && row.destinations.lat != null && row.destinations.lng != null)
    .map((row) => ({
      cityId: row.id,
      isActive: row.is_active,
      nameKo: row.destinations.name_ko,
      nameEn: row.destinations.name_en,
      countryCode: row.destinations.country_code,
      lat: row.destinations.lat,
      lng: row.destinations.lng,
    }));

  if (!cityFilter) return rows;
  return rows.filter((row) => row.nameEn.toLowerCase().includes(cityFilter));
}
