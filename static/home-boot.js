function readStoredBootId() {
  try {
    let current = window.sessionStorage.getItem(LAST_BOOT_ID_KEY) || "";
    if (!current) {
      const legacy = window.sessionStorage.getItem(LEGACY_BOOT_ID_KEY) || "";
      if (legacy) {
        window.sessionStorage.setItem(LAST_BOOT_ID_KEY, legacy);
        window.sessionStorage.removeItem(LEGACY_BOOT_ID_KEY);
        current = legacy;
      }
    }
    return current;
  } catch (_error) {
    return "";
  }
}

function writeStoredBootId(bootId) {
  try {
    window.sessionStorage.setItem(LAST_BOOT_ID_KEY, bootId);
    window.sessionStorage.removeItem(LEGACY_BOOT_ID_KEY);
  } catch (_error) {
    // Ignore storage write failures.
  }
}

function clearTransientUIState() {
  if (typeof clearPendingState === "function") {
    clearPendingState();
  }
  if (typeof clearPendingSystemCommand === "function") {
    clearPendingSystemCommand();
  }
  if (typeof clearAnswerClearTimer === "function") {
    clearAnswerClearTimer();
  }
  if (typeof cancelAnswerReveal === "function") {
    cancelAnswerReveal();
  }
  waitingForFollowUp = false;
  waitingForVoiceAnswer = false;
  suppressPendingRearm = false;
  if (typeof setYesNoConfirmationActive === "function") {
    setYesNoConfirmationActive(false);
  }
}

function applyBootCompleteUI({ title, detail }) {
  const headline = String(title || "Booting complete.").trim();
  const detailText = String(detail || "I'm ready and awake.").trim();
  if (
    currentActivitySnapshot.state === "standby" &&
    !resolveListeningIntent() &&
    !hasCustomStandbyActivityCopy()
  ) {
    currentActivitySnapshot = {
      ...currentActivitySnapshot,
      headline,
      detail: detailText,
    };
  }
  renderState();
}

async function pollStatusUntilBootIdChanges(
  previousBootId,
  { timeoutMs = 180_000, intervalMs = 2_000 } = {},
) {
  const baseline = String(previousBootId || "").trim();
  if (!baseline || typeof loadSnapshot !== "function") {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const snapshot = await loadSnapshot();
      const boot = snapshot?.boot;
      const nextBootId = String(boot?.id || "").trim();
      if (nextBootId && nextBootId !== baseline && boot?.reboot_pending === false) {
        return snapshot;
      }
    } catch (_error) {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, intervalMs);
    });
  }
  return null;
}

async function captureRestartBaseline() {
  const fallbackBootId = readStoredBootId() || null;
  if (typeof loadSnapshot !== "function") {
    return { bootId: fallbackBootId, bootedAt: null };
  }

  try {
    const snapshot = await loadSnapshot();
    const boot = snapshot?.boot || {};
    return {
      bootId: String(boot.id || fallbackBootId || "").trim() || null,
      bootedAt: String(boot.booted_at || "").trim() || null,
    };
  } catch (_error) {
    return { bootId: fallbackBootId, bootedAt: null };
  }
}

async function pollStatusUntilServiceRestart(
  { previousBootId, previousBootedAt, timeoutMs = 120_000, intervalMs = 2_000 } = {},
) {
  const baselineId = String(previousBootId || "").trim();
  const baselineBootedAt = String(previousBootedAt || "").trim();
  if (!baselineId || typeof loadSnapshot !== "function") {
    return null;
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const health = await nanoFetch("/api/health");
      if (!health.ok) {
        throw new Error("health unavailable");
      }

      const snapshot = await loadSnapshot();
      const boot = snapshot?.boot || {};
      const nextBootId = String(boot.id || "").trim();
      const nextBootedAt = String(boot.booted_at || "").trim();
      const bootIdChanged = Boolean(nextBootId && nextBootId !== baselineId);
      const bootedAtAdvanced = Boolean(
        !baselineBootedAt || (nextBootedAt && nextBootedAt > baselineBootedAt),
      );

      if (
        boot.restart_pending === false &&
        bootIdChanged &&
        bootedAtAdvanced
      ) {
        return snapshot;
      }
    } catch (_error) {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, intervalMs);
    });
  }
  return null;
}

async function syncBootState(snapshot) {
  const boot = snapshot?.boot;
  if (!boot || typeof boot !== "object") {
    rebootPendingFromStatus = false;
    restartPendingFromStatus = false;
    return { freshBoot: false };
  }

  rebootPendingFromStatus = boot.reboot_pending === true;
  restartPendingFromStatus = boot.restart_pending === true;
  const bootId = String(boot.id || "").trim();

  if (rebootPendingFromStatus) {
    if (bootId && !rebootBaselineBootId) {
      rebootBaselineBootId = bootId;
    }
    if (!reconnectInProgress && typeof beginNanoReconnect === "function") {
      void beginNanoReconnect("reboot_pi");
    }
    return { freshBoot: false, rebootPending: true };
  }

  if (restartPendingFromStatus) {
    if (bootId && !restartBaselineBootId) {
      restartBaselineBootId = bootId;
    }
    if (!reconnectInProgress && typeof beginNanoReconnect === "function") {
      void beginNanoReconnect("restart_nano");
    }
    return { freshBoot: false, restartPending: true };
  }

  if (!bootId) {
    return { freshBoot: false };
  }

  const previous = readStoredBootId();
  const realReboot = Boolean(previous) && previous !== bootId;

  if (realReboot) {
    clearTransientUIState();
    const bootEvent = findLatestBootEvent(snapshot);
    applyBootCompleteUI({
      title: bootEvent?.title || "Booting complete.",
      detail: bootEvent?.detail || "I'm ready and awake.",
    });
    await refreshStandbyGreeting({ speakOnce: true, bootKey: bootId });
  }

  writeStoredBootId(bootId);
  rebootBaselineBootId = null;
  restartBaselineBootId = null;

  return { freshBoot: realReboot, rebootPending: false, restartPending: false };
}
