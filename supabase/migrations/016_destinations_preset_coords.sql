-- 016_destinations_preset_coords: 014_destinations.sql가 심은 70개 프리셋 도시의 좌표(lat/lng)·IANA
-- 타임존을 채운다.
--
-- 배경: destinations.js에 원래 좌표가 없었어서 014의 프리셋 70개는 lat/lng/timezone/resolved_at이 모두
-- null로 들어갔다. 이 상태로는 여행지 선택 화면에서 프리셋을 고르기만 해도 search-destination의 select
-- 액션이 매번 Google/Open-Meteo를 불러야 해서, "검색 없이 프리셋만으로 모든 탭이 동작"하지 않는다.
-- 이 마이그레이션은 잘 알려진 70개 주요 도시의 좌표·시간대를 직접 채워서, 프리셋 선택은 외부 API 호출
-- 없이 바로 끝나게 한다(resolved_at이 채워지면 search-destination이 그 행을 그대로 돌려준다).
--
-- 값은 각 도시의 대표 지점(주로 도심/시청 인근) 좌표와, IANA 타임존 데이터베이스의 그 지역 표준 타임존
-- 이름이다. 소수점 넷째 자리 정도의 정밀도로, 날씨·거리 계산용으로 충분하다(건물 단위 정밀도는 아니다).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 014/015 다음에 한 번 실행한다. source='preset'인 행만
-- 건드리고, (country_code, name_en)이 일치하는 행이 없으면(실행 전에 014를 안 돌렸다면) 조용히 0건
-- 업데이트로 끝난다 - 다시 실행해도 안전하다.

