function formatVoiceVolumePercent(volume) {
  return `${Math.round(volume * 100)}%`;
}

function loadVoiceVolume() {
  try {
    const stored = window.localStorage.getItem(VOICE_VOLUME_STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_VOICE_VOLUME;
    }
    const parsed = Number(stored);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_VOICE_VOLUME;
    }
    return Math.min(1, Math.max(0, parsed));
  } catch (_error) {
    return DEFAULT_VOICE_VOLUME;
  }
}

function saveVoiceVolume(volume) {
  try {
    window.localStorage.setItem(VOICE_VOLUME_STORAGE_KEY, String(volume));
  } catch (_error) {
    return;
  }
}

function applyVoiceVolume(volume = loadVoiceVolume()) {
  const clamped = Math.min(1, Math.max(0, volume));
  voiceAudio.volume = clamped;
  if (voiceVolumeInput) {
    voiceVolumeInput.value = String(Math.round(clamped * 100));
    voiceVolumeInput.disabled = false;
  }
  if (voiceVolumeValue) {
    voiceVolumeValue.textContent = formatVoiceVolumePercent(clamped);
  }
  return clamped;
}

async function syncVoiceVolumeToServer(volume) {
  try {
    const response = await nanoFetch("/api/voice/volume", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ volume }),
    });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (typeof payload.volume === "number") {
      saveVoiceVolume(payload.volume);
    }
  } catch (_error) {
    return;
  }
}

function setVoiceVolumeFromInput(percent) {
  const volume = applyVoiceVolume(percent / 100);
  saveVoiceVolume(volume);
  void syncVoiceVolumeToServer(volume);
}

async function initVoiceVolumeControl() {
  applyVoiceVolume();
  await syncVoiceVolumeToServer(loadVoiceVolume());
  if (!voiceVolumeInput) {
    return;
  }
  voiceVolumeInput.addEventListener("input", () => {
    setVoiceVolumeFromInput(Number(voiceVolumeInput.value));
  });
}

let voiceRecorder = null;
let voiceRecorderChunks = [];
let voicePushToggle = null;
let pushToTalkActive = false;
let voiceAnswerPrompt = "Hold the mic button and speak.";

function setVoiceStatus(text) {
  if (!voiceStatus) {
    return;
  }
  voiceStatus.textContent = text;
  if (typeof renderState === "function") {
    renderState();
  }
}

function syncVoiceListeningState() {
  if (!voicePushToggle) {
    return;
  }
  voicePushToggle.setAttribute(
    "aria-pressed",
    pushToTalkActive || waitingForVoiceAnswer ? "true" : "false"
  );
}

async function connectMicrophoneOnStartup() {
  voicePushToggle = document.getElementById("voice-push-toggle");
  if (!voicePushToggle) {
    setVoiceStatus("Voice push-to-talk control is unavailable.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setVoiceStatus("Microphone access is not available in this browser.");
    return;
  }
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneReady = true;
    setVoiceStatus("Hold the mic button to talk. Processing happens on the Pi.");
    bindPushToTalkControls();
  } catch (_error) {
    setVoiceStatus("Microphone access was not granted.");
  }
}

function bindPushToTalkControls() {
  if (!voicePushToggle || voicePushToggle.dataset.bound === "true") {
    return;
  }
  voicePushToggle.dataset.bound = "true";

  const startRecording = async (event) => {
    event.preventDefault();
    if (!microphoneReady || pushToTalkActive || requestInFlight) {
      return;
    }
    await startPushToTalkRecording();
  };

  const stopRecording = (event) => {
    event.preventDefault();
    if (!pushToTalkActive) {
      return;
    }
    void stopPushToTalkRecording();
  };

  voicePushToggle.addEventListener("pointerdown", startRecording);
  voicePushToggle.addEventListener("pointerup", stopRecording);
  voicePushToggle.addEventListener("pointerleave", stopRecording);
  voicePushToggle.addEventListener("pointercancel", stopRecording);
}

async function startPushToTalkRecording() {
  if (!microphoneStream) {
    return;
  }
  voiceRecorderChunks = [];
  voiceRecorder = new MediaRecorder(microphoneStream, { mimeType: pickRecorderMimeType() });
  voiceRecorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      voiceRecorderChunks.push(event.data);
    }
  });
  pushToTalkActive = true;
  voicePushToggle.classList.add("recording");
  setVoiceStatus("Recording... release to send.");
  syncVoiceListeningState();
  voiceRecorder.start();
}

