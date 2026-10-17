# search-pexels (Supabase Edge Function)

`/admin`의 "추천 도시" 탭 → 도시 이미지 섹션의 "Pexels에서 검색"이 쓰는 함수입니다. `PEXELS_API_KEY`를
서버에만 두기 위해 존재합니다 — Pexels 키는 Google Maps 브라우저 키와 달리 도메인(리퍼러) 제한 기능이
없어서, 관리 페이지 JS 파일에 그대로 넣으면 누구나 페이지 소스만 보고 꺼내 쓸 수 있습니다.
`search-destination`이 `GOOGLE_PLACES_API_KEY`를 서버에만 두는 것과 같은 이유·같은 패턴입니다.

로그인만으로는 안 되고 **관리자(`is_admin()`)만** 호출할 수 있습니다 — 화면을 숨기는 것과 별개로 서버
단에서도 막혀 있어야 한다는 요청을 Edge Function까지 그대로 적용했습니다.

## 요청과 응답

`POST /functions/v1/search-pexels` `{ "query": "Tokyo cityscape" }`

- `Authorization: Bearer <로그인한 사용자의 access token>` 필요 (supabase-js의 `functions.invoke`를 쓰면
  자동으로 실립니다).
- 로그인하지 않았으면 401, 로그인은 했지만 관리자가 아니면 403.

성공하면:

```json
{
  "results": [
    {
      "imageUrl": "https://images.pexels.com/photos/.../photo.jpeg",
      "thumbUrl": "https://images.pexels.com/photos/.../photo.jpeg?...medium...",
      "creditName": "작가 이름",
      "creditUrl": "https://www.pexels.com/@...",
      "license": "Pexels License",
      "sourceName": "Pexels",
      "sourceUrl": "https://www.pexels.com/photo/..."
    }
  ]
}
```

- `imageUrl`/`thumbUrl`은 Pexels가 직접 호스팅하는 URL을 그대로 돌려줍니다(다운로드·재업로드 없음 —
  핫링크) — Wikimedia 검색과 같은 방식입니다.
- 그 밖의 상태: `400` query 없음, `401` 비로그인, `403` 비관리자, `405` POST 아님, `500` 서버 설정 누락
  (`PEXELS_API_KEY` 등), `502` Pexels 호출 실패.

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# pexels.com/api 에서 무료로 발급받은 키
supabase secrets set PEXELS_API_KEY=<Pexels API 키>

supabase functions deploy search-pexels
```

로그인한 사용자가 직접 호출하는 함수라 `--no-verify-jwt`는 **쓰지 않습니다**(search-destination과 동일).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키 - triplog/js/supabaseClient.js 참고>
export USER_JWT=<관리자 계정으로 로그인한 세션의 access_token>

curl -sS -X POST "$SUPABASE_URL/functions/v1/search-pexels" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"Tokyo cityscape"}'
```

관리자가 아닌 계정의 토큰으로 호출하면 403이 와야 합니다.
