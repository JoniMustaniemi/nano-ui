function normalizeUiCommandText(message) {
  const wakeNamePattern =
    "(?:nano|nanno|nana|nanna|neno|nono|nah no|na no|no no|na nah|nay no)";
  return message
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+/g, " ")
    .replace(/[''´`]/g, "")
    .replace(new RegExp(`\\b(?:hey|hay|hi)\\s*,?\\s*${wakeNamePattern}\\b`, "g"), " ")
    .replace(new RegExp(`\\b${wakeNamePattern}\\b`, "g"), " ")
    .replace(/\bplease\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSectionPatterns(normalized, patterns) {
  return patterns.some((pattern) => pattern.test(normalized));
}

const BRAINS_SECTION_PATTERNS = [
  /^(open|show|go to)(\s+the)?\s+brains(\s+(tab|section|panel|view))?$/,
  /\bwhat\s+are\s+you\s+thinking\b/,
  /\bwhat\s+you\s+are\s+thinking\b/,
  /\bwhat\s+you\s+re\s+thinking\b/,
  /\bwhats\s+on\s+your\s+mind\b/,
  /\bwhat\s+is\s+on\s+your\s+mind\b/,
  /\b(show|see|view|open|look at|display|pull up|bring up)\b.*\b(your thoughts|your mind|activity log|brains)\b/,
  /\b(can|could|may|would|let)\s+(i|me|we)\s+(see|view|look at|open|show|have)\b.*\b(your thoughts|your mind|activity log|brains)\b/,
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

const CALENDAR_RECAP_PATTERNS = [
  /\b(do i have|do we have|are there|any)\b.*\b(meetings?|calls?)\b/,
  /\bwhat\b.*\b(meetings?|calls?)\b/,
  /\b(meetings?|calls?)\b.*\b(today|this day)\b/,
  /\b(today|this day)\b.*\b(meetings?|calls?)\b/,
  /\b(meetings?|calls?)\b.*\b(this|my)\s+week\b/,
  /\b(this|my)\s+week\b.*\b(meetings?|calls?)\b/,
  /\bhow\b.*\bweek\b.*\b(meetings?|calls?)\b/,
  /\b(meetings?|calls?)\b.*\b(this|my)\s+month\b/,
  /\b(this|my)\s+month\b.*\b(meetings?|calls?)\b/,
  /\bhow\b.*\bmonth\b.*\b(meetings?|calls?)\b/,
  /\b(all|every|entire|whole|full)\b.*\b(meetings?|calls?)\b/,
  /\b(meetings?|calls?)\b.*\b(all|every|entire|whole|full)\b/,
];

const CALENDAR_RECAP_LOOKING_PATTERNS = [
  /\bhow\b.*\b(this|my)\s+week\b/,
  /\bhow\b.*\bweek\b.*\blooking\b/,
  /\b(this|my)\s+week\b.*\blooking\b/,
  /\bwhat\b.*\b(this|my)\s+week\b.*\b(look|like)\b/,
  /\bhow\b.*\b(this|my)\s+month\b/,
  /\bhow\b.*\bmonth\b.*\blooking\b/,
  /\b(this|my)\s+month\b.*\blooking\b/,
  /\bwhat\b.*\b(this|my)\s+month\b.*\b(look|like)\b/,
  /\bhow\b.*\b(today|my day|this day)\b/,
  /\bhow\b.*\bday\b.*\blooking\b/,
  /\bwhat\b.*\b(today|my day)\b.*\b(look|like)\b/,
  /\b(schedule|calendar)\b.*\b(this|my)\s+week\b/,
  /\b(schedule|calendar)\b.*\b(this|my)\s+month\b/,
  /\bweek\b.*\b(ahead|schedule)\b/,
  /\bmonth\b.*\b(ahead|schedule)\b/,
];

function hasMeetingRecapKeyword(normalized) {
  return /\b(meetings?|calls?)\b/.test(normalized);
}

function hasCalendarRecapIntent(normalized) {
  if (hasMeetingRecapKeyword(normalized)) {
    return true;
  }
  return matchesSectionPatterns(normalized, CALENDAR_RECAP_LOOKING_PATTERNS);
}

function resolveCalendarRecapPeriod(normalized) {
  const fullPeriod =
    /\b(all|every|entire|whole|full)\b/.test(normalized) && hasMeetingRecapKeyword(normalized);

  if (
    /\b(this|my)\s+month\b/.test(normalized) ||
    /\bmonth\b.*\b(meetings?|calls?)\b/.test(normalized) ||
    /\b(meetings?|calls?)\b.*\bmonth\b/.test(normalized) ||
    /\bhow\b.*\bmonth\b/.test(normalized) ||
    /\bmonth\b.*\b(looking|ahead|schedule)\b/.test(normalized)
  ) {
    return { period: "month", fullPeriod };
  }

  if (
    /\b(this|my)\s+week\b/.test(normalized) ||
    /\bweek\b.*\b(meetings?|calls?)\b/.test(normalized) ||
    /\b(meetings?|calls?)\b.*\bweek\b/.test(normalized) ||
    /\bhow\b.*\bweek\b/.test(normalized) ||
    /\bweek\b.*\b(looking|ahead|schedule)\b/.test(normalized)
  ) {
    return { period: "week", fullPeriod };
  }

  if (
    /\b(today|this day|my day)\b/.test(normalized) ||
    /\bhow\b.*\bday\b/.test(normalized)
  ) {
    return { period: "day", fullPeriod };
  }

  return { period: "day", fullPeriod };
}

function matchCalendarRecapCommand(normalized) {
  if (!hasCalendarRecapIntent(normalized)) {
    return null;
  }
  if (matchesSectionPatterns(normalized, CALENDAR_SECTION_PATTERNS)) {
    return null;
  }
  const matchesExplicit =
    matchesSectionPatterns(normalized, CALENDAR_RECAP_PATTERNS) ||
    matchesSectionPatterns(normalized, CALENDAR_RECAP_LOOKING_PATTERNS);
  if (!matchesExplicit) {
    return null;
  }
  const { period, fullPeriod } = resolveCalendarRecapPeriod(normalized);
  return { type: "calendar_recap", period, fullPeriod };
}

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

const DEBUG_MODE_ON_PATTERNS = [
  /^turn on debug( mode)?$/,
  /^enable debug( mode)?$/,
  /^start debug( mode)?$/,
  /^open debug( mode)?(\s+(panel|view))?$/,
  /^show debug( mode)?(\s+(panel|view|info|information))?$/,
  /\b(turn on|enable|start|open|show)\b.*\bdebug( mode)?\b/,
  /\b(can|could|may|would)\s+(you|i|we)\s+(turn on|enable|start|open|show)\b.*\bdebug\b/,
];

const DEBUG_MODE_OFF_PATTERNS = [
  /^turn off debug( mode)?$/,
  /^disable debug( mode)?$/,
  /^stop debug( mode)?$/,
  /^close debug( mode)?(\s+(panel|view))?$/,
  /^hide debug( mode)?(\s+(panel|view))?$/,
  /^exit debug( mode)?$/,
  /\b(turn off|disable|stop|close|hide|exit)\b.*\bdebug( mode)?\b/,
  /\b(can|could|may|would)\s+(you|i|we)\s+(turn off|disable|stop|close|hide|exit)\b.*\bdebug\b/,
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
  if (matchesSectionPatterns(normalized, DEBUG_MODE_ON_PATTERNS)) {
    return { type: "debug_mode", action: "on" };
  }
  if (matchesSectionPatterns(normalized, DEBUG_MODE_OFF_PATTERNS)) {
    return { type: "debug_mode", action: "off" };
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
  const recapCommand = matchCalendarRecapCommand(normalized);
  if (recapCommand) {
    return recapCommand;
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

  if (command.type === "debug_mode") {
    if (typeof setDebugModeEnabled === "function") {
      setDebugModeEnabled(command.action === "on");
    }
    return true;
  }

  if (command.type === "close") {
    if (isViewSessionActive()) {
      closeViewSession({ reason: source === "voice" ? "voice" : "ui" });
    } else {
      closeOpenUiPanels();
    }
    return true;
  }

  if (command.type === "calendar_recap") {
    if (getDisplayState() === "working") {
      lastUiCommandResult = null;
      return false;
    }
    lastUiCommandResult = null;
    void handleCalendarRecap(command, source);
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
  if (command.type === "debug_mode") {
    return command.action === "on" ? "Debug mode on." : "Debug mode off.";
  }
  if (command.type === "close") {
    return "Closed.";
  }
  if (command.type === "section") {
    const labels = {
      brains: "Opening Brains.",
      storage: "Opening saved timers.",
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
