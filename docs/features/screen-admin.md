# 관리 페이지 (`/admin`)

> CLAUDE.md에서 이동된 상세 내용. 이 영역을 작업하기 전에 먼저 읽을 것. PRD: `docs/prd/PRD v13 - 메인 화면 개선 (여행 소식·인기 여행지).md`.
> DB 스키마/RLS/RPC는 `supabase/CLAUDE.md`의 `020_admins.sql`~`023_travel_feed_source_checks.sql` 항목이 원본이다 — 이 문서는 클라이언트(`triplog/admin.html`, `triplog/js/adminPage.js`) 쪽만 다룬다.

## 왜 SPA 밖의 독립 페이지인가

`index.html`의 해시 라우터(`#/...`)는 로그인/동의 가드가 걸린 "일반 사용자" 화면만 위한 것이다. 관리 페이지는:

- 일반 사용자에게 어디에도 링크를 노출하면 안 되고 (메뉴·푸터·raw HTML 어디에도 `/admin` 언급 없음)
- 권한 없는 사람이 들어와도 "관리자 전용 페이지가 있다"는 사실 자체를 알 수 없어야 한다

이 두 조건은 해시 라우터에 또 하나의 보호된 라우트를 추가하는 것보다, 아예 `index.html`과 분리된 정적 페이지로 만드는 쪽이 지키기 쉽다. `naver-callback.html`/`account-deletion.html`과 같은 자리(SPA 밖, Vercel/`serve.py`가 확장자 없는 경로를 `.html`로 풀어주는 방식)를 쓰되, 그 둘과 달리 **`css/style.css`를 그대로 불러온다** — 관리자만 쓰는 내부 도구라 새 디자인을 만들 필요가 없고, `.wizard*`/`.pick-list`/`.search-input`/`.btn*`/`.tab*`/`.form-field` 등 기존 클래스·토큰을 그대로 재사용한다. 새로 필요한 모양(배지, 랭킹 입력 줄, 자동완성 드롭다운)만 `style.css` 18번 섹션(`[ADMIN]`)에 추가했다.

`js/supabaseClient.js`도 그대로 로드한다 — 같은 오리진이라 메인 앱에서 이미 로그인한 세션(localStorage)을 그대로 읽는다. **이 페이지엔 로그인 UI가 없다**: 관리자는 먼저 메인 사이트(`/`)에서 평소처럼 로그인한 뒤 `/admin`으로 들어와야 한다.

## 접근 제어 (2단계, 어느 한쪽만으론 안 됨)

1. **클라이언트**: `adminPage.js`의 `initGate()` — `supabase.auth.getSession()`으로 세션이 없으면 즉시 `#admin-notfound`("페이지를 찾을 수 없어요")만 보여주고 끝. 세션이 있으면 `supabase.rpc('is_admin')`을 불러서 `false`/에러면 마찬가지로 404 화면. **두 경우 모두 "로그인하세요"나 "권한이 없습니다" 같은 문구를 절대 보여주지 않는다** — 관리자가 아닌 사람은 이 주소에 뭔가 특별한 게 있다는 것조차 알 수 없어야 한다는 지시 때문이다.
2. **서버(RLS)**: 화면을 숨기는 것만으로는 부족하다 — `is_admin()`을 우회해 직접 Supabase REST를 호출하면 뚫릴 수 있으니, DB 쪽도 독립적으로 막는다. `travel_feed_items`/`popular_destinations` 둘 다 insert/update/delete 정책이 `using/with check (public.is_admin())`이고, draft/archived 조회도 관리자 전용 select 정책(`021`의 "게시된 것만" 정책과 OR로 합쳐짐)이 따로 있어야 보인다. 그래서 JS를 끄거나 우회 호출을 해도 서버가 거부한다.

관리자 이메일/UID는 코드 어디에도 하드코딩하지 않는다 — `admins` 테이블(`020_admins.sql`)에 들어있는지로만 판정하고, 그 테이블에 행을 추가/삭제하는 것 자체는 Supabase 대시보드에서 운영자가 수동으로 한다.

## 여행 소식 관리

