-- 015_destinations_unknown_country: search-destination Edge Function이 country_currency에 없는 나라도
-- 저장할 수 있게 destinations의 제약을 완화한다.
--
-- 배경: 014_destinations.sql에서 destinations.country_code를 country_currency(country_code)를 가리키는
-- 강한 FK로, destinations.currency를 not null로 만들었다. 그런데 search-destination의 select 액션 명세
-- (3번)는 "통화는 country_currency에서, region은 country_currency.region에서 채우고, 없으면 'other'.
-- 통화를 모르는 국가면 currency는 null로 둔다"를 요구한다 — 즉 Google/Open-Meteo가 country_currency에
-- 없는 나라(코드)를 돌려줘도 그 도시를 저장할 수 있어야 하는데, 014의 강한 FK + not null이 이걸 막는다.
-- country_currency는 201개국을 이미 담고 있어 실제로 걸릴 일은 드물겠지만, 막혀서 저장 자체가 실패하는
-- 것보다 region='other'/currency=null로라도 저장되는 쪽이 이 기능의 의도에 맞다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 014_destinations.sql 다음에 한 번 실행한다. 다시 실행해도
-- 안전하다(constraint/column이 이미 그 상태면 조용히 넘어간다).

alter table public.destinations drop constraint if exists destinations_country_code_fkey;
alter table public.destinations alter column currency drop not null;

comment on column public.destinations.country_code is 'ISO 3166-1 alpha-2 (+TW/HK/MO/PS/XK/GU/MP 등). country_currency에 없는 코드일 수도 있어 FK는 걸지 않는다(015).';
comment on column public.destinations.currency is 'country_currency.currency_code. 그 나라가 country_currency에 없으면 null(015) - region은 이 경우 app쪽에서 ''other''로 채운다.';

-- 되돌리기:
-- alter table public.destinations alter column currency set not null;
-- alter table public.destinations add constraint destinations_country_code_fkey foreign key (country_code) references public.country_currency (country_code);
