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
  applySystemMetrics(snapshot.system);
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

function resolveTimerStartedAtMs(timer) {
  if (timer?.startedAtMs != null && !Number.isNaN(Number(timer.startedAtMs))) {
    return Number(timer.startedAtMs);
  }
  const parsed = Date.parse(timer?.started_at || timer?.created_at || "");
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  if (timer?.elapsed_seconds != null) {
    const elapsedSeconds = Math.max(0, Math.floor(Number(timer.elapsed_seconds)));
    return Date.now() - elapsedSeconds * 1000;
  }
  return Number.NaN;
}

function getTimerAnnouncementKey(timer) {
  if (!timer) {
    return "";
  }
  if (timer.storageKey) {
    return timer.storageKey;
  }
  const id = String(timer.id || "").trim();
  if (id) {
    return id;
  }
  const startedAtMs = resolveTimerStartedAtMs(timer);
  if (!Number.isNaN(startedAtMs) && (timer.started_at || timer.created_at || timer.startedAtMs != null)) {
    return `stopwatch:${timer.label || "Stopwatch"}:${startedAtMs}`;
  }
  if (timer?.elapsed_seconds != null) {
    return `stopwatch:${timer.label || "Stopwatch"}:elapsed:${Math.max(0, Math.floor(Number(timer.elapsed_seconds)))}`;
  }
  if (!Number.isNaN(startedAtMs)) {
    return `stopwatch:${timer.label || "Stopwatch"}:${startedAtMs}`;
  }
  return `stopwatch:${timer.label || "Stopwatch"}:unknown`;
}

function computeStopwatchStorageKey(stopwatch, serverTimer = stopwatch) {
  const id = String(stopwatch?.id || serverTimer?.id || "").trim();
  if (id) {
    return id;
  }
  const startedAt = serverTimer?.started_at || serverTimer?.created_at || stopwatch?.started_at || "";
  const parsed = Date.parse(startedAt);
  if (!Number.isNaN(parsed)) {
    return `stopwatch:${stopwatch?.label || "Stopwatch"}:${parsed}`;
  }
  const elapsed = serverTimer?.elapsed_seconds ?? stopwatch?.elapsed_seconds;
  if (elapsed != null) {
    return `stopwatch:${stopwatch?.label || "Stopwatch"}:elapsed:${Math.max(0, Math.floor(Number(elapsed)))}`;
  }
  return getTimerAnnouncementKey(stopwatch);
}

function getStopwatchStoppedKeys(timer) {
  const keys = new Set();
  if (!timer) {
    return keys;
  }
  if (timer.storageKey) {
    keys.add(timer.storageKey);
  }
  const id = String(timer.id || "").trim();
  if (id) {
    keys.add(id);
  }
  const startedAtMs = resolveTimerStartedAtMs(timer);
  if (!Number.isNaN(startedAtMs)) {
    keys.add(`stopwatch:${timer.label || "Stopwatch"}:${startedAtMs}`);
  }
  const startedAt = timer?.started_at || timer?.created_at || "";
  const parsed = Date.parse(startedAt);
  if (!Number.isNaN(parsed)) {
    keys.add(`stopwatch:${timer.label || "Stopwatch"}:${parsed}`);
  }
  if (timer?.elapsed_seconds != null) {
    keys.add(
      `stopwatch:${timer.label || "Stopwatch"}:elapsed:${Math.max(0, Math.floor(Number(timer.elapsed_seconds)))}`,
    );
  }
  return keys;
}

