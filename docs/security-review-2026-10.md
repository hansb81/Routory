# Routory 보안 점검 보고서 (2026-10-19)

> 읽기 전용 점검. 코드/설정/DB를 수정하지 않았습니다. 비밀키·토큰 값은 이 문서에 쓰지 않았고, 앞 4자리·뒤 2자리만 마스킹해 표기했습니다(예: `AIza...Om`). 점검 범위: 저장소 전체(코드·마이그레이션·Edge Function·프런트엔드·배포 설정), git 로컬 히스토리. 운영 환경에 요청을 보내거나 데이터를 바꾸는 테스트는 하지 않았습니다.

---

## 1. 요약

| 심각도 | 건수 |
|---|---|
| 🔴 높음 | 2(전부 코드 수정 완료, 배포 대기) |
| 🟠 중간 | 6(전부 코드 수정 완료, 아래 "사용자 작업" 대기) |
| 🟡 낮음 | 18(이 중 6건 코드 수정 완료 — SEC-03, RLS-01, RLS-03, EDGE-05, EDGE-06, EDGE-07) |
| **열린 발견 사항 합계** | **26** |
| ✅ 점검 중 해소/확인된 항목(아래 3번 참고) | 3 |

### 2026-10-19 진행 상황 — 높음 2건 + 중간 6건 + 낮음 6건, 코드 수정 완료

**🔴 높음(배포만 하면 끝)**
1. ~~**[EDGE-01] `send-notification` SSRF**~~ — 코드 완료, 배포 필요.
2. ~~**[EDGE-02] Gemini 함수 3개 사용자당 호출 제한**~~ — 코드 완료, 배포 필요.

**🟠 중간**
3. ~~**[FE-01/FE-02] 이미지 출처 URL 스킴 검증 + rel 통일**~~ — 코드 완료, `039_image_url_https_check.sql` 실행 필요.
4. ~~**[FE-03] supabase-js SRI**~~ — 코드 완료, 배포만 하면 끝.
5. ~~**[DEP-01] Vercel 보안 헤더(CSP 등)**~~ — 코드 완료, 배포 + 배포 후 브라우저 확인 필요.
6. ~~**[DEP-02] Android R8/ProGuard**~~ — 코드 완료, 실제 빌드·설치 테스트 필요(이 환경엔 Android 툴체인 없음).
7. ~~**[DEP-03] `allowBackup`**~~ — 코드 완료, 다음 빌드부터 자동 적용.
8. ~~**[RLS-06] 동의 확인 fail-open**~~ — 코드 완료, 배포만 하면 끝.

**🟡 낮음(사용자 요청으로 "거의 공짜인 것" 6개 추가 진행)**
9. ~~**[SEC-03] 키스토어 `.gitignore`**~~ — 코드 완료, 배포 불필요.
10. ~~**[RLS-01] `is_admin(uid)` 정보 노출**~~ — 코드 완료, `040_is_admin_self_only.sql` 실행 필요.
11. ~~**[RLS-03] `discover_city_months`/`city_highlights` 정책**~~ — 코드 완료, `041_discover_detail_policy_fix.sql` 실행 필요.
12. ~~**[EDGE-05] 상수 시간 비교**~~ — 코드 완료, 배포 필요.
13. ~~**[EDGE-06] `delete-account` 에러 메시지**~~ — 코드 완료, 배포 필요.
14. ~~**[EDGE-07] CORS 출처 제한(10개 함수)**~~ — 코드 완료, 배포 필요.

> `EDGE-03`(verify_jwt 설정)은 Supabase CLI로 실제 배포 상태를 직접 조회해 **해소 확인**했습니다(코드 수정 자체가 필요 없었음) — 아래 3번 참고.
>
> **남은 사용자 작업 요약**:
> 1. 마이그레이션을 SQL Editor에서 순서대로 실행: `039_image_url_https_check.sql` → `040_is_admin_self_only.sql` → `041_discover_detail_policy_fix.sql` → `042_admin_rls_is_admin_self_fix.sql`(2026-10-20 추가 — `040`이 깨뜨린 관리 페이지 RLS를 복구하는 후속 수정, RLS-01 항목 참고. **이미 `040`을 실행해서 관리 페이지 목록이 안 보인다면 이것부터 먼저 실행**)
> 2. **이번에 코드를 수정한 Edge Function은 결과적으로 14개 전부**입니다(EDGE-01/02/05/06/07이 이것저것 겹쳐서 손대지 않은 함수가 없음) — 전부 재배포:
>    `supabase functions deploy analyze-ticket analyze-trip-import naver-login travel-briefing search-destination search-unsplash delete-account send-contact-email send-notification collect-travel-feed refresh-city-weather notify-scheduler`
>    (`airport-congestion`/`search-pexels`은 코드는 고쳤지만 EDGE-09에 따라 애초에 배포돼 있지 않음 — 그 두 기능을 쓸지 먼저 정한 뒤 배포 여부 결정)
> 3. Vercel 배포(`vercel --prod`, DEP-01/FE-03 반영) 후 핵심 화면(로그인·지도·카카오공유·관리자 이미지검색·항공권 인식) 콘솔에서 CSP/CORS 위반이 없는지 확인
> 4. Android 릴리스 빌드 1회 + 기기 테스트(DEP-02)

---

## 2. 발견 사항 목록

범례: **심각도** 🔴높음 🟠중간 🟡낮음 · **확인 수준** `확인함`(코드로 직접 확인) / `추정`(코드 정황상 추정, 콘솔·운영환경 확인 필요)

### 비밀키·민감 파일 (SEC)

#### SEC-01 — `google-services.json`의 FCM API 키 제한 여부 미확인
- **심각도**: 🟡 낮음 · **확인 수준**: 추정
- **위치**: `mobile/android/app/google-services.json`(`api_key[0].current_key`, 마스킹: `AIza...Dk`)
- **악용 시나리오**: Firebase/Google Cloud 콘솔에서 이 키에 앱 패키지명·SHA-1 제한이 안 걸려 있으면, 키를 추출한 제3자가 이 프로젝트의 FCM 할당량을 다른 용도로 소모할 수 있음.
- **수정 방안**: Firebase 콘솔에서 Android 앱 제한(패키지명+SHA-1) 적용 확인. **작업량: 작음(콘솔 설정만)**.
- **내가 직접 해야 하는 일**: Firebase/Google Cloud 콘솔 확인 — 코드로는 불가.

