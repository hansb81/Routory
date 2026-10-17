-- 027_discover_cities: '어디로 떠나볼까요' 개선 — 그라데이션 카드를 실사진 + 이번 달 추천 이유 + 날씨로
-- 교체하기 위한 기반 테이블/RPC (메인 화면 개선, 단계 0 라이선스 조사 이후).
--
-- 만드는 것
--   0. country_currency.name_ko 보강 — get_discover_cities가 country_name_ko를 돌려줘야 하는데, 국가명
--      한글 매핑은 지금 supabase/functions/search-destination/index.ts의 COUNTRY_NAMES(TS 상수)에만 있고
--      DB에는 없다. 그 함수 자신의 주석이 "country_currency(014_destinations.sql)의 201개 국가코드와 같은
--      코드 집합"이라고 명시해 뒀으므로, 그 201개 코드에 정확히 같은 한글명을 1:1로 그대로 복사해 컬럼으로
--      추가한다 — 새로 지어낸 값이 아니라 이미 검증된 값을 다른 레이어(DB)에도 두는 것뿐이다.
--      **주의(중복 데이터)**: 이제 한글 국가명이 TS 상수와 이 컬럼, 두 곳에 존재한다. 국가가 추가되거나
--      이름이 바뀌면(드묾) 두 곳을 같이 고쳐야 한다 — search-destination/index.ts는 이번에 건드리지
--      않았다(범위 밖). 나중에 그 함수를 이 컬럼을 읽도록 바꾸면 중복이 없어진다.
--   1. discover_cities: '어디로 떠나볼까요'에 노출할 도시 큐레이션 단위. destinations 1곳당 최대 1행
--      (unique) — 이름·국가·좌표·시간대는 전부 destinations에서 그대로 가져오고, 여기엔 이 기능 전용
--      필드(소개 문구·활성 여부)만 둔다.
--   2. discover_city_months: 도시 × 월(1~12) 추천 점수/이유. (city_id, month) 행이 없으면 "그 달엔
--      추천하지 않는다"는 뜻 — score를 nullable로 두고 0점을 넣는 방식이 아니라, 행 자체를 안 만든다.
--   3. discover_city_images: 도시 대표 이미지. 단계 0 조사에서 확인된 라이선스별 표기 의무(출처명·URL·
--      라이선스·저작자명)를 전부 NOT NULL + 공백 금지로 강제한다 — 표기 정보 없이는 이미지를 게시할 수
--      없게 만드는 것이 목적이다. credit_url만 nullable(일부 라이선스는 작가 프로필 링크가 없을 수 있음).
--   4. city_highlights: 도시 안의 명소 3~6개(우리가 고른 하이라이트) — 개수 상한은 운영 규칙이라 DB
--      제약으로 강제하지 않고 주석으로만 남긴다(관리 화면에서 지키면 되는 수준).
--   5. city_weather_cache: destination_id 1개당 캐시 1행(최신 값만 유지, 이력 없음) — Edge Function이
--      Open-Meteo를 호출해 overwrite한다. 클라이언트는 절대 쓰지 않는다(service_role만).
--   6. RLS: 020_admins.sql의 is_admin()을 그대로 재사용 — 이 저장소에 쓰기 권한 체계를 또 만들지 않는다.
--   7. get_discover_cities(limit): 한국 시간 기준 이번 달에 점수가 있는 활성 도시를 점수순으로 최대
--      20개까지 돌려주는 RPC. 가중치 수치(날씨 보너스 구간, 나라당 상한)는 전부 별도 함수로 분리해서
--      한곳만 고치면 되게 했다(아래 "조정 지점" 주석 참고).
--   8. get_city_detail(city_id): 위 랭킹에 없는 상세 화면용 — 이미지 전체·이번 달 이유·날씨·하이라이트를
--      한 번에 돌려준다.
--
-- 기존 popular_destinations(021_travel_feed.sql)은 건드리지 않는다 — 삭제하지 말고 그대로 두되, 이
-- 기능이 자리를 대신하면 클라이언트가 그 테이블/RPC 호출을 그만 쓰는 것으로 전환한다(사용 중단, 스키마
-- 삭제 아님).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다. 014~016/020
-- (destinations/country_currency/is_admin)이 먼저 적용돼 있어야 한다. 테이블이 이미 있으면 오류로
-- 멈춘다(IF NOT EXISTS를 쓰지 않았다) — country_currency.name_ko 보강(0번)만 add column if not exists라서
-- 다시 실행해도 안전하다.

