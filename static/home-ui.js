function initEssence() {
  if (typeof window.initEssenceOrbs === "function") {
    window.initEssenceOrbs();
    mainEssence = window.mainEssence || null;
  }
}

function updateEssenceState() {
  let state = getDisplayState();
  if (speakingActive) {
    state = "speaking";
  }
  if (stateLine.textContent === "reconnecting") {
    state = "reconnecting";
  }
  if (mainEssence) {
    mainEssence.setState(state);
  }
}

function isWorkingOnTask() {
  return requestInFlight || currentActivitySnapshot.state === "working";
}

const LAST_COMMAND_CATEGORIES = ["System"];
const EXCLUDED_COMMAND_CATEGORIES = new Set(["git", "github"]);
const GIT_PR_COMMAND_PATTERN =
  /\b(commit|pull request|pull_request|create pr|gh pr|git push|git commit)\b/i;
const YES_NO_PENDING_KINDS = new Set(["wipe_confirmation", "presence_check"]);

const VIEW_CLIENT_ACTIONS = {
  open_brains: "brains",
  open_storage: "storage",
  open_commands: "commands",
  open_calendar: "calendar",
};

function resolveViewClientAction(command) {
  const action = String(command?.client_action || "").trim();
  if (action && Object.hasOwn(VIEW_CLIENT_ACTIONS, action)) {
    return VIEW_CLIENT_ACTIONS[action];
  }
  const commandId = String(command?.id || "").trim();
  if (commandId && Object.hasOwn(VIEW_CLIENT_ACTIONS, commandId)) {
    return VIEW_CLIENT_ACTIONS[commandId];
  }
  return null;
}

function commandCategorySortKey(category) {
  const normalized = category.toLowerCase();
  const lastIndex = LAST_COMMAND_CATEGORIES.findIndex(
    (name) => name.toLowerCase() === normalized
  );
  if (lastIndex >= 0) {
    return [1, lastIndex, normalized];
  }
  return [0, normalized];
}

function groupCommands(commands) {
  const groups = new Map();
  for (const command of commands) {
    const category = command.category || "Other";
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(command);
  }
  return Array.from(groups.entries()).sort(([left], [right]) => {
    const leftKey = commandCategorySortKey(left);
    const rightKey = commandCategorySortKey(right);
    for (let index = 0; index < leftKey.length; index += 1) {
      if (leftKey[index] < rightKey[index]) {
        return -1;
      }
      if (leftKey[index] > rightKey[index]) {
        return 1;
      }
    }
    return 0;
  });
}

function renderToolCommands(commands) {
  if (!commandsList) {
    return;
  }
  if (!Array.isArray(commands) || commands.length === 0) {
    showCommandsEmptyState("No quick actions are available.");
    return;
  }
  toolCommands = commands;
  commandsList.replaceChildren();
  for (const [category, items] of groupCommands(commands)) {
    const dropdown = document.createElement("details");
    dropdown.className = "commands-dropdown";

    const summary = document.createElement("summary");
    summary.className = "commands-dropdown-toggle";
    summary.textContent = category;

    const grid = document.createElement("div");
    grid.className = "commands-group-grid";

    for (const command of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-button";
      button.dataset.commandId = command.id || "";
      button.dataset.clientAction = command.client_action || "";
      button.dataset.commandMessage = command.message;

      const label = document.createElement("span");
      label.className = "command-button-label";
      label.textContent = command.label;

      button.append(label);
      if (command.description) {
        const description = document.createElement("span");
        description.className = "command-button-description";
        description.textContent = command.description;
        button.append(description);
      }

      button.addEventListener("click", () => {
        void runToolCommand(command);
      });
      grid.append(button);
    }

    dropdown.append(summary, grid);
    dropdown.open = true;
    commandsList.append(dropdown);
  }
}

function showCommandsEmptyState(message) {
  if (!commandsList) {
    return;
  }
  toolCommands = [];
  commandsList.replaceChildren();
  const note = document.createElement("p");
  note.className = "commands-empty";
  note.textContent = message || "Could not load quick actions.";
  commandsList.append(note);
}

async function loadAndRenderToolCommands() {
  try {
    const commands = await loadToolCommands();
    renderToolCommands(commands);
  } catch (error) {
    showCommandsEmptyState(error.message || "Could not load quick actions.");
  }
}

function setYesNoConfirmationActive(active) {
  waitingForYesNoConfirmation = active;
  syncConfirmationActions();
}

function syncConfirmationActions() {
  if (!confirmationActions) {
    return;
  }
  const show =
    waitingForYesNoConfirmation ||
    waitingForPresence ||
    (currentAnswerPendingKind && YES_NO_PENDING_KINDS.has(currentAnswerPendingKind));
  confirmationActions.hidden = !show;
  const disabled = requestInFlight || reconnectInProgress || getDisplayState() === "working";
  if (confirmationYesButton) {
    confirmationYesButton.disabled = disabled;
  }
  if (confirmationNoButton) {
    confirmationNoButton.disabled = disabled;
  }
}

