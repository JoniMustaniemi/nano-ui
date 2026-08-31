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
        } catch (_error) {
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
