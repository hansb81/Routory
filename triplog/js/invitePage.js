// @별칭 INVITE-PAGE · 초대 수락 화면 (#/invite/:code)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 초대 화면(#/invite/:code): 초대 링크를 연 사람이 그 여행의 멤버가 되는 화면.
// 로그인하지 않았으면 app.js의 화면 보호가 #/login?redirect=/invite/:code 로 보내고, 로그인하면 이 화면으로 돌아온다.
// 초대 확인과 멤버 추가는 서버 함수 accept_trip_invite(p_invite_code)가 한 번에 한다 (supabase/migrations/001):
//   초대를 받는 사람은 아직 멤버가 아니라서 RLS상 trip_invites를 읽을 수도 trip_members에 자기를 넣을 수도 없기 때문이다.
//   함수가 코드를 찾고 만료(expires_at)를 검사한 뒤, 내 user id로 trip_members에 넣고(이미 멤버면 unique(trip_id, user_id)로 건너뜀) trip id를 돌려준다.
// 성공하면 "여행에 참여했어요!"를 보여주고 잠시 뒤 #/schedule/:tripId 로 간다. 없는/만료된 코드는 "유효하지 않은 초대링크입니다".

(function () {
  const supabase = window.TripLog.supabase;
  const storage = window.TripLog.storage;
  const router = window.TripLog.router;
  const ui = window.TripLog.ui;
  const { escapeHtml } = window.TripLog.util;

  const REDIRECT_DELAY_MS = 1200;
  const CODE_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

  let runId = 0; // 화면에 다시 들어오거나 재시도하면 이전 처리의 늦은 결과를 버리는 번호

  function setBody(el, { icon, title, note, actions = "" }) {
    el.innerHTML = `
      <section class="invite-page" data-alias="INVITE-PAGE-BODY · 초대 확인/결과 안내">
        <div class="invite-page-icon" aria-hidden="true">${icon}</div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        ${note ? `<p class="page-note">${escapeHtml(note)}</p>` : ""}
        ${actions}
      </section>`;
  }

  const homeButton = `<button type="button" class="btn btn-save" data-action="home">메인으로 가기</button>`;

  function showLoading(el) {
    setBody(el, { icon: "⏳", title: "초대를 확인하고 있어요", note: "잠시만 기다려주세요..." });
  }

  function showInvalid(el) {
    setBody(el, {
      icon: "🔗",
      title: "유효하지 않은 초대링크입니다",
      note: "만료되었거나 존재하지 않는 링크예요. 초대한 사람에게 새 링크를 요청해주세요.",
      actions: homeButton,
    });
  }

  function showFailure(el, message) {
    setBody(el, {
      icon: "⚠️",
      title: "초대를 확인하지 못했어요",
      note: message,
      actions: `<button type="button" class="btn btn-save" data-action="retry">다시 시도</button>
                <button type="button" class="btn btn-cancel" data-action="home">메인으로 가기</button>`,
    });
  }

  // 서버 함수가 던진 오류를 화면으로 바꾼다
  function handleError(el, error) {
    console.warn("[invite] 초대 수락 실패", error);
    const text = `${error?.message ?? ""} ${error?.code ?? ""}`;
    if (text.includes("invite_invalid_or_expired")) return showInvalid(el);
    if (text.includes("login_required")) return router.navigate(`${router.buildPath("login")}?redirect=${encodeURIComponent(el.dataset.path)}`, { replace: true });
    if (/PGRST202|42883/.test(text)) {
      return showFailure(el, "서버에 초대 기능이 아직 없어요. supabase/migrations의 SQL을 먼저 실행해주세요.");
    }
    showFailure(el, error?.message && !/[a-z_]{6,}/.test(error.message) ? error.message : "인터넷 연결을 확인하고 다시 시도해주세요.");
  }

  async function accept(el, code, id) {
    if (!CODE_PATTERN.test(code)) return showInvalid(el); // 모양부터 틀린 코드는 서버에 묻지 않는다

    let tripId;
    try {
      const { data, error } = await supabase.rpc("accept_trip_invite", { p_invite_code: code });
      if (error) throw error;
      tripId = data;
    } catch (err) {
      if (id === runId) handleError(el, err);
      return;
    }
    if (id !== runId) return;

    // 새 여행이 내 여행 목록에 들어와야 schedule 화면의 가드(없는 여행이면 메인으로)를 통과한다
    const alreadyMember = Boolean(storage.getTripById(tripId));
    try {
      await storage.refreshTrips();
      if (!storage.getTripById(tripId)) throw new Error("참여한 여행을 목록에서 찾지 못했어요.");
    } catch (err) {
      if (id === runId) handleError(el, err);
      return;
    }
    if (id !== runId) return;

    const message = alreadyMember ? "이미 참여 중인 여행이에요" : "여행에 참여했어요!";
    const tripPath = router.buildPath("schedule", { id: tripId });
    setBody(el, {
      icon: "🎉",
      title: message,
      note: "잠시 뒤 여행 화면으로 이동해요.",
      actions: `<a class="btn btn-save" href="#${tripPath}">지금 이동</a>`,
    });
    ui.showToast(message);
    setTimeout(() => {
      // 그 사이에 다른 화면으로 옮겼거나 다시 시도했다면 건드리지 않는다
      if (id === runId && router.current()?.route.name === "invite") router.navigate(tripPath, { replace: true });
    }, REDIRECT_DELAY_MS);
  }

  function render(el, { params, path }) {
    const id = ++runId;
    el.dataset.code = params.code;
    el.dataset.path = path;

    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (action === "home") router.navigate(router.buildPath("main"));
        if (action === "retry") {
          const retryId = ++runId;
          showLoading(el);
          accept(el, el.dataset.code, retryId);
        }
      });
    }

    showLoading(el);
    accept(el, params.code, id);
  }

  router.definePage("invite", render);
  router.onLeave("invite", () => (runId += 1)); // 떠난 뒤에 도착한 결과로 화면이 바뀌거나 이동하지 않게 한다
})();
