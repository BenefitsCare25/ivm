// IVM Auto-Fill Extension — Background Service Worker
//
// MV3 service workers are terminated after ~30s of inactivity. The web app
// handles this with retry logic — sendMessage() wakes the worker, and the
// retry succeeds once initialization is complete.

let lastFillData = null;

function executeIVMFill(scriptText) {
  try {
    const fn = new Function(scriptText);
    fn();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Persistent connection handler for cookie capture.
// chrome.runtime.connect() keeps the service worker alive for the full duration
// of the connection, avoiding the MV3 "message port closed" termination bug.
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== "ivm-cookies") return;

  port.onMessage.addListener((message) => {
    if (message.type !== "IVM_CAPTURE_COOKIES") return;

    const { targetUrl } = message;
    if (!targetUrl) {
      port.postMessage({ success: false, error: "targetUrl is required" });
      port.disconnect();
      return;
    }

    chrome.cookies.getAll({ url: targetUrl })
      .then((cookies) => {
        port.postMessage({ success: true, cookies: cookies || [] });
        port.disconnect();
      })
      .catch((err) => {
        port.postMessage({ success: false, error: err.message || "Failed to get cookies" });
        port.disconnect();
      });
  });
});

// Message handler for ping, cookie capture fallback, and form fill.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "IVM_PING") {
    sendResponse({ installed: true, version: "1.4.0" });
    return false;
  }

  // Store IVM config (base URL + userId) for popup auth
  if (message.type === "IVM_SYNC_CONFIG") {
    const items = {};
    if (message.ivmBaseUrl) items.ivmBaseUrl = message.ivmBaseUrl;
    if (message.ivmUserId) items.ivmUserId = message.ivmUserId;
    chrome.storage.local.set(items, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // Fallback handler for cookie capture when connect() port fails.
  // Primary path is onConnectExternal above; this catches the sendMessage fallback.
  if (message.type === "IVM_CAPTURE_COOKIES") {
    const { targetUrl } = message;
    if (!targetUrl) {
      sendResponse({ success: false, error: "targetUrl is required" });
      return false;
    }
    chrome.cookies.getAll({ url: targetUrl })
      .then((cookies) => {
        sendResponse({ success: true, cookies: cookies || [] });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Failed to get cookies" });
      });
    return true; // keep channel open for async response
  }

  if (message.type === "IVM_FILL") {
    const { targetUrl, script, sessionId } = message;

    lastFillData = { targetUrl, script, sessionId, timestamp: Date.now() };
    chrome.storage.local.set({ lastFillData });

    chrome.tabs.query({ url: targetUrl + "*" }, (existingTabs) => {
      const targetTab = existingTabs.length > 0 ? existingTabs[0] : null;

      if (targetTab) {
        chrome.tabs.update(targetTab.id, { active: true }, () => {
          injectFillScript(targetTab.id, script, sendResponse);
        });
      } else {
        chrome.tabs.create({ url: targetUrl }, (tab) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              injectFillScript(tab.id, script, sendResponse);
            }
          });
        });
      }
    });

    return true;
  }
});

// Internal message handler — serves content script (reliable) + popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script forwards IVM_PING from page
  if (message.type === "IVM_PING") {
    sendResponse({ installed: true, version: "1.5.0" });
    return false;
  }

  // Content script forwards IVM_CAPTURE_COOKIES from page
  if (message.type === "IVM_CAPTURE_COOKIES") {
    const { targetUrl } = message;
    if (!targetUrl) {
      sendResponse({ success: false, error: "targetUrl is required" });
      return false;
    }
    chrome.cookies.getAll({ url: targetUrl })
      .then((cookies) => {
        sendResponse({ success: true, cookies: cookies || [] });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Failed to get cookies" });
      });
    return true;
  }

  // Content script forwards IVM_SYNC_CONFIG from page
  if (message.type === "IVM_SYNC_CONFIG") {
    const items = {};
    if (message.ivmBaseUrl) items.ivmBaseUrl = message.ivmBaseUrl;
    if (message.ivmUserId) items.ivmUserId = message.ivmUserId;
    chrome.storage.local.set(items, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "REFILL") {
    chrome.storage.local.get("lastFillData", (result) => {
      const data = result.lastFillData;
      if (!data) {
        sendResponse({ success: false, error: "No fill data available" });
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          sendResponse({ success: false, error: "No active tab" });
          return;
        }
        injectFillScript(tabs[0].id, data.script, sendResponse);
      });
    });
    return true;
  }

  if (message.type === "GET_STATUS") {
    chrome.storage.local.get("lastFillData", (result) => {
      sendResponse({ lastFillData: result.lastFillData || null });
    });
    return true;
  }
});

function injectFillScript(tabId, script, sendResponse) {
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: executeIVMFill,
      args: [script],
      world: "MAIN",
    })
    .then((results) => {
      const result = results[0]?.result || { success: false, error: "No result" };
      chrome.storage.local.set({
        lastFillResult: { ...result, timestamp: Date.now() },
      });
      sendResponse(result);
    })
    .catch((err) => {
      const result = { success: false, error: err.message };
      chrome.storage.local.set({
        lastFillResult: { ...result, timestamp: Date.now() },
      });
      sendResponse(result);
    });
}
