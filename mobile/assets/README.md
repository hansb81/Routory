# 앱 아이콘·스플래시 소스 이미지

`@capacitor/assets`가 이 폴더(`mobile/assets/`)를 보고 아이콘·스플래시 화면을 자동 생성합니다.
실제 실행은 사용자가 직접 합니다 — 자세한 절차는 저장소 루트의 대화 기록(또는 CLAUDE.md의
**Mobile wrapper (Capacitor)** 섹션)을 참고하세요. 요약:

1. 로고 파일을 이 폴더에 `logo.png`라는 이름으로 넣는다 (정사각형, 최소 1024×1024px 권장, 배경 없는
   투명 PNG면 더 좋다 — 배경색은 아래 명령의 `--iconBackgroundColor`로 따로 지정한다).
2. 스플래시 화면을 로고와 다른 별도 이미지로 쓰고 싶으면 `splash.png`를 같은 폴더에 넣는다 — 있으면
   `logo.png`에서 자동 생성하는 대신 이 파일을 그대로 각 해상도에 맞춰 잘라서 쓴다(공식 권장 최소
   해상도는 2732×2732px; 그보다 작으면 큰 타겟에서 업스케일되어 화질이 약간 떨어질 수 있다 — 현재
   파일은 941×1672px). 다크 모드용 `splash-dark.png`도 같은 방식으로 넣을 수 있다.
3. `mobile/`에서 실행:
   ```
   npx capacitor-assets generate --android --iconBackgroundColor "#007aff" --splashBackgroundColor "#ffffff"
   ```
   (색상 값은 원하는 대로 바꿔도 된다. iOS 프로젝트가 아직 없으므로 `--android`로 안드로이드만 지정한다.
   `splash.png`가 있으면 `--splashBackgroundColor`는 아이콘 배경에만 영향을 주고 스플래시 자체에는
   쓰이지 않는다.)
4. 끝나면 `mobile/android/app/src/main/res/` 아래 mipmap·drawable 파일들이 새로 생긴다.
   `npx cap sync`는 필요 없다(웹 자산이 아니라 네이티브 리소스라서 sync 대상이 아니다) — Android
   Studio에서 다시 빌드하면 바로 반영된다.

이 폴더는 `@capacitor/assets`가 읽는 위치라서 파일명이 정확해야 한다(`logo.png` / 필요하면
`logo-dark.png`, `splash.png`, `splash-dark.png`). 자세한 옵션(커스텀 모드, PWA 등)은
`node_modules/@capacitor/assets/README.md` 참고.
