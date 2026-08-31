function applyActivityEvent(event) {
  if (
    typeof handleMeetingReminderActivityEvent === "function" &&
    handleMeetingReminderActivityEvent(event)
  ) {
    return;
  }

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

function buildPersistedStateSnapshot() {
  return {
    active_timers: getDisplayCountdownTimers().map((timer) => ({
      id: timer.id ?? null,
      label: timer.label || "Timer",
      started_at: timer.started_at ?? null,
      due_at: timer.due_at ?? null,
      remaining_seconds: timer.remaining_seconds ?? null,
    })),
    active_stopwatches: getDisplayStopwatches().map((stopwatch) => ({
      id: stopwatch.id ?? null,
      label: stopwatch.label || "Stopwatch",
      started_at: stopwatch.started_at ?? null,
      elapsed_seconds: stopwatch.elapsed_seconds ?? null,
    })),
  };
}

function refreshStorage() {
  if (typeof getActiveViewSession === "function" && getActiveViewSession() !== "storage") {
    return;
  }
  renderStorage(buildPersistedStateSnapshot());
}

const SYSTEM_METRICS_POLL_MS = 20_000;
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
  });
  source.onerror = () => {
    if (reconnectInProgress) {
      return;
    }
    stateLine.textContent = "reconnecting";
    updateEssenceState();
  };
}

