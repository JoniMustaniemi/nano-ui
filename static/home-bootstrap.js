sendButton.addEventListener("click", sendMessage);
if (confirmationYesButton) {
  confirmationYesButton.addEventListener("click", () => {
    void submitConfirmationAnswer("yes");
  });
}
if (confirmationNoButton) {
  confirmationNoButton.addEventListener("click", () => {
    void submitConfirmationAnswer("no");
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
if (commandsToggleReveal) {
  commandsToggleReveal.addEventListener("click", () => {
    if (getDisplayState() === "working") {
      return;
    }
    if (isViewSessionActive() && activeView === "commands") {
      closeViewSession({ reason: "ui" });
      return;
    }
    void openViewSession("commands", { source: "ui" });
  });
}
keyboardToggle.addEventListener("click", () => {
  if (isBusy()) {
    return;
  }
  toggleKeyboardPanel();
});
nanoControlsToggle.addEventListener("click", () => {
  if (getDisplayState() === "working") {
    return;
  }
  if (isViewSessionActive() && activeView === "brains") {
    closeViewSession({ reason: "ui" });
    return;
  }
  void openViewSession("brains", { source: "ui" });
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
if (controlsRevealButton) {
  controlsRevealButton.addEventListener("click", () => {
    if (getDisplayState() === "working") {
      return;
    }
    setControlsHidden(false);
  });
}
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
  if (microphoneStream) {
    for (const track of microphoneStream.getTracks()) {
      track.stop();
    }
  }
  if (mainEssence) {
    mainEssence.destroy();
  }
});

const nanoVersion = document.getElementById("nano-version");

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

window.addEventListener("load", () => {
  requestAnimationFrame(async () => {
    initEssence();
    applyControlsVisibility();
    const connected = await ensureApiConnection();
    if (!connected) {
      return;
    }
    await loadNanoVersionFromBackend();
    void initVoiceVolumeControl();
    restoreBaseAnswer();
    setVoiceStatus("Voice on standby.");
    syncVoiceListeningState();
    bootstrap();
  });
});
