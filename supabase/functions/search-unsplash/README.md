# search-unsplash (Supabase Edge Function)

`/admin`의 "추천 도시" 탭 → 도시 이미지 섹션의 "Unsplash에서 검색"이 쓰는 함수입니다. `UNSPLASH_ACCESS_KEY`를
서버에만 두기 위해 존재합니다 — `search-pexels`와 같은 이유·같은 패턴입니다(Pexels/Unsplash 키 둘 다
도메인(리퍼러) 제한 기능이 없어서, 관리 페이지 JS 파일에 그대로 넣으면 누구나 페이지 소스만 보고
꺼내 쓸 수 있습니다).

로그인만으로는 안 되고 **관리자(`is_admin()`)만** 호출할 수 있습니다 — `search-pexels`와 동일하게
Edge Function 레벨에서도 관리자만 통과시킵니다.

## Unsplash API 이용약관(Guidelines)과 이 함수의 관계

`scripts/collect-city-images/README.md`는 그 로컬 수집 스크립트에서 Unsplash를 일부러 뺐습니다 —
그 스크립트는 이미지를 **다운로드해 Storage에 복사**하는 방식인데, Unsplash 약관은 다운로드·캐싱을
금지하고 핫링크만 허용하기 때문입니다. 이 Edge Function이 쓰는 "관리 페이지 실시간 검색" 방식은
처음부터 **핫링크만** 하므로(Wikimedia/Pexels 검색과 동일 — URL을 저장만 하고 파일을 내려받지 않음)
그 제약에 걸리지 않습니다. 대신 Unsplash 약관의 또 다른 의무가 남습니다:

- **다운로드 트래킹**: 사진을 "사용"(이 앱에서는 "후보로 추가" = 그 사진을 쓰기로 고르는 순간)할 때마다
  Unsplash의 `download_location` 엔드포인트에 GET을 보내야 합니다. 검색 응답의 각 결과에
  `downloadLocation`이 들어 있고, `adminPage.js`가 "후보로 추가" 클릭 시 이 함수를
  `{ downloadLocation }` 모드로 한 번 더 호출해 트래킹합니다(ACCESS_KEY를 클라이언트에 노출하지
  않으려고 트래킹도 서버를 거칩니다).
- **귀속 표시(attribution)**: 응답의 `creditUrl`/`sourceUrl`에 Unsplash가 요구하는 `utm_source=routory&
  utm_medium=referral` 파라미터를 서버에서 미리 붙여서 돌려줍니다.

## 요청과 응답

### 검색: `POST /functions/v1/search-unsplash` `{ "query": "Tokyo cityscape" }`

- `Authorization: Bearer <로그인한 사용자의 access token>` 필요 (supabase-js의 `functions.invoke`를 쓰면
  자동으로 실립니다).
- 로그인하지 않았으면 401, 로그인은 했지만 관리자가 아니면 403.

성공하면:

```json
{
  "results": [
    {
      "imageUrl": "https://images.unsplash.com/photo-.../regular",
      "thumbUrl": "https://images.unsplash.com/photo-.../small",
      "creditName": "작가 이름",
      "creditUrl": "https://unsplash.com/@...?utm_source=routory&utm_medium=referral",
      "license": "Unsplash License",
      "sourceName": "Unsplash",
      "sourceUrl": "https://unsplash.com/photos/...?utm_source=routory&utm_medium=referral",
      "downloadLocation": "https://api.unsplash.com/photos/.../download"
    }
  ]
}
```

- `imageUrl`/`thumbUrl`은 Unsplash가 직접 호스팅하는 URL을 그대로 돌려줍니다(다운로드·재업로드
  없음 — 핫링크) — Wikimedia/Pexels 검색과 같은 방식입니다.
- `downloadLocation`은 `discover_city_images`에 저장하지 않습니다(그 테이블엔 그런 컬럼이 없습니다) —
  "후보로 추가" 클릭 시 트래킹 호출에만 1회성으로 쓰고 버립니다.

### 다운로드 트래킹: `POST /functions/v1/search-unsplash` `{ "downloadLocation": "https://api.unsplash.com/photos/.../download" }`

- 같은 로그인/관리자 검증을 거칩니다.
- `downloadLocation`은 반드시 `https://api.unsplash.com/`으로 시작해야 합니다(이 함수가 검색 응답으로
  방금 돌려준 값이어야 함) — 아니면 400. 임의 URL을 이 함수로 프록시해 ACCESS_KEY를 실어 보내는 열린
  리다이렉터가 되지 않게 하는 안전장치입니다.
- 성공하면 `{ "ok": true }`.
- 이 호출이 실패해도(502) 관리 페이지는 "후보로 추가" 자체는 그대로 진행합니다 — 트래킹은 Unsplash
  쪽 준수 의무이지, 관리자의 작업을 막을 이유는 아닙니다(콘솔에 경고만 남습니다).

그 밖의 상태: `400` query/downloadLocation 형식 오류, `401` 비로그인, `403` 비관리자, `405` POST 아님,
`500` 서버 설정 누락(`UNSPLASH_ACCESS_KEY` 등), `502` Unsplash 호출 실패.

## 배포

```bash
supabase login
supabase link --project-ref ffzjgiknrrgwvgobybdq

# unsplash.com/developers 에서 무료로 만든 앱의 Access Key (Demo 앱이면 충분 - 시간당 호출 한도만 낮음)
supabase secrets set UNSPLASH_ACCESS_KEY=<Unsplash Access Key>

supabase functions deploy search-unsplash
```

로그인한 사용자가 직접 호출하는 함수라 `--no-verify-jwt`는 **쓰지 않습니다**(`search-pexels`와 동일).

## 배포 후 테스트 (curl)

```bash
export SUPABASE_URL=https://ffzjgiknrrgwvgobybdq.supabase.co
export ANON_KEY=<anon 키 - triplog/js/supabaseClient.js 참고>
export USER_JWT=<관리자 계정으로 로그인한 세션의 access_token>

curl -sS -X POST "$SUPABASE_URL/functions/v1/search-unsplash" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"Tokyo cityscape"}'
```

관리자가 아닌 계정의 토큰으로 호출하면 403이 와야 합니다.