- 상태 탭 3개: 승인 대기(`status='draft'`, 수동 초안 + 자동 수집 후보 둘 다 포함) / 게시 중(`published`) / 보관(`archived`).
- "+ 새 소식 등록"으로 폼을 열면 등록, 각 카드의 "수정" 버튼을 누르면 그 행을 폼에 채워서 수정 모드로 연다. **등록/수정 폼은 필드만 저장한다** — `status`를 바꾸지 않는다. 게시/보관/삭제/반려는 전부 목록 카드의 버튼이 바로 그 행의 `status`만 업데이트하거나 삭제하는 별개 동작이다. 새로 등록한 글은 항상 `status:'draft', origin:'manual'`로 시작하므로, 바로 공개하려면 등록 후 "승인 대기" 탭에서 "게시"를 한 번 더 눌러야 한다 — 이게 검토 단계를 강제하는 장치다.
- `kind`(안전/혜택)를 `benefit`으로 바꾸면 적용 시작일/종료일 입력칸이 나타난다(`toggleValidFields`) — `safety`면 그 값들은 폼에서 숨겨지고 저장 시 강제로 `null`이 된다.
- 요약 입력칸: 글자 수를 실시간으로 보여주고(`len/200`), 300자를 넘으면 경고 문구만 띄운다(저장을 막진 않는다 — "200자 내외"는 권장일 뿐 하드 제한이 아니라는 지시 때문). 바로 위에 "원문을 그대로 붙여넣지 말고 우리 문장으로 요약하세요" 안내 문구를 고정으로 보여준다.
- 저장 시 필수 검증(클라이언트): 제목/지역 표기/요약/게시일/출처 이름/출처 URL이 비어 있으면 저장 불가, 출처 URL은 `https://`로 시작해야 함. 같은 규칙을 DB에도 체크 제약으로 걸어서(`023_travel_feed_source_checks.sql`) 이 폼 하나만 믿지 않는다.
- `origin='auto'`인 draft 행(자동 수집 후보 — **수집 Edge Function 자체는 아직 만들지 않았다**, 이 페이지는 그 결과를 검토하는 쪽만 구현됨)은 "승인 대기" 탭 안에서 다른 draft와 같이 보이되, 카드에 수집 시각(`created_at`)과 원문 링크를 추가로 보여주고, "보관" 버튼 대신 "반려" 라벨의 버튼을 쓴다 — 동작은 둘 다 `status→'archived'`로 동일하다(스키마에 `rejected` 상태가 따로 없다).
- 카드 하단에 "게시일 · 만든이 · 수정 시각(수정한 사람) · 게시자"를 한 줄로 보여준다(변경 이력 요구사항) — `created_by`/`updated_by`/`published_by`는 `get_admin_labels()` RPC로 가져온 이메일로 표시하고, 모르는 uuid면 앞 8자만 보여준다.
- **대표 이미지(선택, `travel_feed_items.image_url`, `035_travel_feed_image.sql`)**: "도시 이미지" 탭(추천 도시)의 Unsplash/Wikimedia 검색 패턴을 그대로 가져왔지만, `discover_city_images`처럼 별도 테이블·저작자/라이선스 컬럼·draft/published 다중 이미지 갤러리를 두지 않고 **행 하나에 URL 한 개만** 저장하는 훨씬 단순한 버전이다.
  - `#feed-image-url` 입력칸에 직접 URL을 붙여넣거나(요구사항의 "직접 URL 입력"), 바로 아래 "Unsplash에서 검색"/"Wikimedia Commons에서 검색" 결과 카드의 "이 사진 쓰기"를 누르면 그 자리에서 `setFeedImageUrl()`이 입력칸 값과 미리보기(`#feed-image-preview`, `.admin-city-card-preview-tile` 재사용)를 같이 채운다 — 셋 다 같은 한 칸을 덮어쓸 뿐이라 "마지막으로 고른 것"이 항상 최종값이다. "이미지 제거" 버튼은 그 칸을 비운다.
  - **Unsplash**: `search-unsplash` Edge Function(추천 도시 탭이 쓰는 것과 동일, 코드 수정 없이 재사용)을 그대로 호출 — `{query}`로 검색, 결과를 고르면 Unsplash 이용약관이 요구하는 다운로드 트래킹(`{downloadLocation}`)을 best-effort로 한 번 더 호출한다(실패해도 이미지 선택은 유지).
  - **Wikimedia Commons**: 새 Edge Function을 안 만들고 `adminPage.js#searchFeedWikimedia`가 "도시 이미지" 탭의 `searchWikimedia`와 같은 규칙(브라우저에서 `commons.wikimedia.org/w/api.php`를 `origin=*`로 직접 호출, 허용 라이선스 화이트리스트 CC0/퍼블릭 도메인/CC BY(-SA)만, 저작자 표기 없는 결과는 제외)으로 feed 폼 전용 엘리먼트 id(`#feed-wiki-*`)에 바인딩된 별도 사본을 쓴다 — 저작자/라이선스는 검색 결과 카드에 보여주기만 하고 DB엔 저장하지 않는다(이 테이블에 그 컬럼이 없다).
  - 저장 검증: `image_url`이 있으면 `source_url`과 같은 규칙으로 `https://`로 시작해야 저장된다(클라이언트 검증만, DB 체크 제약은 없다 — `023`의 `source_url`/`source_name` 체크와 달리 이 컬럼은 선택값이라 아직 안 걸었다).
  - **사진 출처 표기(요구사항, `image_credit_name`/`image_credit_url`/`image_license`/`image_source_name`/`image_source_url`, `037_travel_feed_image_credit.sql`)**: Wikimedia의 CC BY(-SA)는 저작자 표기가 라이선스 조건이라, 이미지 URL뿐 아니라 "누구 사진인지·어디서 가져왔는지"도 같이 저장한다 — `discover_city_images`와 같은 필드 이름(`credit_name`/`credit_url`/`license`/`source_name`/`source_url`)을 쓰되, `travel_feed_items`엔 이미 뉴스 원문용 `source_name`/`source_url`이 있어 전부 `image_` 접두어를 붙였다. Unsplash/Wikimedia 검색 결과의 "이 사진 쓰기"를 누르면 `setFeedImageUrl(url, credit)`이 대표 이미지 URL과 이 5개 입력칸을 한 번에 채운다(그대로 저장해도 되고 관리자가 고쳐도 된다) — 직접 URL을 입력(`#feed-image-url`의 `input` 이벤트)하면 직전에 자동으로 채워진 출처가 더 이상 그 이미지의 것이 아닐 수 있어 먼저 비운다. 전부 선택값이라 비워도 저장은 되고, 그 경우 사용자 화면은 출처 줄 자체를 숨긴다. `image_credit_url`/`image_source_url`도 값이 있으면 `https://`만 허용(클라이언트 검증).
  - **직접 URL 입력 시 호스트 기반 출처 추정(`guessImageSourceFromUrl`)**: 검색을 안 거쳤으니 특정 사진 페이지의 저작자까지는 알 수 없지만, URL의 호스트명만 보고 알려진 서비스(Unsplash/Wikimedia/Pexels, `KNOWN_IMAGE_HOSTS`)인지 먼저 체크한다 — 맞으면 그 서비스의 대표 사이트 주소(예: `https://unsplash.com`, 특정 사진 페이지가 아니라 메인 사이트)를 `image_source_name`/`image_source_url`에 채워서 완전히 빈 칸보다는 "최소한 어디서 왔는지"가 남게 한다. 모르는 호스트면 기존대로 비운다(관리자가 직접 채운다). `image_credit_name`(저작자 이름)은 이 방식으로는 못 채운다 — 저작자까지 정확히 남기려면 검색 결과를 써야 한다.
  - 노출: 메인 화면 카드(`feedCardHtml`)와 전체 목록 화면 둘 다 카드 상단에 16:9 썸네일(`.feed-card-thumb`)로, 상세 모달(`openDetail`)은 제목 위에 같은 비율 이미지(`.feed-detail-image`)로 보여준다 — 둘 다 `image_url`이 없으면 해당 엘리먼트를 안 그리거나(`feed-card-thumb`) `hidden`을 건다(`feed-detail-image`), 기존 소식(컬럼 추가 전 행)은 전부 이미지 없이 기존 모습 그대로다. 관리 페이지 목록(`renderFeedItem`)도 `.pick-thumb`(기존 클래스 재사용)으로 작은 썸네일을 보여준다.

