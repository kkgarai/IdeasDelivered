import { extensionIdeas, packageIdeas } from "./ideas.js";

const STORAGE_KEY = "toggles";

function readToggles() {
  return chrome.storage.local.get(STORAGE_KEY).then((stored) => stored[STORAGE_KEY] || {});
}

function writeToggle(id, enabled) {
  return readToggles().then((toggles) => {
    toggles[id] = enabled;
    return chrome.storage.local.set({ [STORAGE_KEY]: toggles });
  });
}

function renderList(container, ideas, toggles) {
  container.replaceChildren();
  for (const idea of ideas) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(toggles[idea.id]);
    input.addEventListener("change", () => {
      writeToggle(idea.id, input.checked);
    });
    const text = document.createElement("span");
    const link = document.createElement("a");
    link.href = idea.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = idea.name;
    const points = document.createElement("small");
    points.textContent = ` ${idea.points.toLocaleString("en-US")} points`;
    text.append(link, points);
    label.append(input, text);
    container.append(label);
  }
}

readToggles().then((toggles) => {
  renderList(document.querySelector("#extension"), extensionIdeas, toggles);
  renderList(document.querySelector("#package"), packageIdeas, toggles);
});

chrome.storage.session.get("page").then(({ page }) => {
  const line = document.querySelector("#page");
  line.textContent = page?.recordId ? `Record ${page.recordId}` : "Open a Lightning record to see its id.";
});
