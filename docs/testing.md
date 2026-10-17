# Testing notes

> CLAUDE.md에서 이동된 상세 내용. 이 영역을 작업하기 전에 먼저 읽을 것.

## Local run / phone testing details

- **Phone testing**: without `--local`, `serve.py` listens on all network interfaces and prints the PC's addresses; a phone opens `http://<PC address>:8080/`.
  - Trips and items live in Supabase, so signing in with the same account shows the same trips (only photos stay per browser).
  - Over plain HTTP on a non-localhost address the page is not a secure context, so `crypto.randomUUID` is missing; keep the `generateId` fallback (`images.js` uses it).
  - This PC has a public IPv4 address (the Ethernet adapter gets it by DHCP, so it can change): stop the server when done or use `--local`. A `--local` server listens on 127.0.0.1 only and is unreachable from a phone.
- **Cache**: `serve.py` sends `Cache-Control: no-store` (unlike `python -m http.server`). A tab loaded before that may hold stale files: hard-reload (Ctrl+Shift+R), or from automation run `await fetch(url, {cache: 'reload'})` for each changed file and then `location.reload()`.

## Testing notes

- In the browser tool, resizing the window does not change the page viewport (it stays 1920px wide). To test 360px or 1440px layouts, open a same-origin page and put the app in an `<iframe style="width:360px">`; media queries follow the iframe width.
- UI changes are verified by driving the app in a real browser. In the user's own Chrome profile the app is signed in and holds real trips: create and delete only your own test data (delete a test trip by its id, e.g. `TripLog.supabase.from('trips').delete().eq('id', id)`, which also removes its items, invites and members); never bulk-filter, bulk-delete or leave the user's real trips (a real leave/kick cannot be undone without a new invite).
- `storage.js` caches trips and items in memory. If a test changes data behind the app's back (direct Supabase calls or `localStorage`), call `TripLog.storage.refreshTrips()` / reload; otherwise the cache is stale.
- Google-dependent tests (day map, map picker, lodging search) fail on `http://localhost:8080` with "키 인증 실패" unless that origin is in the Maps key's referrer list; the deployed domain works. In a background tab timers are throttled and scroll events / `OverlayView.onAdd` do not run until a frame is rendered, so map tests need `window.dispatchEvent(new Event("scroll"))` and a screenshot to force frames.
- When testing the clipboard from automation the page may have no focus, so `navigator.clipboard` calls can hang or reject ("Document is not focused"); that is not an app bug.
- Two-account flows (invite acceptance, kicking, leaving) cannot be driven from one browser session. RLS and the SQL functions were tested against a real Postgres (PGlite in Node with a stubbed `auth` schema and roles); do the same for new policies before asking the user to run them.