-- ==========================================================================
-- 0. country_currency.name_ko 보강 (위 설명 참고)
-- ==========================================================================

alter table public.country_currency
  add column if not exists name_ko text;

update public.country_currency set name_ko = v.name_ko
from (values
  ('JP','일본'), ('CN','중국'), ('HK','홍콩'), ('MO','마카오'), ('TW','대만'),
  ('BN','브루나이'), ('KH','캄보디아'), ('ID','인도네시아'), ('LA','라오스'), ('MY','말레이시아'),
  ('MM','미얀마'), ('PH','필리핀'), ('SG','싱가포르'), ('TH','태국'), ('TL','동티모르'), ('VN','베트남'),
  ('AT','오스트리아'), ('BE','벨기에'), ('BG','불가리아'), ('HR','크로아티아'), ('CY','키프로스'),
  ('CZ','체코'), ('DK','덴마크'), ('EE','에스토니아'), ('FI','핀란드'), ('FR','프랑스'),
  ('DE','독일'), ('GR','그리스'), ('HU','헝가리'), ('IE','아일랜드'), ('IT','이탈리아'),
  ('LV','라트비아'), ('LT','리투아니아'), ('LU','룩셈부르크'), ('MT','몰타'), ('NL','네덜란드'),
  ('PL','폴란드'), ('PT','포르투갈'), ('RO','루마니아'), ('SK','슬로바키아'), ('SI','슬로베니아'),
  ('ES','스페인'), ('SE','스웨덴'), ('GB','영국'), ('CH','스위스'), ('NO','노르웨이'),
  ('IS','아이슬란드'), ('LI','리히텐슈타인'), ('MC','모나코'), ('SM','산마리노'), ('VA','바티칸'),
  ('AD','안도라'), ('AL','알바니아'), ('BA','보스니아 헤르체고비나'), ('ME','몬테네그로'),
  ('MK','북마케도니아'), ('RS','세르비아'), ('XK','코소보'), ('MD','몰도바'), ('UA','우크라이나'),
  ('BY','벨라루스'), ('RU','러시아'), ('US','미국'), ('CA','캐나다'),
  ('MX','멕시코'), ('BZ','벨리즈'), ('GT','과테말라'), ('HN','온두라스'), ('SV','엘살바도르'),
  ('NI','니카라과'), ('CR','코스타리카'), ('PA','파나마'), ('CU','쿠바'), ('JM','자메이카'),
  ('HT','아이티'), ('DO','도미니카공화국'), ('BS','바하마'), ('TT','트리니다드토바고'),
  ('BB','바베이도스'), ('AG','앤티가바부다'), ('DM','도미니카연방'), ('GD','그레나다'),
  ('KN','세인트키츠네비스'), ('LC','세인트루시아'), ('VC','세인트빈센트그레나딘'),
  ('AR','아르헨티나'), ('BO','볼리비아'), ('BR','브라질'), ('CL','칠레'), ('CO','콜롬비아'),
  ('EC','에콰도르'), ('GY','가이아나'), ('PY','파라과이'), ('PE','페루'), ('SR','수리남'),
  ('UY','우루과이'), ('VE','베네수엘라'), ('AU','호주'), ('NZ','뉴질랜드'), ('FJ','피지'),
  ('PG','파푸아뉴기니'), ('SB','솔로몬제도'), ('VU','바누아투'), ('WS','사모아'), ('TO','통가'),
  ('KI','키리바시'), ('TV','투발루'), ('NR','나우루'), ('PW','팔라우'), ('FM','미크로네시아'),
  ('MH','마셜제도'), ('GU','괌'), ('MP','북마리아나제도'),
  ('AE','아랍에미리트'), ('BH','바레인'), ('EG','이집트'), ('IR','이란'), ('IQ','이라크'),
  ('IL','이스라엘'), ('JO','요르단'), ('KW','쿠웨이트'), ('LB','레바논'), ('OM','오만'),
  ('PS','팔레스타인'), ('QA','카타르'), ('SA','사우디아라비아'), ('SY','시리아'), ('TR','터키'), ('YE','예멘'),
  ('KR','대한민국'), ('KP','북한'), ('MN','몽골'),
  ('AF','아프가니스탄'), ('BD','방글라데시'), ('BT','부탄'), ('IN','인도'), ('MV','몰디브'),
  ('NP','네팔'), ('PK','파키스탄'), ('LK','스리랑카'),
  ('KZ','카자흐스탄'), ('KG','키르기스스탄'), ('TJ','타지키스탄'), ('TM','투르크메니스탄'), ('UZ','우즈베키스탄'),
  ('AM','아르메니아'), ('AZ','아제르바이잔'), ('GE','조지아'),
  ('MA','모로코'), ('DZ','알제리'), ('TN','튀니지'), ('LY','리비아'),
  ('NG','나이지리아'), ('GH','가나'), ('SN','세네갈'), ('ML','말리'), ('BF','부르키나파소'),
  ('NE','니제르'), ('GN','기니'), ('GW','기니비사우'), ('SL','시에라리온'), ('LR','라이베리아'),
  ('CI','코트디부아르'), ('TG','토고'), ('BJ','베냉'), ('CV','카보베르데'), ('GM','감비아'), ('MR','모리타니'),
  ('CM','카메룬'), ('CF','중앙아프리카공화국'), ('TD','차드'), ('CG','콩고공화국'),
  ('CD','콩고민주공화국'), ('GQ','적도기니'), ('GA','가봉'), ('ST','상투메프린시페'),
  ('ET','에티오피아'), ('KE','케냐'), ('TZ','탄자니아'), ('UG','우간다'), ('RW','르완다'),
  ('BI','부룬디'), ('SO','소말리아'), ('DJ','지부티'), ('ER','에리트레아'), ('SS','남수단'),
  ('SD','수단'), ('MG','마다가스카르'), ('MU','모리셔스'), ('SC','세이셸'), ('KM','코모로'),
  ('ZA','남아프리카공화국'), ('NA','나미비아'), ('BW','보츠와나'), ('ZW','짐바브웨'), ('ZM','잠비아'),
  ('MZ','모잠비크'), ('MW','말라위'), ('AO','앙골라'), ('SZ','에스와티니'), ('LS','레소토')
) as v(country_code, name_ko)
where public.country_currency.country_code = v.country_code;

