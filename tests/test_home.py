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
    active_timers_index = response_text.index('id="active-timers"')
    essence_index = response_text.index('class="essence-zone"')
    assert answer_index < user_speech_index < active_timers_index < essence_index
    assert 'id="voice-push-toggle"' in response_text
    assert 'id="confirmation-actions"' in response_text
    assert 'id="confirmation-yes"' in response_text
    assert 'id="confirmation-no"' in response_text
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
    assert "submitConfirmationAnswer" in (STATIC_DIR / "home-chat.js").read_text(encoding="utf-8")
    assert "syncConfirmationActions" in (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")
    assert "loadNanoVersionFromBackend" in bootstrap_js
    assert 'nanoFetch("/api/health")' in bootstrap_js


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
    assert "isConfirmationAnswer" in chat_js
    assert "suppressPendingRearm" in chat_js
    assert "resetStandbySnapshot()" in chat_js
    assert "returnToWakeDetection()" in chat_js
    assert "renderState();" in voice_js.split("function returnToWakeDetection()")[1]
    assert "suppressPendingRearm" in activity_js


def test_git_pr_ui_removed() -> None:
    ui_js = (STATIC_DIR / "home-ui.js").read_text(encoding="utf-8")

    assert 'LAST_COMMAND_CATEGORIES = ["System"]' in ui_js
    assert '"Git"' not in ui_js
    assert '"GitHub"' not in ui_js
    assert "filterToolCommands" in ui_js
    assert "isExcludedToolCommand" in ui_js
    assert "declined to commit" not in ui_js
    assert "lint check" not in ui_js
    assert "tests failed" not in ui_js
