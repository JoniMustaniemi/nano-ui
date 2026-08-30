from pathlib import Path
import re

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "static"
INDEX_PATH = ROOT_DIR / "index.html"

HOME_JS_MODULES = (
    "home-state.js",
    "home-calendar.js",
    "home-view-session.js",
    "home-ui.js",
    "home-voice.js",
    "home-activity.js",
    "home-reconnect.js",
    "home-chat.js",
    "home-weather.js",
    "home-bootstrap.js",
)


def _load_home_js() -> str:
    return "\n".join(
        (STATIC_DIR / module).read_text(encoding="utf-8") for module in HOME_JS_MODULES
    )


def _load_home_css() -> str:
    layout = (STATIC_DIR / "home-layout.css").read_text(encoding="utf-8")
    components = (STATIC_DIR / "home-components.css").read_text(encoding="utf-8")
    return layout + components


def _load_index_html() -> str:
    return INDEX_PATH.read_text(encoding="utf-8")


def test_homepage_shows_standby_ui() -> None:
    response_text = _load_index_html()

    assert 'id="activity-status"' in response_text
    assert 'activity-status" aria-live="polite" hidden' in response_text
    assert 'id="user-speech"' in response_text
    assert 'class="user-speech-text"' in response_text
    assert 'class="user-speech-label"' in response_text
    answer_index = response_text.index('id="answer-output"')
    user_speech_index = response_text.index('id="user-speech"')
    essence_index = response_text.index('class="essence-zone"')
    active_timers_index = response_text.index('id="active-timers"')
    active_stopwatches_index = response_text.index('id="active-stopwatches"')
    assert answer_index < user_speech_index < active_timers_index < active_stopwatches_index < essence_index
    assert 'id="commands-toggle"' in response_text
    assert 'class="footer-cluster"' not in response_text
    assert 'id="input-actions"' in response_text
    assert 'class="input-action-btn"' not in response_text
    assert 'class="nano-version"' in response_text
    assert 'id="cpu-temp-chip"' in response_text
    assert 'id="cpu-temp-chip" class="cpu-temp-chip" hidden' in response_text
    assert 'id="weather-chip"' in response_text
    assert 'id="weather-chip" class="weather-chip" hidden' in response_text
    assert 'id="clock-chip"' in response_text
    assert 'id="clock-chip" class="clock-chip"' in response_text


def test_clock_chip_integration() -> None:
    html_text = _load_index_html()
    bootstrap_js = (STATIC_DIR / "home-bootstrap.js").read_text(encoding="utf-8")
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    css_text = _load_home_css()

    assert 'id="clock-chip"' in html_text
    assert "clockChip" in state_js
    assert "startClockChip" in bootstrap_js
    assert "formatClockTime" in bootstrap_js
    assert ".clock-chip" in css_text


def test_weather_chip_integration() -> None:
    html_text = _load_index_html()
    weather_js = (STATIC_DIR / "home-weather.js").read_text(encoding="utf-8")
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    css_text = _load_home_css()

    assert 'id="weather-chip"' in html_text
    assert "weatherChip" in state_js
    assert "initWeatherOnce" in weather_js
    assert "applyWeather" in weather_js
    assert 'nanoFetch("/api/location"' in weather_js
    assert 'nanoFetch("/api/weather/current")' in weather_js
    assert "data?.display" in weather_js
    assert "data.display" in weather_js
    assert "initWeatherOnce" in activity_js
    assert ".weather-chip" in css_text


def test_cpu_temperature_footer_integration() -> None:
    html_text = _load_index_html()
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    css_text = _load_home_css()

    assert 'id="cpu-temp-chip"' in html_text
    assert "cpuTempChip" in state_js
    assert "applySystemMetrics" in activity_js
    assert "cpu_temperature_celsius" in activity_js
    assert "SYSTEM_METRICS_POLL_MS" in activity_js
    assert "syncSystemMetrics" in activity_js
    assert "startSystemMetricsPolling" in activity_js
    assert 'nanoFetch("/api/system/metrics")' in activity_js
    assert ".cpu-temp-chip" in css_text
    assert ".cpu-temp-chip--warm" in css_text
    assert ".cpu-temp-chip--hot" in css_text


