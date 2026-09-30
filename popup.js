import { extensionIdeas, packageIdeas } from "./ideas.js";
import { isSalesforcePage } from "./salesforce.js";

const STORAGE_KEY = "toggles";

function readToggles() {
  return chrome.storage.local.get(STORAGE_KEY).then((stored) => stored[STORAGE_KEY] || {});
}

function writeToggle(id, enabled) {
  return readToggles().then((toggles) => {
    toggles[id] = enabled;
    return chrome.storage.local.set({ [STORAGE_KEY]: toggles }).then(() => {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "toggles" }).catch(() => {});
      });
    });
  });
}

function renderList(container, ideas, toggles) {
  container.replaceChildren();
  if (!ideas.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No matching ideas.";
    container.append(empty);
    return;
  }
  for (const idea of ideas) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(toggles[idea.id]);
    input.addEventListener("change", () => {
      toggles[idea.id] = input.checked;
      writeToggle(idea.id, input.checked);
      const enabled = [...extensionIdeas, ...packageIdeas].filter((item) => toggles[item.id]).length;
      document.querySelector("#count").textContent = `${enabled} on`;
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

const locked = document.querySelector("#locked");
const app = document.querySelector("#app");
const find = document.querySelector("#find");

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (!isSalesforcePage(tab?.url)) {
    locked.hidden = false;
    return;
  }
  locked.hidden = true;
  app.hidden = false;
  const toggles = await readToggles();
  const page = await chrome.storage.session.get("page");
  const recordId = page.page?.recordId;
  document.querySelector("#page").textContent = recordId ? `Record ${recordId}` : "Salesforce page";
  const enabled = [...extensionIdeas, ...packageIdeas].filter((idea) => toggles[idea.id]).length;
  document.querySelector("#count").textContent = `${enabled} on`;

  const draw = () => {
    const query = find.value.trim().toLowerCase();
    const match = (idea) => idea.name.toLowerCase().includes(query);
    renderList(document.querySelector("#extension"), extensionIdeas.filter(match), toggles);
    renderList(document.querySelector("#package"), packageIdeas.filter(match), toggles);
  };
  find.addEventListener("input", draw);
  draw();
});
