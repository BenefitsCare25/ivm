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
  targetUrlEl.textContent = data.targetUrl || "—";
  sessionIdEl.textContent = data.sessionId ? data.sessionId.slice(0, 8) + "..." : "—";
  timestampEl.textContent = data.timestamp
    ? new Date(data.timestamp).toLocaleString()
    : "—";
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