def test_favicon_asset_exists() -> None:
    favicon = STATIC_DIR / "favicon.svg"
    assert favicon.exists()
    assert favicon.read_text(encoding="utf-8").startswith("<svg")


def test_homepage_uses_remote_api_client() -> None:
    js_text = _load_home_js()
    css_text = _load_home_css()
    html_text = _load_index_html()

    assert "./static/nano-api.js" in html_text
    assert "./static/nano-settings.js" in html_text
    assert 'type="importmap"' in html_text
    assert "three.module.min.js" in html_text
    assert 'type="module" src="./static/essence_visualizer.js' in html_text
    assert "three.min.js" not in html_text
    assert "./static/home-entry.js" in html_text
    assert "./config.js" in html_text
    assert "nanoFetch" in js_text
    assert "nanoEventSource" in js_text
    assert "ensureApiConnection" in js_text
    assert "handleVoiceTranscript" in js_text
    assert 'id="commands-toggle"' in html_text
    assert ".user-speech" in css_text


def test_ui_does_not_run_legacy_wake_loop() -> None:
    js_text = _load_home_js()

    assert "extractWakeCommand" not in js_text
    assert "pauseRecognitionForSpeech" not in js_text
    assert "listeningEnabled" not in js_text
    assert "wakeAcknowledging" not in js_text


def test_browser_voice_sends_text_to_pi() -> None:
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    js_text = _load_home_js()

    assert "startWakeWordRecognition" in voice_js
    assert "extractVoiceCommand" in voice_js
    assert "WAKE_WORD_PATTERN" in voice_js
    assert "handleVoiceTranscript" in voice_js
    assert "connectBrowserMicrophone" in voice_js
    assert 'nanoFetch("/api/voice/transcribe"' not in voice_js
    assert 'nanoFetch("/api/voice/mode"' not in voice_js
    assert 'nanoFetch("/api/voice/command"' not in js_text
    assert 'submitMessage(message, "voice")' in voice_js
    assert "SpeechRecognition" in voice_js
    assert "recognition.continuous = true" in voice_js
    assert "connectBrowserMicrophoneIfEnabled" in activity_js
    assert "waitingForVoiceAnswer" in voice_js
    assert 'source === "voice"' in chat_js
    assert "acceptsVoiceWithoutWakeWord" in voice_js
    assert "armWakeCommandWindow" in voice_js
    assert "normalizeArmedVoiceCommand" in voice_js
    assert "isWakeWordOnlyMessage" in voice_js
    assert "waitingForWakeCommand" in state_js
    assert "ensureMicrophonePermission" in voice_js
    assert "getUserMedia" in voice_js
    assert 'source !== "voice"' in chat_js.split("isViewSessionActive()", 1)[1].split("if (isSystemCommandId", 1)[0]


def test_voice_volume_loads_from_server() -> None:
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")

    assert "loadVoiceVolumeFromServer" in voice_js
    assert 'method: "PUT"' in voice_js.split("syncVoiceVolumeToServer", 1)[1].split("function setVoiceVolumeFromInput", 1)[0]
    load_volume_fn = voice_js.split("async function loadVoiceVolumeFromServer", 1)[1].split(
        "async function syncVoiceVolumeToServer",
        1,
    )[0]
    assert 'nanoFetch("/api/voice/volume"' in load_volume_fn
    assert "method:" not in load_volume_fn or "GET" not in load_volume_fn


