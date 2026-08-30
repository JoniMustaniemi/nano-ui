const WAITING_MESSAGES = [
  "Searching for your Raspberry Pi on the network...",
  "Nano lives on your Pi — set the API URL in Connection settings.",
  "Make sure your Pi is powered on and reachable.",
  "I'll connect automatically once I find it.",
];

const CONNECTION_POLL_INTERVAL_MS = 5_000;

let connectionSettingsInitialized = false;
let connectionPollAbort = null;
let messageRotateTimer = null;
let messageIndex = 0;
let connectionCompleting = false;

function refreshConnectionFields() {
  if (!connectionUrlInput || !connectionKeyInput) {
    return;
  }
  connectionUrlInput.value = getApiBase();
  connectionKeyInput.value = getApiKey();
}

async function checkApiHealth() {
  const response = await nanoFetch("/api/health");
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status}).`);
  }
  return response.json();
}

function initConnectionSettings() {
  if (!connectionUrlInput || !connectionKeyInput) {
    return;
  }

  if (!connectionSettingsInitialized) {
    connectionSettingsInitialized = true;

    connectionTestButton?.addEventListener("click", async () => {
      setApiConnection(connectionUrlInput.value, connectionKeyInput.value);
      if (!hasApiConnection()) {
        if (connectionStatus) {
          connectionStatus.textContent = "API URL is required.";
        }
        return;
      }
      if (connectionStatus) {
        connectionStatus.textContent = "Testing connection...";
      }
      try {
        const payload = await checkApiHealth();
        if (connectionStatus) {
          connectionStatus.textContent = `Connected to ${payload.app} (${payload.status}).`;
        }
        await handleConnectionSuccess();
      } catch (error) {
        if (connectionStatus) {
          connectionStatus.textContent = error.message;
        }
      }
    });
  }

  refreshConnectionFields();
}

async function handleConnectionSuccess() {
  if (connectionCompleting) {
    return;
  }
  connectionCompleting = true;

  stopConnectionPoll();
  hideWaitingOverlay();

  if (typeof stateLine !== "undefined" && stateLine) {
    stateLine.textContent = "standby";
  }
  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }

  if (typeof completeStartupAfterConnection === "function") {
    await completeStartupAfterConnection();
    return;
  }

  if (typeof bootstrap === "function") {
    await bootstrap();
  }
}

function ensureWaitingOverlay() {
  let overlay = document.getElementById("nano-waiting-overlay");
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("section");
  overlay.id = "nano-waiting-overlay";
  overlay.className = "nano-waiting-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="nano-waiting-content" role="status" aria-live="polite">
      <h2 class="nano-waiting-headline">Waiting for Nano...</h2>
      <p id="nano-waiting-detail" class="nano-waiting-detail"></p>
      <p id="nano-waiting-status" class="nano-waiting-status">Checking connection</p>
    </div>
  `;
  document.body.appendChild(overlay);

  return overlay;
}

function setWaitingDetail(text) {
  const detail = document.getElementById("nano-waiting-detail");
  if (!detail) {
    return;
  }
  detail.textContent = text;
}

function rotateWaitingMessage() {
  const detail = document.getElementById("nano-waiting-detail");
  if (!detail) {
    return;
  }

  detail.classList.add("is-fading");
  window.setTimeout(() => {
    messageIndex = (messageIndex + 1) % WAITING_MESSAGES.length;
    setWaitingDetail(WAITING_MESSAGES[messageIndex]);
    detail.classList.remove("is-fading");
  }, 400);
}

function startWaitingMessageRotation() {
  stopWaitingMessageRotation();
  messageIndex = 0;
  setWaitingDetail(WAITING_MESSAGES[messageIndex]);
  messageRotateTimer = window.setInterval(rotateWaitingMessage, 4_000);
}

function stopWaitingMessageRotation() {
  if (messageRotateTimer) {
    window.clearInterval(messageRotateTimer);
    messageRotateTimer = null;
  }
}

function updateWaitingStatus(attempt) {
  const status = document.getElementById("nano-waiting-status");
  if (!status) {
    return;
  }
  status.textContent =
    attempt <= 1 ? "Checking connection" : "Still waiting — retrying";
}

function showWaitingOverlay() {
  const overlay = ensureWaitingOverlay();
  overlay.hidden = false;
  document.body.classList.add("connection-waiting");

  if (typeof stateLine !== "undefined" && stateLine) {
    stateLine.textContent = "reconnecting";
  }
  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }

  updateWaitingStatus(0);
  startWaitingMessageRotation();
}

function hideWaitingOverlay() {
  const overlay = document.getElementById("nano-waiting-overlay");
  if (overlay) {
    overlay.hidden = true;
  }
  document.body.classList.remove("connection-waiting");
  stopWaitingMessageRotation();
}

function stopConnectionPoll() {
  if (connectionPollAbort) {
    connectionPollAbort();
    connectionPollAbort = null;
  }
}

function startConnectionPoll() {
  stopConnectionPoll();

  let aborted = false;
  connectionPollAbort = () => {
    aborted = true;
  };

  void (async () => {
    let attempt = 0;
    while (!aborted) {
      if (hasApiConnection()) {
        try {
          await checkApiHealth();
          await handleConnectionSuccess();
          return;
        } catch (_error) {
          // Keep polling until timeout or success.
        }
      }

      attempt += 1;
      updateWaitingStatus(attempt);
      await new Promise((resolve) => {
        window.setTimeout(resolve, CONNECTION_POLL_INTERVAL_MS);
      });
    }
  })();
}

async function openConnectionSettings() {
  if (typeof openViewSession === "function") {
    await openViewSession("commands", { source: "ui" });
  }
  if (typeof initConnectionSettings === "function") {
    initConnectionSettings();
  }
  if (connectionSettingsDropdown) {
    connectionSettingsDropdown.open = true;
  }
  if (connectionSettingsSection) {
    connectionSettingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function ensureApiConnection() {
  if (hasApiConnection()) {
    try {
      await checkApiHealth();
      return true;
    } catch (_error) {
      // Fall through to waiting overlay.
    }
  }

  showWaitingOverlay();
  startConnectionPoll();

  if (!hasApiConnection()) {
    requestAnimationFrame(() => {
      void openConnectionSettings();
    });
  }

  return false;
}

window.ensureApiConnection = ensureApiConnection;
window.initConnectionSettings = initConnectionSettings;
window.openConnectionSettings = openConnectionSettings;