## 인기 여행지 관리

- `scope`(해외/국내) + `period`(`<input type="month">`, `'YYYY-MM'`)를 고르고 "불러오기"를 누르면 그 조합의 기존 10줄(랭크 1~10)을 `popular_destinations`에서 읽어와 화면에 채운다. 처음 열었을 때도(불러오기 전) 빈 10줄이 항상 보여서 새 기준월을 바로 입력할 수 있다.
- 도시명 입력칸마다 자체 자동완성 드롭다운이 있다 — `destinations.name_ko`/`name_en`을 `ilike`로 검색(입력마다 300ms 디바운스), 목록에서 고르면 그 줄의 `destination_id`/`country_code`가 채워지고, 고르지 않고 자유 입력만 하면 둘 다 `null`로 저장된다(요구사항의 "없으면 이름만 저장해도 된다"를 그대로 구현).
- 출처 이름/URL은 10줄이 공유하는 필드 한 쌍뿐이다(한 번의 랭킹 발표는 보통 출처 하나라서 줄마다 따로 받지 않았다) — 비어 있거나 `https://`가 아니면 저장 자체가 안 된다.
- "임시 저장"과 "게시" 버튼은 같은 저장 로직(각 줄을 `(scope, period, rank)` 유니크 키로 `upsert`)을 상태(`draft`/`published`)만 다르게 호출한다. 입력칸을 비운 채 저장하면 그 랭크에 이미 있던 행을 삭제한다(빈 입력 = "이 순위는 없다"는 의도로 해석).
- 이미 저장된 줄에는 그 자리에서 바로 지울 수 있는 개별 삭제 버튼이 따로 있다(배치 저장과 별개로 즉시 실행됨).

