const LOCAL_TIMER_DURATION_PROMPT = "How long should the timer run?";
const IGNORE_SERVER_TIMER_PENDING_MS = 60_000;

let countdownCreateInFlight = false;
let stopwatchCreateInFlight = false;

function parseTimerDurationSeconds(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized === "cancel") {
    return 0;
  }
  let total = 0;
  const hourMatch = normalized.match(/(\d+)\s*h(?:ours?)?\b/);
  const minuteMatch = normalized.match(/(\d+)\s*m(?:in(?:ute)?s?)?\b/);
  const secondMatch = normalized.match(/(\d+)\s*s(?:ec(?:ond)?s?)?\b/);
  if (hourMatch) {
    total += Number(hourMatch[1]) * 3600;
  }
  if (minuteMatch) {
    total += Number(minuteMatch[1]) * 60;
  }
  if (secondMatch) {
    total += Number(secondMatch[1]);
  }
  if (total > 0) {
    return total;
  }
  const bareNumber = normalized.match(/^(\d+)$/);
  if (bareNumber) {
    return Number(bareNumber[1]) * 60;
  }
  const spelledMinutes = normalized.match(/^(\d+)\s+minutes?$/);
  if (spelledMinutes) {
    return Number(spelledMinutes[1]) * 60;
  }
  const spelledHours = normalized.match(/^(\d+)\s+hours?$/);
  if (spelledHours) {
    return Number(spelledHours[1]) * 3600;
  }
  const spelledSeconds = normalized.match(/^(\d+)\s+seconds?$/);
  if (spelledSeconds) {
    return Number(spelledSeconds[1]);
  }
  return 0;
}

