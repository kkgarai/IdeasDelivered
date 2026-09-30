const PANEL_IDEAS = new Set([
  "inline-edit-related",
  "default-sort",
  "export",
  "auto-refresh",
  "real-count",
  "sort-activities",
  "highlight",
  "parent-columns",
  "row-count",
  "quick-filters",
  "totals",
  "mass-delete-rows",
  "current-user",
  "more-related-columns",
  "hover",
  "following",
  "change-owner",
  "more-filters",
  "column-widths",
  "hide-empty",
  "select-over-200",
  "pinned-list"
]);

const RECORD = /\/lightning\/r\/[^/]+\/[a-zA-Z0-9]{15,18}(?:\/|$)/;

function ask(action, extra) {
  return chrome.runtime.sendMessage({ type: "sf", action, url: location.href, ...extra }).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Salesforce did not answer.");
    return response.result;
  });
}

function readState() {
  return chrome.storage.local.get(["toggles", "listPrefs", "highlightRule", "columnWidths"]);
}

function on(toggles, id) {
  return Boolean(toggles?.[id]);
}

let timer = 0;

function mount() {
  const existing = document.getElementById("ideas-delivered-root");
  if (!RECORD.test(location.pathname)) {
    existing?.remove();
    return;
  }
  readState().then((state) => {
    const active = Object.entries(state.toggles || {}).some(([id, enabled]) => enabled && PANEL_IDEAS.has(id));
    if (!active) {
      existing?.remove();
      clearInterval(timer);
      return;
    }
    const root = existing || document.createElement("div");
    root.id = "ideas-delivered-root";
    if (!existing) document.documentElement.append(root);
    const shadow = root.shadowRoot || root.attachShadow({ mode: "open" });
    render(shadow, state).catch((error) => {
      shadow.innerHTML = `<style>${css()}</style><section class="panel"><p>${escapeHtml(error.message)}</p></section>`;
    });
  });
}

async function render(shadow, state) {
  const toggles = state.toggles || {};
  const boot = await ask("bootstrap");
  const prefs = state.listPrefs || {};
  const objectKey = location.pathname.split("/")[3] || "record";
  const saved = prefs[objectKey] || {};
  const lists = boot.lists || [];
  const selected = lists.find((list) => list.id === saved.relatedListId) || lists[0];
  if (!selected) {
    shadow.innerHTML = `<style>${css()}</style><section class="panel"><p>This record has no related list the extension can read.</p></section>`;
    return;
  }
  const wide = on(toggles, "more-related-columns") || on(toggles, "more-list-columns");
  const columns = await ask("columns", {
    objectApiName: selected.objectApiName,
    includeParent: on(toggles, "parent-columns"),
    wide
  });
  const limit = on(toggles, "row-count") ? Number(saved.limit) || 25 : 6;
  const sortField = on(toggles, "default-sort") ? saved.sortField || columns[0]?.name : columns[0]?.name;
  const sortDir = saved.sortDir === "DESC" ? "DESC" : "ASC";
  let followed = [];
  if (on(toggles, "following") && saved.following) {
    followed = await ask("following", { userId: boot.userId, objectApiName: selected.objectApiName });
  }
  const numberFields = columns.filter((column) => ["currency", "double", "int", "percent"].includes(column.type)).map((column) => column.name);
  const loaded = await ask("load", {
    request: {
      objectApiName: selected.objectApiName,
      fieldApiName: selected.fieldApiName,
      columns,
      sortField,
      sortDir,
      limit: on(toggles, "select-over-200") ? Math.max(limit, saved.limit || 25) : Math.min(limit, 200),
      mine: on(toggles, "current-user") && saved.mine,
      ownerId: boot.userId,
      serverFilter: on(toggles, "quick-filters") || on(toggles, "more-filters") ? saved.serverFilter : null,
      followingIds: followed,
      totalFields: on(toggles, "totals") ? numberFields : []
    }
  });
  if (on(toggles, "hide-empty") && loaded.count === 0) {
    shadow.innerHTML = "";
    return;
  }
  const rule = state.highlightRule || {};
  const widths = state.columnWidths || {};
  const filterText = (saved.filter || "").toLowerCase();
  const rows = loaded.rows.filter((row) => {
    if (!on(toggles, "quick-filters") || !filterText) return true;
    return Object.values(row).some((value) => String(value).toLowerCase().includes(filterText));
  });
  shadow.innerHTML = view({
    lists,
    selected,
    columns,
    rows,
    count: loaded.count,
    totals: loaded.totals,
    toggles,
    saved,
    rule,
    widths,
    sortField,
    sortDir
  });
  bind(shadow, { selected, columns, objectKey, saved, toggles, boot });
  if (on(toggles, "auto-refresh")) {
    clearInterval(timer);
    timer = setInterval(mount, 60000);
  }
}

