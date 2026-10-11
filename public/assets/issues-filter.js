// /issues/ の絞り込み (カテゴリのタブ + 横断タグ + 記事あり)。
// JS がなくても全件が読める HTML に、タブ (WAI-ARIA Tabs パターン) と絞り込みを後から足す。
(() => {
  const root = document.querySelector("[data-issue-filter]");
  if (!root) return;

  const tablist = root.querySelector("[data-tabs]");
  const tabs = [...tablist.querySelectorAll("[data-tab]")];
  const panels = [...root.querySelectorAll("[data-panel]")];
  const tagButtons = [...root.querySelectorAll("[data-tag]")];
  const publishedOnly = root.querySelector("[data-published-only]");
  const count = root.querySelector("[data-count]");
  const reset = root.querySelector("[data-reset]");
  const empty = root.querySelector("[data-empty]");
  const total = root.querySelectorAll("[data-issue]").length;

  const state = { category: "all", tag: "", published: false };

  // URL (?category=…&tag=…&status=published、または #cat-…) から初期状態を読む
  const params = new URLSearchParams(location.search);
  const fromHash = location.hash.startsWith("#cat-") ? location.hash.slice(5) : "";
  const wantedCategory = params.get("category") || fromHash;
  if (tabs.some((t) => t.dataset.tab === wantedCategory)) state.category = wantedCategory;
  if (tagButtons.some((b) => b.dataset.tag === params.get("tag"))) state.tag = params.get("tag");
  state.published = params.get("status") === "published";

  // タブ化
  tablist.setAttribute("role", "tablist");
  for (const tab of tabs) {
    tab.setAttribute("role", "tab");
    tab.setAttribute(
      "aria-controls",
      tab.dataset.tab === "all" ? panels.map((p) => p.id).join(" ") : `cat-${tab.dataset.tab}`,
    );
  }
  for (const panel of panels) {
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${panel.dataset.panel}`);
  }
  // タグは「押すと絞り込むボタン」にする (JS なしではタグのページへのリンク)
  for (const button of tagButtons) button.setAttribute("role", "button");
  for (const el of root.querySelectorAll("[data-js-only]")) el.hidden = false;

  function render() {
    for (const tab of tabs) {
      const selected = tab.dataset.tab === state.category;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const button of tagButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.tag === state.tag));
    }
    publishedOnly.checked = state.published;

    let shown = 0;
    for (const panel of panels) {
      const inCategory = state.category === "all" || panel.dataset.panel === state.category;
      let visible = 0;
      for (const item of panel.querySelectorAll("[data-issue]")) {
        const match =
          inCategory &&
          (!state.tag || item.dataset.tags.split(" ").includes(state.tag)) &&
          (!state.published || item.dataset.status === "published");
        item.hidden = !match;
        if (match) visible += 1;
      }
      panel.hidden = visible === 0;
      shown += visible;
    }
    empty.hidden = shown > 0;
    const filtered = state.category !== "all" || state.tag !== "" || state.published;
    count.textContent = filtered ? `${total} 件中 ${shown} 件を表示` : `全 ${total} 件`;
    reset.hidden = !filtered;

    const next = new URLSearchParams();
    if (state.category !== "all") next.set("category", state.category);
    if (state.tag) next.set("tag", state.tag);
    if (state.published) next.set("status", "published");
    const query = next.toString();
    history.replaceState(null, "", query ? `?${query}` : location.pathname);
  }

  function selectTab(tab, focus = false) {
    state.category = tab.dataset.tab;
    render();
    if (focus) tab.focus();
  }

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    event.preventDefault();
    selectTab(tab);
  });
  tablist.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(event.target.closest("[data-tab]"));
    if (index < 0) return;
    const move = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      selectTab(tabs[(move + tabs.length) % tabs.length], true);
    } else if (event.key === " ") {
      event.preventDefault();
      selectTab(tabs[index]);
    }
  });

  function toggleTag(button) {
    state.tag = state.tag === button.dataset.tag ? "" : button.dataset.tag;
    render();
  }
  for (const button of tagButtons) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      toggleTag(button);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== " ") return;
      event.preventDefault();
      toggleTag(button);
    });
  }

  publishedOnly.addEventListener("change", () => {
    state.published = publishedOnly.checked;
    render();
  });
  reset.addEventListener("click", () => {
    state.category = "all";
    state.tag = "";
    state.published = false;
    render();
    tabs[0].focus();
  });

  render();
})();
