sendButton.addEventListener("click", sendMessage);
if (inputActions) {
  inputActions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-input-action]");
    if (!button || button.disabled) {
      return;
    }
    const action = button.dataset.inputAction;
    if (action === "open_keyboard") {
      openKeyboardPanel();
      messageBox.focus();
      return;
    }
    const value = button.dataset.inputValue;
    if (value) {
      void submitInputAnswer(value);
    }
  });
}
commandsToggle.addEventListener("click", () => {
  if (getDisplayState() === "working") {
    return;
  }
  if (isViewSessionActive() && activeView === "commands") {
    closeViewSession({ reason: "ui" });
    return;
  }
  void openViewSession("commands", { source: "ui" });
});
if (viewModalClose) {
  viewModalClose.addEventListener("click", () => closeViewSession({ reason: "ui" }));
}
if (viewModalPanel) {
  viewModalPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeViewSession({ reason: "ui" });
    }
  });
}
messageBox.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (isBusy()) {
      return;
    }
    sendMessage();
  }
  if (event.key === "Escape") {
    closeKeyboardPanel();
  }
});
brainsClearButton.addEventListener("click", clearActivityLog);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && controlsHidden && getDisplayState() !== "working") {
    setControlsHidden(false);
  }
});
async function handleStartupGesture() {
  await retryPendingBootGreetingSpeech();
  maybeStartListeningAfterGesture();
}

window.addEventListener("pointerdown", handleStartupGesture, { passive: true });
window.addEventListener("keydown", handleStartupGesture);
window.addEventListener("beforeunload", () => {
  releaseMicrophone();
  if (mainEssence) {
    mainEssence.destroy();
  }
});

const nanoVersion = document.getElementById("nano-version");

function formatClockTime(date = new Date()) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateClockChip() {
  if (!clockChip) {
    return;
  }
  clockChip.textContent = formatClockTime();
}

function startClockChip() {
  updateClockChip();
  window.setInterval(updateClockChip, 1000);
}

async function loadNanoVersionFromBackend() {
  if (!nanoVersion) {
    return;
  }
  try {
    const response = await nanoFetch("/api/health");
    if (!response.ok) {
      nanoVersion.textContent = "";
      return;
    }
    const data = await response.json();
    const version = String(data?.version || "").trim();
    nanoVersion.textContent = version ? `v${version}` : "";
  } catch {
    nanoVersion.textContent = "";
  }
}

window.loadNanoVersionFromBackend = loadNanoVersionFromBackend;

async function initApp() {
  await loadNanoVersionFromBackend();
  void initVoiceVolumeControl();
  initVoiceModeControl();
  restoreBaseAnswer();
  setVoiceStatus("Voice on standby.");
  syncVoiceListeningState();
  await bootstrap();
}

async function completeStartupAfterConnection() {
  await initApp();
}

window.completeStartupAfterConnection = completeStartupAfterConnection;

window.addEventListener("load", () => {
  startClockChip();
  requestAnimationFrame(async () => {
    initEssence();
    applyControlsVisibility();
    const connected = await ensureApiConnection();
    if (!connected) {
      return;
    }
    await initApp();
  });
});
