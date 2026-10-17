-- 014_destinations: 여행지 확장·도시 검색(PRD v12)의 기반 테이블 2개 + trips 연결 컬럼
--
-- 만드는 것
--   1. country_currency: 국가코드(ISO 3166-1 alpha-2) → 통화코드(ISO 4217) · 지역 탭 키 매핑. 전 세계 국가를 넣는다.
--   2. destinations: 여행지(도시) 프리셋 + 사용자가 검색해서 추가한 도시를 함께 담는 표. 기존 destinations.js의
--      CITIES 배열(코드 상수)을 대신할 DB 테이블이다.
--   3. trips.destination_id: 기존 trips.destination(문자열)/city_id(destinations.js의 id)는 그대로 두고,
--      이 컬럼만 추가해서 새 체계로 점진적으로 옮겨갈 수 있게 한다. 기존 여행 데이터는 전혀 건드리지 않는다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   country_currency/destinations 테이블이 이미 있으면 오류로 멈춘다(IF NOT EXISTS를 쓰지 않았다).
--   trips.destination_id는 add column if not exists라서 다시 실행해도 안전하다.
--   맨 아래의 "되돌리기" 블록은 주석이라 실행되지 않는다.
--
-- region 값은 여행지 선택 화면의 지역 탭 키로 고정한다(PRD v12 2번):
--   japan, sea, china, taiwan, europe, north_america, oceania, middle_east,
--   central_america_caribbean, south_america, other
--   (국내는 이번 범위에 포함하지 않는다 — 기존 destinations.js의 국내 프리셋은 그대로 코드에 남아 있고,
--    이 마이그레이션은 해외 10개 지역 탭 + 검색으로 들어오는 그 외 모든 나라를 위한 것이다.)
--
-- 통화코드 중 최근(2024~2026) 변경된 것 — 확인 시점(2026-10) 기준으로 아래 값이 맞다, 추후 재확인 권장:
--   짐바브웨 ZWG(2024년 4월 ZWL → ZiG로 교체), 베네수엘라 VED(2021년 10월부터, VES는 그 이전 값),
--   시에라리온 SLE(2022년 7월 재평가), 불가리아 EUR(2026년 2월 1일부터 유로 단독 법정통화, 그 전엔 BGN).

-- ==========================================================================
-- 1. country_currency
-- ==========================================================================

create table public.country_currency (
  country_code text primary key, -- ISO 3166-1 alpha-2 (+ TW/HK/MO/PS/XK/GU/MP 등 여행에 필요한 코드)
  currency_code text not null, -- ISO 4217
  region text not null check (region in (
    'japan', 'sea', 'china', 'taiwan', 'europe', 'north_america', 'oceania',
    'middle_east', 'central_america_caribbean', 'south_america', 'other'
  ))
);

alter table public.country_currency enable row level security;

create policy "로그인한 사용자 조회" on public.country_currency
  for select to authenticated using (true);
-- insert/update/delete 정책을 만들지 않는다 — 클라이언트는 절대 직접 쓸 수 없고,
-- 나중에 만들 Edge Function(search-destination)의 service role만 쓴다(service_role은 RLS를 건너뛴다).

