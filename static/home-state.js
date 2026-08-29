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
const confirmationActions = document.getElementById("confirmation-actions");
const confirmationYesButton = document.getElementById("confirmation-yes");
const confirmationNoButton = document.getElementById("confirmation-no");
const voiceAudio = document.getElementById("voice-audio");
const storageLog = document.getElementById("storage-log");
const commandsToggle = document.getElementById("commands-toggle");
const commandsToggleReveal = document.getElementById("commands-toggle-reveal");
const commandsList = document.getElementById("commands-list");
const voiceVolumeInput = document.getElementById("voice-volume");
const voiceVolumeValue = document.getElementById("voice-volume-value");
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
const controlsRevealZone = document.getElementById("controls-reveal-zone");
const controlsRevealButton = document.getElementById("controls-reveal");
const commandsRevealZone = document.getElementById("commands-reveal-zone");

let currentVoiceUrl = null;
let voicePlaybackQueue = Promise.resolve();
let voiceAvailable = false;
let microphoneStream = null;
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
let savedResponseBeforeWorking = null;
let suppressWorkingResponse = false;
const ANSWER_CLEAR_DELAY_MS = 20000;
const USER_SPEECH_DISPLAY_MS = 5000;
const USER_SPEECH_FADE_MS = 420;
let DEFAULT_NO_ANSWER = "no";
let IDLE_RESPONSE = "How can I help?";
const GREETING_SPOKEN_KEY = "nano.greetingSpoken";
const VOICE_VOLUME_STORAGE_KEY = "nano.voiceVolume";
const CALENDAR_LANG_STORAGE_KEY = "nano.calendarLang";
const DEFAULT_VOICE_VOLUME = 0.8;
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
let reconnectInProgress = false;
const activityStates = ["standby", "working", "error"];
let STANDBY_HEADLINE = "I'm in standby.";
let STANDBY_DETAIL_DEFAULT = "Awaiting your input.";
let LISTENING_ACTIVITY_HEADLINE = "Waiting for your input.";
let LISTENING_HEADLINE_DEFAULT = LISTENING_ACTIVITY_HEADLINE;
let VOICE_READY_HEADLINE = "Hold the mic button to talk.";
let VOICE_READY_DETAIL = "Processing happens on the Pi.";
let COMMAND_LISTEN_HEADLINE = LISTENING_ACTIVITY_HEADLINE;
let VIEW_SESSION_HEADLINE = "Tap close to dismiss.";
let WAITING_FOR_ANSWER_HEADLINE = LISTENING_ACTIVITY_HEADLINE;
let FOLLOW_UP_LISTEN_HEADLINE = WAITING_FOR_ANSWER_HEADLINE;
let PRESENCE_LISTEN_HEADLINE = "Are you there?";
let PRESENCE_LISTEN_DETAIL = "Hold the mic and say yes or no.";
let WORKING_DETAIL_DEFAULT = "Give me a moment.";
let RECEIVED_TITLE = "On it.";
let RECEIVED_DETAIL = "Give me a moment.";

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
  if (copy.receivedTitle) {
    RECEIVED_TITLE = copy.receivedTitle;
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