async function stopPushToTalkRecording() {
  if (!voiceRecorder || voiceRecorder.state === "inactive") {
    pushToTalkActive = false;
    if (voicePushToggle) {
      voicePushToggle.classList.remove("recording");
    }
    syncVoiceListeningState();
    return;
  }

  const recorder = voiceRecorder;
  const audioBlob = await new Promise((resolve) => {
    recorder.addEventListener(
      "stop",
      () => {
        resolve(new Blob(voiceRecorderChunks, { type: recorder.mimeType || "audio/webm" }));
      },
      { once: true }
    );
    recorder.stop();
  });

  pushToTalkActive = false;
  if (voicePushToggle) {
    voicePushToggle.classList.remove("recording");
  }
  syncVoiceListeningState();
  await sendVoiceCommand(audioBlob);
}

function pickRecorderMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/wav"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

async function sendVoiceCommand(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    setVoiceStatus("No audio captured.");
    return;
  }

  requestInFlight = true;
  await acknowledgeRequest("voice");
  setVoiceStatus("Sending audio to Nano...");
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "voice-input.webm");
    const response = await nanoFetch("/api/voice/command", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Voice command failed.");
    }

    const transcript = (data.transcript || "").trim();
    if (transcript) {
      showUserSpeech(transcript);
    }
    const answerText = data.content || "";
    const shouldSpeak = data.speak !== false;
    setAnswer(answerText, { deferClearUntilSpeech: shouldSpeak, allowDuringWorking: true });
    replyStatus.textContent = "";
    await refreshStorage();
    if (shouldSpeak && answerText) {
      await playVoice(answerText);
    }
    if (answerText) {
      const systemResponse = handleSystemCommandResponse(answerText);
      if (systemResponse.handled) {
        if (systemResponse.reconnect) {
          returnToWakeDetection();
          void beginNanoReconnect(systemResponse.kind);
          return;
        }
        returnToWakeDetection();
        return;
      }
      if (isWaitingForUserAnswer()) {
        ensureDirectAnswerListening();
        return;
      }
      const needsVoiceFollowUp = answerNeedsVoiceFollowUp(answerText);
      if (needsVoiceFollowUp) {
        const isYesNoConfirmation =
          answerNeedsYesNoConfirmation(answerText) ||
          answerText.toLowerCase().includes("reply yes to proceed or no to cancel") ||
          Boolean(pendingSystemCommandId);
        const isTimerFollowUp = answerNeedsTimerDuration(answerText);
        const followUpPrompt = isYesNoConfirmation
          ? "Reply yes to confirm or no to cancel."
          : "Hold the mic button and speak your answer.";
        armVoiceFollowUp(followUpPrompt, {
          yesNo: isYesNoConfirmation,
          inputKind: isTimerFollowUp ? "timer_duration" : null,
        });
        return;
      }
    }
    waitingForVoiceAnswer = false;
    setVoiceStatus("Hold the mic button to talk. Processing happens on the Pi.");
  } catch (error) {
    replyStatus.textContent = error.message;
    setVoiceStatus(error.message);
  } finally {
    requestInFlight = false;
    syncVoiceListeningState();
  }
}

function maybeStartListeningAfterGesture() {
  return;
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
    timer_duration: "Hold the mic and say a duration.",
    wipe_confirmation: "Hold the mic and say yes or no.",
    note_name: "Hold the mic and say the note name.",
    note_content: "Hold the mic and say the note content.",
    note_selection: "Hold the mic and say which note you meant.",
  };
  return labels[kind] || "Hold the mic button and speak your answer.";
}

function directAnswerListenStatus() {
  if (waitingForPresence) {
    return "Are you there? Hold the mic and say yes or no.";
  }
  return voiceAnswerPrompt;
}

function ensureDirectAnswerListening(statusText) {
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
    ensureDirectAnswerListening("Are you there? Hold the mic and say yes or no.");
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
  ensureDirectAnswerListening(text || "Hold the mic button and speak your answer.");
  syncInputActions();
}

function returnToWakeDetection() {
  waitingForVoiceAnswer = false;
  waitingForFollowUp = false;
  waitingForPresence = false;
  waitingForYesNoConfirmation = false;
  currentAnswerPendingKind = null;
  currentPendingSnapshot = null;
  currentInputKind = null;
  syncInputActions();
  setVoiceStatus("Hold the mic button to talk. Processing happens on the Pi.");
  syncVoiceListeningState();
  renderState();
}

function startVoiceListening() {
  setVoiceStatus("Hold the mic button to talk. Processing happens on the Pi.");
}

function stopVoiceListening() {
  waitingForVoiceAnswer = false;
  setVoiceStatus("Voice on standby.");
  syncVoiceListeningState();
}