#### SEC-02 — Google Maps 브라우저 키의 콘솔 제한 실제 적용 여부 미확인
- **심각도**: 🟡 낮음 · **확인 수준**: 추정
- **위치**: `triplog/js/config.js`(`googleMapsApiKey`, 마스킹: `AIza...Om`)
- **악용 시나리오**: 리퍼러 제한이 안 걸려 있으면, 페이지 소스에서 키를 복사해 다른 사이트에서 같은 키로 Maps/Places/Distance Matrix 호출을 무단 사용해 비용을 발생시킬 수 있음.
- **수정 방안**: Google Cloud 콘솔에서 HTTP 리퍼러 제한 + API 제한(Maps JS/Geocoding/Places(New)/Distance Matrix) 적용 확인. 코드 주석에도 이미 이렇게 하라고 적혀 있음. **작업량: 작음**.
- **내가 직접 해야 하는 일**: Google Cloud 콘솔 확인.

#### SEC-03 — Android `.gitignore`의 키스토어 제외 줄이 주석 처리됨 — ✅ **수정 완료(2026-10-19)**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `mobile/android/.gitignore`(`#*.jks`, `#*.keystore` 줄)
- **적용한 수정**: 두 줄의 주석(`#`)을 제거해 실제로 제외되도록 변경. `google-services.json` 줄은 이미 추적 중인 파일이라(의도적으로 공개 설계값) 그대로 둠.
- **작업량**: 작음(완료). 별도 배포 불필요.

#### SEC-04 — `config.js`의 과거 git 커밋이 원격 저장소에도 노출된 적 있는지 불명
- **심각도**: 🟡 낮음 · **확인 수준**: 추정(로컬 히스토리만 확인 가능, 원격은 점검 범위 밖)
- **위치**: 로컬 git 커밋 `6094b0d`(초기 커밋, 이후 `904eefd`에서 삭제)
- **악용 시나리오**: 해당 커밋에 있던 값(Google Maps 키/카카오 JS 키/네이버 Client ID)은 전부 "공개돼도 되는 값"으로 설계된 키라 유출 자체의 실익은 낮지만, 원격에 올라간 적이 있다면 이력 추적 차원에서 인지해 둘 필요가 있음.
- **수정 방안**: 해당 없음(이미 공개 설계값). 원격 공개 여부만 확인.
- **내가 직접 해야 하는 일**: GitHub 등 원격 저장소의 공개/비공개 여부, 과거 push 이력 직접 확인.

---

### RLS / Storage (RLS)

#### RLS-01 — `is_admin(uid)`가 임의 사용자의 관리자 여부를 조회 가능 — ✅ **수정 완료(2026-10-19), 마이그레이션 실행 필요**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `supabase/migrations/020_admins.sql`(`is_admin(uid uuid default auth.uid())`)
- **악용 시나리오**: 로그인한 사용자가 다른 사용자의 `user_id`(같은 여행 멤버 목록 등에서 알 수 있음)를 안다면 `rpc('is_admin', {uid: 그값})`으로 그 사람이 관리자인지 확인할 수 있음.
- **적용한 수정**: `supabase/migrations/040_is_admin_self_only.sql`(신규) — `is_admin(uuid)`의 `authenticated`/`anon` 실행 권한을 거둬 `service_role` 전용(`search-pexels`/`search-unsplash`가 쓰는 경로, 영향 없음)으로 좁히고, 매개변수 없이 호출자 본인만 확인하는 `is_admin_self()`를 신설. `adminPage.js`는 `rpc('is_admin')` → `rpc('is_admin_self')`로 변경(문법 확인 완료).
- **작업량**: 작음(완료).
- **내가 직접 해야 하는 일**: `supabase/migrations/040_is_admin_self_only.sql`을 SQL Editor에서 실행.
- **🔴 회귀 발견·수정(2026-10-20)**: `040`을 실제로 실행한 뒤 "관리 페이지에 올렸던 목록이 다 사라졌다"는 사용자 리포트로 발견 — `040`이 `is_admin(uuid)`의 `authenticated` 실행 권한을 완전히 거뒀는데, `021`/`022`/`027`/`030`/`041`이 `travel_feed_items`/`popular_destinations`/`discover_cities`/`discover_city_months`/`discover_city_images`/`city_highlights`/`storage.objects`(discover-images 버킷)에 걸어둔 "관리자만 조회/작성/수정/삭제" RLS 정책 전부가 인자 없이 `public.is_admin()`을 직접 호출하고 있었다(`adminPage.js`의 게이트만 `is_admin_self()`로 옮겨졌을 뿐, 테이블 RLS 쪽은 전혀 안 고쳤다). RLS의 USING/WITH CHECK 절은 "쿼리를 실행하는 역할"(PostgREST의 `authenticated`)의 권한으로 평가되므로, `is_admin(uuid)`가 SECURITY DEFINER라도 호출 자체를 할 권리가 없어지면 정책 평가가 `permission denied for function is_admin`으로 즉시 실패한다 — 그 결과 관리자가 글을 올리거나 승인 대기/보관 탭을 열거나 추천 도시를 관리하는 모든 동작이 깨졌다. **PGlite로 이 깨짐 자체를 재현**(020/014/021/022/027/030의 실제 마이그레이션 파일을 그대로 적용한 뒤 `040`을 적용하면 관리자 계정의 `select`/`insert`가 바로 `permission denied for function is_admin`으로 실패)하고, 아래 수정으로 복구되는 것도 같은 방식으로 확인했다. **적용한 수정**: `supabase/migrations/042_admin_rls_is_admin_self_fix.sql`(신규) — 위 정책들은 애초에 호출자 본인의 관리자 여부만 물었을 뿐(의미상 이미 `is_admin_self()`와 동일) — `ALTER POLICY`로 USING/WITH CHECK 절만 `public.is_admin_self()` 호출로 바꿔서 040의 보안 효과(임의 uid 조회 차단)는 그대로 유지하면서 관리 기능을 복구했다. `get_admin_labels()`(022) 안의 `public.is_admin()` 호출은 SECURITY DEFINER 함수 본문 안이라(함수 소유자=슈퍼유저 기준으로 권한 체크) 영향이 없어 그대로 뒀다 — 이것도 PGlite로 확인.
- **내가 직접 해야 하는 일(추가)**: `040`을 이미 실행했다면 **지금 당장** `supabase/migrations/042_admin_rls_is_admin_self_fix.sql`을 SQL Editor에서 실행해야 관리 페이지가 복구된다. 아직 `040`을 실행하지 않았다면 `039`→`040`→`041`→`042` 순서로 실행.

