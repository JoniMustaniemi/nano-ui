function voiceIdleStatusMessage() {
  return voiceModeEnabled ? resolveVoiceModeStatusText() : "Voice on standby.";
}

function isVoiceStatusOverridden() {
  return (
    waitingForVoiceAnswer ||
    waitingForFollowUp ||
    waitingForPresence ||
    waitingForYesNoConfirmation
  );
}

function resolveVoiceModeDetail() {
  if (!voiceModeEnabled) {
    return "";
  }
  return microphoneReady ? VOICE_READY_DETAIL : VOICE_STARTING_DETAIL;
}

function resolveVoiceModeStatusText() {
  if (!voiceModeEnabled) {
    return "Voice on standby.";
  }
  const detail = resolveVoiceModeDetail();
  return detail ? `${VOICE_READY_HEADLINE} ${detail}` : VOICE_READY_HEADLINE;
}

function setVoiceStatus(text) {
  if (!voiceStatus) {
    return;
  }
  voiceStatus.textContent = text;
  if (typeof renderState === "function") {
    renderState();
  }
}

async function fetchVoiceStatus() {
  try {
    const response = await nanoFetch("/api/voice/status");
    if (!response.ok) {
      return null;
    }
    const status = await response.json();
    voiceAvailable = Boolean(status.available);
    if (!voiceAvailable && typeof status.detail === "string" && status.detail.trim() && replyStatus) {
      replyStatus.textContent = status.detail.trim();
    }
    return status;
  } catch (_error) {
    return null;
  }
}

async function syncVoiceListeningState() {
  await fetchVoiceStatus();
  if (!isVoiceStatusOverridden() && voiceModeEnabled) {
    setVoiceStatus(resolveVoiceModeStatusText());
  }
  if (voiceModeEnabled && microphoneReady && !shouldPauseWakeWordListening()) {
    resumeWakeWordListening();
  }
  if (typeof renderState === "function") {
    renderState();
  }
}

function maybeStartListeningAfterGesture() {
  if (!voiceModeEnabled) {
    return;
  }
  void connectBrowserMicrophoneIfEnabled({ fromGesture: true });
}

let voiceAudioContext = null;
let voiceAnalyser = null;
let voiceAnalyserBuffer = null;
let voiceLevelFrame = null;

function ensureVoiceAnalyser() {
  if (voiceAnalyser) {
    return voiceAnalyser;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  voiceAudioContext = new AudioCtx();
  const source = voiceAudioContext.createMediaElementSource(voiceAudio);
  voiceAnalyser = voiceAudioContext.createAnalyser();
  voiceAnalyser.fftSize = 512;
  voiceAnalyser.smoothingTimeConstant = 0.8;
  source.connect(voiceAnalyser);
  voiceAnalyser.connect(voiceAudioContext.destination);
  voiceAnalyserBuffer = new Uint8Array(voiceAnalyser.fftSize);
  return voiceAnalyser;
}

async function resumeVoiceAudioContext() {
  ensureVoiceAnalyser();
  if (voiceAudioContext && voiceAudioContext.state === "suspended") {
    await voiceAudioContext.resume();
  }
}

function measureVoiceLevel() {
  if (!voiceAnalyser || !voiceAnalyserBuffer) {
    return 0;
  }
  voiceAnalyser.getByteTimeDomainData(voiceAnalyserBuffer);
  let sum = 0;
  for (let index = 0; index < voiceAnalyserBuffer.length; index += 1) {
    const sample = (voiceAnalyserBuffer[index] - 128) / 128;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / voiceAnalyserBuffer.length) * 4.0);
}

function pushVoiceLevelToEssence(level) {
  if (mainEssence) {
    mainEssence.setAudioLevel(level);
  }
}

function startVoiceLevelMonitor() {
  stopVoiceLevelMonitor();
  const tick = () => {
    pushVoiceLevelToEssence(measureVoiceLevel());
    voiceLevelFrame = requestAnimationFrame(tick);
  };
  voiceLevelFrame = requestAnimationFrame(tick);
}

function stopVoiceLevelMonitor() {
  if (voiceLevelFrame) {
    cancelAnimationFrame(voiceLevelFrame);
    voiceLevelFrame = null;
  }
  pushVoiceLevelToEssence(0);
}

async function playVoice(text, options = {}) {
  const content = (text || "").trim();
  const forcePlayback = options.forcePlayback === true;
  if (content && !options.skipAnswerUpdate) {
    setAnswer(content, {
      animate: false,
      allowDuringWorking: options.allowDuringWorking === true,
      deferClearUntilSpeech: Boolean(voiceAvailable || forcePlayback),
    });
  }
  if (!content) {
    resumeAnswerClearAfterSpeech();
    return;
  }
  if (!voiceAvailable && !forcePlayback) {
    resumeAnswerClearAfterSpeech();
    return;
  }
  const playback = voicePlaybackQueue.then(() => playVoiceNow(text, options));
  voicePlaybackQueue = playback.catch(() => undefined);
  return playback;
}

async function playVoiceNow(text, options = {}) {
  const forcePlayback = options.forcePlayback === true;
  if ((!voiceAvailable && !forcePlayback) || !text.trim()) {
    return;
  }
  const keepRecognitionDuringFetch = isCoarsePointerDevice();
  if (!keepRecognitionDuringFetch) {
    pauseWakeWordListening();
  }
  clearVoiceSource();
  speakingActive = true;
  updateEssenceState();
  try {
    const response = await nanoFetch("/api/voice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.detail || "Voice playback failed.");
    }
    const blob = await response.blob();
    currentVoiceUrl = URL.createObjectURL(blob);
    voiceAudio.src = currentVoiceUrl;
    applyVoiceVolume();
    await resumeVoiceAudioContext();
    pauseWakeWordListening();
    await voiceAudio.play();
    startVoiceLevelMonitor();
    await waitForVoicePlayback();
  } catch (error) {
    replyStatus.textContent = `I answered, but voice playback failed: ${error.message}`;
  } finally {
    stopVoiceLevelMonitor();
    speakingActive = false;
    updateEssenceState();
    clearVoiceSource();
    resumeAnswerClearAfterSpeech();
    restartWakeWordListening();
  }
}

