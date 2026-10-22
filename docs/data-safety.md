# Google Play Data Safety 정리

> ⚠️ 법률 자문도, Google Play Console 공식 양식의 자동 작성도 아닙니다. `triplog/js/legalPages.js`의
> 개인정보처리방침 초안(섹션 1 "수집하는 개인정보 항목")을 Play Console의 "데이터 보안(Data safety)"
> 설문이 쓰는 표준 카테고리에 맞춰 사람이 옮겨 적기 쉽게 정리한 문서입니다. PRD v5(앱스토어/플레이스토어)
> 체크리스트의 "개인정보처리방침 작성(초안은 Claude가 작성 가능)"과 짝을 이룹니다 — 실제 제출 전에는
> Play Console에서 해당 시점의 실제 설문 문항·카테고리명을 직접 확인하고 채워 넣어야 합니다(Google이
> 이 카테고리 구성을 바꿀 수 있습니다).
>
> 개인정보처리방침 본문이 바뀌면 이 문서도 같이 업데이트하세요 — 항목이 서로 어긋나면 안 됩니다.

## 공통 질문

- **이 앱이 사용자 데이터를 수집/공유하나요?** 예 (아래 표 참고)
- **데이터가 전송 중 암호화되나요?** 예 — HTTPS(Supabase REST/Storage/Edge Functions)만 쓰고 평문 HTTP 경로가 없습니다.
- **사용자가 데이터 삭제를 요청할 방법이 있나요?** 예
  - 앱 안: 설정 > 계정 > 회원 탈퇴 (`#/account-delete`, 로그인 필요)
  - 앱 밖(로그인 없이): `/account-deletion`(`triplog/account-deletion.html`) — Play Console이 요구하는
    "로그인 없이도 삭제를 요청할 수 있는 URL" 항목에 이 주소를 넣으면 됩니다.
  - 실제 삭제 처리: Edge Function `delete-account`가 계정과 연결된 모든 데이터를 지웁니다(아래 표의
    "삭제 시점" 열 참고) — 범위는 `supabase/functions/delete-account/index.ts`/`supabase/CLAUDE.md` 참고.

## 데이터 유형별 표

Play Console의 표준 카테고리(Personal info / Financial info / Photos and videos / Files and docs /
App activity / Device or other IDs) 기준입니다. "선택 제공"은 "이 데이터를 안 줘도 핵심 기능 일부를
쓸 수 있는가"를 뜻합니다(Play Console이 묻는 "optional" 여부).

| Play 카테고리 | 세부 항목 | 수집 | 공유(제3자) | 선택 제공 | 목적 | 비고 |
|---|---|---|---|---|---|---|
| Personal info | 이름(닉네임) | 예 | 아니오 | 아니오(로그인 필수) | 계정 기능, 앱 기능 | 소셜 로그인 제공자(구글/카카오/네이버)에게서 받음 |
| Personal info | 이메일 주소 | 예 | 아니오 | 아니오(로그인 필수) | 계정 기능 | 로그인 식별용. 네이버는 합성 이메일(`naver_<id>@users.triplog.app`) 사용 — 실제 네이버 이메일은 메타데이터로만 보관, 로그인에 안 씀 |
| Photos and videos | 프로필 사진 | 예 | 아니오 | 예(제공자가 안 줄 수도 있음) | 계정 기능 | 소셜 로그인 제공자에게서 받은 URL만 저장(파일 자체를 복제하지 않음) |
| Photos and videos | 항공권/여행 문서 사진 | 예(일시적) | 예 — Google Gemini(AI 분석) | 예(사진 없이 수동 입력 가능) | 앱 기능(AI 자동 인식) | 분석 요청 시 Gemini API로만 전송, 서버에 저장하지 않고 분석 후 즉시 폐기 |
| Files and docs | 여행지갑 파일(여권·항공권·QR·바우처 이미지/PDF) | 예 | 아니오 | 예(여행지갑 기능 자체가 선택) | 앱 기능 | 비공개 Storage 버킷, 서명된 임시 URL로만 접근 |
| Financial info | 지출 금액·통화·결제수단·카테고리 | 예 | 아니오 | 예(가계부 기능 자체가 선택) | 앱 기능 | 같은 여행 동행자끼리만 공유, 제3자 전달 없음 |
| App activity | 여행/일정 데이터(제목, 목적지, 장소, 좌표, 메모, 시간) | 예 | 아니오 | 아니오(핵심 기능) | 앱 기능 | — |
| App activity | 초대/멤버십 정보 | 예 | 아니오 | 예(동행자 초대 안 하면 해당 없음) | 앱 기능 | — |
| **Device or other IDs** | **푸시 알림 토큰** | **예** | **예 — Firebase Cloud Messaging(Google), 안드로이드만** | **예(알림을 꺼도 다른 기능 이용 가능)** | **앱 기능(알림 발송)** | **아래 "푸시 알림 토큰" 절 참고** |
| Personal info | 이메일 주소·문의 내용 | 예(선택) | 예 — Resend(이메일 발송 대행) | 예(1:1 문의하기를 쓰지 않으면 해당 없음) | 고객 지원 | 설정 > 고객센터 > 1:1 문의하기(`contactForm.js` → Edge Function `send-contact-email`) — 문의 제목·내용과 답장받을 이메일 주소만 전달됨 |
| App info and performance | 접속 로그, 기기/브라우저 정보 | 예 | 아니오 | 아니오(일반적인 서버 접속 로그) | 분석, 보안 | Supabase 인프라 레벨의 일반적인 요청 로그 수준 |

