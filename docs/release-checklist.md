# 구글 플레이스토어 출시 체크리스트

> `docs/prd/PRD v5 — 앱스토어,플레이스토어`의 체크리스트를 2026-10-18 기준 실제 구현 상태로 갱신하고,
> "Claude Code가 할 수 있는 일"과 "사용자가 직접 해야 하는 일"을 나눈 문서. iOS는 범위 밖(Mac 필요,
> `docs/features/mobile-capacitor.md` 참고).

## 1. 법적 문서 (완료, 2026-10-18)

- [x] `triplog/js/legalPages.js`: 이용약관(v1.1)·개인정보처리방침(v1.2) — "초안/미구현" 문구 제거, 시행일
  (2026년 10월 18일)·개인정보 보호책임자 연락처(lorddark01@gmail.com) 반영, 처리위탁 목록에 Resend·
  AviationStack 추가. 상세: `docs/features/screen-legal.md`.
- [x] 새 화면 **AI 및 외부 서비스 이용 안내** (`#/ai-usage`, 설정 > 개인정보 및 약관 네 번째 항목) —
  Gemini/Maps/FCM/Web Push/Supabase/소셜로그인/카카오SDK/AviationStack/Resend/공공데이터 API/SheetJS/
  Pexels까지 사용 목적과 출처 URL을 정리.
- [x] `docs/data-safety.md`(Play Console Data Safety 설문 정리본)에 Resend 행 추가, "미구현" 각주 정리.
- [x] 네이티브 앱 표시 이름을 `TripLog` → `Routory`로 통일 (`mobile/capacitor.config.json`의 `appName`,
  `mobile/android/app/src/main/res/values/strings.xml`의 `app_name`/`title_activity_main`) — 홈 화면
  아이콘 아래 이름·플레이스토어 목록에 노출되는 이름이라 브랜드와 맞춰야 했음.

> **아직 사람 손이 필요한 것**: 이 문서들은 변호사 검토를 거치지 않은 초안이다 (파일 상단 경고 유지).
> 실제 공개 전 법률 전문가 검토를 권장한다.

## 2. 안드로이드 스튜디오 / 네이티브 빌드 작업

### Claude Code가 할 수 있는 것 (텍스트/설정 파일 편집)

- `mobile/android/app/build.gradle`의 `versionCode`/`versionName` 올리기 (제출할 때마다 필요)
- `AndroidManifest.xml`, `strings.xml`, `capacitor.config.json` 등 네이티브 설정 파일 수정
- `mobile/assets/`의 `logo.png`/`splash.png`를 사용자가 교체해 주면, 그에 맞춰
  `npx capacitor-assets generate` 실행 커맨드 안내 (실행 자체는 아래 "사용자" 항목)
- 빌드 에러 로그를 보고 원인 분석 및 코드/설정 수정 제안
- `supabase/CLAUDE.md`·`docs/features/mobile-capacitor.md` 등 관련 문서 갱신

### 사용자가 직접 해야 하는 것 (Android Studio GUI / 로컬 실행 필요)

- [ ] **릴리스 서명 키(keystore) 생성 및 백업** — Android Studio의 Build > Generate Signed Bundle/APK
  마법사 또는 `keytool`로 직접 생성. 비밀번호를 Claude에게 알려주거나 저장소에 커밋하지 말 것 — 분실 시
  이후 업데이트가 불가능하므로 안전한 곳(비밀번호 관리자 등)에 별도 백업.
  - Google Play App Signing(권장, 업로드 키와 배포 키를 분리) 사용 여부 결정
- [ ] `npx cap sync android` (`triplog/` 코드가 바뀔 때마다, CLAUDE.md에 "사용자가 직접 실행"으로 명시됨)
- [ ] Android Studio에서 `mobile/android` 열고 Gradle sync — SDK/빌드 도구 버전 불일치 등은 Studio GUI로만
  해결 가능
- [ ] **AAB(Android App Bundle) 생성** — Build > Generate Signed Bundle/APK → Android App Bundle (Play
  Console은 APK보다 AAB를 기본/권장으로 요구)
