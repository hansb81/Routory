// @별칭 STORAGE · 여행·일정·멤버 저장/조회 (서버)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 여행·일정 데이터를 Supabase(Postgres)에 저장/조회하는 모듈 (예전에는 localStorage를 썼다)
// 빌드 도구 없이 index.html을 파일로 직접 열어도 동작해야 하므로(file:// 프로토콜에서는
// ES 모듈 간 import가 CORS로 막힘) ES 모듈 대신 전역 네임스페이스(window.TripLog)를 사용한다.
//
// 구조: 화면 코드가 여기저기서 동기로 getTrip()/getItems()를 부르므로, 읽기는 메모리 캐시에서 동기로 하고
// 캐시는 서버에서 불러와 채운다(refreshTrips, loadItems). 쓰기(createTrip/saveTrip/addItem/updateItem/deleteItem)는
// 서버에 저장한 뒤 그 결과로 캐시를 고치고, 실패하면 Error(한국어 메시지)를 던진다. 그러니 쓰기 함수는 await 해야 한다.
//
// 테이블(supabase/migrations/001, 002): trips, schedule_items, trip_members, trip_invites. 접근 제어는 서버의 RLS가 맡는다.
//   내 여행 목록 = trip_members에 내가 있는 여행 (초대받아 들어온 여행 포함), Trip.role = 그 여행에서의 내 역할(owner | editor)
//   Trip.userId = trips.owner_id (여행을 만든 사람)
//
// 브라우저에만 두는 것: 일정에 붙인 사진은 IndexedDB(images.js)에 있고, 일정 id → 사진 id 목록만 localStorage(triplog.itemImages)에
//   둔다(서버 schedule_items에는 사진 컬럼이 없다). 그래서 사진은 다른 기기나 초대받은 사람에게는 보이지 않는다.
//
// 예전 localStorage 데이터(triplog.trips, triplog.items, triplog.trip)는 읽지도 지우지도 않고 그대로 둔다 (옮기지 않는다).
//
// user_consents(010_user_consents.sql, 사용자당 한 행)도 같은 "동기 읽기 + 비동기 refresh" 모양을 따른다:
// refreshConsent()가 로그인한 사용자의 행을 받아 캐시하고, hasConsent()가 그 캐시를 동기로 돌려준다
// (app.js의 라우터 가드가 동기 함수만 쓸 수 있어서다) - consentPage.js/app.js 참고.
// notification_settings(031_push_notifications.sql, 사용자당 한 행)도 같은 모양(loadNotificationSettings/
// getNotificationSettings/saveNotificationSettings) - commonPages.js의 설정 화면 "알림" 섹션 참고.

