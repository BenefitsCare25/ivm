// IVM Content Script — bridges web page ↔ background service worker.
//
// Why: externally_connectable (sendMessage/connect from page to extension) is
// unreliable with MV3 service workers. Content scripts are always injected and
// use INTERNAL chrome.runtime.sendMessage which handles worker wake-up reliably.
//
// Flow: page dispatches CustomEvent → content script → chrome.runtime.sendMessage
//       → background responds → content script → page receives CustomEvent

window.addEventListener("IVM_REQUEST", (event) => {
  const detail = event.detail;
  if (!detail || !detail.type) return;

  const requestId = detail._requestId;

  chrome.runtime.sendMessage(detail, (response) => {
    const error = chrome.runtime.lastError;
    if (error) {
      window.dispatchEvent(
        new CustomEvent("IVM_RESPONSE", {
          detail: { _requestId: requestId, _error: error.message },
        })
      );
      return;
    }
    window.dispatchEvent(
      new CustomEvent("IVM_RESPONSE", {
        detail: { _requestId: requestId, ...response },
      })
    );
  });
});

// Signal to the page that the content script is loaded
window.dispatchEvent(new CustomEvent("IVM_CONTENT_SCRIPT_READY"));
