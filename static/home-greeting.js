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
      await playVoice(greeting);
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

function clearPendingState() {
  currentAnswerPendingKind = null;
  currentPendingSnapshot = null;
  currentInputKind = null;
  if (!waitingForPresence) {
    waitingForFollowUp = false;
    waitingForVoiceAnswer = false;
  }
  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  syncInputActions();
}

function applyPendingSnapshot(pending, proactive) {
  if (suppressPendingRearm) {
    clearPendingState();
    return;
  }
  if (!pending || typeof pending !== "object") {
    clearPendingState();
    return;
  }
  const kind = pending.kind;
  if (!kind) {
    clearPendingState();
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
