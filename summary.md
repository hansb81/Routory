# 프로젝트 최적화 요약 (2026-09-26)

triplog(Routory) 코드베이스에 대해 코드 점검/정리, 성능 최적화, 문서/구조 정리, 전체 코드 리뷰를 진행했습니다.
번들러·린터·테스트가 없는 프로젝트 특성상 `node --check` 정적 검사와 수동/에이전트 코드 리뷰로 진행했으며,
git 저장소가 아니라서 별도 커밋은 없습니다.

## 점검 방법

- `triplog/js/*.js` 37개 파일 전체 `node --check` 문법 검사 → 전부 통과
- `console.log`/`TODO`/`FIXME` 잔재 검색 → 없음
- `triplog/img/*` 이미지 용량 확인 → 이미 작아서 추가 최적화 불필요 (invite-share.png 12K)
- `index.html`의 실제 `<script>` 로드 순서를 CLAUDE.md 문서와 전체 대조
- `innerHTML`에 들어가는 사용자 데이터의 `escapeHtml` 적용 여부 샘플링 점검
- 백그라운드 리뷰 에이전트로 37개 JS 파일 전체를 다시 정독하며 버그/성능/데드코드/문서 불일치를 별도로 재검증

## 고친 것

1. **CLAUDE.md 문서-코드 불일치 수정**: 문서에 적힌 스크립트 로드 순서가 실제 `index.html`과 달랐습니다
   (`walletCategoryData`의 위치가 `expenseForm`/`budgetPage` 뒤로 잘못 기재됨). 실제 로드 순서에 맞게
   문서를 수정했습니다. 이 외 다른 로드 순서 불일치는 없음을 재확인했습니다.

2. **여행 삭제/나가기 시 지출(expense) 캐시 누락 수정** (`triplog/js/storage.js`): `deleteTrip`/`leaveTrip`이
   일정(`itemsCache`)은 정리하면서 지출 캐시(`expensesCache`/`expensesLoadedTrips`/`expensesRequestIds`)는
   정리하지 않아, 삭제/탈퇴한 여행의 지출 데이터가 메모리에 계속 남아있던 버그를 수정했습니다.

3. **D-day 추적 메모리 누수 완화** (`triplog/js/dday.js`): `dday.track()`으로 등록된 DOM 요소는
   자정(또는 일정 페이지 진입) 전까지 정리되지 않아, 자정 없이 `#/main` ↔ `#/my-trip/:id`만 오가면
   화면에서 사라진 요소 참조가 계속 쌓이는 문제가 있었습니다. `track()` 호출 시마다 연결이 끊긴 요소를
   먼저 정리하도록 수정해 방문할 때마다 누수가 정리되게 했습니다.

4. **오래된 주석 정리** (`triplog/js/walletPage.js`, `triplog/js/tripImport.js`): "더미 데이터 2개로
   시작한다", "미리보기 화면이 아직 없다" 등 이미 사실과 달라진(더미 데이터 제거됨, `tripImportPreview.js`가
   실제로 구현됨) 주석을 현재 코드에 맞게 갱신했습니다. 동작 변경은 없습니다.

5. **쓰이지 않는 공개 API 정리**: `currencyData.getRateToKrw`와 `router.match`가 모듈 밖 어디서도
   호출되지 않는 것을 전체 검색으로 확인 후 공개 인터페이스에서 제거했습니다(내부 함수 자체는 그대로 유지 —
   각각 `toKrw`, `router.js` 내부 네비게이션 로직이 계속 사용).

## 점검했지만 문제 없었던 것

- 모든 "stale response" 카운터 패턴(`hydrateId`, `runId`, `renderId`, `lookupId`, `membersRequestId` 등,
  flight/mapPicker/dayMap/expenseForm/tripMembers/storage 전반)이 올바르게 증가·검증되어 경쟁 상태(race
  condition) 없음
- 모달 재오픈 시 `document` 클릭 리스너 중복 등록 없음 (모두 1회만 등록되는 `ensureModal()` 패턴 준수)
- 사용자/서버 데이터가 `innerHTML`에 들어가는 곳은 전부 `escapeHtml`을 거침. 이스케이프 없이 보간되는
  곳(`tripSetup.js`의 `city.name`/`city.country`)은 `destinations.js`의 정적 하드코딩 데이터라 실제 위험 없음
- 이미지 용량, Vercel 캐시 헤더(`vercel.json`), `serve.py`, 루트/`mobile/` `package.json` 등은 CLAUDE.md
  설명과 정확히 일치

## 건드리지 않은 것 (의도적)

- **`comments.html`**: 사용자 요청 시에만 갱신하는 규칙이라 이번엔 수정하지 않음
- **TripLog/Routory 이름 불일치**: CLAUDE.md에 의도적이라고 명시되어 있어 그대로 둠
- **번들러/린터 도입 등 구조적 리팩터링**: 요청 범위를 벗어나는 큰 변경이라 하지 않음
- **css/style.css**: 시간 예산상 JS 위주로 검토했고, 표면적인 문제는 발견되지 않음

## 검증

- 수정된 6개 파일(`storage.js`, `dday.js`, `walletPage.js`, `tripImport.js`, `currencyData.js`, `router.js`)
  모두 `node --check` 재통과
- 로컬 서버(`python serve.py 8099 --local`)로 모든 수정 파일이 정상 서빙되는 것 확인
- 브라우저 확장 미연결로 실제 UI 콘솔 에러 확인은 생략함 (변경 내용이 캐시 정리/주석/미사용 export 제거
  수준이라 위험도는 낮음)
