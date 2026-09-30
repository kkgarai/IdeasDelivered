import {
  changeOwner,
  columnsFor,
  currentUser,
  followingIds,
  isSalesforcePage,
  loadList,
  pageContext,
  relatedLists,
  removeRecords,
  saveField
} from "./salesforce.js";

const RECORD_URL = /\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15,18})(?:\/|$)/;

function recordIdFromUrl(url) {
  const match = String(url || "").match(RECORD_URL);
  return match ? match[1] : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "page") {
    chrome.storage.session.set({
      page: {
        recordId: recordIdFromUrl(sender.tab?.url || message.href),
        url: sender.tab?.url || message.href || ""
      }
    });
    return;
  }
  if (message?.type !== "sf") return;
  handle(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handle(message) {
  const ctx = pageContext(message.url);
  if (!ctx) throw new Error("Open a Lightning record page.");
  if (message.action === "bootstrap") {
    const [lists, userId] = await Promise.all([relatedLists(ctx), currentUser(ctx)]);
    return { lists, userId };
  }
  if (message.action === "columns") {
    return columnsFor(ctx, message.objectApiName, message.includeParent, message.wide);
  }
  if (message.action === "following") {
    return followingIds(ctx, message.userId, message.objectApiName);
  }
  if (message.action === "load") return loadList(ctx, message.request);
  if (message.action === "save") {
    await saveField(ctx, message.objectApiName, message.recordId, message.field, message.value);
    return true;
  }
  if (message.action === "remove") {
    await removeRecords(ctx, message.objectApiName, message.ids || []);
    return true;
  }
  if (message.action === "owner") {
    await changeOwner(ctx, message.objectApiName, message.ids || [], message.ownerId);
    return true;
  }
  throw new Error("Unknown request.");
}

function allowAction(tabId, url) {
  if (isSalesforcePage(url)) chrome.action.enable(tabId);
  else chrome.action.disable(tabId);
}

chrome.action.disable();
chrome.tabs.query({}).then((tabs) => {
  for (const tab of tabs) {
    if (tab.id) allowAction(tab.id, tab.url);
  }
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "complete") allowAction(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => allowAction(tabId, tab.url)).catch(() => {});
});