#### RLS-02 — `discover-images` 공개 버킷의 미게시(draft) 이미지가 직접 URL로 열람 가능
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `supabase/migrations/030_discover_images_storage_admin_policy.sql`(public 버킷 특성상 RLS 무관)
- **악용 시나리오**: 관리자가 아직 공개하지 않은 추천 도시 이미지의 정확한 파일 경로를 추측/확인하면, `/admin`에 들어가지 않고도 그 이미지를 미리 열람 가능.
- **수정 방안**: 당장은 저위험(민감 개인정보 아님). 근본 해결은 private 버킷+서명 URL 방식으로 전환. **작업량: 중간**(기존 공개 URL 참조 코드 변경 필요).

#### RLS-03 — `discover_city_months`/`city_highlights`의 SELECT 정책이 상태 필터 없음 — ✅ **수정 완료(2026-10-19), 마이그레이션 실행 필요**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `supabase/migrations/027_discover_cities.sql`(두 테이블의 `"로그인한 사용자 조회"` 정책, `using(true)`)
- **악용 시나리오**: 비활성(`is_active=false`) 도시의 `city_id`를 알면 REST API로 직접 조회해 미공개 추천 문구/하이라이트를 먼저 볼 수 있음.
- **적용한 수정**: `supabase/migrations/041_discover_detail_policy_fix.sql`(신규) — 두 테이블의 정책을 "그 city_id가 `discover_cities`에서 `is_active=true`인 경우만"으로 좁히고, `discover_cities`/`discover_city_images`와 같은 패턴으로 "관리자는 전체 조회" 정책을 추가해 관리 화면은 그대로 동작하게 함.
- **작업량**: 작음(완료).
- **내가 직접 해야 하는 일**: `supabase/migrations/041_discover_detail_policy_fix.sql`을 SQL Editor에서 실행.

#### RLS-04 — `wallet` 버킷 파일 크기·형식 제한이 Supabase 대시보드 설정에만 의존
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함(SQL/트리거 레벨 강제가 없다는 사실), 실제 대시보드 설정은 추정
- **위치**: `supabase/migrations/006_wallet.sql`(버킷 생성 안내 주석, SQL로 강제 불가)
- **악용 시나리오**: 대시보드 설정이 풀리거나 바뀌면 10MB/이미지·PDF 제한 없이 업로드될 수 있음.
- **수정 방안**: 대시보드 설정 재확인 + (선택) 업로드 전 클라이언트 검증을 서버 쪽에서도 한 번 더(예: Storage 트리거)확인하는 방법 검토. **작업량: 중간**.
- **내가 직접 해야 하는 일**: Supabase Storage 대시보드에서 `wallet` 버킷의 File size limit/Allowed MIME types 실제 설정 확인.

#### RLS-05 — `accept_trip_invite`에 호출 빈도 제한이 없음
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `supabase/migrations/001_invite_feature.sql`(`accept_trip_invite`)
- **악용 시나리오**: 로그인한 계정이 초대코드(32자리, 약 122비트 무작위)를 무차별 대입 시도 — 엔트로피상 실질적 성공 가능성은 매우 낮지만, DB/함수 레벨에 호출 제한 자체는 없음.
- **수정 방안**: 꼭 필요하진 않음(엔트로피로 충분히 완화됨). 방어 심층화를 원하면 `notification_log`류의 시도-횟수 테이블 추가. **작업량: 중간**.

#### RLS-06(데이터 보호) — `user_consents` 동의 확인이 서버 요청 실패 시 "막지 않음"으로 동작 — ✅ **수정 완료(2026-10-19)**
- **심각도**: 🟠 중간 · **확인 수준**: 확인함
- **위치**: `triplog/js/storage.js`(`refreshConsent()`/`hasConsent()`)
- **악용 시나리오**: 로그인 직후 `user_consents` 조회 요청이 일시적으로 실패하면(네트워크 문제 등), 동의하지 않은 사용자도 그 세션 동안 앱을 계속 사용하며 데이터를 만들 수 있음 — 법적으로 "동의 전 개인정보 처리"에 해당할 여지.
- **적용한 수정**: `refreshConsent()`가 실패 시 바로 포기하지 않고 400ms/1.2초 간격으로 2회 더 시도(총 최대 3회 — 순간적 네트워크 블립이면 대부분 재시도 안에서 성공). 그래도 전부 실패하면(마이그레이션 미실행 등 진짜 장애 포함) 예전처럼 "막지 않음(true)"이 아니라 **"동의 안 함"으로 간주해 동의 화면으로 보냄(fail-closed)**으로 기본값을 뒤집음. 로컬 서버로 앱이 정상 기동하고 콘솔 에러가 없는 것까지 확인함(실제 재시도 경로는 네트워크 장애를 재현해야 해서 이번엔 실행하지 않음 — 로직은 정적으로 검토).
- **작업량**: 중간(완료). 별도 배포/마이그레이션 불필요 — 정적 파일 배포만으로 적용됨.

---

### Edge Function (EDGE)

