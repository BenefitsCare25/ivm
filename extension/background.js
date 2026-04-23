// IVM Auto-Fill Extension — Background Service Worker
//
// MV3 service workers are terminated after ~30s of inactivity. The web app
// handles this with retry logic — sendMessage() wakes the worker, and the
// retry succeeds once initialization is complete.

let lastFillData = null;

/**
 * Execute structured fill operations safely — no eval/new Function.
 * Each op: { selector, value, type }
 *   type: "value" (input/select/textarea), "check" (checkbox), "click" (button)
 */
function executeIVMOperations(operations) {
  try {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: false, error: "No operations provided" };
    }
    let applied = 0;
    for (const op of operations) {
      const el = document.querySelector(op.selector);
      if (!el) continue;
      if (op.type === "check") {
        el.checked = !!op.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (op.type === "click") {
        el.click();
      } else {
        el.value = op.value ?? "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      applied++;
    }
    return { success: true, applied };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Legacy script executor — kept for bookmarklet / DevTools copy-paste path only */
function executeIVMFill(scriptText) {
  try {
    // eslint-disable-next-line no-new-func
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
    sendResponse({ installed: true, version: "1.6.0" });
    return false;
  }

  // Store IVM config (base URL + signed extension token) for popup auth
  if (message.type === "IVM_SYNC_CONFIG") {
    const items = {};
    if (message.ivmBaseUrl) items.ivmBaseUrl = message.ivmBaseUrl;
    if (message.ivmExtensionToken) items.ivmExtensionToken = message.ivmExtensionToken;
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
    const { targetUrl, script, operations, sessionId } = message;

    lastFillData = { targetUrl, script, operations, sessionId, timestamp: Date.now() };
    chrome.storage.local.set({ lastFillData });

    chrome.tabs.query({ url: targetUrl + "*" }, (existingTabs) => {
      const targetTab = existingTabs.length > 0 ? existingTabs[0] : null;

      if (targetTab) {
        chrome.tabs.update(targetTab.id, { active: true }, () => {
          injectFill(targetTab.id, operations, script, sendResponse);
        });
      } else {
        chrome.tabs.create({ url: targetUrl }, (tab) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              injectFill(tab.id, operations, script, sendResponse);
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
    sendResponse({ installed: true, version: "1.6.0" });
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
    if (message.ivmExtensionToken) items.ivmExtensionToken = message.ivmExtensionToken;
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
        injectFill(tabs[0].id, data.operations, data.script, sendResponse);
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

/**
 * Inject fill into a tab.
 * Prefers structured operations (no eval). Falls back to script string only
 * when no operations are provided (legacy bookmarklet/DevTools copy-paste path).
 */
function injectFill(tabId, operations, script, sendResponse) {
  const useOps = Array.isArray(operations) && operations.length > 0;
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: useOps ? executeIVMOperations : executeIVMFill,
      args: [useOps ? operations : script],
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
