const DEBUG_EMPTY = "—";
const LEGACY_VOICE_DEBUG_STORAGE_KEY = "nano.voiceDebug";

let debugVoiceLastFinal = "";

function isDebugModeEnabled() {
  return debugModeEnabled;
}

function loadDebugModeEnabled() {
  try {
    if (window.localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === "true") {
      return true;
    }
    if (window.localStorage.getItem(LEGACY_VOICE_DEBUG_STORAGE_KEY) === "true") {
      saveDebugModeEnabled(true);
      window.localStorage.removeItem(LEGACY_VOICE_DEBUG_STORAGE_KEY);
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function saveDebugModeEnabled(enabled) {
  try {
    window.localStorage.setItem(DEBUG_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch (_error) {
    return;
  }
}

function syncDebugToggleUi() {
  if (debugModeOnBtn) {
    debugModeOnBtn.classList.toggle("active", debugModeEnabled);
    debugModeOnBtn.setAttribute("aria-pressed", debugModeEnabled ? "true" : "false");
  }
  if (debugModeOffBtn) {
    debugModeOffBtn.classList.toggle("active", !debugModeEnabled);
    debugModeOffBtn.setAttribute("aria-pressed", !debugModeEnabled ? "true" : "false");
  }
}

function setDebugField(fieldName, value) {
  if (!debugModeEnabled || !nanoDebugPanel) {
    return;
  }
  const field = nanoDebugPanel.querySelector(`[data-debug-field="${fieldName}"]`);
  if (!field) {
    return;
  }
  const text = value == null || value === "" ? DEBUG_EMPTY : String(value);
  field.textContent = text;
}

function applyDebugPanelVisibility() {
  if (!nanoDebugPanel) {
    return;
  }
  nanoDebugPanel.hidden = !debugModeEnabled;
}

function clearDebugVoiceCapture() {
  debugVoiceLastFinal = "";
  setDebugField("voice-live", DEBUG_EMPTY);
  setDebugField("voice-final", DEBUG_EMPTY);
  setDebugField("voice-buffer", DEBUG_EMPTY);
}

function clearDebugVoiceFields() {
  clearDebugVoiceCapture();
  setDebugField("voice-submitted", DEBUG_EMPTY);
}

function clearDebugPanel() {
  clearDebugVoiceFields();
  if (!nanoDebugPanel) {
    return;
  }
  for (const field of nanoDebugPanel.querySelectorAll("[data-debug-field]")) {
    field.textContent = DEBUG_EMPTY;
  }
}

function syncDebugVoiceBuffer(buffer) {
  if (!debugModeEnabled) {
    return;
  }
  const trimmed = String(buffer || "").trim();
  setDebugField("voice-buffer", trimmed || DEBUG_EMPTY);
}

function updateDebugVoiceRecognition({ interim = "", finalChunk = "" } = {}) {
  if (!debugModeEnabled) {
    return;
  }
  if (finalChunk) {
    debugVoiceLastFinal = debugVoiceLastFinal
      ? `${debugVoiceLastFinal} ${finalChunk}`.trim()
      : finalChunk;
    setDebugField("voice-live", DEBUG_EMPTY);
    setDebugField("voice-final", debugVoiceLastFinal);
  }
  if (interim) {
    setDebugField("voice-live", interim);
  }
}

function updateDebugVoiceSubmitted(message) {
  if (!debugModeEnabled) {
    return;
  }
  setDebugField("voice-submitted", message || DEBUG_EMPTY);
  debugVoiceLastFinal = "";
  setDebugField("voice-live", DEBUG_EMPTY);
  setDebugField("voice-final", DEBUG_EMPTY);
}

function formatDebugBool(value) {
  return value ? "yes" : "no";
}

function syncDebugNanoState() {
  if (!debugModeEnabled) {
    return;
  }

  const displayState = typeof getDisplayState === "function" ? getDisplayState() : DEBUG_EMPTY;
  setDebugField("state-display", displayState);
  setDebugField("activity-state", currentActivitySnapshot?.state || DEBUG_EMPTY);
  setDebugField("activity-headline", currentActivitySnapshot?.headline || DEBUG_EMPTY);

  const viewActive =
    typeof isViewSessionActive === "function" ? isViewSessionActive() : false;
  const activeView =
    viewActive && typeof getActiveViewSession === "function"
      ? getActiveViewSession() || DEBUG_EMPTY
      : DEBUG_EMPTY;
  setDebugField("view-session", viewActive ? activeView : "none");

  setDebugField("request-in-flight", formatDebugBool(requestInFlight));
  setDebugField("voice-mode", formatDebugBool(voiceModeEnabled));
  setDebugField("microphone", formatDebugBool(microphoneReady));
  setDebugField("speaking", formatDebugBool(speakingActive));
  setDebugField("wake-armed", formatDebugBool(waitingForWakeCommand));
  setDebugField("follow-up", formatDebugBool(waitingForFollowUp || waitingForVoiceAnswer));
  setDebugField("presence", formatDebugBool(waitingForPresence));
}

function setDebugModeEnabled(enabled, { persist = true } = {}) {
  debugModeEnabled = Boolean(enabled);
  if (persist) {
    saveDebugModeEnabled(debugModeEnabled);
  }
  syncDebugToggleUi();
  applyDebugPanelVisibility();
  if (debugModeEnabled) {
    syncDebugNanoState();
    return;
  }
  clearDebugPanel();
}

function initDebugControl() {
  debugModeEnabled = loadDebugModeEnabled();
  syncDebugToggleUi();
  applyDebugPanelVisibility();
  if (debugModeEnabled) {
    syncDebugNanoState();
  }
  if (debugModeOnBtn && debugModeOnBtn.dataset.bound !== "true") {
    debugModeOnBtn.dataset.bound = "true";
    debugModeOnBtn.addEventListener("click", () => {
      setDebugModeEnabled(true);
    });
  }
  if (debugModeOffBtn && debugModeOffBtn.dataset.bound !== "true") {
    debugModeOffBtn.dataset.bound = "true";
    debugModeOffBtn.addEventListener("click", () => {
      setDebugModeEnabled(false);
    });
  }
}