#### EDGE-01 — `send-notification`의 Web Push 발송에 SSRF — ✅ **코드 수정 완료(2026-10-19), 배포 필요**
- **심각도**: 🔴 높음 · **확인 수준**: 확인함
- **위치**: `supabase/functions/send-notification/index.ts`(`sendWebPushOne`/`isAllowedPushEndpoint`), `supabase/migrations/031_push_notifications.sql`(`device_tokens.token`에 형식 제약 없음 — 그대로 둠, 아래 참고)
- **악용 시나리오**: 로그인한 사용자가 Supabase REST API로 자신의 `device_tokens`에 `platform:'web'`, `token:'{"endpoint":"http://169.254.169.254/...","keys":{...}}'` 같은 행을 직접 insert(RLS는 "본인 행"만 확인)한 뒤, 자기 자신에게 알림이 가도록 유도하면 서버가 그 내부/메타데이터 주소로 HTTP 요청을 보내게 만들 수 있음.
- **적용한 수정**: `isAllowedPushEndpoint()`를 추가해 `subscription.endpoint`가 `https://fcm.googleapis.com`/`https://updates.push.services.mozilla.com`/`https://web.push.apple.com` 중 하나일 때만 `webpush.sendNotification()`을 호출하도록 변경. 호스트가 안 맞으면 무효 토큰과 같은 경로로 처리해 `device_tokens`에서 자동으로 삭제됨. `supabase/CLAUDE.md`의 `send-notification` 설명도 함께 갱신함.
- **작업량**: 작음(완료) — **단, 코드만 고쳤고 아직 배포 전**입니다.
- **내가 직접 해야 하는 일**: `supabase functions deploy send-notification`으로 재배포해야 실제로 적용됩니다(배포는 이 저장소 방침상 제가 직접 하지 않습니다). 배포 전까지는 기존(취약한) 버전이 운영 중입니다.

#### EDGE-02 — Gemini 호출 함수에 사용자당 요청 제한 없음 — ✅ **코드 수정 완료(2026-10-19), 배포 필요**
- **심각도**: 🔴 높음 · **확인 수준**: 확인함
- **위치**: `supabase/functions/analyze-ticket/index.ts`, `analyze-trip-import/index.ts`, `travel-briefing/index.ts`(24시간 캐시는 있으나 사용자별 제한 아님)
- **악용 시나리오**: 로그인한 계정 하나로 이미지(최대 10MB)를 반복 전송하거나 `travel-briefing`의 `destination` 문자열을 매번 바꿔 캐시를 우회하며 Gemini 호출을 무제한 반복해 요금을 발생시킬 수 있음.
- **적용한 수정**: 세 함수 모두 `search-destination`과 동일한 패턴(`authClaims()`로 JWT의 `role`/`sub` 추출 + 함수 인스턴스 메모리 `Map` 기반 `checkRateLimit()`)으로 **사용자당 분당 10회** 상한을 추가. 초과 시 HTTP 429 `"너무 자주 호출했어요. 잠시 뒤 다시 시도해주세요"`. 기존의 `isSignedIn()`은 `authClaims()`로 대체(반환값에 `userId` 추가). `supabase/CLAUDE.md`의 세 함수 설명도 함께 갱신함.
- **작업량**: 중간(완료) — **단, 코드만 고쳤고 아직 배포 전**입니다.
- **내가 직접 해야 하는 일**: `supabase functions deploy analyze-ticket`, `supabase functions deploy analyze-trip-import`, `supabase functions deploy travel-briefing`으로 재배포해야 실제로 적용됩니다. 배포 전까지는 기존(제한 없는) 버전이 운영 중입니다. 참고로 분당 10회라는 숫자는 "조정 지점"으로 주석 처리해 뒀으니, 실제 사용 패턴을 보고 너무 빡빡하면(정상 사용자가 걸리면) 숫자만 올리면 됩니다.

#### EDGE-09 — `airport-congestion`/`search-pexels` 함수가 실제로는 배포돼 있지 않음
- **심각도**: 🟡 낮음(가용성, 보안 취약점 아님) · **확인 수준**: 확인함
- **위치**: Supabase 프로젝트 `ffzjgiknrrgwvgobybdq`(Routory) — `supabase functions list` 결과에 두 함수가 아예 없음(로컬 저장소에는 소스가 있음: `supabase/functions/airport-congestion/`, `supabase/functions/search-pexels/`)
- **영향**: 공항 혼잡도 카드는 항상 `available:false`로만 동작하고(원래도 비밀값 미설정 시 그렇게 동작하도록 설계돼 있어 화면상 티는 안 남), 관리자 페이지의 "Pexels에서 검색" 기능은 호출 시 오류가 남.
- **수정 방안**: 두 함수를 실제로 쓸 계획이면 `supabase functions deploy airport-congestion`/`search-pexels` 배포. 안 쓸 계획이면 그대로 둬도 보안 문제는 아님. **작업량: 작음(배포만, 사용자 작업)**.
- **내가 직접 해야 하는 일**: 두 기능을 실제로 쓸지 결정 후 배포 여부 결정.

#### EDGE-04 — 네이버 로그인 토큰 교환에 `redirect_uri` 미전송
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함(코드에 없음), 실제 위험도는 추정
- **위치**: `supabase/functions/naver-login/index.ts:68-94`(`exchangeNaverToken`)
- **악용 시나리오**: 네이버가 토큰 교환 시점에 `redirect_uri` 일치를 재검증하지 않는다면(표준 OAuth 권장과 다름), 인가 코드 탈취 공격의 완화 효과가 통상보다 약함.
- **수정 방안**: 토큰 교환 요청에 `redirect_uri` 파라미터 추가(네이버가 허용하는 값이면). **작업량: 작음**.

#### EDGE-05 — 내부 전용 함수 4곳의 비밀값 비교가 상수 시간 비교가 아님 — ✅ **수정 완료(2026-10-19), 배포 필요**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `collect-travel-feed/index.ts`, `refresh-city-weather/index.ts`, `send-notification/index.ts`, `notify-scheduler/index.ts`(전부 `!==` 비교였음)
- **적용한 수정**: 4개 파일 전부에 `timingSafeEqual(a, b)` 헬퍼(바이트 단위 XOR 누적, 길이가 다르면 즉시 false·같으면 끝까지 전부 비교)를 추가하고 비밀값 비교를 이걸로 교체. `node --experimental-strip-types`로 4개 파일 전부 파싱 확인.
- **작업량**: 작음(완료) — 배포해야 반영됨.
- **내가 직접 해야 하는 일**: 4개 함수 재배포(아래 "작업 요약"의 배포 명령에 포함).

#### EDGE-06 — `delete-account`가 실패 시 내부 단계명·원본 에러를 응답 본문에 그대로 포함 — ✅ **수정 완료(2026-10-19), 배포 필요**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `supabase/functions/delete-account/index.ts`
- **적용한 수정**: 실패 응답을 다른 함수들과 같은 고정 한국어 메시지("탈퇴 처리 중 오류가 발생했어요...")로 통일. 상세 단계명·원본 에러는 그대로 `console.error`에만 남김.
- **작업량**: 작음(완료) — 배포해야 반영됨.

