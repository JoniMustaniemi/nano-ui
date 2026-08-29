function applyProactiveSnapshot(proactive) {
  if (!proactive || typeof proactive !== "object") {
    return;
  }
  if (proactive.waiting_for_presence && proactive.prompt) {
    void enterPresenceListenMode(proactive.prompt);
    return;
  }
  if (proactive.dismissal) {
    if (proactive.dismissal === lastHandledDismissal) {
      return;
    }
    lastHandledDismissal = proactive.dismissal;
    void handlePresenceDismissal(proactive.dismissal);
    return;
  }
  if (lastHandledDismissal && !proactive.dismissal) {
    lastHandledDismissal = null;
  }
  if (waitingForPresence) {
    exitPresenceListenMode();
    returnToWakeDetection();
  }
}

function resetStandbySnapshot() {
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    state: "standby",
    headline: currentStandbyGreeting || STANDBY_HEADLINE,
    detail: null,
  };
  renderState();
  void refreshStandbyGreeting();
}

function findLatestBootEvent(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.source === "system.boot") {
      return event;
    }
  }
  return null;
}

function bootGreetingStorageKey(bootEvent) {
  if (!bootEvent || typeof bootEvent !== "object") {
    return "";
  }
  const eventId = Number(bootEvent.id || 0);
  if (eventId > 0) {
    return String(eventId);
  }
  const createdAt = String(bootEvent.created_at || "").trim();
  return createdAt;
}

let pendingBootGreetingSpeech = null;
let bootGreetingSpeechPromise = null;

async function speakBootGreetingIfNeeded(greeting, bootKey) {
  if (!voiceAvailable || !greeting || !bootKey) {
    return false;
  }
  try {
    if (window.sessionStorage.getItem(GREETING_SPOKEN_KEY) === bootKey) {
      return true;
    }
  } catch (_error) {
    // Ignore storage read failures and continue with playback.
  }

  const promise = (async () => {
    try {
      try {
        window.sessionStorage.setItem(GREETING_SPOKEN_KEY, bootKey);
      } catch (_error) {
        // Ignore storage write failures and continue with playback.
      }
      await playVoice(greeting, { pauseRecognition: true });
      pendingBootGreetingSpeech = null;
      return true;
    } catch (_error) {
      try {
        window.sessionStorage.removeItem(GREETING_SPOKEN_KEY);
      } catch (_storageError) {
        // Ignore storage cleanup failures.
      }
      pendingBootGreetingSpeech = { greeting, bootKey };
      setAnswer(greeting, { animate: false });
      return false;
    }
  })();

  bootGreetingSpeechPromise = promise;
  try {
    return await promise;
  } finally {
    if (bootGreetingSpeechPromise === promise) {
      bootGreetingSpeechPromise = null;
    }
  }
}

function retryPendingBootGreetingSpeech() {
  if (bootGreetingSpeechPromise) {
    return bootGreetingSpeechPromise;
  }
  if (!pendingBootGreetingSpeech) {
    return Promise.resolve();
  }
  const { greeting, bootKey } = pendingBootGreetingSpeech;
  return speakBootGreetingIfNeeded(greeting, bootKey);
}

async function refreshStandbyGreeting(options = {}) {
  try {
    const response = await nanoFetch("/api/greeting");
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const greeting = (payload.greeting || "").trim();
    if (!greeting) {
      return;
    }
    currentStandbyGreeting = greeting;
    if (
      currentActivitySnapshot.state === "standby" &&
      !resolveListeningIntent() &&
      !hasCustomStandbyActivityCopy()
    ) {
      currentActivitySnapshot = {
        ...currentActivitySnapshot,
        headline: greeting,
        detail: null,
      };
    }
    renderState();
    const speakOnce = options.speakOnce === true;
    const bootKey = bootGreetingStorageKey(options.bootEvent);
    const shouldSpeak = speakOnce && voiceAvailable && Boolean(bootKey);
    if (shouldSpeak) {
      const spoke = await speakBootGreetingIfNeeded(greeting, bootKey);
      if (spoke) {
        return;
      }
    }
    setAnswer(greeting, { animate: false });
  } catch (_error) {
    return;
  }
}

function applyPendingSnapshot(pending, proactive) {
  if (suppressPendingRearm) {
    currentAnswerPendingKind = null;
    currentPendingSnapshot = null;
    clearAnswerTimeoutTimer();
    answerTimeoutPending = false;
    syncInputActions();
    return;
  }
  if (!pending || typeof pending !== "object") {
    currentAnswerPendingKind = null;
    currentPendingSnapshot = null;
    if (!waitingForPresence) {
      waitingForFollowUp = false;
    }
    clearAnswerTimeoutTimer();
    answerTimeoutPending = false;
    syncInputActions();
    return;
  }
  const kind = pending.kind;
  if (!kind) {
    currentAnswerPendingKind = null;
    currentPendingSnapshot = null;
    if (!waitingForPresence) {
      waitingForFollowUp = false;
    }
    clearAnswerTimeoutTimer();
    answerTimeoutPending = false;
    syncInputActions();
    return;
  }
  if (kind === "presence_check") {
    return;
  }
  currentAnswerPendingKind = kind;
  currentPendingSnapshot = pending;
  currentInputKind = null;
  ensureDirectAnswerListening(pendingListenStatus(kind));
  setYesNoConfirmationActive(YES_NO_PENDING_KINDS.has(kind));
  syncInputActions();
}

function applyStatusSnapshot(snapshot) {
  if (snapshot.copy) {
    applyClientCopy(snapshot.copy);
  }
  const nextState = activityStates.includes(snapshot.state) ? snapshot.state : "standby";
  const useServerCopy = nextState === "standby" || nextState === "error";
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    state: nextState,
    headline: useServerCopy
      ? (snapshot.headline || STANDBY_HEADLINE)
      : (snapshot.headline || currentActivitySnapshot.headline),
    detail: useServerCopy
      ? (snapshot.detail ?? STANDBY_DETAIL_DEFAULT)
      : (snapshot.detail ?? currentActivitySnapshot.detail),
    task_timer: snapshot.task_timer ?? null,
    active_timers: extractCountdownTimersFromSnapshot(snapshot),
  };
  if (
    nextState === "standby" &&
    snapshot.headline &&
    snapshot.headline !== STANDBY_HEADLINE
  ) {
    currentStandbyGreeting = String(snapshot.headline);
  }
  applyProactiveSnapshot(snapshot.proactive);
  applyPendingSnapshot(snapshot.pending, snapshot.proactive);
  syncTaskWaitTimer(snapshot.task_timer ?? null);
  hydrateLocalStopwatchesFromSnapshot(snapshot);
  syncActiveTimers(extractCountdownTimersFromSnapshot(snapshot));
  renderState();
}