## 푸시 알림 토큰 (신규)

- **무엇**: 기기·브라우저별로 발급되는 알림 식별 토큰. 안드로이드 앱은 Firebase Cloud Messaging(FCM)
  등록 토큰(`triplog/js/pushNotifications.js`), 웹은 브라우저 푸시 구독 정보(endpoint + 암호화 키,
  `triplog/js/webPush.js`) — 둘 다 `device_tokens` 테이블(`platform` 컬럼으로 구분)에 저장됩니다.
- **언제 수집하나**: 설정 > 알림에서 사용자가 직접 "알림 켜기"를 눌러 권한을 허용했을 때만. 기본값은
  수집 안 함(opt-in) — 권한을 묻기 전에 먼저 사전 안내 모달을 보여줍니다(`permission-prompts.md`).
- **목적**: 출발 임박, 다음 일정, 동행자 초대·공유, 공지사항 알림을 그 기기로 보내는 것 외의 용도로는
  쓰지 않습니다. 사용자 프로파일링·광고 타기팅에 쓰지 않습니다.
- **제3자 공유**: 안드로이드는 Google의 Firebase Cloud Messaging을 통해서만 실제 발송이 이루어지므로,
  그 전송 과정에서 토큰과 알림 제목·내용이 Google(FCM)에 전달됩니다 — Play Console의 "데이터 보안"
  설문에서 **Device or other IDs > 공유함 (Google 서비스 목적: 앱 기능)** 으로 표시해야 합니다. 웹은
  VAPID 기반 Web Push라 발송 주체가 각 브라우저사(Chrome/Edge는 Google, Firefox는 Mozilla 등)의 자체
  푸시 서비스이며, 이 앱이 FCM처럼 특정 제3자 SDK를 끼워 넣는 것은 아닙니다(표준 브라우저 API).
- **삭제 시점**: 알림을 끄거나, 로그아웃하거나, 회원 탈퇴할 때 **그 기기/브라우저의 토큰만** 즉시
  삭제됩니다(다른 기기의 토큰은 남습니다 — 기기별로 독립된 구독이라서). 회원 탈퇴 시에는 `delete-account`
  Edge Function이 명시적으로 `device_tokens`를 지우고(FK로도 `on delete cascade`가 걸려 있어 이중으로
  보장됩니다 — `031_push_notifications.sql`), 만료되거나 더 이상 유효하지 않은 토큰(앱 삭제, 알림 거부
  등으로 FCM/브라우저가 무효화한 것)은 `send-notification` Edge Function이 발송 실패 응답(FCM
  `UNREGISTERED`/`NOT_FOUND`, Web Push 404/410)을 받을 때마다 그 자리에서 정리합니다.
- **관련 테이블**: `device_tokens`, `notification_settings`(알림 종류별 on/off), `notifications`(인앱
  발송 기록, 아직 읽음 처리 UI는 없음), `notification_log`(중복 발송 방지용, 사용자에게 노출되지 않음) —
  전부 `031_push_notifications.sql`.

## 2026-10-18 Google Play 등록 준비 패스

- `legalPages.js`의 개인정보처리방침이 `"초안이며 아직 시행되지 않았습니다"` placeholder에서 실제
  시행일(2026년 10월 18일)·실제 보호책임자 연락처(lorddark01@gmail.com)로 바뀌었고, 섹션 6(처리위탁)에
  Resend(1:1 문의 메일 발송)와 AviationStack(회원 개인 키로 직접 조회)이 추가됐습니다 — 위 표의 Resend
  행과 "AviationStack" 언급은 그 변경을 반영한 것입니다.
- 설정 > 개인정보 및 약관에 새 화면 **AI 및 외부 서비스 이용 안내**(`#/ai-usage`)가 생겼습니다 — 이
  문서가 "Play Console 설문에 뭐라고 답할지" 정리본이라면, 그 화면은 "앱 안에서 사용자가 직접 읽는"
  용도로 같은 목록(Gemini/Maps/FCM/AviationStack/Resend/Pexels 등, 출처 URL 포함)을 더 풀어서 보여줍니다
  — 둘 중 하나가 바뀌면 다른 쪽도 같이 확인하세요.

## 아직 반영 안 된 것 / 확인 필요

- iOS는 이 앱에 아직 없어서(`docs/features/mobile-capacitor.md`) APNs 관련 행은 비워 뒀습니다 — iOS를
  추가하면 이 표와 개인정보처리방침 모두 다시 손봐야 합니다.
- AdMob(PRD v5의 광고 계획)은 아직 구현되지 않았습니다 — 실제로 붙이면 광고 ID·기기 식별자 관련 행을
  이 표에 추가해야 합니다.
- 이 문서의 표는 Play Console 설문의 실제 문항 순서/세부 체크박스를 그대로 복제한 것이 아니라 "무엇을
  답해야 하는지"를 사람이 보기 좋게 정리한 것입니다 — 제출 시점에 Play Console 화면을 보면서 다시
  한 번 대조하세요.
