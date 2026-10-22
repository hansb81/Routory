# collect-city-content (로컬 스크립트)

'어디로 떠나볼까요' 도시의 **월별 추천 이유**(`027_discover_cities.sql#discover_city_months`)와 **대표
관광지**(`city_highlights`) 초안을 모아 주는 두 스크립트입니다. `scripts/collect-city-images`(대표 이미지
수집)와 한 쌍을 이룹니다.

## DB에 쓰는 경우 / 안 쓰는 경우 (도시 상태에 따라 다름)

`discover_city_months`/`city_highlights`는 `discover_city_images`처럼 자체 draft/published 컬럼이
없습니다. 하지만 `get_discover_cities`/`get_city_detail` RPC와 두 테이블의 RLS(`041_discover_detail_
policy_fix.sql`)가 전부 **`discover_cities.is_active = true`일 때만** 결과를 내보내도록 걸려 있습니다 —
즉 도시 자체의 승인 대기/게시 중 상태가 이 두 테이블에도 그대로 게이트 역할을 합니다.

- **승인 대기 도시(`is_active=false`)**: 바로 `insert`/`upsert`합니다. 그 도시가 실제로 "게시"되기
  전까지는 어차피 아무에게도 안 보이므로, `discover_city_images`의 draft 이미지와 같은 효과를
  `discover_cities.is_active` 하나로 얻습니다.
- **게시 중인 도시(`is_active=true`)**: **절대 쓰지 않습니다.** 이 경우는 게이트가 이미 열려 있어서
  직접 insert하면 그 순간 바로 사용자에게 노출됩니다 — 리포트 파일에만 제안을 남기고, 관리자가 `/admin`
  에서 직접 입력해야 합니다.

두 스크립트 모두 이 두 경로를 한 번의 실행에서 같이 처리하고, 결과 JSON에 도시별로 `autoSaved`(실제로
저장한 것)와 `needsManualReview`(저장하지 않고 리포트에만 남긴 것)를 구분해서 적습니다.

**자동 저장도 "확정"은 아닙니다.** 승인 대기 도시에 바로 쓰긴 하지만, 그 콘텐츠 자체가 완벽하다는 뜻은
아닙니다 — 아래 각 스크립트 설명의 한계를 꼭 읽고, **그 도시를 "게시"로 전환하기 전에** `/admin`에서 한
번 더 확인하세요.

## 두 스크립트

### `collect-months.mjs` — 월별 추천 이유 초안

- 데이터 소스: **Open-Meteo Historical Weather API**(`archive-api.open-meteo.com`) — API 키 불필요, ERA5
  재분석 기반 실측 기온/강수량(예보 아님). 도시당 호출 1회로 지난 1년치 일별 데이터를 받아 월별로
  집계합니다.
- **문화·계절 행사(벚꽃/단풍/축제 등)는 전혀 추정하지 않습니다.** 그런 정보는 도시마다 고유하고 해마다
  날짜가 바뀌어서, 범용 공개 API만으로 자동 추정하면 틀릴 위험이 큽니다. 제안하는 건
  `027_discover_cities.sql`의 `discover_weather_bonus()`가 이미 쓰는 "쾌적 기온 15~28도" 기준을 그대로
  재사용한 **"선선한 날씨"/"따뜻한 날씨"처럼 일반적인 이유뿐**입니다. 강수량이 많은 달(우기)은 기온이
  맞아도 제안하지 않습니다.
- **점수(1~5)는 `discover_city_months.score`가 `NOT NULL`이라 승인 대기 도시엔 임시로 `DEFAULT_SCORE`
  (현재 3점)를 넣습니다** — 기온만으로 정확한 점수를 매길 근거가 없는 자리채움 값입니다. 도시를 게시하기
  전에 "월별 점수" 섹션에서 숫자를 보고 조정하세요.
- 이미 `discover_city_months`에 행이 있는 (도시, 월) 조합은 건드리지 않습니다(이전 실행의 자동 저장이든
  관리자가 입력한 것이든) — 비어 있는 달만 제안/저장합니다.