## 추천 도시 관리 (`discover_cities`)

- 목록 화면에 **승인 대기(`is_active=false`) / 게시 중(`is_active=true`)** 탭이 있다(여행 소식 탭과 같은 자리·스타일). 각 도시 카드에 "게시"/"승인 대기로 전환" 버튼이 있어 상세 화면을 열지 않고도 바로 상태를 바꿀 수 있다 — 상세 화면의 "활성" 체크박스와 같은 값(`is_active`)을 공유한다.
- "+ 도시 추가"로 새 도시를 넣으면 **바로 게시되지 않고 승인 대기로 들어간다**(`is_active:false`로 insert) — 대표 이미지·월별 추천 이유·대표 관광지를 채우기 전에 메인 화면 후보에 노출되는 걸 막기 위해서다. 콘텐츠를 다 채운 뒤 목록에서 "게시"를 눌러야 `get_discover_cities`에 포함될 수 있다.
- `scripts/collect-city-images/collect.mjs`는 이제 `is_active` 여부로 대상을 거르지 않는다(과거엔 활성 도시만 처리) — 승인 대기 도시도 게시 전에 이미지 후보가 필요해서다.
- **`scripts/collect-city-content/`**(신규, `collect-months.mjs`/`collect-highlights.mjs`): 월별 추천 이유(`discover_city_months`)·대표 관광지(`city_highlights`) 초안을 Open-Meteo/위키백과에서 모은다. 이 두 테이블엔 자체 draft/published 컬럼이 없지만, `get_discover_cities`/`get_city_detail`과 두 테이블의 RLS가 전부 `discover_cities.is_active`를 게이트로 쓰므로 **승인 대기 도시(`is_active=false`)엔 바로 insert/upsert하고(어차피 게시 전엔 안 보임), 이미 게시 중인 도시엔 절대 쓰지 않고 JSON 리포트에만 제안을 남긴다.** 자동 저장도 "확정"은 아니다 — 월별 점수는 임시값(기본 3점), 명소 후보는 역/행정구역 등이 섞여 나올 수 있어 **도시를 "게시"로 전환하기 전에 반드시 이 화면에서 한 번 더 확인해야 한다.** 자세한 내용/한계는 그 폴더의 README 참고.

## 알려진 한계 / 다음에 할 수 있는 것

- 자동 수집 Edge Function(`collect-travel-feed`)이 생겼다 — `pg_cron`이 매일 한 번 불러서 외교부 여행경보·안전공지·한국관광공사 TourAPI 축제·행사를 `origin='auto', status='draft'`로 쌓는다. 자세한 내용은 `supabase/CLAUDE.md`의 `025_collect_travel_feed_cron.sql`/Edge Function `collect-travel-feed` 항목 참고. 이 관리 페이지는 그 결과를 "승인 대기" 탭에서 검토해서 게시/반려하는 쪽만 담당한다 — 공식 통계가 API/파일로 공개되지 않는 인기 여행지는 여전히 전부 수동 입력이다.
- `get_travel_feed`/`get_popular_destinations` RPC(`021_travel_feed.sql`)를 실제로 호출해서 소식/랭킹을 보여주는 **일반 사용자용 메인 화면 UI는 아직 만들지 않았다** — 이번 작업은 관리 페이지(쓰기 쪽)까지다.
- `country_currency`에는 국가 한글명이 없어서, 소식 등록 폼의 "국가코드" 셀렉트는 `JP · japan`처럼 코드+지역 태그로만 표시된다(사람이 읽는 국가명 테이블이 없다는 스키마상 한계). 필요해지면 국가명 매핑을 어딘가에 추가해야 한다.