insert into public.country_currency (country_code, currency_code, region) values
  -- 일본
  ('JP', 'JPY', 'japan'),
  -- 중국(홍콩·마카오 포함)
  ('CN', 'CNY', 'china'),
  ('HK', 'HKD', 'china'),
  ('MO', 'MOP', 'china'),
  -- 대만
  ('TW', 'TWD', 'taiwan'),
  -- 동남아시아
  ('BN', 'BND', 'sea'),
  ('KH', 'KHR', 'sea'),
  ('ID', 'IDR', 'sea'),
  ('LA', 'LAK', 'sea'),
  ('MY', 'MYR', 'sea'),
  ('MM', 'MMK', 'sea'),
  ('PH', 'PHP', 'sea'),
  ('SG', 'SGD', 'sea'),
  ('TH', 'THB', 'sea'),
  ('TL', 'USD', 'sea'),
  ('VN', 'VND', 'sea'),
  -- 유럽 (EU 27개국)
  ('AT', 'EUR', 'europe'),
  ('BE', 'EUR', 'europe'),
  ('BG', 'EUR', 'europe'), -- 2026-02-01부터 유로 단독 법정통화(그 전엔 BGN)
  ('HR', 'EUR', 'europe'),
  ('CY', 'EUR', 'europe'),
  ('CZ', 'CZK', 'europe'),
  ('DK', 'DKK', 'europe'),
  ('EE', 'EUR', 'europe'),
  ('FI', 'EUR', 'europe'),
  ('FR', 'EUR', 'europe'),
  ('DE', 'EUR', 'europe'),
  ('GR', 'EUR', 'europe'),
  ('HU', 'HUF', 'europe'),
  ('IE', 'EUR', 'europe'),
  ('IT', 'EUR', 'europe'),
  ('LV', 'EUR', 'europe'),
  ('LT', 'EUR', 'europe'),
  ('LU', 'EUR', 'europe'),
  ('MT', 'EUR', 'europe'),
  ('NL', 'EUR', 'europe'),
  ('PL', 'PLN', 'europe'),
  ('PT', 'EUR', 'europe'),
  ('RO', 'RON', 'europe'),
  ('SK', 'EUR', 'europe'),
  ('SI', 'EUR', 'europe'),
  ('ES', 'EUR', 'europe'),
  ('SE', 'SEK', 'europe'),
  -- 유럽 (비EU)
  ('GB', 'GBP', 'europe'),
  ('CH', 'CHF', 'europe'),
  ('NO', 'NOK', 'europe'),
  ('IS', 'ISK', 'europe'),
  ('LI', 'CHF', 'europe'),
  ('MC', 'EUR', 'europe'),
  ('SM', 'EUR', 'europe'),
  ('VA', 'EUR', 'europe'),
  ('AD', 'EUR', 'europe'),
  ('AL', 'ALL', 'europe'),
  ('BA', 'BAM', 'europe'),
  ('ME', 'EUR', 'europe'),
  ('MK', 'MKD', 'europe'),
  ('RS', 'RSD', 'europe'),
  ('XK', 'EUR', 'europe'), -- 코소보 (ISO 공식 코드 아님, 통용되는 XK)
  ('MD', 'MDL', 'europe'),
  ('UA', 'UAH', 'europe'),
  ('BY', 'BYN', 'europe'),
  ('RU', 'RUB', 'europe'),
  -- 북미
  ('US', 'USD', 'north_america'),
  ('CA', 'CAD', 'north_america'),
  -- 중미
  ('MX', 'MXN', 'central_america_caribbean'),
  ('BZ', 'BZD', 'central_america_caribbean'),
  ('GT', 'GTQ', 'central_america_caribbean'),
  ('HN', 'HNL', 'central_america_caribbean'),
  ('SV', 'USD', 'central_america_caribbean'),
  ('NI', 'NIO', 'central_america_caribbean'),
  ('CR', 'CRC', 'central_america_caribbean'),
  ('PA', 'PAB', 'central_america_caribbean'),
  -- 카리브
  ('CU', 'CUP', 'central_america_caribbean'),
  ('JM', 'JMD', 'central_america_caribbean'),
  ('HT', 'HTG', 'central_america_caribbean'),
  ('DO', 'DOP', 'central_america_caribbean'),
  ('BS', 'BSD', 'central_america_caribbean'),
  ('TT', 'TTD', 'central_america_caribbean'),
  ('BB', 'BBD', 'central_america_caribbean'),
  ('AG', 'XCD', 'central_america_caribbean'),
  ('DM', 'XCD', 'central_america_caribbean'),
  ('GD', 'XCD', 'central_america_caribbean'),
  ('KN', 'XCD', 'central_america_caribbean'),
  ('LC', 'XCD', 'central_america_caribbean'),
  ('VC', 'XCD', 'central_america_caribbean'),
  -- 남미
  ('AR', 'ARS', 'south_america'),
  ('BO', 'BOB', 'south_america'),
  ('BR', 'BRL', 'south_america'),
  ('CL', 'CLP', 'south_america'),
  ('CO', 'COP', 'south_america'),
  ('EC', 'USD', 'south_america'),
  ('GY', 'GYD', 'south_america'),
  ('PY', 'PYG', 'south_america'),
  ('PE', 'PEN', 'south_america'),
  ('SR', 'SRD', 'south_america'),
  ('UY', 'UYU', 'south_america'),
  ('VE', 'VED', 'south_america'),
  -- 오세아니아
  ('AU', 'AUD', 'oceania'),
  ('NZ', 'NZD', 'oceania'),
  ('FJ', 'FJD', 'oceania'),
  ('PG', 'PGK', 'oceania'),
  ('SB', 'SBD', 'oceania'),
  ('VU', 'VUV', 'oceania'),
  ('WS', 'WST', 'oceania'),
  ('TO', 'TOP', 'oceania'),
  ('KI', 'AUD', 'oceania'),
  ('TV', 'AUD', 'oceania'),
  ('NR', 'AUD', 'oceania'),
  ('PW', 'USD', 'oceania'),
  ('FM', 'USD', 'oceania'),
  ('MH', 'USD', 'oceania'),
  ('GU', 'USD', 'oceania'), -- 괌
  ('MP', 'USD', 'oceania'), -- 북마리아나(사이판)
  -- 중동
  ('AE', 'AED', 'middle_east'),
  ('BH', 'BHD', 'middle_east'),
  ('EG', 'EGP', 'middle_east'),
  ('IR', 'IRR', 'middle_east'),
  ('IQ', 'IQD', 'middle_east'),
  ('IL', 'ILS', 'middle_east'),
  ('JO', 'JOD', 'middle_east'),
  ('KW', 'KWD', 'middle_east'),
  ('LB', 'LBP', 'middle_east'),
  ('OM', 'OMR', 'middle_east'),
  ('PS', 'ILS', 'middle_east'), -- 팔레스타인 (자체 통화 없이 ILS 통용)
  ('QA', 'QAR', 'middle_east'),
  ('SA', 'SAR', 'middle_east'),
  ('SY', 'SYP', 'middle_east'),
  ('TR', 'TRY', 'middle_east'),
  ('YE', 'YER', 'middle_east'),
  -- 기타: 동아시아(한국·북한·몽골)
  ('KR', 'KRW', 'other'),
  ('KP', 'KPW', 'other'),
  ('MN', 'MNT', 'other'),
  -- 기타: 남아시아
  ('AF', 'AFN', 'other'),
  ('BD', 'BDT', 'other'),
  ('BT', 'BTN', 'other'),
  ('IN', 'INR', 'other'),
  ('MV', 'MVR', 'other'),
  ('NP', 'NPR', 'other'),
  ('PK', 'PKR', 'other'),
  ('LK', 'LKR', 'other'),
  -- 기타: 중앙아시아
  ('KZ', 'KZT', 'other'),
  ('KG', 'KGS', 'other'),
  ('TJ', 'TJS', 'other'),
  ('TM', 'TMT', 'other'),
  ('UZ', 'UZS', 'other'),
  -- 기타: 코카서스
  ('AM', 'AMD', 'other'),
  ('AZ', 'AZN', 'other'),
  ('GE', 'GEL', 'other'),
  -- 기타: 아프리카 북부
  ('MA', 'MAD', 'other'),
  ('DZ', 'DZD', 'other'),
  ('TN', 'TND', 'other'),
  ('LY', 'LYD', 'other'),
  -- 기타: 아프리카 서부
  ('NG', 'NGN', 'other'),
  ('GH', 'GHS', 'other'),
  ('SN', 'XOF', 'other'),
  ('ML', 'XOF', 'other'),
  ('BF', 'XOF', 'other'),
  ('NE', 'XOF', 'other'),
  ('GN', 'GNF', 'other'),
  ('GW', 'XOF', 'other'),
  ('SL', 'SLE', 'other'),
  ('LR', 'LRD', 'other'),
  ('CI', 'XOF', 'other'),
  ('TG', 'XOF', 'other'),
  ('BJ', 'XOF', 'other'),
  ('CV', 'CVE', 'other'),
  ('GM', 'GMD', 'other'),
  ('MR', 'MRU', 'other'),
  -- 기타: 아프리카 중부
  ('CM', 'XAF', 'other'),
  ('CF', 'XAF', 'other'),
  ('TD', 'XAF', 'other'),
  ('CG', 'XAF', 'other'),
  ('CD', 'CDF', 'other'),
  ('GQ', 'XAF', 'other'),
  ('GA', 'XAF', 'other'),
  ('ST', 'STN', 'other'),
  -- 기타: 아프리카 동부
  ('ET', 'ETB', 'other'),
  ('KE', 'KES', 'other'),
  ('TZ', 'TZS', 'other'),
  ('UG', 'UGX', 'other'),
  ('RW', 'RWF', 'other'),
  ('BI', 'BIF', 'other'),
  ('SO', 'SOS', 'other'),
  ('DJ', 'DJF', 'other'),
  ('ER', 'ERN', 'other'),
  ('SS', 'SSP', 'other'),
  ('SD', 'SDG', 'other'),
  ('MG', 'MGA', 'other'),
  ('MU', 'MUR', 'other'),
  ('SC', 'SCR', 'other'),
  ('KM', 'KMF', 'other'),
  -- 기타: 아프리카 남부
  ('ZA', 'ZAR', 'other'),
  ('NA', 'NAD', 'other'),
  ('BW', 'BWP', 'other'),
  ('ZW', 'ZWG', 'other'),
  ('ZM', 'ZMW', 'other'),
  ('MZ', 'MZN', 'other'),
  ('MW', 'MWK', 'other'),
  ('AO', 'AOA', 'other'),
  ('SZ', 'SZL', 'other'),
  ('LS', 'LSL', 'other');

