const VIEW_TITLES = {
  brains: "Brains",
  storage: "Stored data",
  commands: "Commands",
  calendar: "Calendar",
};

const VIEW_OPEN_ACK = {
  brains: "Opening Brains.",
  storage: "Opening stored data.",
  commands: "Opening commands.",
  calendar: "Opening Calendar.",
};

const VIEW_PANELS = {
  brains: () => viewPanelBrains,
  storage: () => viewPanelStorage,
  commands: () => viewPanelCommands,
  calendar: () => viewPanelCalendar,
};

function isViewSessionActive() {
  return viewSessionActive;
}

function getActiveViewSession() {
  return viewSessionActive ? activeView : null;
}

function isViewSessionVoiceGated() {
  return viewSessionActive;
}

function showViewPanel(view) {
  for (const [name, getPanel] of Object.entries(VIEW_PANELS)) {
    const panel = getPanel();
    if (!panel) {
      continue;
    }
    const isActive = name === view;
    if (isActive) {
      panel.removeAttribute("hidden");
      panel.classList.add("active");
      continue;
    }
    panel.setAttribute("hidden", "");
    panel.classList.remove("active");
  }
}

async function loadViewData(view) {
  if (view === "storage") {
    await refreshStorage();
    return;
  }
  if (view === "commands") {
    if (typeof initConnectionSettings === "function") {
      initConnectionSettings();
    }
    if (commandsList && !commandsList.querySelector(".command-button")) {
      await loadAndRenderToolCommands();
    }
    expandCommandDropdowns();
    applyVoiceVolume();
    return;
  }
  if (view === "calendar") {
    if (typeof loadCalendarView !== "function") {
      throw new Error("Calendar UI failed to load. Hard-refresh the page.");
    }
    await loadCalendarView();
  }
}

function applyViewSessionChrome(view) {
  if (view === "calendar") {
    controlsHidden = true;
  } else {
    revealControlsForUiCommand();
  }
  applyControlsVisibility();
}

function setViewModalExpanded(expanded) {
  if (commandsToggle) {
    commandsToggle.setAttribute(
      "aria-expanded",
      expanded && activeView === "commands" ? "true" : "false"
    );
  }
  if (nanoControlsToggle) {
    nanoControlsToggle.setAttribute(
      "aria-expanded",
      expanded && activeView === "brains" ? "true" : "false"
    );
  }
}

function prepareViewSwitch(fromView) {
  if (fromView === "commands") {
    closeCommandDropdowns();
  }
  if (fromView === "calendar") {
    if (typeof closeCalendarDayPanel === "function") {
      closeCalendarDayPanel();
    }
    if (typeof closeCalendarPickerMenu === "function") {
      closeCalendarPickerMenu();
    }
  }
}

function ensureViewSessionListening() {
  viewSessionListening = true;
  waitingForVoiceAnswer = false;
  waitingForFollowUp = false;
  setVoiceStatus("Tap close to dismiss.");
  renderState();
}

function resetViewSessionListening() {
  viewSessionListening = false;
}

function openViewModalShell(view) {
  if (!viewModal || !viewModalTitle) {
    return false;
  }
  viewModalTitle.textContent = VIEW_TITLES[view] || "View";
  showViewPanel(view);
  viewModal.classList.add("open");
  viewModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("view-modal-open");
  document.body.classList.toggle("view-calendar-active", view === "calendar");
  setViewModalExpanded(true);
  if (viewModalClose) {
    viewModalClose.focus();
  }
  return true;
}

function closeViewModalShell() {
  if (!viewModal) {
    return;
  }
  viewModal.classList.remove("open");
  viewModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("view-modal-open");
  document.body.classList.remove("view-calendar-active");
  setViewModalExpanded(false);
}

async function openViewSession(view, { source = "ui" } = {}) {
  if (getDisplayState() === "working") {
    return false;
  }
  if (!VIEW_TITLES[view]) {
    return false;
  }

  const previousView = viewSessionActive ? activeView : null;
  const previousSessionActive = viewSessionActive;
  const previousSessionSource = viewSessionSource;
  const previousControlsHidden = controlsHidden;
  if (viewSessionActive && previousView !== view) {
    prepareViewSwitch(previousView);
  }

  activeView = view;
  viewSessionActive = true;
  viewSessionSource = source;

  applyViewSessionChrome(view);
  if (!openViewModalShell(view)) {
    activeView = previousView;
    viewSessionActive = previousSessionActive;
    viewSessionSource = previousSessionSource;
    controlsHidden = previousControlsHidden;
    applyControlsVisibility();
    document.body.classList.remove("view-calendar-active");
    return false;
  }

  try {
    await loadViewData(view);
  } catch (error) {
    console.error(`Failed to load ${view} view`, error);
    if (view === "calendar" && calendarError) {
      calendarError.hidden = false;
      calendarError.textContent =
        error.message || "Could not open the calendar view.";
    }
  }

  if (source === "voice" || microphoneReady) {
    ensureViewSessionListening();
  }
  renderState();
  return true;
}

function closeViewSession({ reason = "ui", restoreWake = true } = {}) {
  if (!viewSessionActive) {
    closeViewModalShell();
    resetViewSessionListening();
    return;
  }
  viewSessionActive = false;
  activeView = null;
  viewSessionSource = null;
  resetViewSessionListening();
  closeViewModalShell();
  controlsHidden = true;
  closeKeyboardPanel();
  applyControlsVisibility();
  if (restoreWake) {
    returnToWakeDetection();
  }
  renderState();
}

function getViewOpenAck(view) {
  return VIEW_OPEN_ACK[view] || "Opening.";
}