function normalizeTimerStartIntentText(message) {
  const base =
    typeof normalizeUiCommandText === "function"
      ? normalizeUiCommandText(message)
      : String(message || "")
          .trim()
          .toLowerCase()
          .replace(/[.!?,]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
  return base
    .replace(
      /^(?:(?:can|could|would|will)\s+you\s+|(?:i(?:\s+would|\s+'d)?\s+)?(?:want|need)\s+to\s+|go\s+ahead\s+and\s+)/,
      "",
    )
    .replace(/^(?:please\s+)+/, "")
    .replace(/\s+please$/, "")
    .trim();
}

function extractTimerDurationSecondsFromMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return 0;
  }
  const startForMatch = text.match(
    /^(?:set|start)\s+(?:a\s+|the\s+|my\s+)?timer\s+for\s+(.+)$/i,
  );
  if (startForMatch?.[1]) {
    return parseTimerDurationSeconds(startForMatch[1]);
  }
  return parseTimerDurationSeconds(text);
}

function isBareTimerStartMessage(message) {
  const text = String(message || "").trim();
  if (!text || /^cancel$/i.test(text)) {
    return false;
  }
  if (extractTimerDurationSecondsFromMessage(text) > 0) {
    return false;
  }
  const normalized = normalizeTimerStartIntentText(text);
  if (!normalized) {
    return false;
  }
  const timerArticle = "(?:a\\s+)?(?:the\\s+)?(?:my\\s+)?";
  const startVerb = "(?:set|start|create|make|add)";
  if (new RegExp(`^${startVerb}\\s+${timerArticle}timer$`).test(normalized)) {
    return true;
  }
  if (/^new\s+timer$/.test(normalized)) {
    return true;
  }
  if (new RegExp(`\\b${startVerb}\\s+${timerArticle}timer\\b`).test(normalized) && !/\bfor\b/.test(normalized)) {
    return !/\b\d+\b/.test(normalized);
  }
  return false;
}

function buildClientCountdownAnchor(durationSeconds, committedAtMs) {
  const duration = Math.max(1, Math.floor(Number(durationSeconds)));
  const startedAtMs = Number(committedAtMs);
  return {
    durationSeconds: duration,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
  };
}

function buildOptimisticCountdownTimer(durationSeconds, label = "Timer", committedAtMs = Date.now()) {
  const anchor = buildClientCountdownAnchor(durationSeconds, committedAtMs);
  const startedAtMs = anchor.startedAtMs;
  const duration = anchor.durationSeconds;
  return {
    id: `optimistic-countdown-${startedAtMs}`,
    kind: "countdown",
    label: String(label || "Timer").trim() || "Timer",
    local: true,
    started_at: new Date(startedAtMs).toISOString(),
    due_at: new Date(startedAtMs + duration * 1000).toISOString(),
    duration_seconds: duration,
    client_countdown: anchor,
  };
}

function enrichCountdownTimerFromDuration(
  timer,
  durationSeconds,
  label = "Timer",
  committedAtMs = null,
) {
  const normalized =
    typeof normalizeRuntimeTimer === "function" ? normalizeRuntimeTimer(timer) : timer;
  if (!normalized || typeof normalized !== "object") {
    return null;
  }
  const duration = Math.max(1, Math.floor(Number(durationSeconds)));
  const useClientCommit = committedAtMs != null && Number.isFinite(Number(committedAtMs));
  const anchor = useClientCommit
    ? buildClientCountdownAnchor(duration, committedAtMs)
    : normalized.client_countdown?.durationSeconds > 0
      ? normalized.client_countdown
      : null;
  const startMs =
    anchor?.startedAtMs ??
    (typeof resolveTimerStartedAtMs === "function"
      ? resolveTimerStartedAtMs(normalized)
      : Date.parse(normalized.started_at || normalized.created_at || ""));
  const resolvedStartMs = Number.isNaN(startMs) ? Date.now() : startMs;
  const resolvedDuration = anchor?.durationSeconds ?? duration;
  normalized.started_at = new Date(resolvedStartMs).toISOString();
  normalized.due_at = new Date(resolvedStartMs + resolvedDuration * 1000).toISOString();
  normalized.duration_seconds = resolvedDuration;
  if (anchor) {
    normalized.client_countdown = anchor;
  }
  delete normalized.remaining_seconds;
  const nextLabel = String(label || normalized.label || "Timer").trim() || "Timer";
  normalized.label = nextLabel;
  delete normalized.local;
  return normalized;
}

function applyCreatedCountdownTimer(
  created,
  durationSeconds,
  label = "Timer",
  committedAtMs = null,
) {
  const enriched =
    durationSeconds > 0
      ? enrichCountdownTimerFromDuration(created, durationSeconds, label, committedAtMs)
      : typeof normalizeRuntimeTimer === "function"
        ? normalizeRuntimeTimer(created)
        : created;
  if (!enriched || typeof syncActiveTimers !== "function") {
    return;
  }
  const createdId = enriched.id != null ? String(enriched.id).trim() : "";
  const baseTimers = currentActiveTimers.filter((timer) => {
    if (typeof isStopwatchTimer === "function" && isStopwatchTimer(timer)) {
      return true;
    }
    if (typeof isOptimisticCountdownTimer === "function" && isOptimisticCountdownTimer(timer)) {
      return false;
    }
    const id = timer?.id != null ? String(timer.id).trim() : "";
    return !createdId || id !== createdId;
  });
  syncActiveTimers([...baseTimers, enriched]);
}

function beginDurationPrompt() {
  localTimerDurationPromptActive = true;
  currentPendingSnapshot = null;
  currentAnswerPendingKind = "timer_duration";
  currentInputKind = "timer_duration";
  waitingForFollowUp = true;
  waitingForVoiceAnswer = false;
  setAnswer(LOCAL_TIMER_DURATION_PROMPT, { animate: true });
  syncInputActions();
  if (voiceAvailable && typeof ensureDirectAnswerListening === "function") {
    ensureDirectAnswerListening(pendingListenStatus("timer_duration"));
  }
}

function beginLocalTimerDurationPrompt() {
  beginDurationPrompt();
}

function clearTimerDurationPromptState() {
  localTimerDurationPromptActive = false;
  if (typeof clearPendingCountdownAnchor === "function") {
    clearPendingCountdownAnchor();
  }
  if (typeof returnToWakeDetection === "function") {
    returnToWakeDetection();
    return;
  }
  currentAnswerPendingKind = null;
  currentInputKind = null;
  waitingForFollowUp = false;
  waitingForVoiceAnswer = false;
  if (typeof clearPendingState === "function") {
    clearPendingState();
  }
  syncInputActions();
}

function scheduleTimerStatusSync() {
  if (typeof syncRuntimeStatus !== "function") {
    return;
  }
  suppressPendingRearm = true;
  void syncRuntimeStatus().finally(() => {
    suppressPendingRearm = false;
  });
}

async function commitDurationSeconds(durationSeconds, options = {}) {
  const normalized = Math.floor(Number(durationSeconds));
  const displayMessage = String(options.displayMessage || "").trim();
  const label = options.label || "Timer";

  if (reconnectInProgress || countdownCreateInFlight) {
    replyStatus.textContent = "Wait for the current task to finish.";
    return false;
  }

  if (!normalized || normalized <= 0) {
    if (displayMessage && /^cancel$/i.test(displayMessage)) {
      clearTimerDurationPromptState();
      replyStatus.textContent = "";
      if (typeof clearAnswerOutput === "function") {
        clearAnswerOutput();
      }
    }
    return false;
  }

  countdownCreateInFlight = true;
  const committedAtMs = Date.now();
  if (displayMessage) {
    showUserSpeech(displayMessage);
  }
  replyStatus.textContent = "Starting timer...";
  syncInputActions();

  applyCreatedCountdownTimer(
    buildOptimisticCountdownTimer(normalized, label, committedAtMs),
    normalized,
    label,
    committedAtMs,
  );

  try {
    const created = await createCountdownTimer({
      durationSeconds: normalized,
      label,
      startAt: options.startAt ?? null,
    });
    applyCreatedCountdownTimer(created, normalized, label, committedAtMs);
    ignoreServerTimerPendingUntil = Date.now() + IGNORE_SERVER_TIMER_PENDING_MS;
    replyStatus.textContent = "";
    if (typeof clearAnswerOutput === "function") {
      clearAnswerOutput();
    }
    clearTimerDurationPromptState();
    scheduleTimerStatusSync();
    return true;
  } catch (error) {
    replyStatus.textContent = error.message || "Could not start timer.";
    scheduleTimerStatusSync();
    return false;
  } finally {
    countdownCreateInFlight = false;
    syncInputActions();
  }
}

async function startCountdownFromDuration(durationSeconds, options = {}) {
  return commitDurationSeconds(durationSeconds, options);
}

async function tryStartCountdownFromMessage(message) {
  const durationSeconds = extractTimerDurationSecondsFromMessage(message);
  if (durationSeconds <= 0) {
    return false;
  }
  return await commitDurationSeconds(durationSeconds, { displayMessage: message });
}

async function handleTimerUserMessage(message, source, options = {}, context = {}) {
  if (options.skipTimerFastPath) {
    return { handled: false };
  }
  const durationSeconds = extractTimerDurationSecondsFromMessage(message);
  if (durationSeconds > 0) {
    await commitDurationSeconds(durationSeconds, { displayMessage: message });
    return { handled: true };
  }
  if (!context.isPendingInputAnswer && isBareTimerStartMessage(message)) {
    showUserSpeech(message);
    beginDurationPrompt();
    return { handled: true };
  }
  return { handled: false };
}

async function handleTimerToolCommand(command, message) {
  if (!isTimerToolCommand(command)) {
    return { handled: false };
  }
  if (typeof isStopwatchToolCommand === "function" && isStopwatchToolCommand(command)) {
    return { handled: false };
  }
  if (isBareTimerStartMessage(message)) {
    showUserSpeech(message);
    beginDurationPrompt();
    return { handled: true };
  }
  const timerDurationSeconds = extractTimerDurationSecondsFromMessage(message);
  if (timerDurationSeconds > 0) {
    const ok = await commitDurationSeconds(timerDurationSeconds, { displayMessage: message });
    return { handled: ok };
  }
  return { handled: false };
}

function isOptimisticLocalStopwatch(stopwatch) {
  if (!stopwatch) {
    return false;
  }
  const id = stopwatch?.id != null ? String(stopwatch.id).trim() : "";
  return id.startsWith("local-stopwatch-") && !stopwatch.serverBacked;
}

function clearOptimisticLocalStopwatches() {
  for (const [entryKey, stopwatch] of [...localStopwatches.entries()]) {
    if (isOptimisticLocalStopwatch(stopwatch)) {
      localStopwatches.delete(entryKey);
    }
  }
}

function enrichStopwatchFromCommit(timer, label = "Stopwatch", committedAtMs = null) {
  const normalized =
    typeof normalizeRuntimeTimer === "function" ? normalizeRuntimeTimer(timer) : timer;
  if (!normalized || typeof normalized !== "object") {
    return null;
  }
  const ms = Number.isFinite(Number(committedAtMs)) ? Number(committedAtMs) : Date.now();
  const resolvedStart =
    typeof resolveTimerStartedAtMs === "function"
      ? resolveTimerStartedAtMs(normalized)
      : Date.parse(normalized.started_at || normalized.created_at || "");
  if (Number.isNaN(resolvedStart)) {
    normalized.started_at = new Date(ms).toISOString();
  }
  const nextLabel = String(label || normalized.label || "Stopwatch").trim() || "Stopwatch";
  normalized.label = nextLabel;
  delete normalized.local;
  return normalized;
}

function registerCommittedStopwatch(serverTimer, committedAtMs, label = "Stopwatch") {
  if (!serverTimer || typeof serverTimer !== "object") {
    return null;
  }
  const startedAtMs = Number.isFinite(Number(committedAtMs)) ? Number(committedAtMs) : Date.now();
  const nextLabel = String(label || serverTimer.label || "Stopwatch").trim() || "Stopwatch";
  const stopwatch = createLocalStopwatch({ label: nextLabel, startedAtMs });
  if (serverTimer.id !== undefined && serverTimer.id !== null) {
    stopwatch.id = String(serverTimer.id);
  }
  stopwatch.client_started_at_ms = startedAtMs;
  stopwatch.serverBacked = true;
  stopwatch.serverSource = serverTimer;
  stopwatch.storageKey = computeStopwatchStorageKey(stopwatch, serverTimer);
  clearOptimisticLocalStopwatches();
  pruneOptimisticStopwatchesForServerTimer({
    ...serverTimer,
    label: nextLabel,
    started_at: new Date(startedAtMs).toISOString(),
  });
  localStopwatches.set(stopwatch.storageKey, stopwatch);
  if (typeof refreshTimerDisplays === "function") {
    refreshTimerDisplays();
  }
  return stopwatch;
}

function showOptimisticStopwatch(committedAtMs, label = "Stopwatch") {
  clearOptimisticLocalStopwatches();
  const stopwatch = createLocalStopwatch({ label, startedAtMs: committedAtMs });
  stopwatch.client_started_at_ms = committedAtMs;
  localStopwatches.set(getTimerAnnouncementKey(stopwatch), stopwatch);
  if (typeof refreshTimerDisplays === "function") {
    refreshTimerDisplays();
  }
}

async function commitStopwatchStart(options = {}) {
  const displayMessage = String(options.displayMessage || "").trim();
  const label =
    String(options.label || "").trim() ||
    (displayMessage ? parseStopwatchLabel(displayMessage) : "Stopwatch");

  if (reconnectInProgress || stopwatchCreateInFlight || countdownCreateInFlight) {
    replyStatus.textContent = "Wait for the current task to finish.";
    return false;
  }

  stopwatchCreateInFlight = true;
  const committedAtMs = Date.now();
  if (displayMessage) {
    showUserSpeech(displayMessage);
  }
  replyStatus.textContent = "Starting stopwatch...";
  syncInputActions();
  showOptimisticStopwatch(committedAtMs, label);

  try {
    const created = await createStopwatch({ label, startAt: options.startAt ?? committedAtMs });
    const enriched = enrichStopwatchFromCommit(created, label, committedAtMs);
    registerCommittedStopwatch(enriched || created, committedAtMs, label);
    replyStatus.textContent = "";
    scheduleTimerStatusSync();
    return true;
  } catch (error) {
    clearOptimisticLocalStopwatches();
    if (typeof refreshTimerDisplays === "function") {
      refreshTimerDisplays();
    }
    replyStatus.textContent = error.message || "Could not start stopwatch.";
    scheduleTimerStatusSync();
    return false;
  } finally {
    stopwatchCreateInFlight = false;
    syncInputActions();
  }
}

async function handleStopwatchUserMessage(message, source, options = {}, context = {}) {
  if (options.skipTimerFastPath) {
    return { handled: false };
  }
  if (!context.isPendingInputAnswer && isStopwatchStartMessage(message)) {
    await commitStopwatchStart({ displayMessage: message });
    return { handled: true };
  }
  return { handled: false };
}

async function handleStopwatchToolCommand(command, message) {
  if (typeof isStopwatchToolCommand !== "function" || !isStopwatchToolCommand(command)) {
    return { handled: false };
  }
  if (isStopwatchStopMessage(message)) {
    return { handled: false };
  }
  const startMessage =
    isStopwatchStartMessage(message) ? message : String(message || "").trim() || "start stopwatch";
  await commitStopwatchStart({ displayMessage: startMessage });
  return { handled: true };
}