#### EDGE-07 — 전체 사람-호출용 함수의 CORS가 `Access-Control-Allow-Origin: *` — ✅ **수정 완료(2026-10-19), 배포 필요**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `analyze-ticket`/`analyze-trip-import`/`naver-login`/`travel-briefing`/`airport-congestion`/`search-destination`/`search-pexels`/`search-unsplash`/`delete-account`/`send-contact-email` (10개 함수)
- **악용 시나리오**: JWT Bearer 인증이라 CSRF로 직결되진 않지만, 토큰 탈취가 전제되면 임의 출처에서 API를 직접 호출 가능.
- **적용한 수정**: 단일 고정값(`http://localhost:8080`, `https://triplog-nu.vercel.app`, Capacitor WebView 기본 출처 `https://localhost` 셋 다 동시에 계속 동작해야 해서 고정 문자열 하나로는 불가능) 대신, 요청의 `Origin` 헤더가 허용 목록에 있을 때만 그 값을 그대로 돌려주는 `corsHeadersFor(req)`로 10개 파일 전부 교체. `search-destination`/`search-unsplash`는 내부적으로 `handleSearch`/`handleSelect`/`handleTrackDownload`가 별도 함수라 `json` 생성 함수를 매개변수로 넘기도록 같이 고쳤다. 10개 파일 전부 `node --experimental-strip-types`로 파싱 확인(수정 과정에서 `search-unsplash`에 괄호 짝이 안 맞는 실수가 한 번 있었는데, 파싱 테스트로 바로 잡아냄).
- **작업량**: 작음(완료) — 배포해야 반영됨. 도메인이 바뀌면(예: 커스텀 도메인 연결) 각 파일의 `ALLOWED_ORIGINS`를 같이 바꿔야 함.
- **내가 직접 해야 하는 일**: 10개 함수 재배포(아래 "작업 요약"의 배포 명령에 포함). 배포 후 네이티브 앱/로컬 개발에서 이 함수들 호출이 여전히 되는지 한 번 확인 권장(Origin이 예상과 다르면 차단될 수 있음).

#### EDGE-08 — 이미지 업로드 함수에 매직바이트(파일 시그니처) 검증 없음
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `analyze-ticket/index.ts`, `analyze-trip-import/index.ts`(`sniffMimeType`는 라벨링용일 뿐 게이트가 아님)
- **악용 시나리오**: 이미지가 아닌 임의 바이너리를 10MB까지 Gemini API로 흘려보낼 수 있음(EDGE-02와 결합 시 비용 남용 벡터 확대).
- **수정 방안**: 파일 시그니처 검증을 실패 조건으로 승격. **작업량: 작음**.

---

### 프런트엔드 / XSS (FE)

#### FE-01 — 여행 소식·추천 도시 이미지 출처 URL에 스킴(scheme) 검증 없음 — ✅ **수정 완료(2026-10-19)**
- **심각도**: 🟠 중간 · **확인 수준**: 확인함
- **위치**: `triplog/js/travelFeed.js`, `triplog/js/adminPage.js`(`href="${escapeHtml(...)}"`, `escapeHtml`은 스킴을 걸러내지 않음) / 관련 컬럼: `travel_feed_items.image_credit_url`/`image_source_url`(037), `discover_city_images.credit_url`/`source_url`(027)
- **악용 시나리오**: 관리자 계정이 탈취되거나 실수로 `javascript:...` 값을 이미지 출처 URL에 입력해 저장하면, 그 소식을 열람하는 **모든 로그인 사용자**의 세션에서 그 코드가 실행됨.
- **적용한 수정**:
  1. `supabase/migrations/039_image_url_https_check.sql`(신규) — 위 4개 컬럼에 `check (col is null or col ~* '^https://')` DB 제약 추가(023과 동일 패턴). **DB 쪽은 이 파일을 SQL Editor에서 직접 실행해야 적용됩니다(사용자 작업).**
  2. `triplog/js/util.js`/`triplog/js/adminPage.js`에 `safeHttpUrl()` 헬퍼 추가 — `http(s)`가 아니면 빈 문자열을 돌려줘서 href 자체를 안 그리고 평문으로 대체. `travelFeed.js`/`adminPage.js`의 href 7곳 전부 이 헬퍼를 거치도록 변경.
- **작업량**: 작음(코드 완료, 마이그레이션 실행만 남음).
- **내가 직접 해야 하는 일**: `supabase/migrations/039_image_url_https_check.sql`을 Supabase 대시보드 SQL Editor에서 실행(이 저장소 방침상 마이그레이션은 전부 사용자가 직접 실행).

#### FE-02 — 외부 링크 `rel`에 `noreferrer` 누락(일관성 부족) — ✅ **수정 완료(FE-01 작업 중 같이 처리)**
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `travelFeed.js`(4곳), `adminPage.js`(3곳) — FE-01의 href 수정과 같은 줄이라 함께 `noopener noreferrer`로 통일함.
- **작업량**: 작음(완료).

#### FE-03 — 정적 HTML 4곳의 `supabase-js` CDN 스크립트에 SRI(무결성 해시) 없음 — ✅ **수정 완료(2026-10-19)**
- **심각도**: 🟠 중간 · **확인 수준**: 확인함
- **위치**: `triplog/index.html`, `triplog/admin.html`, `triplog/account-deletion.html`, `triplog/auth/naver-callback.html`
- **악용 시나리오**: jsDelivr CDN이 침해당하면(공급망 공격) 변조된 코드가 그대로 실행되어 세션 토큰·API 호출을 가로챌 수 있음.
- **적용한 수정**: 버전을 `@2`(플로팅)에서 `@2.45.4`(다른 곳에서 이미 쓰는 고정 버전과 통일)로 고정하고, 그 정확한 파일을 직접 받아 SHA-384 해시를 계산해 `integrity`/`crossorigin="anonymous"` 속성을 4개 파일 전부에 추가. 두 번 독립적으로 내려받아 바이트가 동일함을 확인한 뒤 해시를 썼습니다.
- **작업량**: 작음(완료). 배포만 하면 바로 적용됩니다(Vercel은 정적 파일이라 재배포만 필요, 별도 CLI 명령 없음).

