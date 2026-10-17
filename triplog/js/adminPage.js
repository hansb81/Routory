// /admin — SPA(index.html) 밖의 독립 관리 페이지(admin.html) 전용 스크립트.
// window.TripLog.supabase(js/supabaseClient.js)를 그대로 쓴다 — 같은 오리진이라 메인 앱에서 이미
// 로그인한 세션(localStorage)을 그대로 읽는다. 이 파일 자체는 다른 화면이 가져다 쓰지 않으므로
// window.TripLog에 아무것도 노출하지 않는다.
//
// 접근 제어 2단계(CLAUDE.md 지시): ① 여기서 로그인+is_admin() 확인해서 아니면 화면을 숨긴다(404처럼 보이게),
// ② 그걸로 끝내지 않고 모든 쓰기(insert/update/delete)와 draft/archived 조회가 DB RLS의 is_admin()
// 정책으로도 막혀 있다(020_admins.sql~023_travel_feed_source_checks.sql) — 화면만 숨겨서 되는 게 아니라
// 이 페이지의 JS를 끄거나 우회해도 서버가 거부한다.

(function () {
  "use strict";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function truncate(str, n) {
    if (!str) return "";
    return str.length > n ? str.slice(0, n) + "…" : str;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ko-KR");
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ko-KR");
  }

  function importanceLabel(v) {
    return { high: "높음", medium: "보통", low: "낮음" }[v] || v;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentYyyyMm() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  function isHttpsUrl(url) {
    return /^https:\/\//i.test(url || "");
  }

  // ==========================================================================
  // 접근 제어 (로그인 + is_admin())
  // ==========================================================================

  function showNotFound() {
    qs("#admin-gate-loading").hidden = true;
    qs("#admin-notfound").hidden = false;
  }

  async function initGate() {
    const supabase = window.TripLog && window.TripLog.supabase;
    if (!supabase) {
      showNotFound();
      return;
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData && sessionData.session;
      if (!session) {
        showNotFound();
        return;
      }
      const { data: isAdmin, error } = await supabase.rpc("is_admin");
      if (error || !isAdmin) {
        showNotFound();
        return;
      }
      qs("#admin-gate-loading").hidden = true;
      qs("#admin-app").hidden = false;
      qs("#admin-user-email").textContent = session.user.email || "";
      initAdminApp(supabase);
    } catch (err) {
      console.warn("[admin] 접근 확인 실패", err);
      showNotFound();
    }
  }

  // ==========================================================================
  // 관리자 앱 본체
  // ==========================================================================

  function initAdminApp(supabase) {
    const state = {
      feedStatus: "draft",
      feedRows: [],
      editingFeedId: null,
      adminLabels: new Map(),
      cities: [], // 추천 도시 목록(필터 적용 전 원본) - discover_cities + destinations + 집계값
      cityFilter: { notThisMonth: false, noImage: false },
      selectedCityId: null,
      selectedCityDest: null, // { name_ko, name_en, country_code } - destinations 쪽 값
      cityImages: [],
      cityMonths: [], // 12칸 고정, { month, score, reasonTag, reasonText }
      cityHighlights: [],
      quickReviewCities: [], // 빠른 검수 패널 전용 - { id, nameKo, countryCode, images: [...] }[]
    };

    // ---- 공용: 관리자 이메일 라벨 ----
    function labelForUser(uid) {
      if (!uid) return "—";
      return state.adminLabels.get(uid) || uid.slice(0, 8);
    }

    async function loadAdminLabels() {
      try {
        const { data } = await supabase.rpc("get_admin_labels");
        (data || []).forEach((row) => state.adminLabels.set(row.user_id, row.email));
      } catch (err) {
        console.warn("[admin] 관리자 라벨 조회 실패", err);
      }
    }

    // ---- 공용: 국가코드 셀렉트 채우기 ----
    async function loadCountryOptions() {
      const select = qs("#feed-country");
      try {
        const { data, error } = await supabase
          .from("country_currency")
          .select("country_code, region")
          .order("region")
          .order("country_code");
        if (error) throw error;
        (data || []).forEach((row) => {
          const opt = document.createElement("option");
          opt.value = row.country_code;
          opt.textContent = row.country_code + " · " + row.region;
          select.appendChild(opt);
        });
      } catch (err) {
        console.warn("[admin] 국가코드 목록 조회 실패", err);
      }
    }

    // ==========================================================================
    // 메인 탭 (여행 소식 / 인기 여행지)
    // ==========================================================================

    qsa("#admin-main-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        qsa("#admin-main-tabs .tab").forEach((b) => b.classList.remove("tab--active"));
        btn.classList.add("tab--active");
        const tab = btn.dataset.mainTab;
        qs("#admin-section-feed").hidden = tab !== "feed";
        qs("#admin-section-ranking").hidden = tab !== "ranking";
        qs("#admin-section-cities").hidden = tab !== "cities";
        if (tab === "cities") {
          showCityView("city-list-view");
          loadCityList();
        }
      });
    });

    // ==========================================================================
    // 여행 소식
    // ==========================================================================

    const feedForm = qs("#feed-form");
    const feedListEl = qs("#feed-list");
    const feedEmptyEl = qs("#feed-empty");

    qsa("#feed-status-tabs .tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        qsa("#feed-status-tabs .tab").forEach((b) => b.classList.remove("tab--active"));
        btn.classList.add("tab--active");
        state.feedStatus = btn.dataset.status;
        loadFeedList();
      });
    });

    async function loadFeedList() {
      feedListEl.innerHTML = "";
      feedEmptyEl.hidden = true;
      try {
        const { data, error } = await supabase
          .from("travel_feed_items")
          .select("*")
          .eq("status", state.feedStatus)
          .order("published_at", { ascending: false });
        if (error) throw error;
        state.feedRows = data || [];
        if (state.feedRows.length === 0) {
          feedEmptyEl.hidden = false;
          return;
        }
        feedListEl.innerHTML = state.feedRows.map(renderFeedItem).join("");
      } catch (err) {
        console.warn("[admin] 소식 목록 조회 실패", err);
        feedEmptyEl.hidden = false;
        feedEmptyEl.textContent = "목록을 불러오지 못했어요: " + (err.message || "");
      }
    }

    function renderFeedItem(row) {
      const badges = [
        '<span class="admin-badge">' + (row.kind === "safety" ? "안전" : "혜택") + "</span>",
        '<span class="admin-badge">' + (row.scope === "domestic" ? "국내" : "해외") + "</span>",
        '<span class="admin-badge' +
          (row.importance === "high" ? " admin-badge--importance-high" : "") +
          '">중요도 ' +
          importanceLabel(row.importance) +
          "</span>",
      ];
      if (row.origin === "auto") badges.push('<span class="admin-badge admin-badge--auto">자동 수집</span>');

      const actions = [
        '<button type="button" class="btn btn-cancel" data-action="edit" data-id="' + row.id + '">수정</button>',
      ];
      if (row.status !== "published") {
        actions.push('<button type="button" class="btn btn-save" data-action="publish" data-id="' + row.id + '">게시</button>');
      }
      if (row.status === "draft" && row.origin === "auto") {
        actions.push('<button type="button" class="btn btn-cancel" data-action="archive" data-id="' + row.id + '">반려</button>');
      } else if (row.status !== "archived") {
        actions.push('<button type="button" class="btn btn-cancel" data-action="archive" data-id="' + row.id + '">보관</button>');
      }
      actions.push('<button type="button" class="btn btn-delete" data-action="delete" data-id="' + row.id + '">삭제</button>');

      const autoLine =
        row.origin === "auto"
          ? '<p class="pick-sub">수집: ' +
            formatDateTime(row.created_at) +
            ' · <a href="' +
            escapeHtml(row.source_url) +
            '" target="_blank" rel="noopener">원문 보기</a></p>'
          : "";

      return (
        '<li class="pick-item" data-id="' + row.id + '">' +
        '<div class="pick-info">' +
        '<div class="admin-feed-badges">' + badges.join("") + "</div>" +
        '<p class="pick-name">' + escapeHtml(row.title) + "</p>" +
        '<p class="pick-sub">' + escapeHtml(truncate(row.summary, 80)) + "</p>" +
        '<p class="pick-sub">출처: <a href="' +
        escapeHtml(row.source_url) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(row.source_name) +
        "</a></p>" +
        autoLine +
        '<p class="pick-sub admin-feed-meta">게시일 ' +
        formatDate(row.published_at) +
        " · 만든이 " + escapeHtml(labelForUser(row.created_by)) +
        " · 수정 " + formatDateTime(row.updated_at) + "(" + escapeHtml(labelForUser(row.updated_by)) + ")" +
        " · 게시자 " + escapeHtml(labelForUser(row.published_by)) +
        "</p>" +
        "</div>" +
        '<div class="admin-feed-actions">' + actions.join("") + "</div>" +
        "</li>"
      );
    }

    feedListEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const row = state.feedRows.find((r) => r.id === id);

      if (action === "edit") {
        if (row) openFeedFormForEdit(row);
        return;
      }
      if (action === "delete") {
        if (!window.confirm("이 소식을 삭제할까요? 되돌릴 수 없어요.")) return;
        const { error } = await supabase.from("travel_feed_items").delete().eq("id", id);
        if (error) return window.alert("삭제하지 못했어요: " + error.message);
        return loadFeedList();
      }
      if (action === "publish") {
        const { error } = await supabase.from("travel_feed_items").update({ status: "published" }).eq("id", id);
        if (error) return window.alert("게시하지 못했어요: " + error.message);
        return loadFeedList();
      }
      if (action === "archive") {
        const { error } = await supabase.from("travel_feed_items").update({ status: "archived" }).eq("id", id);
        if (error) return window.alert("처리하지 못했어요: " + error.message);
        return loadFeedList();
      }
    });

    // ---- 등록/수정 폼 ----

    function toggleValidFields() {
      const isBenefit = qs("#feed-kind").value === "benefit";
      qs("#feed-valid-from-field").hidden = !isBenefit;
      qs("#feed-valid-to-field").hidden = !isBenefit;
    }
    qs("#feed-kind").addEventListener("change", toggleValidFields);

    function updateSummaryCount() {
      const len = qs("#feed-summary").value.length;
      qs("#feed-summary-count").textContent = len + "/200";
      qs("#feed-summary-warning").hidden = len <= 300;
    }
    qs("#feed-summary").addEventListener("input", updateSummaryCount);

    function showFeedFormError(message) {
      const el = qs("#feed-form-error");
      el.textContent = message;
      el.hidden = false;
    }
    function hideFeedFormError() {
      qs("#feed-form-error").hidden = true;
    }

    function openFeedFormForCreate() {
      state.editingFeedId = null;
      feedForm.reset();
      qs("#feed-form-title").textContent = "새 소식 등록";
      qs("#feed-published-at").value = todayStr();
      toggleValidFields();
      updateSummaryCount();
      hideFeedFormError();
      feedForm.hidden = false;
      feedForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function openFeedFormForEdit(row) {
      state.editingFeedId = row.id;
      qs("#feed-form-title").textContent = "소식 수정";
      qs("#feed-kind").value = row.kind;
      qs("#feed-scope").value = row.scope;
      qs("#feed-country").value = row.country_code || "";
      qs("#feed-region-label").value = row.region_label || "";
      qs("#feed-airline").value = row.airline_code || "";
      qs("#feed-importance").value = row.importance;
      qs("#feed-published-at").value = (row.published_at || "").slice(0, 10);
      qs("#feed-valid-from").value = row.valid_from || "";
      qs("#feed-valid-to").value = row.valid_to || "";
      qs("#feed-title").value = row.title || "";
      qs("#feed-summary").value = row.summary || "";
      qs("#feed-action-tip").value = row.action_tip || "";
      qs("#feed-source-name").value = row.source_name || "";
      qs("#feed-source-url").value = row.source_url || "";
      toggleValidFields();
      updateSummaryCount();
      hideFeedFormError();
      feedForm.hidden = false;
      feedForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeFeedForm() {
      feedForm.hidden = true;
      feedForm.reset();
      state.editingFeedId = null;
      hideFeedFormError();
    }

    qs("#feed-new-btn").addEventListener("click", openFeedFormForCreate);
    qs("#feed-form-cancel").addEventListener("click", closeFeedForm);

    function buildFeedPayload() {
      const kind = qs("#feed-kind").value;
      return {
        kind: kind,
        scope: qs("#feed-scope").value,
        country_code: qs("#feed-country").value || null,
        region_label: qs("#feed-region-label").value.trim(),
        airline_code: qs("#feed-airline").value.trim().toUpperCase() || null,
        title: qs("#feed-title").value.trim(),
        summary: qs("#feed-summary").value.trim(),
        action_tip: qs("#feed-action-tip").value.trim() || null,
        importance: qs("#feed-importance").value,
        published_at: qs("#feed-published-at").value || null,
        valid_from: kind === "benefit" ? qs("#feed-valid-from").value || null : null,
        valid_to: kind === "benefit" ? qs("#feed-valid-to").value || null : null,
        source_name: qs("#feed-source-name").value.trim(),
        source_url: qs("#feed-source-url").value.trim(),
      };
    }

    function validateFeedPayload(p) {
      if (!p.title) return "제목을 입력해주세요.";
      if (!p.region_label) return "지역 표기를 입력해주세요.";
      if (!p.summary) return "요약을 입력해주세요.";
      if (!p.published_at) return "게시일을 입력해주세요.";
      if (!p.source_name) return "출처 이름을 입력해주세요.";
      if (!p.source_url) return "출처 URL을 입력해주세요.";
      if (!isHttpsUrl(p.source_url)) return "출처 URL은 https://로 시작해야 해요.";
      return null;
    }

    feedForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = buildFeedPayload();
      const validationError = validateFeedPayload(payload);
      if (validationError) {
        showFeedFormError(validationError);
        return;
      }
      hideFeedFormError();
      try {
        if (state.editingFeedId) {
          const { error } = await supabase.from("travel_feed_items").update(payload).eq("id", state.editingFeedId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("travel_feed_items")
            .insert(Object.assign({}, payload, { status: "draft", origin: "manual" }));
          if (error) throw error;
        }
        closeFeedForm();
        await loadFeedList();
      } catch (err) {
        showFeedFormError(err.message || "저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });

    // ==========================================================================
    // 인기 여행지
    // ==========================================================================

    const rankingRowsEl = qs("#ranking-rows");

    function showRankingError(message) {
      const el = qs("#ranking-form-error");
      el.textContent = message;
      el.hidden = false;
    }
    function hideRankingError() {
      qs("#ranking-form-error").hidden = true;
    }

    function resetRankingRow(li) {
      li.dataset.existingId = "";
      li.dataset.destinationId = "";
      li.dataset.countryCode = "";
      li.querySelector(".admin-ranking-name").value = "";
      const countryEl = li.querySelector(".admin-ranking-country");
      countryEl.hidden = true;
      countryEl.textContent = "";
      li.querySelector(".admin-ranking-delete").hidden = true;
    }

    function bindRankingRow(li) {
      const input = li.querySelector(".admin-ranking-name");
      const list = li.querySelector(".admin-autocomplete-list");
      const countryEl = li.querySelector(".admin-ranking-country");
      const deleteBtn = li.querySelector(".admin-ranking-delete");

      const runSearch = debounce(async () => {
        const q = input.value.trim().replace(/[(),]/g, "");
        if (q.length < 1) {
          list.hidden = true;
          list.innerHTML = "";
          return;
        }
        try {
          const { data, error } = await supabase
            .from("destinations")
            .select("id, name_ko, name_en, country_code")
            .or("name_ko.ilike.%" + q + "%,name_en.ilike.%" + q + "%")
            .limit(8);
          if (error) throw error;
          if (!data || data.length === 0) {
            list.hidden = true;
            list.innerHTML = "";
            return;
          }
          list.innerHTML = data
            .map(
              (d) =>
                '<li class="pick-item" data-destination-id="' +
                d.id +
                '" data-country-code="' +
                escapeHtml(d.country_code || "") +
                '" data-name="' +
                escapeHtml(d.name_ko) +
                '"><span class="pick-name">' +
                escapeHtml(d.name_ko) +
                " (" + escapeHtml(d.name_en) + (d.country_code ? " · " + escapeHtml(d.country_code) : "") + ")" +
                "</span></li>"
            )
            .join("");
          list.hidden = false;
        } catch (err) {
          console.warn("[admin] 여행지 검색 실패", err);
        }
      }, 300);

      input.addEventListener("input", () => {
        li.dataset.destinationId = "";
        li.dataset.countryCode = "";
        countryEl.hidden = true;
        runSearch();
      });

      input.addEventListener("blur", () => {
        setTimeout(() => {
          list.hidden = true;
        }, 150); // 목록 클릭(mousedown→click)이 blur보다 먼저 처리되도록 살짝 늦춘다
      });

      list.addEventListener("click", (e) => {
        const item = e.target.closest("li[data-destination-id]");
        if (!item) return;
        input.value = item.dataset.name;
        li.dataset.destinationId = item.dataset.destinationId;
        li.dataset.countryCode = item.dataset.countryCode;
        countryEl.textContent = item.dataset.countryCode ? "(" + item.dataset.countryCode + ")" : "";
        countryEl.hidden = !item.dataset.countryCode;
        list.hidden = true;
        list.innerHTML = "";
      });

      deleteBtn.addEventListener("click", async () => {
        const existingId = li.dataset.existingId;
        if (!existingId) return;
        if (!window.confirm(li.querySelector(".admin-ranking-rank").textContent + " 항목을 삭제할까요?")) return;
        const { error } = await supabase.from("popular_destinations").delete().eq("id", existingId);
        if (error) return window.alert("삭제하지 못했어요: " + error.message);
        resetRankingRow(li);
      });
    }

    function renderRankingRows() {
      rankingRowsEl.innerHTML = "";
      for (let rank = 1; rank <= 10; rank++) {
        const li = document.createElement("li");
        li.className = "pick-item admin-ranking-row";
        li.dataset.rank = String(rank);
        li.dataset.existingId = "";
        li.dataset.destinationId = "";
        li.dataset.countryCode = "";
        li.innerHTML =
          '<span class="admin-ranking-rank">' + rank + "위</span>" +
          '<div class="admin-ranking-input-wrap">' +
          '<input type="text" class="search-input admin-ranking-name" placeholder="도시명 검색 (예: 도쿄)" autocomplete="off" />' +
          '<ul class="pick-list admin-autocomplete-list" hidden></ul>' +
          "</div>" +
          '<span class="admin-ranking-country" hidden></span>' +
          '<button type="button" class="btn-delete admin-ranking-delete" hidden>삭제</button>';
        rankingRowsEl.appendChild(li);
        bindRankingRow(li);
      }
    }

    async function loadRanking() {
      const scope = qs("#ranking-scope").value;
      const period = qs("#ranking-period").value;
      if (!period) {
        showRankingError("기준월을 선택해주세요.");
        return;
      }
      hideRankingError();
      try {
        const { data, error } = await supabase
          .from("popular_destinations")
          .select("*")
          .eq("scope", scope)
          .eq("period", period)
          .order("rank");
        if (error) throw error;

        renderRankingRows();
        const rowEls = qsa("#ranking-rows > li");
        (data || []).forEach((row) => {
          const li = rowEls[row.rank - 1];
          if (!li) return;
          li.dataset.existingId = row.id;
          li.dataset.destinationId = row.destination_id || "";
          li.dataset.countryCode = row.country_code || "";
          li.querySelector(".admin-ranking-name").value = row.name_ko;
          const countryEl = li.querySelector(".admin-ranking-country");
          countryEl.textContent = row.country_code ? "(" + row.country_code + ")" : "";
          countryEl.hidden = !row.country_code;
          li.querySelector(".admin-ranking-delete").hidden = false;
        });
        if (data && data[0]) {
          qs("#ranking-source-name").value = data[0].source_name || "";
          qs("#ranking-source-url").value = data[0].source_url || "";
        }
      } catch (err) {
        showRankingError("불러오지 못했어요: " + (err.message || ""));
      }
    }

    async function saveRanking(status) {
      const scope = qs("#ranking-scope").value;
      const period = qs("#ranking-period").value;
      const sourceName = qs("#ranking-source-name").value.trim();
      const sourceUrl = qs("#ranking-source-url").value.trim();

      if (!period) return showRankingError("기준월을 선택해주세요.");
      if (!sourceName) return showRankingError("출처 이름을 입력해주세요.");
      if (!sourceUrl) return showRankingError("출처 URL을 입력해주세요.");
      if (!isHttpsUrl(sourceUrl)) return showRankingError("출처 URL은 https://로 시작해야 해요.");
      hideRankingError();

      const rowEls = qsa("#ranking-rows > li");
      const upserts = [];
      const deletions = [];
      rowEls.forEach((li) => {
        const rank = Number(li.dataset.rank);
        const nameKo = li.querySelector(".admin-ranking-name").value.trim();
        const existingId = li.dataset.existingId;
        if (!nameKo) {
          if (existingId) deletions.push(existingId);
          return;
        }
        upserts.push({
          scope: scope,
          period: period,
          rank: rank,
          name_ko: nameKo,
          country_code: li.dataset.countryCode || null,
          destination_id: li.dataset.destinationId || null,
          source_name: sourceName,
          source_url: sourceUrl,
          status: status,
        });
      });

      try {
        if (deletions.length) {
          const { error } = await supabase.from("popular_destinations").delete().in("id", deletions);
          if (error) throw error;
        }
        if (upserts.length) {
          const { error } = await supabase
            .from("popular_destinations")
            .upsert(upserts, { onConflict: "scope,period,rank" });
          if (error) throw error;
        }
        await loadRanking();
      } catch (err) {
        showRankingError(err.message || "저장하지 못했어요.");
      }
    }

    qs("#ranking-load-btn").addEventListener("click", loadRanking);
    qs("#ranking-save-draft-btn").addEventListener("click", () => saveRanking("draft"));
    qs("#ranking-publish-btn").addEventListener("click", () => saveRanking("published"));

    // ==========================================================================
    // 추천 도시 (discover_cities 전체 관리 - 메인 화면 개선 단계 2 관리 페이지)
    // 접근 제어는 이 파일 맨 위 initGate()/is_admin()과 동일, 서버 쪽은 027_discover_cities.sql의 RLS가
    // 전부 is_admin()을 요구해서 이 화면의 JS를 거치지 않고 직접 API를 불러도 일반 사용자는 쓸 수 없다.
    // ==========================================================================

    const CITY_VIEWS = ["city-list-view", "city-add-panel", "city-preview-panel", "city-quick-review-panel", "city-detail"];
    function showCityView(name) {
      CITY_VIEWS.forEach((id) => (qs("#" + id).hidden = id !== name));
    }

    // 한국 시간 기준 "이번 달" - get_discover_cities(027_discover_cities.sql)와 같은 기준을 쓴다.
    function currentKstMonth() {
      const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      return kst.getMonth() + 1;
    }

    function slugifyCity(countryCode, nameEn) {
      return (countryCode + "-" + nameEn)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "city";
    }

    // travelFeed.js#hashString/discoverCardMediaHtml과 같은 공식을 그대로 둔다 - admin.html은 index.html의
    // 스크립트 번들을 안 불러와서 그 파일을 직접 재사용할 수 없다. 그 파일의 그라데이션 공식이 바뀌면
    // 여기도 같이 고쳐야 한다(대체 카드 미리보기/미리보기 목록 양쪽에서 쓴다).
    function hashString(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      return h;
    }
    function gradientIndexFor(countryCode, nameKo) {
      const key = countryCode === "KR" ? nameKo : countryCode;
      return (hashString(key || nameKo || "") % 6) + 1;
    }

    function fallbackCardHtml(d) {
      const initial = (d.name_ko || "").slice(0, 1);
      return (
        '<div class="dest-card-wrap" style="flex:0 0 132px">' +
        '<div class="dest-card">' +
        '<span class="dest-card-art" style="background: var(--dest-gradient-' +
        gradientIndexFor(d.country_code, d.name_ko) +
        ')">' +
        '<span class="dest-card-initial" aria-hidden="true">' +
        escapeHtml(initial) +
        "</span></span>" +
        '<span class="dest-card-name">' +
        escapeHtml(d.name_ko) +
        "</span></div></div>"
      );
    }

    // 저작자 표기(+라이선스) + 원본 링크 - 카드 미리보기/후보 카드 둘 다 이 한 줄을 공통으로 쓴다.
    function attributionLineHtml(img) {
      if (!img) return "";
      return (
        '<p class="admin-city-image-credit">사진: ' +
        escapeHtml(img.credit_name) +
        " · " +
        escapeHtml(img.license) +
        "</p>" +
        '<p class="admin-city-image-source"><a href="' +
        escapeHtml(img.source_url) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(img.source_name) +
        " 원본 보기</a></p>"
      );
    }

    // ---- 목록 (요청 1번) ----

    const cityListEl = qs("#city-list");
    const cityListEmptyEl = qs("#city-list-empty");

    async function loadCityList() {
      cityListEl.innerHTML = "";
      cityListEmptyEl.hidden = true;
      try {
        const month = currentKstMonth();
        const [citiesRes, monthsRes, imagesRes, highlightsRes] = await Promise.all([
          supabase.from("discover_cities").select("id, destination_id, tagline, is_active, destinations(name_ko, name_en, country_code)"),
          supabase.from("discover_city_months").select("city_id, score, reason_tag").eq("month", month),
          supabase.from("discover_city_images").select("city_id, status"),
          supabase.from("city_highlights").select("city_id"),
        ]);
        if (citiesRes.error) throw citiesRes.error;
        if (monthsRes.error) throw monthsRes.error;
        if (imagesRes.error) throw imagesRes.error;
        if (highlightsRes.error) throw highlightsRes.error;

        const monthByCity = new Map((monthsRes.data || []).map((r) => [r.city_id, r]));
        const hasPublishedImage = new Set((imagesRes.data || []).filter((r) => r.status === "published").map((r) => r.city_id));
        const highlightCountByCity = new Map();
        (highlightsRes.data || []).forEach((r) => highlightCountByCity.set(r.city_id, (highlightCountByCity.get(r.city_id) || 0) + 1));

        state.cities = (citiesRes.data || [])
          .filter((c) => c.destinations)
          .map((c) => ({
            id: c.id,
            destinationId: c.destination_id,
            nameKo: c.destinations.name_ko,
            nameEn: c.destinations.name_en,
            countryCode: c.destinations.country_code,
            tagline: c.tagline,
            isActive: c.is_active,
            hasImage: hasPublishedImage.has(c.id),
            thisMonth: monthByCity.get(c.id) || null,
            highlightCount: highlightCountByCity.get(c.id) || 0,
          }))
          .sort((a, b) => a.nameKo.localeCompare(b.nameKo, "ko"));

        renderCityList();
      } catch (err) {
        console.warn("[admin] 도시 목록 조회 실패", err);
        cityListEmptyEl.hidden = false;
        cityListEmptyEl.textContent = "목록을 불러오지 못했어요: " + (err.message || "");
      }
    }

    function renderCityList() {
      let rows = state.cities;
      if (state.cityFilter.notThisMonth) rows = rows.filter((c) => !c.thisMonth);
      if (state.cityFilter.noImage) rows = rows.filter((c) => !c.hasImage);

      if (rows.length === 0) {
        cityListEl.innerHTML = "";
        cityListEmptyEl.hidden = false;
        return;
      }
      cityListEmptyEl.hidden = true;
      cityListEl.innerHTML = rows
        .map((c) => {
          const badges = [
            '<span class="admin-badge' + (c.isActive ? "" : " admin-badge--auto") + '">' + (c.isActive ? "활성" : "비활성") + "</span>",
            '<span class="admin-badge' + (c.hasImage ? "" : " admin-badge--auto") + '">' + (c.hasImage ? "이미지 있음" : "이미지 없음") + "</span>",
          ];
          const monthLabel = c.thisMonth ? "이번 달 " + c.thisMonth.score + "점 · " + escapeHtml(c.thisMonth.reason_tag || "") : "이번 달 추천 안 됨";
          return (
            '<li class="pick-item" data-city-id="' +
            c.id +
            '">' +
            '<div class="pick-info">' +
            '<div class="admin-feed-badges">' +
            badges.join("") +
            "</div>" +
            '<p class="pick-name">' +
            escapeHtml(c.nameKo) +
            " (" +
            escapeHtml(c.countryCode) +
            ")</p>" +
            '<p class="pick-sub">' +
            monthLabel +
            " · 하이라이트 " +
            c.highlightCount +
            "개</p></div>" +
            '<button type="button" class="btn btn-cancel pick-btn" data-city-id="' +
            c.id +
            '">열기</button></li>'
          );
        })
        .join("");
    }

    qs("#city-filter-not-this-month").addEventListener("change", (e) => {
      state.cityFilter.notThisMonth = e.target.checked;
      renderCityList();
    });
    qs("#city-filter-no-image").addEventListener("change", (e) => {
      state.cityFilter.noImage = e.target.checked;
      renderCityList();
    });

    cityListEl.addEventListener("click", (e) => {
      const target = e.target.closest("[data-city-id]");
      if (target) openCityDetail(target.dataset.cityId);
    });

    // ---- 도시 추가 (요청 2번: PRD v12 도시 검색 → select로 확정 → discover_cities에 연결) ----

    const cityAddResultsEl = qs("#city-add-results");
    const cityAddResultsEmptyEl = qs("#city-add-results-empty");

    function showCityAddError(message) {
      const el = qs("#city-add-error");
      el.textContent = message;
      el.hidden = false;
    }
    function hideCityAddError() {
      qs("#city-add-error").hidden = true;
    }

    qs("#city-add-open-btn").addEventListener("click", () => {
      qs("#city-add-search").value = "";
      cityAddResultsEl.innerHTML = "";
      cityAddResultsEmptyEl.hidden = true;
      hideCityAddError();
      showCityView("city-add-panel");
    });
    qs("#city-add-cancel").addEventListener("click", () => showCityView("city-list-view"));

    const runCityAddSearch = debounce(async () => {
      const q = qs("#city-add-search").value.trim();
      cityAddResultsEl.innerHTML = "";
      cityAddResultsEmptyEl.hidden = true;
      if (q.length < 1) return;
      try {
        const { data, error } = await supabase.functions.invoke("search-destination", { body: { q, lang: "ko" } });
        if (error || data?.error) throw new Error(data?.error || error?.message);
        const results = data?.results || [];
        if (results.length === 0) {
          cityAddResultsEmptyEl.hidden = false;
          return;
        }
        cityAddResultsEl.innerHTML = results
          .map(
            (r, i) =>
              '<li class="pick-item" data-result-index="' +
              i +
              '"><div class="pick-info"><p class="pick-name">' +
              escapeHtml(r.name_ko) +
              " (" +
              escapeHtml(r.name_en) +
              (r.country_name_ko ? " · " + escapeHtml(r.country_name_ko) : "") +
              ")</p></div>" +
              '<button type="button" class="btn btn-save pick-btn" data-result-index="' +
              i +
              '">추가</button></li>'
          )
          .join("");
        cityAddResultsEl.dataset.resultsJson = JSON.stringify(results);
      } catch (err) {
        console.warn("[admin] 도시 검색 실패", err);
        cityAddResultsEmptyEl.hidden = false;
        cityAddResultsEmptyEl.textContent = "검색하지 못했어요: " + (err.message || "");
      }
    }, 300);
    qs("#city-add-search").addEventListener("input", runCityAddSearch);

    cityAddResultsEl.addEventListener("click", async (e) => {
      const target = e.target.closest("[data-result-index]");
      if (!target) return;
      const results = JSON.parse(cityAddResultsEl.dataset.resultsJson || "[]");
      const entry = results[Number(target.dataset.resultIndex)];
      if (!entry) return;
      hideCityAddError();

      // tripSetup.js#resolveSearchResult와 같은 우선순위: destinationId -> placeId -> name_en+country_code
      const payload = entry.id
        ? { action: "select", destinationId: entry.id }
        : entry.place_id
        ? { action: "select", placeId: entry.place_id, nameKo: entry.name_ko, nameEn: entry.name_en, countryCode: entry.country_code ?? undefined }
        : { action: "select", nameEn: entry.name_en, countryCode: entry.country_code, nameKo: entry.name_ko };

      try {
        const { data, error } = await supabase.functions.invoke("search-destination", { body: payload });
        if (error || data?.error || !data?.result) throw new Error(data?.error || error?.message || "도시 확정에 실패했어요.");
        const destinationId = data.result.id;

        const { data: upserted, error: upsertErr } = await supabase
          .from("discover_cities")
          .upsert({ destination_id: destinationId, is_active: true }, { onConflict: "destination_id" })
          .select("id")
          .single();
        if (upsertErr) throw upsertErr;

        await loadCityList();
        openCityDetail(upserted.id);
      } catch (err) {
        showCityAddError(err.message || "추가하지 못했어요.");
      }
    });

    // ---- 미리보기 (요청 6번) ----

    qs("#city-preview-open-btn").addEventListener("click", async () => {
      showCityView("city-preview-panel");
      const listEl = qs("#city-preview-list");
      const emptyEl = qs("#city-preview-empty");
      const errEl = qs("#city-preview-error");
      listEl.innerHTML = "";
      emptyEl.hidden = true;
      errEl.hidden = true;
      try {
        const { data, error } = await supabase.rpc("get_discover_cities", { p_limit: 20 });
        if (error) throw error;
        const rows = data || [];
        if (rows.length === 0) {
          emptyEl.hidden = false;
          return;
        }
        listEl.innerHTML = rows
          .map((r, i) => {
            const img = r.thumb_url || r.image_url;
            const thumb = img
              ? '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" />'
              : '<span class="admin-preview-fallback" style="background: var(--dest-gradient-' +
                gradientIndexFor(r.country_code, r.name_ko) +
                ')">' +
                escapeHtml((r.name_ko || "").slice(0, 1)) +
                "</span>";
            const weather = typeof r.temp_c === "number" ? Math.round(r.temp_c) + "°" : "";
            return (
              '<li class="admin-preview-item">' +
              '<span class="admin-preview-rank">' +
              (i + 1) +
              "</span>" +
              '<span class="admin-preview-thumb">' +
              thumb +
              "</span>" +
              '<span class="admin-preview-info"><strong>' +
              escapeHtml(r.name_ko) +
              "</strong> · " +
              escapeHtml(r.country_name_ko || r.country_code || "") +
              (r.reason_tag ? " · " + escapeHtml(r.reason_tag) : "") +
              (weather ? " · " + weather : "") +
              "</span></li>"
            );
          })
          .join("");
      } catch (err) {
        console.warn("[admin] 미리보기 조회 실패", err);
        errEl.hidden = false;
        errEl.textContent = "미리보기를 불러오지 못했어요: " + (err.message || "");
      }
    });
    qs("#city-preview-close-btn").addEventListener("click", () => showCityView("city-list-view"));

    // ---- 빠른 검수: 대표 이미지가 없는 도시를 한 화면에 쭉 나열해서 후보만 바로 비교·게시 ----
    // (요청: "27개 도시를 하나씩 들어갔다 나왔다 하는 게 번거로우니" - 도시 상세 화면을 거치지 않고
    // city_id 여러 개의 discover_city_images를 한 번에 불러와 쭉 늘어놓는다. 게시하면 그 도시는 바로
    // 목록에서 사라져서, "다음 도시로 이동" 없이 그냥 계속 스크롤하면서 훑으면 된다.

    function quickReviewCityHtml(city) {
      const header =
        '<h3 class="admin-city-section-title">' + escapeHtml(city.nameKo) + " (" + escapeHtml(city.countryCode) + ")</h3>";
      if (city.images.length === 0) {
        return (
          '<div class="admin-quick-review-city" data-city-id="' +
          city.id +
          '">' +
          header +
          '<p class="admin-empty">후보가 없어요. ' +
          '<button type="button" class="btn btn-cancel" data-action="open-detail" data-city-id="' +
          city.id +
          '">도시 상세로 이동(검색·업로드)</button></p></div>'
        );
      }
      const cards = city.images
        .map(
          (img) =>
            '<li class="admin-city-image-card" data-id="' +
            img.id +
            '"><img src="' +
            escapeHtml(img.thumb_url || img.image_url) +
            '" alt="" loading="lazy" />' +
            attributionLineHtml(img) +
            '<div class="admin-city-image-actions">' +
            '<button type="button" class="btn btn-save" data-action="publish" data-city-id="' +
            city.id +
            '" data-id="' +
            img.id +
            '">게시</button>' +
            '<button type="button" class="btn btn-delete" data-action="delete" data-city-id="' +
            city.id +
            '" data-id="' +
            img.id +
            '">삭제</button></div></li>'
        )
        .join("");
      return '<div class="admin-quick-review-city" data-city-id="' + city.id + '">' + header + '<ul class="admin-city-image-grid">' + cards + "</ul></div>";
    }

    function renderQuickReview() {
      const listEl = qs("#city-quick-review-list");
      const emptyEl = qs("#city-quick-review-empty");
      if (state.quickReviewCities.length === 0) {
        listEl.innerHTML = "";
        emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;
      listEl.innerHTML = state.quickReviewCities.map(quickReviewCityHtml).join("");
    }

    async function loadQuickReview() {
      const listEl = qs("#city-quick-review-list");
      const emptyEl = qs("#city-quick-review-empty");
      const errEl = qs("#city-quick-review-error");
      listEl.innerHTML = "불러오는 중...";
      emptyEl.hidden = true;
      errEl.hidden = true;
      try {
        if (state.cities.length === 0) {
          await loadCityList(); // 목록 탭을 아직 한 번도 안 열어봤을 수 있다
          if (state.cities.length === 0) throw new Error("도시 목록을 불러오지 못했어요."); // 조회 자체가 실패한 경우 - "전부 완료"로 오해하지 않도록 구분
        }
        const targets = state.cities.filter((c) => !c.hasImage);
        if (targets.length === 0) {
          state.quickReviewCities = [];
          listEl.innerHTML = "";
          emptyEl.hidden = false;
          return;
        }
        const ids = targets.map((c) => c.id);
        const { data, error } = await supabase.from("discover_city_images").select("*").in("city_id", ids).order("sort_order", { ascending: true });
        if (error) throw error;
        const imagesByCity = new Map();
        (data || []).forEach((img) => {
          if (!imagesByCity.has(img.city_id)) imagesByCity.set(img.city_id, []);
          imagesByCity.get(img.city_id).push(img);
        });
        state.quickReviewCities = targets.map((c) => ({ id: c.id, nameKo: c.nameKo, countryCode: c.countryCode, images: imagesByCity.get(c.id) || [] }));
        renderQuickReview();
      } catch (err) {
        console.warn("[admin] 빠른 검수 조회 실패", err);
        listEl.innerHTML = "";
        errEl.textContent = "불러오지 못했어요: " + (err.message || "");
        errEl.hidden = false;
      }
    }

    qs("#city-quick-review-open-btn").addEventListener("click", () => {
      showCityView("city-quick-review-panel");
      loadQuickReview();
    });
    qs("#city-quick-review-close-btn").addEventListener("click", () => {
      showCityView("city-list-view");
      loadCityList(); // 그사이 게시한 내용이 목록(이미지 있음/없음 배지)에 바로 반영되도록
    });

    qs("#city-quick-review-list").addEventListener("click", async (e) => {
      const openBtn = e.target.closest('button[data-action="open-detail"]');
      if (openBtn) {
        openCityDetail(openBtn.dataset.cityId);
        return;
      }

      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const cityId = btn.dataset.cityId;
      const imgId = btn.dataset.id;
      const action = btn.dataset.action;
      const cityEntry = state.quickReviewCities.find((c) => c.id === cityId);
      if (!cityEntry) return;

      if (action === "publish") {
        try {
          // 이 패널은 이미 "대표 이미지 없는 도시"만 모아 둔 거라 보통 내릴 published가 없지만, 혹시 모를
          // 경합(다른 탭에서 동시에 게시) 대비로 똑같이 먼저 내린다.
          const { error: demoteErr } = await supabase.from("discover_city_images").update({ status: "draft" }).eq("city_id", cityId).eq("status", "published");
          if (demoteErr) throw demoteErr;
          const { error } = await supabase.from("discover_city_images").update({ status: "published" }).eq("id", imgId);
          if (error) throw error;
        } catch (err) {
          window.alert("게시하지 못했어요: " + err.message);
          return;
        }
        // 대표 이미지가 생겼으니 이 도시는 빠른 검수 목록에서 바로 뺀다 - "다음 도시로" 없이 계속 스크롤하면 된다.
        state.quickReviewCities = state.quickReviewCities.filter((c) => c.id !== cityId);
        const listCity = state.cities.find((c) => c.id === cityId);
        if (listCity) listCity.hasImage = true;
        renderQuickReview();
        return;
      }

      if (action === "delete") {
        if (!window.confirm("이 후보를 삭제할까요? 되돌릴 수 없어요.")) return;
        const img = cityEntry.images.find((i) => i.id === imgId);
        const path = storageObjectPathFromPublicUrl(img?.image_url);
        const thumbPath = storageObjectPathFromPublicUrl(img?.thumb_url);
        const { error } = await supabase.from("discover_city_images").delete().eq("id", imgId);
        if (error) return window.alert("삭제하지 못했어요: " + error.message);
        const paths = [path, thumbPath].filter(Boolean);
        if (paths.length) {
          try {
            await supabase.storage.from("discover-images").remove(paths);
          } catch (storageErr) {
            console.warn("[admin] Storage 객체 정리 실패(무시)", storageErr);
          }
        }
        cityEntry.images = cityEntry.images.filter((i) => i.id !== imgId);
        renderQuickReview();
      }
    });

    // ---- 도시 상세: 공통 진입 ----

    async function openCityDetail(cityId) {
      state.selectedCityId = cityId;
      showCityView("city-detail");
      qs("#city-detail-title").textContent = "불러오는 중...";
      try {
        const { data: city, error } = await supabase
          .from("discover_cities")
          .select("id, tagline, is_active, destinations(name_ko, name_en, country_code)")
          .eq("id", cityId)
          .single();
        if (error) throw error;
        state.selectedCityDest = city.destinations;

        qs("#city-detail-title").textContent = city.destinations.name_ko + " (" + city.destinations.name_en + ", " + city.destinations.country_code + ")";
        qs("#city-detail-tagline").value = city.tagline || "";
        qs("#city-detail-active").checked = city.is_active;
        qs("#city-basic-error").hidden = true;

        qs("#city-image-fallback-preview").innerHTML = fallbackCardHtml(city.destinations);
        qs("#city-wiki-search").value = city.destinations.name_en + " cityscape";
        qs("#city-wiki-results").innerHTML = "";
        qs("#city-wiki-results-empty").hidden = true;
        qs("#city-wiki-error").hidden = true;
        qs("#city-pexels-search").value = city.destinations.name_en + " cityscape";
        qs("#city-pexels-results").innerHTML = "";
        qs("#city-pexels-results-empty").hidden = true;
        qs("#city-pexels-error").hidden = true;
        qs("#city-unsplash-search").value = city.destinations.name_en + " cityscape";
        qs("#city-unsplash-results").innerHTML = "";
        qs("#city-unsplash-results-empty").hidden = true;
        qs("#city-unsplash-error").hidden = true;

        await Promise.all([loadCityMonths(cityId), loadCityImages(cityId), loadCityHighlights(cityId)]);
      } catch (err) {
        console.warn("[admin] 도시 상세 조회 실패", err);
        qs("#city-detail-title").textContent = "불러오지 못했어요";
      }
    }
    qs("#city-detail-back-btn").addEventListener("click", () => showCityView("city-list-view"));

    // ---- 기본 정보 ----

    function showBasicError(message) {
      const el = qs("#city-basic-error");
      el.textContent = message;
      el.hidden = false;
    }

    qs("#city-detail-save-basic-btn").addEventListener("click", async () => {
      qs("#city-basic-error").hidden = true;
      const tagline = qs("#city-detail-tagline").value.trim() || null;
      const isActive = qs("#city-detail-active").checked;
      try {
        const { error } = await supabase.from("discover_cities").update({ tagline, is_active: isActive }).eq("id", state.selectedCityId);
        if (error) throw error;
        await loadCityList();
        window.alert("저장했어요.");
      } catch (err) {
        showBasicError("저장하지 못했어요: " + err.message);
      }
    });

    qs("#city-detail-remove-btn").addEventListener("click", async () => {
      if (!window.confirm("이 도시를 추천 목록에서 완전히 제거할까요? 월별 점수·이미지·하이라이트가 모두 함께 삭제돼요.")) return;
      try {
        const { error } = await supabase.from("discover_cities").delete().eq("id", state.selectedCityId);
        if (error) throw error;
        await loadCityList();
        showCityView("city-list-view");
      } catch (err) {
        showBasicError("제거하지 못했어요: " + err.message);
      }
    });

    // ---- 월별 점수 (요청 3번) ----

    const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const cityMonthGridEl = qs("#city-month-grid");

    async function loadCityMonths(cityId) {
      const { data, error } = await supabase.from("discover_city_months").select("*").eq("city_id", cityId);
      if (error) {
        console.warn("[admin] 월별 점수 조회 실패", error);
        state.cityMonths = MONTHS.map((m) => ({ month: m, score: null, reasonTag: "", reasonText: "" }));
      } else {
        const byMonth = new Map((data || []).map((r) => [r.month, r]));
        state.cityMonths = MONTHS.map((m) => {
          const row = byMonth.get(m);
          return row
            ? { month: m, score: row.score, reasonTag: row.reason_tag || "", reasonText: row.reason_text || "" }
            : { month: m, score: null, reasonTag: "", reasonText: "" };
        });
      }
      renderCityMonthGrid();
    }

    function renderCityMonthGrid() {
      cityMonthGridEl.innerHTML = state.cityMonths
        .map((m) => {
          const has = m.score != null;
          return (
            '<div class="admin-month-cell" data-month="' +
            m.month +
            '">' +
            '<p class="admin-month-label">' +
            m.month +
            "월</p>" +
            '<select class="admin-month-score" data-month="' +
            m.month +
            '">' +
            ['<option value="">없음</option>'].concat([1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (m.score === n ? " selected" : "") + ">" + n + "</option>")).join("") +
            "</select>" +
            '<div class="admin-month-reason"' +
            (has ? "" : " hidden") +
            ">" +
            '<input type="text" class="admin-month-tag" data-month="' +
            m.month +
            '" placeholder="reason_tag (예: 벚꽃)" value="' +
            escapeHtml(m.reasonTag) +
            '" />' +
            '<textarea class="admin-month-text" data-month="' +
            m.month +
            '" placeholder="reason_text (한 줄 이유, 선택)">' +
            escapeHtml(m.reasonText) +
            "</textarea>" +
            "</div></div>"
          );
        })
        .join("");
      renderMonthPreview();
    }

    function renderMonthPreview() {
      const thisMonth = currentKstMonth();
      const row = state.cityMonths.find((m) => m.month === thisMonth);
      const el = qs("#city-month-preview");
      if (row && row.score != null) {
        el.textContent = "이번 달(" + thisMonth + "월) 미리보기: 추천됨 · " + row.score + "점" + (row.reasonTag ? " · " + row.reasonTag : "");
      } else {
        el.textContent = "이번 달(" + thisMonth + "월) 미리보기: 추천되지 않아요 (점수 없음)";
      }
    }

    // score(<select>)는 change로 충분하지만, tag/text(<input>/<textarea>)는 change만 쓰면 blur 전에
    // "저장"을 눌렀을 때 방금 입력한 값이 state에 반영되지 않은 채 날아갈 수 있어 input으로 매 입력마다 동기화한다.
    cityMonthGridEl.addEventListener("change", (e) => {
      const month = Number(e.target.dataset.month);
      if (!month || !e.target.classList.contains("admin-month-score")) return;
      const row = state.cityMonths.find((m) => m.month === month);
      if (!row) return;
      row.score = e.target.value ? Number(e.target.value) : null;
      const cell = cityMonthGridEl.querySelector('.admin-month-cell[data-month="' + month + '"] .admin-month-reason');
      if (cell) cell.hidden = row.score == null;
      renderMonthPreview();
    });
    cityMonthGridEl.addEventListener("input", (e) => {
      const month = Number(e.target.dataset.month);
      if (!month) return;
      const row = state.cityMonths.find((m) => m.month === month);
      if (!row) return;
      if (e.target.classList.contains("admin-month-tag")) row.reasonTag = e.target.value;
      else if (e.target.classList.contains("admin-month-text")) row.reasonText = e.target.value;
      else return;
      renderMonthPreview();
    });

    qs("#city-month-save-btn").addEventListener("click", async () => {
      const errEl = qs("#city-month-error");
      errEl.hidden = true;
      // discover_city_months.reason_tag는 NOT NULL(027_discover_cities.sql) - 점수를 넣었는데 태그가
      // 비어 있으면 서버 에러로 처음 알게 되는 대신 여기서 먼저 막는다.
      const missingTag = state.cityMonths.find((m) => m.score != null && !m.reasonTag.trim());
      if (missingTag) {
        errEl.textContent = missingTag.month + "월: 점수를 넣으려면 reason_tag가 필요해요.";
        errEl.hidden = false;
        return;
      }

      const upserts = state.cityMonths
        .filter((m) => m.score != null)
        .map((m) => ({ city_id: state.selectedCityId, month: m.month, score: m.score, reason_tag: m.reasonTag.trim(), reason_text: m.reasonText.trim() || null }));
      const emptyMonths = state.cityMonths.filter((m) => m.score == null).map((m) => m.month);

      try {
        if (emptyMonths.length) {
          const { error } = await supabase.from("discover_city_months").delete().eq("city_id", state.selectedCityId).in("month", emptyMonths);
          if (error) throw error;
        }
        if (upserts.length) {
          const { error } = await supabase.from("discover_city_months").upsert(upserts, { onConflict: "city_id,month" });
          if (error) throw error;
        }
        await loadCityMonths(state.selectedCityId);
        await loadCityList();
        window.alert("월별 점수를 저장했어요.");
      } catch (err) {
        errEl.textContent = "저장하지 못했어요: " + err.message;
        errEl.hidden = false;
      }
    });

    // ---- 이미지 (요청 4번) ----

    const cityImageCandidatesEl = qs("#city-image-candidates");
    const cityImageCandidatesEmptyEl = qs("#city-image-candidates-empty");

    async function loadCityImages(cityId) {
      cityImageCandidatesEl.innerHTML = "";
      cityImageCandidatesEmptyEl.hidden = true;
      try {
        const { data, error } = await supabase.from("discover_city_images").select("*").eq("city_id", cityId).order("sort_order", { ascending: true });
        if (error) throw error;
        state.cityImages = data || [];
        renderCardPreview();
        if (state.cityImages.length === 0) {
          cityImageCandidatesEmptyEl.hidden = false;
          return;
        }
        cityImageCandidatesEl.innerHTML = state.cityImages.map(renderCityImageCard).join("");
      } catch (err) {
        console.warn("[admin] 도시 이미지 조회 실패", err);
        cityImageCandidatesEmptyEl.hidden = false;
        cityImageCandidatesEmptyEl.textContent = "불러오지 못했어요: " + (err.message || "");
      }
    }

    function renderCardPreview() {
      const published = state.cityImages.find((img) => img.status === "published");
      const el = qs("#city-image-card-preview");
      if (!published) {
        el.innerHTML = '<p class="admin-hint">아직 게시된 대표 이미지가 없어요 - 지금은 대체 카드가 보여요.</p>';
        return;
      }
      el.innerHTML =
        '<div class="admin-city-card-preview-tile"><img src="' + escapeHtml(published.thumb_url || published.image_url) + '" alt="" loading="lazy" /></div>' +
        attributionLineHtml(published);
    }

    function renderCityImageCard(img) {
      const isPublished = img.status === "published";
      const actions = isPublished
        ? '<button type="button" class="btn btn-cancel" data-action="unpublish" data-id="' + img.id + '">게시 해제</button>'
        : '<button type="button" class="btn btn-save" data-action="publish" data-id="' + img.id + '">대표로 게시</button>';
      return (
        '<li class="admin-city-image-card' +
        (isPublished ? " admin-city-image-card--published" : "") +
        '" data-id="' +
        img.id +
        '">' +
        (isPublished ? '<span class="admin-badge admin-badge--importance-high">대표 이미지</span>' : "") +
        '<img src="' +
        escapeHtml(img.thumb_url || img.image_url) +
        '" alt="" loading="lazy" />' +
        attributionLineHtml(img) +
        '<div class="admin-city-image-actions">' +
        actions +
        '<button type="button" class="btn btn-delete" data-action="delete" data-id="' +
        img.id +
        '">삭제</button></div></li>'
      );
    }

    // Storage에 우리가 직접 올린 공개 URL인지 판별 - 핫링크(외부 원본) URL은 지울 Storage 객체가 없다.
    function storageObjectPathFromPublicUrl(url) {
      const marker = "/storage/v1/object/public/discover-images/";
      const idx = (url || "").indexOf(marker);
      if (idx === -1) return null;
      return url.slice(idx + marker.length);
    }

    cityImageCandidatesEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const img = state.cityImages.find((r) => r.id === id);
      if (!img) return;

      if (action === "publish") {
        try {
          // 도시당 대표 이미지는 항상 1개만(요청 4번) - 기존 published를 전부 draft로 내린 뒤 고른 것만 published로.
          const { error: demoteErr } = await supabase.from("discover_city_images").update({ status: "draft" }).eq("city_id", state.selectedCityId).eq("status", "published");
          if (demoteErr) throw demoteErr;
          const { error } = await supabase.from("discover_city_images").update({ status: "published" }).eq("id", id);
          if (error) throw error;
        } catch (err) {
          window.alert("게시하지 못했어요: " + err.message);
          return;
        }
        await loadCityImages(state.selectedCityId);
        await loadCityList();
        return;
      }

      if (action === "unpublish") {
        const { error } = await supabase.from("discover_city_images").update({ status: "draft" }).eq("id", id);
        if (error) return window.alert("처리하지 못했어요: " + error.message);
        await loadCityImages(state.selectedCityId);
        await loadCityList();
        return;
      }

      if (action === "delete") {
        if (!window.confirm("이 후보를 삭제할까요? 되돌릴 수 없어요.")) return;
        const path = storageObjectPathFromPublicUrl(img.image_url);
        const thumbPath = storageObjectPathFromPublicUrl(img.thumb_url);
        const { error } = await supabase.from("discover_city_images").delete().eq("id", id);
        if (error) return window.alert("삭제하지 못했어요: " + error.message);
        const paths = [path, thumbPath].filter(Boolean);
        if (paths.length) {
          try {
            await supabase.storage.from("discover-images").remove(paths);
          } catch (storageErr) {
            console.warn("[admin] Storage 객체 정리 실패(무시)", storageErr);
          }
        }
        await loadCityImages(state.selectedCityId);
        await loadCityList();
      }
    });

    // ---- Wikimedia Commons 검색 (다운로드 없이 URL로 후보 추가) ----
    // scripts/collect-city-images/providers/commons.mjs와 같은 필터링 규칙(허용 라이선스 화이트리스트 +
    // 저작자 필수)을 쓰지만, 이건 admin의 로그인 세션(is_admin())만으로 브라우저에서 바로 돈다 -
    // service_role 키도 로컬 스크립트도 필요 없다("admin 계정은 최소한의 작업만" 요청). 파일을 내려받아
    // 리사이즈·Storage에 올리는 대신 Wikimedia의 iiurlwidth 파라미터로 미리 800px로 맞춰진 썸네일 주소
    // (thumburl)를 그대로 image_url/thumb_url로 저장한다 - Commons 공식 가이드가 "다운로드 권장, 핫링크도
    // 가능은 하다"고 해서 다운로드 없이 가는 이 방식도 허용 범위 안이다.
    // 브라우저에서 바로 부르려면 MediaWiki API가 CORS를 지원하도록 origin=* 파라미터가 반드시 있어야
    // 한다(https://www.mediawiki.org/wiki/API:Cross-site_requests) - 실제로 없으면 브라우저가 응답을 막는
    // 것까지 확인했다.

    const WIKI_API_URL = "https://commons.wikimedia.org/w/api.php";
    const WIKI_SEARCH_LIMIT = 8;
    const WIKI_THUMB_WIDTH = 800; // 요청: 가로 800px 안팎 - thumb_url도 같은 주소를 재사용한다(최소 작업)

    function isAllowedWikiLicense(licenseShortName) {
      if (!licenseShortName) return false;
      const s = licenseShortName.toLowerCase();
      if (s.includes("nc") || s.includes("nd") || s.includes("non-commercial") || s.includes("no derivative")) return false;
      return /cc0|public domain|cc[- ]?by(-sa)?/.test(s);
    }

    function stripWikiHtml(value) {
      if (!value) return "";
      return value
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
    }

    async function searchWikimedia(query) {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        origin: "*", // 브라우저 CORS 필수
        generator: "search",
        gsrsearch: query,
        gsrnamespace: "6",
        gsrlimit: String(WIKI_SEARCH_LIMIT),
        prop: "imageinfo",
        iiprop: "url|size|extmetadata|mime",
        iiurlwidth: String(WIKI_THUMB_WIDTH),
      });
      const res = await fetch(WIKI_API_URL + "?" + params.toString());
      if (!res.ok) throw new Error("Wikimedia 요청 실패 HTTP " + res.status);
      const data = await res.json();
      const pages = data?.query?.pages;
      if (!pages) return [];

      const results = [];
      for (const page of Object.values(pages)) {
        const info = page?.imageinfo?.[0];
        if (!info || !info.url) continue;
        if (!/^image\//.test(info.mime || "")) continue;
        const meta = info.extmetadata || {};
        const license = meta.LicenseShortName?.value || "";
        if (!isAllowedWikiLicense(license)) continue;
        const artist = stripWikiHtml(meta.Artist?.value);
        if (!artist) continue;
        const thumbUrl = info.thumburl || info.url; // 간혹 썸네일을 못 만드는 파일이면 원본 URL로 대체
        const fileUrl = "https://commons.wikimedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_"));
        results.push({ title: page.title, imageUrl: thumbUrl, creditName: artist, license, sourceUrl: fileUrl });
      }
      return results;
    }

    qs("#city-wiki-search-btn").addEventListener("click", async () => {
      const q = qs("#city-wiki-search").value.trim();
      const resultsEl = qs("#city-wiki-results");
      const emptyEl = qs("#city-wiki-results-empty");
      const errEl = qs("#city-wiki-error");
      resultsEl.innerHTML = "";
      emptyEl.hidden = true;
      errEl.hidden = true;
      if (!q) return;
      try {
        const results = await searchWikimedia(q);
        resultsEl.dataset.resultsJson = JSON.stringify(results);
        if (results.length === 0) {
          emptyEl.hidden = false;
          return;
        }
        resultsEl.innerHTML = results
          .map(
            (r, i) =>
              '<li class="admin-city-image-card" data-index="' +
              i +
              '"><img src="' +
              escapeHtml(r.imageUrl) +
              '" alt="" loading="lazy" />' +
              '<p class="admin-city-image-credit">사진: ' +
              escapeHtml(r.creditName) +
              " · " +
              escapeHtml(r.license) +
              "</p>" +
              '<div class="admin-city-image-actions">' +
              '<button type="button" class="btn btn-save" data-index="' +
              i +
              '">후보로 추가</button></div></li>'
          )
          .join("");
      } catch (err) {
        console.warn("[admin] Wikimedia 검색 실패", err);
        errEl.textContent = "검색하지 못했어요: " + (err.message || "");
        errEl.hidden = false;
      }
    });

    // 검색 소스(Wikimedia/Pexels) 공통: 정규화된 후보 하나를 draft로 추가한다. 이미 같은 source_url이
    // 추가돼 있으면 중복 삽입하지 않는다.
    async function addImageCandidate(r, errEl) {
      errEl.hidden = true;
      if (state.cityImages.some((img) => img.source_url === r.sourceUrl)) {
        errEl.textContent = "이미 추가된 후보예요.";
        errEl.hidden = false;
        return;
      }
      try {
        const nextSortOrder = state.cityImages.length ? Math.max(...state.cityImages.map((i) => i.sort_order)) + 1 : 0;
        const { error } = await supabase.from("discover_city_images").insert({
          city_id: state.selectedCityId,
          image_url: r.imageUrl,
          thumb_url: r.thumbUrl ?? r.imageUrl,
          credit_name: r.creditName,
          credit_url: r.creditUrl ?? null,
          license: r.license,
          source_name: r.sourceName,
          source_url: r.sourceUrl,
          status: "draft",
          sort_order: nextSortOrder,
        });
        if (error) throw error;
        await loadCityImages(state.selectedCityId);
      } catch (err) {
        errEl.textContent = "후보로 추가하지 못했어요: " + err.message;
        errEl.hidden = false;
      }
    }

    qs("#city-wiki-results").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-index]");
      if (!btn) return;
      const results = JSON.parse(qs("#city-wiki-results").dataset.resultsJson || "[]");
      const r = results[Number(btn.dataset.index)];
      if (!r) return;
      await addImageCandidate({ ...r, sourceName: "Wikimedia Commons" }, qs("#city-wiki-error"));
    });

    // ---- Pexels에서 검색 (Wikimedia에 원하는 사진이 없을 때 대체 소스) ----
    // PEXELS_API_KEY는 서버(search-pexels Edge Function)에만 둔다 - Pexels 키는 Google Maps 브라우저
    // 키와 달리 도메인 제한 기능이 없어서, 클라이언트 JS에 넣으면 누구나 페이지 소스로 꺼내 쓸 수 있다.
    // 그 함수 자체도 is_admin()이 아니면 403을 돌려준다(화면만 숨기는 게 아니라 서버에서도 막음).

    qs("#city-pexels-search-btn").addEventListener("click", async () => {
      const q = qs("#city-pexels-search").value.trim();
      const resultsEl = qs("#city-pexels-results");
      const emptyEl = qs("#city-pexels-results-empty");
      const errEl = qs("#city-pexels-error");
      resultsEl.innerHTML = "";
      emptyEl.hidden = true;
      errEl.hidden = true;
      if (!q) return;
      try {
        const { data, error } = await supabase.functions.invoke("search-pexels", { body: { query: q } });
        if (error || data?.error) throw new Error(data?.error || error?.message);
        const results = data?.results || [];
        resultsEl.dataset.resultsJson = JSON.stringify(results);
        if (results.length === 0) {
          emptyEl.hidden = false;
          return;
        }
        resultsEl.innerHTML = results
          .map(
            (r, i) =>
              '<li class="admin-city-image-card" data-index="' +
              i +
              '"><img src="' +
              escapeHtml(r.thumbUrl || r.imageUrl) +
              '" alt="" loading="lazy" />' +
              '<p class="admin-city-image-credit">사진: ' +
              escapeHtml(r.creditName) +
              " · " +
              escapeHtml(r.license) +
              "</p>" +
              '<div class="admin-city-image-actions">' +
              '<button type="button" class="btn btn-save" data-index="' +
              i +
              '">후보로 추가</button></div></li>'
          )
          .join("");
      } catch (err) {
        console.warn("[admin] Pexels 검색 실패", err);
        errEl.textContent = "검색하지 못했어요: " + (err.message || "");
        errEl.hidden = false;
      }
    });

    qs("#city-pexels-results").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-index]");
      if (!btn) return;
      const results = JSON.parse(qs("#city-pexels-results").dataset.resultsJson || "[]");
      const r = results[Number(btn.dataset.index)];
      if (!r) return;
      await addImageCandidate(r, qs("#city-pexels-error"));
    });

    // ---- Unsplash에서 검색 (Wikimedia/Pexels에 원하는 사진이 없을 때 대체 소스) ----
    // UNSPLASH_ACCESS_KEY는 서버(search-unsplash Edge Function)에만 둔다 - Pexels와 같은 이유. Unsplash
    // API 이용약관상 "후보로 추가"(=사용)할 때마다 다운로드 트래킹 호출이 필요해서(search-unsplash의
    // 파일 top 주석 참고), 아래 결과 클릭 핸들러는 Pexels/Wikimedia와 달리 addImageCandidate 전에
    // 트래킹 호출을 한 번 더 한다.

    qs("#city-unsplash-search-btn").addEventListener("click", async () => {
      const q = qs("#city-unsplash-search").value.trim();
      const resultsEl = qs("#city-unsplash-results");
      const emptyEl = qs("#city-unsplash-results-empty");
      const errEl = qs("#city-unsplash-error");
      resultsEl.innerHTML = "";
      emptyEl.hidden = true;
      errEl.hidden = true;
      if (!q) return;
      try {
        const { data, error } = await supabase.functions.invoke("search-unsplash", { body: { query: q } });
        if (error || data?.error) throw new Error(data?.error || error?.message);
        const results = data?.results || [];
        resultsEl.dataset.resultsJson = JSON.stringify(results);
        if (results.length === 0) {
          emptyEl.hidden = false;
          return;
        }
        resultsEl.innerHTML = results
          .map(
            (r, i) =>
              '<li class="admin-city-image-card" data-index="' +
              i +
              '"><img src="' +
              escapeHtml(r.thumbUrl || r.imageUrl) +
              '" alt="" loading="lazy" />' +
              '<p class="admin-city-image-credit">사진: ' +
              escapeHtml(r.creditName) +
              " · " +
              escapeHtml(r.license) +
              "</p>" +
              '<div class="admin-city-image-actions">' +
              '<button type="button" class="btn btn-save" data-index="' +
              i +
              '">후보로 추가</button></div></li>'
          )
          .join("");
      } catch (err) {
        console.warn("[admin] Unsplash 검색 실패", err);
        errEl.textContent = "검색하지 못했어요: " + (err.message || "");
        errEl.hidden = false;
      }
    });

    qs("#city-unsplash-results").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-index]");
      if (!btn) return;
      const results = JSON.parse(qs("#city-unsplash-results").dataset.resultsJson || "[]");
      const r = results[Number(btn.dataset.index)];
      if (!r) return;
      try {
        await supabase.functions.invoke("search-unsplash", { body: { downloadLocation: r.downloadLocation } });
      } catch (err) {
        console.warn("[admin] Unsplash 다운로드 트래킹 실패(후보 추가는 계속 진행)", err);
      }
      await addImageCandidate(r, qs("#city-unsplash-error"));
    });

    // ---- 이미지 직접 업로드 (요청 4번: 저작자·라이선스·출처 필수) ----

    function showImageUploadError(message) {
      const el = qs("#city-image-upload-error");
      el.textContent = message;
      el.hidden = false;
    }

    qs("#city-image-upload-btn").addEventListener("click", async () => {
      qs("#city-image-upload-error").hidden = true;
      const fileInput = qs("#city-image-upload-file");
      const file = fileInput.files[0];
      const creditName = qs("#city-image-upload-credit").value.trim();
      const license = qs("#city-image-upload-license").value.trim();
      const sourceName = qs("#city-image-upload-source-name").value.trim();
      const sourceUrl = qs("#city-image-upload-source-url").value.trim();
      const creditUrl = qs("#city-image-upload-credit-url").value.trim() || null;

      if (!file) return showImageUploadError("이미지 파일을 선택해주세요.");
      if (!creditName) return showImageUploadError("저작자를 입력해주세요.");
      if (!license) return showImageUploadError("라이선스를 입력해주세요.");
      if (!sourceName) return showImageUploadError("출처 이름을 입력해주세요.");
      if (!sourceUrl) return showImageUploadError("출처 URL을 입력해주세요.");
      if (!isHttpsUrl(sourceUrl)) return showImageUploadError("출처 URL은 https://로 시작해야 해요.");

      try {
        const d = state.selectedCityDest;
        const slug = slugifyCity(d.country_code, d.name_en);
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = slug + "/" + crypto.randomUUID() + "." + ext;
        const buf = await file.arrayBuffer();
        const { error: upErr } = await supabase.storage.from("discover-images").upload(path, buf, { contentType: file.type || "image/jpeg" });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("discover-images").getPublicUrl(path);

        const nextSortOrder = state.cityImages.length ? Math.max(...state.cityImages.map((i) => i.sort_order)) + 1 : 0;
        const { error } = await supabase.from("discover_city_images").insert({
          city_id: state.selectedCityId,
          image_url: pub.publicUrl,
          thumb_url: pub.publicUrl,
          credit_name: creditName,
          credit_url: creditUrl,
          license,
          source_name: sourceName,
          source_url: sourceUrl,
          status: "draft",
          sort_order: nextSortOrder,
        });
        if (error) throw error;

        // city-image-upload-form은 <form>이 아니라 <div>라서(엔터 키로 페이지가 새로고침되는 걸 막으려고
        // 일부러 그랬다 - 아래 필드들에 submit 핸들러가 없었다) reset()이 없다. 필드를 하나씩 비운다.
        qsa("#city-image-upload-form input").forEach((input) => (input.value = ""));
        await loadCityImages(state.selectedCityId);
      } catch (err) {
        showImageUploadError("업로드하지 못했어요: " + err.message);
      }
    });

    // ---- 하이라이트 (요청 5번: 추가/수정/순서변경/삭제) ----

    const cityHighlightListEl = qs("#city-highlight-list");

    async function loadCityHighlights(cityId) {
      const { data, error } = await supabase.from("city_highlights").select("*").eq("city_id", cityId).order("sort_order", { ascending: true });
      if (error) {
        console.warn("[admin] 하이라이트 조회 실패", error);
        state.cityHighlights = [];
      } else {
        state.cityHighlights = data || [];
      }
      renderCityHighlights();
    }

    function renderCityHighlights() {
      qs("#city-highlight-empty").hidden = state.cityHighlights.length > 0;
      cityHighlightListEl.innerHTML = state.cityHighlights
        .map(
          (h, i) =>
            '<li class="admin-highlight-row" data-id="' +
            h.id +
            '">' +
            '<input type="text" class="admin-highlight-row-name" value="' +
            escapeHtml(h.name_ko) +
            '" />' +
            '<input type="text" class="admin-highlight-row-summary" value="' +
            escapeHtml(h.summary || "") +
            '" />' +
            '<div class="admin-highlight-row-actions">' +
            '<button type="button" data-action="up"' +
            (i === 0 ? " disabled" : "") +
            ">↑</button>" +
            '<button type="button" data-action="down"' +
            (i === state.cityHighlights.length - 1 ? " disabled" : "") +
            ">↓</button>" +
            '<button type="button" class="btn btn-cancel" data-action="save">저장</button>' +
            '<button type="button" class="btn btn-delete" data-action="delete">삭제</button>' +
            "</div></li>"
        )
        .join("");
    }

    cityHighlightListEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const li = btn.closest(".admin-highlight-row");
      const id = li.dataset.id;
      const action = btn.dataset.action;
      const index = state.cityHighlights.findIndex((h) => h.id === id);
      if (index === -1) return;

      if (action === "save") {
        const nameKo = li.querySelector(".admin-highlight-row-name").value.trim();
        const summary = li.querySelector(".admin-highlight-row-summary").value.trim() || null;
        if (!nameKo) return window.alert("이름을 입력해주세요.");
        const { error } = await supabase.from("city_highlights").update({ name_ko: nameKo, summary }).eq("id", id);
        if (error) return window.alert("저장하지 못했어요: " + error.message);
        await loadCityHighlights(state.selectedCityId);
        return;
      }

      if (action === "delete") {
        if (!window.confirm("이 관광지를 삭제할까요?")) return;
        const { error } = await supabase.from("city_highlights").delete().eq("id", id);
        if (error) return window.alert("삭제하지 못했어요: " + error.message);
        await loadCityHighlights(state.selectedCityId);
        await loadCityList();
        return;
      }

      if (action === "up" || action === "down") {
        const otherIndex = action === "up" ? index - 1 : index + 1;
        const other = state.cityHighlights[otherIndex];
        const self = state.cityHighlights[index];
        if (!other) return;
        try {
          const { error: e1 } = await supabase.from("city_highlights").update({ sort_order: other.sort_order }).eq("id", self.id);
          if (e1) throw e1;
          const { error: e2 } = await supabase.from("city_highlights").update({ sort_order: self.sort_order }).eq("id", other.id);
          if (e2) throw e2;
        } catch (err) {
          window.alert("순서를 바꾸지 못했어요: " + err.message);
        }
        await loadCityHighlights(state.selectedCityId);
      }
    });

    qs("#city-highlight-add-btn").addEventListener("click", async () => {
      const errEl = qs("#city-highlight-error");
      errEl.hidden = true;
      const nameKo = qs("#city-highlight-name").value.trim();
      const summary = qs("#city-highlight-summary").value.trim() || null;
      if (!nameKo) {
        errEl.textContent = "이름을 입력해주세요.";
        errEl.hidden = false;
        return;
      }
      const nextSortOrder = state.cityHighlights.length ? Math.max(...state.cityHighlights.map((h) => h.sort_order)) + 1 : 0;
      try {
        const { error } = await supabase.from("city_highlights").insert({ city_id: state.selectedCityId, name_ko: nameKo, summary, sort_order: nextSortOrder });
        if (error) throw error;
        qsa("#city-highlight-form input").forEach((input) => (input.value = ""));
        await loadCityHighlights(state.selectedCityId);
        await loadCityList();
      } catch (err) {
        errEl.textContent = "추가하지 못했어요: " + err.message;
        errEl.hidden = false;
      }
    });

    // ==========================================================================
    // 초기화
    // ==========================================================================

    qs("#ranking-period").value = currentYyyyMm();
    renderRankingRows();
    loadCountryOptions();
    loadAdminLabels();
    loadFeedList();
  }

  initGate();
})();
