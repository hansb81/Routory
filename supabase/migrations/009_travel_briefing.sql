-- 009_travel_briefing: 여행중 탭(마이트립) '여행 전' 카드 중 현지 뉴스·할인 정보를 실제 데이터로 연동하기 위한
-- briefing_cache 테이블. supabase/functions/travel-briefing/index.ts(Edge Function)만 이 테이블을 쓴다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   briefing_cache 테이블이 이미 있으면 오류로 멈춘다. 맨 아래의 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 만드는 것
--   1. briefing_cache 테이블 — "목적지+여행기간" 조합 하나당 최신 응답 한 행만 들고 있는 캐시.
--      (destination, date_range) unique 제약이 있어서, Edge Function이 매번 새 행을 쌓지 않고 upsert로
--      그 조합의 행 하나를 계속 덮어쓴다 — created_at이 "언제 마지막으로 갱신됐는지"가 된다.
--   2. RLS는 켜두기만 하고 정책은 하나도 만들지 않는다. 이 표는 사용자별 데이터가 아니라 (목적지+기간) 별로
--      전 사용자가 공유하는 공개 정보 캐시라서 트립·멤버 개념이 없고, 클라이언트(anon/authenticated 롤)가
--      직접 읽거나 쓸 이유도 없다 — travel-briefing 함수가 SUPABASE_SERVICE_ROLE_KEY로만 접근한다
--      (service_role은 RLS를 무조건 건너뛰므로, 정책이 없어도 그 함수는 정상 동작한다). 즉 이 RLS는
--      "정책이 없으니 authenticated/anon으로는 전부 거절"이 목적이다.
--
-- date_range 형식: "YYYY-MM-DD~YYYY-MM-DD" (trip.startDate~trip.endDate 그대로, js/util.js의 다른 날짜 범위
-- 표기와 같은 "~" 구분자). destination은 trip.destination 문자열 그대로("도쿄, 일본" 등) 캐시 키로 쓴다 —
-- 표기가 다르면(예: 오타) 다른 키로 취급돼 캐시가 안 맞을 수 있지만, 정규화까지는 이번 범위에서 하지 않는다.

create table public.briefing_cache (
  id uuid primary key default gen_random_uuid(),
  destination text not null,
  date_range text not null, -- "YYYY-MM-DD~YYYY-MM-DD"
  content jsonb not null, -- { news: [{title,summary,sourceUrl,sourceName}], deals: [...] }
  created_at timestamptz not null default now(), -- 이 행이 "마지막으로 갱신된" 시각. upsert 때마다 Edge Function이 새 값으로 덮어쓴다(컬럼 기본값은 최초 insert에만 쓰인다)
  unique (destination, date_range) -- PostgREST upsert가 on_conflict=destination,date_range로 이 제약을 쓴다
);

alter table public.briefing_cache enable row level security;
-- 의도적으로 정책을 하나도 만들지 않는다 (위 설명 참고) — authenticated/anon 어느 롤로도 이 표는 읽거나 쓸 수 없다.

-- 되돌리기: drop table if exists public.briefing_cache cascade;
