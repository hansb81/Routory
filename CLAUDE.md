# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. **Keep this file under ~10,000 characters.** Details live in `docs/features/*.md`, `docs/prd/`, and `supabase/CLAUDE.md` — read the relevant one before touching that area, and record new implementation detail there, not here.

## Overview

`triplog/` is a Korean-language travel planner: a static site in plain HTML/CSS/vanilla JS, backed by Supabase (login, Postgres, Edge Functions). All UI text and code comments are Korean; match that.

- **Display name vs. internal name**: the app is branded **Routory** to users (`<title>`, the login screen heading, page-title `document.title`, the invite-share fallback place name), but nothing else was renamed — the folder (`triplog/`), the `window.TripLog` JS namespace every file reads/writes, `TripLogConfig`, and every `triplog.*` localStorage/IndexedDB key stay as `TripLog`/`triplog` (deliberately, to avoid a large low-value refactor and to not lose users' existing local data like saved photos or the AviationStack key). Don't "fix" this mismatch by renaming the internal code without being asked — it's intentional.
- No bundler, linter or test suite, and the directory is not a git repository. *(원문 유지 — 현재 repo root엔 git 히스토리가 있어 이 문장이 더 안 맞을 수 있음.)*
- `triplog/package.json` (name/version only) exists just for Vercel. The repo-root `package.json` only lists the Supabase CLI as a devDependency (`node_modules` there is not part of the site).

## Structure

- `triplog/` — the deployed static site (HTML/CSS/vanilla JS, no ES modules). Load order of `js/*.js` in `index.html` matters — see `docs/features/routing.md`.
- `mobile/` — separate npm project, Capacitor wrapper for Android (sibling of `triplog/`, `webDir: "../triplog"`). See `docs/features/mobile-capacitor.md`.
- `supabase/` — migrations (`supabase/migrations/`, numbered, run by hand in the SQL Editor) and Edge Functions (`supabase/functions/`). See `supabase/CLAUDE.md`.
- `docs/prd/` — original feature PRDs (v3–v9). `docs/features/` — per-screen/per-feature implementation notes split out of this file.

## Commands

- **Run**: `python serve.py [port] [--local]` from the repo root (default 8080, serves `triplog/`), then open http://localhost:8080/. Opening `triplog/index.html` via `file://` also works, but nothing can be loaded or saved there (no login).
- **Phone testing**: without `--local`, `serve.py` listens on all interfaces; trips/items live in Supabase so the same account shows the same trips on any device, but photos stay per-browser (IndexedDB). This PC has a public IPv4 — stop the server when done, or use `--local`. Secure-context gotcha (`crypto.randomUUID` missing over plain HTTP) and the exact phone URL: `docs/testing.md`.
- **Cache**: `serve.py` sends `Cache-Control: no-store` (unlike `python -m http.server`) — a tab loaded earlier may hold stale files; hard-reload (Ctrl+Shift+R) or force-refetch from automation. Details: `docs/testing.md`.
- **Static check**: only `node --check js/<file>.js`.
- **Deploy**: run `vercel` / `vercel --prod` from inside `triplog/`, never the repo root (or `serve.py`, `CLAUDE.md`, `supabase/` etc. would be published). Routing/referrer/domain details: `docs/deploy.md`.
- Things the user runs by hand, never Claude: `vercel` / `vercel --prod`, `supabase functions deploy`, `supabase secrets set`, every SQL file in `supabase/migrations/`, `npx cap sync android`.

## Absolute rules

- **Never put the `service_role` key in client code.** The anon key is public by design; every table's data safety rests entirely on RLS policies (`supabase/CLAUDE.md`).
- **Never rename `TripLog`/`triplog` internals** to match the "Routory" display name — see Overview above.
- **Don't auto-update `comments.html`** (if present) as a side effect of other edits — only touch it on explicit request.
- Don't skip hooks/destructive git ops unless explicitly asked (standard policy, see global instructions).
- When a feature is done, write its detail into `docs/features/<name>.md` — do not grow this file.

## Code conventions

Full original wording (element-id rules, z-index token names, exact alias-tag locations, breakpoint values): `docs/features/conventions-detail.md`.

- Shared layout classes: `.wizard*` (multi-step modals), `.pick-list/-item/-info/-name/-sub/-btn` (selectable lists), `.search-input`. Reuse these rather than adding new layouts.
- `[hidden]` is forced to `display: none !important` — toggle visibility with the `hidden` attribute, not inline styles.
- `css/style.css` is one file split into numbered sections (TOC at top); put new rules in the matching section. All colors/spacing/radii/shadows/z-indexes come from `:root` tokens — never hard-code hex colors or z-index numbers.
- Category colors/icons: `--color-all/flight/lodging/meal/sightseeing/shopping/etc` tokens in `:root`, mapped via `[data-category="..."]` → `--cat-color`; labels/icons in `myTripData.CATEGORY_META`.
- Responsive: base styles are the 360px phone layout, with wider breakpoints at 400/600/720/1024px. `word-break: keep-all` on `body` keeps Korean words together.
- **Alias scheme**: every screen/part has an alias key (e.g. `MAIN`, `FLIGHT`), tagged as `// @별칭 KEY · name` / `data-alias="KEY · name"` across `js/*.js`, markup and `css/style.css` — keep intact when adding/renaming a screen or modal. Dev aid: `?alias=1` or Alt+Shift+A overlays them (`js/aliasView.js`).
- **Color policy — pastel by default.** New colors for images/icons/badges/decorative or identity-carrying text should default to pastel (soft, desaturated), not the older vivid/primary palette. A genuine multi-color set shown together (e.g. `--route-1..6` for Day colors) is the one case still narrowed to one hue family, to keep N slots mutually distinguishable — validate such sets with `scripts/validate_palette.js --pairs all`, don't eyeball them. Full methodology: `docs/features/color-policy.md`.
- **Font color — 6 roles** (separate from the pastel policy; this is about plain text color):

  | 역할 | 토큰 | 값 |
  |---|---|---|
  | 기본 글자 | `--text` | `#111827` |
  | 제목/강조 | `--text-soft` | `#111827` |
  | 보조 글자 | `--text-muted` / `--text-faint` | `#6b7280` / `#94a3b8` |
  | 레드 계열 | `--text-danger` | `#ff7b72` |
  | 블루 계열 | `--text-accent` | `#3b82f6` |
  | 비활성화 | `--disabled` | `#94a3b8` |

  `--danger` unchanged (`#ff3b30`) — red stays as-is. `--accent` (buttons/borders/checkbox `accent-color`, ~75 rules) is now pastel blue `#8cb4ff` app-wide incl. popups — see **클린 미니멀 base palette** below. `--text-accent`/`--text-danger` are `color:`-only (readable blue/red, not pastel) — never use for `background`/`border-color`, and never point those at the plain `--accent`/`--danger` hexes. `--danger-pastel` untouched. `naver-callback.html`/`account-deletion.html` mirror these hexes by hand (outside the SPA bundle) — sync on change. Default new text colors to this table rather than a one-off hex.
- **클린 미니멀 base palette** (요청, 전체 화면+팝업 기본값, 새 화면도 따를 것): `--page-bg`/`--page-bg-blue` `#f8fafc`, `--surface`/`--surface-blue` `#ffffff`, `--shadow-sm` `0 2px 8px rgba(0,0,0,.04)`, `--accent` `#8cb4ff`(참고 이미지 기준). 레드 계열은 대상 밖. 상세: `docs/features/color-policy.md`.

## Architecture (skeleton)

- **No ES modules.** Every `js/*.js` file is an IIFE reading/writing `window.TripLog.<name>`; load order in `index.html` matters. `app.js` is the entry point, wired last. Router is a hash router (`#/...`) with login/consent guards. Details: `docs/features/routing.md`.
- **Data** (`storage.js`): reads are synchronous from an in-memory cache (`getAllTrips`, `getTrip`, `getItems`, ...); writes are async and must be awaited (`createTrip`, `addItem`, ...) and throw Korean-message `Error`s on failure. Details: `docs/features/data-layer.md`.
- **Auth** (`auth.js` + `supabaseClient.js`): PKCE flow (not implicit) because the app uses a hash router; session cached at startup for synchronous route guards. Native app (Capacitor) OAuth uses a `routory://auth-callback` deep link instead of a web redirect. Details: `docs/features/auth.md`.

## Feature/screen docs (`docs/features/`)

Read the relevant file before working on that area; write new implementation detail back into it, not into this file.

| Area | File |
|---|---|
| Main page, trip setup wizard | `screen-main.md` |
| Trip shell (top/bottom bars, slide-in menu) | `screen-trip-shell.md` |
| My-trip page (status cards) | `screen-my-trip.md` |
| Schedule page, item form, drag/swipe reorder | `screen-schedule.md` |
| Budget page, expense form | `screen-budget.md` |
| Checklist page (준비물 체크리스트) | `screen-checklist.md` |
| Wallet page, visibility, upload form, viewer | `screen-wallet.md` |
| Common pages (알림 · 설정) | `screen-common-pages.md` |
| Account deletion (in-app + no-login page) | `screen-account-delete.md` |
| Admin page (`/admin`, 여행 소식 · 인기 여행지 관리) | `screen-admin.md` |
| Legal pages (이용약관 · 개인정보처리방침) | `screen-legal.md` |
| Consent gate (약관 동의) | `screen-consent.md` |
| Flight (OCR + manual) | `flight.md` |
| Transport (기타 교통편: 기차 · 버스 · 선박) | `transport.md` |
| Lodging | `lodging.md` |
| Trip import / Trip export | `trip-import.md` / `trip-export.md` |
| Invite | `invite.md` |
| Day map, inter-item distance, icon size | `day-map.md` |
| Google Maps wrapper | `google-maps.md` |
| Permission prompts (camera/location) | `permission-prompts.md` |
| AI analysis notice | `ai-notice.md` |
| Members (currently unmounted) | `members.md` |
| Routing / Data layer / Auth | `routing.md` / `data-layer.md` / `auth.md` |
| Mobile wrapper (Capacitor) | `mobile-capacitor.md` |
| Color policy methodology | `color-policy.md` |

Server-side (migrations, Edge Functions): **`supabase/CLAUDE.md`**. Deploy details: **`docs/deploy.md`**. Testing notes: **`docs/testing.md`**.

---
- 기능별 명세는 `docs/prd/` 참고. 해당 기능을 작업하기 전에 관련 PRD를 먼저 읽을 것.
- 스키마는 `supabase/migrations/`가 원본.
- 기능 작업을 끝내도 이 파일에 상세를 추가하지 말고 `docs/features/`에만 기록할 것 (CLAUDE.md는 1만 자 이내 유지).