function getStopwatchStateKeys(timer) {
  return getStopwatchStoppedKeys(timer);
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

function isClearAllTimersCommand(command) {
  return String(command?.id || "").trim().toLowerCase() === "clear_all_timers";
}

function isClearAllTimersMessage(message) {
  return /\bclear\s+all\s+timers?\b/i.test(String(message || ""));
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
  const id = String(timer?.id || timer?.serverSource?.id || "").trim();
  if (id && !id.startsWith("local-stopwatch-")) {
    stoppedStopwatchIds.add(id);
  }
  for (const key of getStopwatchStoppedKeys(timer)) {
    stoppedStopwatchKeys.add(key);
  }
  if (timer.serverSource) {
    for (const key of getStopwatchStoppedKeys(timer.serverSource)) {
      stoppedStopwatchKeys.add(key);
    }
  }
}

function resolveStopwatchStorageKey(timer) {
  if (!timer) {
    return "";
  }
  if (timer.storageKey && localStopwatches.has(timer.storageKey)) {
    return timer.storageKey;
  }
  const timerKey = getTimerAnnouncementKey(timer);
  if (localStopwatches.has(timerKey)) {
    return timerKey;
  }
  for (const [entryKey, stopwatch] of localStopwatches.entries()) {
    if (getTimerAnnouncementKey(stopwatch) === timerKey) {
      return entryKey;
    }
  }
  return timerKey;
}

function clearStopwatchState(timer) {
  if (!timer) {
    return;
  }
  markStopwatchStopped(timer);
  localStopwatches.delete(resolveStopwatchStorageKey(timer));
}

function restoreStopwatchState(stopwatch, timerKey) {
  if (!stopwatch) {
    return;
  }
  const id = String(stopwatch?.id || "").trim();
  if (id) {
    stoppedStopwatchIds.delete(id);
  }
  for (const key of getStopwatchStoppedKeys(stopwatch)) {
    stoppedStopwatchKeys.delete(key);
  }
  if (stopwatch.serverSource) {
    for (const key of getStopwatchStoppedKeys(stopwatch.serverSource)) {
      stoppedStopwatchKeys.delete(key);
    }
  }
  const storageKey = stopwatch.storageKey || resolveStopwatchStorageKey(stopwatch) || timerKey;
  if (storageKey && !localStopwatches.has(storageKey)) {
    localStopwatches.set(storageKey, { ...stopwatch });
  }
  refreshTimerDisplays();
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
  const id = String(timer?.id || timer?.serverSource?.id || "").trim();
  if (id && stoppedStopwatchIds.has(id)) {
    return true;
  }
  for (const key of getStopwatchStoppedKeys(timer)) {
    if (stoppedStopwatchKeys.has(key)) {
      return true;
    }
  }
  return false;
}

function stopLocalStopwatch(timer) {
  if (!timer) {
    return;
  }
  clearStopwatchState(timer);
  if (!getDisplayStopwatches().length) {
    resetStopwatchesDisplay();
  }
  refreshTimerDisplays();
}

function resolveStopwatchStartedAtMs(serverTimer) {
  return resolveTimerStartedAtMs(serverTimer);
}

function buildStopStopwatchMessage(timerOrId) {
  const id =
    typeof timerOrId === "object" && timerOrId !== null
      ? timerOrId?.id != null
        ? String(timerOrId.id).trim()
        : ""
      : String(timerOrId || "").trim();
  if (id) {
    return `Stop stopwatch ${id}`;
  }
  const timer = typeof timerOrId === "object" && timerOrId !== null ? timerOrId : null;
  const label = String(timer?.label || "").trim();
  const defaultLabel = "Stopwatch";
  if (label && label !== defaultLabel) {
    return `Stop the stopwatch "${label}"`;
  }
  const startedAtMs = resolveTimerStartedAtMs(timer);
  if (!Number.isNaN(startedAtMs)) {
    return `Stop the stopwatch started at ${new Date(startedAtMs).toISOString()}`;
  }
  return "Stop the stopwatch";
}

function getTimerDefaultLabel(timer) {
  return isStopwatchTimer(timer) ? "Stopwatch" : "Timer";
}

function sanitizeTimerLabel(raw, defaultLabel) {
  const stripped = String(raw || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (!stripped) {
    return defaultLabel;
  }
  return stripped.slice(0, 64);
}

function buildRenameTimerMessage(id, newLabel) {
  return `Rename timer ${id} to "${newLabel}"`;
}

function buildRenameStopwatchMessage(id, newLabel) {
  return `Rename stopwatch ${id} to "${newLabel}"`;
}

function buildCancelTimerMessage(timerOrId) {
  const id =
    typeof timerOrId === "object" && timerOrId !== null
      ? timerOrId?.id != null
        ? String(timerOrId.id).trim()
        : ""
      : String(timerOrId || "").trim();
  if (id) {
    return `Cancel timer ${id}`;
  }
  const timer = typeof timerOrId === "object" && timerOrId !== null ? timerOrId : null;
  const label = String(timer?.label || "").trim();
  if (label && label !== "Timer") {
    return `Cancel the timer "${label}"`;
  }
  const startedAtMs = resolveTimerStartedAtMs(timer);
  if (!Number.isNaN(startedAtMs)) {
    return `Cancel the timer started at ${new Date(startedAtMs).toISOString()}`;
  }
  return "Cancel the timer";
}

async function patchTimerLabel(id, label) {
  let response;
  try {
    response = await nanoFetch(`/api/timers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label }),
    });
  } catch (error) {
    throw error;
  }
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    if (!response.ok) {
      throw new Error(`Timer rename failed (${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(data.detail || `Timer rename failed (${response.status}).`);
  }
  return data;
}

async function patchStopwatchLabel(id, label) {
  let response;
  try {
    response = await nanoFetch(`/api/stopwatches/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label }),
    });
  } catch (error) {
    throw error;
  }
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    if (!response.ok) {
      throw new Error(`Stopwatch rename failed (${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(data.detail || `Stopwatch rename failed (${response.status}).`);
  }
  return data;
}

async function deleteTimerById(id) {
  const normalizedId = id != null ? String(id).trim() : "";
  if (!normalizedId) {
    throw new Error("Timer id is required.");
  }
  let response;
  try {
    response = await nanoFetch(`/api/timers/${encodeURIComponent(normalizedId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    throw error;
  }
  if (response.status === 204) {
    return;
  }
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    if (!response.ok) {
      throw new Error(`Timer cancel failed (${response.status}).`);
    }
    return;
  }
  if (!response.ok) {
    throw new Error(data.detail || `Timer cancel failed (${response.status}).`);
  }
}

function createStopwatchApiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isStopwatchNotFoundError(error) {
  return Number(error?.status) === 404;
}

async function deleteStopwatchById(id) {
  const normalizedId = id != null ? String(id).trim() : "";
  if (!normalizedId) {
    throw new Error("Stopwatch id is required.");
  }
  let response;
  try {
    response = await nanoFetch(`/api/stopwatches/${encodeURIComponent(normalizedId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    throw error;
  }
  if (response.status === 204) {
    return;
  }
  if (response.status === 404) {
    let data = {};
    try {
      data = await response.json();
    } catch (_error) {
      // Ignore parse errors for 404 bodies.
    }
    throw createStopwatchApiError(data.detail || "Stopwatch not found.", 404);
  }
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    if (!response.ok) {
      throw createStopwatchApiError(`Stopwatch stop failed (${response.status}).`, response.status);
    }
    return;
  }
  if (!response.ok) {
    throw createStopwatchApiError(
      data.detail || `Stopwatch stop failed (${response.status}).`,
      response.status,
    );
  }
}

function isCountdownTimerIdActive(timerId) {
  const normalizedId = timerId != null ? String(timerId).trim() : "";
  if (!normalizedId) {
    return false;
  }
  return currentActiveTimers.some(
    (timer) =>
      !isStopwatchTimer(timer) && timer?.id != null && String(timer.id).trim() === normalizedId,
  );
}

function isStopwatchIdActive(stopwatchId) {
  const normalizedId = stopwatchId != null ? String(stopwatchId).trim() : "";
  if (!normalizedId) {
    return false;
  }
  return currentServerStopwatches.some(
    (stopwatch) => stopwatch?.id != null && String(stopwatch.id).trim() === normalizedId,
  );
}

async function waitForServerTimerRemoved(timerId) {
  const normalizedId = timerId != null ? String(timerId).trim() : "";
  if (!normalizedId) {
    return false;
  }
  for (let attempt = 0; attempt < TIMER_SERVER_SYNC_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, TIMER_SERVER_SYNC_POLL_MS);
      });
    }
    await syncRuntimeStatus();
    if (!isCountdownTimerIdActive(normalizedId)) {
      return true;
    }
  }
  return false;
}

async function waitForServerStopwatchRemoved(stopwatchId) {
  const normalizedId = stopwatchId != null ? String(stopwatchId).trim() : "";
  if (!normalizedId) {
    return false;
  }
  for (let attempt = 0; attempt < TIMER_SERVER_SYNC_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, TIMER_SERVER_SYNC_POLL_MS);
      });
    }
    await syncRuntimeStatus();
    if (!isStopwatchIdActive(normalizedId)) {
      return true;
    }
  }
  return false;
}

function updateCountdownTimerLabel(timerKey, newLabel) {
  let changed = false;
  currentActiveTimers = currentActiveTimers.map((timer) => {
    if (getTimerAnnouncementKey(timer) !== timerKey) {
      return timer;
    }
    changed = true;
    return { ...timer, label: newLabel };
  });
  const expiredSnapshot = expiredTimerSnapshots.get(timerKey);
  if (expiredSnapshot) {
    expiredTimerSnapshots.set(timerKey, { ...expiredSnapshot, label: newLabel });
    changed = true;
  }
  if (changed) {
    refreshTimerDisplays();
  }
  return changed;
}

function updateLocalStopwatchLabel(timerKey, newLabel) {
  const storageKey = resolveStopwatchStorageKey({ storageKey: timerKey, id: timerKey });
  const entryKey = localStopwatches.has(storageKey)
    ? storageKey
    : localStopwatches.has(timerKey)
      ? timerKey
      : null;
  if (!entryKey) {
    return false;
  }
  const stopwatch = localStopwatches.get(entryKey);
  if (!stopwatch) {
    return false;
  }
  stopwatch.label = newLabel;
  if (stopwatch.serverSource) {
    stopwatch.serverSource = { ...stopwatch.serverSource, label: newLabel };
  }
  localStopwatches.set(entryKey, stopwatch);
  refreshTimerDisplays();
  return true;
}

function findCountdownTimerByKey(timerKey) {
  if (!timerKey) {
    return null;
  }
  return getDisplayCountdownTimers().find((timer) => getTimerAnnouncementKey(timer) === timerKey) || null;
}

function findCountdownTimerById(timerId) {
  const normalizedId = timerId != null ? String(timerId).trim() : "";
  if (!normalizedId) {
    return null;
  }
  return (
    currentActiveTimers.find((timer) => timer?.id != null && String(timer.id).trim() === normalizedId) ||
    Array.from(expiredTimerSnapshots.values()).find(
      (timer) => timer?.id != null && String(timer.id).trim() === normalizedId,
    ) ||
    null
  );
}

function findCountdownTimerForAction(item) {
  if (!item) {
    return null;
  }
  const timerFromId = findCountdownTimerById(item.dataset.timerId);
  if (timerFromId) {
    return timerFromId;
  }
  return findCountdownTimerByKey(item.dataset.timerKey);
}

function findActiveTimerByKey(timerKey) {
  return findStopwatchByKey(timerKey) || findCountdownTimerByKey(timerKey);
}

function createActiveTimerNameElement(timer) {
  const expired = isTimerExpired(timer);
  const defaultLabel = getTimerDefaultLabel(timer);
  const name = expired
    ? "Time's up"
    : sanitizeTimerLabel(timer.label, defaultLabel);
  const nameEl = document.createElement("span");
  nameEl.className = "active-timer-name";
  if (!expired && name === defaultLabel) {
    nameEl.classList.add("active-timer-name--default");
  }
  nameEl.textContent = name;
  if (!expired) {
    nameEl.setAttribute("role", "button");
    nameEl.tabIndex = 0;
    nameEl.setAttribute(
      "aria-label",
      isStopwatchTimer(timer) ? "Rename stopwatch" : "Rename timer",
    );
  }
  return nameEl;
}

function applyActiveTimerNameToItem(item, timer) {
  if (!item || !item.isConnected || item.classList.contains("active-timer-item--editing")) {
    return;
  }
  const expired = isTimerExpired(timer);
  const defaultLabel = getTimerDefaultLabel(timer);
  const name = expired
    ? "Time's up"
    : sanitizeTimerLabel(timer.label, defaultLabel);
  let nameEl = item.querySelector(".active-timer-name");
  if (!nameEl) {
    const header = item.querySelector(".active-timer-header");
    if (!header) {
      return;
    }
    nameEl = createActiveTimerNameElement(timer);
    header.replaceChildren(nameEl);
    return;
  }
  nameEl.textContent = name;
  nameEl.classList.toggle("active-timer-name--default", !expired && name === defaultLabel);
}

function beginActiveTimerNameEdit(item, timerKey) {
  if (!item || item.classList.contains("active-timer-item--editing")) {
    return;
  }
  const timer = findActiveTimerByKey(timerKey);
  if (!timer || isTimerExpired(timer)) {
    return;
  }
  const nameEl = item.querySelector(".active-timer-name");
  if (!nameEl) {
    return;
  }
  const defaultLabel = getTimerDefaultLabel(timer);
  const currentName = sanitizeTimerLabel(timer.label, defaultLabel);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "active-timer-name-input";
  input.value = currentName === defaultLabel ? "" : currentName;
  input.setAttribute("aria-label", isStopwatchTimer(timer) ? "Stopwatch name" : "Timer name");
  input.maxLength = 64;
  item.classList.add("active-timer-item--editing");
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished || !item.classList.contains("active-timer-item--editing")) {
      return;
    }
    finished = true;
    item.classList.remove("active-timer-item--editing");
    if (commit) {
      void commitActiveTimerNameEdit(item, timerKey, input);
    } else {
      cancelActiveTimerNameEdit(item, timerKey);
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => {
    finish(true);
  });
}

async function commitActiveTimerNameEdit(item, timerKey, input) {
  const timer = findActiveTimerByKey(timerKey);
  if (!timer) {
    return;
  }
  const defaultLabel = getTimerDefaultLabel(timer);
  const nextName = sanitizeTimerLabel(input.value, defaultLabel);
  const replacement = createActiveTimerNameElement({ ...timer, label: nextName });
  if (input.isConnected) {
    input.replaceWith(replacement);
  } else if (item.isConnected) {
    const header = item.querySelector(".active-timer-header");
    if (header && !header.querySelector(".active-timer-name")) {
      header.append(replacement);
    }
  }
  if (typeof renameActiveTimer === "function") {
    await renameActiveTimer(timer, nextName);
  } else if (isStopwatchTimer(timer)) {
    updateLocalStopwatchLabel(timerKey, nextName);
  } else {
    updateCountdownTimerLabel(timerKey, nextName);
  }
  const liveItem = item.isConnected
    ? item
    : (activeTimersRoot || activeStopwatchesRoot)?.querySelector(`[data-timer-key="${timerKey}"]`);
  const refreshedTimer = findActiveTimerByKey(timerKey);
  if (liveItem && refreshedTimer) {
    applyActiveTimerNameToItem(liveItem, refreshedTimer);
  }
}

function cancelActiveTimerNameEdit(item, timerKey) {
  const timer = findActiveTimerByKey(timerKey);
  if (!timer) {
    return;
  }
  const input = item.querySelector(".active-timer-name-input");
  const replacement = createActiveTimerNameElement(timer);
  if (input) {
    input.replaceWith(replacement);
  }
}

function handleActiveTimerNameEditTrigger(event) {
  const nameEl = event.target.closest(".active-timer-name");
  if (!nameEl || nameEl.getAttribute("role") !== "button") {
    return;
  }
  const item = nameEl.closest("[data-timer-key]");
  if (!item) {
    return;
  }
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
    return;
  }
  if (event.type === "keydown") {
    event.preventDefault();
  }
  if (event.type === "click") {
    event.preventDefault();
  }
  beginActiveTimerNameEdit(item, item.dataset.timerKey);
}

