# collect-city-images (로컬 스크립트)

'어디로 떠나볼까요' 도시 카드(`027_discover_cities.sql#discover_cities`)에 쓸 대표 이미지 후보를 모아
`discover_city_images`에 `status='draft'`로만 저장합니다. **자동으로 게시(published)하지 않습니다** —
저장된 후보를 사람이 관리 페이지(`/admin`의 "도시 이미지" 탭)에서 눈으로 보고 골라야 실제로 노출됩니다.

triplog 앱 번들(`triplog/`)과 별개의 Node 스크립트입니다 — 저장소 루트 `package.json`(Supabase CLI 전용)
을 건드리지 않으려고 이 폴더에 자체 `package.json`을 둡니다.

## 쓰는 소스 (단계 0 조사에서 "복사 가능"으로 확인된 것만)

| 소스 | 방식 | 비고 |
|---|---|---|
| Wikimedia Commons | 다운로드해 Storage에 복사 | API 키 불필요. `LicenseShortName`이 CC0/퍼블릭 도메인/CC BY(-SA)일 때만 통과시키고, 비상업·변경금지(NC/ND) 라이선스나 저작자 표기가 없는 파일은 자동으로 제외합니다. |
| Pexels | 다운로드해 Storage에 복사 | `PEXELS_API_KEY` 필요(없으면 이 소스만 건너뜁니다). |

**이 스크립트에서 일부러 안 쓴 소스**(단계 0 조사 결과, `providers/`에 같은 인터페이스로 추가할 수는
있습니다):
- **Unsplash**: API 약관상 다운로드·캐싱이 금지돼 있고(핫링크만 허용) 별도의 다운로드 트래킹 엔드포인트
  호출 의무가 있어, "다운로드해 Storage에 복사"하는 이 스크립트의 방식과는 안 맞습니다. 대신
  **`/admin`의 "추천 도시" 탭 → 도시 이미지 섹션의 실시간 검색**(Wikimedia/Pexels 검색과 같은 자리)에
  핫링크 전용 + 선택 시점 1회 다운로드 트래킹으로 추가했습니다 — `supabase/functions/search-unsplash/`.
- **Google Places Photos**: 유료(크레딧 소진 후 1,000건당 $7)이고 공식 문서가 캐싱을 명시적으로 금지합니다.
- **한국관광공사 TourAPI 이미지**: 공공누리 3유형(변경금지)이 83%를 차지해서 800px 리사이즈 자체가
  라이선스 위반이 될 수 있고, 1유형만 걸러 쓰려면 사진별 유형 확인이 추가로 필요합니다.
- **AI 생성 이미지**: 쓰지 않습니다(요청사항).

사람 얼굴이 중심인 사진·도시 풍경이 아닌 사진·로고/워터마크가 있는 사진을 걸러내는 건 **이 스크립트가
아니라 관리자**입니다 — 검색어를 도시 풍경 쪽으로 맞추고 `orientation=landscape`를 쓰지만 이건 힌트일
뿐 자동 판별이 아닙니다. 실제로 Tokyo로 테스트해 보면 1860년대 흑백 에도 사진처럼 "틀린 건 아니지만
카드에 쓸 만하지 않은" 후보가 섞여 나옵니다 — 그래서 사람이 보는 단계가 반드시 필요합니다.

## 준비

### 1. Supabase Storage 버킷 만들기 (대시보드, 최초 1회)

`wallet` 버킷(006_wallet.sql)과 같은 방식 — 버킷 자체는 SQL로 만들지 않습니다.

1. Supabase 대시보드 → Storage → New bucket
2. 이름: `discover-images`
3. **Public bucket: ON** (`wallet`과 반대입니다 — 저작권 걱정 없는 공개 라이선스 이미지라 서명 URL 없이
   그냥 공개 URL로 서빙합니다)
4. 파일 크기 제한은 기본값으로 둬도 충분합니다(리사이즈된 webp는 보통 수십~수백 KB)

