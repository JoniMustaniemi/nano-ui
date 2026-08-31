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

const REBOOT_MIN_RESTORE_MS = 20_000;
const CONNECTION_RECOVERY_POLL_MS = 2_000;
const CONNECTION_RECOVERY_TIMEOUT_MS = 120_000;

let connectionRecoveryPromise = null;

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

function enterConnectionRecoveryState() {
  reconnectInProgress = true;
  stateLine.textContent = "reconnecting";
  document.body.dataset.displayState = "reconnecting";
  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }
  updateInputLock();
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function delayUntilMinElapsed(minMs, startedAt) {
  const elapsed = Date.now() - startedAt;
  const remaining = minMs - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function waitForRebootMinimumHold() {
  await delayUntilMinElapsed(REBOOT_MIN_RESTORE_MS, connectionRecoveryStartedAt);
}

async function animateRebootHold() {
  await delayUntilMinElapsed(REBOOT_MIN_RESTORE_MS, connectionRecoveryStartedAt);
}

async function recoverAfterReconnect() {
  if (typeof hideConnectionOverlay === "function") {
    hideConnectionOverlay();
  }
  connectionRecoveryStartedAt = 0;
  reconnectInProgress = false;
  rebootBaselineBootId = null;
  clearPendingSystemCommand();
  stateLine.textContent = "standby";
  if (typeof renderState === "function") {
    renderState();
  } else if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }
  if (typeof closeActivityEventSource === "function") {
    closeActivityEventSource();
  }
  if (typeof bootstrap === "function") {
    await bootstrap();
  }
  updateInputLock();
}

function showConnectionRecoveryFailure(message) {
  if (typeof showConnectionOverlayFailure === "function") {
    showConnectionOverlayFailure(message);
  }
}

async function runConnectionRecovery({
  overlayMode,
  timeoutMs,
  minHoldMs = 0,
  onRecovered,
}) {
  if (reconnectInProgress && connectionRecoveryPromise) {
    return connectionRecoveryPromise;
  }

  const baselineBootId =
    rebootBaselineBootId || readStoredBootId() || null;
  if (
    (overlayMode === "rebooting" || overlayMode === "restarting") &&
    baselineBootId
  ) {
    rebootBaselineBootId = baselineBootId;
  }

  connectionRecoveryStartedAt = Date.now();
  enterConnectionRecoveryState();

  if (typeof showConnectionOverlay === "function") {
    showConnectionOverlay(overlayMode);
  }

  if (typeof closeActivityEventSource === "function") {
    closeActivityEventSource();
  }

  connectionRecoveryPromise = (async () => {
    const recovered = await waitForNano({
      timeoutMs,
      intervalMs: CONNECTION_RECOVERY_POLL_MS,
    });

    if (!recovered) {
      reconnectInProgress = false;
      connectionRecoveryStartedAt = 0;
      showConnectionRecoveryFailure("Could not reconnect. Check the Pi and refresh.");
      return false;
    }

    if (
      (overlayMode === "rebooting" || overlayMode === "restarting") &&
      rebootBaselineBootId &&
      typeof pollStatusUntilBootIdChanges === "function"
    ) {
      const snapshot = await pollStatusUntilBootIdChanges(rebootBaselineBootId, {
        timeoutMs,
        intervalMs: CONNECTION_RECOVERY_POLL_MS,
      });
      if (!snapshot) {
        reconnectInProgress = false;
        connectionRecoveryStartedAt = 0;
        showConnectionRecoveryFailure("Could not reconnect. Check the Pi and refresh.");
        return false;
      }
    }

    if (overlayMode === "rebooting") {
      await animateRebootHold();
    } else if (minHoldMs > 0) {
      await delayUntilMinElapsed(minHoldMs, connectionRecoveryStartedAt);
    }

    if (typeof onRecovered === "function") {
      await onRecovered();
    }

    await recoverAfterReconnect();
    return true;
  })();

  try {
    return await connectionRecoveryPromise;
  } finally {
    connectionRecoveryPromise = null;
  }
}

async function beginNanoReconnect(kind) {
  if (!isSystemCommandId(kind) || reconnectInProgress) {
    return;
  }

  const overlayMode = kind === "reboot_pi" ? "rebooting" : "restarting";
  await runConnectionRecovery({
    overlayMode,
    timeoutMs: RECONNECT_TIMEOUT_MS[kind] || CONNECTION_RECOVERY_TIMEOUT_MS,
  });
}

async function beginConnectionRecovery() {
  if (reconnectInProgress) {
    return;
  }

  await runConnectionRecovery({
    overlayMode: "connecting",
    timeoutMs: CONNECTION_RECOVERY_TIMEOUT_MS,
  });
}

window.beginConnectionRecovery = beginConnectionRecovery;

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
