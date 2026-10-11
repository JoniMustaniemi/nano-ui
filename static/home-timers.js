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
  if (!getDisplayCountdownTimers().length) {
    clearPendingCountdownAnchor();
  }
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
  if (!timer || isStopwatchTimer(timer)) {
    return Number.POSITIVE_INFINITY;
  }
  if (timer.due_at) {
    const dueAt = Date.parse(timer.due_at);
    if (!Number.isNaN(dueAt)) {
      return dueAt - Date.now();
    }
  }
  const durationSeconds = Number(timer?.duration_seconds);
  const startedAtMs = resolveTimerStartedAtMs(timer);
  if (Number.isFinite(durationSeconds) && durationSeconds > 0 && !Number.isNaN(startedAtMs)) {
    return durationSeconds * 1000 - (Date.now() - startedAtMs);
  }
  const remainingSeconds = Number(timer?.remaining_seconds);
  if (Number.isFinite(remainingSeconds) && remainingSeconds >= 0) {
    return remainingSeconds * 1000;
  }
  return Number.POSITIVE_INFINITY;
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
      const startedAtMs = Number(timer.startedAtMs);
      if (isPlausibleStopwatchStartMs(startedAtMs)) {
        return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      }
    }
    const startedAtValue = timer.started_at || timer.created_at;
    if (startedAtValue) {
      const startedAt = Date.parse(startedAtValue);
      if (isPlausibleStopwatchStartMs(startedAt)) {
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
