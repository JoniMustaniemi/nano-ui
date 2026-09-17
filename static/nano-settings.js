const CONNECTION_POLL_INTERVAL_MS = 5_000;

let connectionSettingsInitialized = false;
let connectionPollAbort = null;
let connectionCompleting = false;

function refreshConnectionFields() {
  if (!connectionUrlInput || !connectionKeyInput) {
    return;
  }
  connectionUrlInput.value = getConfiguredApiUrl();
  connectionKeyInput.value = getApiKey();
}

function validateConnectionUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    return null;
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
      const urlValidationError = validateConnectionUrl(connectionUrlInput.value);
      if (urlValidationError) {
        if (connectionStatus) {
          connectionStatus.textContent = urlValidationError;
        }
        return;
      }

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
  if (connectionSettingsDropdown) {
    connectionSettingsDropdown.open = true;
  }
  if (connectionSettingsSection) {
    connectionSettingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
