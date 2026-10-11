// @별칭 ALIAS-VIEW · 별칭 보기 (개발용, 화면에 별칭 표시)
// (전체 지도는 D:/VibeCoding/Study_01/comments.html)
//
// 화면의 각 부분에 붙은 data-alias(예: "FLIGHT · 항공편 추가 창")를 화면 위에 이름표로 보여준다.
// 켜는 법: 주소에 ?alias=1 (예: http://localhost:8080/?alias=1#/main) 또는 Alt+Shift+A (다시 누르면 끔).
// 이름표를 누르면 별칭(영문 키)이 클립보드에 복사된다 → "FLIGHT 창에서 …"처럼 그대로 말하거나 코드에서 검색하면 된다.
// 평소에는 불러오지 않고(app.js#initAliasView가 켤 때만 불러온다), 화면 배치에는 영향을 주지 않는 겹침 층(#alias-layer)만 그린다.

(function () {
  let layer = null;
  let enabled = false;
  let frame = 0;
  let observer = null;

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "alias-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }

  // 가장 가까운 별칭 조상이 몇 겹 위에 있는지 (겹친 이름표를 위아래로 벌려 놓고, 겹마다 색을 다르게 하려고)
  function depthOf(el) {
    let depth = 0;
    for (let p = el.parentElement?.closest("[data-alias]"); p; p = p.parentElement?.closest("[data-alias]")) depth += 1;
    return depth;
  }

  function copyKey(key, tag) {
    const done = () => {
      tag.textContent = `${key} ✓ 복사됨`;
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(key).then(done, () => {});
  }

  function draw() {
    frame = 0;
    if (!enabled) return;
    const host = ensureLayer();
    host.textContent = "";

    for (const el of document.querySelectorAll("[data-alias]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue; // 숨겨진 요소
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue; // 화면 밖

      const [key, ...rest] = el.dataset.alias.split(" · ");
      const depth = depthOf(el);
      const color = `hsl(${(depth * 67 + 200) % 360} 75% 38%)`;

      const box = document.createElement("div");
      box.className = "alias-box";
      box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;--alias-color:${color}`;

      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = "alias-tag";
      tag.style.top = `${Math.min(depth, 6) * 15}px`;
      tag.textContent = rest.length ? `${key} · ${rest.join(" · ")}` : key;
      tag.title = "누르면 별칭이 복사돼요";
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        copyKey(key, tag);
      });
      box.appendChild(tag);
      host.appendChild(box);
    }
  }

  function schedule() {
    if (enabled && !frame) frame = requestAnimationFrame(draw);
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    if (enabled) {
      ensureLayer();
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);
      window.addEventListener("hashchange", schedule);
      // 창이 열리고 닫히거나 화면이 바뀔 때 다시 그린다 (우리가 그린 층 안의 변화는 무시한다)
      observer ??= new MutationObserver((records) => {
        if (records.some((r) => !layer.contains(r.target))) schedule();
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
      draw();
    } else {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
      observer?.disconnect();
      layer?.remove();
      layer = null;
    }
  }

  window.TripLog = window.TripLog || {};
  window.TripLog.aliasView = { setEnabled, toggle: () => setEnabled(!enabled) };
})();
