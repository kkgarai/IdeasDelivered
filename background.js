const RECORD_URL = /\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15,18})(?:\/|$)/;

function recordIdFromUrl(url) {
  const match = String(url || "").match(RECORD_URL);
  return match ? match[1] : null;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "page") {
    return;
  }
  chrome.storage.session.set({
    page: {
      recordId: recordIdFromUrl(sender.tab?.url || message.href),
      url: sender.tab?.url || message.href || ""
    }
  });
});