- [ ] **실기기/에뮬레이터 테스트** (이 환경엔 없음 — `docs/features/mobile-capacitor.md`에 "미검증"으로
  표시된 항목들):
  - 소셜 로그인 → `routory://auth-callback` 딥링크 복귀
  - 푸시 알림: 권한 요청 → FCM 토큰 등록 → 알림 수신 → 탭해서 해당 화면으로 이동 (cold start 포함)
  - 카메라/갤러리로 항공권 사진 업로드
  - 노치/상태바 등 safe-area 여백
  - 스플래시 화면 배경색/아이콘
- [ ] 앱 아이콘/적응형 아이콘(adaptive icon) 모양을 Android Studio의 Image Asset 미리보기로 직접 확인
  (원형/사각형 등 런처별로 다르게 잘릴 수 있음)
- [ ] iOS 플랫폼은 미착수 — Mac + Xcode 26+ 필요 (PRD v5 "오픈 이슈" 그대로 유지)

## 3. 전체 출시 준비 사항

### 완료됨

- [x] Android 네이티브 프로젝트(Capacitor) 구성, 딥링크, 안전영역, 앱 아이콘/스플래시 소스 이미지·생성
  결과물 (`mobile/assets/`, `mobile/android/.../res/mipmap-*`)
- [x] Firebase 설정(`google-services.json`), 푸시 알림 매니페스트 권한
- [x] 카카오/구글 콘솔에 안드로이드 플랫폼을 **별도 등록할 필요 없음**로 확인됨 — 소셜 로그인이 Supabase의
  `signInWithOAuth`(웹 리디렉션)를 쓰고 네이티브 SDK를 쓰지 않아서, 패키지명·키 해시를 등록할 대상 자체가
  없음 (`docs/features/mobile-capacitor.md`)
- [x] 계정 삭제: 앱 내(`#/account-delete`)·로그인 없는 웹페이지(`/account-deletion`) 둘 다 구현됨 — Play
  Console의 "로그인 없이 삭제 요청" URL 요건 충족
- [x] 이용약관/개인정보처리방침/AI·API 이용 안내 (위 1번)

### 사용자가 직접 해야 하는 것

- [ ] **Google Play Console 계정 가입** (최초 1회 $25)
- [ ] **릴리스 키스토어 생성·백업·AAB 빌드** (위 2번)
- [ ] **배포 도메인에 실제 배포** — `vercel`/`vercel --prod`를 `triplog/` 안에서 실행해, 약관/개인정보
  처리방침 URL(예: `https://<도메인>/#/privacy`)이 실제로 공개 접근 가능해야 Play Console의 "개인정보
  처리방침 URL" 항목에 넣을 수 있음
- [ ] **Data Safety 설문 작성** — `docs/data-safety.md`를 참고해 Play Console 화면에서 직접 입력(문서
  자체가 설문을 대신 제출해주지 않음, 화면 문항은 수시로 바뀔 수 있어 제출 시점에 대조 필요)
- [ ] **콘텐츠 등급(IARC) 설문, 대상 연령층, 데이터 삭제 URL, 개인정보처리방침 URL 등 스토어 등록정보 입력**
- [ ] **스토어 등록 정보**: 앱 이름(Routory)·짧은 설명·자세한 설명·스크린샷(휴대폰/태블릿)·피처 그래픽
  — 문구 초안은 Claude가 작성 가능, 스크린샷은 실제 로그인된 계정/실기기가 필요해 사용자가 직접 촬영
- [ ] **비공개 테스트(Closed Testing) 트랙 운영** — 2023년 이후 신규 개인 개발자 계정은 프로덕션 공개 전
  반드시 테스터 12명 이상으로 14일 이상 비공개 테스트를 거쳐야 함(Google 정책) — 테스터 모집·초대는
  사용자 몫
- [ ] **AdMob 연동 여부 결정** — PRD v5는 배너/전면 광고를 계획했지만 아직 구현되지 않음. 1차 출시에
  포함할지, 이후 업데이트로 미룰지 결정 필요 (포함 시 계정 가입·광고 단위 발급·ATT/UMP 동의 플로우까지
  추가 작업 필요)
- [ ] **스토어 제출** — 계정 소유자만 가능

### 열린 이슈 (결정 필요)

- AdMob 포함 여부 및 시점
- iOS 출시 여부 및 시점 (Mac 확보 필요)
- 법률 전문가 검토 일정 (약관/개인정보처리방침)