function formatTaskWaitClock(seconds) {
  const negative = seconds < 0;
  const total = Math.abs(Math.trunc(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  let formatted;
  if (hours > 0) {
    formatted = `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  } else {
    formatted = `${minutes}:${String(remainder).padStart(2, "0")}`;
  }
  return negative ? `-${formatted}` : formatted;
}

function getTimerTotalSeconds(timer) {
  if (!timer?.started_at || !timer?.due_at) {
    return 0;
  }
  const startedAt = Date.parse(timer.started_at);
  const dueAt = Date.parse(timer.due_at);
  if (Number.isNaN(startedAt) || Number.isNaN(dueAt)) {
    return 0;
  }
  return Math.max(0, Math.floor((dueAt - startedAt) / 1000));
}

function getTimerProgress(timer) {
  if (isStopwatchTimer(timer)) {
    return null;
  }
  const total = getTimerTotalSeconds(timer);
  if (total <= 0) {
    return null;
  }
  const remainingMs = getActiveTimerRemainingMs(timer);
  if (!Number.isFinite(remainingMs)) {
    return null;
  }
  const remaining = Math.max(0, remainingMs / 1000);
  return Math.max(0, Math.min(1, remaining / total));
}

function formatTaskTimerElapsedPhrase(elapsedSeconds, expectedSeconds) {
  if (elapsedSeconds < 60) {
    return `about ${Math.max(1, elapsedSeconds)} seconds in`;
  }
  const elapsedMinutes = Math.max(1, Math.round(elapsedSeconds / 60));
  const expectedMinutes = Math.max(1, Math.round(expectedSeconds / 60));
  return `about ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} in, up to ${expectedMinutes} minute${expectedMinutes === 1 ? "" : "s"}`;
}

function getTaskTimerElapsedSeconds(taskTimer) {
  if (!taskTimer || !taskTimer.started_at) {
    return 0;
  }
  const startedAt = Date.parse(taskTimer.started_at);
  if (Number.isNaN(startedAt)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function renderTaskWaitTimer(taskTimer) {
  if (!taskWaitTimer || !taskWaitLabel || !taskWaitClock) {
    return;
  }
  if (!taskTimer || !taskTimer.label) {
    taskWaitTimer.hidden = true;
    return;
  }
  const elapsedSeconds = getTaskTimerElapsedSeconds(taskTimer);
  const expectedSeconds = Number(taskTimer.expected_seconds) || 0;
  taskWaitLabel.textContent = taskTimer.label;
  if (expectedSeconds > 0 && elapsedSeconds >= expectedSeconds) {
    taskWaitClock.textContent = `${formatTaskWaitClock(elapsedSeconds)} / ${formatTaskWaitClock(expectedSeconds)}+`;
  } else {
    taskWaitClock.textContent = `${formatTaskWaitClock(elapsedSeconds)} / ${formatTaskWaitClock(expectedSeconds)}`;
  }
  taskWaitTimer.hidden = false;
}

function isStopwatchTimer(timer) {
  const kind = String(timer?.kind || "").toLowerCase();
  if (kind === "stopwatch") {
    return true;
  }
  if (timer?.due_at) {
    return false;
  }
  return timer?.started_at != null || timer?.created_at != null || timer?.elapsed_seconds != null;
}

function normalizeRuntimeTimer(timer) {
  if (!timer || typeof timer !== "object") {
    return null;
  }
  const normalized = { ...timer };
  const startedAt = timer.started_at || timer.created_at || null;
  if (startedAt) {
    normalized.started_at = startedAt;
  }
  if (isStopwatchTimer(normalized)) {
    normalized.kind = "stopwatch";
    delete normalized.due_at;
  } else if (normalized.due_at) {
    const kind = String(normalized.kind || "").toLowerCase();
    normalized.kind = kind === "timer" || kind === "countdown" || kind ? kind : "countdown";
  }
  return normalized;
}

function normalizeRuntimeTimers(timers) {
  return (Array.isArray(timers) ? timers : [])
    .map(normalizeRuntimeTimer)
    .filter(Boolean);
}

function extractCountdownTimersFromSnapshot(snapshot) {
  const timers = Array.isArray(snapshot?.active_timers) ? snapshot.active_timers : [];
  return extractCountdownTimers(timers);
}

function extractStopwatchSeedTimers(snapshot) {
  const timers = [];
  if (Array.isArray(snapshot?.active_stopwatches)) {
    timers.push(...snapshot.active_stopwatches);
  }
  return normalizeRuntimeTimers(timers).filter(isStopwatchTimer);
}

function isStopwatchStartedText(text) {
  return /\bstopwatch\s+started\b/i.test(String(text || ""));
}

function isTimerActivitySource(source) {
  return (
    source === "assistant.flows.timer" ||
    source === "scheduler.timers" ||
    source === "assistant.tool_runner"
  );
}

function getTimerAnnouncementKey(timer) {
  if (timer?.id !== undefined && timer?.id !== null && String(timer.id).trim()) {
    return String(timer.id);
  }
  const startedAt = timer?.started_at || timer?.created_at || "";
  if (timer?.startedAtMs != null && !Number.isNaN(Number(timer.startedAtMs))) {
    return `stopwatch:${timer?.label || "Stopwatch"}:${timer.startedAtMs}`;
  }
  return `${timer?.kind || "timer"}:${timer?.label || ""}:${startedAt}:${timer?.due_at || ""}`;
}

function isStopwatchStartMessage(message) {
  const lowered = String(message || "")
    .toLowerCase()
    .replace(/\bstop\s+watch(?:es)?\b/g, "stopwatch");
  if (!/\bstopwatch\b/.test(lowered)) {
    return false;
  }
  if (
    /\b(?:stop|cancel|delete|remove|clear|end|kill)\b/.test(lowered) &&
    !/\b(?:start|set|create|begin|add|new|make|launch|arm)\b/.test(lowered)
  ) {
    return false;
  }
  return /\b(?:start|set|create|begin|add|new|make|launch|arm)\b/.test(lowered);
}

function isStopwatchStopMessage(message) {
  const lowered = String(message || "")
    .toLowerCase()
    .replace(/\bstop\s+watch(?:es)?\b/g, "stopwatch");
  return /\bstopwatch\b/.test(lowered) && /\b(?:stop|cancel|delete|remove|clear|end|kill)\b/.test(lowered);
}

function parseStopwatchLabel(message) {
  const quoted = String(message || "").match(/"([^"]+)"/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }
  return "Stopwatch";
}

function createLocalStopwatch({ label = "Stopwatch", startedAtMs = Date.now() } = {}) {
  const startedAt = Number(startedAtMs);
  const id = `local-stopwatch-${startedAt}`;
  return {
    id,
    kind: "stopwatch",
    label: label || "Stopwatch",
    startedAtMs: startedAt,
    started_at: new Date(startedAt).toISOString(),
    local: true,
  };
}

function getLocalStopwatchTimers() {
  return Array.from(localStopwatches.values()).map((stopwatch) => ({
    ...stopwatch,
    started_at: new Date(stopwatch.startedAtMs).toISOString(),
  }));
}

function hasRecentLocalStopwatch(withinMs = 5000) {
  const now = Date.now();
  for (const stopwatch of localStopwatches.values()) {
    if (now - stopwatch.startedAtMs <= withinMs) {
      return true;
    }
  }
  return false;
}

function startLocalStopwatch({ label = "Stopwatch", startedAtMs = Date.now() } = {}) {
  if (hasRecentLocalStopwatch()) {
    refreshTimerDisplays();
    return getLocalStopwatchTimers()[0] || null;
  }
  const stopwatch = createLocalStopwatch({ label, startedAtMs });
  localStopwatches.set(getTimerAnnouncementKey(stopwatch), stopwatch);
  refreshTimerDisplays();
  return stopwatch;
}

function markStopwatchStopped(timer) {
  if (!timer) {
    return;
  }
  stoppedStopwatchKeys.add(getTimerAnnouncementKey(timer));
  if (timer.id !== undefined && timer.id !== null && String(timer.id).trim()) {
    stoppedStopwatchKeys.add(String(timer.id));
  }
  if (timer.startedAtMs != null && !Number.isNaN(Number(timer.startedAtMs))) {
    stoppedStopwatchKeys.add(`stopwatch:${timer.label || "Stopwatch"}:${timer.startedAtMs}`);
  }
}

function clearStopwatchState(timer) {
  if (!timer) {
    return;
  }
  markStopwatchStopped(timer);
  const key = getTimerAnnouncementKey(timer);
  localStopwatches.delete(key);
  for (const [entryKey, stopwatch] of [...localStopwatches.entries()]) {
    if (
      getTimerAnnouncementKey(stopwatch) === key ||
      (timer.id != null && stopwatch.id === timer.id)
    ) {
      markStopwatchStopped(stopwatch);
      localStopwatches.delete(entryKey);
    }
  }
}

function resetStopwatchesDisplay() {
  activeStopwatchesRenderSignature = "";
  if (activeStopwatchesRoot) {
    activeStopwatchesRoot.hidden = true;
    activeStopwatchesRoot.replaceChildren();
  }
  document.body.classList.remove("has-active-stopwatches");
}

function isStopwatchStopped(timer) {
  if (!timer) {
    return false;
  }
  if (stoppedStopwatchKeys.has(getTimerAnnouncementKey(timer))) {
    return true;
  }
  if (timer.id !== undefined && timer.id !== null && stoppedStopwatchKeys.has(String(timer.id))) {
    return true;
  }
  return false;
}

function stopLocalStopwatch(timer) {
  if (!timer) {
    return;
  }
  clearStopwatchState(timer);
  if (!localStopwatches.size) {
    resetStopwatchesDisplay();
  }
  refreshTimerDisplays();
}

function stopAllLocalStopwatches() {
  for (const stopwatch of localStopwatches.values()) {
    markStopwatchStopped(stopwatch);
  }
  localStopwatches.clear();
  resetStopwatchesDisplay();
  refreshTimerDisplays();
}

function hydrateLocalStopwatchesFromSnapshot(snapshot) {
  if (localStopwatches.size > 0) {
    return;
  }
  for (const timer of extractStopwatchSeedTimers(snapshot)) {
    if (isStopwatchStopped(timer)) {
      continue;
    }
    const startedAt = Date.parse(timer.started_at || timer.created_at || "");
    const stopwatch = createLocalStopwatch({
      label: timer.label || "Stopwatch",
      startedAtMs: Number.isNaN(startedAt) ? Date.now() : startedAt,
    });
    if (timer.id !== undefined && timer.id !== null) {
      stopwatch.id = String(timer.id);
    }
    localStopwatches.set(getTimerAnnouncementKey(stopwatch), stopwatch);
  }
  if (localStopwatches.size > 0) {
    refreshTimerDisplays();
  }
}

function extractCountdownTimers(timers) {
  return normalizeRuntimeTimers(timers).filter((timer) => !isStopwatchTimer(timer));
}

function buildTimerAnnouncement(timer) {
  const label = (timer?.label || "").trim();
  const defaultLabel = isStopwatchTimer(timer) ? "Stopwatch" : "Timer";
  if (label && label !== defaultLabel) {
    return `${label} timer is up.`;
  }
  return "Timer is up.";
}

function buildTimerReminder(timer) {
  const label = (timer?.label || "").trim();
  const defaultLabel = isStopwatchTimer(timer) ? "Stopwatch" : "Timer";
  if (label && label !== defaultLabel) {
    return `${label} timer is still waiting.`;
  }
  return "Your timer is still waiting.";
}

function isTimerExpired(timer) {
  if (!timer || isStopwatchTimer(timer)) {
    return false;
  }
  const key = getTimerAnnouncementKey(timer);
  if (expiredTimerKeys.has(key)) {
    return true;
  }
  const remainingMs = getActiveTimerRemainingMs(timer);
  return Number.isFinite(remainingMs) && remainingMs <= 0;
}

function markTimerExpired(timer) {
  const key = getTimerAnnouncementKey(timer);
  expiredTimerKeys.add(key);
  expiredTimerSnapshots.set(key, { ...timer });
}

function clearCountdownTimerState(timer, { suppress = false } = {}) {
  if (!timer || isStopwatchTimer(timer)) {
    return;
  }
  const key = getTimerAnnouncementKey(timer);
  currentActiveTimers = currentActiveTimers.filter(
    (entry) => getTimerAnnouncementKey(entry) !== key,
  );
  announcedTimerKeys.delete(key);
  seenActiveTimerKeys.delete(key);
  expiredTimerKeys.delete(key);
  expiredTimerSnapshots.delete(key);
  if (suppress) {
    dismissedTimerKeys.add(key);
  } else {
    dismissedTimerKeys.delete(key);
  }
  const timeout = scheduledTimerExpiryTimeouts.get(key);
  if (timeout !== undefined) {
    window.clearTimeout(timeout);
    scheduledTimerExpiryTimeouts.delete(key);
  }
  stopTimerReminders(key);
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    active_timers: [...currentActiveTimers],
  };
}

function pruneOrphanedTimerState(activeKeys) {
  for (const key of [...announcedTimerKeys]) {
    if (!activeKeys.has(key)) {
      announcedTimerKeys.delete(key);
    }
  }
  for (const key of [...seenActiveTimerKeys]) {
    if (!activeKeys.has(key)) {
      seenActiveTimerKeys.delete(key);
    }
  }
  for (const key of [...expiredTimerKeys]) {
    if (!activeKeys.has(key)) {
      expiredTimerKeys.delete(key);
    }
  }
  for (const key of [...expiredTimerSnapshots.keys()]) {
    if (!activeKeys.has(key)) {
      expiredTimerSnapshots.delete(key);
    }
  }
  for (const key of [...dismissedTimerKeys]) {
    if (!activeKeys.has(key)) {
      dismissedTimerKeys.delete(key);
    }
  }
  for (const [key, timeout] of scheduledTimerExpiryTimeouts.entries()) {
    if (!activeKeys.has(key)) {
      window.clearTimeout(timeout);
      scheduledTimerExpiryTimeouts.delete(key);
    }
  }
  for (const key of [...timerReminderIntervals.keys()]) {
    if (!activeKeys.has(key)) {
      stopTimerReminders(key);
    }
  }
}

function resetCountdownTimersDisplay() {
  activeTimersRenderSignature = "";
  if (activeTimersRoot) {
    activeTimersRoot.hidden = true;
    activeTimersRoot.replaceChildren();
  }
  document.body.classList.remove("has-active-timers");
}

function getDisplayCountdownTimers() {
  const byKey = new Map();
  for (const timer of currentActiveTimers) {
    const key = getTimerAnnouncementKey(timer);
    if (dismissedTimerKeys.has(key)) {
      continue;
    }
    byKey.set(key, timer);
    if (isTimerExpired(timer)) {
      expiredTimerSnapshots.set(key, timer);
    }
  }
  for (const [key, timer] of expiredTimerSnapshots) {
    if (!dismissedTimerKeys.has(key) && !byKey.has(key)) {
      byKey.set(key, timer);
    }
  }
  return Array.from(byKey.values());
}

function getDisplayStopwatches() {
  return getLocalStopwatchTimers().filter((stopwatch) => !isStopwatchStopped(stopwatch));
}

function stopTimerReminders(key) {
  const interval = timerReminderIntervals.get(key);
  if (!interval) {
    return;
  }
  window.clearInterval(interval);
  timerReminderIntervals.delete(key);
}

function stopAllTimerReminders() {
  for (const key of [...timerReminderIntervals.keys()]) {
    stopTimerReminders(key);
  }
}

function startTimerReminders(timer) {
  const key = getTimerAnnouncementKey(timer);
  if (timerReminderIntervals.has(key) || dismissedTimerKeys.has(key)) {
    return;
  }
  const interval = window.setInterval(() => {
    if (dismissedTimerKeys.has(key) || !expiredTimerKeys.has(key)) {
      stopTimerReminders(key);
      return;
    }
    const snapshot = expiredTimerSnapshots.get(key);
    if (!snapshot) {
      stopTimerReminders(key);
      return;
    }
    const message = buildTimerReminder(snapshot);
    setAnswer(message, { animate: false, allowDuringWorking: true });
    if (voiceAvailable) {
      void playVoice(message, { allowDuringWorking: true, skipAnswerUpdate: true });
    }
  }, TIMER_REMINDER_INTERVAL_MS);
  timerReminderIntervals.set(key, interval);
}

function acknowledgeExpiredTimer(timer) {
  clearCountdownTimerState(timer, { suppress: true });
}

function okExpiredTimer(timer) {
  acknowledgeExpiredTimer(timer);
  refreshTimerDisplays();
}

async function announceTimerExpired(timer) {
  const key = getTimerAnnouncementKey(timer);
  if (announcedTimerKeys.has(key)) {
    return;
  }
  announcedTimerKeys.add(key);
  markTimerExpired(timer);
  const message = buildTimerAnnouncement(timer);
  setAnswer(message, { animate: true, allowDuringWorking: true });
  renderState();
  if (voiceAvailable) {
    await playVoice(message, { allowDuringWorking: true });
  }
  startTimerReminders(timer);
  refreshTimerDisplays();
}

function getActiveTimerRemainingMs(timer) {
  if (!timer || isStopwatchTimer(timer) || !timer.due_at) {
    return Number.POSITIVE_INFINITY;
  }
  const dueAt = Date.parse(timer.due_at);
  if (Number.isNaN(dueAt)) {
    return Number.POSITIVE_INFINITY;
  }
  return dueAt - Date.now();
}

function clearScheduledTimerExpiries() {
  for (const timeout of scheduledTimerExpiryTimeouts.values()) {
    window.clearTimeout(timeout);
  }
  scheduledTimerExpiryTimeouts.clear();
}

function rescheduleTimerExpiries() {
  clearScheduledTimerExpiries();
  for (const timer of currentActiveTimers) {
    if (isStopwatchTimer(timer)) {
      continue;
    }
    const key = getTimerAnnouncementKey(timer);
    if (dismissedTimerKeys.has(key)) {
      continue;
    }
    const remainingMs = getActiveTimerRemainingMs(timer);
    if (remainingMs <= 0) {
      if (!expiredTimerKeys.has(key)) {
        markTimerExpired(timer);
      }
      if (seenActiveTimerKeys.has(key) && !announcedTimerKeys.has(key)) {
        void announceTimerExpired(timer);
      } else if (expiredTimerKeys.has(key)) {
        startTimerReminders(timer);
      }
      continue;
    }
    seenActiveTimerKeys.add(key);
    if (announcedTimerKeys.has(key)) {
      continue;
    }
    const timeout = window.setTimeout(() => {
      scheduledTimerExpiryTimeouts.delete(key);
      if (!announcedTimerKeys.has(key)) {
        void announceTimerExpired(timer);
      }
    }, remainingMs);
    scheduledTimerExpiryTimeouts.set(key, timeout);
  }
}

function checkExpiredTimersOnTick() {
  for (const timer of getDisplayCountdownTimers()) {
    const key = getTimerAnnouncementKey(timer);
    const remainingMs = getActiveTimerRemainingMs(timer);
    if (remainingMs > 0) {
      seenActiveTimerKeys.add(key);
      continue;
    }
    if (!expiredTimerKeys.has(key)) {
      markTimerExpired(timer);
    }
    if (seenActiveTimerKeys.has(key) && !announcedTimerKeys.has(key)) {
      void announceTimerExpired(timer);
    } else if (expiredTimerKeys.has(key)) {
      startTimerReminders(timer);
    }
  }
}

function refreshTimerDisplays() {
  refreshActiveTimersDisplay();
  refreshActiveStopwatchesDisplay();
  ensureActiveTimerTicking();
}

function refreshActiveTimersDisplay() {
  const displayTimers = getDisplayCountdownTimers();
  document.body.classList.toggle("has-active-timers", displayTimers.length > 0);
  activeTimersRenderSignature = "";
  displayActiveTimers(displayTimers);
  if (!displayTimers.length) {
    resetCountdownTimersDisplay();
    if (!getDisplayStopwatches().length) {
      clearActiveTimersInterval();
      clearScheduledTimerExpiries();
      stopAllTimerReminders();
    }
  }
}

function refreshActiveStopwatchesDisplay() {
  const stopwatches = getDisplayStopwatches();
  document.body.classList.toggle("has-active-stopwatches", stopwatches.length > 0);
  activeStopwatchesRenderSignature = "";
  displayActiveStopwatches(stopwatches);
  if (!stopwatches.length) {
    resetStopwatchesDisplay();
    if (!getDisplayCountdownTimers().length) {
      clearActiveTimersInterval();
      clearScheduledTimerExpiries();
      stopAllTimerReminders();
    }
  }
}

function ensureActiveTimerTicking() {
  if (!getDisplayCountdownTimers().length && !getDisplayStopwatches().length) {
    clearActiveTimersInterval();
    return;
  }
  if (activeTimersInterval === null) {
    tickActiveTimers();
    activeTimersInterval = window.setInterval(tickActiveTimers, ACTIVE_TIMER_TICK_MS);
  }
}

function tickActiveTimers() {
  checkExpiredTimersOnTick();
  const displayTimers = getDisplayCountdownTimers();
  const stopwatches = getDisplayStopwatches();
  document.body.classList.toggle("has-active-timers", displayTimers.length > 0);
  document.body.classList.toggle("has-active-stopwatches", stopwatches.length > 0);
  displayActiveTimers(displayTimers);
  displayActiveStopwatches(stopwatches);
  if (!displayTimers.length && !stopwatches.length) {
    clearActiveTimersInterval();
    clearScheduledTimerExpiries();
    stopAllTimerReminders();
  }
}

function getActiveTimerRemainingSeconds(timer) {
  const remainingMs = getActiveTimerRemainingMs(timer);
  if (!Number.isFinite(remainingMs)) {
    return 0;
  }
  if (remainingMs <= 0 || isTimerExpired(timer)) {
    return Math.floor(remainingMs / 1000);
  }
  return Math.ceil(remainingMs / 1000);
}

function getActiveTimerElapsedSeconds(timer) {
  if (!timer) {
    return 0;
  }
  if (isStopwatchTimer(timer)) {
    if (timer.startedAtMs != null && !Number.isNaN(Number(timer.startedAtMs))) {
      return Math.max(0, Math.floor((Date.now() - Number(timer.startedAtMs)) / 1000));
    }
    const startedAtValue = timer.started_at || timer.created_at;
    if (startedAtValue) {
      const startedAt = Date.parse(startedAtValue);
      if (!Number.isNaN(startedAt)) {
        return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      }
    }
    if (timer.elapsed_seconds != null && !Number.isNaN(Number(timer.elapsed_seconds))) {
      return Math.max(0, Math.floor(Number(timer.elapsed_seconds)));
    }
    return 0;
  }
  if (!timer.started_at && !timer.created_at) {
    return 0;
  }
  const startedAt = Date.parse(timer.started_at || timer.created_at);
  if (Number.isNaN(startedAt)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function getActiveTimerDisplaySeconds(timer) {
  if (isStopwatchTimer(timer)) {
    return getActiveTimerElapsedSeconds(timer);
  }
  return getActiveTimerRemainingSeconds(timer);
}

function renderActiveTimerItem(timer, { hero = false } = {}) {
  const item = document.createElement("article");
  const expired = isTimerExpired(timer);
  item.className = "active-timer-item";
  item.dataset.timerKey = getTimerAnnouncementKey(timer);
  if (hero) {
    item.classList.add("active-timer-item--hero");
  }
  if (isStopwatchTimer(timer)) {
    item.classList.add("active-timer-item--stopwatch");
  } else {
    item.classList.add("active-timer-item--countdown");
  }
  if (expired) {
    item.classList.add("active-timer-item--overdue");
  }

  const badge = document.createElement("span");
  badge.className = "active-timer-kind";
  badge.textContent = expired ? "Time's up" : isStopwatchTimer(timer) ? "Stopwatch" : "Timer";

  const label = (timer.label || "").trim();
  const defaultLabel = isStopwatchTimer(timer) ? "Stopwatch" : "Timer";

  const header = document.createElement("div");
  header.className = "active-timer-header";
  header.append(badge);
  if (label && label !== defaultLabel) {
    const labelEl = document.createElement("span");
    labelEl.className = "active-timer-label";
    labelEl.textContent = label;
    header.append(labelEl);
  }

  const clock = document.createElement("span");
  clock.className = "active-timer-clock";
  const displaySeconds = getActiveTimerDisplaySeconds(timer);
  clock.textContent = formatTaskWaitClock(displaySeconds);
  clock.setAttribute("role", "timer");

  const meta = document.createElement("span");
  meta.className = "active-timer-meta";
  if (expired) {
    meta.textContent = "Overdue";
  } else if (isStopwatchTimer(timer)) {
    meta.textContent = "Elapsed";
  } else {
    const total = getTimerTotalSeconds(timer);
    meta.textContent = total > 0 ? `of ${formatTaskWaitClock(total)}` : "Remaining";
  }

  item.append(header, clock, meta);

  if (expired) {
    const progress = document.createElement("div");
    progress.className = "active-timer-progress active-timer-progress--overdue";
    progress.append(document.createElement("span"));
    progress.firstElementChild.className = "active-timer-progress-indeterminate";
    item.append(progress);
  } else {
    const progressValue = getTimerProgress(timer);
    if (isStopwatchTimer(timer)) {
      const progress = document.createElement("div");
      progress.className = "active-timer-progress active-timer-progress--stopwatch";
      progress.append(document.createElement("span"));
      progress.firstElementChild.className = "active-timer-progress-indeterminate";
      item.append(progress);
    } else if (progressValue !== null) {
      const progress = document.createElement("div");
      progress.className = "active-timer-progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(Math.round(progressValue * 100)));
      const fill = document.createElement("span");
      fill.className = "active-timer-progress-fill";
      fill.style.width = `${Math.round(progressValue * 100)}%`;
      progress.append(fill);
      item.append(progress);
    }
  }

  const actions = document.createElement("div");
  actions.className = "active-timer-actions";
  const actionButton = document.createElement("button");
  actionButton.type = "button";
  actionButton.className = "active-timer-action";
  if (expired) {
    actionButton.textContent = "OK";
    actionButton.setAttribute("aria-label", "Acknowledge timer");
    actionButton.addEventListener("click", () => {
      okExpiredTimer(timer);
    });
  } else {
    actionButton.textContent = isStopwatchTimer(timer) ? "Stop" : "Cancel";
    actionButton.addEventListener("click", () => {
      if (isStopwatchTimer(timer)) {
        stopLocalStopwatch(timer);
        return;
      }
      void cancelActiveTimer(timer);
    });
  }
  actions.append(actionButton);
  item.append(actions);

  const ariaLabel = label && label !== defaultLabel ? `${label} ${clock.textContent}` : clock.textContent;
  item.setAttribute("aria-label", ariaLabel);
  return item;
}

function renderActiveTimersGrid(timers, { singleTypeMode = false } = {}) {
  const grid = document.createElement("div");
  grid.className = "active-timers-grid";
  if (singleTypeMode) {
    grid.classList.add("active-timers-grid--single-type");
  }
  for (const timer of timers) {
    grid.appendChild(renderActiveTimerItem(timer, { hero: singleTypeMode && timers.length === 1 }));
  }
  return grid;
}

let activeTimersRenderSignature = "";
let activeStopwatchesRenderSignature = "";

function getActiveTimersLayoutSignature(timers) {
  const items = Array.isArray(timers) ? timers : [];
  const itemSignature = items
    .map((timer) => `${getTimerAnnouncementKey(timer)}:${isTimerExpired(timer) ? "expired" : "active"}:countdown`)
    .join("|");
  return `grid:${itemSignature}`;
}

function getActiveStopwatchesLayoutSignature(stopwatches) {
  const items = Array.isArray(stopwatches) ? stopwatches : [];
  const itemSignature = items
    .map((timer) => `${getTimerAnnouncementKey(timer)}:stopwatch`)
    .join("|");
  return `grid:${itemSignature}`;
}

function updateActiveTimerItemElement(item, timer) {
  const clock = item.querySelector(".active-timer-clock");
  if (!clock) {
    return;
  }
  const displaySeconds = getActiveTimerDisplaySeconds(timer);
  const formattedClock = formatTaskWaitClock(displaySeconds);
  if (clock.textContent !== formattedClock) {
    clock.textContent = formattedClock;
  }

  const progressFill = item.querySelector(".active-timer-progress-fill");
  if (progressFill) {
    const progressValue = getTimerProgress(timer);
    if (progressValue !== null) {
      const percent = Math.round(progressValue * 100);
      progressFill.style.width = `${percent}%`;
      const progress = progressFill.parentElement;
      if (progress) {
        progress.setAttribute("aria-valuenow", String(percent));
      }
    }
  }

  const label = (timer.label || "").trim();
  const defaultLabel = isStopwatchTimer(timer) ? "Stopwatch" : "Timer";
  const ariaLabel = label && label !== defaultLabel ? `${label} ${formattedClock}` : formattedClock;
  if (item.getAttribute("aria-label") !== ariaLabel) {
    item.setAttribute("aria-label", ariaLabel);
  }
}

function updateActiveTimersInPlace(timers) {
  if (!activeTimersRoot) {
    return;
  }
  const itemsByKey = new Map();
  for (const item of activeTimersRoot.querySelectorAll(".active-timer-item")) {
    if (item.dataset.timerKey) {
      itemsByKey.set(item.dataset.timerKey, item);
    }
  }
  for (const timer of timers) {
    const item = itemsByKey.get(getTimerAnnouncementKey(timer));
    if (item) {
      updateActiveTimerItemElement(item, timer);
    }
  }
}

function updateActiveStopwatchesInPlace(stopwatches) {
  if (!activeStopwatchesRoot) {
    return;
  }
  const itemsByKey = new Map();
  for (const item of activeStopwatchesRoot.querySelectorAll(".active-timer-item")) {
    if (item.dataset.timerKey) {
      itemsByKey.set(item.dataset.timerKey, item);
    }
  }
  for (const timer of stopwatches) {
    const item = itemsByKey.get(getTimerAnnouncementKey(timer));
    if (item) {
      updateActiveTimerItemElement(item, timer);
    }
  }
}

function displayActiveTimers(timers) {
  if (!activeTimersRoot) {
    return;
  }
  const items = Array.isArray(timers) ? timers : [];
  const signature = getActiveTimersLayoutSignature(items);
  if (!items.length) {
    activeTimersRoot.hidden = true;
    activeTimersRoot.replaceChildren();
    activeTimersRenderSignature = "";
    return;
  }
  activeTimersRoot.hidden = false;
  if (signature === activeTimersRenderSignature && activeTimersRoot.childElementCount > 0) {
    updateActiveTimersInPlace(items);
    return;
  }
  activeTimersRenderSignature = signature;
  renderActiveTimers(items);
}

function renderActiveTimers(timers) {
  if (!activeTimersRoot) {
    return;
  }
  const items = Array.isArray(timers) ? timers : [];
  if (!items.length) {
    activeTimersRoot.hidden = true;
    activeTimersRoot.replaceChildren();
    return;
  }
  activeTimersRoot.hidden = false;
  activeTimersRoot.replaceChildren();
  activeTimersRoot.appendChild(
    renderActiveTimersGrid(items, { singleTypeMode: true }),
  );
}

function displayActiveStopwatches(stopwatches) {
  if (!activeStopwatchesRoot) {
    return;
  }
  const items = Array.isArray(stopwatches) ? stopwatches : [];
  const signature = getActiveStopwatchesLayoutSignature(items);
  if (!items.length) {
    activeStopwatchesRoot.hidden = true;
    activeStopwatchesRoot.replaceChildren();
    activeStopwatchesRenderSignature = "";
    return;
  }
  activeStopwatchesRoot.hidden = false;
  if (signature === activeStopwatchesRenderSignature && activeStopwatchesRoot.childElementCount > 0) {
    updateActiveStopwatchesInPlace(items);
    return;
  }
  activeStopwatchesRenderSignature = signature;
  renderActiveStopwatches(items);
}

function renderActiveStopwatches(stopwatches) {
  if (!activeStopwatchesRoot) {
    return;
  }
  const items = Array.isArray(stopwatches) ? stopwatches : [];
  if (!items.length) {
    activeStopwatchesRoot.hidden = true;
    activeStopwatchesRoot.replaceChildren();
    return;
  }
  activeStopwatchesRoot.hidden = false;
  activeStopwatchesRoot.replaceChildren();
  const grid = renderActiveTimersGrid(items, { singleTypeMode: true });
  grid.classList.remove("active-timers-grid");
  grid.classList.add("active-stopwatches-grid");
  activeStopwatchesRoot.appendChild(grid);
}

function clearActiveTimersInterval() {
  if (activeTimersInterval !== null) {
    window.clearInterval(activeTimersInterval);
    activeTimersInterval = null;
  }
}

function syncActiveTimers(timers) {
  const nextTimers = extractCountdownTimers(timers);
  const activeKeys = new Set(nextTimers.map((timer) => getTimerAnnouncementKey(timer)));
  currentActiveTimers = nextTimers;
  pruneOrphanedTimerState(activeKeys);
  clearScheduledTimerExpiries();
  rescheduleTimerExpiries();
  refreshTimerDisplays();
}

function clearTaskWaitTimerInterval() {
  if (taskWaitClockInterval !== null) {
    window.clearInterval(taskWaitClockInterval);
    taskWaitClockInterval = null;
  }
}

function syncTaskWaitTimer(taskTimer) {
  currentTaskTimer = taskTimer && taskTimer.label ? taskTimer : null;
  clearTaskWaitTimerInterval();
  renderTaskWaitTimer(currentTaskTimer);
  if (!currentTaskTimer) {
    return;
  }
  taskWaitClockInterval = window.setInterval(() => {
    renderTaskWaitTimer(currentTaskTimer);
  }, 1000);
}

function applyActivityEvent(event) {
  if (event.kind === "log" && event.source === "runtime.task_timer") {
    void syncRuntimeTaskTimer();
    return;
  }

  if (event.kind === "log" && isStopwatchStartedText(event.title)) {
    startLocalStopwatch({ label: (event.detail || "").trim() || "Stopwatch" });
    return;
  }

  if (event.kind === "log" && isTimerActivitySource(event.source)) {
    void syncRuntimeActiveTimers();
    return;
  }

  if (event.kind === "log" && currentActivitySnapshot.state === "working") {
    const progressLine = (event.title || "").trim();
    if (progressLine) {
      const nextState =
        currentActivitySnapshot.state === "error" ? "error" : "working";
      currentActivitySnapshot = {
        ...currentActivitySnapshot,
        state: nextState,
        headline: progressLine,
        detail: (event.detail || "").trim() || progressLine,
      };
      renderState();
    }
    return;
  }

  if (event.kind !== "state") {
    return;
  }

  const nextState = activityStates.includes(event.state) ? event.state : "standby";
  const useServerCopy = nextState === "standby" || nextState === "error";
  const nextHeadline = useServerCopy
    ? (event.title || STANDBY_HEADLINE)
    : (event.title || currentActivitySnapshot.headline);
  const nextDetail = useServerCopy
    ? (event.detail ?? STANDBY_DETAIL_DEFAULT)
    : (event.detail ?? currentActivitySnapshot.detail);
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    state: nextState,
    headline: nextHeadline,
    detail: nextDetail,
  };
  if (event.source === "proactive.presence_gate") {
    void fetchProactiveStatus();
  }
  if (event.state === "standby" || event.state === "error") {
    syncTaskWaitTimer(null);
  } else {
    void syncRuntimeTaskTimer();
  }
  renderState();
}

async function syncRuntimeTaskTimer() {
  try {
    const snapshot = await loadSnapshot();
    syncTaskWaitTimer(snapshot.task_timer ?? null);
    if (snapshot.task_timer) {
      currentActivitySnapshot = {
        ...currentActivitySnapshot,
        task_timer: snapshot.task_timer,
      };
    }
  } catch (_error) {
    return;
  }
}

async function syncRuntimeActiveTimers() {
  try {
    const snapshot = await loadSnapshot();
    hydrateLocalStopwatchesFromSnapshot(snapshot);
    const countdownTimers = extractCountdownTimersFromSnapshot(snapshot);
    syncActiveTimers(countdownTimers);
    currentActivitySnapshot = {
      ...currentActivitySnapshot,
      active_timers: countdownTimers,
    };
  } catch (_error) {
    return;
  }
}

async function fetchProactiveStatus() {
  try {
    const response = await nanoFetch("/api/proactive");
    if (!response.ok) {
      return;
    }
    const proactive = await response.json();
    applyProactiveSnapshot(proactive);
  } catch (_error) {
    return;
  }
}

async function acknowledgePresenceDismissal() {
  try {
    const response = await nanoFetch("/api/proactive/dismiss", { method: "POST" });
    if (!response.ok) {
      return;
    }
    lastHandledDismissal = null;
  } catch (_error) {
    return;
  }
}

async function syncRuntimeStatus() {
  try {
    const snapshot = await loadSnapshot();
    applyStatusSnapshot(snapshot);
  } catch (error) {
    syncTaskWaitTimer(null);
    syncActiveTimers([]);
    resetStandbySnapshot();
    replyStatus.textContent = error.message;
  }
}

function formatEvent(event) {
  const stamp = event.created_at
    ? new Date(event.created_at).toLocaleTimeString()
    : "--:--:--";
  const source = event.source || "system";
  const title = event.title || "Activity";
  const detailText = event.detail || event.state || "";
  const detailSuffix = detailText ? `\n    ${detailText}` : "";
  return `[${stamp}] ${source} | ${title}${detailSuffix}`;
}

function trackActivityEventId(event) {
  const eventId = Number(event?.id || 0);
  if (eventId > lastActivityEventId) {
    lastActivityEventId = eventId;
  }
}

function shouldShowActivityEvent(event) {
  const eventId = Number(event?.id || 0);
  return eventId > activityLogHiddenBeforeId;
}

function clearActivityLog() {
  activityLogHiddenBeforeId = lastActivityEventId;
  activityLog.value = "";
}

function refreshEvents(snapshot) {
  const events = Array.isArray(snapshot.events)
    ? snapshot.events
        .slice()
        .reverse()
        .filter((event) => {
          trackActivityEventId(event);
          return shouldShowActivityEvent(event);
        })
    : [];
  activityLog.value = events.map((event) => formatEvent(event)).join("\n\n");
  activityLog.scrollTop = activityLog.scrollHeight;
}

function appendEvent(event) {
  trackActivityEventId(event);
  if (!shouldShowActivityEvent(event)) {
    return;
  }
  const line = formatEvent(event);
  activityLog.value = activityLog.value ? `${activityLog.value}\n\n${line}` : line;
  activityLog.scrollTop = activityLog.scrollHeight;
}

function renderStorage(snapshot) {
  storageLog.value = JSON.stringify(snapshot, null, 2);
  storageLog.scrollTop = 0;
}

async function loadSnapshot() {
  const response = await nanoFetch("/api/status");
  if (!response.ok) {
    throw new Error("Could not load Nano status.");
  }
  return response.json();
}

async function loadStorage() {
  const response = await nanoFetch("/api/storage");
  if (!response.ok) {
    throw new Error("Could not load storage snapshot.");
  }
  return response.json();
}

async function bootstrap() {
  try {
    const snapshot = await loadSnapshot();
    const storage = await loadStorage();
    applyStatusSnapshot(snapshot);
    refreshEvents(snapshot);
    renderStorage(storage);
    const voiceResponse = await nanoFetch("/api/voice/status");
    if (voiceResponse.ok) {
      const voice = await voiceResponse.json();
      voiceAvailable = Boolean(voice.available);
      if (!voiceAvailable && typeof voice.detail === "string") {
        replyStatus.textContent = voice.detail;
      }
    }
    applyVoiceVolume();
    await loadAndRenderToolCommands();
    await connectMicrophoneOnStartup();
    const bootEvent = findLatestBootEvent(snapshot);
    void refreshStandbyGreeting({ speakOnce: true, bootEvent });
    const lastEventId = Array.isArray(snapshot.events)
      ? snapshot.events.reduce((maxId, event) => {
          const eventId = Number(event?.id || 0);
          return eventId > maxId ? eventId : maxId;
        }, 0)
      : 0;
    listen(lastEventId);
    if (typeof loadNanoVersionFromBackend === "function") {
      await loadNanoVersionFromBackend();
    }
  } catch (error) {
    replyStatus.textContent = error.message;
  }
}

async function refreshStorage() {
  try {
    const storage = await loadStorage();
    renderStorage(storage);
  } catch (error) {
    replyStatus.textContent = error.message;
  }
}

let activityEventSource = null;

function closeActivityEventSource() {
  if (!activityEventSource) {
    return;
  }
  activityEventSource.close();
  activityEventSource = null;
}

function listen(lastEventId = 0) {
  closeActivityEventSource();
  const source = nanoEventSource(`/api/events?since=${lastEventId}`);
  activityEventSource = source;
  source.addEventListener("activity", (event) => {
    const payload = JSON.parse(event.data);
    applyActivityEvent(payload);
    appendEvent(payload);
    refreshStorage();
  });
  source.onerror = () => {
    if (reconnectInProgress) {
      return;
    }
    stateLine.textContent = "reconnecting";
    updateEssenceState();
  };
}