function bindActiveTimerNameEdit() {
  for (const root of [activeTimersRoot, activeStopwatchesRoot]) {
    if (!root || root.dataset.nameEditBound === "true") {
      continue;
    }
    root.dataset.nameEditBound = "true";
    root.addEventListener("click", handleActiveTimerNameEditTrigger);
    root.addEventListener("keydown", handleActiveTimerNameEditTrigger);
  }
}

function isServerBackedStopwatch(timer) {
  if (!timer) {
    return false;
  }
  if (timer.serverBacked || timer.serverSource) {
    return true;
  }
  const id = String(timer.id || "").trim();
  return Boolean(id && !id.startsWith("local-stopwatch-"));
}

function findStopwatchByKey(timerKey) {
  if (!timerKey) {
    return null;
  }
  for (const stopwatch of localStopwatches.values()) {
    if (getTimerAnnouncementKey(stopwatch) === timerKey) {
      return {
        ...stopwatch,
        started_at: new Date(stopwatch.startedAtMs).toISOString(),
      };
    }
  }
  return getDisplayStopwatches().find((stopwatch) => getTimerAnnouncementKey(stopwatch) === timerKey) || null;
}

function bindActiveTimerActions() {
  if (!activeTimersRoot || activeTimersRoot.dataset.actionsBound === "true") {
    return;
  }
  activeTimersRoot.dataset.actionsBound = "true";
  activeTimersRoot.addEventListener("click", (event) => {
    const button = event.target.closest(".active-timer-action");
    if (!button || button.disabled) {
      return;
    }
    const item = button.closest("[data-timer-key]");
    if (!item) {
      return;
    }
    const timer = findCountdownTimerForAction(item);
    if (!timer) {
      return;
    }
    const action = button.textContent.trim();
    if (action === "Cancel") {
      if (typeof cancelActiveTimer === "function") {
        void cancelActiveTimer(timer);
      }
      return;
    }
    if (action === "OK") {
      okExpiredTimer(timer);
    }
  });
}

