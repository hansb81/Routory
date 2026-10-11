// delete-account: 로그인한 사용자 본인의 계정과 데이터를 완전히 삭제하는 Supabase Edge Function (Deno).
// 클라이언트는 auth.users를 직접 지울 권한이 없다(Admin API는 service_role 키로만 부를 수 있다) — 이 함수가
// 대신 지운다. triplog/js/accountDeletePage.js의 "탈퇴하기" 확인 다이얼로그가 부른다.
//
// 요청: POST (본문 없음). Authorization 헤더의 로그인 토큰(JWT)만으로 "누구를 지울지"를 정한다 — 몸체로 다른
//       사용자의 id를 받지 않는다. 반드시 "자기 자신"만 지울 수 있게 하려는 의도적인 설계다(본인 확인은
//       아래 getCallerId가 한다 — service_role 키는 이 확인에는 전혀 쓰지 않고, 그 아래 실제 삭제 작업
//       (RLS를 건너뛰어야 하는 작업들)에만 쓴다).
// 응답: 성공 200 {} / 실패 { error: "<실패한 단계를 알 수 있는 한국어 메시지>" }
//   401 로그인이 필요함(토큰 없음/이상함), 405 POST가 아님, 500 이 함수의 설정(비밀값) 또는 삭제 단계 중 하나가 실패함.
//   클라이언트(accountDeletePage.js)는 이 메시지를 그대로 보여주지 않는다 — 실패 원인과 무관하게 항상
//   "탈퇴 처리 중 문제가 발생했습니다. 고객센터로 문의해주세요"만 보여준다(사용자에게 내부 사정을 노출하지
//   않기 위해서다). 이 함수가 구체적인 단계 이름을 응답에 담는 이유는 Edge Function 로그(및 필요하면 향후
//   고객센터 문의 대응)에서 "어디서 막혔는지"를 바로 알 수 있게 하기 위함이다.
//
// 지우는 순서 (요청한 순서 그대로):
//   1. wallet_items (Storage의 실제 파일도 함께) — 파일은 DB 행이 아니라서 어떤 cascade로도 지워지지
//      않는다. wallet_items 행에서 file_url(=Storage 안의 경로)을 먼저 읽어 그 경로들을 Storage에서
//      지우고, 그 다음 행 자체를 지운다.
//   2. expenses (created_by = 나) — 내가 기록한 지출. 내가 owner가 아닌 여행에 남긴 지출도 포함해서 전부 지운다.
//   3. schedule_items (created_by = 나) — 내가 등록한 일정. 2번과 같은 이유로 범위를 trip 소유 여부로
//      가리지 않는다.
//   4. trip_members (user_id = 나) — 내가 속한 모든 여행에서의 멤버십(소유한 여행이든 참여만 한 여행이든
//      전부) — "여행 나가기"를 모든 여행에 대해 한 번에 하는 것과 같다.
//   5. trips (owner_id = 나인 것만) — 내가 만든 여행 자체를 지운다. 공유 여행(내가 참여자일 뿐인 여행)은
//      4번에서 내 멤버십만 빠지고 여행 자체는 그대로 남는다. 이 단계는 내가 owner인 여행에 다른 멤버가
//      남긴 schedule_items/expenses/trip_members/trip_invites까지 trip_id의 on delete cascade로 함께
//      지운다 — 이미 있는 "여행 삭제"(storage.js#deleteTrip)와 정확히 같은 범위다.
//   6. trip_invites (created_by = 나) — 내가 만든 초대 링크. RLS상 초대는 owner만 만들 수 있어서 보통은
//      5번의 trip_id cascade로 이미 다 지워져 있다 — 그래도 혹시 남은 게 있으면 마저 지운다(멱등 — 없는
//      행을 지워도 오류가 아니다).
//   7. user_consents (user_id = 나) — 약관 동의 기록.
//   8. auth.admin.deleteUser(나) — Auth 계정 자체를 지운다. 위 1~7번을 이미 다 지웠으므로 이 시점엔
//      외래키 제약에 걸릴 행이 없어야 정상이다.
//
// 이 함수는 각 단계를 순서대로, 하나의 DB 트랜잭션으로 묶지 않고 수행한다(Admin API 호출과 여러 테이블에
// 걸친 REST 삭제를 하나의 Postgres 트랜잭션으로 묶으려면 이 모든 걸 수행하는 Postgres 함수(RPC)를 따로
// 만들어야 하는데, 이번 요청 범위를 넘어서 만들지 않았다). 그래서 중간에 실패하면 그 앞 단계까지는 이미
// 지워진 채로 멈출 수 있다 — 다만 모든 단계가 "WHERE ... = 나"라서 다시 호출해도 안전하다(이미 지워진 행은
// 0건 매치로 조용히 넘어간다). 즉 실패했을 때 복구 방법은 "다시 시도"이고, 안내 메시지가 고객센터로
// 문의하라고 하는 것도 재시도로 안 될 만큼 깊은 문제(예: 외래키 제약이 더 있는 경우)를 사람이 봐야
// 하기 때문이다.
//
// 011_delete_account_cascades.sql이 trips.owner_id/schedule_items.created_by/expenses.created_by/
// trip_invites.created_by의 on delete 규칙을 cascade로 바꿔 둔 것은 이 함수의 설명과 모순되지 않는
// 안전망이다 — 이 함수가 위 1~7번을 명시적으로 먼저 지우므로 8번 시점엔 이미 아무것도 안 걸리지만, 혹시
// 어떤 단계가 코드 변경으로 빠지거나 경쟁 상태로 그 사이 새 행이 생겨도 8번(deleteUser) 자체가 외래키
// 오류 없이 끝나도록 보장해 준다.
//
// 필요한 비밀값: 없음. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY는 Supabase가 모든 Edge Function에 자동으로
// 넣어준다(대시보드 → Edge Functions → Secrets에 이미 있다). service_role 키는 이 파일 밖으로 나가지 않는다.
//
// naver-login과 같은 이유로 import를 쓴다: Admin API(사용자 삭제)와 Storage 관리자 작업을 raw REST로 손수
// 구현하는 것보다 공식 SDK가 더 안전하고(서명·에러 형식을 SDK가 맞춰 준다) 짧다. 버전은 naver-login과 맞춰
// 고정해 둔다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

