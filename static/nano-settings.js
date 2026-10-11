const CONNECTION_POLL_INTERVAL_MS = 5_000;

let connectionSettingsInitialized = false;
const connectionStatusBadge = document.getElementById("connection-status-badge");
const connectionStatusCard = document.getElementById("connection-status-card");
let connectionPollAbort = null;
let connectionCompleting = false;

function refreshConnectionFields() {
  if (!connectionUrlInput || !connectionKeyInput) {
    return;
  }
  connectionUrlInput.value = getConfiguredApiUrl();
  connectionKeyInput.value = getApiKey();
}

function setConnectionStatusPresentation(state, label, detail = "") {
  if (connectionStatusCard) {
    connectionStatusCard.dataset.state = state;
  }
  if (connectionStatusBadge) {
    connectionStatusBadge.textContent = label;
  }
  if (!connectionStatus) {
    return;
  }
  const message = (detail || "").trim();
  connectionStatus.textContent = message;
  connectionStatus.hidden = !message;
}

async function refreshConnectionStatusBadge() {
  if (!hasApiConnection()) {
    setConnectionStatusPresentation("offline", "Not configured", "Enter your Pi API URL and key, then test the connection.");
    return;
  }
  setConnectionStatusPresentation("pending", "Checking…", "Verifying API health…");
  try {
    const payload = await checkApiHealth();
    const app = payload?.app ? String(payload.app) : "Nano Core";
    const status = payload?.status ? String(payload.status) : "ok";
    setConnectionStatusPresentation(
      "connected",
      "Connected",
      `Reachable — ${app} (${status}).`
    );
  } catch (error) {
    if (isWrongApiKeyError(error)) {
      setConnectionStatusPresentation("error", "Auth failed", "API key was rejected. Check API_KEY on the Pi.");
      return;
    }
    setConnectionStatusPresentation(
      "error",
      "Disconnected",
      error?.message || "Could not reach the API."
    );
  }
}

function normalizeConnectionInputUrl(url) {
  if (typeof normalizeStoredApiUrl === "function") {
    return normalizeStoredApiUrl(url);
  }
  const trimmed = (url || "").trim().replace(/\/$/, "");
  if (!trimmed) {
    return "";
  }
  if (typeof isSameOriginApiUrl === "function" && isSameOriginApiUrl(trimmed)) {
    return "";
  }
  return trimmed;
}

function validateConnectionUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    return null;
  }

  if (typeof isSameOriginApiUrl === "function" && isSameOriginApiUrl(trimmed)) {
    return "Leave API URL blank when using this site. It connects through the hosted proxy.";
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_error) {
    return "Enter a valid API URL, e.g. http://192.168.1.10:8080";
  }

  if (parsed.hostname === "localhost" && parsed.port === "8080") {
    return "Do not use http://localhost:8080 from another PC — that is your PC, not the Pi.";
  }

  if (parsed.port === "8000") {
    return "Port 8000 is hailo-ollama, not Nano. Use http://<PI-IP>:8080 instead.";
  }

  const effectivePort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  if (effectivePort !== "8080") {
    return "Nano runs on port 8080. Check the API URL.";
  }

  return null;
}

async function checkApiHealth() {
  const response = await nanoFetch("/api/health");
  if (isUnauthorizedResponse(response)) {
    throw new Error(NANO_WRONG_API_KEY_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(`Health check failed (${response.status}).`);
  }
  return response.json();
}

function getStoredUrlValidationError() {
  const configured = getConfiguredApiUrl();
  if (!configured) {
    return null;
  }
  return validateConnectionUrl(configured);
}

function isWrongApiKeyError(error) {
  return error?.message === NANO_WRONG_API_KEY_MESSAGE;
}

function handleConnectionAuthFailure(message) {
  stopConnectionPoll();
  if (typeof showConnectionOverlayFailure === "function") {
    showConnectionOverlayFailure(message);
  }
  requestAnimationFrame(() => {
    void openConnectionSettings();
  });
}

function initConnectionSettings() {
  if (!connectionUrlInput || !connectionKeyInput) {
    return;
  }

  if (!connectionSettingsInitialized) {
    connectionSettingsInitialized = true;

    connectionTestButton?.addEventListener("click", async () => {
      const connectionUrl = normalizeConnectionInputUrl(connectionUrlInput.value);
      const urlValidationError = validateConnectionUrl(connectionUrl);
      if (urlValidationError) {
        setConnectionStatusPresentation("error", "Invalid URL", urlValidationError);
        return;
      }

      setApiConnection(connectionUrl, connectionKeyInput.value);
      connectionUrlInput.value = connectionUrl;
      if (!hasApiConnection()) {
        setConnectionStatusPresentation("offline", "Not configured", "API URL is required.");
        return;
      }
      setConnectionStatusPresentation("pending", "Testing…", "Contacting Nano Core…");
      try {
        const payload = await checkApiHealth();
        const app = payload?.app ? String(payload.app) : "Nano Core";
        const status = payload?.status ? String(payload.status) : "ok";
        setConnectionStatusPresentation(
          "connected",
          "Connected",
          `Reachable — ${app} (${status}).`
        );
        await handleConnectionSuccess();
      } catch (error) {
        const authFailed = isWrongApiKeyError(error);
        setConnectionStatusPresentation(
          authFailed ? "error" : "error",
          authFailed ? "Auth failed" : "Connection failed",
          error?.message || "Could not reach the API."
        );
      }
    });
  }

  refreshConnectionFields();
  void refreshConnectionStatusBadge();
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
  if (typeof renderState === "function") {
    renderState();
  } else if (typeof updateEssenceState === "function") {
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

function showWaitingOverlay() {
  if (typeof showConnectionOverlay === "function") {
    showConnectionOverlay("connecting");
  }
}

function hideWaitingOverlay() {
  if (connectionOverlayMode && connectionOverlayMode !== "connecting") {
    return;
  }
  if (typeof hideConnectionOverlay === "function") {
    hideConnectionOverlay();
  }
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
    while (!aborted) {
      if (hasApiConnection()) {
        try {
          await checkApiHealth();
          await handleConnectionSuccess();
          return;
        } catch (error) {
          if (isWrongApiKeyError(error)) {
            handleConnectionAuthFailure(error.message);
            return;
          }
          // Keep polling until timeout or success.
        }
      }

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
  if (typeof setCommandsSection === "function") {
    setCommandsSection("connection");
  }
}

async function ensureApiConnection() {
  const storedUrlError = getStoredUrlValidationError();
  if (storedUrlError) {
    handleConnectionAuthFailure(storedUrlError);
    return false;
  }

  if (hasApiConnection()) {
    try {
      await checkApiHealth();
      return true;
    } catch (error) {
      if (isWrongApiKeyError(error)) {
        handleConnectionAuthFailure(error.message);
        return false;
      }
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
window.refreshConnectionStatusBadge = refreshConnectionStatusBadge;
