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

