# Data (storage.js)

> CLAUDE.md에서 이동된 상세 내용. 이 영역을 작업하기 전에 먼저 읽을 것.

### Data (`storage.js`)

Trips and schedule items live in **Supabase** (`supabase/migrations/001`, `002`; `003` and `004` are optional/feature-specific, see **Server**). Without the tables every call fails with the Korean message "서버에 데이터 테이블이 아직 없어요…".

- **Reads** are synchronous from an in-memory cache: `getAllTrips`, `getTripById`, `getTrip`, `getItems`, `getItemById`. The cache is filled from the server:
  - `refreshTrips({ maxAgeMs })` selects `trips` with `trip_members!inner(role)` filtered by `trip_members.user_id = me`, i.e. every trip I belong to, invited ones included (`Trip.role` is `owner | editor`, `Trip.userId` is `owner_id`). With `maxAgeMs` it skips the request if the list was fetched that recently (the app start plus the main page's enter would otherwise fetch twice).
  - `loadItems(tripId)` selects that trip's `schedule_items`. `isTripsLoaded()` / `isItemsLoaded(id)` tell whether a first load happened.
- **Writes** are async and must be awaited: `createTrip` (inserts with `owner_id = session user`; a DB trigger adds the owner to `trip_members`), `saveTrip` (update; owner only, RLS returns 0 rows for an editor), `deleteTrip` (owner only, children cascade), `leaveTrip` (deletes my own `trip_members` row; needs 004), `addItem` / `updateItem` (patch fields only) / `deleteItem`, `loadMembers`, `removeMember`.
  - They update the cache from the server's response and throw an `Error` with a Korean message (`fail()` maps PGRST205 / 42501 / etc.) that callers show (form error line or `ui.showToast`). Modals stay open on failure so input isn't lost.
  - Ids are server-generated uuids.
- **Current trip**: pages set it with `setCurrentTrip(id)` (the router guard does this from the `:id`, looking only in the cache, so `app.js` calls `storage.refreshTrips()` after `auth.init()` and before `router.start()` so a direct `#/my-trip/:id` URL resolves); `getTrip()` returns it.
- **Cache safety**: `storage.onChange(fn)` fires whenever the trip cache is replaced or cleared (`mainPage.js` re-renders on it). `syncUser()` (called from `auth.onChange`) drops the cache and reloads when the signed-in user changed; `clearCache()` runs on sign-out, so one account never sees another's cached data.
- **Schedule loading**: `app.js#enterSchedule` (schedule route `onEnter`) shows "일정을 불러오는 중이에요..." for a trip whose items were never loaded, otherwise draws the cache and refreshes behind it. `mainPage.js` refreshes the list on every enter.
- **Not signed in** (`file://` or `requireLogin: false`): nothing can be loaded or saved; writes throw "로그인이 필요해요".
- **Photos**: still IndexedDB (`images.js`); only the item-id → image-ids map lives in localStorage `triplog.itemImages` (no photo column on `schedule_items`), so photos are not visible on other devices or to invited members.
- **Old data**: the old localStorage keys (`triplog.trips`, `triplog.items`, `triplog.trip`) are deliberately left untouched and never read or migrated (personal test data). `storage.js` only deletes the ancient `triplog.user` key at load; the old fixed mock user (`storage.getUser()/isLoggedIn()`) and `adoptUnownedTrips` are gone. The signed-in user comes from `auth.js`; without a name the UI falls back to "여행자".
- **Item types**: a plain item has `date/time/place/lat/lng/memo/images/sortOrder`.
  - `time` (optional, `field-time` in the add/edit form, an `<input type="time">`) writes straight to `schedule_items.time` — that column predates the current item shape (see the `title`/`time`/`category` note below) but was never written to until this; `rowToItem` already read it as a legacy fallback, so no migration was needed to start using it for real. Displayed as `.item-time` under the title (`app.js#renderItemCard`, `HH:MM`, skipped for flights since their time is already in the summary line).
  - `sortOrder` (integer, only meaningful among items sharing the same `trip_id`+`date` — see **Timeline reorder & swipe-delete**) is read from `schedule_items.sort_order` (008_schedule_item_order.sql) with a `0` fallback when that column doesn't exist yet, so reading/adding/editing items never breaks on a server that hasn't run 008 — only persisting a *new* order (`storage.reorderItems`) needs it and fails gracefully (toast + revert) until then.
  - A flight item is the same record with an extra `item.flight` object plus `category: "flight"`, `airline` (= `flight.airlineName`) and `flightNo`, copies written to the server columns `category`, `airline`, `flight_no` (002 must have been run, or saving a flight fails with "테이블 구조가 앱과 달라요"). No ticket-photo data is ever stored on an item.
  - Items are mapped from `schedule_items` rows in `storage.js#rowToItem`. The server column `title` may still carry a value from the old PRD-era schema; `renderItemCard` and the sort key in `app.js` fall back to it, so keep that fallback when changing the item shape.