(function () {
  const supabase = window.TripLog.supabase;
  const auth = window.TripLog.auth;

  const IMAGE_MAP_KEY = "triplog.itemImages";

  // 메모리 캐시
  let tripsCache = [];
  let tripsLoaded = false; // 서버에서 여행 목록을 한 번이라도 받았는가
  let itemsCache = []; // 불러온 여행들의 일정 (item.tripId로 구분)
  const itemsLoadedTrips = new Set(); // 일정을 불러온 여행 id
  let cacheUserId = null; // 캐시가 누구의 데이터인가
  let tripsRequestId = 0; // 늦게 도착한 응답이 새 응답이나 다른 사용자의 캐시를 덮어쓰지 않게 하는 번호
  let tripsFetchedAt = 0; // 여행 목록을 마지막으로 서버에서 받은 시각 (ms)
  let expensesCache = []; // 불러온 여행들의 지출 (expense.tripId로 구분)
  const expensesLoadedTrips = new Set(); // 지출을 불러온 여행 id
  const expensesRequestIds = new Map();
  const itemsRequestIds = new Map();
  let walletItemsCache = []; // 불러온 여행들의 지갑 문서 (item.tripId로 구분, expensesCache와 같은 모양)
  const walletItemsLoadedTrips = new Set(); // 지갑 문서를 불러온 여행 id
  const walletItemsRequestIds = new Map();
  let checklistCache = []; // 불러온 여행들의 체크리스트 항목 (item.tripId로 구분, expensesCache와 같은 모양)
  const checklistLoadedTrips = new Set(); // 체크리스트를 불러온 여행 id
  const checklistRequestIds = new Map();
  let checklistCategoriesCache = []; // 불러온 여행들의 체크리스트 카테고리 (category.tripId로 구분, checklistCache와 같은 모양)
  const checklistCategoriesLoadedTrips = new Set();
  const checklistCategoriesRequestIds = new Map();
  let consentCache = null; // 로그인한 사용자의 user_consents 행 (없으면 null - 아직 한 번도 동의하지 않았다는 뜻)
  let consentLoaded = false; // 서버에 한 번이라도 성공적으로 확인했는가 (hasConsent()의 기본값을 가르는 플래그, 아래 참고)
  let consentRequestId = 0;
  let notificationSettingsCache = { scheduleEnabled: true, shareEnabled: true }; // 행이 없으면 기본값(켜짐) - 031_push_notifications.sql의 컬럼 기본값과 같다
  let notificationSettingsLoaded = false;
  let notificationSettingsRequestId = 0;

  // 지금 보고 있는 여행의 id. 화면(라우트)이 정하며 저장하지 않는다. getTrip()이 이 여행을 돌려준다.
  let currentTripId = null;

  const listeners = new Set();
  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.warn("[storage] onChange 콜백 오류", err);
      }
    });
  }

  // 여행 목록 캐시가 바뀔 때(서버에서 새로 받았거나 비웠을 때) 부른다. 해제 함수를 돌려준다.
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- 오류 ----

  // 서버 오류를 사용자에게 보여줄 수 있는 Error로 바꾼다 (원래 오류는 콘솔에 남긴다)
  function fail(error, what) {
    console.warn(`[storage] ${what} 실패`, error);
    const code = error?.code;
    let message = "서버와 통신하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.";
    if (code === "PGRST205" || code === "42P01" || code === "PGRST202") {
      message = "서버에 데이터 테이블이 아직 없어요. supabase/migrations의 SQL을 먼저 실행해주세요.";
    } else if (code === "42501") {
      message = "이 작업을 할 권한이 없어요.";
    } else if (code === "PGRST204" || code === "42703") {
      message = "서버 테이블 구조가 앱과 달라요. supabase/migrations의 SQL을 모두 실행했는지 확인해주세요.";
    } else if (code === "NoSuchBucket") {
      // Storage(파일 저장소) 쪽 오류는 PostgREST와 형태가 달라서(code가 "NoSuchBucket" 같은 문자열), 위의 테이블
      // 오류 코드들과 따로 확인한다. wallet 버킷을 아직 안 만들었을 때 나는 오류다 (006_wallet.sql 안내 참고).
      message = "저장 공간(Storage 버킷)이 아직 없어요. Supabase 대시보드에서 먼저 만들어주세요.";
    } else if (code === "Unauthorized" || code === "invalid_jwt") {
      message = "이 파일을 다룰 권한이 없어요. 로그인이 풀렸다면 다시 로그인해주세요.";
    }
    const err = new Error(message);
    err.cause = error;
    return err;
  }

  function requireUserId() {
    const userId = auth?.getUserId() ?? null;
    if (!userId) throw new Error("로그인이 필요해요. 로그인한 뒤 다시 시도해주세요.");
    return userId;
  }

  // ---- 사진 id (브라우저에만 저장) ----

  function readImageMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_MAP_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writeImageIds(itemId, ids) {
    try {
      const map = readImageMap();
      if (ids && ids.length) map[itemId] = ids;
      else delete map[itemId];
      localStorage.setItem(IMAGE_MAP_KEY, JSON.stringify(map));
    } catch (err) {
      console.warn("[storage] 사진 목록 저장 실패", err);
    }
  }

  // ---- 서버 행 ↔ 앱 객체 ----

  function rowToTrip(row) {
    const members = Array.isArray(row.trip_members) ? row.trip_members : [];
    return {
      id: row.id,
      userId: row.owner_id,
      title: row.title,
      destination: row.destination ?? "",
      cityId: row.city_id ?? undefined,
      destinationId: row.destination_id ?? undefined,
      timezone: row.timezone ?? undefined,
      lat: typeof row.lat === "number" ? row.lat : undefined,
      lng: typeof row.lng === "number" ? row.lng : undefined,
      currency: row.currency ?? undefined,
      startDate: row.start_date,
      endDate: row.end_date,
      createdAt: row.created_at,
      role: members[0]?.role ?? (row.owner_id === cacheUserId ? "owner" : "editor"),
    };
  }

  function rowToItem(row, imageMap) {
    const item = {
      id: row.id,
      tripId: row.trip_id,
      date: row.date,
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0, // 같은 날짜 안에서만 의미 있는 순서 (008_schedule_item_order.sql)
      place: row.place ?? "",
      lat: typeof row.lat === "number" ? row.lat : null,
      lng: typeof row.lng === "number" ? row.lng : null,
      memo: row.memo ?? "",
      images: Array.isArray(imageMap[row.id]) ? imageMap[row.id] : [],
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.flight) {
      item.flight = row.flight;
      item.category = row.category ?? "flight";
      item.airline = row.airline ?? row.flight.airlineName ?? null;
      item.flightNo = row.flight_no ?? row.flight.flightNo ?? null;
    }
    if (row.lodging) item.lodging = row.lodging;
    if (row.transport) item.transport = row.transport; // 기차/버스/선박/기타 (013_transport_items.sql), transportForm.js가 읽고 쓴다
    // time: 시간 입력 기능(schedule.js#field-time)이 실제로 쓰는 컬럼 — "HH:MM:SS"(Postgres time 타입)로 온다.
    // title: 예전 버전이 남긴 필드 (renderItemCard가 place 없을 때의 대체값으로 쓴다)
    if (row.title) item.title = row.title;
    if (row.time) item.time = row.time;
    if (row.category && !item.category) item.category = row.category;
    return item;
  }

  // 항공편 일정은 category "flight"와 항공사 이름(airline)·편명(flightNo)을 item.flight와 별도로 한 번 더 가진다 (서버 컬럼 category, airline, flight_no).
  // 항공권 사진 관련 값은 넣지 않는다.
  function flightColumns(flight) {
    return flight ? { category: "flight", airline: flight.airlineName ?? null, flight_no: flight.flightNo ?? null } : {};
  }

  // expenses 행 → 화면이 쓰는 지출 객체. amount/krw_amount는 PostgREST가 문자열로 줄 수도 있어 숫자로 바꿔 둔다.
  function rowToExpense(row) {
    return {
      id: row.id,
      tripId: row.trip_id,
      dayKey: row.day_key,
      amount: Number(row.amount),
      currency: row.currency,
      krwAmount: row.krw_amount == null ? null : Number(row.krw_amount),
      paymentMethod: row.payment_method ?? null,
      title: row.title,
      category: row.category,
      payerIds: Array.isArray(row.payer_ids) ? row.payer_ids : [],
      splitIds: Array.isArray(row.split_ids) ? row.split_ids : [],
      memo: row.memo ?? "",
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ---- 캐시 관리 ----

  function clearCache() {
    tripsRequestId += 1;
    itemsRequestIds.clear();
    tripsCache = [];
    tripsLoaded = false;
    tripsFetchedAt = 0;
    itemsCache = [];
    itemsLoadedTrips.clear();
    expensesCache = [];
    expensesLoadedTrips.clear();
    expensesRequestIds.clear();
    walletItemsCache = [];
    walletItemsLoadedTrips.clear();
    walletItemsRequestIds.clear();
    consentCache = null;
    consentLoaded = false;
    consentRequestId += 1;
    currentTripId = null;
    cacheUserId = null;
    notify();
  }

  // ---- Trip ----

  // 서버에서 내 여행 목록을 다시 받아 캐시를 바꾼다: 내가 trip_members에 들어 있는(초대받은 것 포함) 모든 여행.
  // 로그인하지 않았으면 캐시를 비우고 빈 목록을 돌려준다.
  // maxAgeMs를 주면 그 시간 안에 받은 목록이 있을 때 서버에 다시 묻지 않고 캐시를 돌려준다 (앱 시작 직후 메인 화면이 또 받는 것을 막는다).
  async function refreshTrips({ maxAgeMs = 0 } = {}) {
    const userId = auth?.getUserId() ?? null;
    if (!userId) {
      clearCache();
      return [];
    }
    if (cacheUserId && cacheUserId !== userId) clearCache(); // 다른 계정으로 바뀌었으면 이전 사용자의 데이터를 버린다
    if (maxAgeMs > 0 && tripsLoaded && cacheUserId === userId && Date.now() - tripsFetchedAt < maxAgeMs) return getAllTrips();
    cacheUserId = userId;

    const requestId = ++tripsRequestId;
    const { data, error } = await supabase
      .from("trips")
      .select("*, trip_members!inner(role)")
      .eq("trip_members.user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw fail(error, "여행 목록 불러오기");
    if (requestId !== tripsRequestId) return getAllTrips(); // 더 새로운 요청이나 로그아웃이 있었다

    tripsCache = (data ?? []).map(rowToTrip);
    tripsLoaded = true;
    tripsFetchedAt = Date.now();
    // 지금 보던 여행이 목록에서 사라졌으면(강퇴 등) 현재 여행을 비운다
    if (currentTripId && !tripsCache.some((t) => t.id === currentTripId)) currentTripId = null;
    notify();
    return getAllTrips();
  }

  // 로그인한 사용자가 캐시의 주인과 다르면(계정 전환, 로그아웃) 캐시를 버리고 새로 받는다. 같으면 아무것도 하지 않는다.
  async function syncUser() {
    const userId = auth?.getUserId() ?? null;
    if (!userId) {
      if (cacheUserId || tripsLoaded) clearCache();
      return;
    }
    if (cacheUserId !== userId) await refreshTrips();
  }

  // 캐시에 있는 모든 여행 (돌려주는 배열을 고쳐도 캐시에는 영향이 없다)
  function getAllTrips() {
    return [...tripsCache];
  }

  const isTripsLoaded = () => tripsLoaded;

  function getTripById(id) {
    return tripsCache.find((trip) => trip.id === id) ?? null;
  }

  // 지금 보고 있는 여행으로 정한다. 캐시에 그런 여행이 없으면 현재 여행을 비우고 false를 돌려준다.
  function setCurrentTrip(id) {
    const exists = Boolean(id) && Boolean(getTripById(id));
    currentTripId = exists ? id : null;
    return exists;
  }

  // 지금 보고 있는 여행 (setCurrentTrip으로 정한 여행). 없으면 null.
  function getTrip() {
    return currentTripId ? getTripById(currentTripId) : null;
  }

  function upsertTripCache(trip) {
    const index = tripsCache.findIndex((t) => t.id === trip.id);
    if (index === -1) tripsCache.push(trip);
    else tripsCache[index] = trip;
  }

  // 새 여행을 저장한다. 만든 사람(owner_id)을 함께 저장하고, 서버 트리거가 그 사람을 trip_members에 owner로 넣는다.
  // destinationId/timezone/lat/lng/currency는 PRD v12(여행지 확장) 이후 해외 도시를 고르면 같이 오는 값 -
  // 없으면(국내, 또는 옛 방식) null로 둔다. destination/cityId(문자열) 필드는 그대로 같이 채워서 기존
  // 기능이 안 깨지게 한다.
  async function createTrip({ title, destination, cityId, destinationId, timezone, lat, lng, currency, startDate, endDate }) {
    const userId = requireUserId();
    const { data, error } = await supabase
      .from("trips")
      .insert({
        owner_id: userId,
        title,
        destination,
        city_id: cityId ?? null,
        destination_id: destinationId ?? null,
        timezone: timezone ?? null,
        lat: lat ?? null,
        lng: lng ?? null,
        currency: currency ?? null,
        start_date: startDate,
        end_date: endDate,
      })
      .select()
      .single();
    if (error) throw fail(error, "여행 만들기");

    cacheUserId = userId;
    const trip = { ...rowToTrip(data), role: "owner" };
    upsertTripCache(trip);
    notify();
    return trip;
  }

  // 여행 정보를 고친다 (제목·여행지·날짜). RLS상 owner만 고칠 수 있다.
  async function saveTrip(trip) {
    if (!trip?.id || !getTripById(trip.id)) throw new Error("수정할 여행을 찾을 수 없어요.");
    const { data, error } = await supabase
      .from("trips")
      .update({
        title: trip.title,
        destination: trip.destination,
        city_id: trip.cityId ?? null,
        destination_id: trip.destinationId ?? null,
        timezone: trip.timezone ?? null,
        lat: trip.lat ?? null,
        lng: trip.lng ?? null,
        currency: trip.currency ?? null,
        start_date: trip.startDate,
        end_date: trip.endDate,
      })
      .eq("id", trip.id)
      .select();
    if (error) throw fail(error, "여행 수정");
    if (!data || data.length === 0) throw new Error("여행을 수정할 수 있는 사람은 여행을 만든 사람뿐이에요.");

    const saved = { ...rowToTrip(data[0]), role: getTripById(trip.id)?.role ?? "owner" };
    upsertTripCache(saved);
    notify();
    return saved;
  }

  // 여행을 지운다 (서버에서 그 여행의 일정·초대·멤버도 함께 지워진다). RLS상 여행을 만든 사람(owner)만 지울 수 있다.
  // 019_wallet_trip_required.sql부터 wallet_items.trip_id가 cascade라서, 이 여행에 연결된 지갑 문서 행도
  // (다른 멤버가 올린 것까지 포함해) 서버에서 함께 지워진다 — 하지만 Storage의 실제 파일은 FK cascade가
  // 닿지 않는 별도 영역이라 따로 지워야 한다. 그중 "내가 올린 파일"만은 지우기 전에 미리 목록을 받아 두고
  // (트립 행이 지워지면 그 wallet_items 행도 같이 지워져서 나중엔 경로를 알 수 없다) best-effort로 지운다 -
  // 다른 멤버가 올린 개인 문서의 파일까지는 내 권한(Storage RLS)으로 지울 수 없어 고아로 남을 수 있다
  // (delete-account 함수의 "DB 행 삭제가 기준, Storage 정리는 best-effort" 원칙과 같다).
  async function deleteTrip(id) {
    const userId = requireUserId();
    const { data: myWalletFiles } = await supabase.from("wallet_items").select("file_url").eq("trip_id", id).eq("user_id", userId);

    const { data, error } = await supabase.from("trips").delete().eq("id", id).select("id");
    if (error) throw fail(error, "여행 삭제");
    if (!data || data.length === 0) throw new Error("여행을 삭제하지 못했어요. 여행을 만든 사람만 삭제할 수 있어요.");

    if (myWalletFiles?.length) {
      await supabase.storage.from("wallet").remove(myWalletFiles.map((row) => row.file_url)).catch(() => {});
    }

    tripsCache = tripsCache.filter((t) => t.id !== id);
    for (const item of itemsCache) if (item.tripId === id) writeImageIds(item.id, []);
    itemsCache = itemsCache.filter((item) => item.tripId !== id);
    itemsLoadedTrips.delete(id);
    itemsRequestIds.delete(id);
    expensesCache = expensesCache.filter((expense) => expense.tripId !== id);
    expensesLoadedTrips.delete(id);
    expensesRequestIds.delete(id);
    walletItemsCache = walletItemsCache.filter((item) => item.tripId !== id);
    walletItemsLoadedTrips.delete(id);
    walletItemsRequestIds.delete(id);
    checklistCache = checklistCache.filter((item) => item.tripId !== id);
    checklistLoadedTrips.delete(id);
    checklistRequestIds.delete(id);
    checklistCategoriesCache = checklistCategoriesCache.filter((cat) => cat.tripId !== id);
    checklistCategoriesLoadedTrips.delete(id);
    checklistCategoriesRequestIds.delete(id);
    if (currentTripId === id) currentTripId = null;
    notify();
  }

  // 초대받아 참여한 여행에서 스스로 나간다 (내 trip_members 행만 지운다). 여행을 만든 사람은 나갈 수 없고 삭제만 할 수 있다.
  // 서버 정책 "참여자는 스스로 나가기"(migrations/004)가 있어야 지워진다. 그 여행의 일정은 서버에 그대로 남는다.
  async function leaveTrip(id) {
    const userId = requireUserId();
    const trip = getTripById(id);
    if (trip?.role === "owner") throw new Error("여행을 만든 사람은 나갈 수 없어요. 대신 여행을 삭제할 수 있어요.");

    const { data, error } = await supabase.from("trip_members").delete().eq("trip_id", id).eq("user_id", userId).select("user_id");
    if (error) throw fail(error, "여행 나가기");
    if (!data || data.length === 0) {
      throw new Error("여행에서 나가지 못했어요. 이미 나간 여행이거나, 서버에 '여행 나가기' 설정(supabase/migrations/004)이 아직 없어요.");
    }

    tripsCache = tripsCache.filter((t) => t.id !== id);
    for (const item of itemsCache) if (item.tripId === id) writeImageIds(item.id, []);
    itemsCache = itemsCache.filter((item) => item.tripId !== id);
    itemsLoadedTrips.delete(id);
    itemsRequestIds.delete(id);
    expensesCache = expensesCache.filter((expense) => expense.tripId !== id);
    expensesLoadedTrips.delete(id);
    expensesRequestIds.delete(id);
    if (currentTripId === id) currentTripId = null;
    notify();
  }

  // ---- 지출(Expense) ----
  // 지금은 읽기(loadExpenses/getExpenses)만 있다. 추가·수정·삭제는 "비용 추가" 폼을 만들 때 여기에 더한다
  // (addItem/updateItem/deleteItem과 같은 모양으로 만들면 된다).

  // 한 여행의 지출을 서버에서 다시 받아 캐시에 넣는다 (그 여행의 예전 캐시는 바꿔치기). loadItems와 같은 방식.
  async function loadExpenses(tripId) {
    if (!tripId) return [];
    const requestId = (expensesRequestIds.get(tripId) ?? 0) + 1;
    expensesRequestIds.set(tripId, requestId);
    const ownerAtStart = cacheUserId;

    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });
    if (error) throw fail(error, "지출 불러오기");
    if (expensesRequestIds.get(tripId) !== requestId || ownerAtStart !== cacheUserId) return getExpensesOfTrip(tripId);

    expensesCache = [...expensesCache.filter((expense) => expense.tripId !== tripId), ...(data ?? []).map(rowToExpense)];
    expensesLoadedTrips.add(tripId);
    return getExpensesOfTrip(tripId);
  }

  const isExpensesLoaded = (tripId) => expensesLoadedTrips.has(tripId);

  function getExpensesOfTrip(tripId) {
    return expensesCache.filter((expense) => expense.tripId === tripId);
  }

  // 캐시에 있는 모든 지출 (여행별로 걸러 쓰려면 expense.tripId를 본다, getItems와 같은 방식)
  function getExpenses() {
    return expensesCache;
  }

  // 지출을 하나 추가한다. krwAmount·paymentMethod·category·payerIds·splitIds·memo는 호출한 쪽(expenseForm.js)이
  // 미리 계산해서 넘긴다 — storage.js는 통화·카테고리를 모르는 얇은 저장 계층이라서 (addItem이 flight 계산을
  // flight.js에 맡기는 것과 같다).
  async function addExpense({ tripId, dayKey, amount, currency, krwAmount, paymentMethod, title, category, payerIds, splitIds, memo }) {
    if (!tripId) throw new Error("지출을 넣을 여행을 찾을 수 없어요.");
    requireUserId();
    const { data, error } = await supabase
      .from("expenses")
      .insert({
        trip_id: tripId,
        day_key: dayKey,
        amount,
        currency,
        krw_amount: typeof krwAmount === "number" ? krwAmount : null,
        payment_method: paymentMethod ?? null,
        title,
        category,
        payer_ids: payerIds ?? [],
        split_ids: splitIds ?? [],
        memo: memo || null,
      })
      .select()
      .single();
    if (error) throw fail(error, "지출 저장");

    const expense = rowToExpense(data);
    expensesCache.push(expense);
    return expense;
  }

  // patch에 들어 있는 필드만 고친다 (schedule.js의 updateItem과 같은 방식). trip_id는 바꾸지 않는다.
  async function updateExpense(id, patch) {
    const columns = {};
    if ("dayKey" in patch) columns.day_key = patch.dayKey;
    if ("amount" in patch) columns.amount = patch.amount;
    if ("currency" in patch) columns.currency = patch.currency;
    if ("krwAmount" in patch) columns.krw_amount = typeof patch.krwAmount === "number" ? patch.krwAmount : null;
    if ("paymentMethod" in patch) columns.payment_method = patch.paymentMethod ?? null;
    if ("title" in patch) columns.title = patch.title;
    if ("category" in patch) columns.category = patch.category;
    if ("payerIds" in patch) columns.payer_ids = patch.payerIds ?? [];
    if ("splitIds" in patch) columns.split_ids = patch.splitIds ?? [];
    if ("memo" in patch) columns.memo = patch.memo || null;

    const { data, error } = await supabase.from("expenses").update(columns).eq("id", id).select();
    if (error) throw fail(error, "지출 수정");
    if (!data || data.length === 0) throw new Error("지출을 수정하지 못했어요. 이미 지워졌거나 수정할 권한이 없어요.");

    const updated = rowToExpense(data[0]);
    expensesCache = expensesCache.map((expense) => (expense.id === id ? updated : expense));
    return updated;
  }

  // 지웠으면 true. 서버에서 이미 없거나 지울 권한이 없어서 지워진 행이 없으면 false. deleteItem과 같은 모양.
  async function deleteExpense(id) {
    const { data, error } = await supabase.from("expenses").delete().eq("id", id).select("id");
    if (error) throw fail(error, "지출 삭제");
    expensesCache = expensesCache.filter((expense) => expense.id !== id);
    return Boolean(data && data.length);
  }

  // ---- 체크리스트(ChecklistCategory, ChecklistItem) ----
  // expenses(가계부)와 같은 "그 여행 멤버면 서로의 항목도 보고 고친다" 공유 모델, 같은 캐시 모양.
  // 카테고리도 trip마다 따로 있는 행(checklist_categories)이라 항목과 똑같이 불러오고 캐시한다 - "+"로
  // 추가하거나 스와이프로 지울 수 있다(지우면 그 안의 항목도 서버에서 on delete cascade로 같이 지워지므로
  // deleteChecklistCategory가 캐시에서도 항목을 같이 걷어낸다). 기본 카테고리·항목 시딩(ensureChecklistSeeded)만
  // 이 기능 고유의 것 - checklist_seeds 마커 테이블(038_checklist.sql) 설명 참고.

  function rowToChecklistCategory(row) {
    return {
      id: row.id,
      tripId: row.trip_id,
      label: row.label,
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0, // 같은 trip_id 안에서만 의미 있는 순서 (카테고리 나열 순서)
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
    };
  }

  async function loadChecklistCategories(tripId) {
    if (!tripId) return [];
    const requestId = (checklistCategoriesRequestIds.get(tripId) ?? 0) + 1;
    checklistCategoriesRequestIds.set(tripId, requestId);
    const ownerAtStart = cacheUserId;

    const { data, error } = await supabase
      .from("checklist_categories")
      .select("*")
      .eq("trip_id", tripId)
      .order("sort_order", { ascending: true });
    if (error) throw fail(error, "체크리스트 카테고리 불러오기");
    if (checklistCategoriesRequestIds.get(tripId) !== requestId || ownerAtStart !== cacheUserId) return getChecklistCategoriesOfTrip(tripId);

    checklistCategoriesCache = [...checklistCategoriesCache.filter((cat) => cat.tripId !== tripId), ...(data ?? []).map(rowToChecklistCategory)];
    checklistCategoriesLoadedTrips.add(tripId);
    return getChecklistCategoriesOfTrip(tripId);
  }

  const isChecklistCategoriesLoaded = (tripId) => checklistCategoriesLoadedTrips.has(tripId);

  function getChecklistCategoriesOfTrip(tripId) {
    return checklistCategoriesCache.filter((cat) => cat.tripId === tripId);
  }

  function getChecklistCategories() {
    return checklistCategoriesCache;
  }

  // 카테고리를 하나 추가한다("+" 버튼). sortOrder는 그 여행의 캐시 기준 마지막 순번 + 1 - 항상 맨 끝에 붙는다.
  async function addChecklistCategory({ tripId, label }) {
    if (!tripId) throw new Error("카테고리를 넣을 여행을 찾을 수 없어요.");
    requireUserId();
    const siblings = checklistCategoriesCache.filter((cat) => cat.tripId === tripId);
    const nextOrder = siblings.length ? Math.max(...siblings.map((cat) => cat.sortOrder)) + 1 : 0;
    const { data, error } = await supabase
      .from("checklist_categories")
      .insert({ trip_id: tripId, label, sort_order: nextOrder })
      .select()
      .single();
    if (error) throw fail(error, "체크리스트 카테고리 추가");

    const category = rowToChecklistCategory(data);
    checklistCategoriesCache.push(category);
    return category;
  }

  // 카테고리를 지운다(스와이프 삭제, 확인창을 거친 뒤 호출됨) - 서버에서 그 안의 항목도 on delete cascade로
  // 함께 지워지므로, 캐시에서도 그 category_id를 가진 항목을 같이 걷어낸다.
  async function deleteChecklistCategory(id) {
    const { data, error } = await supabase.from("checklist_categories").delete().eq("id", id).select("id");
    if (error) throw fail(error, "체크리스트 카테고리 삭제");
    checklistCategoriesCache = checklistCategoriesCache.filter((cat) => cat.id !== id);
    checklistCache = checklistCache.filter((item) => item.categoryId !== id);
    return Boolean(data && data.length);
  }

  function rowToChecklistItem(row) {
    return {
      id: row.id,
      tripId: row.trip_id,
      categoryId: row.category_id,
      title: row.title,
      checked: Boolean(row.checked),
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0, // 같은 trip_id + category_id 안에서만 의미 있는 순서
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // 한 여행의 체크리스트 항목을 서버에서 다시 받아 캐시에 넣는다 (그 여행의 예전 캐시는 바꿔치기). loadExpenses와 같은 방식.
  async function loadChecklistItems(tripId) {
    if (!tripId) return [];
    const requestId = (checklistRequestIds.get(tripId) ?? 0) + 1;
    checklistRequestIds.set(tripId, requestId);
    const ownerAtStart = cacheUserId;

    const { data, error } = await supabase
      .from("checklist_items")
      .select("*")
      .eq("trip_id", tripId)
      .order("sort_order", { ascending: true });
    if (error) throw fail(error, "체크리스트 불러오기");
    if (checklistRequestIds.get(tripId) !== requestId || ownerAtStart !== cacheUserId) return getChecklistItemsOfTrip(tripId);

    checklistCache = [...checklistCache.filter((item) => item.tripId !== tripId), ...(data ?? []).map(rowToChecklistItem)];
    checklistLoadedTrips.add(tripId);
    return getChecklistItemsOfTrip(tripId);
  }

  const isChecklistLoaded = (tripId) => checklistLoadedTrips.has(tripId);

  function getChecklistItemsOfTrip(tripId) {
    return checklistCache.filter((item) => item.tripId === tripId);
  }

  // 캐시에 있는 모든 체크리스트 항목 (여행별로 걸러 쓰려면 item.tripId를 본다, getExpenses와 같은 방식)
  function getChecklistItems() {
    return checklistCache;
  }

  // 항목을 하나 추가한다. sortOrder는 호출한 쪽이 넘기지 않으면 그 여행+카테고리의 캐시 기준 마지막 순번 + 1로 정한다
  // ("+추가하기"로 넣는 새 항목은 항상 그 카테고리의 맨 끝에 붙는다).
  async function addChecklistItem({ tripId, categoryId, title }) {
    if (!tripId) throw new Error("항목을 넣을 여행을 찾을 수 없어요.");
    requireUserId();
    const siblings = checklistCache.filter((item) => item.tripId === tripId && item.categoryId === categoryId);
    const nextOrder = siblings.length ? Math.max(...siblings.map((item) => item.sortOrder)) + 1 : 0;
    const { data, error } = await supabase
      .from("checklist_items")
      .insert({ trip_id: tripId, category_id: categoryId, title, sort_order: nextOrder })
      .select()
      .single();
    if (error) throw fail(error, "체크리스트 항목 추가");

    const item = rowToChecklistItem(data);
    checklistCache.push(item);
    return item;
  }

  // patch에 들어 있는 필드만 고친다 (checked 토글, title 수정, sortOrder 순서 변경 모두 이걸로 한다).
  async function updateChecklistItem(id, patch) {
    const columns = {};
    if ("checked" in patch) columns.checked = Boolean(patch.checked);
    if ("title" in patch) columns.title = patch.title;
    if ("sortOrder" in patch) columns.sort_order = patch.sortOrder;

    const { data, error } = await supabase.from("checklist_items").update(columns).eq("id", id).select();
    if (error) throw fail(error, "체크리스트 항목 수정");
    if (!data || data.length === 0) throw new Error("항목을 수정하지 못했어요. 이미 지워졌거나 수정할 권한이 없어요.");

    const updated = rowToChecklistItem(data[0]);
    checklistCache = checklistCache.map((item) => (item.id === id ? updated : item));
    return updated;
  }

  // 지웠으면 true. 서버에서 이미 없거나 지울 권한이 없어서 지워진 행이 없으면 false. deleteExpense와 같은 모양.
  async function deleteChecklistItem(id) {
    const { data, error } = await supabase.from("checklist_items").delete().eq("id", id).select("id");
    if (error) throw fail(error, "체크리스트 항목 삭제");
    checklistCache = checklistCache.filter((item) => item.id !== id);
    return Boolean(data && data.length);
  }

  // 드래그로 정한 새 순서(한 카테고리 안의 항목 id들, 화면에 보이는 새 순서 그대로)를 서버에 저장한다.
  // reorderItems(schedule_items)와 같은 방식 - 보이는 순서대로 0, 1, 2...를 다시 매겨서 하나씩 저장한다.
  async function reorderChecklistItems(orderedIds) {
    await Promise.all(orderedIds.map((id, index) => updateChecklistItem(id, { sortOrder: index })));
  }

  // 이 여행에 기본 카테고리·항목(checklistCategoryData.DEFAULT_CHECKLIST_CATEGORIES)을 아직 한 번도 깔지
  // 않았으면 깔고 true를, 이미 깔았으면(마커가 있으면) 아무것도 하지 않고 false를 돌려준다.
  // checklist_seeds(trip_id가 기본키)에 먼저 마커를 꽂아서 "내가 지금 심는다"를 선점한다 - 다른 기기/동행자가
  // 거의 동시에 체크리스트를 열어도 기본키 충돌(23505)로 둘 중 하나만 실제로 심는다. 마커를 꽂은 뒤에 카테고리/항목
  // 추가가 실패해도(예: 테이블은 있지만 다른 이유로 insert가 막힌 경우) 마커는 남아 있어 다음에 또 시도하지
  // 않는다 - loadChecklistItems가 던지는 토스트로 원인을 알려주는 게 조용히 매번 재시도하는 것보다 낫다.
  async function ensureChecklistSeeded(tripId) {
    if (!tripId) return false;
    const { data: existing, error: checkError } = await supabase
      .from("checklist_seeds")
      .select("trip_id")
      .eq("trip_id", tripId)
      .maybeSingle();
    if (checkError) throw fail(checkError, "체크리스트 초기화 확인");
    if (existing) return false;

    const { error: markError } = await supabase.from("checklist_seeds").insert({ trip_id: tripId });
    if (markError) {
      if (markError.code === "23505") return false; // 다른 곳이 거의 동시에 이미 심었다
      throw fail(markError, "체크리스트 초기화");
    }

    const { DEFAULT_CHECKLIST_CATEGORIES } = window.TripLog.checklistCategoryData;
    const { data: catRows, error: catError } = await supabase
      .from("checklist_categories")
      .insert(DEFAULT_CHECKLIST_CATEGORIES.map((cat, index) => ({ trip_id: tripId, label: cat.label, sort_order: index })))
      .select();
    if (catError) throw fail(catError, "체크리스트 기본 카테고리 추가");

    const categories = (catRows ?? []).map(rowToChecklistCategory);
    checklistCategoriesCache = [...checklistCategoriesCache, ...categories];

    // insert가 여러 행 순서를 보장하지 않을 수 있어 index가 아니라 label로 되찾는다 (기본 카테고리는 라벨이 서로 다르다).
    const categoryIdByLabel = new Map(categories.map((cat) => [cat.label, cat.id]));
    const itemRows = DEFAULT_CHECKLIST_CATEGORIES.flatMap((cat) =>
      cat.defaultItems.map((title, index) => ({ trip_id: tripId, category_id: categoryIdByLabel.get(cat.label), title, sort_order: index }))
    );
    const { data, error } = await supabase.from("checklist_items").insert(itemRows).select();
    if (error) throw fail(error, "체크리스트 기본 항목 추가");

    checklistCache = [...checklistCache, ...(data ?? []).map(rowToChecklistItem)];
    return true;
  }

  // ---- ScheduleItem ----

  // 한 여행의 일정을 서버에서 다시 받아 캐시에 넣는다 (그 여행의 예전 캐시는 바꿔치기)
  async function loadItems(tripId) {
    if (!tripId) return [];
    const requestId = (itemsRequestIds.get(tripId) ?? 0) + 1;
    itemsRequestIds.set(tripId, requestId);
    const ownerAtStart = cacheUserId;

    // sort_order로는 서버에 정렬을 맡기지 않는다: 008_schedule_item_order.sql을 아직 실행하지 않은 서버에서는
    // 없는 컬럼을 주문(order by)하면 통째로 실패하기 때문이다. 대신 select("*")는 없는 컬럼도 그냥 undefined로
    // 오므로 안전하고, 실제 정렬은 rowToItem이 채운 sortOrder를 app.js의 정렬 키가 2차 기준으로 쓴다.
    const { data, error } = await supabase
      .from("schedule_items")
      .select("*")
      .eq("trip_id", tripId)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw fail(error, "일정 불러오기");
    if (itemsRequestIds.get(tripId) !== requestId || ownerAtStart !== cacheUserId) return getItemsOfTrip(tripId);

    const imageMap = readImageMap();
    itemsCache = [...itemsCache.filter((item) => item.tripId !== tripId), ...(data ?? []).map((row) => rowToItem(row, imageMap))];
    itemsLoadedTrips.add(tripId);
    return getItemsOfTrip(tripId);
  }

  const isItemsLoaded = (tripId) => itemsLoadedTrips.has(tripId);

  function getItemsOfTrip(tripId) {
    return itemsCache.filter((item) => item.tripId === tripId);
  }

  // 캐시에 있는 모든 일정 (여행별로 걸러 쓰려면 item.tripId를 본다)
  function getItems() {
    return itemsCache;
  }

  function getItemById(id) {
    return itemsCache.find((item) => item.id === id) ?? null;
  }

  // sort_order 컬럼이 아직 없는 서버(008_schedule_item_order.sql 실행 전)인지: PostgREST가 없는 컬럼을
  // 넣거나 정렬 기준으로 쓰면 이 코드로 실패한다. addItem은 이 경우에도 일정 추가 자체(핵심 기능)는 되도록
  // sort_order 없이 한 번 더 시도한다 - 순서 기능은 그 다음에 마이그레이션을 실행하면 자연히 살아난다.
  function isMissingColumn(error) {
    return error?.code === "PGRST204" || error?.code === "42703";
  }

  async function addItem({ tripId, date, time, place, lat, lng, memo, images, flight, lodging, transport }) {
    if (!tripId) throw new Error("일정을 넣을 여행을 찾을 수 없어요.");
    requireUserId();

    const siblingOrders = itemsCache.filter((i) => i.tripId === tripId && i.date === date).map((i) => i.sortOrder ?? 0);
    const nextOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
    const row = {
      trip_id: tripId,
      date,
      time: time || null,
      place: place ?? null,
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      memo: memo ?? null,
      flight: flight ?? null,
      lodging: lodging ?? null,
      ...flightColumns(flight),
    };
    // transport(기타 교통편, 013_transport_items.sql)는 flight/lodging과 달리 처음부터 있던 컬럼이 아니라서,
    // 그 마이그레이션을 아직 돌리지 않은 서버에서도 일반 일정 추가가 깨지지 않도록 값이 있을 때만 키를 넣는다.
    if (transport) row.transport = transport;

    let { data, error } = await supabase.from("schedule_items").insert({ ...row, sort_order: nextOrder }).select().single();
    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase.from("schedule_items").insert(row).select().single());
    }
    if (error) throw fail(error, "일정 저장");

    const imageIds = Array.isArray(images) ? images : [];
    writeImageIds(data.id, imageIds);
    const item = rowToItem(data, { [data.id]: imageIds });
    itemsCache.push(item);
    return item;
  }

  // patch에 들어 있는 필드만 고친다 (tripId는 바꾸지 않는다)
  async function updateItem(id, patch) {
    const existing = getItemById(id);
    if (!existing) throw new Error("수정할 일정을 찾을 수 없어요.");

    const columns = {};
    if ("date" in patch) columns.date = patch.date;
    if ("time" in patch) columns.time = patch.time || null;
    if ("place" in patch) columns.place = patch.place ?? null;
    if ("lat" in patch) columns.lat = typeof patch.lat === "number" ? patch.lat : null;
    if ("lng" in patch) columns.lng = typeof patch.lng === "number" ? patch.lng : null;
    if ("memo" in patch) columns.memo = patch.memo ?? null;
    if ("flight" in patch) {
      columns.flight = patch.flight ?? null;
      Object.assign(columns, flightColumns(patch.flight));
    }
    if ("lodging" in patch) columns.lodging = patch.lodging ?? null;
    if ("transport" in patch) columns.transport = patch.transport ?? null;
    if ("sortOrder" in patch) columns.sort_order = patch.sortOrder;

    const { data, error } = await supabase.from("schedule_items").update(columns).eq("id", id).select();
    if (error) throw fail(error, "일정 수정");
    if (!data || data.length === 0) throw new Error("일정을 수정하지 못했어요. 이미 지워졌거나 수정할 권한이 없어요.");

    const imageIds = Array.isArray(patch.images) ? patch.images : existing.images;
    if (Array.isArray(patch.images)) writeImageIds(id, imageIds);
    const updated = rowToItem(data[0], { [id]: imageIds });
    itemsCache = itemsCache.map((item) => (item.id === id ? updated : item));
    return updated;
  }

  // 지웠으면 true. 서버에서 이미 없거나 지울 권한이 없어서 지워진 행이 없으면 false.
  async function deleteItem(id) {
    const { data, error } = await supabase.from("schedule_items").delete().eq("id", id).select("id");
    if (error) throw fail(error, "일정 삭제");
    itemsCache = itemsCache.filter((item) => item.id !== id);
    writeImageIds(id, []);
    return Boolean(data && data.length);
  }

  // 타임라인에서 드래그로 정한 새 순서(한 날짜 안의 일정 id들, 화면에 보이는 새 순서 그대로)를 서버에 저장한다.
  // 보이는 순서대로 0, 1, 2...를 다시 매겨서 하나씩 저장한다(그 날짜 일정 수가 보통 몇 개뿐이라 이렇게 해도 된다).
  // overrides는 { id: { date, ... } } 형태 - 다른 Day로 옮겨진 일정 하나에 sortOrder 말고 date도 같이
  // 바꿔야 할 때 쓴다(timelineDrag.js의 cross-day 드래그, app.js#initTimelineDrag).
  // 008_schedule_item_order.sql을 아직 실행하지 않은 서버라면 여기서 실패한다(reorderItems를 부르는 쪽이
  // 화면을 원래 순서로 되돌리고 안내를 보여준다) - 일정 추가/수정 같은 핵심 기능은 이 실패와 무관하게 계속 된다.
  async function reorderItems(orderedIds, overrides = {}) {
    await Promise.all(orderedIds.map((id, index) => updateItem(id, { sortOrder: index, ...overrides[id] })));
  }

  // ---- 멤버 ----

  // 한 여행의 멤버 목록 (만든 사람이 맨 앞). 이름·프로필 사진은 로그인 정보(auth.users)에 있어서 서버 함수 get_trip_members
  // (migrations/003)로만 받을 수 있고, 그 함수가 아직 없으면 trip_members만 읽어 이름 없이 돌려준다.
  async function loadMembers(tripId) {
    const { data, error } = await supabase.rpc("get_trip_members", { p_trip_id: tripId });
    if (!error) {
      return (data ?? []).map((row) => ({
        userId: row.user_id,
        role: row.role,
        joinedAt: row.joined_at,
        name: row.name ?? null,
        avatarUrl: row.avatar_url ?? null,
      }));
    }
    if (error.code !== "PGRST202" && error.code !== "42883") throw fail(error, "멤버 불러오기");

    const fallback = await supabase
      .from("trip_members")
      .select("user_id, role, joined_at")
      .eq("trip_id", tripId)
      .order("joined_at", { ascending: true });
    if (fallback.error) throw fail(fallback.error, "멤버 불러오기");
    return (fallback.data ?? [])
      .map((row) => ({ userId: row.user_id, role: row.role, joinedAt: row.joined_at, name: null, avatarUrl: null }))
      .sort((a, b) => (a.role === "owner" ? -1 : 0) - (b.role === "owner" ? -1 : 0));
  }

  // 멤버를 내보낸다 (trip_members에서 그 행을 지운다). RLS상 여행을 만든 사람만, 자기 자신이 아닌 멤버만 지울 수 있다.
  async function removeMember(tripId, userId) {
    if (userId === auth?.getUserId()) throw new Error("자기 자신은 내보낼 수 없어요.");
    const { data, error } = await supabase.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", userId).select("user_id");
    if (error) throw fail(error, "멤버 내보내기");
    if (!data || data.length === 0) throw new Error("멤버를 내보내지 못했어요. 이미 나갔거나 내보낼 권한이 없어요.");
  }

  // ---- 여행지갑(Wallet) ----
  // 개인지갑(나만 보임)/공유지갑(그 문서에 연결한 여행의 멤버도 보임)으로 나뉜다 (007_wallet_shared.sql).
  // 019_wallet_trip_required.sql부터 두 지갑 모두 반드시 어느 여행에 연결되어야 한다 - 개인 문서(여권 등)도
  // "다른 여행과 공통으로 쓰는 보관함"이 아니라 그 여행의 개인지갑에만 쌓인다. 그래서 캐시 모양도 더 이상
  // "내가 볼 수 있는 전체 목록 하나"가 아니라 expensesCache와 똑같이 여행별로 나눠 부르고 합쳐 쓴다
  // (loadWalletItems(tripId)/isWalletItemsLoaded(tripId); getWalletItems()는 지금까지 불러온 모든 여행의
  // 항목을 한 배열로 돌려주고, walletPage.js가 trip.id로 걸러 쓴다 - budgetPage.js#getExpenses가 쓰는 방식).
  // addWalletItem은 업로드에 성공하면 그 결과를 같은 캐시에 바로 쌓는다(addItem/addExpense와 같은 방식).
  // 계정이 바뀌면(clearCache) 캐시와 "받아 온 적 있음" 표시를 함께 지운다.

  function getWalletItems() {
    return walletItemsCache;
  }

  const isWalletItemsLoaded = (tripId) => walletItemsLoadedTrips.has(tripId);

  // wallet_items 행 → 화면이 쓰는 지갑 항목 객체
  function rowToWalletItem(row) {
    return {
      id: row.id,
      userId: row.user_id,
      tripId: row.trip_id,
      category: row.category,
      title: row.title,
      description: row.description ?? null,
      fileUrl: row.file_url,
      fileType: row.file_type,
      visibility: row.visibility ?? "personal",
      createdAt: row.created_at,
    };
  }

  // 이 여행의 지갑 목록을 서버에서 다시 받는다 (개인 것 + 공유지갑으로 나와 공유된 것, RLS가 걸러 준다).
  // loadExpenses와 같은 모양: 그 여행 몫만 캐시에서 들어냈다가 새로 받은 것으로 채워 넣는다.
  async function loadWalletItems(tripId) {
    if (!tripId) return [];
    const requestId = (walletItemsRequestIds.get(tripId) ?? 0) + 1;
    walletItemsRequestIds.set(tripId, requestId);
    const ownerAtStart = cacheUserId;

    const { data, error } = await supabase
      .from("wallet_items")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });
    if (error) throw fail(error, "지갑 목록 불러오기");
    if (walletItemsRequestIds.get(tripId) !== requestId || ownerAtStart !== cacheUserId) return getWalletItems(); // 더 새로운 요청이나 로그아웃이 있었다

    walletItemsCache = [...walletItemsCache.filter((item) => item.tripId !== tripId), ...(data ?? []).map(rowToWalletItem)];
    walletItemsLoadedTrips.add(tripId);
    return getWalletItems();
  }

  // 문서 하나를 Storage에 올리고 wallet_items에 기록한다. category·title 검사는 호출한 쪽(walletForm.js)이
  // 미리 한다 — storage.js는 통화·카테고리를 몰라도 되는 얇은 저장 계층이라는 원칙을 그대로 따른다.
  // 파일 이름의 한글·공백 등은 Storage 경로에 안전한 문자만 남기고, "{uid}/{시각}_{파일명}"으로 저장한다
  // (경로 첫 조각이 내 uid와 같아야 하는 006_wallet.sql의 Storage 정책과 맞아야 한다).
  // tripId는 개인지갑/공유지갑 모두 필수다(019_wallet_trip_required.sql) - "어느 여행의 문서인지"가 둘 다
  // 있어야 여행별로 따로 쌓일 수 있기 때문이다.
  async function addWalletItem({ file, category, title, description, visibility, tripId }) {
    const userId = requireUserId();
    if (!tripId) throw new Error("문서를 올릴 여행을 찾을 수 없어요.");
    const vis = visibility === "shared" ? "shared" : "personal";

    const fileType = file.type?.startsWith("image/") ? "image" : "pdf";
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
    const path = `${userId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage.from("wallet").upload(path, file, { contentType: file.type || undefined });
    if (uploadError) throw fail(uploadError, "문서 업로드");

    const { data, error } = await supabase
      .from("wallet_items")
      .insert({
        user_id: userId,
        trip_id: tripId,
        category,
        title,
        description: description || null,
        file_url: path,
        file_type: fileType,
        visibility: vis,
      })
      .select()
      .single();
    if (error) {
      // DB 기록에 실패하면 방금 올린 파일이 고아로 남으므로 지워 본다 (지우기 실패해도 원래 오류를 그대로 보여준다)
      await supabase.storage.from("wallet").remove([path]).catch(() => {});
      throw fail(error, "문서 정보 저장");
    }

    const item = rowToWalletItem(data);
    walletItemsCache.push(item);
    return item;
  }

  // wallet 버킷의 경로를 짧게만 유효한 서명된 URL로 바꾼다 (private 버킷이라 공개 URL이 없다 — getPublicUrl 대신
  // createSignedUrl을 쓴다). walletPage.js(그리드 썸네일)와 walletViewer.js(전체화면 보기)가 함께 쓴다.
  // 실패해도 throw하지 않고 null을 돌려준다 — 호출한 쪽이 "불러오는 중" 대신 실패 안내를 보여주면 된다.
  async function getWalletFileUrl(path, ttlSeconds = 60) {
    try {
      const { data, error } = await supabase.storage.from("wallet").createSignedUrl(path, ttlSeconds);
      if (error) throw error;
      return data?.signedUrl ?? null;
    } catch (err) {
      console.warn("[storage] 서명된 URL을 만들지 못했습니다.", err);
      return null;
    }
  }

  // 문서를 지운다: wallet_items 행을 먼저 지우고(이게 "삭제됐다"의 기준이다), 성공하면 Storage 파일도 지운다.
  // Storage 쪽이 실패해도(예: 이미 지워짐) 사용자에게는 이미 성공으로 보이므로 오류를 던지지 않고 콘솔에만 남긴다.
  async function deleteWalletItem(item) {
    const { data, error } = await supabase.from("wallet_items").delete().eq("id", item.id).select("id");
    if (error) throw fail(error, "문서 삭제");
    if (!data || data.length === 0) throw new Error("문서를 삭제하지 못했어요. 이미 지워졌거나 권한이 없어요.");

    const { error: removeError } = await supabase.storage.from("wallet").remove([item.fileUrl]);
    if (removeError) console.warn("[storage] Storage 파일 삭제 실패 (문서 기록은 이미 지워졌어요)", removeError);

    walletItemsCache = walletItemsCache.filter((x) => x.id !== item.id);
  }

  // ---- 약관 동의(user_consents, 010_user_consents.sql) ----
  // app.js의 requireConsent 가드가 매 라우트 전환마다 동기로 hasConsent()를 불러야 해서, 로그인 직후
  // refreshConsent()로 한 번 받아 캐시해 둔다(storage.refreshTrips를 router.start() 전에 기다리는 것과
  // 같은 이유). 010 마이그레이션이 아직 없거나(테이블 없음) 네트워크 오류로 확인 자체를 못 했을 때는
  // hasConsent()가 기본값 true를 돌려줘서(아래) 약관 동의 기능 때문에 앱 전체가 막히지 않는다 - 테이블이
  // 생기기 전까지는 "이 기능 자체가 없었던 것"처럼 동작한다.

  function rowToConsent(row) {
    return {
      id: row.id,
      userId: row.user_id,
      termsVersion: row.terms_version ?? null,
      privacyVersion: row.privacy_version ?? null,
      termsAgreedAt: row.terms_agreed_at ?? null,
      privacyAgreedAt: row.privacy_agreed_at ?? null,
      marketingAgreed: Boolean(row.marketing_agreed),
      marketingAgreedAt: row.marketing_agreed_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // 로그인한 사용자의 user_consents 행이 있는지 서버에서 다시 확인해 캐시한다. 로그인하지 않았으면 캐시를 비운다.
  //
  // 2026-10-19 보안 점검(RLS-06) 전에는 한 번이라도 실패(네트워크 오류 등)하면 consentLoaded가 계속
  // false로 남아 hasConsent()가 "막지 않음(true)"을 돌려줬다 - 동의하지 않은 사용자가 일시적 오류 동안
  // 계속 앱을 쓸 수 있었다는 뜻이다. 이제는 짧은 간격으로 몇 번 더 시도(CONSENT_RETRY_DELAYS_MS)하고,
  // 그래도 실패하면(마이그레이션을 아직 안 돌린 서버 포함) consentCache를 null로, consentLoaded는 true로
  // 둬서 hasConsent()가 false(동의 화면 필요)를 돌려주게 한다 - "모르면 일단 막는다"로 기본값을 뒤집었다.
  // 던지지는 않는다(호출한 쪽은 여전히 await만 하면 된다) - 실패도 하나의 결과일 뿐이라서다.
  const CONSENT_RETRY_DELAYS_MS = [400, 1200]; // 조정 지점: 최초 1회 + 재시도 2회 = 최대 3회 시도

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function refreshConsent() {
    const userId = auth?.getUserId() ?? null;
    if (!userId) {
      consentCache = null;
      consentLoaded = false;
      return null;
    }
    const requestId = ++consentRequestId;

    for (let attempt = 0; ; attempt++) {
      const { data, error } = await supabase.from("user_consents").select("*").eq("user_id", userId).maybeSingle();
      if (requestId !== consentRequestId) return consentCache; // 더 새로운 요청이나 로그아웃이 있었다
      if (!error) {
        consentCache = data ? rowToConsent(data) : null;
        consentLoaded = true;
        return consentCache;
      }
      if (attempt >= CONSENT_RETRY_DELAYS_MS.length) {
        console.warn("[storage] 약관 동의 여부 확인 실패(재시도 소진) - 동의 화면으로 보냅니다", error);
        consentCache = null;
        consentLoaded = true; // fail-closed
        return consentCache;
      }
      await sleep(CONSENT_RETRY_DELAYS_MS[attempt]);
      if (requestId !== consentRequestId) return consentCache; // 대기하는 동안 더 새로운 요청/로그아웃이 있었다
    }
  }

  // true면 "동의 화면을 안 보여줘도 된다" - consentLoaded가 아직 false(이번 로그인에서 refreshConsent가
  // 아직 한 번도 끝나지 않음 - 재시도 진행 중이거나 호출 자체가 아직 안 끝남)면 일단 막지 않고 true를
  // 돌려준다(app.js#enterApp이 이 함수를 반드시 기다린 뒤에만 라우팅하므로, 실제 화면 가드에서 이 경로를
  // 타는 건 "아직 한 번도 로그인한 적 없는 탭"뿐이다). consentLoaded가 true면 재시도까지 전부 끝난
  // 상태이고, consentCache가 null이면(서버가 "행이 없다"고 확인해 줬거나, 재시도를 다 썼는데도 실패했거나)
  // 그때는 실제로 false(동의 화면 필요)를 돌려준다.
  function hasConsent() {
    if (!consentLoaded) return true;
    return consentCache !== null;
  }

  function getConsent() {
    return consentCache;
  }

  // 동의를 저장(또는 이미 있으면 갱신)한다. user_id가 unique라서 upsert 한 번으로 "최초 동의"와 "재동의"를
  // 모두 처리한다(010_user_consents.sql 참고 - 동의 이력이 아니라 "최신 동의 상태" 한 행이다).
  async function saveConsent({ termsVersion, privacyVersion, marketingAgreed }) {
    const userId = requireUserId();
    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
      terms_agreed_at: now,
      privacy_agreed_at: now,
      marketing_agreed: Boolean(marketingAgreed),
      marketing_agreed_at: marketingAgreed ? now : null,
    };
    const { data, error } = await supabase.from("user_consents").upsert(row, { onConflict: "user_id" }).select().single();
    if (error) throw fail(error, "약관 동의 저장");

    consentCache = rowToConsent(data);
    consentLoaded = true;
    return consentCache;
  }

  // ---- 알림 설정(notification_settings, 031_push_notifications.sql, 사용자당 한 행) ----
  // 설정 화면의 "일정 알림"/"초대·공유 알림" 두 토글만 저장한다(공지사항은 끄는 설정이 없다 - PRD v11
  // 5번). 한 번도 저장한 적 없는 사용자는 행이 없는데, 그때는 DB 컬럼 기본값과 같은 '켜짐'으로 보여준다.

  function rowToNotificationSettings(row) {
    return {
      scheduleEnabled: row ? Boolean(row.schedule_enabled) : true,
      shareEnabled: row ? Boolean(row.share_enabled) : true,
    };
  }

  // 로그인한 사용자의 notification_settings 행을 서버에서 다시 확인해 캐시한다. 행이 없거나(아직 저장
  // 안 함) 로그인하지 않았으면 기본값(둘 다 켜짐)으로 캐시한다. 네트워크 오류 등으로 실패해도 던지지
  // 않는다 - 직전 캐시(또는 기본값)를 그대로 돌려준다.
  async function loadNotificationSettings() {
    const userId = auth?.getUserId() ?? null;
    if (!userId) {
      notificationSettingsCache = { scheduleEnabled: true, shareEnabled: true };
      notificationSettingsLoaded = false;
      return notificationSettingsCache;
    }
    const requestId = ++notificationSettingsRequestId;
    const { data, error } = await supabase.from("notification_settings").select("*").eq("user_id", userId).maybeSingle();
    if (requestId !== notificationSettingsRequestId) return notificationSettingsCache; // 더 새로운 요청이나 로그아웃이 있었다
    if (error) {
      console.warn("[storage] 알림 설정 조회 실패", error);
      return notificationSettingsCache;
    }
    notificationSettingsCache = rowToNotificationSettings(data);
    notificationSettingsLoaded = true;
    return notificationSettingsCache;
  }

  function getNotificationSettings() {
    return notificationSettingsCache;
  }

  // user_id가 PK라서 upsert 한 번으로 "최초 저장"과 "변경"을 모두 처리한다(user_consents와 같은 모양).
  async function saveNotificationSettings({ scheduleEnabled, shareEnabled }) {
    const userId = requireUserId();
    const row = {
      user_id: userId,
      schedule_enabled: Boolean(scheduleEnabled),
      share_enabled: Boolean(shareEnabled),
    };
    const { data, error } = await supabase.from("notification_settings").upsert(row, { onConflict: "user_id" }).select().single();
    if (error) throw fail(error, "알림 설정 저장");

    notificationSettingsCache = rowToNotificationSettings(data);
    notificationSettingsLoaded = true;
    return notificationSettingsCache;
  }

  // 로그인 기능이 없던 때 저장해 둔 가짜(mock) 사용자는 이제 쓰지 않는다. 진짜 로그인 상태는 Supabase 세션이 정한다 (auth.js).
  try {
    localStorage.removeItem("triplog.user");
  } catch (err) {
    /* 저장소를 못 쓰는 환경이면 지울 것도 없다 */
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.storage = {
    onChange,
    refreshTrips,
    syncUser,
    clearCache,
    isTripsLoaded,
    getAllTrips,
    getTripById,
    setCurrentTrip,
    getTrip,
    saveTrip,
    createTrip,
    deleteTrip,
    leaveTrip,
    loadExpenses,
    isExpensesLoaded,
    getExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    loadChecklistCategories,
    isChecklistCategoriesLoaded,
    getChecklistCategories,
    addChecklistCategory,
    deleteChecklistCategory,
    loadChecklistItems,
    isChecklistLoaded,
    getChecklistItems,
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    reorderChecklistItems,
    ensureChecklistSeeded,
    loadItems,
    isItemsLoaded,
    getItems,
    getItemById,
    addItem,
    updateItem,
    deleteItem,
    reorderItems,
    loadMembers,
    removeMember,
    getWalletItems,
    loadWalletItems,
    isWalletItemsLoaded,
    addWalletItem,
    getWalletFileUrl,
    deleteWalletItem,
    refreshConsent,
    hasConsent,
    getConsent,
    saveConsent,
    loadNotificationSettings,
    getNotificationSettings,
    saveNotificationSettings,
  };
})();
