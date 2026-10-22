# send-contact-email (Supabase Edge Function)

설정 > 고객센터 > 문의하기(#/contact)의 "1:1 문의하기" 창이 보낸 제목/내용을 Resend로 이메일 한 통을 보냅니다.
받는 메일 주소는 이 함수의 비밀값(`CONTACT_EMAIL`)으로만 존재합니다 — 코드·클라이언트 어디에도 적지 않습니다.

## 요청과 응답

`POST /functions/v1/send-contact-email`

```json
{ "title": "로그인이 안 돼요", "content": "카카오로 로그인하면 자꾸 오류가 나요." }
```

- `title`: 1~100자. `content`: 1~2000자. 둘 다 앞뒤 공백을 지운 뒤 길이를 검사합니다.
- `Authorization: Bearer <로그인한 사용자의 access_token>`이 필요합니다. 앱에 공개된 anon 키만으로는 401이 납니다.
- 보낸 사람(문의자)의 이메일·이름은 그 토큰에서 읽어서, 이메일을 발신 이메일의 **Reply-To**로 실어 보냅니다 — `CONTACT_EMAIL` 받는 사람이 그대로 "답장"을 누르면 문의자에게 바로 갑니다.

성공:

```json
{ "ok": true }
```

실패(비밀값 미설정, Resend 오류 등 — **HTTP 200**, analyze-ticket과 같은 관례):

```json
{ "error": "문의를 보내지 못했어요. 잠시 후 다시 시도해주세요." }
```

그 밖의 상태: `401` 로그인 필요, `400` 제목/내용이 비었거나 너무 긺, `405` POST가 아님.

## 배포 (터미널에서 직접)

```bash
# 1) 프로젝트 연결 (처음 한 번)
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# 2) resend.com 가입 후 발급받은 API 키, 그리고 문의 메일을 받을 주소를 비밀값으로 저장
supabase secrets set RESEND_API_KEY=<발급받은 Resend API 키>
supabase secrets set CONTACT_EMAIL=<문의 메일을 받을 주소>

# 3) 배포 (--no-verify-jwt는 붙이지 마세요: 로그인 확인이 꺼집니다)
supabase functions deploy send-contact-email
```

- 도메인을 인증하지 않은 상태라면 Resend 정책상 **CONTACT_EMAIL을 Resend 가입에 쓴 바로 그 이메일로** 맞춰야 실제로 발송됩니다(그 외 주소로는 테스트 발신 주소 `onboarding@resend.dev`가 막힐 수 있어요). 직접 도메인을 인증하면 이 제한이 풀리고, 발신 주소도 비밀값 `CONTACT_FROM_EMAIL`(예: `"Routory 문의하기 <no-reply@내도메인>"`)로 원하는 대로 바꿀 수 있습니다.
- 로그 보기: Supabase 대시보드 → Edge Functions → send-contact-email → Logs (제목/내용 본문은 로그에 남기지 않고, 실패 사유와 상태 코드만 남깁니다).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키>
export TOKEN=<로그인한 사용자의 access_token>   # analyze-ticket README와 같은 방법으로 얻습니다

# ① 정상 호출: {"ok":true}가 오고, CONTACT_EMAIL로 메일이 도착해야 합니다
curl -sS -X POST "$SUPABASE_URL/functions/v1/send-contact-email" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"테스트 문의","content":"배포 확인용 메시지입니다."}'

# ② 로그인 없이(anon 키만) 호출: 401 {"error":"로그인이 필요해요"}가 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/send-contact-email" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"x","content":"y"}'

# ③ 내용 없이 호출: 400 {"error":"제목과 내용을 모두 입력해주세요."}가 와야 합니다
curl -sS -i -X POST "$SUPABASE_URL/functions/v1/send-contact-email" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"","content":""}'
```

## 앱에서 부르는 방법 (연결되어 있음)

```js
const { data, error } = await TripLog.supabase.functions.invoke("send-contact-email", {
  body: { title, content },
});
// error가 있거나 data.ok가 아니면 data.error(또는 기본 안내문)를 창의 오류 영역에 보여준다
```

`contactForm.js`의 "1:1 문의하기" 버튼이 이 방식으로 호출합니다. 로그인한 상태여야 호출됩니다.
