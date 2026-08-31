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
  refreshStorage();
}
async function syncRuntimeStatus() {
  try {
    const snapshot = await loadSnapshot();
    applyStatusSnapshot(snapshot);
    await syncBootState(snapshot);
  } catch (error) {
    syncTaskWaitTimer(null);
    syncActiveTimers([]);
    resetStandbySnapshot();
    replyStatus.textContent = error.message;
  }
}
async function loadSnapshot() {
  const response = await nanoFetch("/api/status");
  if (!response.ok) {
    throw new Error("Could not load Nano status.");
  }
  return response.json();
}

async function bootstrap() {
  try {
    const snapshot = await loadSnapshot();
    applyStatusSnapshot(snapshot);
    await syncBootState(snapshot);
    refreshEvents(snapshot);
    if (typeof fetchVoiceStatus === "function") {
      await fetchVoiceStatus();
    }
    applyVoiceVolume();
    await loadAndRenderToolCommands();
    await connectBrowserMicrophoneIfEnabled();
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