function view(data) {
  const options = data.lists
    .map((list) => `<option value="${escapeHtml(list.id)}" ${list.id === data.selected.id ? "selected" : ""}>${escapeHtml(list.label)}</option>`)
    .join("");
  const totals = Object.entries(data.totals)
    .map(([field, value]) => `<span>${escapeHtml(field)} ${escapeHtml(value)}</span>`)
    .join("");
  const head = data.columns
    .map((column) => {
      const width = data.widths[column.name] ? ` style="width:${Number(data.widths[column.name])}px"` : "";
      return `<th data-sort="${escapeHtml(column.name)}"${width}>${escapeHtml(column.label)}</th>`;
    })
    .join("");
  const body = data.rows
    .map((row) => {
      const marked = data.toggles.highlight && matches(row, data.rule) ? " class=\"mark\"" : "";
      const cells = data.columns
        .map((column) => {
          const text = escapeHtml(row[column.name]);
          const edit = data.toggles["inline-edit-related"] && column.updateable ? " data-edit=\"1\"" : "";
          const title = data.toggles.hover ? ` title="${escapeHtml(JSON.stringify(row))}"` : "";
          return `<td data-field="${escapeHtml(column.name)}" data-id="${escapeHtml(row.Id)}"${edit}${title}>${text}</td>`;
        })
        .join("");
      const check = data.toggles["mass-delete-rows"] || data.toggles["change-owner"] || data.toggles["select-over-200"]
        ? `<td><input type="checkbox" data-pick="${escapeHtml(row.Id)}"></td>`
        : "";
      return `<tr${marked}>${check}${cells}</tr>`;
    })
    .join("");
  const pickHead = data.toggles["mass-delete-rows"] || data.toggles["change-owner"] || data.toggles["select-over-200"] ? "<th></th>" : "";
  return `<style>${css()}</style>
    <section class="panel">
      <header>
        <strong>Ideas Delivered</strong>
        <span>${data.toggles["real-count"] ? `${data.count} records` : `${data.rows.length} shown`}</span>
        ${totals}
      </header>
      <div class="tools">
        <select data-list>${options}</select>
        ${data.toggles["row-count"] ? `<select data-limit><option>10</option><option>25</option><option>50</option><option>100</option><option>200</option></select>` : ""}
        ${data.toggles["quick-filters"] ? `<input data-filter placeholder="Filter loaded rows" value="${escapeHtml(data.saved.filter || "")}">` : ""}
        ${data.toggles["current-user"] ? `<button type="button" data-mine>${data.saved.mine ? "All records" : "Mine"}</button>` : ""}
        ${data.toggles.following ? `<button type="button" data-follow>${data.saved.following ? "All records" : "Following"}</button>` : ""}
        ${data.toggles.export ? `<button type="button" data-export>Export</button>` : ""}
        ${data.toggles["mass-delete-rows"] ? `<button type="button" data-delete>Delete selected</button>` : ""}
        ${data.toggles["change-owner"] ? `<input data-owner placeholder="New owner id"><button type="button" data-owner-go>Change owner</button>` : ""}
      </div>
      ${data.toggles.highlight ? `<div class="tools"><input data-rule-field placeholder="Field" value="${escapeHtml(data.rule.field || "")}"><select data-rule-op><option value="eq">equals</option><option value="contains">contains</option><option value="lt">below</option><option value="gt">above</option></select><input data-rule-value placeholder="Value" value="${escapeHtml(data.rule.value || "")}"></div>` : ""}
      <div class="table"><table><thead><tr>${pickHead}${head}</tr></thead><tbody>${body}</tbody></table></div>
    </section>`;
}

