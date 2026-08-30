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

function extractStopwatchSeedTimers(snapshot) {
  const timers = [];
  if (Array.isArray(snapshot?.active_stopwatches)) {
    timers.push(...snapshot.active_stopwatches);
  }
  return normalizeRuntimeTimers(timers).filter(isStopwatchTimer);
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

function buildRenameStopwatchMessage(id, newLabel) {
  return `Rename stopwatch ${id} to "${newLabel}"`;
}
function createStopwatchApiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isStopwatchNotFoundError(error) {
  return Number(error?.status) === 404;
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

function getDisplayStopwatches() {
  return getLocalStopwatchTimers().filter((stopwatch) => !isStopwatchStopped(stopwatch));
}

