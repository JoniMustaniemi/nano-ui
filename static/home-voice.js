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
  const supported = isVoiceRecognitionSupported();
  if (voiceModeOnBtn) {
    voiceModeOnBtn.classList.toggle("active", voiceModeEnabled);
    voiceModeOnBtn.setAttribute("aria-pressed", voiceModeEnabled ? "true" : "false");
    voiceModeOnBtn.disabled = !supported;
  }
  if (voiceModeOffBtn) {
    voiceModeOffBtn.classList.toggle("active", !voiceModeEnabled);
    voiceModeOffBtn.setAttribute("aria-pressed", !voiceModeEnabled ? "true" : "false");
  }
}

function setVoiceSupportNotice(text) {
  if (!voiceSupportNotice) {
    return;
  }
  const message = (text || "").trim();
  if (!message) {
    voiceSupportNotice.hidden = true;
    voiceSupportNotice.textContent = "";
    return;
  }
  voiceSupportNotice.hidden = false;
  voiceSupportNotice.textContent = message;
}

function resolveVoiceRecognitionErrorMessage(errorCode) {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was not granted.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a network connection.";
    case "language-not-supported":
      return "Speech recognition is not available for this language.";
    default:
      return `Speech recognition failed: ${errorCode}`;
  }
}

function reportVoiceRecognitionError(errorCode) {
  const message = resolveVoiceRecognitionErrorMessage(errorCode);
  if (
    errorCode === "not-allowed" ||
    errorCode === "service-not-allowed" ||
    errorCode === "audio-capture"
  ) {
    stopVoiceInputStream();
    microphoneReady = false;
  }
  setVoiceSupportNotice(message);
  setVoiceStatus(message);
  renderState();
}

function isVoiceInputStreamActive() {
  if (!voiceInputStream) {
    return false;
  }
  return voiceInputStream
    .getAudioTracks()
    .some((track) => track.readyState === "live" && track.enabled);
}

function stopVoiceInputStream() {
  if (!voiceInputStream) {
    return;
  }
  for (const track of voiceInputStream.getTracks()) {
    track.stop();
  }
  voiceInputStream = null;
}

async function ensureVoiceInputStream() {
  if (isVoiceInputStreamActive()) {
    return true;
  }
  stopVoiceInputStream();
  if (!navigator.mediaDevices?.getUserMedia) {
    reportVoiceRecognitionError("audio-capture");
    return false;
  }
  try {
    voiceInputStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneReady = true;
    return true;
  } catch (error) {
    const name = String(error?.name || "");
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      reportVoiceRecognitionError("not-allowed");
      return false;
    }
    reportVoiceRecognitionError("audio-capture");
    return false;
  }
}

const WAKE_GREETINGS = ["hey", "hay", "hi"];
const WAKE_NAME_ALIAS_PATTERNS = [
  "nano",
  "nanno",
  "nana",
  "nanna",
  "neno",
  "nono",
  "nah\\s+no",
  "na\\s+no",
  "no\\s+no",
  "na\\s+nah",
  "nay\\s+no",
];
const WAKE_GREETING_PATTERN = WAKE_GREETINGS.join("|");
const WAKE_NAME_PATTERN = WAKE_NAME_ALIAS_PATTERNS.join("|");
const WAKE_WORD_PATTERN = new RegExp(
  `\\b(?:${WAKE_GREETING_PATTERN})\\s*,?\\s*(?:${WAKE_NAME_PATTERN})\\b`,
  "i",
);
const WAKE_NAME_ONLY_PATTERN = new RegExp(`^(?:${WAKE_NAME_PATTERN})$`, "i");
const WAKE_NAME_PREFIX_PATTERN = new RegExp(`^(?:${WAKE_NAME_PATTERN})\\b`, "i");
const WAKE_FRAGMENT_PATTERN = new RegExp(
  `^(?:${WAKE_GREETING_PATTERN}|${WAKE_NAME_PATTERN})$`,
  "i",
);