function setCommandButtonsDisabled(disabled) {
  for (const button of commandsList.querySelectorAll(".command-button")) {
    button.disabled = disabled;
  }
}

function isBusy() {
  if (waitingForVoiceAnswer || waitingForPresence || waitingForFollowUp) {
    return false;
  }
  if (requestInFlight) {
    return true;
  }
  return currentActivitySnapshot.state === "working";
}

function getDisplayState() {
  if (requestInFlight) {
    return "working";
  }
  if (currentActivitySnapshot.state === "working") {
    return "working";
  }
  if (isListeningStateActive()) {
    return "listening";
  }
  return "standby";
}

function shouldSuppressControlsChrome() {
  return controlsHidden || getDisplayState() === "working";
}

function shouldShowControlsRevealZones() {
  return controlsHidden && getDisplayState() !== "working";
}

function updateInputLock() {
  const locked = getDisplayState() === "working" || reconnectInProgress;
  messageBox.disabled = locked;
  sendButton.disabled = locked;
  commandsToggle.disabled = locked;
  if (commandsToggleReveal) {
    commandsToggleReveal.disabled = locked;
  }
  nanoControlsToggle.disabled = locked;
  keyboardToggle.disabled = locked;
  setCommandButtonsDisabled(locked);
  syncConfirmationActions();
  document.body.classList.toggle("inputs-locked", locked);
}

function expandCommandDropdowns() {
  for (const dropdown of commandsList.querySelectorAll(".commands-dropdown")) {
    dropdown.open = true;
  }
}

function closeCommandDropdowns() {
  if (!commandsList) {
    return;
  }
  for (const dropdown of commandsList.querySelectorAll(".commands-dropdown")) {
    dropdown.removeAttribute("open");
  }
}

function isExcludedToolCommand(command) {
  const category = String(command?.category || "").trim().toLowerCase();
  if (EXCLUDED_COMMAND_CATEGORIES.has(category)) {
    return true;
  }
  const searchable = `${command?.id || ""} ${command?.message || ""} ${command?.label || ""}`;
  return GIT_PR_COMMAND_PATTERN.test(searchable);
}

function filterToolCommands(commands) {
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command) => !isExcludedToolCommand(command));
}

async function loadToolCommands() {
  const response = await nanoFetch("/api/tool-commands");
  if (!response.ok) {
    throw new Error("Could not load tool commands.");
  }
  const commands = await response.json();
  return filterToolCommands(commands);
}

async function runToolCommand(command) {
  if (isBusy()) {
    return;
  }
  const clientAction = String(command?.client_action || "").trim();
  if (clientAction === "toggle_controls") {
    toggleControlsHidden();
    if (isViewSessionActive()) {
      closeViewSession({ reason: "ui" });
    }
    return;
  }
  const view = resolveViewClientAction(command);
  if (view) {
    await openViewSession(view, { source: "ui" });
    return;
  }
  const message = command.message;
  messageBox.value = message;
  if (isViewSessionActive()) {
    closeViewSession({ reason: "ui" });
  }
  await submitMessage(message, "command", command);
  messageBox.value = "";
}

