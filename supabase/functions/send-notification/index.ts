// send-notification: 서버(DB 트리거, pg_cron 등)만 부르는 내부 발송 함수 (Deno). 사람이 로그인해서 쓰는
// 다른 함수(analyze-ticket 등)와 달리, 그리고 collect-travel-feed와 같은 이유로, Authorization JWT를
// 전혀 보지 않는다 — 고정 공유 비밀값 헤더(x-notify-secret, NOTIFY_SECRET 비밀값과 비교)로만 막는다.
// 일반 사용자의 로그인 JWT를 아무리 올바르게 실어 보내도 이 헤더가 없거나 틀리면 401이다(요청 1번).
//
// 이 함수만 예외적으로 import를 쓴다(analyze-ticket 계열의 "no imports" 원칙은 Gemini 호출 함수들 한정 —
// naver-login/delete-account가 Admin API 때문에 @supabase/supabase-js를 이미 그렇게 예외로 둔 것과 같은
// 이유): Web Push(RFC 8291 aes128gcm 암호화 + VAPID JWT 서명)를 직접 구현하는 건 비합리적인 범위라
// `web-push` 라이브러리를 쓴다. FCM 쪽은 Google OAuth2 JWT Bearer 플로우를 Web Crypto API(Deno/Node 둘 다
// 표준 지원)만으로 직접 구현했다 — 이건 import 없이도 짧고 또렷해서 라이브러리를 더 끌어오지 않았다.
//
// ---- 요청 ----
// POST, 헤더 x-notify-secret: <NOTIFY_SECRET 비밀값>
// 본문 JSON:
//   {
//     userIds: string[] | "all",   // 대상 user_id 목록, 또는 문자 그대로 "all"(전체 사용자)
//     type: "departure" | "schedule" | "invite" | "announcement",
//     title: string,
//     body?: string,
//     url?: string,                // 알림을 눌렀을 때 열 해시 경로(예: "/#/my-trip/<id>") - sw.js/pushNotifications.js가 쓴다
//     tripId?: string,              // notifications.related_trip_id
//   }
//
// ---- 대상 필터(요청 3번) ----
// type이 departure/schedule면 notification_settings.schedule_enabled=true인 사용자만, invite면
// share_enabled=true인 사용자만 남긴다. announcement는 필터 없이 요청받은(또는 "all"로 풀어낸) 전원.
// notification_settings에 행이 아예 없는 사용자는 "꺼짐(false)"으로 표시된 사용자 집합에 나타나지 않으므로
// 자동으로 "켜짐"으로 남는다(요청 3번 "행이 없으면 켜짐으로 간주") - off 집합을 빼는 방식으로 구현했다.
//
// ---- 발송(요청 4·5번) ----
// 필터를 통과한 사용자들의 device_tokens를 platform별로 나눠 보낸다.
//   android: FCM HTTP v1 (`https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`).
//     Secret FCM_SERVICE_ACCOUNT(Firebase 서비스 계정 키 JSON 원문)에서 private_key/client_email/
//     project_id를 읽어 RS256으로 서명한 JWT를 만들고, token_uri(기본 https://oauth2.googleapis.com/token)에
//     urn:ietf:params:oauth:grant-type:jwt-bearer로 교환해 액세스 토큰을 받는다(Web Crypto
//     RSASSA-PKCS1-v1_5/SHA-256 — Node의 globalThis.crypto.subtle로 자체 서명→검증 왕복까지 확인했다,
//     README 참고). 만료/삭제된 토큰은 404 또는 응답의 error.status가 "UNREGISTERED"/"NOT_FOUND"로 온다 -
//     실제 서비스 계정이 없어 운영 응답을 재현할 수 없었으므로 문서에 나오는 두 이름을 방어적으로 둘 다 받는다.
//   web: Web Push(VAPID). `https://esm.sh/web-push@3.6.7`(naver-login/delete-account가 이미 쓰는
//     esm.sh import 방식과 동일). Secret VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY(클라이언트
//     triplog/js/config.js의 vapidPublicKey와 같은 쌍이어야 한다)로 webpush.setVapidDetails. device_tokens.token은
//     webPush.js가 저장한 PushSubscription JSON 문자열이라 그대로 JSON.parse해서 쓴다. 만료/무효 구독은
//     라이브러리가 던지는 WebPushError.statusCode가 404(gone) 또는 410(Not Found, 실제로는 RFC상 410이
//     "더 이상 유효하지 않음"이고 404는 "찾을 수 없음" — 둘 다 삭제 대상으로 본다).
//   **web-push 라이브러리 자체는 실제로 검증했다** — 로컬에 설치해 자체 서명 인증서 HTTPS 서버를 띄우고,
//     진짜 VAPID 키 쌍 + 테스트용 P-256 구독 키로 webpush.sendNotification()을 실행해 서버가 실제로
//     `authorization: vapid t=...`, `content-encoding: aes128gcm`로 암호화된 본문을 받는 것까지 확인했다
//     (아래 README의 "검증 방법" 참고). **다만 Deno 런타임 자체(esm.sh를 통한 import가 Supabase Edge
//     Runtime에서 그대로 동작하는지)는 이 환경에 Deno/Docker가 없어 직접 실행해 보지 못했다** — esm.sh
//     import는 naver-login/delete-account가 @supabase/supabase-js에 이미 쓰고 있는 같은 방식이라 동작
//     가능성이 높지만, 배포 후 README의 curl 테스트로 실제 확인이 필요하다.
//   만료/무효로 판정된 토큰은 그 device_tokens 행을 즉시 삭제한다(요청 5번).
//
// ---- notifications 기록(요청 6번) ----
// 발송 성공 여부와 무관하게, 필터를 통과한 대상 전원에게 notifications 행을 하나씩 남긴다(인앱 알림센터용 -
// 기기 토큰이 아예 없는 사용자도 앱을 열면 알림 목록에서는 보여야 해서다).
//
// ---- "all" 배치(요청 7번) ----
// userIds가 "all"이면 GoTrue Admin API(`GET {SUPABASE_URL}/auth/v1/admin/users?page=&per_page=`)로 전체
// user id를 모은다(응답이 배열 그대로인지 {users:[...]}인지 실제로 호출해 확인하지 못해 둘 다 받아들인다 -
// airport-congestion/collect-travel-feed와 같은 "정직한 불확실성 표기"). 이후 필터/조회/발송/기록 전체를
// 500명 단위 청크로 나눠 돈다(명시적 userIds 배열이 500명을 넘는 경우에도 같은 청크 루프를 타서 안전하다).
//
// ---- 보안(요청 8번) ----
// NOTIFY_SECRET·FCM_SERVICE_ACCOUNT·VAPID_PRIVATE_KEY 값 자체는 어떤 로그에도 남기지 않는다 - 로그는
// 건수·성공/실패 여부·HTTP 상태코드만 남긴다(collect-travel-feed의 "인증키 비노출" 원칙과 동일).
//
// 필요한 비밀값(secrets): NOTIFY_SECRET, FCM_SERVICE_ACCOUNT, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY,
//   VAPID_SUBJECT(선택, 기본 "mailto:support@routory.app"). SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY는 자동 주입.

