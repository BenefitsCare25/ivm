// === Fill Section ===

const statusEl = document.getElementById("status");
const infoEl = document.getElementById("info");
const targetUrlEl = document.getElementById("targetUrl");
const sessionIdEl = document.getElementById("sessionId");
const timestampEl = document.getElementById("timestamp");
const refillBtn = document.getElementById("refillBtn");

function updateUI(data) {
  if (!data) {
    statusEl.className = "status idle";
    statusEl.textContent = "Waiting for fill data from IVM...";
    infoEl.style.display = "none";
    refillBtn.disabled = true;
    return;
  }

  statusEl.className = "status ready";
  statusEl.textContent = "Fill data ready. Click below to re-run on the active tab.";
  infoEl.style.display = "block";
  targetUrlEl.textContent = data.targetUrl || "\u2014";
  sessionIdEl.textContent = data.sessionId ? data.sessionId.slice(0, 8) + "..." : "\u2014";
  timestampEl.textContent = data.timestamp
    ? new Date(data.timestamp).toLocaleString()
    : "\u2014";
  refillBtn.disabled = false;
}

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  updateUI(response?.lastFillData);
});

refillBtn.addEventListener("click", () => {
  refillBtn.disabled = true;
  refillBtn.textContent = "Filling...";

  chrome.runtime.sendMessage({ type: "REFILL" }, (response) => {
    if (response?.success) {
      statusEl.className = "status ready";
      statusEl.textContent = "Fill executed successfully.";
      refillBtn.textContent = "Re-run Fill on Active Tab";
      refillBtn.disabled = false;
    } else {
      statusEl.className = "status error";
      statusEl.textContent = "Fill failed: " + (response?.error || "Unknown error");
      refillBtn.textContent = "Re-run Fill on Active Tab";
      refillBtn.disabled = false;
    }
  });
});

// === Portal Cookies Section ===

const tabDomainEl = document.getElementById("tabDomain");
const sendCookiesBtn = document.getElementById("sendCookiesBtn");
const cookieStatusEl = document.getElementById("cookieStatus");

const IVM_DEFAULT_URL = "http://localhost:3000";
let activeTabUrl = null;

// Detect active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs || tabs.length === 0) {
    tabDomainEl.textContent = "No active tab detected";
    return;
  }

  const tab = tabs[0];
  activeTabUrl = tab.url;

  if (!activeTabUrl || activeTabUrl.startsWith("chrome://") || activeTabUrl.startsWith("chrome-extension://")) {
    tabDomainEl.textContent = "Cannot capture cookies from browser pages";
    return;
  }

  try {
    const domain = new URL(activeTabUrl).hostname;
    tabDomainEl.textContent = "Current tab: " + domain;
    sendCookiesBtn.disabled = false;
  } catch {
    tabDomainEl.textContent = "Invalid URL";
  }
});

function mapSameSite(value) {
  switch (value) {
    case "strict": return "Strict";
    case "lax": return "Lax";
    case "no_restriction": return "None";
    default: return undefined;
  }
}

function showCookieStatus(type, message) {
  cookieStatusEl.style.display = "block";
  cookieStatusEl.className = "cookie-status " + type;
  cookieStatusEl.textContent = message;
}

function resetSendButton() {
  sendCookiesBtn.textContent = "Send Cookies to IVM";
  sendCookiesBtn.disabled = false;
}

sendCookiesBtn.addEventListener("click", () => {
  if (!activeTabUrl) return;

  sendCookiesBtn.disabled = true;
  sendCookiesBtn.textContent = "Capturing...";
  cookieStatusEl.style.display = "none";

  chrome.cookies.getAll({ url: activeTabUrl }, (cookies) => {
    if (chrome.runtime.lastError) {
      showCookieStatus("error", "Failed: " + chrome.runtime.lastError.message);
      resetSendButton();
      return;
    }

    if (!cookies || cookies.length === 0) {
      showCookieStatus("error", "No cookies found for this site. Are you logged in?");
      resetSendButton();
      return;
    }

    const mapped = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      expires: c.expirationDate,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: mapSameSite(c.sameSite),
    }));

    // Read stored IVM URL at click time to avoid race with storage load
    chrome.storage.local.get("ivmBaseUrl", (result) => {
      const ivmBaseUrl = result.ivmBaseUrl || IVM_DEFAULT_URL;

      fetch(ivmBaseUrl + "/api/extension/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: activeTabUrl, cookies: mapped }),
      })
        .then((res) => {
          if (!res.ok) return res.json().then((d) => Promise.reject(d));
          return res.json();
        })
        .then((data) => {
          const portalName = data.portalName || "portal";
          showCookieStatus("success", "Sent " + mapped.length + " cookies to " + portalName);
          resetSendButton();
        })
        .catch((err) => {
          const msg = err?.error || err?.message || "Failed to send cookies to IVM";
          showCookieStatus("error", msg);
          resetSendButton();
        });
    });
  });
});