const fail = (status: number, message: string) => json({ error: message }, status);

// ---- 지울 사용자 id (요청을 보낸 사람 본인) ----
// Supabase가 서명을 이미 확인한 토큰이라(analyze-ticket#isSignedIn과 같은 이유) payload만 읽는다.
// role이 "authenticated"가 아니면(anon 키로만 부른 경우 등) 거부하고, 맞으면 sub(로그인한 사용자의 uuid)를
// "지울 사람"으로 쓴다 — 요청 몸체로 다른 사용자의 id를 받지 않는 이유(위 파일 설명 참고)가 바로 이 부분이다.
// service_role 키는 여기서는 전혀 쓰지 않는다(본인 확인은 토큰만으로 한다) — 아래 각 삭제 단계(step)에서만 쓴다.
function getCallerId(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    return claims?.role === "authenticated" && typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

// createClient의 반환 타입을 그대로 쓰면 admin.auth.admin.*/admin.storage.*/admin.from(...)를 부를 때마다
// 제네릭(스키마 타입) 불일치로 타입 오류가 난다 — naver-login과 같은 이유로 any로 충분하다(이 함수는
// 스키마 타입을 다루지 않는다).
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

// 각 단계를 "실패하면 어느 단계인지 알 수 있는 Error"로 감싼다. label은 로그와 응답(error 필드)에 그대로
// 쓰인다 — 클라이언트는 이 내용을 사람에게 보여주지 않고 항상 같은 안내만 보여준다(위 파일 설명 참고).
async function step(label: string, run: () => Promise<{ error: unknown }>): Promise<void> {
  const { error } = await run();
  if (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
    throw new Error(`${label} 실패: ${message}`);
  }
}

// 1) wallet_items + Storage 파일. file_url이 Storage 'wallet' 버킷 안의 경로("<uid>/파일명")라서, 먼저
// 그 경로 목록을 읽고 Storage에서 지운 다음 행 자체를 지운다. 둘 중 하나라도 실패하면 이 단계 전체가
// 실패한 것으로 본다(README의 1번과 같은 이유 — 파일만 남고 기록은 지워지는 쪽보다, 둘 다 안 지워져서
// 다시 시도하게 하는 쪽이 "탈퇴했는데 파일이 조용히 남는" 상황보다 안전하다. deleteWalletFiles가
// 실패해도 계속 진행하던 이전 버전과 달리 이번 요청은 "하나라도 실패하면 명확한 에러"를 요구해서 이 단계도
// 실패로 집계한다).
async function deleteWalletItems(admin: SupabaseAdmin, userId: string): Promise<void> {
  const { data, error } = await admin.from("wallet_items").select("file_url").eq("user_id", userId);
  if (error) throw new Error(`여행지갑 파일 목록 조회 실패: ${error.message}`);

  const paths = (data ?? []).map((row: { file_url: string }) => row.file_url).filter(Boolean);
  if (paths.length > 0) {
    await step("여행지갑 파일 삭제", () => admin.storage.from("wallet").remove(paths));
  }
  await step("여행지갑 기록 삭제", () => admin.from("wallet_items").delete().eq("user_id", userId));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail(405, "POST 요청만 받아요");

  const userId = getCallerId(req);
  if (!userId) return fail(401, "로그인이 필요해요");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[delete-account] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않아요");
    return fail(500, "탈퇴 처리 중 오류가 발생했어요");
  }
  // service_role 키는 여기, 실제 삭제 작업에만 쓴다(RLS를 건너뛰어야 다른 사람 소유의 trip 안에 있는
  // 내 schedule_items/expenses까지, 그리고 Storage/Admin API 작업을 할 수 있다).
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    await deleteWalletItems(admin, userId); // 1. wallet_items + Storage 파일
    await step("가계부 기록 삭제", () => admin.from("expenses").delete().eq("created_by", userId)); // 2. expenses
    await step("일정 삭제", () => admin.from("schedule_items").delete().eq("created_by", userId)); // 3. schedule_items
    await step("여행 멤버십 삭제", () => admin.from("trip_members").delete().eq("user_id", userId)); // 4. trip_members(본인이 속한)
    await step("소유한 여행 삭제", () => admin.from("trips").delete().eq("owner_id", userId)); // 5. trips(owner인 것만)
    await step("초대 기록 삭제", () => admin.from("trip_invites").delete().eq("created_by", userId)); // 6. trip_invites(본인이 만든)
    await step("약관 동의 기록 삭제", () => admin.from("user_consents").delete().eq("user_id", userId)); // 7. user_consents
    await step("계정 삭제", () => admin.auth.admin.deleteUser(userId)); // 8. Auth 계정 자체
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[delete-account] 탈퇴 처리 실패", userId, message);
    return fail(500, message);
  }

  return json({});
});