---

### 배포 설정 (DEP)

#### DEP-01 — Vercel 보안 헤더 전부 부재 — ✅ **수정 완료(2026-10-19), 배포 필요**
- **심각도**: 🟠 중간 · **확인 수준**: 확인함
- **위치**: `triplog/vercel.json`
- **적용한 수정**:
  1. `triplog/auth/naver-callback.html`/`triplog/account-deletion.html`의 인라인 `<script>`를 각각 `naver-callback.js`/`account-deletion.js`(같은 폴더)로 분리 — 로직은 그대로, CSP의 `script-src`에 `'unsafe-inline'`을 안 열기 위함. 로컬 서버로 두 페이지 모두 열어 콘솔 에러 없이 기존과 동일하게 동작(네이버 콜백의 state 불일치 → `/#/login`으로 리다이렉트 등)하는 것을 확인함.
  2. `vercel.json`의 `/(.*)` 헤더 블록에 `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`(camera/geolocation은 self로 허용 — 항공권 촬영·지도 기능이 실제로 씀), `Content-Security-Policy` 추가.
- **CSP 상세**: `script-src`는 `cdn.jsdelivr.net`/`t1.kakaocdn.net`/`maps.googleapis.com`만 허용(인라인 없음), `style-src`는 `'unsafe-inline'`을 유지(앱 전체에 인라인 `style` 속성이 많아 전부 제거하는 리팩터링은 이번 범위 밖), `img-src`는 Supabase/Unsplash/Wikimedia/Pexels/구글·카카오·네이버 프로필 사진 도메인·구글 지도 타일, `connect-src`는 Supabase/구글 지도·카카오/adsbdb/aviationstack/open-meteo/open.er-api, `frame-ancestors 'none'`, `object-src 'none'`.
- **작업량**: 중간(코드 완료). **단, 이 CSP는 로컬 `serve.py`로는 전혀 테스트가 안 됩니다** — `vercel.json`의 헤더는 Vercel 배포본에서만 적용되고 로컬 서버는 읽지 않습니다. 그래서 실제 CSP 위반 여부(Kakao 공유, 구글 지도, 관리자 페이지 이미지 검색 등)는 배포 후에만 확인할 수 있습니다.
- **내가 직접 해야 하는 일**: `vercel --prod`로 배포한 뒤, 브라우저 콘솔에서 CSP 위반(`Refused to ...`) 에러가 있는지 다음 화면들을 직접 확인해주세요 — 로그인(구글/카카오/네이버), 지도가 쓰이는 일정/숙소 화면, 카카오톡 공유(초대하기), 관리자 페이지(`/admin`)의 Unsplash/Pexels 검색, 항공권 사진 인식. 문제가 생기면 어떤 리소스가 막혔는지 알려주시면 CSP 문구만 조정하면 됩니다.

#### DEP-02 — Android 릴리스 빌드에서 R8/ProGuard 코드 축소 미적용 — ✅ **수정 완료(2026-10-19), 빌드 테스트 필요**
- **심각도**: 🟠 중간 · **확인 수준**: 확인함
- **위치**: `mobile/android/app/build.gradle`(`minifyEnabled false` → `true` + `shrinkResources true`), `mobile/android/app/proguard-rules.pro`(Capacitor 브리지 keep 규칙 추가)
- **작업량**: 중간(코드 완료). **이 환경엔 Android SDK/Gradle이 없어 실제 빌드를 돌려보지 못했습니다** — Capacitor 플러그인은 보통 자체 consumer-rules로 스스로를 지키고 흔한 패턴에 안전한 keep 규칙도 추가해 뒀지만, 실제로 빌드가 되는지·앱이 정상 동작하는지는 코드만으로 보장할 수 없습니다.
- **내가 직접 해야 하는 일**: `cd mobile/android && ./gradlew assembleRelease`(또는 Android Studio)로 릴리스 빌드를 한 번 돌리고, 실제 기기/에뮬레이터에 설치해 로그인·사진 촬영·지도·푸시 알림 등 핵심 기능이 그대로 동작하는지 확인해주세요. 문제가 생기면(크래시, 기능 깨짐) `proguard-rules.pro`에 규칙을 추가해야 합니다 — 그 경우 로그캣의 `ClassNotFoundException`/`NoSuchMethodException` 메시지를 알려주시면 규칙을 같이 찾아드릴 수 있습니다.

#### DEP-03 — `android:allowBackup="true"` + 백업 제외 규칙 없음 — ✅ **수정 완료(2026-10-19)**
- **심각도**: 🟠 중간 · **확인 수준**: 확인함
- **위치**: `mobile/android/app/src/main/AndroidManifest.xml`
- **적용한 수정**: `android:allowBackup="false"`로 변경. XML 유효성(`xml.dom.minidom`)으로 확인함.
- **작업량**: 작음(완료). 다음 빌드부터 적용됩니다 — 별도 배포 조치 불필요.

#### DEP-04 — `@capacitor/assets`가 물고 있는 `tar` 패키지의 critical 취약점(고친 버전 없음)
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함(`npm audit`, mobile/)
- **위치**: `mobile/package.json`(devDependency `@capacitor/assets`) → `node_modules/@capacitor/assets/node_modules/tar`
- **악용 시나리오**: 빌드 도구 전용(앱 번들에 미포함)이라 최종 사용자 위험은 아니지만, 개발 PC에서 신뢰할 수 없는 자산 파일을 처리할 때 위험할 수 있음. 공식 수정 버전 자체가 아직 없음.
- **수정 방안**: 실제로 아이콘/스플래시 생성에 쓰고 있는지 확인 후, 안 쓰면 devDependencies에서 제거. **작업량: 작음**.
- **내가 직접 해야 하는 일**: `@capacitor/assets` 실제 사용 여부 판단(최근 npm script에 연결돼 있지 않음 — 수동 1회성 실행 도구로 보임).