function matchWakeWordPrefix(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return null;
  }
  const greetingMatch = trimmed.match(WAKE_WORD_PATTERN);
  if (greetingMatch) {
    return greetingMatch;
  }
  return trimmed.match(WAKE_NAME_PREFIX_PATTERN);
}
const VOICE_SEGMENT_BUFFER_MS = 3500;
const VOICE_RECOGNITION_LANG = "en-US";
const WAKE_COMMAND_GRACE_MS = 800;
const PENDING_VOICE_DEBOUNCE_MS = 900;
const MOBILE_RECOGNITION_RESTART_MIN_MS = 2500;

let wakeWordRecognition = null;
let voiceInputStream = null;
let recognitionPaused = false;
let wakeWordRestartTimer = null;
let pendingVoiceSubmitTimer = null;
let lastRecognitionStartAt = 0;
let lastVoiceSubmission = { text: "", at: 0 };
let wakeCommandArmed = false;
let wakeCommandArmedUntil = 0;
let wakeCommandArmedAt = 0;
let recentVoiceSegments = [];
let lastInterimWakeCheck = { text: "", at: 0 };
let pendingVoiceBuffer = "";

const VOICE_UNSUPPORTED_MESSAGE =
  "Voice commands require Chrome or Safari. This browser does not support speech recognition yet.";
const VOICE_INSECURE_CONTEXT_MESSAGE =
  "Voice commands require a secure connection (HTTPS).";

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isVoiceRecognitionSupported() {
  if (!window.isSecureContext) {
    return false;
  }
  return Boolean(getSpeechRecognitionConstructor());
}

function isCoarsePointerDevice() {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch (_error) {
    return false;
  }
}

function shouldKeepRecognitionAliveDuringSubmit() {
  return isCoarsePointerDevice();
}

function ensureWakeWordListeningActive() {
  if (!voiceModeEnabled || shouldPauseWakeWordListening()) {
    return;
  }
  if (!wakeWordRecognition) {
    attemptResumeWakeWordListening();
  }
}

function resetWakeCommandWindow() {
  wakeCommandArmed = false;
  wakeCommandArmedUntil = 0;
  wakeCommandArmedAt = 0;
  waitingForWakeCommand = false;
}

function clearPendingVoiceBuffer() {
  pendingVoiceBuffer = "";
  syncDebugVoiceBuffer("");
}

function mergeVoiceTranscript(previous, next) {
  const prev = (previous || "").trim();
  const nextText = (next || "").trim();
  if (!nextText) {
    return prev;
  }
  if (!prev) {
    return nextText;
  }
  const prevLower = prev.toLowerCase();
  const nextLower = nextText.toLowerCase();
  if (prevLower === nextLower) {
    return prev;
  }
  if (nextLower.startsWith(prevLower)) {
    return nextText;
  }
  if (prevLower.startsWith(nextLower)) {
    return prev;
  }
  if (nextLower.includes(prevLower)) {
    return nextText;
  }
  if (prevLower.includes(nextLower)) {
    return prev;
  }
  const prevWords = prev.split(/\s+/);
  const nextWords = nextText.split(/\s+/);
  for (let overlap = Math.min(prevWords.length, nextWords.length); overlap > 0; overlap -= 1) {
    const prevSuffix = prevWords.slice(-overlap).join(" ").toLowerCase();
    const nextPrefix = nextWords.slice(0, overlap).join(" ").toLowerCase();
    if (prevSuffix === nextPrefix) {
      const merged = `${prevWords.slice(0, -overlap).join(" ")} ${nextText}`.trim();
      return merged || nextText;
    }
  }
  return nextText.length >= prev.length ? nextText : prev;
}

function updatePendingVoiceBuffer(transcript) {
  pendingVoiceBuffer = mergeVoiceTranscript(pendingVoiceBuffer, transcript);
  syncDebugVoiceBuffer(pendingVoiceBuffer);
}

function clearPendingVoiceSubmit() {
  if (pendingVoiceSubmitTimer !== null) {
    window.clearTimeout(pendingVoiceSubmitTimer);
    pendingVoiceSubmitTimer = null;
  }
}

