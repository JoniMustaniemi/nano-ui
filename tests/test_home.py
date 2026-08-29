from pathlib import Path

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
    assert 'id="voice-push-toggle"' in response_text
    assert 'id="input-actions"' in response_text
    assert 'class="input-action-btn"' not in response_text
    assert 'class="nano-version"' in response_text


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
    assert "sendVoiceCommand" in js_text
    assert "voice-push-toggle" in html_text
    assert ".user-speech" in css_text


def test_ui_does_not_run_browser_speech_recognition() -> None:
    js_text = _load_home_js()

    assert "SpeechRecognition" not in js_text
    assert "webkitSpeechRecognition" not in js_text
    assert "extractWakeCommand" not in js_text
    assert "pauseRecognitionForSpeech" not in js_text
    assert "listeningEnabled" not in js_text
    assert "wakeAcknowledging" not in js_text


def test_voice_flow_uploads_audio_to_pi() -> None:
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")

    assert 'nanoFetch("/api/voice/command"' in voice_js
    assert "MediaRecorder" in voice_js
    assert "FormData" in voice_js
    assert "waitingForVoiceAnswer" in voice_js


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
    assert 'acknowledgeRequest("voice")' in voice_js
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
    assert "normalizePendingOptions" in ui_js
    assert "syncInputActions" in ui_js
    assert "data-input-action" in bootstrap_js
    assert "submitInputAnswer" in bootstrap_js
    assert "open_keyboard" in bootstrap_js
    assert "timer_duration" in ui_js
    assert "note_selection" in ui_js


def test_timer_tool_command_helpers() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    chat_js = (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    voice_js = (STATIC_DIR / "home-voice.js").read_text(encoding="utf-8")

    assert "resolveToolCommandMessage" in ui_js
    assert "isTimerToolCommand" in ui_js
    assert 'return "Start a timer"' in ui_js
    assert 'source !== "command"' in chat_js
    assert "formatTimerDurationAnswer" in chat_js
    assert "answerNeedsTimerDuration" in voice_js
    assert "restoreWake: false" in ui_js


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
    assert "stopLocalStopwatch" in activity_js
    assert "isStopwatchStartMessage" in activity_js
    assert "extractCountdownTimers" in activity_js
    assert "isStopwatchStartedText" in chat_js
    assert "startTimerReminders" in activity_js
    assert "active-timer-item--overdue" in activity_js
    assert "TIMER_REMINDER_INTERVAL_MS" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert "ACTIVE_TIMER_TICK_MS" in (STATIC_DIR / "home-state.js").read_text(encoding="utf-8")
    assert ".active-timer-action" in css_text
    assert "active-timer-item--stopwatch" in css_text
    assert "active-timer-item--overdue" in css_text
    assert "@media (min-width: 600px)" in css_text
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in css_text


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
