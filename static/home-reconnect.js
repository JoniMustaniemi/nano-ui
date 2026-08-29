const SYSTEM_COMMAND_IDS = new Set(["reboot_pi", "restart_nano"]);

const RECONNECT_SUCCESS = {
  reboot_pi: /rebooting the raspberry pi now/i,
  restart_nano: /restarting nano now/i,
};
const RECONNECT_CANCEL = {
  reboot_pi: /reboot cancelled/i,
  restart_nano: /service restart cancelled/i,
};
const RECONNECT_DISABLED = {
  reboot_pi: /reboot is disabled/i,
  restart_nano: /service restart is disabled/i,
};
const RECONNECT_TIMEOUT_MS = {
  reboot_pi: 180_000,
  restart_nano: 30_000,
};

const RECONNECT_LABELS = {
  reboot_pi: "Waiting for the Raspberry Pi to come back online.",
  restart_nano: "Waiting for Nano to restart.",
};

function isSystemCommandId(commandId) {
  return SYSTEM_COMMAND_IDS.has(String(commandId || "").trim());
}

function inferSystemCommandFromText(text) {
  const content = String(text || "");
  for (const commandId of SYSTEM_COMMAND_IDS) {
    if (RECONNECT_SUCCESS[commandId].test(content)) {
      return commandId;
    }
    if (RECONNECT_CANCEL[commandId].test(content)) {
      return commandId;
    }
    if (RECONNECT_DISABLED[commandId].test(content)) {
      return commandId;
    }
  }
  return null;
}

function inferSystemCommandFromMessage(message) {
  const lowered = String(message || "").toLowerCase();
  if (
    lowered.includes("restart the raspberry pi") ||
    lowered.includes("reboot the raspberry pi") ||
    lowered.includes("reboot the pi") ||
    lowered.includes("reboot")
  ) {
    return "reboot_pi";
  }
  if (
    lowered.includes("restart yourself") ||
    lowered.includes("restart nano") ||
    lowered.includes("restart the service") ||
    lowered.includes("restart")
  ) {
    return "restart_nano";
  }
  return null;
}

function matchSystemCommandPhrase(text, patterns, commandId = null) {
  const content = String(text || "");
  if (commandId && patterns[commandId]?.test(content)) {
    return commandId;
  }
  for (const id of SYSTEM_COMMAND_IDS) {
    if (patterns[id].test(content)) {
      return id;
    }
  }
  return null;
}

function clearPendingSystemCommand() {
  pendingSystemCommandId = null;
}

function setPendingSystemCommand(commandId) {
  if (isSystemCommandId(commandId)) {
    pendingSystemCommandId = commandId;
  }
}

function ensureReconnectOverlay() {
  let overlay = document.getElementById("nano-reconnect-overlay");
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("section");
  overlay.id = "nano-reconnect-overlay";
  overlay.className = "nano-reconnect-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="nano-reconnect-panel" role="status" aria-live="polite">
      <h2 id="nano-reconnect-title">Reconnecting to Nano</h2>
      <p id="nano-reconnect-detail">Waiting for Nano to come back online.</p>
      <p id="nano-reconnect-status" class="nano-reconnect-status"></p>
      <div class="nano-reconnect-actions" hidden>
        <button type="button" id="nano-reconnect-retry">Refresh</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const retryButton = overlay.querySelector("#nano-reconnect-retry");
  retryButton.addEventListener("click", () => {
    void recoverAfterReconnect();
  });

  return overlay;
}

function showReconnectOverlay(kind, statusText) {
  const overlay = ensureReconnectOverlay();
  const title = overlay.querySelector("#nano-reconnect-title");
  const detail = overlay.querySelector("#nano-reconnect-detail");
  const status = overlay.querySelector("#nano-reconnect-status");
  const actions = overlay.querySelector(".nano-reconnect-actions");

  title.textContent =
    kind === "reboot_pi" ? "Reconnecting after reboot" : "Reconnecting after restart";
  detail.textContent = RECONNECT_LABELS[kind] || "Waiting for Nano to come back online.";
  status.textContent = statusText || "Checking connection...";
  actions.hidden = true;
  overlay.hidden = false;
  updateInputLock();
}

function hideReconnectOverlay() {
  const overlay = document.getElementById("nano-reconnect-overlay");
  if (!overlay) {
    return;
  }
  overlay.hidden = true;
  const actions = overlay.querySelector(".nano-reconnect-actions");
  if (actions) {
    actions.hidden = true;
  }
  updateInputLock();
}

function showReconnectFailure(message) {
  const overlay = ensureReconnectOverlay();
  const status = overlay.querySelector("#nano-reconnect-status");
  const actions = overlay.querySelector(".nano-reconnect-actions");
  status.textContent = message || "Could not reconnect. Check the Pi and refresh.";
  actions.hidden = false;
  overlay.hidden = false;
  updateInputLock();
}

async function recoverAfterReconnect() {
  hideReconnectOverlay();
  stateLine.textContent = "standby";
  updateEssenceState();
  if (typeof closeActivityEventSource === "function") {
    closeActivityEventSource();
  }
  if (typeof bootstrap === "function") {
    await bootstrap();
  }
  reconnectInProgress = false;
  clearPendingSystemCommand();
  updateInputLock();
}

async function beginNanoReconnect(kind) {
  if (!isSystemCommandId(kind) || reconnectInProgress) {
    return;
  }

  reconnectInProgress = true;
  stateLine.textContent = "reconnecting";
  updateEssenceState();
  showReconnectOverlay(kind, "Checking connection...");
  if (typeof closeActivityEventSource === "function") {
    closeActivityEventSource();
  }

  const recovered = await waitForNano({
    timeoutMs: RECONNECT_TIMEOUT_MS[kind] || 120_000,
    intervalMs: 2_000,
  });

  if (recovered) {
    await recoverAfterReconnect();
    return;
  }

  reconnectInProgress = false;
  showReconnectFailure("Could not reconnect. Check the Pi and refresh.");
}

function handleSystemCommandResponse(answerText) {
  const disabledKind = matchSystemCommandPhrase(
    answerText,
    RECONNECT_DISABLED,
    pendingSystemCommandId
  );
  if (disabledKind) {
    clearPendingSystemCommand();
    return { handled: true, reconnect: false };
  }

  const cancelKind = matchSystemCommandPhrase(
    answerText,
    RECONNECT_CANCEL,
    pendingSystemCommandId
  );
  if (cancelKind) {
    clearPendingSystemCommand();
    return { handled: true, reconnect: false };
  }

  const successKind = matchSystemCommandPhrase(
    answerText,
    RECONNECT_SUCCESS,
    pendingSystemCommandId
  );
  if (successKind) {
    clearPendingSystemCommand();
    return { handled: true, reconnect: true, kind: successKind };
  }

  return { handled: false };
}