#### DEP-05 — 미사용 추정 패키지 및 로컬 스크립트의 취약 의존성
- **심각도**: 🟡 낮음 · **확인 수준**: 확인함
- **위치**: `mobile/package.json`의 `@capacitor/ios`(dependency) — `mobile/ios/` 폴더 자체가 존재하지 않아 미사용으로 보임. `scripts/collect-city-images/package.json`의 `sharp`(high, libvips/libheif/librsvg 상속 취약점, `npm audit fix --force`로 해결 가능하나 breaking change).
- **악용 시나리오**: 둘 다 최종 사용자에게 도달하지 않는 빌드/로컬 도구라 위험도는 낮음.
- **수정 방안**: `@capacitor/ios`는 iOS를 만들 계획이 없다면 제거. `sharp`는 로컬 스크립트 실행 전 업그레이드 검토. **작업량: 작음**.

---

## 3. 이상 없음으로 확인한 영역

- **`verify_jwt` 설정(EDGE-03, 2026-10-19 해소 확인)**: Supabase CLI(`supabase functions list --project-ref ffzjgiknrrgwvgobybdq`)로 실제 배포 상태를 직접 조회함. 사람이 호출하는 8개 함수(`analyze-ticket`, `analyze-trip-import`, `naver-login`, `travel-briefing`, `search-destination`, `search-unsplash`, `delete-account`, `send-contact-email`) 전부 `verify_jwt:true`로 정상 배포돼 있음을 확인. 내부 전용 4개 함수(`collect-travel-feed`, `refresh-city-weather`, `send-notification`, `notify-scheduler`)는 `verify_jwt:false`이지만, 이건 의도된 설계대로다 — JWT 대신 `x-cron-secret`/`x-notify-secret` 고정 비밀값으로 보호하는 함수들이라 꺼져 있는 게 맞음. **서명 검증 우회 가능성 없음.** (부수적으로, `airport-congestion`/`search-pexels` 2개 함수는 아예 배포돼 있지 않음을 발견 — EDGE-09 참고, 보안 문제는 아니고 가용성 문제.)
- **비밀키 관리**: `service_role` 키·Gemini 키·네이버/카카오 Client Secret·FCM 서비스 계정·VAPID 개인키 등 서버 전용 값이 코드/git 히스토리 어디에도 평문으로 존재하지 않음(전체 커밋 히스토리 pickaxe 검색으로 확인). `anon` 키·Supabase URL·Google Maps/카카오 JS 키는 "클라이언트 노출이 전제된 공개 설계값"으로 코드 주석에 명시돼 있고 실제로도 그렇게 쓰임.
- **RLS 전수 점검**: 38개 마이그레이션 전체 테이블에서 RLS가 꺼진 테이블 없음. 멤버 자기 권한 상승, 타 멤버 강퇴, 비초대 사용자의 여행 데이터 접근, 탈퇴/제거된 멤버의 잔존 접근, 비로그인 사용자의 읽기/쓰기 — 전부 RLS로 차단되는 것을 정책 조건까지 직접 읽어 확인함. 관리자 전용 쓰기(여행 소식·추천 도시·공지)는 `is_admin()` 서버 판정에만 의존하고 클라이언트 값을 신뢰하지 않음.
- **초대 토큰**: 32자 16진수(≈122비트 무작위), 7일 만료가 `accept_trip_invite`에서 실제로 체크됨. 소유자가 즉시 폐기 가능.
- **계정 삭제 시 연쇄 삭제**: `auth.users`를 참조하는 모든 개인 데이터 컬럼이 `on delete cascade`(또는 관리자 콘텐츠는 의도적 `set null`)로 연결돼 있어 고아 데이터가 남지 않음. `delete-account` Edge Function은 본문의 어떤 id도 믿지 않고 JWT의 `sub`(호출자 본인)만으로 전부 처리 — IDOR 없음.
- **네이버 로그인 CSRF**: 처음엔 "서버가 state를 재검증하지 않는다"고 확인 필요로 플래그했으나, `triplog/auth/naver-callback.html:85-107`을 직접 읽어 state 불일치/누락 시 확실히 거부하고 1회 확인 후 즉시 삭제하는 것을 확인함(해소됨).
- **네이버 로그인 계정 자동 연결**: `naver-login/index.ts`의 `buildInternalEmail()`이 네이버 ID만으로 합성 이메일을 만들어 계정을 식별 — 실제 이메일이 같아도 구글/카카오 계정과 자동으로 합쳐지는 경로가 없음을 코드로 확인함. 토큰/비밀값이 로그에 남는 곳도 없음.
- **Unsplash `downloadLocation` SSRF 방어**: 호스트 접두사(`https://api.unsplash.com/`) 화이트리스트로 잘 방어돼 있음.
- **`collect-travel-feed` 수집 콘텐츠의 관리자 화면 렌더링**: 처음엔 확인 필요로 플래그했으나, `adminPage.js`가 `title`/`region_label`/`source_url` 등을 전부 `escapeHtml()` 경유해 렌더링하는 것을 확인함(해소됨).
- **프런트엔드 이스케이프 규율**: 멤버 이름·일정 제목/장소/메모·가계부·여행지갑·체크리스트·여행 소식 등 "다른 멤버가 쓴 값이 내 화면에 그려지는" 핵심 지점 전부 `escapeHtml()` 경유 확인(23개 파일, 240곳). 클라이언트 전용 권한 판단(화면만 숨기고 서버가 확인 안 하는 경우)도 발견되지 않음 — 관리자/owner/editor 판단 전부 RLS·RPC 서버 확인과 쌍을 이룸.
- **서비스 워커**: `fetch` 이벤트 리스너·Cache Storage 사용이 전혀 없음 — 인증 응답이나 개인 데이터가 캐시에 남을 경로 자체가 없음.
- **항공권 이미지 폐기**: 서버(Edge Function)와 클라이언트(`flight.js:579`, 분석 직후 base64를 메모리에서 즉시 폐기) 양쪽 모두 설계 의도대로 저장하지 않음을 코드로 확인함.
- **개인정보 스키마**: 예약번호(PNR)·탑승객 성명·여권번호·카드번호를 저장하는 컬럼이 스키마 어디에도 없음(여권/탑승권은 이미지 파일로만 보관). 과잉 수집 징후 없음.
- **로그·분석**: 분석(Analytics) SDK 자체가 없고, 서버 로그는 검색어를 길이만 남기며, 클라이언트는 `console.log`를 한 건도 쓰지 않음. 토큰이 URL 쿼리에 실리는 경로 없음.
- **모바일 네트워크 기본값**: `targetSdkVersion=36`이라 cleartext 트래픽이 기본적으로 차단돼 있고(`network_security_config.xml` 없이도), `capacitor.config.json`에 `server.url`/`cleartext` 오버라이드가 전혀 없어 WebView가 항상 번들 자산만 로드함. WebView 디버깅을 강제로 켜는 코드도 없음.
- **의존성(루트)**: 저장소 루트의 `npm audit` 결과 취약점 0건.