function bind(shadow, ctx) {
  const { selected, columns, objectKey, saved, toggles } = ctx;
  const limit = shadow.querySelector("[data-limit]");
  if (limit) limit.value = String(saved.limit || 25);
  const op = shadow.querySelector("[data-rule-op]");
  if (op && saved.ruleOp) op.value = saved.ruleOp;
  shadow.querySelector("[data-list]")?.addEventListener("change", (event) => savePref(objectKey, { relatedListId: event.target.value }));
  limit?.addEventListener("change", (event) => savePref(objectKey, { limit: Number(event.target.value) }));
  shadow.querySelector("[data-filter]")?.addEventListener("change", (event) => savePref(objectKey, { filter: event.target.value }));
  shadow.querySelector("[data-mine]")?.addEventListener("click", () => savePref(objectKey, { mine: !saved.mine }));
  shadow.querySelector("[data-follow]")?.addEventListener("click", () => savePref(objectKey, { following: !saved.following }));
  shadow.querySelector("[data-export]")?.addEventListener("click", () => exportRows(shadow, columns));
  shadow.querySelector("[data-delete]")?.addEventListener("click", async () => {
    const ids = picked(shadow);
    if (!ids.length || !window.confirm(`Delete ${ids.length} records?`)) return;
    await ask("remove", { objectApiName: selected.objectApiName, ids });
    mount();
  });
  shadow.querySelector("[data-owner-go]")?.addEventListener("click", async () => {
    const ownerId = shadow.querySelector("[data-owner]").value.trim();
    const ids = picked(shadow);
    if (!ids.length) return;
    await ask("owner", { objectApiName: selected.objectApiName, ids, ownerId });
    mount();
  });
  shadow.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      if (!toggles["default-sort"] && !toggles["sort-activities"]) return;
      const field = header.dataset.sort;
      const sortDir = saved.sortField === field && saved.sortDir !== "DESC" ? "DESC" : "ASC";
      savePref(objectKey, { sortField: field, sortDir });
    });
  });
  shadow.querySelectorAll("[data-rule-field], [data-rule-value], [data-rule-op]").forEach((input) => {
    input.addEventListener("change", () => {
      chrome.storage.local.set({
        highlightRule: {
          field: shadow.querySelector("[data-rule-field]").value.trim(),
          op: shadow.querySelector("[data-rule-op]").value,
          value: shadow.querySelector("[data-rule-value]").value
        }
      }).then(mount);
    });
  });
  shadow.querySelectorAll("td[data-edit]").forEach((cell) => {
    cell.addEventListener("dblclick", async () => {
      const next = window.prompt("New value", cell.textContent || "");
      if (next == null) return;
      await ask("save", {
        objectApiName: selected.objectApiName,
        recordId: cell.dataset.id,
        field: cell.dataset.field,
        value: next
      });
      mount();
    });
  });
}

function picked(shadow) {
  return [...shadow.querySelectorAll("[data-pick]:checked")].map((box) => box.dataset.pick);
}

function exportRows(shadow, columns) {
  const lines = [[...columns.map((column) => column.label)].join(",")];
  shadow.querySelectorAll("tbody tr").forEach((row) => {
    const cells = [...row.querySelectorAll("td")].filter((cell) => cell.dataset.field);
    lines.push(cells.map((cell) => `"${cell.textContent.replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ideas-delivered.csv";
  link.click();
}

function matches(row, rule) {
  if (!rule?.field) return false;
  const left = row[rule.field];
  const right = rule.value;
  if (rule.op === "contains") return String(left).toLowerCase().includes(String(right).toLowerCase());
  if (rule.op === "lt") return Number(left) < Number(right);
  if (rule.op === "gt") return Number(left) > Number(right);
  return String(left) === String(right);
}

function savePref(objectKey, patch) {
  chrome.storage.local.get("listPrefs").then(({ listPrefs }) => {
    const next = listPrefs || {};
    next[objectKey] = { ...(next[objectKey] || {}), ...patch };
    return chrome.storage.local.set({ listPrefs: next });
  }).then(mount);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function css() {
  return `
    .panel { position: fixed; z-index: 10000; left: 16px; right: 16px; bottom: 16px; max-height: 42vh; overflow: auto;
      background: #fff; color: #181818; border: 1px solid #c9c9c9; border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,.16); font: 13px/1.4 "Salesforce Sans", "Segoe UI", sans-serif; }
    header, .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 12px; }
    header { border-bottom: 1px solid #e5e5e5; }
    .table { overflow: auto; padding: 0 12px 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; white-space: nowrap; }
    th { cursor: pointer; }
    tr.mark td { background: #fde7e9; }
    input, select, button { font: inherit; padding: 6px 8px; border: 1px solid #c9c9c9; border-radius: 6px; background: #fff; }
    button { cursor: pointer; }
  `;
}

chrome.runtime.sendMessage({ type: "page", href: location.href });
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "toggles") mount();
});
mount();