-- ==========================================================================
-- 2. destinations
-- ==========================================================================

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  name_ko text not null,
  name_en text not null,
  country_code text not null references public.country_currency (country_code),
  region text not null check (region in (
    'japan', 'sea', 'china', 'taiwan', 'europe', 'north_america', 'oceania',
    'middle_east', 'central_america_caribbean', 'south_america', 'other'
  )),
  lat double precision,
  lng double precision,
  timezone text, -- IANA 타임존(예: "Asia/Tokyo"). 지오코딩 전까지는 null.
  currency text not null,
  place_id text unique, -- Google Places의 place_id (nullable, 유니크)
  source text not null default 'preset' check (source in ('preset', 'user')),
  sort_order int not null default 0,
  resolved_at timestamptz, -- lat/lng/timezone을 실제로 확정한 시각. null이면 "아직 확정되지 않은 도시"
  created_at timestamptz not null default now(),
  unique (country_code, name_en)
);

alter table public.destinations enable row level security;

create policy "로그인한 사용자 조회" on public.destinations
  for select to authenticated using (true);
-- insert/update/delete 정책을 만들지 않는다 — country_currency와 같은 이유로, 클라이언트는 절대 직접 쓸 수
-- 없고 나중에 만들 Edge Function(search-destination)의 service role만 쓴다.

