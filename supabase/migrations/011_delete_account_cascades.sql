-- 011_delete_account_cascades: 회원 탈퇴(Edge Function delete-account)가 안전하게 끝나도록, auth.users를
-- 참조하는 몇 개 컬럼의 on delete 규칙을 cascade로 바꾼다.
--
-- 001(trips, schedule_items, trip_invites), 005(expenses)를 먼저 실행한 뒤에 이 파일을 실행한다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 통째로 붙여 넣고 한 번만 실행한다.
--   이미 적용된 상태에서 다시 실행하면(두 번 실행) drop constraint가 "그런 제약 없음" 오류로 멈춘다 —
--   그때는 이미 적용되어 있다는 뜻이니 넘어가면 된다. 맨 아래 "되돌리기"는 주석이라 실행되지 않는다.
--
-- 바꾸는 것과 이유 (자세한 맥락은 supabase/functions/delete-account/README.md도 함께 참고)
--   delete-account 함수는 wallet_items → expenses → schedule_items → trip_members → trips(owner인 것만)
--   → trip_invites → user_consents 순서로 명시적으로 먼저 지운 다음에 auth.admin.deleteUser를 부른다.
--   이 마이그레이션은 "그 명시적인 순서가 혹시 안 지켜지거나(코드 변경·경쟁 상태) 다른 경로로 바로
--   deleteUser가 불려도" 외래키 오류 없이 끝나도록 하는 안전망이다 — 로직을 한 곳(함수)에만 의존하지
--   않고 스키마 자체도 일관되게 맞춰서 "단순화"한다(요청하신 3번).
--
--   A. trips.owner_id: 기본(아무 on delete 규칙 없음 → no action) → on delete cascade.
--      이게 없으면 "owner인 여행이 하나라도 남아 있는" 계정은 auth.admin.deleteUser가 외래키 위반으로
--      무조건 실패한다. cascade로 바꾸면 계정이 지워질 때 그 사람이 owner인 여행도 함께 지워지고,
--      (trips.id가 on delete cascade로 걸려 있는) schedule_items/trip_members/trip_invites/expenses도
--      trip_id를 통해 연쇄적으로 함께 지워진다 — 이미 있는 "여행 삭제"(storage.js#deleteTrip)와 같은 범위다.
--   B. schedule_items.created_by / expenses.created_by / trip_invites.created_by:
--      기존 on delete set null(계정이 지워져도 기록은 남고 작성자 표시만 비움 — "여행 나가기"와 같은 동작,
--      storage.js#leaveTrip 참고) → on delete cascade(계정과 함께 완전히 지움)로 바꾼다.
--      "여행 나가기"(trip_members 행만 지움, 본인이 추가한 일정·지출은 그 여행에 그대로 남는다)와
--      "회원 탈퇴"(계정 자체가 사라짐)는 서로 다른 작업이라 다른 정책을 가져도 된다 - 더 정확히는
--      달라야 한다: 탈퇴는 "내 개인정보를 모두 지워달라"는 요청이므로, 내가 가입했던 다른 사람의
--      여행에 남긴 일정·지출·초대까지 완전히 지워지는 쪽이 맞다. delete-account 함수가 이 범위를
--      이미 명시적으로 지우므로(2·3·6단계), 이 cascade는 그 단계들과 정확히 같은 결과를 내는 안전망이다.
--
-- 주의: 아래 제약 이름(trips_owner_id_fkey 등)은 001/005가 컬럼에 인라인으로(이름 없이) 선언한 foreign
-- key에 Postgres가 자동으로 붙인 기본 이름("<테이블>_<컬럼>_fkey")이다. 혹시 대시보드 등에서 이름을
-- 바꾼 적이 있다면 이 이름으로 drop이 실패할 수 있다 — 그럴 때는 Supabase 대시보드 → Database → Tables →
-- 해당 테이블 → 그 컬럼의 foreign key 이름을 확인해서 아래 이름을 바꿔 넣고 다시 실행한다.

alter table public.trips
  drop constraint trips_owner_id_fkey,
  add constraint trips_owner_id_fkey foreign key (owner_id) references auth.users (id) on delete cascade;

alter table public.schedule_items
  drop constraint schedule_items_created_by_fkey,
  add constraint schedule_items_created_by_fkey foreign key (created_by) references auth.users (id) on delete cascade;

alter table public.expenses
  drop constraint expenses_created_by_fkey,
  add constraint expenses_created_by_fkey foreign key (created_by) references auth.users (id) on delete cascade;

alter table public.trip_invites
  drop constraint trip_invites_created_by_fkey,
  add constraint trip_invites_created_by_fkey foreign key (created_by) references auth.users (id) on delete cascade;

-- 되돌리기 (on delete 규칙을 원래대로):
-- alter table public.trips drop constraint trips_owner_id_fkey, add constraint trips_owner_id_fkey foreign key (owner_id) references auth.users (id);
-- alter table public.schedule_items drop constraint schedule_items_created_by_fkey, add constraint schedule_items_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
-- alter table public.expenses drop constraint expenses_created_by_fkey, add constraint expenses_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
-- alter table public.trip_invites drop constraint trip_invites_created_by_fkey, add constraint trip_invites_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