### `collect-highlights.mjs` — 대표 관광지 후보

- 데이터 소스: **위키백과 Geosearch API** — API 키 불필요. 도시 좌표 8km 반경 안의 문서를 거리순으로
  찾고, 같은 요청에서 한 줄 요약(`extracts`)도 같이 받습니다. 한국어판을 먼저 찾고 결과가 `--max`
  개수보다 적으면 영어판으로 보충합니다.
- **승인 대기 도시에 자동 저장되는 것도 "검증된 명소"가 아니라 후보일 뿐입니다.** Geosearch는 거리만
  보고 문서를 찾기 때문에, 실제로 돌려 보면 관광 명소가 아닌 지하철역·행정구역·동네·회사 등이 자주 섞여
  나옵니다(직접 확인함 — 도쿄로 테스트하면 상위 결과가 전부 역/동네였습니다). 이 스크립트가 거르는 건
  "도시 이름 자체인 문서"와 "요약이 없는 문서", "이미 등록된 이름과 같은 문서"뿐이라, **관리자가 도시를
  게시하기 전에 "대표 관광지" 섹션에서 명소가 아닌 항목을 반드시 지워야 합니다.**
- `city_highlights`가 이미 3개 이상 있는 도시는 건너뜁니다(스키마 주석의 "도시당 3~6개 권장" 기준).

## 준비

```bash
cd scripts/collect-city-content
npm install
```

| 변수 | 필수 | 설명 |
|---|---|---|
| `SUPABASE_URL` | O | `https://ffzjgiknrrgwvgobybdq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | O | **승인 대기 도시엔 실제로 insert/upsert합니다.** anon 키로는 "승인 대기"(`is_active=false`) 도시 자체가 RLS에 가려 안 보이고, `discover_city_months`/`city_highlights` 쓰기도 관리자만 가능해서(027/041) 서비스 키가 필요합니다. 절대 커밋/공유하지 않을 것. |
| `WIKIMEDIA_CONTACT` | 선택(강력 권장, `collect-highlights.mjs`만) | 이메일 또는 URL. 위키백과도 Commons와 같은 Wikimedia User-Agent 정책을 쓰므로, `collect-city-images/README.md`의 설명과 같은 이유로 권장합니다. |

## 실행

```bash
# 월별 추천 이유 (discover_cities 전체 대상, 작년 1년치 기후 기준)
node collect-months.mjs

# 도시 하나만, 특정 연도로
node collect-months.mjs --city=Tokyo --year=2024

# 대표 관광지 후보 (하이라이트 3개 미만인 도시만 대상, 도시당 최대 6개)
node collect-highlights.mjs

node collect-highlights.mjs --city=Tokyo --max=4
```

둘 다 결과를 `output/months-<시각>.json` / `output/highlights-<시각>.json`에 저장하고, 콘솔에도 도시별로
"자동 저장"/"리포트만"을 구분해 출력합니다. `--out=<경로>`로 저장 위치를 직접 지정할 수도 있습니다.
재실행해도 안전합니다 — 이미 있는 (도시,월)/이미 있는 이름은 건너뜁니다.

## 게시 전 체크리스트

승인 대기 도시를 "게시"로 전환하기 전에 `/admin` → "추천 도시" → 해당 도시 "열기"에서:

1. **월별 점수**: 자동 저장된 달의 점수가 임시값(기본 3점)인지 확인하고, 적절히 조정합니다.
2. **대표 관광지**: 자동 저장된 후보 중 명소가 아닌 것(역/행정구역/회사 등)을 지웁니다.
3. **이미지**: `discover_city_images`는 여전히 draft 상태라 `/admin`에서 직접 "게시" 승인이 필요합니다
   (이 두 스크립트와 무관하게 `scripts/collect-city-images`가 담당).

이미 **게시 중**인 도시에 대한 제안은 리포트 JSON의 `needsManualReview`에만 남습니다 — 그대로 보고 필요한
내용만 골라 직접 입력하세요.
