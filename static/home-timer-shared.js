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


function getCountdownAnchor(timer) {
  if (timer?.client_countdown?.durationSeconds > 0) {
    return timer.client_countdown;
  }
  return pendingCountdownAnchor;
}

function shouldApplyCountdownAnchor(timer, anchor) {
  if (!timer || isStopwatchTimer(timer) || !anchor?.durationSeconds) {
    return false;
  }
  if (timer?.client_countdown?.durationSeconds > 0) {
    return true;
  }
  const startedAtMs = resolveTimerStartedAtMs(timer);
  if (Number.isNaN(startedAtMs)) {
    return true;
  }
  return startedAtMs <= anchor.startedAtMs + 2000;
}

function reconcileCountdownTimer(timer) {
  if (!timer || isStopwatchTimer(timer)) {
    return timer;
  }
  const anchor = getCountdownAnchor(timer);
  let next = { ...timer };
  if (anchor && shouldApplyCountdownAnchor(timer, anchor)) {
    const startedAtMs = anchor.startedAtMs;
    const durationSeconds = Math.max(1, Math.floor(Number(anchor.durationSeconds)));
    next = {
      ...next,
      started_at: new Date(startedAtMs).toISOString(),
      due_at: new Date(startedAtMs + durationSeconds * 1000).toISOString(),
      duration_seconds: durationSeconds,
      client_countdown: { startedAtMs, durationSeconds },
    };
  } else if (next.duration_seconds == null || Number(next.duration_seconds) <= 0) {
    const inferred = inferTimerDurationSeconds(next);
    if (inferred > 0) {
      next.duration_seconds = inferred;
    }
  }
  return next;
}

function inferTimerDurationSeconds(timer) {
  const explicit = Number(timer?.duration_seconds);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  if (!timer?.started_at || !timer?.due_at) {
    return 0;
  }
  const startedAt = Date.parse(timer.started_at);
  const dueAt = Date.parse(timer.due_at);
  if (Number.isNaN(startedAt) || Number.isNaN(dueAt)) {
    return 0;
  }
  return Math.max(0, Math.round((dueAt - startedAt) / 1000));
}

function isOptimisticCountdownTimer(timer) {
  if (!timer || isStopwatchTimer(timer)) {
    return false;
  }
  if (timer.local) {
    return true;
  }
  const id = timer?.id != null ? String(timer.id).trim() : "";
  return id.startsWith("optimistic-countdown-");
}

function isSameCountdownSession(serverTimer, localTimer) {
  if (!serverTimer || !localTimer) {
    return false;
  }
  const serverId = String(serverTimer.id || "").trim();
  const localId = String(localTimer.id || "").trim();
  if (serverId && localId && serverId === localId) {
    return true;
  }
  const localAnchor = localTimer.client_countdown;
  if (!localAnchor) {
    return false;
  }
  const serverStart = resolveTimerStartedAtMs(serverTimer);
  if (Number.isNaN(serverStart)) {
    return true;
  }
  return (
    serverStart <= localAnchor.startedAtMs + 2000 ||
    Math.abs(serverStart - localAnchor.startedAtMs) <= 120_000
  );
}

function mergeCountdownTimersFromServer(serverTimers) {
  const reconciled = extractCountdownTimers(serverTimers).map((timer) => {
    const timerId = timer?.id != null ? String(timer.id).trim() : "";
    if (timerId && !timer.client_countdown) {
      const existing = currentActiveTimers.find(
        (entry) => entry?.id != null && String(entry.id).trim() === timerId,
      );
      if (existing?.client_countdown?.durationSeconds > 0) {
        return reconcileCountdownTimer({
          ...timer,
          client_countdown: existing.client_countdown,
        });
      }
    }
    return reconcileCountdownTimer(timer);
  });
  const locals = currentActiveTimers.filter(
    (timer) => !isStopwatchTimer(timer) && isOptimisticCountdownTimer(timer),
  );
  const merged = [...reconciled];
  for (const local of locals) {
    if (reconciled.some((serverTimer) => isSameCountdownSession(serverTimer, local))) {
      continue;
    }
    const anchor = local.client_countdown;
    if (
      anchor &&
      reconciled.some(
        (serverTimer) =>
          serverTimer?.client_countdown?.startedAtMs === anchor.startedAtMs &&
          serverTimer?.client_countdown?.durationSeconds === anchor.durationSeconds,
      )
    ) {
      continue;
    }
    merged.push(reconcileCountdownTimer(local));
  }
  return merged;
}

function clearPendingCountdownAnchor() {
  pendingCountdownAnchor = null;
}

function getTimerTotalSeconds(timer) {
  const anchored = Number(timer?.duration_seconds);
  if (Number.isFinite(anchored) && anchored > 0) {
    return Math.floor(anchored);
  }
  if (!timer?.started_at || !timer?.due_at) {
    return 0;
  }
  const startedAt = Date.parse(timer.started_at);
  const dueAt = Date.parse(timer.due_at);
  if (Number.isNaN(startedAt) || Number.isNaN(dueAt)) {
    return 0;
  }
  return Math.max(0, Math.round((dueAt - startedAt) / 1000));
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

const MIN_PLAUSIBLE_STOPWATCH_START_MS = Date.UTC(2020, 0, 1);

function isPlausibleStopwatchStartMs(value) {
  return Number.isFinite(value) && value >= MIN_PLAUSIBLE_STOPWATCH_START_MS;
}

function resolveTimerStartedAtMs(timer) {
  if (timer?.startedAtMs != null && !Number.isNaN(Number(timer.startedAtMs))) {
    const startedAtMs = Number(timer.startedAtMs);
    if (isStopwatchTimer(timer) && !isPlausibleStopwatchStartMs(startedAtMs)) {
      return Number.NaN;
    }
    return startedAtMs;
  }
  const parsed = Date.parse(timer?.started_at || timer?.created_at || "");
  if (!Number.isNaN(parsed)) {
    if (isStopwatchTimer(timer) && !isPlausibleStopwatchStartMs(parsed)) {
      return Number.NaN;
    }
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
