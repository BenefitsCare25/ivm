// IVM Auto-Fill Extension — Background Service Worker

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

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "IVM_PING") {
    sendResponse({ installed: true, version: "1.0.0" });
    return;
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