function bindActiveStopwatchActions() {
  if (!activeStopwatchesRoot || activeStopwatchesRoot.dataset.actionsBound === "true") {
    return;
  }
  activeStopwatchesRoot.dataset.actionsBound = "true";
  activeStopwatchesRoot.addEventListener("click", (event) => {
    const button = event.target.closest(".active-timer-action");
    if (!button || button.disabled) {
      return;
    }
    const item = button.closest("[data-timer-key]");
    if (!item) {
      return;
    }
    const timer = findStopwatchByKey(item.dataset.timerKey);
    if (!timer) {
      return;
    }
    if (button.textContent.trim() === "Stop") {
      if (typeof stopActiveStopwatch === "function") {
        void stopActiveStopwatch(timer);
      } else {
        stopLocalStopwatch(timer);
      }
    }
  });
}

function stopAllLocalStopwatches() {
  for (const stopwatch of localStopwatches.values()) {
    markStopwatchStopped(stopwatch);
  }
  localStopwatches.clear();
  stoppedStopwatchIds.clear();
  resetStopwatchesDisplay();
  refreshTimerDisplays();
}

function clearAllLocalTimerState() {
  for (const stopwatch of getDisplayStopwatches()) {
    markStopwatchStopped(stopwatch);
  }
  syncActiveTimers([]);
  stopAllLocalStopwatches();
  refreshTimerDisplays();
}

