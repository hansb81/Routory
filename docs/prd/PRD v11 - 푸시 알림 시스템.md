# PRD v11 — 푸시 알림 시스템

## 1. 개요

일정/D-day 임박, 초대/공유, 공지사항 3가지 상황에 대해 푸시 알림을 보낸다. 모바일(Capacitor 앱)과 웹 두 트랙을 모두 지원하는 것이 목표이나, 구현 방식과 제약사항이 둘이 다르다.

| 트랙 | 방식 | 제약 |
| --- | --- | --- |
| 모바일(Android, 후순위 iOS) | `@capacitor/push-notifications` + Firebase Cloud Messaging(FCM) | 없음. 표준 방식 |
| 웹(PC/안드로이드 크롬/엣지) | Service Worker + Web Push(VAPID) | 정상 동작 |
| 웹(iOS Safari) | 동일한 Web Push | **iOS 16.4+에서 '홈화면에 추가'한 PWA 상태일 때만 동작. 일반 사파리 탭으로는 사실상 불가능** |

## 2. 알림 종류

| 종류 | 트리거 | 수신 대상 | 비고 |
| --- | --- | --- | --- |
| 출발 임박 | 여행 출발 D-1일 지정 시각(예: 전날 오후 6시) | 해당 여행 멤버 전원 |  |
| 다음 일정 임박 | 시간 등록된 일정 1\~2시간 전 | 해당 여행 멤버 전원 | PRD v9의 '다음 일정 판별' 로직과 개념은 같으나, 압은 앱이 꺼져있어도 가야 하니 서버측 판별이 필요함 |
| 새 멤버 가입 | 누군가 초대 링크로 여행에 참여 | 기존 여행 멤버(신규 참여자 본인 제외) |  |
| 초대 수락 | 누군가 내 초대를 수락함 | 초대를 보낸 사람 | 거절은 알림 X (거부감 방지) |
| 공지사항 | 운영자가 수동 발송 (업데이트, 점검 안내 등) | 전체 또는 일부 사용자 | MVP에서는 관리자 UI 없이 DB 직접 insert로 충분 |

## 3. 데이터 모델

```
device_tokens
- id
- user_id (auth.users 참조)
- platform ('android' | 'web')
- token (FCM 토큰 또는 Web Push subscription JSON)
- created_at / updated_at

notifications (인앱 알림센터용, 선택)
- id
- user_id
- type ('departure' | 'schedule' | 'invite' | 'announcement')
- title / body
- related_trip_id (nullable)
- sent_at / read_at
```

## 4. 발송 아키텍처

- **즉시성 이벤트**(멤버 가입, 초대 수락): 해당 액션이 일어날 때 Edge Function 'send-notification'을 직접 호출해서 발송
- **시간 기반 이벤트**(출발 임박, 일정 임박): 앱이 꺼져있어도 가야 하므로, PRD v9처럼 클라이언트에서 판별하면 안 됨. **Supabase Cron(pg\_cron) + Edge Function을 주기적(예: 5\~10분마다)으로 돌려서** 조건에 맞는 사용자를 찾아 발송해야 함 (중복 발송 방지용 플래그/로그 필요)
- **수동 이벤트**(공지사항): notifications 테이블에 row를 넣으면 트리거되도록 (DB 인서트 훅 또는 수동 호출)

## 5. 설정 화면

- 설정 > 알림에 종류별 on/off 토글 (일정 알림 / 초대·공유 알림) — 공지사항은 끄기 없이 항상 수신하는 것을 기본으로 검토
- 최초 알림 권한 요청 전, 기존 카메라/위치와 같은 패턴의 사전 안내 화면 필요

## 6. 미해결 이슈

- iOS Safari 비-PWA 사용자에게는 알림 불가 — 설정 화면에 안내 문구를 넣을지, 앱 설치를 유도할지 결정 필요
- 발송 실패/만료된 토큰 정리 정책 (FCM이 만료 토큰 응답 줄 때 device\_tokens에서 제거)
- 공지사항 발송용 관리자 UI를 언제 만들지 (지금은 Supabase Studio에서 직접 입력으로 충분)
- 인앱 알림센터(읽음 처리 UI) 필요 여부 — 푸시만으로 충분한지, 앱 내에도 알림 목록이 필요한지
