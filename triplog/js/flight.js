// @별칭 FLIGHT · 항공편 추가 창 · 항공편 상세 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 항공편 추가/수정 창과 항공편 상세 창을 담당하는 모듈.
// 새로 추가할 때는 먼저 "선택" 화면에서 두 경로 중 하나를 고른다 (flight-step-choice):
//   - 사진으로 등록: 항공권 사진을 고르면(FileReader → base64 → Edge Function analyze-ticket → Google Gemini)
//     항공사·편명·공항·시간·출발일을 한 번에 읽어서, 필요한 단계만 거쳐 곧바로 "항공편 확인" 화면까지 진행한다
//     (applyScanAndAdvance). 출발일이 이 여행의 어느 Day와 같으면 그 Day로 자동 등록하고(같은 날짜만 비교),
//     못 찾으면(여행 기간 밖이거나 읽지 못했으면) 날짜(Day) 고르는 화면을 끼워 넣는다. 항공사·편명을 읽지
//     못했을 때도 마찬가지로 그 화면을 끼워 넣는다 — "조회하기" 버튼이 항공사·편명 없이는 눌리지 않는
//     규칙(renderFooter)을 사진 경로에서도 그대로 지키기 위해서다.
//   - 직접 등록: 기존과 같은 순서 그대로, 날짜(Day) → 항공사·편명 → 항공편 확인.
// 왕복 항공권처럼 사진 한 장에 항공편이 여러 개(출국편+귀국편) 있으면 analyze-ticket이 tickets 배열로 돌려준다.
// 첫 번째 항공편만 바로 화면에 채우고 나머지는 state.ticketQueue에 쌓아 둔다: 한 항공편을 "완료"로 저장할 때마다
// (handleSubmit → continueTicketQueueOrClose) 큐에 남은 게 있으면 창을 닫지 않고 그 값으로 다시
// applyScanAndAdvance를 돌려 다음 항공편(각자의 날짜에 맞춰) 확인 화면을 이어서 보여준다. 큐가 비었을 때만 닫는다.
// 사진과 base64는 어디에도 저장하지 않는다: base64는 분석이 끝나면, 미리보기는 창을 닫거나 지우면 버린다.
// 저장되는 것은 사용자가 확인한 항공사·편명 등 글자 값뿐이다 (일정·저장소에 이미지 관련 값이 들어가지 않는다).
// 사진 고르기 자체는 네이티브 앱(Capacitor)과 웹이 서로 다른 방식을 쓴다(auth.isNativeApp()으로 분기):
// 네이티브는 @capacitor/camera의 getPhoto()(captureTicketPhoto), 웹은 기존 <input type="file">(readTicketFile).
// 둘 다 결과를 "data:mime;base64,..." 문자열로 맞춰서 같은 함수(applyTicketDataUrl)로 넘긴다 — 그 뒤(크기 확인,
// 미리보기, 분석 호출)는 어느 쪽에서 왔든 완전히 같은 코드를 탄다.
// 항공편은 일반 일정과 같은 items 배열에 저장하되 item.flight 필드로 구분한다.
// item.flight = { airlineCode, airlineName, flightNo, depAirport, depTime, arrAirport, arrTime }
// (storage.js가 항공편 일정에 category "flight"와 airline/flightNo도 함께 넣는다)
//
// 수정(편집)할 때는 선택 화면 없이 바로 "날짜 → 항공사·편명 → 확인" 순서(마지막 확인 화면부터 시작, 뒤로가기로
// 앞 단계도 고칠 수 있다)로 들어간다. 사진 재분석은 새로 추가할 때만 제공한다.