import webpush from "https://esm.sh/web-push@3.6.7";

const NOTIFY_SECRET_HEADER = "x-notify-secret";
const BATCH_SIZE = 500; // 요청 7번
const FCM_CHANNEL_ID = "routory-default"; // pushNotifications.js가 만드는 Android 알림 채널과 같은 id
const DEFAULT_VAPID_SUBJECT = "mailto:support@routory.app";

const VALID_TYPES = new Set(["departure", "schedule", "invite", "announcement"]);
const SETTINGS_COLUMN: Record<string, "schedule_enabled" | "share_enabled" | null> = {
  departure: "schedule_enabled",
  schedule: "schedule_enabled",
  invite: "share_enabled",
  announcement: null,
};

type Db = { supabaseUrl: string; serviceRoleKey: string };
type DeviceToken = { id: string; user_id: string; platform: string; token: string };
type NotifyInput = { userIds: string[] | "all"; type: string; title: string; body: string; url: string; tripId: string | null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function restHeaders(serviceRoleKey: string, extra?: Record<string, string>) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...extra };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ---- 입력 검증 ----

function validateBody(raw: unknown): { ok: true; value: NotifyInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "본문이 올바르지 않아요" };
  const b = raw as Record<string, unknown>;

  const userIds = b.userIds;
  const userIdsOk = userIds === "all" || (Array.isArray(userIds) && userIds.length > 0 && userIds.every((x) => typeof x === "string" && x.length > 0));
  if (!userIdsOk) return { ok: false, error: "userIds는 비어있지 않은 문자열 배열이거나 'all'이어야 해요" };

  if (typeof b.type !== "string" || !VALID_TYPES.has(b.type)) {
    return { ok: false, error: "type은 departure|schedule|invite|announcement 중 하나여야 해요" };
  }
  if (typeof b.title !== "string" || b.title.trim().length === 0) return { ok: false, error: "title이 필요해요" };
  if (b.body !== undefined && typeof b.body !== "string") return { ok: false, error: "body는 문자열이어야 해요" };
  if (b.url !== undefined && typeof b.url !== "string") return { ok: false, error: "url은 문자열이어야 해요" };
  if (b.tripId !== undefined && typeof b.tripId !== "string") return { ok: false, error: "tripId는 문자열이어야 해요" };

  return {
    ok: true,
    value: {
      userIds: userIds as string[] | "all",
      type: b.type,
      title: b.title,
      body: typeof b.body === "string" ? b.body : "",
      url: typeof b.url === "string" ? b.url : "",
      tripId: typeof b.tripId === "string" ? b.tripId : null,
    },
  };
}

