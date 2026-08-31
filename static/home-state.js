// Voice and request state
let currentVoiceUrl = null;
let voicePlaybackQueue = Promise.resolve();
let voiceAvailable = false;
let microphoneReady = false;
let requestInFlight = false;
let waitingForVoiceAnswer = false;
let waitingForYesNoConfirmation = false;
let currentAnswerPendingKind = null;

// Activity snapshot state
let currentActivitySnapshot = {
  state: "standby",
  headline: "I'm in standby.",
  detail: "Awaiting your input.",
  task_timer: null,
  active_timers: [],
};
let lastActivityEventId = 0;
let activityLogHiddenBeforeId = 0;

// Answer and status timers
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

// Task wait and timer runtime state
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

// UI session state
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
const DEBUG_MODE_STORAGE_KEY = "nano.debugMode";
const CALENDAR_LANG_STORAGE_KEY = "nano.calendarLang";
const MEETING_REMINDER_STORAGE_KEY = "nano.meetingReminders";
const DEFAULT_VOICE_VOLUME = 0.8;
let voiceModeEnabled = false;
let debugModeEnabled = false;
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

// App services state
let mainEssence = null;
let toolCommands = [];
let pendingSystemCommandId = null;
let currentPendingSnapshot = null;
let currentInputKind = null;
let reconnectInProgress = false;
let connectionOverlayMode = null;
let connectionRecoveryStartedAt = 0;
let rebootPendingFromStatus = false;
const LAST_BOOT_ID_KEY = "nano_last_boot_id";

// Copy and display constants
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
