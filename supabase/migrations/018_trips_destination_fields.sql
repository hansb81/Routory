-- 018_trips_destination_fields: trips.lat/lng/currency 컬럼 추가
--
-- 배경: 여행지 선택 화면에서 도시를 확정하면(search-destination select) 좌표·통화까지 다 받아오는데,
-- trips에는 그걸 담을 자리가 timezone(017)뿐이었다. 그 결과 날씨 카드가 매번 이름으로 다시 지오코딩하고
-- (좌표를 몰라서), 환율 카드·가계부 통화 선택지가 destination 문자열의 나라 이름을 하드코딩된 13개국
-- 표(currencyData.js)와 맞춰보는 옛 방식에 그대로 머물러 있었다 — 새로 늘어난 도시 대부분은 그 표에
-- 없어서 틀린 통화(USD)를 보여주거나 선택지에 안 떴다.
--
-- timezone(017)과 같은 이유로 destinations를 다시 조인하지 않고 trips 자체에 복제해 둔다. 국내 여행이나
-- 옛 방식으로 만들어진 여행, 또는 통화를 모르는 나라(country_currency에 없음, 015 참고)는 currency가
-- null로 남는다 - 이 경우를 쓰는 화면들은 "모르면 숨기거나 기존 방식으로" 처리해야 한다(코드 쪽 변경).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 한 번 실행한다. 다시 실행해도 안전하다(이미 있으면 건너뛴다).

alter table public.trips
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists currency text;

comment on column public.trips.lat is '도시 대표 좌표(위도). destinations.lat을 여행 만들기 시점에 복사해 둔 값 - 국내/옛 방식 여행은 null.';
comment on column public.trips.lng is '도시 대표 좌표(경도). destinations.lng을 여행 만들기 시점에 복사해 둔 값 - 국내/옛 방식 여행은 null.';
comment on column public.trips.currency is 'ISO 4217 통화코드. destinations.currency를 여행 만들기 시점에 복사해 둔 값 - 국내/옛 방식 여행, 또는 country_currency에 없는 나라(015)는 null.';
