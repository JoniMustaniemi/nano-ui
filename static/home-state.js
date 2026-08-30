const stateLine = document.getElementById("state-line");
const activityStatus = document.getElementById("activity-status");
const activityStatusText = activityStatus.querySelector(".activity-status-text");
const userSpeech = document.getElementById("user-speech");
const userSpeechText = userSpeech ? userSpeech.querySelector(".user-speech-text") : null;
const activityLog = document.getElementById("activity-log");
const brainsClearButton = document.getElementById("brains-clear");
const voiceStatus = document.getElementById("voice-status");
const replyStatus = document.getElementById("reply-status");
const messageBox = document.getElementById("message");
const sendButton = document.getElementById("send");
const answerOutput = document.getElementById("answer-output");
const inputActions = document.getElementById("input-actions");
const voiceAudio = document.getElementById("voice-audio");
const storageLog = document.getElementById("storage-log");
const commandsToggle = document.getElementById("commands-toggle");
const commandsList = document.getElementById("commands-list");
const voiceVolumeInput = document.getElementById("voice-volume");
const voiceVolumeValue = document.getElementById("voice-volume-value");
const voiceModeOffBtn = document.getElementById("voice-mode-off");
const voiceModeOnBtn = document.getElementById("voice-mode-on");
const cpuTempChip = document.getElementById("cpu-temp-chip");
const weatherChip = document.getElementById("weather-chip");
const clockChip = document.getElementById("clock-chip");
const connectionUrlInput = document.getElementById("nano-connection-url");
const connectionKeyInput = document.getElementById("nano-connection-key");
const connectionStatus = document.getElementById("nano-connection-status");
const connectionTestButton = document.getElementById("nano-connection-test");
const connectionSettingsDropdown = document.getElementById("connection-settings-dropdown");
const connectionSettingsSection = document.querySelector(".commands-connection-settings");
const keyboardToggle = document.getElementById("keyboard-toggle");
const keyboardPanel = document.getElementById("keyboard-panel");
const viewModal = document.getElementById("view-modal");
const viewModalPanel = document.getElementById("view-modal-panel");
const viewModalTitle = document.getElementById("view-modal-title");
const viewModalClose = document.getElementById("view-modal-close");
const nanoControlsToggle = document.getElementById("nano-controls-toggle");
const viewPanelBrains = document.getElementById("nano-panel-brains");
const viewPanelStorage = document.getElementById("nano-panel-storage");
const viewPanelCommands = document.getElementById("view-panel-commands");
const viewPanelCalendar = document.getElementById("nano-panel-calendar");
const calendarPicker = document.getElementById("calendar-picker");
const calendarPickerToggle = document.getElementById("calendar-picker-toggle");
const calendarPickerLabel = document.getElementById("calendar-picker-label");
const calendarPickerMenu = document.getElementById("calendar-picker-menu");
const calendarPrev = document.getElementById("calendar-prev");
const calendarToday = document.getElementById("calendar-today");
const calendarNext = document.getElementById("calendar-next");
const calendarPeriodLabel = document.getElementById("calendar-period-label");
const calendarViewMonth = document.getElementById("calendar-view-month");
const calendarViewWeek = document.getElementById("calendar-view-week");
const calendarViewDay = document.getElementById("calendar-view-day");
const calendarLangEn = document.getElementById("calendar-lang-en");
const calendarLangFi = document.getElementById("calendar-lang-fi");
const calendarGrid = document.getElementById("calendar-grid");
const calendarDayModal = document.getElementById("calendar-day-modal");
const calendarDayModalPanel = document.querySelector(".calendar-day-modal-panel");
const calendarDayModalRailExtras = document.querySelector(".calendar-day-modal-rail-extras");
const calendarDayClose = document.getElementById("calendar-day-close");
const calendarDayTitle = document.getElementById("calendar-day-title");
const calendarDayEvents = document.getElementById("calendar-day-events");
const calendarError = document.getElementById("calendar-error");
const calendarContent = document.getElementById("calendar-content");
const calendarLoadingOverlay = document.getElementById("calendar-loading");
const calendarLoadingLabel = document.getElementById("calendar-loading-label");
const calendarLoadingDetail = document.getElementById("calendar-loading-detail");
const nanoPanelBrains = viewPanelBrains;
const nanoPanelStorage = viewPanelStorage;
const essenceCanvas = document.getElementById("essence-canvas");
const taskWaitTimer = document.getElementById("task-wait-timer");
const taskWaitLabel = taskWaitTimer ? taskWaitTimer.querySelector(".task-wait-label") : null;
const taskWaitClock = taskWaitTimer ? taskWaitTimer.querySelector(".task-wait-clock") : null;
const activeTimersRoot = document.getElementById("active-timers");
const activeStopwatchesRoot = document.getElementById("active-stopwatches");

