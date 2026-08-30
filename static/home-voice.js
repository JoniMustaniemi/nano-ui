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

async function loadVoiceVolumeFromServer() {
  try {
    const response = await nanoFetch("/api/voice/volume");
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (typeof payload.volume === "number") {
      return Math.min(1, Math.max(0, payload.volume));
    }
  } catch (_error) {
    return null;
  }
  return null;
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
  const serverVolume = await loadVoiceVolumeFromServer();
  applyVoiceVolume(serverVolume ?? loadVoiceVolume());
  if (serverVolume !== null) {
    saveVoiceVolume(serverVolume);
  }
  await syncVoiceVolumeToServer(loadVoiceVolume());
  if (!voiceVolumeInput) {
    return;
  }
  voiceVolumeInput.addEventListener("input", () => {
    setVoiceVolumeFromInput(Number(voiceVolumeInput.value));
  });
}

function loadVoiceModeEnabled() {
  try {
    return window.localStorage.getItem(VOICE_MODE_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function saveVoiceModeEnabled(enabled) {
  try {
    window.localStorage.setItem(VOICE_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch (_error) {
    return;
  }
}

function syncVoiceModeToggleUi() {
  if (voiceModeOnBtn) {
    voiceModeOnBtn.classList.toggle("active", voiceModeEnabled);
    voiceModeOnBtn.setAttribute("aria-pressed", voiceModeEnabled ? "true" : "false");
  }
  if (voiceModeOffBtn) {
    voiceModeOffBtn.classList.toggle("active", !voiceModeEnabled);
    voiceModeOffBtn.setAttribute("aria-pressed", !voiceModeEnabled ? "true" : "false");
  }
}

const WAKE_WORD_PATTERN = /\b(?:hey|hay|hi)\s*,?\s*(?:nano|nanno|nana|nah no|na no)\b/i;
const WAKE_FRAGMENT_PATTERN = /^(?:hey|hay|hi|nano|nanno|nana|nah no|na no)$/i;
const VOICE_SEGMENT_BUFFER_MS = 3500;
const VOICE_RECOGNITION_LANG = "en-US";
const WAKE_COMMAND_GRACE_MS = 800;

let wakeWordRecognition = null;
let recognitionPaused = false;
let wakeWordRestartTimer = null;
let lastVoiceSubmission = { text: "", at: 0 };
let wakeCommandArmed = false;
let wakeCommandArmedUntil = 0;
let wakeCommandArmedAt = 0;
let recentVoiceSegments = [];
let microphoneStream = null;

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function resetWakeCommandWindow() {
  wakeCommandArmed = false;
  wakeCommandArmedUntil = 0;
  wakeCommandArmedAt = 0;
  waitingForWakeCommand = false;
}

function armWakeCommandWindow() {
  wakeCommandArmed = true;
  wakeCommandArmedAt = Date.now();
  wakeCommandArmedUntil = wakeCommandArmedAt + WAKE_COMMAND_WINDOW_MS;
  waitingForWakeCommand = true;
}

function normalizeArmedVoiceCommand(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return null;
  }
  const wakeMatch = trimmed.match(WAKE_WORD_PATTERN);
  if (wakeMatch) {
    const afterWake = textAfterWakeWord(trimmed, wakeMatch);
    return afterWake || null;
  }
  if (WAKE_FRAGMENT_PATTERN.test(trimmed)) {
    return null;
  }
  if (trimmed.length < 3) {
    return null;
  }
  if (/^(?:um+|uh+|hmm+)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function clearRecentVoiceSegments() {
  recentVoiceSegments = [];
}

function pruneRecentVoiceSegments(now = Date.now()) {
  recentVoiceSegments = recentVoiceSegments.filter(
    (segment) => now - segment.at <= VOICE_SEGMENT_BUFFER_MS,
  );
}

function pushRecentVoiceSegment(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return;
  }
  const now = Date.now();
  pruneRecentVoiceSegments(now);
  recentVoiceSegments.push({ text: trimmed, at: now });
}

function combinedRecentVoiceText() {
  pruneRecentVoiceSegments();
  return recentVoiceSegments.map((segment) => segment.text).join(" ");
}

function voiceTranscriptCandidates(transcript) {
  const text = (transcript || "").trim();
  if (!text) {
    return [];
  }
  const candidates = [text];
  const combined = combinedRecentVoiceText();
  if (combined && combined !== text && !candidates.includes(combined)) {
    candidates.unshift(combined);
  }
  if (recentVoiceSegments.length > 0) {
    const previous = recentVoiceSegments[recentVoiceSegments.length - 1].text;
    if (previous.toLowerCase() !== text.toLowerCase()) {
      const withPrevious = `${previous} ${text}`.trim();
      if (withPrevious && !candidates.includes(withPrevious)) {
        candidates.unshift(withPrevious);
      }
    }
  }
  return candidates;
}

function isWakeWordOnlyMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return true;
  }
  if (WAKE_FRAGMENT_PATTERN.test(trimmed)) {
    return true;
  }
  const match = trimmed.match(WAKE_WORD_PATTERN);
  if (!match) {
    return false;
  }
  return !textAfterWakeWord(trimmed, match);
}

function acknowledgeWakeWordOnly() {
  if (!isVoiceStatusOverridden()) {
    setVoiceStatus('Heard "hey nano". What can I help with?');
  }
  renderState();
}

function textAfterWakeWord(text, match) {
  return text.slice(match.index + match[0].length).replace(/^[\s,.:;-]+/, "").trim();
}

function acceptsVoiceWithoutWakeWord() {
  return (
    waitingForVoiceAnswer ||
    waitingForFollowUp ||
    waitingForPresence ||
    waitingForYesNoConfirmation
  );
}

function extractVoiceCommand(transcript) {
  const text = (transcript || "").trim();
  if (!text) {
    return null;
  }
  if (acceptsVoiceWithoutWakeWord()) {
    resetWakeCommandWindow();
    clearRecentVoiceSegments();
    return text;
  }

  const now = Date.now();
  if (wakeCommandArmed) {
    if (now <= wakeCommandArmedUntil) {
      if (now - wakeCommandArmedAt < WAKE_COMMAND_GRACE_MS) {
        return null;
      }
      const command = normalizeArmedVoiceCommand(text);
      if (!command) {
        return null;
      }
      resetWakeCommandWindow();
      clearRecentVoiceSegments();
      return command;
    }
    resetWakeCommandWindow();
  }

  for (const candidate of voiceTranscriptCandidates(text)) {
    const match = candidate.match(WAKE_WORD_PATTERN);
    if (!match) {
      continue;
    }
    const command = textAfterWakeWord(candidate, match);
    if (command) {
      if (isWakeWordOnlyMessage(command)) {
        armWakeCommandWindow();
        acknowledgeWakeWordOnly();
        clearRecentVoiceSegments();
        return null;
      }
      resetWakeCommandWindow();
      clearRecentVoiceSegments();
      return command;
    }
    armWakeCommandWindow();
    clearRecentVoiceSegments();
    acknowledgeWakeWordOnly();
    return null;
  }

  return null;
}

function shouldIgnoreDuplicateVoiceMessage(message) {
  const now = Date.now();
  if (message === lastVoiceSubmission.text && now - lastVoiceSubmission.at < 4000) {
    return true;
  }
  lastVoiceSubmission = { text: message, at: now };
  return false;
}

function shouldPauseWakeWordListening() {
  if (!voiceModeEnabled || recognitionPaused) {
    return true;
  }
  if (requestInFlight || speakingActive) {
    return true;
  }
  if (typeof getDisplayState === "function" && getDisplayState() === "working") {
    return true;
  }
  return false;
}

function clearWakeWordRestartTimer() {
  if (wakeWordRestartTimer !== null) {
    window.clearTimeout(wakeWordRestartTimer);
    wakeWordRestartTimer = null;
  }
}

function stopWakeWordRecognition() {
  clearWakeWordRestartTimer();
  if (!wakeWordRecognition) {
    return;
  }
  try {
    wakeWordRecognition.stop();
  } catch (_error) {
    return;
  }
  wakeWordRecognition = null;
}

function scheduleWakeWordRestart(delayMs = 300) {
  clearWakeWordRestartTimer();
  if (shouldPauseWakeWordListening()) {
    return;
  }
  wakeWordRestartTimer = window.setTimeout(() => {
    wakeWordRestartTimer = null;
    startWakeWordRecognition();
  }, delayMs);
}

function startWakeWordRecognition() {
  if (shouldPauseWakeWordListening() || wakeWordRecognition) {
    return false;
  }
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    return false;
  }

  const recognition = new SpeechRecognition();
  wakeWordRecognition = recognition;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = VOICE_RECOGNITION_LANG;

  recognition.onstart = () => {
    microphoneReady = true;
    if (!isVoiceStatusOverridden()) {
      setVoiceStatus(resolveVoiceModeStatusText());
    }
    renderState();
  };

  recognition.onresult = (event) => {
    let pendingFinal = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = (result[0]?.transcript || "").trim();
      if (!transcript) {
        continue;
      }
      if (result.isFinal) {
        pendingFinal = pendingFinal ? `${pendingFinal} ${transcript}` : transcript;
      }
    }
    if (pendingFinal) {
      void handleVoiceTranscript(pendingFinal);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      microphoneReady = false;
      setVoiceStatus("Microphone access was not granted.");
      renderState();
      return;
    }
    if (event.error !== "aborted" && event.error !== "no-speech") {
      replyStatus.textContent = `Speech recognition failed: ${event.error}`;
    }
  };

  recognition.onend = () => {
    wakeWordRecognition = null;
    scheduleWakeWordRestart();
  };

  try {
    recognition.start();
    return true;
  } catch (_error) {
    wakeWordRecognition = null;
    scheduleWakeWordRestart(800);
    return false;
  }
}

function pauseWakeWordListening() {
  recognitionPaused = true;
  stopWakeWordRecognition();
}

function resumeWakeWordListening() {
  recognitionPaused = false;
  if (!voiceModeEnabled) {
    return;
  }
  if (shouldPauseWakeWordListening()) {
    scheduleWakeWordRestart(500);
    return;
  }
  startWakeWordRecognition();
}

function releaseMicrophoneStream() {
  if (!microphoneStream) {
    return;
  }
  for (const track of microphoneStream.getTracks()) {
    track.stop();
  }
  microphoneStream = null;
}

async function ensureMicrophonePermission() {
  if (microphoneStream) {
    return true;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return true;
  }
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (_error) {
    microphoneReady = false;
    setVoiceStatus("Microphone access was not granted.");
    renderState();
    return false;
  }
}

function releaseMicrophone() {
  pauseWakeWordListening();
  resetWakeCommandWindow();
  clearRecentVoiceSegments();
  microphoneReady = false;
  releaseMicrophoneStream();
}

async function handleVoiceTranscript(transcript) {
  if (requestInFlight || speakingActive) {
    return;
  }
  const message = extractVoiceCommand(transcript);
  pushRecentVoiceSegment(transcript);
  if (!message || shouldIgnoreDuplicateVoiceMessage(message)) {
    return;
  }
  if (isWakeWordOnlyMessage(message)) {
    armWakeCommandWindow();
    acknowledgeWakeWordOnly();
    return;
  }
  if (typeof submitMessage !== "function") {
    return;
  }
  pauseWakeWordListening();
  try {
    await submitMessage(message, "voice");
  } finally {
    resumeWakeWordListening();
  }
}

async function connectBrowserMicrophone() {
  if (!voiceModeEnabled) {
    releaseMicrophone();
    return false;
  }
  if (!getSpeechRecognitionConstructor()) {
    setVoiceStatus("Speech recognition is not available in this browser.");
    return false;
  }
  if (!(await ensureMicrophonePermission())) {
    return false;
  }
  recognitionPaused = false;
  if (startWakeWordRecognition()) {
    return true;
  }
  scheduleWakeWordRestart(500);
  return true;
}

async function connectBrowserMicrophoneIfEnabled() {
  if (!voiceModeEnabled) {
    return;
  }
  await connectBrowserMicrophone();
}

async function setVoiceModeEnabled(enabled, { persist = true } = {}) {
  const nextEnabled = Boolean(enabled);

  if (!nextEnabled) {
    voiceModeEnabled = false;
    releaseMicrophone();
    if (persist) {
      saveVoiceModeEnabled(false);
    }
    syncVoiceModeToggleUi();
    setVoiceStatus("Voice on standby.");
    if (typeof restoreBaseAnswer === "function") {
      restoreBaseAnswer();
    }
    renderState();
    return;
  }

  voiceModeEnabled = true;
  syncVoiceModeToggleUi();
  if (!getSpeechRecognitionConstructor()) {
    voiceModeEnabled = false;
    if (persist) {
      saveVoiceModeEnabled(false);
    }
    syncVoiceModeToggleUi();
    setVoiceStatus("Speech recognition is not available in this browser.");
    renderState();
    return;
  }
  if (persist) {
    saveVoiceModeEnabled(true);
  }
  await connectBrowserMicrophone();
  if (!isVoiceStatusOverridden()) {
    setVoiceStatus(
      microphoneReady ? resolveVoiceModeStatusText() : `${VOICE_READY_HEADLINE} ${VOICE_STARTING_DETAIL}`,
    );
  }
  renderState();
}

function initVoiceModeControl() {
  voiceModeEnabled = loadVoiceModeEnabled();
  syncVoiceModeToggleUi();
  if (voiceModeOnBtn && voiceModeOnBtn.dataset.bound !== "true") {
    voiceModeOnBtn.dataset.bound = "true";
    voiceModeOnBtn.addEventListener("click", () => {
      void setVoiceModeEnabled(true);
    });
  }
  if (voiceModeOffBtn && voiceModeOffBtn.dataset.bound !== "true") {
    voiceModeOffBtn.dataset.bound = "true";
    voiceModeOffBtn.addEventListener("click", () => {
      void setVoiceModeEnabled(false);
    });
  }
  if (voiceModeEnabled) {
    void connectBrowserMicrophoneIfEnabled();
  }
}

let voiceAnswerPrompt = 'Say your answer after "hey nano".';

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
  if (voiceModeEnabled && !shouldPauseWakeWordListening()) {
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
  void connectBrowserMicrophoneIfEnabled();
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
  pauseWakeWordListening();
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
    resumeWakeWordListening();
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

function returnToWakeDetection() {
  waitingForVoiceAnswer = false;
  waitingForFollowUp = false;
  waitingForPresence = false;
  waitingForYesNoConfirmation = false;
  currentAnswerPendingKind = null;
  currentPendingSnapshot = null;
  currentInputKind = null;
  resetWakeCommandWindow();
  syncInputActions();
  if (voiceModeEnabled) {
    setVoiceStatus(resolveVoiceModeStatusText());
    resumeWakeWordListening();
  } else {
    setVoiceStatus(voiceIdleStatusMessage());
  }
  void syncVoiceListeningState();
  renderState();
}