function schedulePendingVoiceSubmit() {
  clearPendingVoiceSubmit();
  pendingVoiceSubmitTimer = window.setTimeout(() => {
    pendingVoiceSubmitTimer = null;
    void flushPendingVoiceSubmit();
  }, PENDING_VOICE_DEBOUNCE_MS);
}

function extractVoiceCommandForSubmit(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return null;
  }
  const match = matchWakeWordPrefix(trimmed);
  if (!match) {
    return null;
  }
  const command = textAfterWakeWord(trimmed, match);
  if (!command || isWakeWordOnlyMessage(command)) {
    return null;
  }
  return command;
}

function resolvePendingVoiceMessage(merged) {
  const text = (merged || "").trim();
  if (!text) {
    return null;
  }
  if (acceptsVoiceWithoutWakeWord()) {
    const wakeMatch = matchWakeWordPrefix(text);
    if (wakeMatch) {
      return textAfterWakeWord(text, wakeMatch) || null;
    }
    return text;
  }
  if (wakeCommandArmed) {
    return normalizeArmedVoiceCommand(text);
  }
  return extractVoiceCommandForSubmit(text);
}

function isWakeWordOnlyUtterance(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return false;
  }
  if (WAKE_NAME_ONLY_PATTERN.test(trimmed)) {
    return true;
  }
  const match = matchWakeWordPrefix(trimmed);
  if (!match) {
    return false;
  }
  return !textAfterWakeWord(trimmed, match);
}

function detectWakeWordOnBuffer() {
  if (acceptsVoiceWithoutWakeWord() || wakeCommandArmed) {
    return;
  }
  const text = pendingVoiceBuffer.trim();
  if (!text || !isWakeWordOnlyUtterance(text)) {
    return;
  }
  armWakeCommandWindow();
  acknowledgeWakeWordOnly();
}

async function flushPendingVoiceSubmit() {
  if (requestInFlight || speakingActive) {
    return;
  }
  const merged = pendingVoiceBuffer.trim();
  if (!merged) {
    return;
  }
  if (wakeCommandArmed) {
    const now = Date.now();
    if (now > wakeCommandArmedUntil) {
      resetWakeCommandWindow();
      clearPendingVoiceBuffer();
      return;
    }
    if (now - wakeCommandArmedAt < WAKE_COMMAND_GRACE_MS) {
      return;
    }
  }
  const message = resolvePendingVoiceMessage(merged);
  if (!message) {
    if (isWakeWordOnlyUtterance(merged)) {
      clearPendingVoiceBuffer();
    }
    return;
  }
  if (shouldIgnoreDuplicateVoiceMessage(message)) {
    return;
  }
  updateDebugVoiceSubmitted(message);
  clearPendingVoiceSubmit();
  clearPendingVoiceBuffer();
  if (wakeCommandArmed) {
    resetWakeCommandWindow();
  }
  clearRecentVoiceSegments();
  if (typeof submitMessage !== "function") {
    return;
  }
  if (shouldKeepRecognitionAliveDuringSubmit()) {
    try {
      await submitMessage(message, "voice");
    } finally {
      ensureWakeWordListeningActive();
    }
    return;
  }
  pauseWakeWordListening();
  try {
    await submitMessage(message, "voice");
  } finally {
    resumeWakeWordListening();
  }
}