function normalizeUiCommandText(message) {
  return message
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+/g, " ")
    .replace(/[''´`]/g, "")
    .replace(/\b(hey|hi)\s+nano\b/g, " ")
    .replace(/\bnano\b/g, " ")
    .replace(/\bplease\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSectionPatterns(normalized, patterns) {
  return patterns.some((pattern) => pattern.test(normalized));
}

const BRAINS_SECTION_PATTERNS = [
  /^(open|show|go to)(\s+the)?\s+brains(\s+(tab|section|panel|view))?$/,
  /^(open|show)(\s+the)?\s+internal notes$/,
  /\bwhat\s+are\s+you\s+thinking\b/,
  /\bwhat\s+you\s+are\s+thinking\b/,
  /\bwhat\s+you\s+re\s+thinking\b/,
  /\bwhats\s+on\s+your\s+mind\b/,
  /\bwhat\s+is\s+on\s+your\s+mind\b/,
  /\b(show|see|view|open|look at|display|pull up|bring up)\b.*\b(your thoughts|your mind|internal notes|activity log|brains)\b/,
  /\b(can|could|may|would|let)\s+(i|me|we)\s+(see|view|look at|open|show|have)\b.*\b(your thoughts|your mind|internal notes|activity log|brains)\b/,
  /\bwhat\s+(is|are)\s+in\s+(your\s+)?(mind|brains|activity)\b/,
  /\bwhat\s+have\s+you\s+been\s+thinking\b/,
  /\blet\s+me\s+see\s+your\s+brains\b/,
];

const STORAGE_SECTION_PATTERNS = [
  /^(open|show|go to)(\s+the)?\s+(stored data|storage|data)(\s+(tab|section|panel|view))?$/,
  /\bwhat\s+(is|are)\s+in\s+(the\s+)?(storage|stored data|saved data)\b/,
  /\b(show|see|view|open|look at|display|pull up|bring up)\b.*\b(saved data|stored data|storage|saved stuff)\b/,
  /\b(can|could|may|would|let)\s+(i|me|we)\s+(see|view|look at|open|show|have)\b.*\b(saved data|stored data|storage|saved stuff)\b/,
  /\bcan\s+i\s+see\b.*\b(saved|stored)\s+data\b/,
  /\bwhat\s+data\s+(do\s+you\s+have|is\s+saved|have\s+you\s+saved)\b/,
  /\bwhat\s+did\s+you\s+save\b/,
  /\bshow\s+me\s+what\s+you\s+saved\b/,
];

const COMMANDS_SECTION_PATTERNS = [
  /^(open|show)(\s+the)?\s+(commands|quick actions)(\s+(drawer|panel|view|list|menu))?$/,
  /\b(show|see|view|open|list)\b.*\b(commands|quick actions|command list)\b/,
  /\b(can|could|may|would|let)\s+(i|me|we)\s+(see|view|look at|open|show|have|list)\b.*\b(commands|quick actions|command list)\b/,
  /\bwhat\s+commands\b/,
  /\bwhat\s+commands\s+are\s+available\b/,
  /\blist\s+commands\b/,
  /\bopen\s+(the\s+)?command\s+list\b/,
];

const CALENDAR_SECTION_PATTERNS = [
  /\b(show|open|view|display|pull up|bring up)\b.*\bcalendar\s+view\b/,
  /\b(show|open|view|display)\b.*\b(full[- ]screen\s+)?calendar\b/,
];

const CONTROLS_HIDE_PATTERNS = [
  /^hide(\s+the)?\s+controls?(\s+(panel|menu|bar))?$/,
  /^hide(\s+the)?\s+ui\s+controls?$/,
  /\bhide\b.*\bcontrols\b/,
  /\b(can|could|may|would|let)\s+(i|me|we|you)\s+hide\b.*\bcontrols\b/,
];

const CONTROLS_SHOW_PATTERNS = [
  /^show(\s+the)?\s+controls?(\s+(panel|menu|bar))?$/,
  /^show(\s+the)?\s+ui\s+controls?$/,
  /\b(show|see|view|open|look at|display|pull up|bring up)\b.*\bcontrols\b/,
  /\b(can|could|may|would|let)\s+(i|me|we)\s+(see|view|look at|open|show|have)\b.*\bcontrols\b/,
  /\bopen(\s+the)?\s+controls(\s+(panel|menu|bar))?\b/,
];

const CONTROLS_TOGGLE_PATTERNS = [
  /^(hide\s*\/\s*show|toggle)(\s+the)?\s+controls?$/,
];

const CLOSE_PATTERNS = [
  /^close$/,
  /^hide$/,
  /^go back$/,
  /^dismiss$/,
  /^exit$/,
  /^close panel$/,
  /^close this$/,
  /^close it$/,
  /^exit panel$/,
  /^close(\s+the)?\s+(panel|sheet|drawer|view|modal)$/,
  /^close(\s+the)?\s+(brains|storage|commands|calendar)(\s+(tab|panel|drawer|section))?$/,
  /^dismiss(\s+the)?\s+(panel|sheet|drawer|view|modal)$/,
  /^hide(\s+the)?\s+(panel|view|this|modal)$/,
  /\b(you can|can you|could you|please)\s+close\b/,
  /\b(okay|ok)\b.*\bclose\b/,
  /\b(thanks|thank you)\b.*\b(close|dismiss)\b/,
  /\b(close|dismiss|hide)\b.*\b(menu|panel|view|modal|this|it|screen|window)\b/,
  /\b(menu|panel|view|modal|this|it|screen)\b.*\b(close|dismiss|hide)\b/,
  /\b(close|dismiss|hide)\b.*\b(brains|storage|commands|calendar)\b/,
];

function isCloseCommandNegated(normalized) {
  return /\b(?:don t|do not|dont|never)\s+close\b/.test(normalized);
}

function matchesCloseCommand(message) {
  const normalized = normalizeUiCommandText(message);
  if (!normalized || isCloseCommandNegated(normalized)) {
    return false;
  }
  return matchesSectionPatterns(normalized, CLOSE_PATTERNS);
}

let lastUiCommandResult = null;

function matchUiCommand(message) {
  const normalized = normalizeUiCommandText(message);
  if (!normalized) {
    return null;
  }
  if (
    normalized === "hide show controls" ||
    matchesSectionPatterns(normalized, CONTROLS_TOGGLE_PATTERNS)
  ) {
    return { type: "controls", action: "toggle" };
  }
  if (matchesSectionPatterns(normalized, CONTROLS_HIDE_PATTERNS)) {
    return { type: "controls", action: "hide" };
  }
  if (matchesSectionPatterns(normalized, CONTROLS_SHOW_PATTERNS)) {
    return { type: "controls", action: "show" };
  }
  if (matchesCloseCommand(message)) {
    return { type: "close" };
  }
  if (matchesSectionPatterns(normalized, BRAINS_SECTION_PATTERNS)) {
    return { type: "section", target: "brains" };
  }
  if (matchesSectionPatterns(normalized, STORAGE_SECTION_PATTERNS)) {
    return { type: "section", target: "storage" };
  }
  if (matchesSectionPatterns(normalized, COMMANDS_SECTION_PATTERNS)) {
    return { type: "section", target: "commands" };
  }
  if (matchesSectionPatterns(normalized, CALENDAR_SECTION_PATTERNS)) {
    return { type: "section", target: "calendar" };
  }
  return null;
}

function revealControlsForUiCommand() {
  if (controlsHidden && getDisplayState() !== "working") {
    setControlsHidden(false);
  }
}

function closeOpenUiPanels() {
  let closed = false;
  if (keyboardOpen) {
    closeKeyboardPanel();
    closed = true;
  }
  if (isViewSessionActive()) {
    closeViewSession({ reason: "ui", restoreWake: false });
    closed = true;
  }
  return closed;
}

function tryHandleUiCommand(message, source = "ui") {
  const command = matchUiCommand(message);
  if (!command) {
    return false;
  }
  lastUiCommandResult = command;

  if (command.type === "controls") {
    if (command.action === "hide") {
      setControlsHidden(true);
      return true;
    }
    if (command.action === "show") {
      if (getDisplayState() === "working") {
        lastUiCommandResult = null;
        return false;
      }
      setControlsHidden(false);
      return true;
    }
    if (command.action === "toggle") {
      toggleControlsHidden();
      return true;
    }
  }

  if (command.type === "close") {
    if (isViewSessionActive()) {
      closeViewSession({ reason: source === "voice" ? "voice" : "ui" });
    } else {
      closeOpenUiPanels();
    }
    return true;
  }

  if (command.type === "section") {
    if (getDisplayState() === "working") {
      lastUiCommandResult = null;
      return false;
    }
    void openViewSession(command.target, { source });
    return true;
  }

  lastUiCommandResult = null;
  return false;
}

function uiCommandStatusMessage(command) {
  if (!command) {
    return controlsHidden ? "Controls hidden." : "Controls shown.";
  }
  if (command.type === "controls") {
    return controlsHidden ? "Controls hidden." : "Controls shown.";
  }
  if (command.type === "close") {
    return "Closed.";
  }
  if (command.type === "section") {
    const labels = {
      brains: "Opening Brains.",
      storage: "Opening stored data.",
      commands: "Opening commands.",
      calendar: "Opening Calendar.",
    };
    return labels[command.target] || "Opening.";
  }
  return "";
}

async function completeUiCommand(source) {
  const status = uiCommandStatusMessage(lastUiCommandResult);
  lastUiCommandResult = null;
  replyStatus.textContent = status;
  setVoiceStatus(status);
  if (source === "voice") {
    await playVoice(status);
    if (isViewSessionActive()) {
      ensureViewSessionListening();
      return;
    }
    returnToWakeDetection();
  }
}

function applyControlsVisibility() {
  document.body.classList.toggle("controls-hidden", shouldSuppressControlsChrome());
  if (controlsRevealZone) {
    controlsRevealZone.hidden = !shouldShowControlsRevealZones();
  }
  if (commandsRevealZone) {
    commandsRevealZone.hidden = !shouldShowControlsRevealZones();
  }
  if (getDisplayState() === "working") {
    closeKeyboardPanel();
    closeViewSession({ reason: "working", restoreWake: false });
  }
}

function setControlsHidden(hidden) {
  if (!hidden && getDisplayState() === "working") {
    return;
  }
  controlsHidden = hidden;
  if (controlsHidden) {
    closeKeyboardPanel();
    closeViewSession({ reason: "controls", restoreWake: false });
  }
  applyControlsVisibility();
}

function toggleControlsHidden() {
  setControlsHidden(!controlsHidden);
}

function clearUserSpeechTimers() {
  if (userSpeechFadeTimer !== null) {
    window.clearTimeout(userSpeechFadeTimer);
    userSpeechFadeTimer = null;
  }
  if (userSpeechHideTimer !== null) {
    window.clearTimeout(userSpeechHideTimer);
    userSpeechHideTimer = null;
  }
}

function hideUserSpeechImmediate() {
  clearUserSpeechTimers();
  if (!userSpeech) {
    return;
  }
  userSpeech.classList.remove("visible", "fade-out");
  userSpeech.hidden = true;
  if (userSpeechText) {
    userSpeechText.textContent = "";
  }
}

function scheduleUserSpeechFadeOut() {
  clearUserSpeechTimers();
  userSpeechFadeTimer = window.setTimeout(() => {
    userSpeechFadeTimer = null;
    if (!userSpeech) {
      return;
    }
    userSpeech.classList.remove("visible");
    userSpeech.classList.add("fade-out");
    userSpeechHideTimer = window.setTimeout(() => {
      userSpeechHideTimer = null;
      if (!userSpeech) {
        return;
      }
      userSpeech.classList.remove("fade-out");
      userSpeech.hidden = true;
      if (userSpeechText) {
        userSpeechText.textContent = "";
      }
    }, USER_SPEECH_FADE_MS);
  }, USER_SPEECH_DISPLAY_MS);
}

function showUserSpeech(text) {
  const content = (text || "").trim();
  if (!content || !userSpeech || !userSpeechText) {
    hideUserSpeechImmediate();
    return;
  }

  const wasVisible = userSpeech.classList.contains("visible") && !userSpeech.hidden;
  userSpeechText.textContent = content;
  userSpeech.hidden = false;
  userSpeech.classList.remove("fade-out");

  if (!wasVisible) {
    userSpeech.classList.remove("visible");
    requestAnimationFrame(() => {
      userSpeech.classList.add("visible");
    });
  }

  scheduleUserSpeechFadeOut();
}

function resolveListeningIntent() {
  if (isViewSessionActive()) {
    return "view_session";
  }
  if (waitingForPresence) {
    return "presence";
  }
  if (waitingForFollowUp || waitingForVoiceAnswer) {
    return "follow_up";
  }
  return null;
}

function isListeningStateActive() {
  const intent = resolveListeningIntent();
  return intent === "presence" || intent === "follow_up" || intent === "view_session";
}

function isWaitingForUserAnswer() {
  return waitingForPresence || waitingForFollowUp || isListeningStateActive();
}

function isWaitingForAnswerActivity() {
  return waitingForPresence || waitingForFollowUp;
}

function shouldDeferAnswerClear(options = {}) {
  return Boolean(options.deferClearUntilSpeech || speakingActive);
}

function resolveActivityHeadline() {
  const displayState = getDisplayState();
  const intent = resolveListeningIntent();
  let headline = (currentActivitySnapshot.headline || "").trim();
  let detail = (currentActivitySnapshot.detail || "").trim();

  if (displayState === "working") {
    if (!headline || headline === STANDBY_HEADLINE) {
      headline = detail || WORKING_DETAIL_DEFAULT;
    }
  } else if (intent === "presence") {
    headline = PRESENCE_LISTEN_HEADLINE;
    detail = PRESENCE_LISTEN_DETAIL;
  } else if (waitingForFollowUp || waitingForVoiceAnswer) {
    headline = WAITING_FOR_ANSWER_HEADLINE;
    detail = "";
  } else if (intent === "view_session") {
    headline = VIEW_SESSION_HEADLINE;
    detail = "";
  } else if (displayState === "listening") {
    if (!headline || headline === STANDBY_HEADLINE) {
      headline = LISTENING_HEADLINE_DEFAULT;
    }
  } else if (!headline) {
    headline = currentStandbyGreeting || STANDBY_HEADLINE;
  }

  if (detail && detail !== headline && !headline.includes(detail)) {
    if (headline === STANDBY_HEADLINE && detail === STANDBY_DETAIL_DEFAULT) {
      return currentStandbyGreeting || STANDBY_HEADLINE;
    }
    return `${headline} — ${detail}`;
  }
  if (headline && headline !== STANDBY_HEADLINE) {
    return headline;
  }
  return currentStandbyGreeting || STANDBY_HEADLINE;
}

function isDefaultStandbyHeadline(headline) {
  if (!headline || headline === STANDBY_HEADLINE) {
    return true;
  }
  if (currentStandbyGreeting && headline === currentStandbyGreeting) {
    return true;
  }
  const standbyWithDetail = `${STANDBY_HEADLINE} — ${STANDBY_DETAIL_DEFAULT}`;
  return headline === standbyWithDetail;
}

function isIdleStandbyGreeting(headline) {
  const cleaned = (headline || "").trim();
  return Boolean(cleaned && currentStandbyGreeting && cleaned === currentStandbyGreeting);
}

function hasCustomStandbyActivityCopy() {
  const state = currentActivitySnapshot.state;
  if (state !== "standby" && state !== "error") {
    return false;
  }
  const headline = (currentActivitySnapshot.headline || "").trim();
  const detail = (currentActivitySnapshot.detail || "").trim();
  if (isTransientActivityCopy(headline, detail)) {
    return true;
  }
  if (isIdleStandbyGreeting(headline)) {
    return false;
  }
  if (!headline || headline === STANDBY_HEADLINE) {
    return Boolean(detail && detail !== STANDBY_DETAIL_DEFAULT);
  }
  return true;
}

function isTransientActivityCopy(headline, detail) {
  const lowered = `${headline || ""} ${detail || ""}`.toLowerCase();
  if (!lowered.trim()) {
    return false;
  }
  return (
    lowered.includes("could not complete")
  );
}

function shouldScheduleActivityClear() {
  if (isWaitingForAnswerActivity()) {
    return false;
  }
  if (getDisplayState() === "working") {
    return true;
  }
  const headline = (currentActivitySnapshot.headline || "").trim();
  const detail = (currentActivitySnapshot.detail || "").trim();
  return isTransientActivityCopy(headline, detail) || hasCustomStandbyActivityCopy();
}

function resetTransientActivityCopy() {
  if (isWaitingForAnswerActivity()) {
    return;
  }
  const headline = (currentActivitySnapshot.headline || "").trim();
  const detail = (currentActivitySnapshot.detail || "").trim();
  if (!isTransientActivityCopy(headline, detail)) {
    return;
  }
  resetStandbySnapshot();
  clearActivityStatusDisplay();
}

function cancelStatusReveal() {
  if (statusRevealTimer !== null) {
    window.clearTimeout(statusRevealTimer);
    statusRevealTimer = null;
  }
  activityStatusText.classList.remove("rolling");
}

function revealStatusRolling(content, onComplete) {
  const tokens = content.match(/\S+\s*/gu) || [content];
  let index = 0;
  activityStatusText.textContent = "";
  activityStatusText.classList.add("rolling");

  const step = () => {
    if (index >= tokens.length) {
      activityStatusText.classList.remove("rolling");
      statusRevealTimer = null;
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }
    activityStatusText.textContent += tokens[index];
    index += 1;
    const delay = content.length > 180 ? 14 : content.length > 100 ? 20 : content.length > 50 ? 28 : 36;
    statusRevealTimer = window.setTimeout(step, delay);
  };

  step();
}

function shouldShowActivityStatus() {
  if (getDisplayState() === "working") {
    return true;
  }
  if (isWaitingForAnswerActivity()) {
    return true;
  }
  return isListeningStateActive();
}

function isBaseAnswerContent(content) {
  return (content || "").trim() === IDLE_RESPONSE;
}

function restoreBaseAnswer() {
  if (getDisplayState() === "working" || requestInFlight) {
    answerClearPending = true;
    return;
  }
  resetTransientActivityCopy();
  setAnswer(IDLE_RESPONSE, {
    animate: false,
    bypassSpeechGuard: true,
    isBaseState: true,
  });
}

function hasVisibleAnswerContent() {
  if (answerOutput.classList.contains("working")) {
    return false;
  }
  return hasScheduledAnswerContent();
}

function clearActivityStatusDisplay() {
  cancelStatusReveal();
  lastRenderedStatusText = "";
  activityStatusText.textContent = "";
  activityStatus.hidden = true;
}

function renderActivityStatus(options = {}) {
  if (!shouldShowActivityStatus()) {
    clearActivityStatusDisplay();
    clearStatusClearTimer();
    statusClearPending = false;
    return;
  }

  activityStatus.hidden = false;
  const animate = options.animate !== false;
  const headline = resolveActivityHeadline();
  const displayState = getDisplayState();

  if (headline !== lastRenderedStatusText) {
    const shouldAnimate =
      animate &&
      headline &&
      !(displayState === "working" && lastRenderedStatusText);

    cancelStatusReveal();
    lastRenderedStatusText = headline;
    if (shouldAnimate) {
      revealStatusRolling(headline);
    } else {
      activityStatusText.textContent = headline;
    }
  }

  if (shouldScheduleActivityClear()) {
    scheduleStatusClear();
    return;
  }
  clearStatusClearTimer();
  statusClearPending = false;
}

function shouldDeferStatusClear() {
  return isListeningStateActive() || isViewSessionActive();
}

function resetActivityStatusIfIdle() {
  if (shouldDeferStatusClear()) {
    statusClearPending = true;
    return;
  }
  statusClearPending = false;
  if (getDisplayState() === "working") {
    currentActivitySnapshot = {
      ...currentActivitySnapshot,
      detail: null,
    };
    renderActivityStatus({ animate: false });
    return;
  }
  const hadCustomCopy = hasCustomStandbyActivityCopy();
  if (hadCustomCopy) {
    resetStandbySnapshot();
    void acknowledgePresenceDismissal();
    return;
  }
  clearActivityStatusDisplay();
}

function startWorkingResponse() {
  if (answerOutput.classList.contains("working")) {
    return;
  }
  if (suppressWorkingResponse && !requestInFlight) {
    return;
  }
  cancelAnswerReveal();
  cancelStatusReveal();
  clearAnswerClearTimer();
  clearStatusClearTimer();
  if (!answerOutput.classList.contains("empty")) {
    savedResponseBeforeWorking = answerOutput.textContent;
  } else {
    savedResponseBeforeWorking = null;
  }
  answerOutput.classList.add("working");
  answerOutput.classList.remove("empty");
  applyResponseTypography(3);
  let step = 0;
  const tick = () => {
    step = (step % 3) + 1;
    answerOutput.textContent = ".".repeat(step);
  };
  tick();
  workingDotsTimer = window.setInterval(tick, 450);
}

function stopWorkingResponse({ restore = true } = {}) {
  if (workingDotsTimer !== null) {
    window.clearInterval(workingDotsTimer);
    workingDotsTimer = null;
  }
  if (!answerOutput.classList.contains("working")) {
    savedResponseBeforeWorking = null;
    return;
  }
  answerOutput.classList.remove("working");
  if (!restore) {
    savedResponseBeforeWorking = null;
    return;
  }
  if (savedResponseBeforeWorking) {
    answerOutput.textContent = savedResponseBeforeWorking;
    answerOutput.classList.remove("empty");
    applyResponseTypography(savedResponseBeforeWorking.length);
    savedResponseBeforeWorking = null;
    return;
  }
  if (!hasScheduledAnswerContent()) {
    restoreBaseAnswer();
  }
}

function renderState() {
  const displayState = getDisplayState();
  stateLine.textContent = displayState;
  document.body.dataset.displayState = displayState;
  applyControlsVisibility();
  renderActivityStatus();
  if (displayState === "working") {
    if (!suppressWorkingResponse) {
      startWorkingResponse();
    }
  } else {
    suppressWorkingResponse = false;
    stopWorkingResponse();
    if (answerClearPending) {
      resumeAnswerClearAfterSpeech();
    }
  }
  updateEssenceState();
  updateInputLock();
  syncConfirmationActions();
}

function resetVoiceListeningMode() {
  waitingForVoiceAnswer = false;
  waitingForFollowUp = false;
  waitingForYesNoConfirmation = false;
  currentAnswerPendingKind = null;
}

function openKeyboardPanel() {
  if (getDisplayState() === "working") {
    return;
  }
  keyboardOpen = true;
  keyboardPanel.hidden = false;
  document.body.classList.add("keyboard-open");
  keyboardToggle.querySelector("span").textContent = "Use Voice";
  messageBox.focus();
}

function closeKeyboardPanel() {
  keyboardOpen = false;
  document.body.classList.remove("keyboard-open");
  keyboardPanel.hidden = true;
  keyboardToggle.querySelector("span").textContent = "Use Keyboard";
}

function toggleKeyboardPanel() {
  if (keyboardOpen) {
    closeKeyboardPanel();
  } else {
    openKeyboardPanel();
  }
}

function cancelAnswerReveal() {
  if (answerRevealTimer !== null) {
    window.clearTimeout(answerRevealTimer);
    answerRevealTimer = null;
  }
  answerOutput.classList.remove("rolling");
}

function computeResponseFontSize(length) {
  if (length <= 90) {
    return "clamp(1.35rem, 3.5vw + 0.6rem, 2.6rem)";
  }
  if (length <= 180) {
    return "clamp(1.15rem, 2.8vw + 0.45rem, 2.1rem)";
  }
  if (length <= 320) {
    return "clamp(1rem, 2.2vw + 0.3rem, 1.65rem)";
  }
  if (length <= 480) {
    return "clamp(0.92rem, 1.8vw + 0.2rem, 1.35rem)";
  }
  return "clamp(0.82rem, 1.4vw + 0.15rem, 1.1rem)";
}

function applyResponseTypography(length) {
  answerOutput.style.setProperty("--response-font-size", computeResponseFontSize(length));
}

function revealAnswerRolling(content, onComplete) {
  const tokens = content.match(/\S+\s*/gu) || [content];
  let index = 0;
  answerOutput.textContent = "";
  answerOutput.classList.add("rolling");

  const step = () => {
    if (index >= tokens.length) {
      answerOutput.classList.remove("rolling");
      answerRevealTimer = null;
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }
    answerOutput.textContent += tokens[index];
    index += 1;
    const delay = content.length > 420 ? 18 : content.length > 240 ? 24 : content.length > 120 ? 32 : 42;
    answerRevealTimer = window.setTimeout(step, delay);
  };

  step();
}

function clearAnswerClearTimer() {
  if (answerClearTimer !== null) {
    window.clearTimeout(answerClearTimer);
    answerClearTimer = null;
  }
}

function clearStatusClearTimer() {
  if (statusClearTimer !== null) {
    window.clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
}

function scheduleStatusClear() {
  if (speakingActive) {
    statusClearPending = true;
    return;
  }
  clearStatusClearTimer();
  statusClearPending = false;
  statusClearTimer = window.setTimeout(() => {
    statusClearTimer = null;
    if (speakingActive) {
      statusClearPending = true;
      return;
    }
    resetActivityStatusIfIdle();
  }, ANSWER_CLEAR_DELAY_MS);
}

function clearAnswerTimeoutTimer() {
  if (answerTimeoutTimer !== null) {
    window.clearTimeout(answerTimeoutTimer);
    answerTimeoutTimer = null;
  }
}

function scheduleAnswerTimeout() {
  if (!isWaitingForUserAnswer()) {
    clearAnswerTimeoutTimer();
    answerTimeoutPending = false;
    return;
  }
  if (speakingActive) {
    answerTimeoutPending = true;
    return;
  }
  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  answerTimeoutTimer = window.setTimeout(() => {
    answerTimeoutTimer = null;
    if (speakingActive || requestInFlight) {
      answerTimeoutPending = true;
      return;
    }
    if (!isWaitingForUserAnswer()) {
      return;
    }
    void submitDefaultNoAnswer();
  }, ANSWER_CLEAR_DELAY_MS);
}

function scheduleAnswerClear() {
  if (isWaitingForUserAnswer()) {
    answerClearPending = false;
    return;
  }
  if (getDisplayState() === "working" || requestInFlight) {
    answerClearPending = true;
    return;
  }
  if (speakingActive) {
    answerClearPending = true;
    return;
  }
  clearAnswerClearTimer();
  answerClearPending = false;
  answerClearTimer = window.setTimeout(() => {
    answerClearTimer = null;
    if (speakingActive) {
      answerClearPending = true;
      return;
    }
    if (isWaitingForUserAnswer()) {
      return;
    }
    restoreBaseAnswer();
  }, ANSWER_CLEAR_DELAY_MS);
}

function resumeStatusClearIfPending() {
  if (speakingActive || shouldDeferStatusClear()) {
    statusClearPending = true;
    return;
  }
  if (
    !statusClearPending &&
    getDisplayState() !== "working" &&
    !hasCustomStandbyActivityCopy()
  ) {
    return;
  }
  statusClearPending = false;
  scheduleStatusClear();
}

function hasScheduledAnswerContent() {
  const content = (answerOutput.textContent || "").trim();
  return Boolean(content && !isBaseAnswerContent(content));
}

function resumeAnswerClearAfterSpeech() {
  resumeStatusClearIfPending();
  if (isWaitingForUserAnswer()) {
    answerClearPending = false;
    if (speakingActive) {
      answerTimeoutPending = true;
      return;
    }
    scheduleAnswerTimeout();
    return;
  }
  if (!hasScheduledAnswerContent()) {
    answerClearPending = false;
    return;
  }
  if (getDisplayState() === "working" || requestInFlight) {
    answerClearPending = true;
    return;
  }
  answerClearPending = false;
  scheduleAnswerClear();
}

function setAnswer(text, options = {}) {
  const content = text.trim();
  const animate = options.animate !== false;
  const bypassSpeechGuard = options.bypassSpeechGuard === true;
  const isBaseState = options.isBaseState === true || isBaseAnswerContent(content);
  const preserveWorkingDots =
    !options.allowDuringWorking &&
    isWorkingOnTask();

  if (preserveWorkingDots) {
    renderActivityStatus();
    return;
  }

  if (!content && speakingActive && !bypassSpeechGuard) {
    answerClearPending = true;
    return;
  }

  if (content) {
    suppressWorkingResponse = true;
    stopWorkingResponse({ restore: false });
  }

  if (!isWaitingForUserAnswer()) {
    clearAnswerClearTimer();
    answerClearPending = false;
  }
  cancelAnswerReveal();
  if (!content) {
    answerOutput.textContent = "";
    answerOutput.classList.add("empty");
    applyResponseTypography(IDLE_RESPONSE.length);
    renderActivityStatus();
    return;
  }
  answerOutput.classList.remove("empty");
  applyResponseTypography(content.length);

  const finish = () => {
    renderActivityStatus();
    if (isBaseState || isWaitingForUserAnswer()) {
      return;
    }
    if (shouldDeferAnswerClear(options)) {
      answerClearPending = true;
      return;
    }
    scheduleAnswerClear();
  };

  if (!animate) {
    answerOutput.textContent = content;
    finish();
    return;
  }

  revealAnswerRolling(content, finish);
}