(function () {
  const { getTrip, getItemById, addItem, updateItem, deleteItem } = window.TripLog.storage;
  const {
    REGION_LABELS,
    AIRPORTS,
    getAirline,
    getAirport,
    airportsForCity,
    searchAirlines,
    fetchFlightInfo,
    getApiKey,
    setApiKey,
  } = window.TripLog.flightData;
  const { escapeHtml, getTripDays: tripDaysOf } = window.TripLog.util;
  const supabase = window.TripLog.supabase;
  const ui = window.TripLog.ui;
  const auth = window.TripLog.auth;
  const permissionPrompt = window.TripLog.permissionPrompt;
  const aiNotice = window.TripLog.aiNotice;

  const DEFAULT_DEPARTURE = "ICN";
  const MAX_TICKET_BYTES = 20 * 1024 * 1024; // 이보다 큰 사진은 읽지 않는다
  const ANALYZE_TIMEOUT_MS = 60_000; // 함수가 Gemini 모델을 바꿔 가며 시도하면 오래 걸릴 수 있다
  const ANALYZE_FAIL_TOAST = "자동 인식에 실패했어요. 직접 입력해주세요";
  const AUTOFILL_NOTICE = "항공권에서 자동으로 입력되었어요. 확인해주세요";
  // @capacitor/camera의 (구)getPhoto()가 받는 source 값. 번들러가 없어서 그 패키지의 CameraSource enum을
  // 불러오는 대신 리터럴 문자열을 그대로 쓴다(node_modules/@capacitor/camera/dist/esm/definitions.js 기준).
  const CAMERA_SOURCE = { CAMERA: "CAMERA", PHOTOS: "PHOTOS" };

  let onChange = () => {};

  const state = {
    step: 0, // stepsFor()의 인덱스 (0부터). 실제로 어떤 화면인지는 stepsFor()[step]로 구한다
    path: null, // "photo" | "manual" | null(=선택 화면). 수정할 때는 항상 "manual"
    editingId: null,
    date: null,
    dayRequired: false, // 사진 경로에서 출발일로 Day를 못 찾았을 때만 true → 날짜 선택 화면을 끼워 넣는다
    airlineRequired: false, // 사진 경로에서 항공사·편명을 다 못 읽었을 때만 true → 항공사·편명 화면을 끼워 넣는다
    airlineCode: null,
    query: "",
    loading: false,
    lookupId: 0,
    detailItemId: null,
    deleteArmed: false,
    ticket: null, // 방금 고른 항공권 사진 { mime, base64 } (메모리에만 있다. 분석이 끝나면 버린다)
    ticketReadId: 0,
    scan: null, // 항공권에서 읽은 글자 값 { flightNo, depAirport, arrAirport, depTime, arrTime, date } (사진은 아니다)
    ticketQueue: [], // 왕복 항공권처럼 사진 한 장에서 항공편이 여러 개 나왔을 때, 지금 것 다음에 이어서 등록할 것들
  };

  // 새 항공편을 추가할 때 실제로 거치는 화면 순서. 수정할 때나 선택 화면(choice)에 있을 때는 이 목록을 안 쓴다.
  // 교통편(항공/기차/버스/선박) 고르기는 이 모듈에 들어오기 전, 일정 화면의 빠른 메뉴 드롭다운에서 이미
  // 끝난 상태다(app.js#openTransportMenu) - "항공"을 골랐을 때만 flight.openForm()이 불려서 여기로 온다.
  function stepsFor() {
    if (state.editingId) return ["day", "airline", "confirm"];
    if (state.path === "manual") return ["day", "airline", "confirm"];
    if (state.path === "photo") {
      const steps = [];
      if (state.dayRequired) steps.push("day");
      if (state.airlineRequired) steps.push("airline");
      steps.push("confirm");
      return steps;
    }
    return ["choice"];
  }

  const els = {
    overlay: document.getElementById("flight-modal-overlay"),
    back: document.getElementById("flight-back"),
    stepLabel: document.getElementById("flight-step-label"),
    title: document.getElementById("flight-modal-title"),
    btnClose: document.getElementById("flight-btn-close"),
    stepChoice: document.getElementById("flight-step-choice"),
    stepDay: document.getElementById("flight-step-day"),
    stepAirline: document.getElementById("flight-step-airline"),
    stepConfirm: document.getElementById("flight-step-confirm"),
    manualBtn: document.getElementById("flight-manual-btn"),
    dayChips: document.getElementById("flight-day-chips"),
    airlineSearch: document.getElementById("flight-airline-search"),
    airlineChips: document.getElementById("flight-airline-chips"),
    flightPrefix: document.getElementById("flight-no-prefix"),
    flightNo: document.getElementById("flight-no-input"),
    apiKey: document.getElementById("flight-api-key"),
    apiForm: document.getElementById("flight-api-form"),
    apiSave: document.getElementById("flight-api-save"),
    apiClear: document.getElementById("flight-api-clear"),
    apiState: document.getElementById("flight-api-state"),
    ticketPick: document.getElementById("flight-ticket-pick"),
    ticketCamera: document.getElementById("flight-ticket-camera"),
    ticketFile: document.getElementById("flight-ticket-file"),
    ticketCameraFile: document.getElementById("flight-ticket-camera-file"),
    ticketPreview: document.getElementById("flight-ticket-preview"),
    ticketImg: document.getElementById("flight-ticket-img"),
    ticketClear: document.getElementById("flight-ticket-clear"),
    ticketStatus: document.getElementById("flight-ticket-status"),
    autofillNotice2: document.getElementById("flight-autofill-notice-2"),
    autofillNotice3: document.getElementById("flight-autofill-notice-3"),
    lookupStatus: document.getElementById("flight-lookup-status"),
    depAirport: document.getElementById("flight-dep-airport"),
    depTime: document.getElementById("flight-dep-time"),
    arrAirport: document.getElementById("flight-arr-airport"),
    arrTime: document.getElementById("flight-arr-time"),
    duration: document.getElementById("flight-duration-hint"),
    error: document.getElementById("flight-error"),
    footer: document.getElementById("flight-footer"),
    btnNext: document.getElementById("flight-btn-next"),

    detailOverlay: document.getElementById("flight-detail-overlay"),
    detailTitle: document.getElementById("flight-detail-title"),
    detailDay: document.getElementById("flight-detail-day"),
    detailBody: document.getElementById("flight-detail-body"),
    btnDetailClose: document.getElementById("flight-detail-close"),
    btnDetailEdit: document.getElementById("flight-detail-edit"),
    btnDetailDelete: document.getElementById("flight-detail-delete"),
  };

  // ---- 공통 유틸 ----

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}분`;
    return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
  }

  // 출발·도착 "현지 시각"과 공항의 시차로 실제 비행시간을 구한다. 24시간 이내 비행만 가정한다.
  // dayOffset은 도착 현지 날짜가 출발 현지 날짜보다 며칠 뒤인지(자정을 넘기는 항공편이면 1).
  function computeFlight(flight) {
    const dep = getAirport(flight.depAirport);
    const arr = getAirport(flight.arrAirport);
    if (!dep || !arr || !flight.depTime || !flight.arrTime) return null;

    const depUtc = toMinutes(flight.depTime) - dep.tz * 60;
    let arrUtc = toMinutes(flight.arrTime) - arr.tz * 60;
    while (arrUtc <= depUtc) arrUtc += 24 * 60;

    const minutes = arrUtc - depUtc;
    const arrLocalAbs = depUtc + minutes + arr.tz * 60;
    return { minutes, dayOffset: Math.floor(arrLocalAbs / (24 * 60)) };
  }

  // 타임라인 카드에 표시할 한 줄 요약: "대한항공 KE723 (ICN)09:30 ~ (KIX)11:10"
  function summary(item) {
    const f = item.flight;
    const computed = computeFlight(f);
    const suffix = computed && computed.dayOffset > 0 ? `+${computed.dayOffset}` : "";
    return `${f.airlineName} ${f.flightNo} (${f.depAirport})${f.depTime} ~ (${f.arrAirport})${f.arrTime}${suffix}`;
  }

  const getTripDays = () => tripDaysOf(getTrip());

  function airportLabel(a) {
    return `${a.city} · ${a.name} (${a.code})`;
  }

  // 조회로 나온 공항이 목록에 없을 때도 선택된 상태로 보여줄 수 있게 옵션을 즉석에서 추가한다
  function setAirport(select, code) {
    if (code && ![...select.options].some((o) => o.value === code)) {
      select.add(new Option(`${code} (공항 정보 없음)`, code));
    }
    select.value = code || "";
  }

  function airportOptionsHtml() {
    const groups = Object.entries(REGION_LABELS)
      .map(([region, label]) => {
        const options = AIRPORTS.filter((a) => a.region === region)
          .map((a) => `<option value="${a.code}">${escapeHtml(airportLabel(a))}</option>`)
          .join("");
        return `<optgroup label="${label}">${options}</optgroup>`;
      })
      .join("");
    return `<option value="">공항 선택</option>${groups}`;
  }

  // 조회 결과가 없을 때의 추천값: 마지막 Day면 귀국편으로 보고 여행지 공항 → 인천, 그 외에는 인천 → 여행지 공항
  function applyDefaultAirports() {
    const days = getTripDays();
    const destination = airportsForCity(getTrip()?.cityId)[0] ?? "";
    const isReturn = days.length > 1 && state.date === days[days.length - 1].date;

    setAirport(els.depAirport, isReturn ? destination : DEFAULT_DEPARTURE);
    setAirport(els.arrAirport, isReturn ? DEFAULT_DEPARTURE : destination);
  }

  // ---- 추가/수정 페이지 ----

  function openForm(item) {
    const days = getTripDays();
    if (!getTrip() || days.length === 0) return;

    state.editingId = item?.id ?? null;
    state.query = "";
    state.loading = false;
    state.lookupId += 1;
    state.dayRequired = false;
    state.airlineRequired = false;
    els.airlineSearch.value = "";
    hideError();
    clearTicket();

    if (item) {
      const f = item.flight;
      state.date = item.date;
      state.airlineCode = f.airlineCode;
      state.path = "manual"; // 수정은 선택 화면 없이 day→airline→confirm 순서를 그대로 쓴다 (사진 재분석은 새 추가에서만)
      state.step = stepsFor().length - 1; // 마지막 화면(확인)부터 시작하되, 뒤로가기로 앞 단계도 고칠 수 있다
      els.flightNo.value = f.flightNo.slice(f.airlineCode.length);
      setAirport(els.depAirport, f.depAirport);
      setAirport(els.arrAirport, f.arrAirport);
      els.depTime.value = f.depTime;
      els.arrTime.value = f.arrTime;
      setLookupStatus("저장된 항공편 정보를 수정할 수 있어요.");
    } else {
      state.date = days[0].date;
      state.airlineCode = null;
      state.path = null; // 선택 화면(사진으로 등록 / 직접 등록)부터 시작
      state.step = 0;
      els.flightNo.value = "";
      els.depTime.value = "";
      els.arrTime.value = "";
      setAirport(els.depAirport, "");
      setAirport(els.arrAirport, "");
      aiNotice.showOnce(); // "사진으로 등록"(OCR) 경로가 있는 선택 화면이 열리는 시점 - 이미 봤으면 아무 일도 안 한다
    }

    els.overlay.hidden = false;
    render();
  }

  function closeForm() {
    els.overlay.hidden = true;
    state.lookupId += 1; // 진행 중인 조회 결과는 버린다
    clearTicket(); // 항공권 사진은 창을 닫으면 버린다
  }

  function selectedDay() {
    return getTripDays().find((d) => d.date === state.date) ?? null;
  }

  function currentFlightNumber() {
    const value = els.flightNo.value.trim();
    const code = state.airlineCode;
    // "KE723"처럼 항공사 코드까지 붙여 넣어도 코드가 두 번 붙지 않게 한다
    return code && value.length > code.length && value.startsWith(code) ? value.slice(code.length) : value;
  }

  function currentFlight() {
    return {
      airlineCode: state.airlineCode,
      airlineName: getAirline(state.airlineCode)?.name ?? "",
      flightNo: `${state.airlineCode ?? ""}${currentFlightNumber()}`,
      depAirport: els.depAirport.value,
      depTime: els.depTime.value,
      arrAirport: els.arrAirport.value,
      arrTime: els.arrTime.value,
    };
  }

  function currentMode() {
    return stepsFor()[state.step];
  }

  function confirmStepIndex() {
    return stepsFor().indexOf("confirm");
  }

  function render() {
    const mode = currentMode();
    els.stepChoice.hidden = mode !== "choice";
    els.stepDay.hidden = mode !== "day";
    els.stepAirline.hidden = mode !== "airline";
    els.stepConfirm.hidden = mode !== "confirm";
    // 선택 화면(choice)이거나, 수정의 첫 화면(day, 더 앞으로는 못 간다)이면 뒤로가기를 감춘다
    els.back.hidden = mode === "choice" || (state.editingId && state.step === 0);

    const steps = stepsFor();
    const progress = mode === "choice" ? "" : `${state.step + 1}/${steps.length}단계 · `;

    if (mode === "choice") {
      els.stepLabel.textContent = "";
      els.title.textContent = "항공편을 어떻게 등록할까요?";
    } else if (mode === "day") {
      els.stepLabel.textContent = `${progress}날짜`;
      els.title.textContent = "몇 일차 항공편인가요?";
      renderDayChips();
    } else if (mode === "airline") {
      els.stepLabel.textContent = `${progress}항공사·편명`;
      els.title.textContent = "어느 항공편인가요?";
      renderAirlineChips();
      renderFlightPrefix();
      renderApiState();
    } else {
      const flight = currentFlight();
      const day = selectedDay();
      els.stepLabel.textContent = `${progress}항공편 확인${day ? ` · Day ${day.number}` : ""}`;
      els.title.textContent = flight.flightNo ? `${flight.flightNo} (${flight.airlineName})` : "항공편 정보를 확인해주세요";
      renderDuration();
    }
    renderFooter();
  }

  function renderFooter() {
    const mode = currentMode();
    let text = "";
    let disabled = false;

    if (mode === "choice") {
      // 선택 화면은 그 안의 버튼으로 직접 진행하므로 하단 고정 버튼이 필요 없다
    } else if (mode === "day") {
      const day = selectedDay();
      text = day ? `Day ${day.number} 선택완료` : "";
    } else if (mode === "airline") {
      // 항공사와 편명을 둘 다 넣어야 조회할 수 있다. 빠진 것이 무엇인지 버튼 글자로 알려준다.
      const number = currentFlightNumber();
      if (!state.airlineCode) {
        text = "항공사를 선택해주세요";
        disabled = true;
      } else if (!number) {
        text = "편명을 입력해주세요";
        disabled = true;
      } else {
        text = `${state.airlineCode}${number} 조회하기`;
      }
    } else {
      text = state.editingId ? "수정 완료" : "완료";
      disabled = state.loading;
    }

    els.footer.hidden = !text;
    els.btnNext.textContent = state.loading && mode === "confirm" ? "조회 중..." : text;
    els.btnNext.disabled = disabled;
  }

  function renderDayChips() {
    els.dayChips.innerHTML = getTripDays()
      .map(
        (d) => `
        <button type="button" class="flight-chip flight-chip--day${d.date === state.date ? " flight-chip--active" : ""}"
          data-date="${d.date}">
          <strong>Day ${d.number}</strong><span>${d.label}</span>
        </button>`
      )
      .join("");
  }

  function renderAirlineChips() {
    const airlines = searchAirlines(state.query);
    if (airlines.length === 0) {
      els.airlineChips.innerHTML = `<p class="flight-empty">"${escapeHtml(state.query.trim())}" 검색 결과가 없습니다.</p>`;
      return;
    }
    els.airlineChips.innerHTML = airlines
      .map(
        (a) => `
        <button type="button" class="flight-chip${a.code === state.airlineCode ? " flight-chip--active" : ""}"
          data-airline="${a.code}">${escapeHtml(a.name)}(${a.code})</button>`
      )
      .join("");
  }

  // 편명 입력 칸 앞에 고른 항공사 코드를 보여준다 (아직 안 골랐으면 "--")
  function renderFlightPrefix() {
    els.flightPrefix.textContent = state.airlineCode ?? "--";
  }

  function renderDuration() {
    const flight = currentFlight();
    const computed = computeFlight(flight);
    if (computed) {
      const next = computed.dayOffset > 0 ? ` · 도착일 +${computed.dayOffset}일` : "";
      els.duration.textContent = `✈ 소요시간 ${formatDuration(computed.minutes)}${next}`;
    } else if (flight.depAirport && flight.arrAirport && flight.depTime && flight.arrTime) {
      els.duration.textContent = "공항 시차 정보가 없어 소요시간을 계산할 수 없어요.";
    } else {
      els.duration.textContent = "공항과 시간을 입력하면 소요시간이 자동으로 계산돼요.";
    }
  }

  function setLookupStatus(message, tone, note) {
    els.lookupStatus.className = `flight-lookup-status${tone ? ` flight-lookup-status--${tone}` : ""}`;
    els.lookupStatus.innerHTML =
      `<strong>${escapeHtml(message)}</strong>` + (note ? `<span>${escapeHtml(note)}</span>` : "");
  }

  // 시간을 자동으로 못 가져온 이유(note)별 안내. 이 경우 시간은 항공권을 보고 직접 입력한다.
  const TIME_NOTES = {
    nokey: "출발·도착 시간은 항공사·편명 화면에서 API 키를 연결하면 자동으로 채워져요. 지금은 항공권을 보고 직접 입력해주세요.",
    auth: "API 키가 올바르지 않아 시간을 조회하지 못했어요. 항공사·편명 화면에서 키를 확인해주세요. 시간은 직접 입력할 수 있어요.",
    quota: "API 사용량(또는 요청 속도) 제한으로 시간을 조회하지 못했어요. 잠시 뒤 다시 시도하거나 직접 입력해주세요.",
    nodate: "이 편명의 최근 운항 기록을 찾지 못했어요. 항공권에 적힌 출발·도착 시간을 직접 입력해주세요.",
    neterr: "시간 조회에 실패했어요. 항공권에 적힌 출발·도착 시간을 직접 입력해주세요.",
  };

  function airportName(code) {
    const a = getAirport(code);
    return a ? `${a.city}(${code})` : code;
  }

  function renderApiState() {
    const connected = Boolean(getApiKey());
    els.apiState.textContent = connected ? "· 연결됨" : "· 연결 안 됨";
    els.apiState.className = connected ? "flight-api-state--on" : "";
    els.apiForm.hidden = connected;
    els.apiClear.hidden = !connected;
    els.apiKey.value = "";
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  // ---- 항공권 사진 (base64 변환 → 분석 → 입력칸 채우기) ----

  function showTicketStatus(message, tone) {
    els.ticketStatus.textContent = message;
    els.ticketStatus.className = `flight-ticket-status${tone ? ` flight-ticket-status--${tone}` : ""}`;
    els.ticketStatus.hidden = !message;
    // 미리보기와 안내 문구는 카드 맨 아래라서, 사진을 고르면 화면 밖에 있을 수 있다. 보이는 곳까지만 스크롤한다.
    if (message) els.ticketStatus.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // 항공권에서 채운 값 위의 안내. message가 없으면 숨긴다. mode는 "airline"(2단계 자리) 또는 "confirm"(확인 화면).
  function setAutofillNotice(mode, message) {
    const el = mode === "airline" ? els.autofillNotice2 : els.autofillNotice3;
    el.textContent = message ?? "";
    el.hidden = !message;
  }

  // 고른 사진과 미리보기, 안내 문구, 항공권에서 읽은 값을 모두 비운다 (진행 중인 읽기·분석 결과도 버린다).
  // 이미 입력칸에 채워진 값은 그대로 둔다.
  function clearTicket() {
    state.ticketReadId += 1;
    state.ticket = null;
    state.scan = null;
    state.ticketQueue = [];
    els.ticketImg.removeAttribute("src");
    els.ticketPreview.hidden = true;
    els.ticketFile.value = "";
    els.ticketCameraFile.value = "";
    showTicketStatus("");
    setAutofillNotice("airline", null);
    setAutofillNotice("confirm", null);
  }

  const cleanText = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const cleanAirport = (value) => {
    const code = cleanText(value)?.toUpperCase();
    return code && /^[A-Z]{3}$/.test(code) ? code : null;
  };
  const cleanTime = (value) => {
    const time = cleanText(value);
    return time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
  };

  // 분석 결과를 적용하고, 필요한 화면만 거쳐 곧바로 "항공편 확인" 화면까지 자동으로 진행한다.
  // - 항공사·편명을 둘 다 읽었으면 항공사·편명 화면은 건너뛴다. 하나라도 못 읽었으면(airlineRequired)
  //   그 화면을 끼워 넣어 "조회하기" 버튼이 눌리기 전에 직접 채우게 한다.
  // - 출발일이 이 여행의 어느 Day와 같으면 그 Day로 자동 등록한다(요구사항 6). 같은 날짜를 못 찾으면
  //   (여행 기간 밖이거나 읽지 못했으면) 날짜(Day) 선택 화면을 끼워 넣는다(요구사항 7, dayRequired).
  function applyScanAndAdvance(result) {
    // 함수가 이미 정리해서 보내지만, 대소문자·공백이 섞여 와도 되도록 한 번 더 정리한다
    const rawNo = cleanText(result.flightNo)?.toUpperCase().replace(/[\s-]/g, "") ?? null;
    const flightNo = rawNo && /^[A-Z0-9]{2}[A-Z0-9]{1,5}$/.test(rawNo) ? rawNo : null;
    let airline = getAirline(cleanText(result.airlineCode)?.toUpperCase() ?? flightNo?.slice(0, 2)) ?? null;
    if (!airline && cleanText(result.airline)) {
      const found = searchAirlines(cleanText(result.airline)); // 코드가 없거나 모르는 코드면 이름으로 찾는다
      if (found.length === 1) airline = found[0];
    }
    const number = flightNo ? flightNo.slice(2) : null; // "KE723" → "723" (항공사 코드는 칩으로 고른다)

    if (airline) {
      state.airlineCode = airline.code;
      state.query = "";
      els.airlineSearch.value = "";
    }
    if (number) els.flightNo.value = number;

    state.scan = {
      flightNo: airline && number ? `${airline.code}${number}` : null,
      depAirport: cleanAirport(result.departureAirportCode),
      arrAirport: cleanAirport(result.arrivalAirportCode),
      depTime: cleanTime(result.departureTime),
      arrTime: cleanTime(result.arrivalTime),
      date: cleanText(result.departureDate),
    };

    state.path = "photo";
    state.airlineRequired = !(airline && number);

    // 날짜: 항공권의 출발일이 이 여행의 어느 Day와 같으면 그 Day로 자동 등록한다. 같은 날이 없으면(여행
    // 기간 밖이거나 아예 못 읽었으면) 날짜(Day) 선택 화면을 끼워 넣어 사용자가 직접 고르게 한다.
    const scanDate = state.scan.date;
    const matchedDay = scanDate ? getTripDays().find((d) => d.date === scanDate) : null;
    state.dayRequired = !matchedDay;
    if (matchedDay) {
      state.date = matchedDay.date;
      ui.showToast(`항공권 출발일에 맞춰 Day ${matchedDay.number}(${matchedDay.date.slice(5).replace("-", ".")})로 등록했어요.`);
    } else if (scanDate) {
      ui.showToast(`항공권 출발일(${scanDate.replaceAll("-", ".")})이 여행 기간에 없어요. Day를 선택해주세요.`);
    }

    const missing = [];
    if (!airline) missing.push("항공사");
    if (!number) missing.push("편명");
    let notice = AUTOFILL_NOTICE;
    if (missing.length) notice += `. 읽지 못한 항목(${missing.join(", ")})은 직접 입력해주세요`;
    setAutofillNotice(state.airlineRequired ? "airline" : "confirm", notice);
    // 화면은 곧바로 다음 단계로 넘어가서 이 문구가 보이지 않을 수 있지만, 뒤로가기로 선택 화면에 돌아왔을 때
    // "분석 중..."처럼 오래된 문구가 남아 있지 않도록 결과를 남겨 둔다.
    showTicketStatus(missing.length ? `분석 완료. ${missing.join(", ")}은(는) 다음 화면에서 직접 골라주세요.` : "분석 완료. 항공편 정보를 확인해주세요.", "ok");

    state.step = 0; // stepsFor()가 위에서 정한 dayRequired/airlineRequired를 반영해 새로 계산된다
    if (state.dayRequired || state.airlineRequired) {
      render(); // 남은 화면(날짜와/또는 항공사·편명)을 먼저 보여준다
    } else {
      startLookup(); // 둘 다 채웠으면 바로 항공편 확인 화면으로 진행한다
    }
  }

  // 사진을 Edge Function(analyze-ticket)으로 보내 항공편 정보를 읽는다. 실패하면 토스트만 띄우고 입력칸은 그대로 둔다.
  // 왕복 항공권처럼 사진 한 장에 항공편이 여러 개 담겨 있으면 tickets 배열로 온다: 첫 번째만 바로 적용하고
  // 나머지는 ticketQueue에 담아 뒀다가, 첫 항공편을 저장(handleSubmit)할 때마다 하나씩 이어서 등록 화면에 올린다.
  // readId: 이 분석을 시작한 사진의 번호. 그 사이 다른 사진을 골랐거나 창을 닫았으면 결과를 버린다.
  async function analyzeTicket(ticket, readId) {
    let tickets = null;
    try {
      const { data, error } = await supabase.functions.invoke("analyze-ticket", {
        body: { imageBase64: ticket.base64, mimeType: ticket.mime },
        timeout: ANALYZE_TIMEOUT_MS,
      });
      if (error) console.warn("[flight] 항공권 분석 요청 실패", error.name);
      else if (data && typeof data === "object" && !data.error && Array.isArray(data.tickets)) tickets = data.tickets;
    } catch (err) {
      console.warn("[flight] 항공권 분석 요청 실패", err?.name);
    }

    if (readId !== state.ticketReadId) return;
    state.ticket = null; // base64는 분석에만 쓴다. 더 필요 없으니 메모리에서 버린다 (미리보기 그림만 화면에 남는다)

    if (!tickets || tickets.length === 0) {
      showTicketStatus("");
      ui.showToast(ANALYZE_FAIL_TOAST);
      return;
    }
    const [first, ...rest] = tickets;
    state.ticketQueue = rest;
    applyScanAndAdvance(first);
  }

  // 웹(FileReader)과 네이티브(Camera.getPhoto)가 각자 만든 "data:mime;base64,..." 문자열을 여기서 합친다:
  // 크기를 확인하고, 미리보기를 채우고, 분석까지 이어서 한다. readId는 clearTicket()이 매긴 "이번 시도"
  // 번호로, 그 사이 다른 사진을 골랐거나 창을 닫았으면(readId가 달라졌으면) 버린다.
  function applyTicketDataUrl(dataUrl, readId) {
    if (readId !== state.ticketReadId) return;
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const approxBytes = Math.ceil((base64.length * 3) / 4); // base64는 원본보다 대략 4/3배 길다
    if (approxBytes > MAX_TICKET_BYTES) {
      clearTicket();
      return showTicketStatus("사진이 너무 커요. 20MB 이하의 사진을 선택해주세요.", "error");
    }
    const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] || "image/jpeg";
    state.ticket = { mime, base64 };
    els.ticketImg.src = dataUrl; // 미리보기 (브라우저 안에서만 쓰는 주소)
    els.ticketPreview.hidden = false;
    showTicketStatus("항공권 분석 중...", "busy");
    analyzeTicket(state.ticket, readId);
  }

  // 웹: 기존 <input type="file">에서 고른 사진을 읽는다. (네이티브는 captureTicketPhoto를 대신 쓴다.)
  function readTicketFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      clearTicket();
      return showTicketStatus("이미지 파일만 선택할 수 있어요.", "error");
    }
    if (file.size > MAX_TICKET_BYTES) {
      clearTicket();
      return showTicketStatus("사진이 너무 커요. 20MB 이하의 사진을 선택해주세요.", "error");
    }

    clearTicket();
    const readId = state.ticketReadId; // clearTicket이 번호를 올렸으므로, 이 값이 "이번 읽기"의 번호다
    showTicketStatus("사진을 불러오는 중...", "busy");

    const reader = new FileReader();
    reader.onload = () => applyTicketDataUrl(String(reader.result), readId);
    reader.onerror = () => {
      if (readId !== state.ticketReadId) return;
      clearTicket();
      showTicketStatus("사진을 읽지 못했어요. 다시 선택해주세요.", "error");
    };
    reader.readAsDataURL(file);
  }

  // 네이티브 앱: @capacitor/camera의 (구)getPhoto()로 사진에서 선택/카메라 촬영을 모두 처리한다(source로 구분).
  // 번들러가 없는 프로젝트라 그 npm 패키지의 JS를 불러오지 않고, 네이티브 브리지가 항상 올려 두는 범용
  // 플러그인 프록시(window.Capacitor.Plugins.<이름>)를 그대로 쓴다(auth.js#initDeepLinks와 같은 방식).
  // getPhoto는 Capacitor 8.1부터 takePhoto/chooseFromGallery에 자리를 내주는 중이라 문서상 @deprecated지만,
  // 아직 남아 있고 resultType: "dataUrl"로 base64까지 바로 주는 유일한 메서드라서 그대로 쓴다.
  async function captureTicketPhoto(source) {
    clearTicket();
    const readId = state.ticketReadId;
    showTicketStatus("사진을 불러오는 중...", "busy");
    try {
      const photo = await window.Capacitor.Plugins.Camera.getPhoto({
        resultType: "dataUrl",
        source,
        quality: 85,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (readId !== state.ticketReadId) return; // 그 사이 다른 사진을 골랐거나 창을 닫았다
      if (!photo?.dataUrl) {
        clearTicket();
        return showTicketStatus("사진을 가져오지 못했어요. 다시 시도해주세요.", "error");
      }
      applyTicketDataUrl(photo.dataUrl, readId);
    } catch (err) {
      if (readId !== state.ticketReadId) return;
      clearTicket();
      // 사용자가 카메라/갤러리를 취소했을 때도 여기로 온다("User cancelled photos app") — 그건 오류가 아니니 조용히 넘어간다.
      if (!/cancel/i.test(err?.message ?? "")) showTicketStatus("사진을 가져오지 못했어요. 다시 시도해주세요.", "error");
    }
  }

  // ---- 단계 이동 / 조회 ----

  function goTo(step) {
    state.step = step;
    hideError();
    render();
  }

  function goBack() {
    if (state.step === 0) {
      // 새로 추가하는 중이고(수정이 아니고) 이미 한 경로(사진/직접)를 골랐다면, 선택 화면으로 되돌아간다.
      // 수정 중이거나 아직 선택 화면이면(back이 숨겨져 있어 여기 닿지 않는다) 더 갈 곳이 없다.
      if (!state.editingId && state.path) {
        state.path = null;
        state.dayRequired = false;
        state.airlineRequired = false;
        state.step = 0;
        hideError();
        return render();
      }
      return;
    }
    state.lookupId += 1; // 조회 중에 뒤로 가면 늦게 도착한 결과는 무시한다
    state.loading = false;
    goTo(state.step - 1);
  }

  // 항공권에서 읽은 값을 3단계 입력칸에 채운다 (읽지 못한 값은 그대로 둔다). 하나라도 채웠으면 true.
  function fillFromScan(scan) {
    let filled = false;
    if (scan.depAirport) (setAirport(els.depAirport, scan.depAirport), (filled = true));
    if (scan.arrAirport) (setAirport(els.arrAirport, scan.arrAirport), (filled = true));
    if (scan.depTime) ((els.depTime.value = scan.depTime), (filled = true));
    if (scan.arrTime) ((els.arrTime.value = scan.arrTime), (filled = true));
    return filled;
  }

  // 항공권에서 읽은 값 중 지금 입력한 항공편과 맞는 것. 편명을 읽지 못했으면 같은 항공권의 값으로 본다.
  function scanForCurrentFlight() {
    const scan = state.scan;
    return scan && (!scan.flightNo || scan.flightNo === currentFlight().flightNo) ? scan : null;
  }

  async function startLookup() {
    const number = currentFlightNumber();
    const lookupId = ++state.lookupId;
    const scan = scanForCurrentFlight();
    setAutofillNotice("confirm", null);

    // 항공권에서 출발·도착 공항과 시간을 모두 읽었으면 다시 조회하지 않고 그 값을 보여준다
    if (scan?.depAirport && scan.arrAirport && scan.depTime && scan.arrTime) {
      state.loading = false;
      fillFromScan(scan);
      setLookupStatus(
        `항공권에서 읽은 정보: ${airportName(scan.depAirport)} ${scan.depTime} → ${airportName(scan.arrAirport)} ${scan.arrTime}`,
        "ok",
        "틀린 곳이 있으면 직접 수정할 수 있어요."
      );
      setAutofillNotice("confirm", AUTOFILL_NOTICE);
      return goTo(confirmStepIndex());
    }

    state.loading = true;
    setAirport(els.depAirport, "");
    setAirport(els.arrAirport, "");
    els.depTime.value = "";
    els.arrTime.value = "";
    setLookupStatus("편명으로 항공편을 조회하는 중...");
    goTo(confirmStepIndex());

    const result = await fetchFlightInfo(state.airlineCode, number, state.date);
    if (lookupId !== state.lookupId) return;

    state.loading = false;
    if (result.status === "found") {
      setAirport(els.depAirport, result.dep);
      setAirport(els.arrAirport, result.arr);

      if (result.depTime && result.arrTime) {
        els.depTime.value = result.depTime;
        els.arrTime.value = result.arrTime;
        setLookupStatus(
          `조회 완료: ${airportName(result.dep)} ${result.depTime} → ${airportName(result.arr)} ${result.arrTime}`,
          "ok",
          result.approx
            ? "최근 운항 기록 기준 시간이에요. 여행 날짜에는 다를 수 있으니 항공권과 꼭 확인해주세요."
            : "시간이 다르면 직접 수정할 수 있어요."
        );
      } else {
        setLookupStatus(`노선 조회 완료: ${airportName(result.dep)} → ${airportName(result.arr)}`, "ok", TIME_NOTES[result.note]);
      }
    } else {
      applyDefaultAirports();
      const message =
        result.status === "error"
          ? "조회에 실패했어요. 공항과 시간을 직접 입력해주세요."
          : "이 편명의 노선 정보를 찾지 못했어요. 공항과 시간을 직접 입력해주세요.";
      setLookupStatus(message, "warn", TIME_NOTES[result.note]);
    }
    // 항공권에서 읽은 값이 조회 결과보다 정확하니 덮어쓴다 (읽지 못한 값은 조회 결과를 그대로 둔다)
    if (scan && fillFromScan(scan)) setAutofillNotice("confirm", AUTOFILL_NOTICE);
    render();
  }

  function handleNext() {
    const steps = stepsFor();
    const mode = steps[state.step];
    if (mode === "day") {
      // 사진 경로에서 날짜(Day) 다음이 곧바로 확인 화면이면(항공사·편명은 이미 다 읽었으면) 조회까지 이어서 한다
      return steps[state.step + 1] === "confirm" ? startLookup() : goTo(state.step + 1);
    }
    if (mode === "airline") return startLookup();
    handleSubmit();
  }

  let saving = false;

  // 항공편 하나를 저장한 뒤, 왕복 항공권 등에서 이어서 등록할 항공편이 남아 있으면(ticketQueue) 그것을
  // 다음 대상으로 올린다 (지금 입력칸 값이 섞이지 않도록 비운 뒤 applyScanAndAdvance로 다시 채운다).
  function continueTicketQueueOrClose() {
    if (state.path !== "photo" || state.ticketQueue.length === 0) {
      closeForm();
      return;
    }
    const next = state.ticketQueue.shift();
    state.editingId = null;
    state.airlineCode = null;
    els.flightNo.value = "";
    els.airlineSearch.value = "";
    els.depTime.value = "";
    els.arrTime.value = "";
    setAirport(els.depAirport, "");
    setAirport(els.arrAirport, "");
    hideError();
    ui.showToast("이어서 다른 항공편도 등록할게요. 내용을 확인해주세요.");
    applyScanAndAdvance(next);
  }

  async function handleSubmit() {
    if (saving) return;
    const flight = currentFlight();

    if (!flight.depAirport || !flight.arrAirport) return showError("출발 공항과 도착 공항을 선택해주세요.");
    if (flight.depAirport === flight.arrAirport) return showError("출발 공항과 도착 공항이 같아요.");
    if (!flight.depTime || !flight.arrTime) return showError("출발 시간과 도착 시간을 입력해주세요.");

    hideError();

    // 서버에 저장한다. 실패하면 창을 닫지 않고 알려서, 입력한 내용을 잃지 않게 한다.
    saving = true;
    els.btnNext.disabled = true;
    try {
      if (state.editingId) await updateItem(state.editingId, { date: state.date, flight });
      else await addItem({ tripId: getTrip()?.id ?? null, date: state.date, flight });
    } catch (err) {
      showError(err.message);
      return;
    } finally {
      saving = false;
      els.btnNext.disabled = false;
    }
    onChange();
    continueTicketQueueOrClose();
  }

  // ---- 상세 창 ----

  function openDetail(itemId) {
    const item = getItemById(itemId);
    if (!item?.flight) return;

    const f = item.flight;
    const dep = getAirport(f.depAirport);
    const arr = getAirport(f.arrAirport);
    const computed = computeFlight(f);
    const day = getTripDays().find((d) => d.date === item.date);

    state.detailItemId = itemId;
    state.deleteArmed = false;
    els.btnDetailDelete.textContent = "삭제";
    els.btnDetailDelete.classList.remove("btn-danger");

    els.detailTitle.textContent = `${f.flightNo} (${f.airlineName})`;
    els.detailDay.textContent = day ? `Day ${day.number} · ${day.label}` : item.date;

    const place = (a, code) => (a ? `${a.name} (${a.code})` : code);
    els.detailBody.innerHTML = `
      <div class="fd-stop">
        <span class="fd-time">${f.depTime}</span>
        <div class="fd-place">
          <span class="fd-role">출발</span>
          <strong>${escapeHtml(dep?.city ?? f.depAirport)}</strong>
          <span>${escapeHtml(place(dep, f.depAirport))}</span>
        </div>
      </div>
      <div class="fd-duration">
        <span class="fd-line"></span>
        <span class="fd-duration-text">✈ 소요시간 ${computed ? formatDuration(computed.minutes) : "-"}</span>
      </div>
      <div class="fd-stop">
        <span class="fd-time">${f.arrTime}${computed?.dayOffset > 0 ? `<sup>+${computed.dayOffset}</sup>` : ""}</span>
        <div class="fd-place">
          <span class="fd-role">도착</span>
          <strong>${escapeHtml(arr?.city ?? f.arrAirport)}</strong>
          <span>${escapeHtml(place(arr, f.arrAirport))}</span>
        </div>
      </div>`;

    els.detailOverlay.hidden = false;
  }

  function closeDetail() {
    els.detailOverlay.hidden = true;
    state.detailItemId = null;
  }

  async function handleDetailDelete() {
    // 실수로 지우지 않도록 첫 클릭은 확인 상태로만 바꾸고, 두 번째 클릭에서 삭제한다
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      els.btnDetailDelete.textContent = "정말 삭제";
      els.btnDetailDelete.classList.add("btn-danger");
      return;
    }
    try {
      await deleteItem(state.detailItemId);
    } catch (err) {
      ui.showToast(err.message);
      return;
    }
    closeDetail();
    onChange();
  }

  function handleDetailEdit() {
    const item = getItemById(state.detailItemId);
    closeDetail();
    if (item) openForm(item);
  }

  // ---- 이벤트 ----

  function init(onChangeCallback) {
    onChange = typeof onChangeCallback === "function" ? onChangeCallback : () => {};
    const html = airportOptionsHtml();
    els.depAirport.innerHTML = html;
    els.arrAirport.innerHTML = html;
  }

  els.dayChips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-date]");
    if (!chip) return;
    state.date = chip.dataset.date;
    renderDayChips();
    renderFooter();
  });

  els.airlineSearch.addEventListener("input", () => {
    state.query = els.airlineSearch.value;
    renderAirlineChips();
  });

  els.airlineChips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-airline]");
    if (!chip) return;
    state.airlineCode = chip.dataset.airline;
    renderAirlineChips();
    renderFlightPrefix();
    renderFooter();
  });

  els.flightNo.addEventListener("input", () => {
    els.flightNo.value = els.flightNo.value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
    renderFooter();
  });
  els.flightNo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state.airlineCode && currentFlightNumber()) startLookup();
  });

  // 사진 선택과 카메라 촬영: 네이티브 앱은 @capacitor/camera(captureTicketPhoto), 웹은 기존
  // <input type="file"> 그대로(readTicketFile) — 같은 사진을 다시 골라도 change가 나도록 읽은 뒤 값을 비운다.
  els.ticketPick.addEventListener("click", () => {
    if (auth.isNativeApp()) captureTicketPhoto(CAMERA_SOURCE.PHOTOS);
    else els.ticketFile.click();
  });
  els.ticketCamera.addEventListener("click", () => {
    // 실제 카메라를 열기 전에 권한 안내 모달을 한 번 보여준다 (permissionPrompt.js 참고) - "사진에서 선택"
    // (ticketPick)에는 적용하지 않는다, 카메라 권한과 무관해서다.
    permissionPrompt.askCamera(() => {
      if (auth.isNativeApp()) captureTicketPhoto(CAMERA_SOURCE.CAMERA);
      else els.ticketCameraFile.click();
    });
  });
  [els.ticketFile, els.ticketCameraFile].forEach((input) =>
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      readTicketFile(file);
    })
  );
  els.ticketClear.addEventListener("click", clearTicket);

  // 선택 화면의 "직접 등록할게요": 날짜(Day) 선택부터 시작하는 기존 순서로 들어간다
  els.manualBtn.addEventListener("click", () => {
    state.path = "manual";
    state.step = 0;
    hideError();
    render();
  });

  els.apiSave.addEventListener("click", () => {
    const key = els.apiKey.value.trim();
    if (!key) return;
    setApiKey(key);
    renderApiState();
  });
  els.apiClear.addEventListener("click", () => {
    setApiKey("");
    renderApiState();
  });

  [els.depAirport, els.arrAirport].forEach((el) => el.addEventListener("change", renderDuration));
  [els.depTime, els.arrTime].forEach((el) => el.addEventListener("input", renderDuration));
  els.overlay.addEventListener("input", hideError);
  els.overlay.addEventListener("change", hideError);

  els.btnNext.addEventListener("click", handleNext);
  els.back.addEventListener("click", goBack);
  els.btnClose.addEventListener("click", closeForm);

  els.btnDetailClose.addEventListener("click", closeDetail);
  els.btnDetailEdit.addEventListener("click", handleDetailEdit);
  els.btnDetailDelete.addEventListener("click", handleDetailDelete);

  window.TripLog = window.TripLog || {};
  window.TripLog.flight = { init, openForm, openDetail, summary };
})();