function armWakeCommandWindow() {
  clearPendingVoiceBuffer();
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
  const wakeMatch = matchWakeWordPrefix(trimmed);
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
  const match = matchWakeWordPrefix(trimmed);
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

function attemptResumeWakeWordListening() {
  if (!voiceModeEnabled) {
    return;
  }
  if (shouldPauseWakeWordListening()) {
    scheduleWakeWordRestart(500);
    return;
  }
  if (!startWakeWordRecognition()) {
    scheduleWakeWordRestart(800);
  }
}

function scheduleWakeWordRestart(delayMs = 300) {
  clearWakeWordRestartTimer();
  if (!voiceModeEnabled) {
    return;
  }
  if (isCoarsePointerDevice()) {
    const sinceLastStart = Date.now() - lastRecognitionStartAt;
    const minDelay = Math.max(delayMs, MOBILE_RECOGNITION_RESTART_MIN_MS);
    if (sinceLastStart < MOBILE_RECOGNITION_RESTART_MIN_MS) {
      delayMs = Math.max(minDelay, MOBILE_RECOGNITION_RESTART_MIN_MS - sinceLastStart);
    } else {
      delayMs = minDelay;
    }
  }
  wakeWordRestartTimer = window.setTimeout(() => {
    wakeWordRestartTimer = null;
    attemptResumeWakeWordListening();
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
    lastRecognitionStartAt = Date.now();
    if (isVoiceInputStreamActive() || !microphoneReady) {
      microphoneReady = true;
    }
    clearDebugVoiceCapture();
    if (!isVoiceStatusOverridden()) {
      setVoiceStatus(resolveVoiceModeStatusText());
    }
    renderState();
  };

  recognition.onresult = (event) => {
    if (speakingActive || requestInFlight) {
      return;
    }
    let pendingFinal = "";
    let pendingInterim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = (result[0]?.transcript || "").trim();
      if (!transcript) {
        continue;
      }
      if (result.isFinal) {
        pendingFinal = pendingFinal ? `${pendingFinal} ${transcript}` : transcript;
      } else {
        pendingInterim = pendingInterim ? `${pendingInterim} ${transcript}` : transcript;
      }
    }
    if (pendingFinal || pendingInterim) {
      updateDebugVoiceRecognition({ interim: pendingInterim, finalChunk: pendingFinal });
    }
    if (pendingFinal) {
      void handleVoiceTranscript(pendingFinal);
    }
    if (pendingInterim) {
      handleVoiceInterim(pendingInterim);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      reportVoiceRecognitionError(event.error);
      return;
    }
    if (event.error !== "aborted" && event.error !== "no-speech") {
      reportVoiceRecognitionError(event.error);
      if (replyStatus) {
        replyStatus.textContent = resolveVoiceRecognitionErrorMessage(event.error);
      }
    }
  };

  recognition.onend = () => {
    const endedRecognition = wakeWordRecognition;
    wakeWordRecognition = null;
    if (
      endedRecognition &&
      isCoarsePointerDevice() &&
      !shouldPauseWakeWordListening()
    ) {
      try {
        endedRecognition.start();
        wakeWordRecognition = endedRecognition;
        return;
      } catch (_error) {
        // Fall through to a throttled fresh start.
      }
    }
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
  clearDebugVoiceCapture();
}

function restartWakeWordListening() {
  if (!voiceModeEnabled) {
    return;
  }
  recognitionPaused = false;
  clearWakeWordRestartTimer();
  stopWakeWordRecognition();
  scheduleWakeWordRestart(120);
}

function resumeWakeWordListening() {
  recognitionPaused = false;
  if (!voiceModeEnabled) {
    return;
  }
  restartWakeWordListening();
}

function tryWakeWordOnInterim(transcript) {
  const text = (transcript || "").trim();
  if (!text || acceptsVoiceWithoutWakeWord() || requestInFlight || speakingActive) {
    return false;
  }
  const now = Date.now();
  if (text === lastInterimWakeCheck.text && now - lastInterimWakeCheck.at < 1200) {
    return false;
  }
  lastInterimWakeCheck = { text, at: now };

  for (const candidate of voiceTranscriptCandidates(text)) {
    const trimmedCandidate = candidate.trim();
    if (
      !matchWakeWordPrefix(candidate) &&
      !WAKE_NAME_ONLY_PATTERN.test(trimmedCandidate)
    ) {
      continue;
    }
    if (!wakeCommandArmed) {
      armWakeCommandWindow();
      acknowledgeWakeWordOnly();
      clearPendingVoiceBuffer();
    }
    return true;
  }
  return false;
}

function shouldCaptureInterimVoice(text) {
  if (!text) {
    return false;
  }
  if (acceptsVoiceWithoutWakeWord()) {
    return true;
  }
  if (wakeCommandArmed) {
    return true;
  }
  if (matchWakeWordPrefix(text)) {
    return true;
  }
  if (WAKE_NAME_ONLY_PATTERN.test(text.trim())) {
    return true;
  }
  return WAKE_FRAGMENT_PATTERN.test(text);
}

function handleVoiceInterim(transcript) {
  const text = (transcript || "").trim();
  if (!text) {
    return;
  }
  tryWakeWordOnInterim(text);
  if (requestInFlight || speakingActive) {
    return;
  }
  if (!shouldCaptureInterimVoice(text)) {
    return;
  }
  updatePendingVoiceBuffer(text);
  detectWakeWordOnBuffer();
  if (wakeCommandArmed && Date.now() > wakeCommandArmedUntil) {
    resetWakeCommandWindow();
    clearPendingVoiceBuffer();
    return;
  }
  schedulePendingVoiceSubmit();
}

function releaseMicrophone() {
  pauseWakeWordListening();
  stopVoiceInputStream();
  clearPendingVoiceSubmit();
  clearPendingVoiceBuffer();
  resetWakeCommandWindow();
  clearRecentVoiceSegments();
  microphoneReady = false;
}

async function connectBrowserMicrophone() {
  if (!voiceModeEnabled) {
    releaseMicrophone();
    return false;
  }
  if (!isVoiceRecognitionSupported()) {
    setVoiceSupportNotice(
      window.isSecureContext ? VOICE_UNSUPPORTED_MESSAGE : VOICE_INSECURE_CONTEXT_MESSAGE,
    );
    setVoiceStatus(
      window.isSecureContext ? VOICE_UNSUPPORTED_MESSAGE : VOICE_INSECURE_CONTEXT_MESSAGE,
    );
    return false;
  }
  recognitionPaused = false;
  setVoiceSupportNotice("");
  const streamReady = await ensureVoiceInputStream();
  if (!streamReady) {
    return false;
  }
  if (startWakeWordRecognition()) {
    return true;
  }
  scheduleWakeWordRestart(500);
  return true;
}

async function connectBrowserMicrophoneIfEnabled({ fromGesture = false } = {}) {
  if (!voiceModeEnabled) {
    return;
  }
  if (!fromGesture && !microphoneReady) {
    return;
  }
  await connectBrowserMicrophone();
}

async function handleVoiceTranscript(transcript) {
  if (requestInFlight || speakingActive) {
    return;
  }
  updatePendingVoiceBuffer(transcript);
  detectWakeWordOnBuffer();
  if (wakeCommandArmed && Date.now() > wakeCommandArmedUntil) {
    resetWakeCommandWindow();
    clearPendingVoiceBuffer();
  }
  schedulePendingVoiceSubmit();
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
    setVoiceSupportNotice("");
    setVoiceStatus("Voice on standby.");
    if (typeof restoreBaseAnswer === "function") {
      restoreBaseAnswer();
    }
    renderState();
    return;
  }

  if (!isVoiceRecognitionSupported()) {
    voiceModeEnabled = false;
    if (persist) {
      saveVoiceModeEnabled(false);
    }
    syncVoiceModeToggleUi();
    const message = window.isSecureContext ? VOICE_UNSUPPORTED_MESSAGE : VOICE_INSECURE_CONTEXT_MESSAGE;
    setVoiceSupportNotice(message);
    setVoiceStatus(message);
    renderState();
    return;
  }

  voiceModeEnabled = true;
  syncVoiceModeToggleUi();
  setVoiceSupportNotice("");
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

function applyUnsupportedVoiceModeState() {
  if (isVoiceRecognitionSupported()) {
    setVoiceSupportNotice("");
    return;
  }
  if (voiceModeEnabled) {
    voiceModeEnabled = false;
    saveVoiceModeEnabled(false);
    releaseMicrophone();
  }
  syncVoiceModeToggleUi();
  const message = window.isSecureContext ? VOICE_UNSUPPORTED_MESSAGE : VOICE_INSECURE_CONTEXT_MESSAGE;
  setVoiceSupportNotice(message);
}

function initVoiceModeControl() {
  applyUnsupportedVoiceModeState();
  if (isVoiceRecognitionSupported()) {
    voiceModeEnabled = loadVoiceModeEnabled();
  } else {
    voiceModeEnabled = false;
  }
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