-- 시드: 기존 destinations.js의 일본/동남아/중국 프리셋 + 신규 7개 지역(PRD v12 2번).
-- name_ko/name_en/country_code/region/sort_order만 채우고, currency는 country_currency에서 country_code로
-- 가져온다. 기존 일본/동남아/중국 프리셋은 destinations.js에 좌표·시간대가 없었으므로 lat/lng/timezone/
-- resolved_at은 모두 null로 둔다(해당 값을 가진 기존 데이터가 있었다면 그대로 옮기라는 지시였지만, 옮길 값
-- 자체가 없다).
insert into public.destinations (name_ko, name_en, country_code, region, sort_order, currency)
select v.name_ko, v.name_en, v.country_code, v.region, v.sort_order, cc.currency_code
from (values
  -- 일본 (기존)
  ('도쿄', 'Tokyo', 'JP', 'japan', 1),
  ('오사카', 'Osaka', 'JP', 'japan', 2),
  ('교토', 'Kyoto', 'JP', 'japan', 3),
  ('후쿠오카', 'Fukuoka', 'JP', 'japan', 4),
  ('삿포로', 'Sapporo', 'JP', 'japan', 5),
  ('오키나와(나하)', 'Naha', 'JP', 'japan', 6),
  -- 동남아시아 (기존)
  ('방콕', 'Bangkok', 'TH', 'sea', 1),
  ('치앙마이', 'Chiang Mai', 'TH', 'sea', 2),
  ('다낭', 'Da Nang', 'VN', 'sea', 3),
  ('하노이', 'Hanoi', 'VN', 'sea', 4),
  ('호치민', 'Ho Chi Minh City', 'VN', 'sea', 5),
  ('푸꾸옥', 'Phu Quoc', 'VN', 'sea', 6),
  ('세부', 'Cebu City', 'PH', 'sea', 7),
  ('보라카이', 'Boracay', 'PH', 'sea', 8),
  ('싱가포르', 'Singapore', 'SG', 'sea', 9),
  ('쿠알라룸푸르', 'Kuala Lumpur', 'MY', 'sea', 10),
  ('코타키나발루', 'Kota Kinabalu', 'MY', 'sea', 11),
  ('발리', 'Bali', 'ID', 'sea', 12),
  -- 중국 (기존)
  ('베이징', 'Beijing', 'CN', 'china', 1),
  ('상하이', 'Shanghai', 'CN', 'china', 2),
  ('청두', 'Chengdu', 'CN', 'china', 3),
  ('시안', 'Xi''an', 'CN', 'china', 4),
  ('칭다오', 'Qingdao', 'CN', 'china', 5),
  ('장가계', 'Zhangjiajie', 'CN', 'china', 6),
  -- 대만 (신규)
  ('타이베이', 'Taipei', 'TW', 'taiwan', 1),
  ('타이중', 'Taichung', 'TW', 'taiwan', 2),
  ('가오슝', 'Kaohsiung', 'TW', 'taiwan', 3),
  ('타이난', 'Tainan', 'TW', 'taiwan', 4),
  ('화롄', 'Hualien', 'TW', 'taiwan', 5),
  -- 유럽 (신규)
  ('파리', 'Paris', 'FR', 'europe', 1),
  ('런던', 'London', 'GB', 'europe', 2),
  ('로마', 'Rome', 'IT', 'europe', 3),
  ('바르셀로나', 'Barcelona', 'ES', 'europe', 4),
  ('프라하', 'Prague', 'CZ', 'europe', 5),
  ('취리히', 'Zurich', 'CH', 'europe', 6),
  ('인터라켄', 'Interlaken', 'CH', 'europe', 7),
  ('비엔나', 'Vienna', 'AT', 'europe', 8),
  -- 북미 (신규)
  ('뉴욕', 'New York', 'US', 'north_america', 1),
  ('로스앤젤레스', 'Los Angeles', 'US', 'north_america', 2),
  ('샌프란시스코', 'San Francisco', 'US', 'north_america', 3),
  ('라스베이거스', 'Las Vegas', 'US', 'north_america', 4),
  ('호놀룰루(하와이)', 'Honolulu', 'US', 'north_america', 5),
  ('밴쿠버', 'Vancouver', 'CA', 'north_america', 6),
  ('토론토', 'Toronto', 'CA', 'north_america', 7),
  -- 오세아니아 (신규)
  ('시드니', 'Sydney', 'AU', 'oceania', 1),
  ('멜버른', 'Melbourne', 'AU', 'oceania', 2),
  ('브리즈번', 'Brisbane', 'AU', 'oceania', 3),
  ('골드코스트', 'Gold Coast', 'AU', 'oceania', 4),
  ('오클랜드', 'Auckland', 'NZ', 'oceania', 5),
  ('퀸스타운', 'Queenstown', 'NZ', 'oceania', 6),
  ('괌', 'Guam', 'GU', 'oceania', 7),
  ('사이판', 'Saipan', 'MP', 'oceania', 8),
  -- 중동 (신규)
  ('두바이', 'Dubai', 'AE', 'middle_east', 1),
  ('아부다비', 'Abu Dhabi', 'AE', 'middle_east', 2),
  ('이스탄불', 'Istanbul', 'TR', 'middle_east', 3),
  ('도하', 'Doha', 'QA', 'middle_east', 4),
  ('텔아비브', 'Tel Aviv', 'IL', 'middle_east', 5),
  ('카이로', 'Cairo', 'EG', 'middle_east', 6),
  -- 중미·카리브 (신규)
  ('칸쿤', 'Cancun', 'MX', 'central_america_caribbean', 1),
  ('멕시코시티', 'Mexico City', 'MX', 'central_america_caribbean', 2),
  ('아바나', 'Havana', 'CU', 'central_america_caribbean', 3),
  ('푼타카나', 'Punta Cana', 'DO', 'central_america_caribbean', 4),
  ('파나마시티', 'Panama City', 'PA', 'central_america_caribbean', 5),
  ('산호세(코스타리카)', 'San Jose', 'CR', 'central_america_caribbean', 6),
  -- 남미 (신규)
  ('리우데자네이루', 'Rio de Janeiro', 'BR', 'south_america', 1),
  ('부에노스아이레스', 'Buenos Aires', 'AR', 'south_america', 2),
  ('리마', 'Lima', 'PE', 'south_america', 3),
  ('쿠스코', 'Cusco', 'PE', 'south_america', 4),
  ('산티아고', 'Santiago', 'CL', 'south_america', 5),
  ('보고타', 'Bogota', 'CO', 'south_america', 6)
) as v(name_ko, name_en, country_code, region, sort_order)
join public.country_currency cc on cc.country_code = v.country_code;
-- 검증 필요 표시 대상 없음 — 위 70개 도시의 name_en/country_code는 모두 확인된 값이다.

-- ==========================================================================
-- 3. trips.destination_id (기존 데이터는 그대로, 새 컬럼만 추가)
-- ==========================================================================

alter table public.trips
  add column if not exists destination_id uuid references public.destinations (id) on delete set null;

comment on column public.trips.destination_id is '신규 여행지 체계(destinations)와의 연결. 기존 destination(문자열)/city_id는 그대로 유지하고 호환을 깨지 않는다 — null이면 아직 연결되지 않은(과거 방식 그대로인) 여행.';

-- 되돌리기:
-- alter table public.trips drop column if exists destination_id;
-- drop table if exists public.destinations cascade;
-- drop table if exists public.country_currency cascade;
