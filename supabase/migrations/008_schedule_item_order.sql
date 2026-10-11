-- 008_schedule_item_order: 일정(schedule_items)을 드래그 & 드롭으로 순서를 바꿀 수 있게 한다
--
-- 왜 필요한가: 지금까지는 같은 날짜(date) 안에서 카드 순서가 그냥 created_at(등록한 순서)이었는데,
-- 이제 타임라인에서 카드를 길게 눌러 드래그하면 순서를 바꿀 수 있어야 한다. 그러려면 그 순서를
-- 서버에 저장해 둘 컬럼이 있어야 한다(안 그러면 새로고침하거나 다른 기기/멤버 화면에서 원래 순서로
-- 되돌아간다).
--
-- 컬럼: sort_order (정수, 같은 trip_id + date 안에서만 의미 있는 값 - 다른 날짜끼리는 비교하지 않는다).
--   앱은 항상 date로 먼저 묶고 그 안에서만 sort_order로 정렬하므로, 트립 전체에서 유일할 필요는 없다.
--   기존 행은 지금의 순서(= created_at 순)를 그대로 유지하도록 여기서 한 번 채워 넣는다(0부터 시작).
--   앞으로 새 일정은 storage.js#addItem이 "그 날짜의 마지막 순번 + 1"을 계산해서 넣고,
--   드래그로 순서를 바꾸면 storage.js#reorderItems가 화면에 보이는 새 순서대로 0, 1, 2...를 다시 써 넣는다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 실행한다 (001~007 이후, 한 번만).

alter table public.schedule_items add column if not exists sort_order integer;

update public.schedule_items s
set sort_order = sub.rn
from (
  select id, row_number() over (partition by trip_id, date order by created_at) - 1 as rn
  from public.schedule_items
) sub
where s.id = sub.id
  and s.sort_order is null;

-- 되돌리기: alter table public.schedule_items drop column if exists sort_order;
