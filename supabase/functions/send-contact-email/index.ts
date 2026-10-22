// send-contact-email: 설정 > 고객센터 > 문의하기(#/contact)의 "1:1 문의하기" 창(contactForm.js)이 보낸
// 제목/내용을 Resend로 이메일 한 통을 보내는 Supabase Edge Function (Deno).
//
// 요청:  POST  { "title": "...", "content": "..." }   (로그인한 사용자만 호출 가능 - Authorization 헤더 필요)
// 응답:  성공 { ok: true }
//        실패 { error: "..." }  (전부 HTTP 200으로 돌려줘서 클라이언트가 data.error만 보면 되게 한다 - analyze-ticket과 같은 관례)
//
// 받는 사람 메일 주소는 이 파일에 절대 쓰지 않는다 - 비밀값 CONTACT_EMAIL로만 존재해서, 클라이언트
// 어디에도(이 파일을 포함해 저장소 어디에도) 노출되지 않는다. 보낸 사람(문의자)의 이메일은 로그인 토큰에서
// 읽어 Reply-To로 실어 보낸다 - CONTACT_EMAIL 받는 사람이 그대로 "답장"을 누르면 문의자에게 바로 간다.
//
// 필요한 비밀값(secrets):
//   RESEND_API_KEY   https://resend.com 가입 후 발급받는 API 키
//   CONTACT_EMAIL    문의 메일을 받을 주소
//   supabase secrets set RESEND_API_KEY=<키> CONTACT_EMAIL=<받을 이메일 주소>
// 선택 비밀값:
//   CONTACT_FROM_EMAIL   발신 주소 (기본 "onboarding@resend.dev" - Resend가 도메인 인증 없이도 쓸 수 있게
//     제공하는 테스트용 발신 주소라, 도메인을 인증하기 전까지는 이 기본값을 그대로 써도 된다. 다만 Resend의
//     정책상 미인증 상태에서는 "계정을 만들 때 쓴 이메일로만" 보낼 수 있을 수 있다 - CONTACT_EMAIL을 그
//     주소로 맞춰 두거나, 직접 도메인을 인증한 뒤 이 값을 "문의하기 <no-reply@내도메인>"처럼 바꾸면 된다.)
//
// 배포: supabase functions deploy send-contact-email

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Routory 문의하기 <onboarding@resend.dev>";
const MAX_TITLE = 100;
const MAX_CONTENT = 2000;
const FAIL_MESSAGE = "문의를 보내지 못했어요. 잠시 후 다시 시도해주세요.";

// 허용 출처(2026-10-19 보안 점검 EDGE-07) - analyze-ticket과 동일한 이유/방식.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "https://triplog-nu.vercel.app",
  "https://localhost",
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://triplog-nu.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ---- 로그인 확인 + 보낸 사람 정보 ----
// analyze-ticket#isSignedIn과 같은 이유로 payload만 본다(Supabase가 서명을 이미 확인한 토큰이다).
// 이름은 032_trip_member_notify.sql의 "새 멤버 가입" 알림과 같은 순서(full_name → name → nickname →
// preferred_username)로 찾는다 - 소셜 로그인 제공자마다 다른 필드에 이름을 넣어서다.
type Caller = { email: string | null; name: string };

function getCaller(req: Request): Caller | null {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    // atob()는 바이트를 그대로 문자코드로 돌려주는 Latin1 디코딩이라, 이름처럼 한글(다국어) 값이 들어 있으면
    // 그대로 JSON.parse하면 깨진다 - 바이트 배열로 바꾼 뒤 TextDecoder("utf-8")로 다시 디코딩해야 한다
    // (analyze-ticket#isSignedIn은 role만 읽어서 이 문제가 없었지만, 여기는 user_metadata의 이름을 읽는다).
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder("utf-8").decode(bytes));
    if (claims.role !== "authenticated") return null;

    const meta = claims.user_metadata ?? {};
    const name = meta.full_name || meta.name || meta.nickname || meta.preferred_username || "이름 없는 사용자";
    const email = typeof claims.email === "string" && claims.email ? claims.email : null;
    return { email, name };
  } catch {
    return null;
  }
}

// ---- 입력값 ----

function readBody(body: unknown): { title: string; content: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { title, content } = body as { title?: unknown; content?: unknown };
  if (typeof title !== "string" || typeof content !== "string") return null;
  const t = title.trim();
  const c = content.trim();
  if (!t || !c || t.length > MAX_TITLE || c.length > MAX_CONTENT) return null;
  return { title: t, content: c };
}

// ---- Resend ----

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendEmail(caller: Caller, title: string, content: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("CONTACT_EMAIL");
  if (!apiKey || !to) {
    console.error("[send-contact-email] RESEND_API_KEY 또는 CONTACT_EMAIL 비밀값이 설정되어 있지 않아요");
    return false;
  }
  const from = Deno.env.get("CONTACT_FROM_EMAIL") || DEFAULT_FROM;
  const senderLine = caller.email ? `${caller.name} (${caller.email})` : `${caller.name} (이메일 확인 불가)`;

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject: `[Routory 문의] ${title}`,
    text: `보낸 사람: ${senderLine}\n\n${content}`,
    html: `<p><strong>보낸 사람:</strong> ${escapeHtml(senderLine)}</p><p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`,
  };
  if (caller.email) payload.reply_to = caller.email;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[send-contact-email] Resend 오류", res.status, errBody.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[send-contact-email] Resend 호출 실패", err instanceof Error ? err.message : err);
    return false;
  }
}

// ---- 요청 처리 ----

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS_HEADERS = corsHeadersFor(req);
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const fail = () => json({ error: FAIL_MESSAGE });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const caller = getCaller(req);
  if (!caller) return json({ error: "로그인이 필요해요" }, 401);

  const input = readBody(await req.json().catch(() => null));
  if (!input) return json({ error: "제목과 내용을 모두 입력해주세요." }, 400);

  const sent = await sendEmail(caller, input.title, input.content);
  if (!sent) return fail();

  return json({ ok: true });
});