-- ==========================================================================
-- 1. discover_cities
-- ==========================================================================

create table public.discover_cities (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null unique references public.destinations (id) on delete cascade,
  tagline text, -- 도시 한 줄 소개 (우리가 쓴 문장)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.discover_cities.destination_id is '이름·국가·좌표(lat/lng)·시간대는 여기 두지 않고 destinations에서 조회한다 (PRD v12) — 이 테이블은 "어디로 떠나볼까요" 전용 큐레이션 필드만 가진다.';

alter table public.discover_cities enable row level security;

-- 001_invite_feature.sql의 set_updated_at() 트리거 함수를 그대로 재사용한다 (새로 정의하지 않음)
create trigger discover_cities_set_updated_at
  before update on public.discover_cities
  for each row execute function public.set_updated_at();

create policy "로그인한 사용자는 활성 도시만 조회" on public.discover_cities
  for select to authenticated
  using (is_active = true);

-- 022_travel_feed_admin_audit.sql과 같은 패턴: "활성만 조회" 정책과 OR로 합쳐져서, 관리자는 비활성
-- 도시까지 포함해 전체를 보고 일반 사용자는 여전히 활성 도시만 본다.
create policy "관리자는 전체 조회" on public.discover_cities
  for select to authenticated
  using (public.is_admin());

create policy "관리자만 작성" on public.discover_cities
  for insert to authenticated
  with check (public.is_admin());

create policy "관리자만 수정" on public.discover_cities
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "관리자만 삭제" on public.discover_cities
  for delete to authenticated
  using (public.is_admin());

-- ==========================================================================
-- 2. discover_city_months
-- ==========================================================================

create table public.discover_city_months (
  city_id uuid not null references public.discover_cities (id) on delete cascade,
  month int not null check (month between 1 and 12),
  score int not null check (score between 1 and 5),
  reason_tag text not null, -- 예: '벚꽃', '단풍', '해수욕', '스키', '선선한 날씨', '축제' (고정 목록 아님, 자유 텍스트)
  reason_text text, -- 우리가 쓴 한 줄 이유 (nullable — reason_tag만으로 충분한 경우도 있다)
  primary key (city_id, month)
);

comment on table public.discover_city_months is '(city_id, month) 행이 없으면 그 달은 추천하지 않는 달이다 — score를 0으로 넣는 방식이 아니라 행 자체를 생략한다.';

create index discover_city_months_month_idx on public.discover_city_months (month);

alter table public.discover_city_months enable row level security;

create policy "로그인한 사용자 조회" on public.discover_city_months
  for select to authenticated using (true);

create policy "관리자만 작성" on public.discover_city_months
  for insert to authenticated with check (public.is_admin());

create policy "관리자만 수정" on public.discover_city_months
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "관리자만 삭제" on public.discover_city_months
  for delete to authenticated using (public.is_admin());

-- ==========================================================================
-- 3. discover_city_images
-- ==========================================================================
-- 단계 0(라이선스 조사)에서 확인된 바: 이 기능이 쓰는 모든 이미지 소스는 "출처명+URL+라이선스+저작자명"
-- 표기가 필요하다 — 그래서 이 다섯 필드(image_url 포함)는 NOT NULL이자 공백 문자열도 막는다. credit_url만
-- nullable(라이선스에 따라 작가 프로필 링크가 없을 수 있음, 예: Pexels 일부 사진).

create table public.discover_city_images (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.discover_cities (id) on delete cascade,
  image_url text not null check (char_length(trim(image_url)) > 0),
  thumb_url text,
  credit_name text not null check (char_length(trim(credit_name)) > 0),
  credit_url text,
  license text not null check (char_length(trim(license)) > 0),
  source_name text not null check (char_length(trim(source_name)) > 0),
  source_url text not null check (char_length(trim(source_url)) > 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index discover_city_images_city_sort_idx on public.discover_city_images (city_id, sort_order);

alter table public.discover_city_images enable row level security;

create policy "로그인한 사용자는 게시된 이미지만 조회" on public.discover_city_images
  for select to authenticated
  using (status = 'published');

create policy "관리자는 전체 조회" on public.discover_city_images
  for select to authenticated
  using (public.is_admin());

create policy "관리자만 작성" on public.discover_city_images
  for insert to authenticated
  with check (public.is_admin());

create policy "관리자만 수정" on public.discover_city_images
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "관리자만 삭제" on public.discover_city_images
  for delete to authenticated
  using (public.is_admin());

-- ==========================================================================
-- 4. city_highlights
-- ==========================================================================
-- 도시당 3~6개를 권장한다 — 운영 규칙이라 DB 제약으로 강제하지 않는다(관리 화면에서 지키면 되는 수준).

create table public.city_highlights (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.discover_cities (id) on delete cascade,
  sort_order int not null default 0,
  name_ko text not null,
  summary text, -- 우리가 쓴 한두 줄 소개 (nullable)
  lat double precision,
  lng double precision,
  source_name text,
  created_at timestamptz not null default now()
);

create index city_highlights_city_sort_idx on public.city_highlights (city_id, sort_order);

alter table public.city_highlights enable row level security;

create policy "로그인한 사용자 조회" on public.city_highlights
  for select to authenticated using (true);

create policy "관리자만 작성" on public.city_highlights
  for insert to authenticated with check (public.is_admin());

create policy "관리자만 수정" on public.city_highlights
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "관리자만 삭제" on public.city_highlights
  for delete to authenticated using (public.is_admin());

-- ==========================================================================
-- 5. city_weather_cache
-- ==========================================================================
-- 이력 없이 destination_id당 최신 값 1행만 유지한다. 클라이언트는 절대 쓰지 않는다 — insert/update/delete
-- 정책을 아예 만들지 않아서, service_role(Edge Function, RLS를 우회함)만 쓸 수 있다.

create table public.city_weather_cache (
  destination_id uuid primary key references public.destinations (id) on delete cascade,
  temp_c numeric not null,
  weather_code int not null, -- WMO 날씨 코드 (open-meteo), myTripPage.js#WEATHER_CODE_LABELS와 같은 코드 체계
  fetched_at timestamptz not null
);

alter table public.city_weather_cache enable row level security;

create policy "로그인한 사용자 조회" on public.city_weather_cache
  for select to authenticated using (true);
-- insert/update/delete 정책 없음 — 일반 사용자/관리자 모두 직접 쓸 수 없고, service_role만 쓴다.

-- ==========================================================================
-- 6. get_discover_cities 가중치 — 조정 지점 (수치를 바꿀 땐 이 두 함수만 고치면 된다)
-- ==========================================================================

create or replace function public.discover_weather_bonus(p_temp_c numeric, p_weather_code int)
returns int
language sql
immutable
set search_path = ''
as $$
  -- 조정 지점: 쾌적 기온 구간(섭씨)과 그 구간에서 주는 보너스 점수, "비/눈/뇌우로 보는" WMO 날씨 코드.
  -- WMO 코드(open-meteo, myTripPage.js#WEATHER_CODE_LABELS와 동일 체계):
  --   51~67 이슬비/비, 80~82 소나기, 71~77/85~86 눈·소낙눈, 95~99 뇌우.
  -- 날씨 캐시가 없거나(temp_c/weather_code가 null) 극단적 기온이거나 위 날씨 코드면 보너스 0.
  select case
    when p_temp_c is null or p_weather_code is null then 0
    when p_temp_c < 15 or p_temp_c > 28 then 0
    when p_weather_code in (51,53,55,56,57,61,63,65,66,67,80,81,82,71,73,75,77,85,86,95,96,99) then 0
    else 5
  end;
$$;

create or replace function public.discover_country_cap()
returns int
language sql
immutable
set search_path = ''
as $$
  select 4; -- 조정 지점: 한 나라가 추천 목록에서 차지할 수 있는 최대 개수
$$;

-- ==========================================================================
-- 7. get_discover_cities(limit) — 이번 달(한국 시간) 추천 도시 랭킹
-- ==========================================================================
-- security definer이지만 트립/멤버 등 사용자별 데이터는 전혀 참조하지 않는다 — get_travel_feed처럼 개인화
-- 랭킹이 아니라, 모든 로그인 사용자에게 같은 결과를 주는 전역 랭킹이다. RLS가 적용되는 테이블(활성/게시
-- 조건)을 definer로 우회하는 대신, 그 조건들을 쿼리 본문에서 직접 다시 걸어 뒤 RLS와 동일하게 거른다.

create or replace function public.get_discover_cities(p_limit int default 20)
returns table (
  city_id uuid,
  destination_id uuid,
  name_ko text,
  name_en text,
  country_code text,
  country_name_ko text,
  tagline text,
  reason_tag text,
  reason_text text,
  image_url text,
  thumb_url text,
  credit_name text,
  credit_url text,
  license text,
  temp_c numeric,
  weather_code int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month int := extract(month from (now() at time zone 'Asia/Seoul'))::int;
begin
  return query
  with candidates as (
    select
      dc.id as c_city_id,
      dc.destination_id as c_destination_id,
      d.name_ko as c_name_ko,
      d.name_en as c_name_en,
      d.country_code as c_country_code,
      cc.name_ko as c_country_name_ko,
      dc.tagline as c_tagline,
      dcm.reason_tag as c_reason_tag,
      dcm.reason_text as c_reason_text,
      wc.temp_c as c_temp_c,
      wc.weather_code as c_weather_code,
      (dcm.score * 10 + public.discover_weather_bonus(wc.temp_c, wc.weather_code)) as c_total_score,
      -- 날짜 기반 고정 타이브레이크: 같은 날엔 항상 같은 순서, 날짜가 바뀌면(KST 기준) 값도 바뀐다
      hashtext(dc.id::text || to_char(v_today, 'YYYYMMDD')) as c_tie_break
    from public.discover_cities dc
    join public.discover_city_months dcm on dcm.city_id = dc.id and dcm.month = v_month
    join public.destinations d on d.id = dc.destination_id
    left join public.country_currency cc on cc.country_code = d.country_code
    left join public.city_weather_cache wc on wc.destination_id = dc.destination_id
    where dc.is_active = true -- "활성 도시만 조회" RLS 정책과 동일한 조건을 definer 본문에도 그대로 건다
  ),
  ranked as (
    select
      cand.*,
      row_number() over (
        partition by cand.c_country_code
        order by cand.c_total_score desc, cand.c_tie_break
      ) as c_country_rank
    from candidates cand
  ),
  capped as (
    -- 같은 나라는 discover_country_cap()개까지만 남긴다 (한 나라가 목록을 독점하지 않게)
    select * from ranked where c_country_rank <= public.discover_country_cap()
  ),
  top_image as (
    -- 도시별 게시된 이미지 중 sort_order가 가장 작은 1장만 (대표 이미지)
    select distinct on (ci.city_id)
      ci.city_id as ti_city_id,
      ci.image_url as ti_image_url,
      ci.thumb_url as ti_thumb_url,
      ci.credit_name as ti_credit_name,
      ci.credit_url as ti_credit_url,
      ci.license as ti_license
    from public.discover_city_images ci
    where ci.status = 'published' -- "게시된 이미지만 조회" RLS 정책과 동일한 조건
    order by ci.city_id, ci.sort_order asc
  )
  select
    capped.c_city_id,
    capped.c_destination_id,
    capped.c_name_ko,
    capped.c_name_en,
    capped.c_country_code,
    capped.c_country_name_ko,
    capped.c_tagline,
    capped.c_reason_tag,
    capped.c_reason_text,
    top_image.ti_image_url,
    top_image.ti_thumb_url,
    top_image.ti_credit_name,
    top_image.ti_credit_url,
    top_image.ti_license,
    capped.c_temp_c,
    capped.c_weather_code
  from capped
  left join top_image on top_image.ti_city_id = capped.c_city_id
  order by capped.c_total_score desc, capped.c_tie_break
  limit least(greatest(p_limit, 1), 20); -- 최소 1 ~ 최대 20으로 상한 (요청: "최대 limit개(최대 20)")
end;
$$;

revoke execute on function public.get_discover_cities(int) from public, anon;
grant execute on function public.get_discover_cities(int) to authenticated;

-- ==========================================================================
-- 8. get_city_detail(city_id) — 상세 화면용 (이미지 전체 + 이번 달 이유 + 날씨 + 하이라이트)
-- ==========================================================================
-- get_discover_cities와 같은 이유로 security definer이지만 사용자별 데이터는 참조하지 않는다. 이미지는
-- 게시된 것만, 도시는 활성 상태일 때만 돌려준다(RLS와 동일한 조건을 본문에서 직접 건다).

create or replace function public.get_city_detail(p_city_id uuid)
returns table (
  city_id uuid,
  destination_id uuid,
  name_ko text,
  name_en text,
  country_code text,
  country_name_ko text,
  tagline text,
  reason_tag text,
  reason_text text,
  temp_c numeric,
  weather_code int,
  weather_fetched_at timestamptz,
  images jsonb, -- [{imageUrl, thumbUrl, creditName, creditUrl, license, sourceName, sourceUrl}, ...] sort_order순
  highlights jsonb -- [{nameKo, summary, lat, lng, sourceName}, ...] sort_order순
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month int := extract(month from (now() at time zone 'Asia/Seoul'))::int;
begin
  return query
  select
    dc.id as r_city_id,
    dc.destination_id as r_destination_id,
    d.name_ko as r_name_ko,
    d.name_en as r_name_en,
    d.country_code as r_country_code,
    cc.name_ko as r_country_name_ko,
    dc.tagline as r_tagline,
    dcm.reason_tag as r_reason_tag,
    dcm.reason_text as r_reason_text,
    wc.temp_c as r_temp_c,
    wc.weather_code as r_weather_code,
    wc.fetched_at as r_weather_fetched_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'imageUrl', ci.image_url,
        'thumbUrl', ci.thumb_url,
        'creditName', ci.credit_name,
        'creditUrl', ci.credit_url,
        'license', ci.license,
        'sourceName', ci.source_name,
        'sourceUrl', ci.source_url
      ) order by ci.sort_order)
      from public.discover_city_images ci
      where ci.city_id = dc.id and ci.status = 'published'
    ), '[]'::jsonb) as r_images,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'nameKo', ch.name_ko,
        'summary', ch.summary,
        'lat', ch.lat,
        'lng', ch.lng,
        'sourceName', ch.source_name
      ) order by ch.sort_order)
      from public.city_highlights ch
      where ch.city_id = dc.id
    ), '[]'::jsonb) as r_highlights
  from public.discover_cities dc
  join public.destinations d on d.id = dc.destination_id
  left join public.country_currency cc on cc.country_code = d.country_code
  left join public.discover_city_months dcm on dcm.city_id = dc.id and dcm.month = v_month
  left join public.city_weather_cache wc on wc.destination_id = dc.destination_id
  where dc.id = p_city_id and dc.is_active = true;
end;
$$;

revoke execute on function public.get_city_detail(uuid) from public, anon;
grant execute on function public.get_city_detail(uuid) to authenticated;

-- 되돌리기:
-- drop function if exists public.get_city_detail(uuid);
-- drop function if exists public.get_discover_cities(int);
-- drop function if exists public.discover_country_cap();
-- drop function if exists public.discover_weather_bonus(numeric, int);
-- drop table if exists public.city_weather_cache;
-- drop table if exists public.city_highlights;
-- drop table if exists public.discover_city_images;
-- drop table if exists public.discover_city_months;
-- drop trigger if exists discover_cities_set_updated_at on public.discover_cities;
-- drop table if exists public.discover_cities;
-- alter table public.country_currency drop column if exists name_ko;