let currentVoiceUrl = null;
let voicePlaybackQueue = Promise.resolve();
let voiceAvailable = false;
let microphoneReady = false;
let requestInFlight = false;
let waitingForVoiceAnswer = false;
let waitingForYesNoConfirmation = false;
let currentAnswerPendingKind = null;
let currentActivitySnapshot = {
  state: "standby",
  headline: "I'm in standby.",
  detail: "Awaiting your input.",
  task_timer: null,
  active_timers: [],
};
let lastActivityEventId = 0;
let activityLogHiddenBeforeId = 0;
let answerClearTimer = null;
let answerTimeoutTimer = null;
let answerRevealTimer = null;
let answerClearPending = false;
let answerTimeoutPending = false;
let statusClearTimer = null;
let statusClearPending = false;
let statusRevealTimer = null;
let userSpeechFadeTimer = null;
let userSpeechHideTimer = null;
let lastRenderedStatusText = "";
let workingDotsTimer = null;
let currentTaskTimer = null;
let taskWaitClockInterval = null;
let currentActiveTimers = [];
let activeTimersInterval = null;
const announcedTimerKeys = new Set();
const seenActiveTimerKeys = new Set();
const scheduledTimerExpiryTimeouts = new Map();
const expiredTimerKeys = new Set();
const expiredTimerSnapshots = new Map();
const dismissedTimerKeys = new Set();
const timerReminderIntervals = new Map();
const localStopwatches = new Map();
const stoppedStopwatchKeys = new Set();
const stoppedStopwatchIds = new Set();
let currentServerStopwatches = [];
const ACTIVE_TIMER_TICK_MS = 100;
const TIMER_REMINDER_INTERVAL_MS = 10000;
const TIMER_SERVER_SYNC_POLL_MS = 400;
const TIMER_SERVER_SYNC_MAX_ATTEMPTS = 13;
let savedResponseBeforeWorking = null;
let suppressWorkingResponse = false;
const ANSWER_CLEAR_DELAY_MS = 20000;
const USER_SPEECH_DISPLAY_MS = 5000;
const USER_SPEECH_FADE_MS = 420;
let DEFAULT_NO_ANSWER = "no";
let IDLE_RESPONSE = "How can I help?";
const GREETING_SPOKEN_KEY = "nano.greetingSpoken";
const VOICE_VOLUME_STORAGE_KEY = "nano.voiceVolume";
const VOICE_MODE_STORAGE_KEY = "nano.voiceMode";
const CALENDAR_LANG_STORAGE_KEY = "nano.calendarLang";
const DEFAULT_VOICE_VOLUME = 0.8;
let voiceModeEnabled = false;
let waitingForWakeCommand = false;
let keyboardOpen = false;
let viewSessionActive = false;
let activeView = null;
let viewSessionSource = null;
let viewSessionListening = false;
let speakingActive = false;
let controlsHidden = true;
let waitingForPresence = false;
let waitingForFollowUp = false;
let suppressPendingRearm = false;
let lastHandledDismissal = null;
let currentStandbyGreeting = "";