// ---- 대상 사용자 ----

// GoTrue Admin API로 전체 사용자 id를 모은다("all" 전용). 응답이 배열 그대로인지 {users:[...]}인지 실제
// 호출로 확인하지 못해 둘 다 받아들인다(위 파일 설명 참고).
async function fetchAllUserIds(db: Db): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  for (;;) {
    const url = `${db.supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${BATCH_SIZE}`;
    const res = await fetch(url, { headers: restHeaders(db.serviceRoleKey) });
    if (!res.ok) throw new Error(`전체 사용자 목록 조회 실패 HTTP ${res.status}`);
    const data = await res.json();
    const users: Array<{ id: string }> = Array.isArray(data) ? data : Array.isArray((data as { users?: unknown })?.users) ? (data as { users: Array<{ id: string }> }).users : [];
    ids.push(...users.map((u) => u.id));
    if (users.length < BATCH_SIZE) break;
    page++;
  }
  return ids;
}

// notification_settings가 column=false인 사용자만 제외한다 - 행이 없는 사용자는 이 집합에 안 잡혀서
// 자동으로 "켜짐"으로 남는다(요청 3번).
async function filterBySettings(db: Db, userIds: string[], type: string): Promise<string[]> {
  const column = SETTINGS_COLUMN[type];
  if (!column || userIds.length === 0) return userIds; // announcement는 필터 없음

  const idsParam = userIds.map(encodeURIComponent).join(",");
  const url = `${db.supabaseUrl}/rest/v1/notification_settings?user_id=in.(${idsParam})&${column}=eq.false&select=user_id`;
  const res = await fetch(url, { headers: restHeaders(db.serviceRoleKey) });
  if (!res.ok) throw new Error(`알림 설정 조회 실패 HTTP ${res.status}`);
  const offRows = (await res.json()) as Array<{ user_id: string }>;
  const offSet = new Set(offRows.map((r) => r.user_id));
  return userIds.filter((id) => !offSet.has(id));
}

async function fetchDeviceTokens(db: Db, userIds: string[]): Promise<DeviceToken[]> {
  if (userIds.length === 0) return [];
  const idsParam = userIds.map(encodeURIComponent).join(",");
  const url = `${db.supabaseUrl}/rest/v1/device_tokens?user_id=in.(${idsParam})&select=id,user_id,platform,token`;
  const res = await fetch(url, { headers: restHeaders(db.serviceRoleKey) });
  if (!res.ok) throw new Error(`기기 토큰 조회 실패 HTTP ${res.status}`);
  return (await res.json()) as DeviceToken[];
}