update public.destinations d
set lat = v.lat, lng = v.lng, timezone = v.tz, resolved_at = now()
from (values
  -- 일본
  ('JP', 'Tokyo', 35.6762, 139.6503, 'Asia/Tokyo'),
  ('JP', 'Osaka', 34.6937, 135.5023, 'Asia/Tokyo'),
  ('JP', 'Kyoto', 35.0116, 135.7681, 'Asia/Tokyo'),
  ('JP', 'Fukuoka', 33.5904, 130.4017, 'Asia/Tokyo'),
  ('JP', 'Sapporo', 43.0618, 141.3545, 'Asia/Tokyo'),
  ('JP', 'Naha', 26.2124, 127.6809, 'Asia/Tokyo'),
  -- 동남아시아
  ('TH', 'Bangkok', 13.7563, 100.5018, 'Asia/Bangkok'),
  ('TH', 'Chiang Mai', 18.7883, 98.9853, 'Asia/Bangkok'),
  ('VN', 'Da Nang', 16.0544, 108.2022, 'Asia/Ho_Chi_Minh'),
  ('VN', 'Hanoi', 21.0278, 105.8342, 'Asia/Ho_Chi_Minh'),
  ('VN', 'Ho Chi Minh City', 10.8231, 106.6297, 'Asia/Ho_Chi_Minh'),
  ('VN', 'Phu Quoc', 10.2899, 103.9840, 'Asia/Ho_Chi_Minh'),
  ('PH', 'Cebu City', 10.3157, 123.8854, 'Asia/Manila'),
  ('PH', 'Boracay', 11.9674, 121.9248, 'Asia/Manila'),
  ('SG', 'Singapore', 1.3521, 103.8198, 'Asia/Singapore'),
  ('MY', 'Kuala Lumpur', 3.1390, 101.6869, 'Asia/Kuala_Lumpur'),
  ('MY', 'Kota Kinabalu', 5.9804, 116.0735, 'Asia/Kuching'), -- 동말레이시아(사바)는 서말레이시아와 다른 타임존(UTC+8)
  ('ID', 'Bali', -8.3405, 115.0920, 'Asia/Makassar'), -- 발리는 WITA(UTC+8) - 자카르타(Asia/Jakarta, WIB)와 다르다
  -- 중국
  ('CN', 'Beijing', 39.9042, 116.4074, 'Asia/Shanghai'),
  ('CN', 'Shanghai', 31.2304, 121.4737, 'Asia/Shanghai'),
  ('CN', 'Chengdu', 30.5728, 104.0668, 'Asia/Shanghai'),
  ('CN', 'Xi''an', 34.3416, 108.9398, 'Asia/Shanghai'),
  ('CN', 'Qingdao', 36.0671, 120.3826, 'Asia/Shanghai'),
  ('CN', 'Zhangjiajie', 29.1171, 110.4794, 'Asia/Shanghai'),
  -- 대만
  ('TW', 'Taipei', 25.0330, 121.5654, 'Asia/Taipei'),
  ('TW', 'Taichung', 24.1477, 120.6736, 'Asia/Taipei'),
  ('TW', 'Kaohsiung', 22.6273, 120.3014, 'Asia/Taipei'),
  ('TW', 'Tainan', 22.9999, 120.2269, 'Asia/Taipei'),
  ('TW', 'Hualien', 23.9871, 121.6015, 'Asia/Taipei'),
  -- 유럽
  ('FR', 'Paris', 48.8566, 2.3522, 'Europe/Paris'),
  ('GB', 'London', 51.5074, -0.1278, 'Europe/London'),
  ('IT', 'Rome', 41.9028, 12.4964, 'Europe/Rome'),
  ('ES', 'Barcelona', 41.3851, 2.1734, 'Europe/Madrid'),
  ('CZ', 'Prague', 50.0755, 14.4378, 'Europe/Prague'),
  ('CH', 'Zurich', 47.3769, 8.5417, 'Europe/Zurich'),
  ('CH', 'Interlaken', 46.6863, 7.8632, 'Europe/Zurich'),
  ('AT', 'Vienna', 48.2082, 16.3738, 'Europe/Vienna'),
  -- 북미
  ('US', 'New York', 40.7128, -74.0060, 'America/New_York'),
  ('US', 'Los Angeles', 34.0522, -118.2437, 'America/Los_Angeles'),
  ('US', 'San Francisco', 37.7749, -122.4194, 'America/Los_Angeles'),
  ('US', 'Las Vegas', 36.1699, -115.1398, 'America/Los_Angeles'),
  ('US', 'Honolulu', 21.3069, -157.8583, 'Pacific/Honolulu'),
  ('CA', 'Vancouver', 49.2827, -123.1207, 'America/Vancouver'),
  ('CA', 'Toronto', 43.6532, -79.3832, 'America/Toronto'),
  -- 오세아니아
  ('AU', 'Sydney', -33.8688, 151.2093, 'Australia/Sydney'),
  ('AU', 'Melbourne', -37.8136, 144.9631, 'Australia/Melbourne'),
  ('AU', 'Brisbane', -27.4698, 153.0251, 'Australia/Brisbane'),
  ('AU', 'Gold Coast', -28.0167, 153.4000, 'Australia/Brisbane'),
  ('NZ', 'Auckland', -36.8485, 174.7633, 'Pacific/Auckland'),
  ('NZ', 'Queenstown', -45.0312, 168.6626, 'Pacific/Auckland'),
  ('GU', 'Guam', 13.4443, 144.7937, 'Pacific/Guam'),
  ('MP', 'Saipan', 15.1783, 145.7505, 'Pacific/Saipan'),
  -- 중동
  ('AE', 'Dubai', 25.2048, 55.2708, 'Asia/Dubai'),
  ('AE', 'Abu Dhabi', 24.4539, 54.3773, 'Asia/Dubai'),
  ('TR', 'Istanbul', 41.0082, 28.9784, 'Europe/Istanbul'),
  ('QA', 'Doha', 25.2854, 51.5310, 'Asia/Qatar'),
  ('IL', 'Tel Aviv', 32.0853, 34.7818, 'Asia/Jerusalem'),
  ('EG', 'Cairo', 30.0444, 31.2357, 'Africa/Cairo'),
  -- 중미·카리브
  ('MX', 'Cancun', 21.1619, -86.8515, 'America/Cancun'),
  ('MX', 'Mexico City', 19.4326, -99.1332, 'America/Mexico_City'),
  ('CU', 'Havana', 23.1136, -82.3666, 'America/Havana'),
  ('DO', 'Punta Cana', 18.5601, -68.3725, 'America/Santo_Domingo'),
  ('PA', 'Panama City', 8.9824, -79.5199, 'America/Panama'),
  ('CR', 'San Jose', 9.9281, -84.0907, 'America/Costa_Rica'),
  -- 남미
  ('BR', 'Rio de Janeiro', -22.9068, -43.1729, 'America/Sao_Paulo'),
  ('AR', 'Buenos Aires', -34.6037, -58.3816, 'America/Argentina/Buenos_Aires'),
  ('PE', 'Lima', -12.0464, -77.0428, 'America/Lima'),
  ('PE', 'Cusco', -13.5319, -71.9675, 'America/Lima'),
  ('CL', 'Santiago', -33.4489, -70.6693, 'America/Santiago'),
  ('CO', 'Bogota', 4.7110, -74.0721, 'America/Bogota')
) as v(country_code, name_en, lat, lng, tz)
where d.country_code = v.country_code and d.name_en = v.name_en and d.source = 'preset';

-- 확인: 아래 쿼리 결과가 0행이어야 한다(70개 프리셋 전부 채워졌는지 점검용, 실행할 필요는 없다)
-- select name_ko, name_en, country_code from public.destinations where source = 'preset' and resolved_at is null;