let mainEssence = null;
let toolCommands = [];
let pendingSystemCommandId = null;
let currentPendingSnapshot = null;
let currentInputKind = null;
let reconnectInProgress = false;
const activityStates = ["standby", "working", "error"];
let STANDBY_HEADLINE = "I'm in standby.";
let STANDBY_DETAIL_DEFAULT = "Awaiting your input.";
let LISTENING_ACTIVITY_HEADLINE = "Waiting for your input.";
let LISTENING_HEADLINE_DEFAULT = LISTENING_ACTIVITY_HEADLINE;
let VOICE_READY_HEADLINE = 'Say "hey nano" to talk.';
let VOICE_READY_DETAIL = "Listening on your device.";
let VOICE_STARTING_DETAIL = "Tap anywhere once to enable the microphone.";
const WAKE_COMMAND_WINDOW_MS = 10000;
let COMMAND_LISTEN_HEADLINE = LISTENING_ACTIVITY_HEADLINE;
let VIEW_SESSION_HEADLINE = "Tap close to dismiss.";
let WAITING_FOR_ANSWER_HEADLINE = LISTENING_ACTIVITY_HEADLINE;
let FOLLOW_UP_LISTEN_HEADLINE = WAITING_FOR_ANSWER_HEADLINE;
let PRESENCE_LISTEN_HEADLINE = "Are you there?";
let PRESENCE_LISTEN_DETAIL = 'Say yes or no after "hey nano".';
let WORKING_DETAIL_DEFAULT = "Give me a moment.";
let RECEIVED_TITLE = "On it.";
let RECEIVED_DETAIL = "Give me a moment.";
const DEFAULT_TASK_ACK_POOL = [
  "On it.",
  "Got it.",
  "Sure thing.",
  "Right away.",
  "Will do.",
  "One moment.",
  "Working on it.",
  "Let me handle that.",
  "I'm on it.",
  "Okay, starting now.",
  "Coming right up.",
  "Got you covered.",
  "Give me a sec.",
  "Understood.",
  "Leave it to me.",
];
let TASK_ACK_POOL = [...DEFAULT_TASK_ACK_POOL];
let lastTaskAck = "";

function pickTaskAck() {
  if (TASK_ACK_POOL.length === 0) {
    return RECEIVED_TITLE;
  }
  if (TASK_ACK_POOL.length === 1) {
    lastTaskAck = TASK_ACK_POOL[0];
    return lastTaskAck;
  }
  let pick = TASK_ACK_POOL[0];
  do {
    pick = TASK_ACK_POOL[Math.floor(Math.random() * TASK_ACK_POOL.length)];
  } while (pick === lastTaskAck);
  lastTaskAck = pick;
  return pick;
}

function applyClientCopy(copy) {
  if (!copy || typeof copy !== "object") {
    return;
  }
  if (copy.standbyHeadline) {
    STANDBY_HEADLINE = copy.standbyHeadline;
  }
  if (copy.standbyDetailDefault) {
    STANDBY_DETAIL_DEFAULT = copy.standbyDetailDefault;
  }
  if (copy.listeningActivityHeadline) {
    LISTENING_ACTIVITY_HEADLINE = copy.listeningActivityHeadline;
    LISTENING_HEADLINE_DEFAULT = copy.listeningActivityHeadline;
    COMMAND_LISTEN_HEADLINE = copy.listeningActivityHeadline;
    WAITING_FOR_ANSWER_HEADLINE = copy.listeningActivityHeadline;
    FOLLOW_UP_LISTEN_HEADLINE = copy.listeningActivityHeadline;
  }
  if (copy.wakeArmedHeadline) {
    VOICE_READY_HEADLINE = copy.wakeArmedHeadline;
  }
  if (copy.wakeArmedDetail) {
    VOICE_READY_DETAIL = copy.wakeArmedDetail;
  }
  if (copy.viewSessionHeadline) {
    VIEW_SESSION_HEADLINE = copy.viewSessionHeadline;
  }
  if (copy.presenceListenHeadline) {
    PRESENCE_LISTEN_HEADLINE = copy.presenceListenHeadline;
  }
  if (copy.presenceListenDetail) {
    PRESENCE_LISTEN_DETAIL = copy.presenceListenDetail;
  }
  if (copy.workingDetailDefault) {
    WORKING_DETAIL_DEFAULT = copy.workingDetailDefault;
  }
  if (Array.isArray(copy.receivedAckPool) && copy.receivedAckPool.length > 0) {
    TASK_ACK_POOL = copy.receivedAckPool
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim());
  }
  if (copy.receivedTitle) {
    RECEIVED_TITLE = copy.receivedTitle;
    if (TASK_ACK_POOL.length > 0) {
      TASK_ACK_POOL[0] = RECEIVED_TITLE;
    } else {
      TASK_ACK_POOL = [RECEIVED_TITLE];
    }
  }
  if (copy.receivedDetail) {
    RECEIVED_DETAIL = copy.receivedDetail;
  }
  if (copy.idleResponse) {
    IDLE_RESPONSE = copy.idleResponse;
  }
  if (copy.defaultNoAnswer) {
    DEFAULT_NO_ANSWER = copy.defaultNoAnswer;
  }
}
