const LAST_COMMAND_CATEGORIES = ["System"];
const EXCLUDED_COMMAND_CATEGORIES = new Set(["git", "github", "weather"]);
const GIT_PR_COMMAND_PATTERN =
  /\b(commit|pull request|pull_request|create pr|gh pr|git push|git commit)\b/i;
const ACTIVE_TIMERS_COMMAND_PATTERN = /\bactive\s+timers?\b/i;
const WEATHER_COMMAND_PATTERN =
  /\b(current\s+weather|what(?:'s| is)\s+the\s+weather)\b/i;
const HIDDEN_TOOL_COMMAND_PATTERN =
  /\b(rename\s+timer|rename\s+stopwatch|stop\s+stopwatches?|clear\s+all\s+timers|cancel\s+timers|system\s+analysis|health\s+check|wipe\s+(?:your\s+)?data|what\s+can\s+you\s+do|hide\s*\/\s*show\s+controls|hide\s+controls|show\s+controls|internal\s+notes?)\b/i;
const EXCLUDED_TOOL_COMMAND_IDS = new Set([
  "active_timers",
  "list_active_timers",
  "get_current_weather",
  "rename_timer",
  "rename_stopwatch",
  "stop_stopwatches",
  "cancel_timers",
  "clear_all_timers",
  "analyze_system",
  "check_health",
  "wipe_data",
  "capabilities",
  "toggle_controls",
  "list_internal_notes",
  "open_commands",
  "debug_mode_on",
  "debug_mode_off",
]);
const SUPPLEMENTAL_TOOL_COMMANDS = [
  {
    id: "calendar_recap_today",
    label: "Today's meetings",
    message: "Do I have any meetings today?",
    category: "Calendar",
    description: "Summarize today's calendar events.",
  },
  {
    id: "debug_mode_on",
    label: "Debug mode on",
    message: "Turn on debug mode",
    category: "System",
    description: "Show live diagnostics on the home screen.",
  },
  {
    id: "debug_mode_off",
    label: "Debug mode off",
    message: "Turn off debug mode",
    category: "System",
    description: "Hide the on-screen diagnostics panel.",
  },
];

const COMMAND_ACTION_DESCRIPTIONS = {
  open_brains: "Open the activity and reasoning log.",
  open_storage: "Browse timers saved on the server.",
  open_calendar: "Open the full-screen calendar view.",
  calendar_recap_today: "Summarize today's calendar events.",
};
const VOICE_YES_NO_PENDING_KINDS = new Set([
  "wipe_confirmation",
  "reboot_confirmation",
  "service_restart_confirmation",
  "presence_check",
]);
const BUTTON_YES_NO_PENDING_KINDS = new Set([
  "wipe_confirmation",
  "presence_check",
]);
// Backward-compatible alias for tests and callers that check membership.
const YES_NO_PENDING_KINDS = VOICE_YES_NO_PENDING_KINDS;
const YES_NO_INPUT_ACTIONS = [
  { label: "Yes", value: "yes", variant: "yes" },
  { label: "No", value: "no", variant: "no" },
];
const TIMER_DURATION_INPUT_ACTIONS = [
  { label: "1 min", value: "1 minute" },
  { label: "5 min", value: "5 minutes" },
  { label: "10 min", value: "10 minutes" },
  { label: "15 min", value: "15 minutes" },
  { label: "30 min", value: "30 minutes" },
  { label: "1 hour", value: "1 hour" },
  { label: "Cancel", value: "cancel", variant: "no" },
];
const GENERIC_INPUT_ACTIONS = [
  { label: "Type answer", action: "open_keyboard" },
  { label: "Cancel", value: "cancel", variant: "no" },
];

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

const COMMAND_SECTION_META = {
  Calendar: {
    subtitle: "Manage your calendar integration.",
    icon: "calendar",
  },
  Timers: {
    subtitle: "Start, check, and manage timers.",
    icon: "clock",
  },
  Interface: {
    subtitle: "Control the interface and data views.",
    icon: "interface",
  },
  System: {
    subtitle: "Diagnostics and assistant controls.",
    icon: "system",
  },
  Other: {
    subtitle: "Quick actions and shortcuts.",
    icon: "terminal",
  },
};

const COMMANDS_RAIL_ICON_ATTRS =
  'class="commands-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

const COMMANDS_RAIL_ICON_SVGS = {
  calendar: `<svg ${COMMANDS_RAIL_ICON_ATTRS}><path d="M8 3v3M16 3v3M4 9h16"/><rect x="4" y="6" width="16" height="14" rx="2"/></svg>`,
  clock: `<svg ${COMMANDS_RAIL_ICON_ATTRS}><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l2.75 2.75"/></svg>`,
  interface: `<svg ${COMMANDS_RAIL_ICON_ATTRS}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`,
  system: `<svg ${COMMANDS_RAIL_ICON_ATTRS}><path d="M4 12h3l2-5 4 10 2-5h7"/></svg>`,
  terminal: `<svg ${COMMANDS_RAIL_ICON_ATTRS}><path d="m7 8-4 4 4 4"/><path d="M11 16h9"/></svg>`,
};

const COMMAND_SECTION_ICON_SVGS = {
  calendar: COMMANDS_RAIL_ICON_SVGS.calendar,
  clock: COMMANDS_RAIL_ICON_SVGS.clock,
  interface: COMMANDS_RAIL_ICON_SVGS.interface,
  system: COMMANDS_RAIL_ICON_SVGS.system,
  terminal: COMMANDS_RAIL_ICON_SVGS.terminal,
  brains: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 4A5.5 5.5 0 0 0 4 9.5c0 1.2.38 2.31 1.03 3.22L4 20l7.28-1.03A5.5 5.5 0 1 0 9.5 4z"/><path d="M14 8.5c2.5.6 4.5 2.8 4.5 5.5a5.5 5.5 0 0 1-5.5 5.5c-.9 0-1.75-.22-2.5-.6L7 20l1.05-3.45A5.48 5.48 0 0 1 6 14c0-2.9 2.2-5.2 5-5.5"/></svg>`,
  storage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>`,
  meetings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>`,
};

function commandSectionMeta(category) {
  const normalized = String(category || "").trim();
  const knownKey = Object.keys(COMMAND_SECTION_META).find(
    (name) => name.toLowerCase() === normalized.toLowerCase()
  );
  if (knownKey) {
    return COMMAND_SECTION_META[knownKey];
  }
  if (/timer/i.test(normalized)) {
    return COMMAND_SECTION_META.Timers;
  }
  return {
    subtitle: COMMAND_SECTION_META.Other.subtitle,
    icon: "terminal",
  };
}

function commandActionIconKey(command) {
  const view = resolveViewClientAction(command);
  if (view === "calendar") {
    return "calendar";
  }
  if (view === "brains") {
    return "brains";
  }
  if (view === "storage") {
    return "storage";
  }
  if (view === "commands") {
    return "terminal";
  }
  const id = String(command?.id || "").toLowerCase();
  if (id.includes("meeting") || id.includes("calendar")) {
    return "meetings";
  }
  if (id.includes("timer") || id.includes("stopwatch")) {
    return "clock";
  }
  const category = String(command?.category || "").toLowerCase();
  if (category.includes("timer")) {
    return "clock";
  }
  return "terminal";
}

function createCommandIconElement(iconKey) {
  const icon = document.createElement("span");
  icon.className = "commands-action-card__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = COMMAND_SECTION_ICON_SVGS[iconKey] || COMMAND_SECTION_ICON_SVGS.terminal;
  return icon;
}

function commandActionDescription(command) {
  const explicit = String(command?.description || "").trim();
  if (explicit) {
    return explicit;
  }

  const id = String(command?.id || "").trim().toLowerCase();
  if (COMMAND_ACTION_DESCRIPTIONS[id]) {
    return COMMAND_ACTION_DESCRIPTIONS[id];
  }

  const clientAction = String(command?.client_action || "").trim().toLowerCase();
  if (COMMAND_ACTION_DESCRIPTIONS[clientAction]) {
    return COMMAND_ACTION_DESCRIPTIONS[clientAction];
  }

  const view = resolveViewClientAction(command);
  if (view === "brains") {
    return "Open the activity and reasoning log.";
  }
  if (view === "storage") {
    return "Browse timers saved on the server.";
  }
  if (view === "calendar") {
    return "Open the full-screen calendar view.";
  }

  if (isTimerToolCommand(command)) {
    return "Start or manage a timer by voice.";
  }

  const message = String(command?.message || "").trim();
  if (message) {
    const shortened = message.length > 80 ? `${message.slice(0, 77)}…` : message;
    return `Says: “${shortened}”`;
  }

  const label = String(command?.label || "").trim();
  if (label) {
    return `Runs the “${label}” quick action.`;
  }
  return "Run this quick action.";
}

function commandCategorySectionId(category) {
  const slug = String(category || "other")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `category-${slug || "other"}`;
}

function isSystemCommandCategory(category) {
  return String(category || "").trim().toLowerCase() === "system";
}

let currentCommandsSection = "connection";

function applyCommandsSectionVisual(sectionId) {
  const page = document.querySelector(".commands-page");
  if (!page || !sectionId) {
    return;
  }
  for (const button of page.querySelectorAll(".commands-rail-btn")) {
    const active = button.dataset.commandsSection === sectionId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  }
  for (const panel of page.querySelectorAll(".commands-stage-panel")) {
    const active = panel.dataset.commandsSection === sectionId;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }
}

function setCommandsSection(sectionId) {
  if (!sectionId || sectionId === currentCommandsSection) {
    return;
  }
  currentCommandsSection = sectionId;
  applyCommandsSectionVisual(sectionId);
}

function initCommandsRail() {
  const rail = document.getElementById("commands-rail");
  if (!rail || rail.dataset.bound === "true") {
    return;
  }
  rail.dataset.bound = "true";
  rail.addEventListener("click", (event) => {
    const button = event.target.closest(".commands-rail-btn");
    if (!button) {
      return;
    }
    setCommandsSection(button.dataset.commandsSection || "");
  });
}

function clearCommandActionCards(grid) {
  if (!grid) {
    return;
  }
  for (const card of grid.querySelectorAll(".commands-action-card")) {
    card.remove();
  }
}

function appendCommandsRailButton(sectionId, label, iconKey) {
  if (!commandsRailCategories) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "commands-rail-btn";
  button.dataset.commandsSection = sectionId;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = COMMANDS_RAIL_ICON_SVGS[iconKey] || COMMANDS_RAIL_ICON_SVGS.terminal;
  commandsRailCategories.append(button);
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
  if (commandsRailCategories) {
    commandsRailCategories.replaceChildren();
  }
  for (const [category, items] of groupCommands(commands)) {
    const meta = commandSectionMeta(category);
    const sectionId = commandCategorySectionId(category);
    appendCommandsRailButton(sectionId, category, meta.icon);

    const useSystemPanel = isSystemCommandCategory(category);
    let section;
    let grid;
    if (useSystemPanel) {
      section = document.getElementById("commands-panel-system");
      grid = document.getElementById("commands-system-action-grid");
      if (!section || !grid) {
        continue;
      }
      clearCommandActionCards(grid);
      section.hidden = true;
      section.classList.remove("is-active");
    } else {
      section = document.createElement("section");
      section.className = "commands-stage-panel commands-stage-panel--category";
      section.dataset.commandsSection = sectionId;
      section.hidden = true;

      const header = document.createElement("header");
      header.className = "commands-stage-header";
      const heading = document.createElement("div");
      heading.className = "commands-stage-heading";
      const title = document.createElement("h3");
      title.className = "commands-stage-title";
      title.textContent = category;
      const subtitle = document.createElement("p");
      subtitle.className = "commands-stage-subtitle";
      subtitle.textContent = meta.subtitle;
      heading.append(title, subtitle);
      header.append(heading);
      section.append(header);

      grid = document.createElement("div");
      grid.className = "commands-action-grid";
    }

    for (const command of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-button commands-action-card";
      button.dataset.commandId = command.id || "";
      button.dataset.clientAction = command.client_action || "";
      button.dataset.commandMessage = command.message;

      button.append(createCommandIconElement(commandActionIconKey(command)));

      const copy = document.createElement("span");
      copy.className = "commands-action-card__copy";
      const label = document.createElement("span");
      label.className = "command-button-label";
      label.textContent = command.label;
      copy.append(label);
      const description = document.createElement("span");
      description.className = "command-button-description";
      description.textContent = commandActionDescription(command);
      copy.append(description);
      button.append(copy);

      const chevron = document.createElement("span");
      chevron.className = "commands-action-card__chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 6l6 6-6 6"/></svg>';
      button.append(chevron);

      button.addEventListener("click", () => {
        void runToolCommand(command);
      });
      grid.append(button);
    }

    if (!useSystemPanel) {
      section.append(grid);
      commandsList.append(section);
    }
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
  syncInputActions();
}

function getInputActionsForCurrentState() {
  if (waitingForPresence) {
    return YES_NO_INPUT_ACTIONS;
  }
  if (currentAnswerPendingKind && BUTTON_YES_NO_PENDING_KINDS.has(currentAnswerPendingKind)) {
    return YES_NO_INPUT_ACTIONS;
  }
  if (currentAnswerPendingKind === "timer_duration" || currentInputKind === "timer_duration") {
    return TIMER_DURATION_INPUT_ACTIONS;
  }
  if (isWaitingForUserAnswer()) {
    return GENERIC_INPUT_ACTIONS;
  }
  return [];
}

function renderInputActionButton(action, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "confirmation-btn input-action-btn";
  if (action.variant === "yes") {
    button.classList.add("confirmation-btn-yes");
  }
  button.textContent = action.label;
  button.disabled = disabled;
  button.dataset.inputAction = action.action || "submit";
  if (action.value) {
    button.dataset.inputValue = action.value;
  }
  return button;
}

function syncInputActions() {
  if (!inputActions) {
    return;
  }
  const actions = getInputActionsForCurrentState();
  const disabled = requestInFlight || reconnectInProgress;
  inputActions.hidden = !actions.length;
  inputActions.replaceChildren();
  if (!actions.length) {
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const action of actions) {
    fragment.appendChild(renderInputActionButton(action, disabled));
  }
  inputActions.appendChild(fragment);
}

function setCommandButtonsDisabled(disabled) {
  const root = viewPanelCommands || document;
  for (const button of root.querySelectorAll(".command-button")) {
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

function updateInputLock() {
  const locked = getDisplayState() === "working" || reconnectInProgress;
  messageBox.disabled = locked;
  sendButton.disabled = locked;
  commandsToggle.disabled = locked;
  if (voiceModeToggle) {
    const voiceSupported =
      typeof isVoiceRecognitionSupported === "function"
        ? isVoiceRecognitionSupported()
        : Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    voiceModeToggle.disabled = locked || !voiceSupported;
  }
  setCommandButtonsDisabled(locked);
  syncInputActions();
  document.body.classList.toggle("inputs-locked", locked);
}

function isExcludedToolCommand(command) {
  const category = String(command?.category || "").trim().toLowerCase();
  if (EXCLUDED_COMMAND_CATEGORIES.has(category)) {
    return true;
  }
  const id = String(command?.id || "").trim().toLowerCase();
  if (EXCLUDED_TOOL_COMMAND_IDS.has(id)) {
    return true;
  }
  const searchable = `${command?.id || ""} ${command?.message || ""} ${command?.label || ""}`;
  return (
    GIT_PR_COMMAND_PATTERN.test(searchable) ||
    ACTIVE_TIMERS_COMMAND_PATTERN.test(searchable) ||
    WEATHER_COMMAND_PATTERN.test(searchable) ||
    HIDDEN_TOOL_COMMAND_PATTERN.test(searchable)
  );
}

function filterToolCommands(commands) {
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command) => !isExcludedToolCommand(command));
}

function supplementToolCommands(commands) {
  const normalized = Array.isArray(commands) ? [...commands] : [];
  const ids = new Set(
    normalized.map((command) => String(command?.id || "").trim().toLowerCase()).filter(Boolean),
  );
  for (const command of SUPPLEMENTAL_TOOL_COMMANDS) {
    const id = String(command.id || "").trim().toLowerCase();
    if (id && !ids.has(id)) {
      normalized.push(command);
      ids.add(id);
    }
  }
  return normalized;
}

async function loadToolCommands() {
  const response = await nanoFetch("/api/tool-commands");
  if (!response.ok) {
    throw new Error("Could not load tool commands.");
  }
  const commands = await response.json();
  return filterToolCommands(supplementToolCommands(commands));
}

function isStopwatchToolCommand(command) {
  const id = String(command?.id || "").toLowerCase();
  if (EXCLUDED_TOOL_COMMAND_IDS.has(id)) {
    return false;
  }
  if (id.includes("stopwatch")) {
    return id !== "stop_stopwatches" && id !== "rename_stopwatch";
  }
  const action = String(command?.client_action || "").toLowerCase();
  const message = String(command?.message || "").toLowerCase();
  const label = String(command?.label || "").toLowerCase();
  return (
    action.includes("stopwatch") ||
    /\bstopwatch\b/.test(message) ||
    /\bstopwatch\b/.test(label)
  );
}

function isTimerToolCommand(command) {
  const id = String(command?.id || "").toLowerCase();
  if (EXCLUDED_TOOL_COMMAND_IDS.has(id)) {
    return false;
  }
  if (id.includes("stopwatch")) {
    return false;
  }
  const action = String(command?.client_action || "").toLowerCase();
  const message = String(command?.message || "").toLowerCase();
  const label = String(command?.label || "").toLowerCase();
  return (
    action.includes("timer") ||
    id.includes("timer") ||
    /\btimer\b/.test(message) ||
    /\btimer\b/.test(label)
  );
}

function resolveToolCommandMessage(command) {
  const message = String(command?.message || "").trim();
  if (message) {
    return message;
  }
  if (typeof isStopwatchToolCommand === "function" && isStopwatchToolCommand(command)) {
    return "Start a stopwatch";
  }
  if (isTimerToolCommand(command)) {
    return "Start a timer";
  }
  const label = String(command?.label || "").trim();
  if (label) {
    return label;
  }
  return String(command?.id || "")
    .replace(/_/g, " ")
    .trim();
}

async function runToolCommand(command) {
  if (isBusy()) {
    replyStatus.textContent = "I'm still working. Wait for the current task to finish.";
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
  const message = resolveToolCommandMessage(command);
  if (!message) {
    replyStatus.textContent = "This command has no message configured.";
    return;
  }
  if (isViewSessionActive()) {
    closeViewSession({ reason: "ui", restoreWake: false });
  }
  const stopwatchCommandResult = await handleStopwatchToolCommand(command, message);
  if (stopwatchCommandResult.handled) {
    return;
  }
  const timerCommandResult = await handleTimerToolCommand(command, message);
  if (timerCommandResult.handled) {
    return;
  }
  await submitMessage(message, "command", command);
}