function clearVoiceSource() {
  if (currentVoiceUrl) {
    URL.revokeObjectURL(currentVoiceUrl);
    currentVoiceUrl = null;
  }
  voiceAudio.removeAttribute("src");
}

function waitForVoicePlayback() {
  return new Promise((resolve) => {
    if (voiceAudio.ended || voiceAudio.paused) {
      resolve();
      return;
    }
    voiceAudio.addEventListener("ended", resolve, { once: true });
    voiceAudio.addEventListener("error", resolve, { once: true });
  });
}

function answerNeedsYesNoConfirmation(text) {
  const lowered = text.toLowerCase();
  return lowered.includes("yes") && lowered.includes("no");
}

function answerNeedsTimerDuration(text) {
  const lowered = text.toLowerCase();
  return (
    lowered.includes("how long should the timer run") ||
    lowered.includes("didn't catch a duration") ||
    lowered.includes("how long should i set the timer") ||
    lowered.includes("what duration") ||
    (/\bhow long\b/.test(lowered) && /\btimer\b/.test(lowered)) ||
    (/\bhow many\b/.test(lowered) &&
      /\b(minute|minutes|second|seconds|hour|hours)\b/.test(lowered))
  );
}

function answerNeedsVoiceFollowUp(text) {
  const lowered = text.toLowerCase();
  return (
    answerNeedsTimerDuration(text) ||
    lowered.includes("reply yes to proceed or no to cancel") ||
    answerNeedsYesNoConfirmation(text)
  );
}

function pendingListenStatus(kind) {
  const labels = {
    timer_duration: 'Say a duration after "hey nano".',
    wipe_confirmation: 'Say yes or no after "hey nano".',
    reboot_confirmation: 'Say yes or no after "hey nano".',
    service_restart_confirmation: 'Say yes or no after "hey nano".',
  };
  return labels[kind] || 'Say your answer after "hey nano".';
}

function directAnswerListenStatus() {
  if (waitingForPresence) {
    return 'Are you there? Say yes or no after "hey nano".';
  }
  return voiceAnswerPrompt;
}

function ensureDirectAnswerListening(statusText) {
  clearPendingVoiceSubmit();
  clearPendingVoiceBuffer();
  waitingForVoiceAnswer = true;
  voiceAnswerPrompt = statusText || directAnswerListenStatus();
  setVoiceStatus(voiceAnswerPrompt);
  syncVoiceListeningState();
  renderState();
  syncInputActions();
  if (!speakingActive) {
    scheduleAnswerTimeout();
  } else {
    answerTimeoutPending = true;
  }
}

async function enterPresenceListenMode(prompt) {
  const text = (prompt || "Are you there?").trim();
  waitingForFollowUp = false;
  waitingForPresence = true;
  setYesNoConfirmationActive(true);
  setAnswer(text, { animate: false, deferClearUntilSpeech: Boolean(voiceAvailable && text) });
  renderState();
  try {
    if (voiceAvailable && text) {
      await playVoice(text);
    }
  } finally {
    if (!waitingForPresence) {
      return;
    }
    ensureDirectAnswerListening('Are you there? Say yes or no after "hey nano".');
  }
}

function exitPresenceListenMode() {
  if (!waitingForPresence) {
    return;
  }
  waitingForPresence = false;
  waitingForVoiceAnswer = false;
  renderState();
}

async function handlePresenceDismissal(message) {
  const text = (message || "").trim();
  exitPresenceListenMode();
  if (text) {
    setAnswer(text, {
      animate: false,
      deferClearUntilSpeech: Boolean(voiceAvailable),
    });
    if (voiceAvailable) {
      await playVoice(text);
    }
  }
  returnToWakeDetection();
}

function armVoiceFollowUp(text, { yesNo = false, inputKind = null } = {}) {
  if (yesNo) {
    setYesNoConfirmationActive(true);
    currentInputKind = null;
  } else {
    waitingForFollowUp = true;
    currentInputKind = inputKind;
  }
  ensureDirectAnswerListening(text || 'Say your answer after "hey nano".');
  syncInputActions();
}

function resetLocalActivityAfterVoiceResponse() {
  if (requestInFlight) {
    return;
  }
  if (currentActivitySnapshot.state === "working") {
    currentActivitySnapshot = {
      ...currentActivitySnapshot,
      state: "standby",
      detail: null,
    };
  }
}

function returnToWakeDetection() {
  waitingForVoiceAnswer = false;
  waitingForFollowUp = false;
  waitingForPresence = false;
  waitingForYesNoConfirmation = false;
  currentAnswerPendingKind = null;
  currentPendingSnapshot = null;
  currentInputKind = null;
  suppressPendingRearm = false;
  clearPendingVoiceSubmit();
  clearPendingVoiceBuffer();
  resetWakeCommandWindow();
  clearRecentVoiceSegments();
  lastInterimWakeCheck = { text: "", at: 0 };
  syncInputActions();
  resetLocalActivityAfterVoiceResponse();
  clearDebugVoiceCapture();
  if (voiceModeEnabled) {
    setVoiceStatus(resolveVoiceModeStatusText());
    restartWakeWordListening();
  } else {
    setVoiceStatus(voiceIdleStatusMessage());
  }
  void syncVoiceListeningState();
  renderState();
}
