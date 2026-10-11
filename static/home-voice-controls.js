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
  if (!voiceModeToggle) {
    return;
  }
  voiceModeToggle.checked = voiceModeEnabled;
  voiceModeToggle.setAttribute("aria-checked", voiceModeEnabled ? "true" : "false");
  voiceModeToggle.disabled = !supported;
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