이 버킷엔 **Storage RLS 정책을 따로 만들지 않습니다** — 쓰기는 이 스크립트가 `service_role` 키로 하므로
(service_role은 RLS를 우회), 읽기는 버킷이 Public이라 RLS와 무관하게 공개 URL로 서빙되기 때문에 둘 다
정책이 필요 없습니다. 반대로 말하면 `anon`/`authenticated` 세션으로는 이 버킷에 **쓸 수 없습니다**(정책이
없으니 기본 거부) — 이 스크립트(로컬, service_role 키)만 올릴 수 있는 게 의도된 보안 상태입니다.

### 2. 의존성 설치

```bash
cd scripts/collect-city-images
npm install
```

### 3. 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `SUPABASE_URL` | O | `https://ffzjgiknrrgwvgobybdq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | O | Supabase 대시보드 → Settings → API의 `service_role` 키. **절대 커밋/공유하지 않을 것** — `discover_city_images` insert는 RLS가 `is_admin()`만 허용하는데, 이 스크립트는 로그인 세션 없이 도는 로컬 도구라 서비스 키로 RLS를 우회합니다. |
| `PEXELS_API_KEY` | 선택 | 없으면 Pexels는 건너뛰고 Commons만 씁니다. [pexels.com/api](https://www.pexels.com/api/) 무료 가입. |
| `WIKIMEDIA_CONTACT` | 선택(강력 권장) | 이메일 또는 URL. [Wikimedia User-Agent 정책](https://meta.wikimedia.org/wiki/User-Agent_policy)이 연락처 없는 요청을 더 공격적으로 제한합니다 — 실제로 이 값 없이 27개 도시를 돌렸더니 9번째 도시쯤부터 나머지 전부가 조용히 "후보 없음"으로 막힌 적이 있습니다(요청이 거부된 거였는데 원래 코드가 그 실패를 삼켜서 "사진이 없다"처럼 보였습니다 — 지금은 콘솔에 경고가 남습니다). |

네 값 모두 코드에 적지 않고 `process.env`로만 읽으며, 로그에도 절대 출력하지 않습니다.

## 실행

```bash
# discover_cities 전체(승인 대기 + 게시 중) 처리, 도시당 최대 5개 후보
node collect.mjs

# 미리보기만(DB/Storage에 아무것도 쓰지 않음)
node collect.mjs --dry-run

# 도시 하나만(디버깅/테스트용, name_en 부분일치)
node collect.mjs --city=Tokyo --dry-run

# 도시당 후보 수 조정(1~5)
node collect.mjs --max=3
```

재실행해도 안전합니다 — 도시별로 이미 저장된 `source_url`과 겹치는 후보는 다시 저장하지 않습니다(중복
건너뜀 개수를 마지막 요약에 출력합니다).

## 저장되는 값

`discover_city_images` 한 행 = 후보 하나. 복사 가능한 소스(Commons/Pexels)는 가로 800px(`image_url`)/
320px(`thumb_url`) webp로 리사이즈해 `discover-images` 버킷에 올린 뒤 그 **공개 URL**을 저장합니다. 핫링크만
허용되는 소스를 나중에 추가하면(`providers/`에 같은 인터페이스로) 원본 URL을 그대로 저장합니다(리사이즈
없음). `credit_name`/`license`/`source_name`/`source_url`은 전부 필수값으로, 이 중 하나라도 못 구한 후보는
provider 단계에서 이미 걸러져서 DB에 들어오지 않습니다 — `discover_city_images`의 해당 컬럼들이 027
마이그레이션에서부터 NOT NULL + 공백 금지로 막혀 있는 것과 같은 이유입니다.

모든 행은 `status='draft'`로 저장됩니다. 도시마다 대표 이미지 1개를 `published`로 바꾸는 건 `/admin`의
"도시 이미지" 탭에서 합니다.
