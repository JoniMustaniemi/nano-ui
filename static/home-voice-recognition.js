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
  if (requestInFlight || speakingActive || countdownCreateInFlight || stopwatchCreateInFlight) {
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
  if (requestInFlight || speakingActive || countdownCreateInFlight || stopwatchCreateInFlight) {
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
  if (voiceModeToggle && voiceModeToggle.dataset.bound !== "true") {
    voiceModeToggle.dataset.bound = "true";
    voiceModeToggle.addEventListener("change", () => {
      void setVoiceModeEnabled(voiceModeToggle.checked);
    });
  }
}

let voiceAnswerPrompt = 'Say your answer after "hey nano".';
