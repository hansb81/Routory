-- 004_leave_trip: 초대받아 참여한 사람(editor)이 스스로 여행에서 나갈 수 있게 한다
--
-- 왜 필요한가: 001의 trip_members 삭제 정책은 "여행을 만든 사람(owner)이 다른 멤버를 내보내기" 하나뿐이라,
-- 참여자가 자기 멤버십을 지울 수 없다. 앱의 '여행 나가기'(나의 여행 메뉴)가 이 정책을 쓴다.
--
-- 규칙: 자기 자신의 행만, 그리고 role이 owner가 아닌 행만 지울 수 있다.
--   - 여행을 만든 사람(owner)은 나갈 수 없다 (대신 '여행 삭제'를 쓴다). 그러면 주인 없는 여행이 생기지 않는다.
--   - 다른 사람의 행은 이 정책으로는 못 지운다 (강퇴는 001의 정책대로 owner만).
--   - 나가도 그 사람이 만든 일정은 여행에 그대로 남는다 (schedule_items.created_by는 그대로).
--   - 초대 링크가 유효하면 다시 들어올 수 있다 (accept_trip_invite).
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에서 001, 002, 003 다음에 실행한다.
-- 같은 이름의 정책이 이미 있으면 오류가 나므로 한 번만 실행한다 (다시 하려면 아래 "되돌리기" 먼저).

create policy "참여자는 스스로 나가기" on public.trip_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');

-- 되돌리기: drop policy "참여자는 스스로 나가기" on public.trip_members;