async function deleteDeviceToken(db: Db, id: string): Promise<void> {
  const url = `${db.supabaseUrl}/rest/v1/device_tokens?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers: { ...restHeaders(db.serviceRoleKey), Prefer: "return=minimal" } });
  if (!res.ok) console.warn(`[send-notification] 만료 토큰 삭제 실패 id=${id} HTTP ${res.status}`);
}

async function insertNotifications(db: Db, userIds: string[], payload: { type: string; title: string; body: string; tripId: string | null }): Promise<void> {
  if (userIds.length === 0) return;
  const sentAt = new Date().toISOString();
  const rows = userIds.map((userId) => ({
    user_id: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body || null,
    related_trip_id: payload.tripId,
    sent_at: sentAt,
  }));
  const url = `${db.supabaseUrl}/rest/v1/notifications`;
  const res = await fetch(url, { method: "POST", headers: { ...restHeaders(db.serviceRoleKey), Prefer: "return=minimal" }, body: JSON.stringify(rows) });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`notifications insert 실패 HTTP ${res.status} ${errText.slice(0, 200)}`);
  }
}

// ---- FCM(Android) ----

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Google 서비스 계정의 RS256 JWT Bearer 플로우(RFC 7523) - Web Crypto만으로 서명한다(import 없이도 짧다).
// 서명 로직 자체는 Node의 globalThis.crypto.subtle로 자체 서명→검증 왕복까지 확인했다(README 참고).
async function getFcmAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`FCM OAuth 토큰 발급 실패 HTTP ${res.status}`); // 시크릿은 담지 않는다(요청 8번)
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("FCM OAuth 응답에 access_token이 없어요");
  return data.access_token;
}

async function sendFcm(accessToken: string, projectId: string, token: string, payload: { title: string; body: string; url: string }): Promise<{ ok: boolean; invalid: boolean; errorMessage?: string }> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url },
        android: { notification: { channel_id: FCM_CHANNEL_ID } },
      },
    }),
  });
  if (res.ok) return { ok: true, invalid: false };

  const errJson = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null;
  const status = errJson?.error?.status;
  // 요청 5번: UNREGISTERED·NOT_FOUND는 만료/삭제된 토큰 - 실제 서비스 계정 없이는 운영 응답을 재현할 수
  // 없어 문서에 나오는 두 이름을 방어적으로 둘 다 받는다(위 파일 설명 참고).
  const invalid = res.status === 404 || status === "UNREGISTERED" || status === "NOT_FOUND";
  return { ok: false, invalid, errorMessage: errJson?.error?.message ?? `HTTP ${res.status}` };
}

// ---- Web Push ----

async function sendWebPushOne(subscriptionToken: string, payloadJson: string): Promise<{ ok: boolean; invalid: boolean; errorMessage?: string }> {
  let subscription: webpush.PushSubscription;
  try {
    subscription = JSON.parse(subscriptionToken);
  } catch {
    return { ok: false, invalid: true, errorMessage: "저장된 구독 JSON을 파싱하지 못했어요" };
  }
  try {
    await webpush.sendNotification(subscription, payloadJson, { TTL: 60 * 60 });
    return { ok: true, invalid: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    const invalid = statusCode === 404 || statusCode === 410; // 요청 5번
    return { ok: false, invalid, errorMessage: (err as Error)?.message ?? String(err) };
  }
}

// ---- 핸들러 ----

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요" }, 405);

  const notifySecret = Deno.env.get("NOTIFY_SECRET");
  if (!notifySecret || req.headers.get(NOTIFY_SECRET_HEADER) !== notifySecret) {
    return json({ error: "unauthorized" }, 401); // 요청 1번 - 일반 사용자 JWT는 여기서 전혀 보지 않는다
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[send-notification] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않아요");
    return json({ error: "server not configured" }, 500);
  }
  const db: Db = { supabaseUrl, serviceRoleKey };

  const rawBody = await req.json().catch(() => null);
  const validated = validateBody(rawBody);
  if (!validated.ok) return json({ error: validated.error }, 400);
  const input = validated.value;

  let allUserIds: string[];
  try {
    allUserIds = input.userIds === "all" ? await fetchAllUserIds(db) : input.userIds;
  } catch (err) {
    console.error("[send-notification] 대상 사용자 조회 실패", (err as Error)?.message);
    return json({ error: "대상 사용자를 조회하지 못했어요" }, 500);
  }

  const stats = {
    requested: allUserIds.length,
    targeted: 0,
    sent: { android: 0, web: 0 },
    failed: { android: 0, web: 0 },
    invalidRemoved: { android: 0, web: 0 },
    notificationsInserted: 0,
  };

  // FCM 액세스 토큰/VAPID 설정은 실제로 보낼 대상이 생겼을 때만, 그리고 한 번만 준비한다(요청 8번 - 비밀값
  // 자체는 변수에만 두고 로그에 절대 찍지 않는다).
  let fcm: { accessToken: string; projectId: string } | null = null;
  let fcmFailed = false;
  async function ensureFcm(): Promise<boolean> {
    if (fcm) return true;
    if (fcmFailed) return false;
    const fcmServiceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!fcmServiceAccountJson) {
      console.error("[send-notification] FCM_SERVICE_ACCOUNT 비밀값이 설정되어 있지 않아요");
      fcmFailed = true;
      return false;
    }
    try {
      const sa = JSON.parse(fcmServiceAccountJson) as { project_id: string };
      const accessToken = await getFcmAccessToken(fcmServiceAccountJson);
      fcm = { accessToken, projectId: sa.project_id };
      return true;
    } catch (err) {
      console.error("[send-notification] FCM 액세스 토큰 발급 실패", (err as Error)?.message);
      fcmFailed = true;
      return false;
    }
  }

  let webPushReady = false;
  let webPushFailed = false;
  function ensureWebPush(): boolean {
    if (webPushReady) return true;
    if (webPushFailed) return false;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    if (!vapidPrivateKey || !vapidPublicKey) {
      console.error("[send-notification] VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY 비밀값이 설정되어 있지 않아요");
      webPushFailed = true;
      return false;
    }
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || DEFAULT_VAPID_SUBJECT, vapidPublicKey, vapidPrivateKey);
    webPushReady = true;
    return true;
  }

  // 요청 7번: "all"이든 큰 명시적 배열이든 500명 단위로 나눠 처리한다.
  for (const chunk of chunkArray(allUserIds, BATCH_SIZE)) {
    const targets = await filterBySettings(db, chunk, input.type);
    stats.targeted += targets.length;
    if (targets.length === 0) continue;

    const tokens = await fetchDeviceTokens(db, targets);
    const androidTokens = tokens.filter((t) => t.platform === "android");
    const webTokens = tokens.filter((t) => t.platform === "web");

    if (androidTokens.length > 0 && (await ensureFcm())) {
      for (const t of androidTokens) {
        const result = await sendFcm(fcm!.accessToken, fcm!.projectId, t.token, { title: input.title, body: input.body, url: input.url });
        if (result.ok) stats.sent.android++;
        else {
          stats.failed.android++;
          if (result.invalid) {
            await deleteDeviceToken(db, t.id);
            stats.invalidRemoved.android++;
          }
        }
      }
    }

    if (webTokens.length > 0 && ensureWebPush()) {
      const payloadJson = JSON.stringify({ title: input.title, body: input.body, url: input.url });
      for (const t of webTokens) {
        const result = await sendWebPushOne(t.token, payloadJson);
        if (result.ok) stats.sent.web++;
        else {
          stats.failed.web++;
          if (result.invalid) {
            await deleteDeviceToken(db, t.id);
            stats.invalidRemoved.web++;
          }
        }
      }
    }

    try {
      await insertNotifications(db, targets, { type: input.type, title: input.title, body: input.body, tripId: input.tripId });
      stats.notificationsInserted += targets.length;
    } catch (err) {
      console.error("[send-notification] notifications insert 실패", (err as Error)?.message);
    }
  }

  console.log(
    `[send-notification] type=${input.type} requested=${stats.requested} targeted=${stats.targeted} ` +
      `sent.android=${stats.sent.android} sent.web=${stats.sent.web} failed.android=${stats.failed.android} failed.web=${stats.failed.web} ` +
      `invalidRemoved.android=${stats.invalidRemoved.android} invalidRemoved.web=${stats.invalidRemoved.web} notificationsInserted=${stats.notificationsInserted}`
  );

  return json(stats);
});
