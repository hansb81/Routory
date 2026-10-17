// @별칭 MEMBERS · 참여 인원 표시 · 멤버 관리 창
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
// 나의 여행 화면의 참여 인원 표시와, SHELL 우측 메뉴(tripShell.js)의 '동행자 관리'가 여는 멤버 창.
//  - 헤더 아래에 참여자의 프로필 이미지를 작게 겹쳐 보여준다 (3명까지 원형 아바타, 나머지는 "+N명").
//  - 멤버 창(open/openManage)은 owner와 초대받은 참여자(editor) 모두 열 수 있지만 내용이 다르다: owner는
//    각 멤버 옆에 '내보내기' 버튼이 있고(실수로 누르지 않게 두 번 눌러야 지워진다), editor는 내보내기 없이
//    함께 하는 멤버 목록만 본다. 내보내기는 trip_members에서 그 행을 지운다 (RLS: owner만, 자기 자신은 못 지움).
// 멤버 이름과 프로필 사진은 로그인 정보(auth.users)에 있어서 클라이언트가 직접 읽을 수 없다. 서버 함수 get_trip_members
// (supabase/migrations/003)가 이 여행의 멤버에게만 이름·사진을 돌려주고, 그 함수가 없으면 이름 없이 인원수만 보여준다.

(function () {
  const storage = window.TripLog.storage;
  const auth = window.TripLog.auth;
  const router = window.TripLog.router;
  const ui = window.TripLog.ui;
  const { escapeHtml } = window.TripLog.util;

  const MAX_AVATARS = 3;

  // ---- 멤버 표시 ----

  // 나는 로그인 정보의 이름·사진을 쓴다 (서버 함수가 없어 이름을 못 받은 경우에도 내 이름은 보인다)
  function withSelf(members) {
    const myId = auth.getUserId();
    const profile = auth.getProfile();
    return members.map((m) => (m.userId === myId && profile ? { ...m, name: m.name || profile.name, avatarUrl: m.avatarUrl || profile.avatarUrl } : m));
  }

  function displayName(member) {
    return member.name || "이름 없는 멤버";
  }

  // 이름의 첫 글자를 깔아 두고 그 위에 사진을 얹는다: 사진이 없거나 못 불러오면 글자가 보인다
  function avatarHtml(member) {
    const initial = (member.name || "?").slice(0, 1);
    return `<span class="member-avatar" title="${escapeHtml(displayName(member))}">
      <span class="member-avatar-initial">${escapeHtml(initial)}</span>
      ${member.avatarUrl ? `<img src="${escapeHtml(member.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : ""}
    </span>`;
  }

  // 프로필 사진을 못 불러오면(error는 버블링되지 않아 캡처로 받는다) 사진을 치워 깔아 둔 글자가 보이게 한다
  function removeBrokenAvatars(root) {
    root.addEventListener(
      "error",
      (e) => {
        if (e.target.matches?.(".member-avatar img")) e.target.remove();
      },
      true
    );
  }

  // ---- 헤더 아래 아바타 줄 ----

  let mountId = 0;

  function stackHtml(members, canManage) {
    const shown = members.slice(0, MAX_AVATARS);
    const rest = members.length - shown.length;
    const inner = `
      <span class="member-avatars">${shown.map(avatarHtml).join("")}</span>
      ${rest > 0 ? `<span class="member-more">+${rest}명</span>` : ""}
      ${canManage ? `<span class="member-manage">멤버 관리 ›</span>` : ""}`;
    const label = `참여 인원 ${members.length}명`;
    return canManage
      ? `<button type="button" class="member-stack" data-action="members" aria-label="${label}, 멤버 관리">${inner}</button>`
      : `<div class="member-stack" role="img" aria-label="${label}">${inner}</div>`;
  }

  // container 안에 이 여행의 참여자 아바타 줄을 그린다. 멤버를 불러오지 못하면 줄을 숨긴다.
  async function mount(container, trip) {
    const myMount = ++mountId;
    container.dataset.mountId = String(myMount);
    container.hidden = true;
    if (!container.dataset.bound) {
      container.dataset.bound = "1";
      removeBrokenAvatars(container);
      container.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="members"]')) openManage(trip);
      });
    }

    let members;
    try {
      members = withSelf(await storage.loadMembers(trip.id));
    } catch (err) {
      console.warn("[members] 참여자를 불러오지 못했습니다.", err);
      return;
    }
    if (container.dataset.mountId !== String(myMount) || !members.length) return; // 그 사이에 다시 그렸다
    container.innerHTML = stackHtml(members, trip.role === "owner");
    container.hidden = false;
  }

  // ---- 멤버 관리 창 (owner/editor 모두 열 수 있다 - 내보내기만 owner 전용) ----

  let overlay = null;
  let manageTrip = null;
  let armedUserId = null; // '정말 내보내기'로 바뀐(한 번 눌린) 멤버
  let manageRun = 0;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.dataset.alias = "MEMBERS-MANAGE · 멤버 관리 창";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal member-modal" role="dialog" aria-modal="true" aria-labelledby="member-modal-title">
        <h2 class="modal-title" id="member-modal-title">멤버 관리</h2>
        <p class="member-note" data-member-note></p>
        <ul class="member-list" data-member-list></ul>
        <div class="modal-actions">
          <div class="modal-actions-right">
            <button type="button" class="btn btn-save" data-action="member-close">닫기</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    removeBrokenAvatars(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="member-close"]')) return closeManage();
      const kick = e.target.closest("[data-kick]");
      if (kick) kickMember(kick.dataset.kick);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeManage();
    });
  }

  function rowHtml(member, myId, viewerIsOwner) {
    const isMe = member.userId === myId;
    const isOwner = member.role === "owner";
    const badge = isOwner ? "만든 사람" : "참여자";
    const armed = armedUserId === member.userId;
    // 내보내기는 owner만 할 수 있다 (만든 사람 자신과 나 자신은 대상에서 뺀다)
    const action = !viewerIsOwner || isOwner || isMe ? "" : `<button type="button" class="btn ${armed ? "btn-danger" : "btn-cancel"} member-kick" data-kick="${escapeHtml(member.userId)}">${armed ? "정말 내보내기" : "내보내기"}</button>`;
    return `
      <li class="member-row" data-name="${escapeHtml(displayName(member))}">
        ${avatarHtml(member)}
        <span class="member-info">
          <strong class="member-name">${escapeHtml(displayName(member))}${isMe ? ' <span class="member-me">나</span>' : ""}</strong>
          <span class="member-role">${badge}</span>
        </span>
        ${action}
      </li>`;
  }

  async function renderManage() {
    const run = ++manageRun;
    const list = overlay.querySelector("[data-member-list]");
    const note = overlay.querySelector("[data-member-note]");
    const viewerIsOwner = manageTrip.role === "owner";
    overlay.querySelector("#member-modal-title").textContent = viewerIsOwner ? "멤버 관리" : "함께하는 멤버";
    note.textContent = "멤버를 불러오는 중이에요...";
    note.hidden = false;

    let members;
    try {
      members = withSelf(await storage.loadMembers(manageTrip.id));
    } catch (err) {
      if (run !== manageRun) return;
      list.innerHTML = "";
      note.textContent = err.message;
      return;
    }
    if (run !== manageRun) return;

    const myId = auth.getUserId();
    list.innerHTML = members.map((m) => rowHtml(m, myId, viewerIsOwner)).join("");
    if (!viewerIsOwner) {
      note.textContent = "함께 여행하는 멤버예요.";
    } else {
      const others = members.filter((m) => m.role !== "owner");
      note.textContent = others.length ? "내보낸 멤버는 초대 링크로 다시 들어올 수 있어요." : "아직 참여한 사람이 없어요. '여행 공유'로 링크를 보내보세요.";
    }
    note.hidden = false;
  }

  function openManage(trip) {
    if (!trip) return;
    ensureOverlay();
    manageTrip = trip;
    armedUserId = null;
    overlay.hidden = false;
    renderManage();
  }

  function closeManage() {
    if (!overlay) return;
    manageRun += 1;
    overlay.hidden = true;
    armedUserId = null;
  }

  // 첫 번째 누름은 '정말 내보내기'로 바꾸기만 하고, 같은 멤버를 한 번 더 누르면 지운다
  async function kickMember(userId) {
    if (armedUserId !== userId) {
      armedUserId = userId;
      renderManage();
      return;
    }
    const button = overlay.querySelector(`[data-kick="${CSS.escape(userId)}"]`);
    const name = button?.closest(".member-row")?.dataset.name || "멤버";
    if (button) button.disabled = true;
    try {
      await storage.removeMember(manageTrip.id, userId);
    } catch (err) {
      armedUserId = null;
      ui.showToast(err.message);
      renderManage();
      return;
    }
    armedUserId = null;
    ui.showToast(`${name}님을 내보냈어요.`);
    await renderManage();
    const container = document.querySelector(`[data-page="my-trip"] [data-members]`);
    if (container) mount(container, manageTrip); // 헤더의 아바타 줄도 새로 고친다
  }

  // SHELL이 보이는 화면들(my-trip/schedule/budget/wallet/lodging) 어디서든 열 수 있어서, 그중 어느 화면을
  // 벗어나도 닫아야 한다 (tripShell.js의 SHELL_ROUTES와 같은 목록).
  ["my-trip", "schedule", "budget", "wallet", "lodging"].forEach((name) => router.onLeave(name, closeManage));

  window.TripLog = window.TripLog || {};
  window.TripLog.tripMembers = { mount, open: openManage };
})();