function pruneOptimisticStopwatchesForServerTimer(serverTimer) {
  const serverStartedAtMs = resolveTimerStartedAtMs(serverTimer);
  const label = serverTimer?.label || "Stopwatch";
  for (const [entryKey, stopwatch] of [...localStopwatches.entries()]) {
    if (stopwatch.serverBacked) {
      continue;
    }
    if ((stopwatch.label || "Stopwatch") !== label) {
      continue;
    }
    if (Number.isNaN(serverStartedAtMs)) {
      localStopwatches.delete(entryKey);
      continue;
    }
    if (Math.abs(stopwatch.startedAtMs - serverStartedAtMs) <= 15_000) {
      localStopwatches.delete(entryKey);
    }
  }
}

function hydrateLocalStopwatchesFromSnapshot(snapshot) {
  const serverStopwatches = extractStopwatchSeedTimers(snapshot);
  currentServerStopwatches = serverStopwatches;
  if (serverStopwatches.length === 0) {
    let changed = false;
    for (const [entryKey, stopwatch] of [...localStopwatches.entries()]) {
      if (stopwatch.serverBacked) {
        localStopwatches.delete(entryKey);
        changed = true;
      }
    }
    if (changed) {
      refreshTimerDisplays();
    }
    return;
  }

  const serverKeys = new Set();
  let changed = false;

  for (const serverTimer of serverStopwatches) {
    if (isStopwatchStopped(serverTimer)) {
      continue;
    }
    const startedAtMs = resolveTimerStartedAtMs(serverTimer);
    const stopwatch = createLocalStopwatch({
      label: serverTimer.label || "Stopwatch",
      startedAtMs: Number.isNaN(startedAtMs) ? Date.now() : startedAtMs,
    });
    if (serverTimer.id !== undefined && serverTimer.id !== null) {
      stopwatch.id = String(serverTimer.id);
    }
    stopwatch.serverBacked = true;
    stopwatch.serverSource = serverTimer;
    stopwatch.storageKey = computeStopwatchStorageKey(stopwatch, serverTimer);
    const storageKey = stopwatch.storageKey;
    serverKeys.add(storageKey);
    if (localStopwatches.has(storageKey)) {
      const existing = localStopwatches.get(storageKey);
      const nextLabel = serverTimer.label || "Stopwatch";
      if (existing.label !== nextLabel || existing.serverSource !== serverTimer) {
        existing.label = nextLabel;
        existing.serverSource = serverTimer;
        localStopwatches.set(storageKey, existing);
        changed = true;
      }
      continue;
    }
    pruneOptimisticStopwatchesForServerTimer(serverTimer);
    localStopwatches.set(storageKey, stopwatch);
    changed = true;
  }

  for (const [entryKey, stopwatch] of [...localStopwatches.entries()]) {
    if (!serverKeys.has(entryKey) && stopwatch.serverBacked) {
      localStopwatches.delete(entryKey);
      changed = true;
    }
  }

  if (changed) {
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

function restoreCountdownTimerState(timer, timerKey) {
  if (!timer || isStopwatchTimer(timer)) {
    return;
  }
  const key = timerKey || getTimerAnnouncementKey(timer);
  dismissedTimerKeys.delete(key);
  if (!currentActiveTimers.some((entry) => getTimerAnnouncementKey(entry) === key)) {
    currentActiveTimers = [...currentActiveTimers, timer];
  }
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    active_timers: [...currentActiveTimers],
  };
  rescheduleTimerExpiries();
  refreshTimerDisplays();
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
  const timerId = timer?.id != null ? String(timer.id).trim() : "";
  if (timerId) {
    item.dataset.timerId = timerId;
  }
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

  const name = sanitizeTimerLabel(timer.label, getTimerDefaultLabel(timer));
  const defaultLabel = getTimerDefaultLabel(timer);

  const header = document.createElement("div");
  header.className = "active-timer-header";
  header.append(createActiveTimerNameElement(timer));

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
  } else {
    actionButton.textContent = isStopwatchTimer(timer) ? "Stop" : "Cancel";
  }
  actions.append(actionButton);
  item.append(actions);

  const ariaLabel = name && name !== defaultLabel ? `${name} ${clock.textContent}` : `${defaultLabel} ${clock.textContent}`;
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

  applyActiveTimerNameToItem(item, timer);

  const timerId = timer?.id != null ? String(timer.id).trim() : "";
  if (timerId) {
    if (item.dataset.timerId !== timerId) {
      item.dataset.timerId = timerId;
    }
  } else if (item.dataset.timerId) {
    delete item.dataset.timerId;
  }

  const name = sanitizeTimerLabel(timer.label, getTimerDefaultLabel(timer));
  const defaultLabel = getTimerDefaultLabel(timer);
  const ariaLabel = name && name !== defaultLabel ? `${name} ${formattedClock}` : `${defaultLabel} ${formattedClock}`;
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
    void syncRuntimeActiveTimers();
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

const SYSTEM_METRICS_POLL_MS = 20_000;

function formatCpuTemp(celsius) {
  return `${Number(celsius).toFixed(1)} °C`;
}

function getCpuTempBand(celsius) {
  if (celsius >= 80) {
    return "hot";
  }
  if (celsius >= 60) {
    return "warm";
  }
  return "ok";
}

function applySystemMetrics(system) {
  if (!cpuTempChip) {
    return;
  }
  const temp = system?.cpu_temperature_celsius;
  if (temp == null) {
    cpuTempChip.textContent = "";
    cpuTempChip.classList.remove("cpu-temp-chip--warm", "cpu-temp-chip--hot", "cpu-temp-chip--throttled");
    cpuTempChip.setAttribute("hidden", "");
    return;
  }
  cpuTempChip.textContent = formatCpuTemp(temp);
  cpuTempChip.classList.remove("cpu-temp-chip--warm", "cpu-temp-chip--hot", "cpu-temp-chip--throttled");
  const band = getCpuTempBand(Number(temp));
  if (band === "warm") {
    cpuTempChip.classList.add("cpu-temp-chip--warm");
  } else if (band === "hot") {
    cpuTempChip.classList.add("cpu-temp-chip--hot");
  }
  if (system?.throttled === true) {
    cpuTempChip.classList.add("cpu-temp-chip--throttled");
  }
  cpuTempChip.removeAttribute("hidden");
}

async function syncSystemMetrics() {
  try {
    const response = await nanoFetch("/api/system/metrics");
    if (!response.ok) {
      return;
    }
    applySystemMetrics(await response.json());
  } catch (_error) {
    return;
  }
}

function startSystemMetricsPolling() {
  window.setInterval(() => {
    void syncSystemMetrics();
  }, SYSTEM_METRICS_POLL_MS);
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
    bindActiveTimerActions();
    bindActiveStopwatchActions();
    bindActiveTimerNameEdit();
    startSystemMetricsPolling();
    void initWeatherOnce();
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