---

## 4. 확인하지 못한 영역

- Google Cloud / Firebase 콘솔의 API 키 제한 실제 적용 상태(SEC-01, SEC-02)
- 카카오 디벨로퍼스 / 네이버 디벨로퍼스의 플랫폼 등록 도메인·Redirect URI 화이트리스트 실제 값
- Supabase Auth 콘솔의 "동일 이메일 자동 연결" 등 프로젝트 레벨 설정(구글↔카카오 간, 네이버는 코드로 확인됨)
- Supabase Storage 대시보드의 `wallet`/`discover-images` 버킷 public/private·파일 크기·MIME 제한 실제 설정(RLS-04)
- 원격 git 저장소(GitHub 등)의 공개 여부, 과거 커밋이 실제로 push/크롤링된 적 있는지(SEC-04)
- 릴리스 APK로 빌드했을 때 Capacitor 플러그인이 머지해 넣는 추가 매니페스트 컴포넌트(`aapt dump`로 재확인 필요)
- Android 서명 키스토어·Play Console 설정, 실제 배포 서명 프로세스
- `robots.txt` 등 실제 배포본의 추가 설정(이 점검은 저장소 파일만 확인)
- 여권 이미지 등 민감 데이터 보관이 조직의 법적/컴플라이언스 요구사항(암호화 저장 의무 해당 여부 등)을 충족하는지 — 기술 점검 범위 밖, 별도 법무 검토 필요

---

## 5. 수정 우선순위 제안

### 1순위 — 키 교체·콘솔 설정 확인 (내가 직접 해야 함)
- SEC-01, SEC-02: Google/Firebase 콘솔 API 키 제한 확인
- SEC-04: 원격 저장소 노출 여부 확인
- RLS-04: `wallet`/`discover-images` 버킷 대시보드 설정 확인
- ~~EDGE-03: verify_jwt 설정 확인~~ — **완료(2026-10-19, 이상 없음 확인됨)**
- ~~SEC-03: `.gitignore` 키스토어 줄~~ — **코드 수정 완료(2026-10-19)**

### 2순위 — RLS / 데이터 접근
- ~~RLS-01~~, ~~RLS-03~~ — 코드 수정 완료, 마이그레이션(`040`/`041`/`042`) 실행 필요 — `040`을 이미 실행했다면 `042`를 가장 먼저 실행할 것(관리 페이지 회귀 수정)
- RLS-02, RLS-04, RLS-05(미착수)
- ~~RLS-06(동의 fail-open)~~ — 코드 수정 완료, 배포만 하면 끝

### 3순위 — Edge Function
- ~~EDGE-01(SSRF)~~, ~~EDGE-02(비용 남용)~~, ~~EDGE-05(상수시간 비교)~~, ~~EDGE-06(에러 메시지)~~, ~~EDGE-07(CORS)~~ — 전부 코드 수정 완료, **Edge Function 12개 재배포 필요**(사용자 작업, 위 6번 참고)
- EDGE-04, EDGE-08, EDGE-09(미착수)

### 4순위 — 프런트엔드 / XSS
- ~~FE-01(URL 스킴 검증)~~, ~~FE-02(rel 속성)~~, ~~FE-03(SRI)~~ — 전부 코드 수정 완료. FE-01은 `039_image_url_https_check.sql` 실행도 필요.

### 5순위 — 헤더·모바일 설정
- ~~DEP-01(Vercel 헤더)~~, ~~DEP-02(R8/ProGuard)~~, ~~DEP-03(allowBackup)~~ — 전부 코드 수정 완료, 배포/빌드 테스트 대기
- DEP-04, DEP-05(미착수)

---

## 6. 2026-10-19 작업 요약 (코드 수정 완료, 미착수 구분)

| 분류 | 코드 수정 완료 | 아직 손 안 댐 |
|---|---|---|
| 🔴 높음 | EDGE-01, EDGE-02 | 없음 |
| 🟠 중간 | FE-01, FE-02, FE-03, DEP-01, DEP-02, DEP-03, RLS-06 | 없음 |
| 🟡 낮음 | SEC-03, RLS-01, RLS-03, EDGE-05, EDGE-06, EDGE-07 | SEC-01·02·04, RLS-02·04·05, EDGE-04·08·09, DEP-04·05 |

**지금 당장 사용자가 해야 할 일 (전부 끝나야 위 수정이 실제로 반영됩니다)** — 2번 섹션의 "남은 사용자 작업 요약"과 동일한 4가지입니다:
1. 마이그레이션(`039`→`040`→`041`→`042`) SQL Editor에서 순서대로 실행 — **`040`을 이미 실행했다면 관리 페이지 복구를 위해 `042`부터 바로 실행**
2. Edge Function 12개 재배포(`analyze-ticket analyze-trip-import naver-login travel-briefing search-destination search-unsplash delete-account send-contact-email send-notification collect-travel-feed refresh-city-weather notify-scheduler`)
3. `vercel --prod` 배포 → 로그인(구글/카카오/네이버)·지도·카카오 공유·관리자 이미지 검색·항공권 인식 화면에서 브라우저 콘솔에 CSP/CORS 위반(`Refused to...`) 에러가 없는지 확인
4. `mobile/android`에서 릴리스 빌드 1회 + 기기/에뮬레이터 설치 테스트(로그인, 사진 촬영, 지도, 푸시 알림)

남은 낮음 등급(SEC-01·02·04, RLS-02·04·05, EDGE-04·08·09, DEP-04·05)은 아직 손대지 않았습니다 — 이어서 진행할지 말씀해주세요.

---

*이 보고서는 읽기 전용 점검으로 시작했고, 이후 요청에 따라 높음·중간 등급 발견 사항의 코드 수정을 진행했습니다(위 표 참고). 배포·마이그레이션 실행·빌드 테스트처럼 이 저장소 방침상 사용자가 직접 해야 하는 작업은 수행하지 않았습니다.*