def test_bootstrap_waits_for_api_connection() -> None:
    bootstrap_js = (STATIC_DIR / "home-bootstrap.js").read_text(encoding="utf-8")

    assert "ensureApiConnection" in bootstrap_js
    assert "completeStartupAfterConnection" in bootstrap_js
    assert "submitInputAnswer" in (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    assert "syncInputActions" in (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    assert "loadNanoVersionFromBackend" in bootstrap_js
    assert 'nanoFetch("/api/health")' in bootstrap_js


def test_connection_settings_in_commands_panel() -> None:
    html_text = _load_index_html()
    settings_js = (STATIC_DIR / "nano-settings.js").read_text(encoding="utf-8")
    view_session_js = (STATIC_DIR / "home-view-session.js").read_text(encoding="utf-8")
    settings_css = (STATIC_DIR / "nano-settings.css").read_text(encoding="utf-8")

    assert 'id="nano-connection-url"' in html_text
    assert 'id="nano-connection-key"' in html_text
    assert 'id="connection-settings-dropdown"' in html_text
    assert "commands-connection-dropdown" in html_text
    assert "initConnectionSettings" in settings_js
    assert "openConnectionSettings" in settings_js
    assert "nano-waiting-overlay" in settings_js
    assert "initConnectionSettings" in view_session_js
    assert "body.connection-waiting .view-modal" in settings_css


def test_task_start_acknowledgment() -> None:
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")

    assert "TASK_ACK_POOL" in state_js
    assert "pickTaskAck" in state_js
    pool_section = state_js.split("const DEFAULT_TASK_ACK_POOL = [", 1)[1].split("];", 1)[0]
    assert pool_section.count('"') // 2 >= 10
    assert "receivedAckPool" in state_js
    assert "isTaskAck: true" in chat_js
    assert "pickTaskAck()" in chat_js
    assert "forcePlayback" in voice_js
    assert "skipAnswerUpdate" in voice_js
    assert "resumeVoiceAudioContext" in chat_js
    assert "isTaskAck" in ui_js
    assert 'dataset.taskAck = "true"' in ui_js
    assert 'answerOutput.dataset.taskAck === "true"' in ui_js.split("function startWorkingResponse()")[1]


def test_reboot_restart_reconnect_helpers() -> None:
    js_text = _load_home_js()
    reconnect_js = (STATIC_DIR / "home-reconnect.js").read_text(encoding="utf-8")
    api_js = (STATIC_DIR / "nano-api.js").read_text(encoding="utf-8")
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    entry_js = (STATIC_DIR / "home-entry.js").read_text(encoding="utf-8")

    assert "waitForNano" in api_js
    assert "nano-reconnect-overlay" in reconnect_js
    assert "beginNanoReconnect" in reconnect_js
    assert "reboot_pi" in reconnect_js
    assert "restart_nano" in reconnect_js
    assert "answerNeedsYesNoConfirmation" in voice_js
    assert "handleSystemCommandResponse" in reconnect_js
    assert "home-reconnect.js" in entry_js
    assert "reconnectInProgress" in js_text
    assert "pendingSystemCommandId" in js_text
    assert "reboot_confirmation" not in voice_js
    assert "restart_confirmation" not in voice_js
    assert "pickSystemCommandConfirmation" in reconnect_js
    assert "resolveSystemCommandConfirmation" in reconnect_js
    restart_pool = reconnect_js.split("const DEFAULT_RESTART_CONFIRMATION_POOL = [", 1)[1].split("];", 1)[0]
    reboot_pool = reconnect_js.split("const DEFAULT_REBOOT_CONFIRMATION_POOL = [", 1)[1].split("];", 1)[0]
    assert restart_pool.count('"') // 2 >= 10
    assert reboot_pool.count('"') // 2 >= 10
    assert "resolveSystemCommandConfirmation(" in chat_js


def test_improvement_plans_removed() -> None:
    js_text = _load_home_js()
    html_text = _load_index_html()
    css_text = _load_home_css()

    assert not (STATIC_DIR / "home-plans.js").exists()
    assert "home-plans.js" not in (STATIC_DIR / "home-entry.js").read_text(encoding="utf-8")
    assert "improvement-plans" not in js_text
    assert "loadPlans" not in js_text
    assert "nano-panel-plans" not in html_text
    assert ".plan-card" not in css_text


def test_confirmation_answer_clears_waiting_state() -> None:
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")

    assert 'confirmationAnswer: true' in chat_js
    assert "inputAnswer: true" in chat_js
    assert "isConfirmationAnswer" in chat_js
    assert "suppressPendingRearm" in chat_js
    assert "resetStandbySnapshot()" in chat_js
    assert "returnToWakeDetection()" in chat_js
    assert "renderState();" in voice_js.split("function returnToWakeDetection()")[1]
    assert "suppressPendingRearm" in activity_js


def test_pending_input_actions() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    bootstrap_js = (STATIC_DIR / "home-bootstrap.js").read_text(encoding="utf-8")
    html_text = _load_index_html()

    assert 'id="input-actions"' in html_text
    assert "TIMER_DURATION_INPUT_ACTIONS" in ui_js
    assert "GENERIC_INPUT_ACTIONS" in ui_js
    assert "getInputActionsForCurrentState" in ui_js
    assert "syncInputActions" in ui_js
    assert "data-input-action" in bootstrap_js
    assert "submitInputAnswer" in bootstrap_js
    assert "open_keyboard" in bootstrap_js
    assert "timer_duration" in ui_js
    assert "note_selection" not in ui_js
    assert "note_name" not in ui_js
    assert "FREE_TEXT_PENDING_KINDS" not in ui_js
    assert "normalizePendingOptions" not in ui_js


def test_voice_pending_answer_clears_waiting_state() -> None:
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")

    submit_fn = chat_js.split("async function submitMessage", 1)[1].split("async function stopActiveStopwatch", 1)[0]
    assert "isVoicePendingAnswer" in submit_fn
    assert "returnToWakeDetection();" in submit_fn.split("if (isWaitingForUserAnswer())", 1)[1]
    assert "ensureDirectAnswerListening();" not in submit_fn.split("if (isWaitingForUserAnswer())", 1)[1].split(
        "if (!shouldSpeak)", 1
    )[0]

    pending_fn = activity_js.split("function applyPendingSnapshot", 1)[1].split("function applyStatusSnapshot", 1)[0]
    assert "waitingForVoiceAnswer = false" in pending_fn
    assert "currentInputKind = null" in pending_fn


def test_timer_tool_command_helpers() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")

    assert "resolveToolCommandMessage" in ui_js
    assert "isTimerToolCommand" in ui_js
    assert 'return "Start a timer"' in ui_js
    assert "EXCLUDED_TOOL_COMMAND_IDS" in ui_js
    assert 'source !== "command"' in chat_js
    assert "formatTimerDurationAnswer" in chat_js
    assert "answerNeedsTimerDuration" in voice_js
    assert "restoreWake: false" in ui_js


def test_clear_all_timers() -> None:
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")

    assert "isClearAllTimersMessage" in activity_js
    assert "isClearAllTimersCommand" in activity_js
    assert "clearAllLocalTimerState" in activity_js
    assert "clearAllLocalTimerState()" in chat_js
    assert "isClearAllTimersCommand(commandHint)" in chat_js
    assert "isClearAllTimersMessage(message)" in chat_js
    assert "followUpClearAllTimersOnServer" in chat_js
    assert "getStopwatchStoppedKeys" in activity_js
    assert "buildStopStopwatchMessage" in activity_js
    assert "serverStopwatches.length === 0" in activity_js
    active_timers_pattern = re.compile(r"\bactive\s+timers?\b", re.IGNORECASE)
    assert not active_timers_pattern.search("Clear all timers.")
    assert "SUPPLEMENTAL_TOOL_COMMANDS" in ui_js
    assert "supplementToolCommands" in ui_js
    assert '"clear_all_timers"' in ui_js
    assert "EXCLUDED_TOOL_COMMAND_IDS" in ui_js


def test_active_timer_ui() -> None:
    html_text = _load_index_html()
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    css_text = _load_home_css()

    assert 'id="active-timers"' in html_text
    assert 'id="active-stopwatches"' in html_text
    assert html_text.index('id="active-timers"') < html_text.index('id="active-stopwatches"') < html_text.index('class="essence-zone"')
    assert "activeStopwatchesRoot" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "active-timer-item--hero" in activity_js
    assert "active-timer-progress-fill" in activity_js
    assert "getTimerProgress" in activity_js
    assert "has-active-timers" in activity_js
    assert "position: absolute" not in css_text.split(".active-timers {", 1)[1].split("}", 1)[0]
    assert "cancelActiveTimer" in chat_js
    assert "persistTimerCancel" in chat_js
    assert "deleteTimerById" in activity_js
    assert "waitForServerTimerRemoved" in activity_js
    assert "TIMER_SERVER_SYNC_MAX_ATTEMPTS" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "TIMER_SERVER_SYNC_POLL_MS" in activity_js
    cancel_fn = chat_js.split("async function persistTimerCancel", 1)[1].split("async function cancelActiveTimer", 1)[0]
    assert "await deleteTimerById(id)" in cancel_fn
    assert cancel_fn.index("await deleteTimerById(id)") < cancel_fn.index("await persistViaSilentChat()")
    assert "restoreCountdownTimerState" in activity_js
    assert 'method: "DELETE"' in activity_js
    assert "postTimerAgentCommandSilently" in chat_js
    assert "submitMessage(buildCancelTimerMessage" not in chat_js
    assert "announceTimerExpired" in activity_js
    assert "rescheduleTimerExpiries" in activity_js
    assert "getActiveTimerRemainingMs" in activity_js
    assert "getDisplayCountdownTimers" in activity_js
    assert "getDisplayStopwatches" in activity_js
    assert "displayActiveStopwatches" in activity_js
    assert "refreshActiveStopwatchesDisplay" in activity_js
    assert "clearCountdownTimerState" in activity_js
    assert "clearStopwatchState" in activity_js
    assert "pruneOrphanedTimerState" in activity_js
    assert "okExpiredTimer" in activity_js
    assert "acknowledgeExpiredTimer" in activity_js
    assert "displayActiveTimers" in activity_js
    assert "updateActiveTimersInPlace" in activity_js
    assert "isStopwatchTimer" in activity_js
    assert "normalizeRuntimeTimers" in activity_js
    assert "startLocalStopwatch" in activity_js
    assert "localStopwatches" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "stoppedStopwatchKeys" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "stoppedStopwatchIds" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "stopLocalStopwatch" in activity_js
    assert "stopActiveStopwatch" in chat_js
    assert "persistStopwatchStop" in chat_js
    assert "deleteStopwatchById" in activity_js
    assert "waitForServerStopwatchRemoved" in activity_js
    assert "restoreStopwatchState" in activity_js
    assert "currentServerStopwatches" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "submitMessage(buildStopStopwatchMessage" not in chat_js
    assert "buildStopStopwatchMessage(id)" in chat_js
    stop_fn = chat_js.split("async function persistStopwatchStop", 1)[1].split("async function cancelActiveTimer", 1)[0]
    assert "await deleteStopwatchById(id)" in stop_fn
    assert stop_fn.index("await deleteStopwatchById(id)") < stop_fn.index("await persistViaSilentChat()")
    assert "isStopwatchNotFoundError" in activity_js
    assert "isStopwatchNotFoundError(error)" in stop_fn
    assert stop_fn.index("isStopwatchNotFoundError(error)") < stop_fn.index("await persistViaSilentChat()")
    assert "restoreStopwatchState(previousStopwatch, timerKey)" in stop_fn
    assert stop_fn.index("isStopwatchNotFoundError(error)") < stop_fn.index(
        "restoreStopwatchState(previousStopwatch, timerKey)"
    )
    assert "createStopwatchApiError" in activity_js
    assert "error.status = status" in activity_js
    assert "response.status === 404" in activity_js
    assert "isStopwatchStopMessage(message)" not in chat_js
    assert "bindActiveStopwatchActions" in activity_js
    assert "bindActiveTimerActions" in activity_js
    assert "findCountdownTimerForAction" in activity_js
    assert "isServerBackedStopwatch" in activity_js
    assert "serverBacked" in activity_js
    assert "isStopwatchStartMessage" in activity_js
    assert "clearAllLocalTimerState" in activity_js
    assert "isClearAllTimersMessage" in activity_js
    assert "extractCountdownTimers" in activity_js
    assert "isStopwatchStartedText" in activity_js
    assert "pruneOptimisticStopwatchesForServerTimer" in activity_js
    assert "startTimerReminders" in activity_js
    assert "active-timer-item--overdue" in activity_js
    assert "TIMER_REMINDER_INTERVAL_MS" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "ACTIVE_TIMER_TICK_MS" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert ".active-timer-action" in css_text
    assert "active-timer-item--stopwatch" in css_text
    assert "active-timer-item--overdue" in css_text
    assert "@media (min-width: 600px)" in css_text
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in css_text


def test_timer_rename_ui() -> None:
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    css_text = _load_home_css()

    assert "sanitizeTimerLabel" in activity_js
    assert "buildRenameTimerMessage" in activity_js
    assert "buildRenameStopwatchMessage" in activity_js
    assert "buildCancelTimerMessage" in activity_js
    assert 'method: "PATCH"' in activity_js
    assert "/api/timers/" in activity_js
    assert "/api/stopwatches/" in activity_js
    assert "patchTimerLabel" in activity_js
    assert "patchStopwatchLabel" in activity_js
    assert "updateCountdownTimerLabel" in activity_js
    assert "updateLocalStopwatchLabel" in activity_js
    assert "bindActiveTimerNameEdit" in activity_js
    assert "active-timer-name-input" in activity_js
    assert "createActiveTimerNameElement" in activity_js
    assert "renameActiveTimer" in chat_js
    assert "renameActiveStopwatch" in chat_js
    assert "persistTimerRename" in chat_js
    assert "postTimerRenameSilently" in chat_js
    assert "waitForServerTimerLabel" in chat_js
    assert "data.content" in chat_js
    assert "isCrossOriginApi()" not in chat_js
    assert "isCrossOriginApi" in (STATIC_DIR / "nano-api.js").read_text(encoding="utf-8")
    assert "postTimerCommand" not in chat_js
    assert "submitMessage(buildRenameTimerMessage" not in chat_js
    assert "submitMessage(buildRenameStopwatchMessage" not in chat_js
    assert "buildCancelTimerMessage(timer)" not in chat_js
    assert "buildCancelTimerMessage(id)" in chat_js
    assert ".active-timer-name--default" in css_text
    assert ".active-timer-name-input" in css_text


def test_nano_api_dev_proxy() -> None:
    api_js = (STATIC_DIR / "nano-api.js").read_text(encoding="utf-8")
    dev_server = (Path(__file__).resolve().parents[1] / "scripts" / "dev-server.mjs").read_text(
        encoding="utf-8"
    )

    assert "NANO_DEV_API_PROXY" in api_js
    assert "shouldUseDevApiProxy" in api_js
    assert "resolveApiBase" in api_js
    assert "NANO_DEV_API_PROXY" in dev_server


def test_git_pr_ui_removed() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")

    assert 'LAST_COMMAND_CATEGORIES = ["System"]' in ui_js
    assert '"Git"' not in ui_js
    assert '"GitHub"' not in ui_js
    assert "filterToolCommands" in ui_js
    assert "isExcludedToolCommand" in ui_js
    assert "ACTIVE_TIMERS_COMMAND_PATTERN" in ui_js
    assert "declined to commit" not in ui_js
    assert "lint check" not in ui_js
    assert "tests failed" not in ui_js


def test_weather_command_ui_removed() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")

    assert "WEATHER_COMMAND_PATTERN" in ui_js
    assert '"get_current_weather"' in ui_js
    assert '"weather"' in ui_js
    assert '"Current weather"' not in ui_js
    assert '"Weather"' not in ui_js


def test_hidden_tool_commands_ui_removed() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")

    assert "EXCLUDED_TOOL_COMMAND_IDS" in ui_js
    assert "HIDDEN_TOOL_COMMAND_PATTERN" in ui_js
    for command_id in (
        "rename_timer",
        "rename_stopwatch",
        "stop_stopwatches",
        "cancel_timers",
        "clear_all_timers",
        "analyze_system",
        "check_health",
        "wipe_data",
        "capabilities",
        "toggle_controls",
        "list_internal_notes",
    ):
        assert f'"{command_id}"' in ui_js
    assert '"Clear all timers"' not in ui_js
    assert '"Cancel timers"' not in ui_js
    assert '"Rename timer"' not in ui_js
    assert '"Stop stopwatch"' not in ui_js
    assert '"System analysis"' not in ui_js
    assert '"Health check"' not in ui_js
    assert '"Wipe data"' not in ui_js
    assert '"What can you do?"' not in ui_js
    assert '"Hide/show controls"' not in ui_js
    assert '"Internal notes"' not in ui_js
    assert "internal notes" not in ui_js.split("BRAINS_SECTION_PATTERNS")[1].split("STORAGE_SECTION_PATTERNS")[0]


def test_saved_timers_panel_uses_runtime_state() -> None:
    html_text = _load_index_html()
    activity_js = (STATIC_DIR / "home-activity.js").read_text(encoding="utf-8")
    view_session_js = (STATIC_DIR / "home-view-session.js").read_text(encoding="utf-8")

    assert "Saved timers" in html_text
    assert "buildPersistedStateSnapshot" in activity_js
    assert "refreshStorage" in activity_js
    assert "/api/storage" not in activity_js
    assert "loadStorage" not in activity_js
    assert 'storage: "Saved timers"' in view_session_js


def test_voice_mode_is_ui_toggle_only() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    html_text = _load_index_html()
    js_text = _load_home_js()

    waiting_fn = ui_js.split("function isWaitingForUserAnswer()", 1)[1].split("function isWaitingForAnswerActivity", 1)[0]
    assert "isListeningStateActive()" not in waiting_fn
    assert "connectBrowserMicrophone" in voice_js
    assert "microphoneReady" in state_js
    assert "VOICE_STARTING_DETAIL" in state_js
    assert "microphoneReady ? VOICE_READY_DETAIL : VOICE_STARTING_DETAIL" in ui_js
    assert "pauseWakeWordListening" in voice_js
    assert "resumeWakeWordListening" in voice_js
    assert "voice-push-toggle" not in html_text
    assert "pushToTalkActive" not in voice_js


def test_voice_mode_toggle_integration() -> None:
    html_text = _load_index_html()
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    state_js = (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    bootstrap_js = (STATIC_DIR / "home-bootstrap.js").read_text(encoding="utf-8")
    css_text = _load_home_css()

    assert 'id="voice-mode-on"' in html_text
    assert 'id="voice-mode-off"' in html_text
    assert "voiceModeEnabled" in state_js
    assert "VOICE_MODE_STORAGE_KEY" in state_js
    assert "setVoiceModeEnabled" in voice_js
    assert "initVoiceModeControl" in voice_js
    assert "connectBrowserMicrophoneIfEnabled" in voice_js
    assert "initVoiceModeControl" in bootstrap_js
    assert '"voice_mode"' in ui_js
    assert 'id="voice-push-toggle"' not in html_text
    assert ".voice-mode-toggle" in css_text
    set_voice_mode_fn = voice_js.split("async function setVoiceModeEnabled", 1)[1].split(
        "function initVoiceModeControl",
        1,
    )[0]
    assert "connectBrowserMicrophone" in set_voice_mode_fn
