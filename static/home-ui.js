function initEssence() {
  if (typeof window.initEssenceOrbs === "function") {
    window.initEssenceOrbs();
    mainEssence = window.mainEssence || null;
  }
}

function updateEssenceState() {
  let state = getDisplayState();
  if (speakingActive) {
    state = "speaking";
  }
  if (stateLine.textContent === "reconnecting" || reconnectInProgress) {
    state = connectionOverlayMode === "rebooting" ? "rebooting" : "reconnecting";
  }
  if (mainEssence) {
    mainEssence.setState(state);
  }
}

function isWorkingOnTask() {
  return requestInFlight || currentActivitySnapshot.state === "working";
}


function applyControlsVisibility() {
  document.body.classList.toggle("controls-hidden", shouldSuppressControlsChrome());
  if (getDisplayState() === "working") {
    closeKeyboardPanel();
    closeViewSession({ reason: "working", restoreWake: false });
  }
}

function setControlsHidden(hidden) {
  if (!hidden && getDisplayState() === "working") {
    return;
  }
  controlsHidden = hidden;
  if (controlsHidden) {
    closeKeyboardPanel();
    closeViewSession({ reason: "controls", restoreWake: false });
  }
  applyControlsVisibility();
}

function toggleControlsHidden() {
  setControlsHidden(!controlsHidden);
}

function clearUserSpeechTimers() {
  if (userSpeechFadeTimer !== null) {
    window.clearTimeout(userSpeechFadeTimer);
    userSpeechFadeTimer = null;
  }
  if (userSpeechHideTimer !== null) {
    window.clearTimeout(userSpeechHideTimer);
    userSpeechHideTimer = null;
  }
}

function hideUserSpeechImmediate() {
  clearUserSpeechTimers();
  if (!userSpeech) {
    return;
  }
  userSpeech.classList.remove("visible", "fade-out");
  userSpeech.hidden = true;
  if (userSpeechText) {
    userSpeechText.textContent = "";
  }
}

function scheduleUserSpeechFadeOut() {
  clearUserSpeechTimers();
  userSpeechFadeTimer = window.setTimeout(() => {
    userSpeechFadeTimer = null;
    if (!userSpeech) {
      return;
    }
    userSpeech.classList.remove("visible");
    userSpeech.classList.add("fade-out");
    userSpeechHideTimer = window.setTimeout(() => {
      userSpeechHideTimer = null;
      if (!userSpeech) {
        return;
      }
      userSpeech.classList.remove("fade-out");
      userSpeech.hidden = true;
      if (userSpeechText) {
        userSpeechText.textContent = "";
      }
    }, USER_SPEECH_FADE_MS);
  }, USER_SPEECH_DISPLAY_MS);
}

function showUserSpeech(text) {
  const content = (text || "").trim();
  if (!content || !userSpeech || !userSpeechText) {
    hideUserSpeechImmediate();
    return;
  }

  const wasVisible = userSpeech.classList.contains("visible") && !userSpeech.hidden;
  userSpeechText.textContent = content;
  userSpeech.hidden = false;
  userSpeech.classList.remove("fade-out");

  if (!wasVisible) {
    userSpeech.classList.remove("visible");
    requestAnimationFrame(() => {
      userSpeech.classList.add("visible");
    });
  }

  scheduleUserSpeechFadeOut();
}

function resolveListeningIntent() {
  if (isViewSessionActive()) {
    return "view_session";
  }
  if (waitingForPresence) {
    return "presence";
  }
  if (waitingForFollowUp || waitingForVoiceAnswer) {
    return "follow_up";
  }
  if (waitingForWakeCommand) {
    return "wake_command";
  }
  if (voiceModeEnabled && !keyboardOpen) {
    return "voice_mode";
  }
  return null;
}

function isListeningStateActive() {
  const intent = resolveListeningIntent();
  return (
    intent === "presence" ||
    intent === "follow_up" ||
    intent === "view_session" ||
    intent === "wake_command" ||
    intent === "voice_mode"
  );
}

function isWaitingForUserAnswer() {
  return waitingForPresence || waitingForFollowUp || waitingForVoiceAnswer;
}

function isWaitingForAnswerActivity() {
  return waitingForPresence || waitingForFollowUp;
}

function shouldDeferAnswerClear(options = {}) {
  return Boolean(options.deferClearUntilSpeech || speakingActive);
}

function resolveActivityHeadline() {
  const displayState = getDisplayState();
  const intent = resolveListeningIntent();
  let headline = (currentActivitySnapshot.headline || "").trim();
  let detail = (currentActivitySnapshot.detail || "").trim();

  if (displayState === "working") {
    if (!headline || headline === STANDBY_HEADLINE) {
      headline = detail || WORKING_DETAIL_DEFAULT;
    }
  } else if (intent === "presence") {
    headline = PRESENCE_LISTEN_HEADLINE;
    detail = PRESENCE_LISTEN_DETAIL;
  } else if (waitingForFollowUp || waitingForVoiceAnswer) {
    headline = WAITING_FOR_ANSWER_HEADLINE;
    detail = "";
  } else if (intent === "wake_command") {
    headline = 'Heard "hey nano".';
    detail = "What can I help with?";
  } else if (intent === "view_session") {
    headline = VIEW_SESSION_HEADLINE;
    detail = "";
  } else if (intent === "voice_mode") {
    headline = VOICE_READY_HEADLINE;
    detail = microphoneReady ? VOICE_READY_DETAIL : VOICE_STARTING_DETAIL;
  } else if (displayState === "listening") {
    if (!headline || headline === STANDBY_HEADLINE) {
      headline = LISTENING_HEADLINE_DEFAULT;
    }
  } else if (!headline) {
    headline = currentStandbyGreeting || STANDBY_HEADLINE;
  }

  if (detail && detail !== headline && !headline.includes(detail)) {
    if (headline === STANDBY_HEADLINE && detail === STANDBY_DETAIL_DEFAULT) {
      return currentStandbyGreeting || STANDBY_HEADLINE;
    }
    return `${headline} — ${detail}`;
  }
  if (headline && headline !== STANDBY_HEADLINE) {
    return headline;
  }
  return currentStandbyGreeting || STANDBY_HEADLINE;
}

function isDefaultStandbyHeadline(headline) {
  if (!headline || headline === STANDBY_HEADLINE) {
    return true;
  }
  if (currentStandbyGreeting && headline === currentStandbyGreeting) {
    return true;
  }
  const standbyWithDetail = `${STANDBY_HEADLINE} — ${STANDBY_DETAIL_DEFAULT}`;
  return headline === standbyWithDetail;
}

function isIdleStandbyGreeting(headline) {
  const cleaned = (headline || "").trim();
  return Boolean(cleaned && currentStandbyGreeting && cleaned === currentStandbyGreeting);
}

function hasCustomStandbyActivityCopy() {
  const state = currentActivitySnapshot.state;
  if (state !== "standby" && state !== "error") {
    return false;
  }
  const headline = (currentActivitySnapshot.headline || "").trim();
  const detail = (currentActivitySnapshot.detail || "").trim();
  if (isTransientActivityCopy(headline, detail)) {
    return true;
  }
  if (isIdleStandbyGreeting(headline)) {
    return false;
  }
  if (!headline || headline === STANDBY_HEADLINE) {
    return Boolean(detail && detail !== STANDBY_DETAIL_DEFAULT);
  }
  return true;
}

function isTransientActivityCopy(headline, detail) {
  const lowered = `${headline || ""} ${detail || ""}`.toLowerCase();
  if (!lowered.trim()) {
    return false;
  }
  return (
    lowered.includes("could not complete")
  );
}

function shouldScheduleActivityClear() {
  if (isWaitingForAnswerActivity()) {
    return false;
  }
  if (getDisplayState() === "working") {
    return true;
  }
  const headline = (currentActivitySnapshot.headline || "").trim();
  const detail = (currentActivitySnapshot.detail || "").trim();
  return isTransientActivityCopy(headline, detail) || hasCustomStandbyActivityCopy();
}

function resetTransientActivityCopy() {
  if (isWaitingForAnswerActivity()) {
    return;
  }
  const headline = (currentActivitySnapshot.headline || "").trim();
  const detail = (currentActivitySnapshot.detail || "").trim();
  if (!isTransientActivityCopy(headline, detail)) {
    return;
  }
  resetStandbySnapshot();
  clearActivityStatusDisplay();
}

function cancelStatusReveal() {
  if (statusRevealTimer !== null) {
    window.clearTimeout(statusRevealTimer);
    statusRevealTimer = null;
  }
  activityStatusText.classList.remove("rolling");
}

function revealStatusRolling(content, onComplete) {
  const tokens = content.match(/\S+\s*/gu) || [content];
  let index = 0;
  activityStatusText.textContent = "";
  activityStatusText.classList.add("rolling");

  const step = () => {
    if (index >= tokens.length) {
      activityStatusText.classList.remove("rolling");
      statusRevealTimer = null;
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }
    activityStatusText.textContent += tokens[index];
    index += 1;
    const delay = content.length > 180 ? 14 : content.length > 100 ? 20 : content.length > 50 ? 28 : 36;
    statusRevealTimer = window.setTimeout(step, delay);
  };

  step();
}

function shouldShowActivityStatus() {
  if (getDisplayState() === "working") {
    return false;
  }
  if (isWaitingForAnswerActivity()) {
    return true;
  }
  return isListeningStateActive();
}

function isBaseAnswerContent(content) {
  return (content || "").trim() === IDLE_RESPONSE;
}

function restoreBaseAnswer() {
  if (getDisplayState() === "working" || requestInFlight) {
    answerClearPending = true;
    return;
  }
  resetTransientActivityCopy();
  setAnswer(IDLE_RESPONSE, {
    animate: false,
    bypassSpeechGuard: true,
    isBaseState: true,
  });
}

function hasVisibleAnswerContent() {
  if (answerOutput.classList.contains("working")) {
    return false;
  }
  return hasScheduledAnswerContent();
}

function clearActivityStatusDisplay() {
  cancelStatusReveal();
  lastRenderedStatusText = "";
  activityStatusText.textContent = "";
  activityStatus.hidden = true;
}

function renderActivityStatus(options = {}) {
  if (!shouldShowActivityStatus()) {
    clearActivityStatusDisplay();
    clearStatusClearTimer();
    statusClearPending = false;
    return;
  }

  activityStatus.hidden = false;
  const animate = options.animate !== false;
  const headline = resolveActivityHeadline();
  const displayState = getDisplayState();

  if (headline !== lastRenderedStatusText) {
    const shouldAnimate =
      animate &&
      headline &&
      !(displayState === "working" && lastRenderedStatusText);

    cancelStatusReveal();
    lastRenderedStatusText = headline;
    if (shouldAnimate) {
      revealStatusRolling(headline);
    } else {
      activityStatusText.textContent = headline;
    }
  }

  if (shouldScheduleActivityClear()) {
    scheduleStatusClear();
    return;
  }
  clearStatusClearTimer();
  statusClearPending = false;
}

function shouldDeferStatusClear() {
  return isListeningStateActive() || isViewSessionActive();
}

function resetActivityStatusIfIdle() {
  if (shouldDeferStatusClear()) {
    statusClearPending = true;
    return;
  }
  statusClearPending = false;
  if (getDisplayState() === "working") {
    currentActivitySnapshot = {
      ...currentActivitySnapshot,
      detail: null,
    };
    renderActivityStatus({ animate: false });
    return;
  }
  const hadCustomCopy = hasCustomStandbyActivityCopy();
  if (hadCustomCopy) {
    resetStandbySnapshot();
    void acknowledgePresenceDismissal();
    return;
  }
  clearActivityStatusDisplay();
}

function startWorkingResponse() {
  if (answerOutput.classList.contains("working")) {
    return;
  }
  if (answerOutput.dataset.taskAck === "true") {
    return;
  }
  if (suppressWorkingResponse || isWaitingForUserAnswer()) {
    return;
  }
  cancelAnswerReveal();
  cancelStatusReveal();
  clearAnswerClearTimer();
  clearStatusClearTimer();
  if (!answerOutput.classList.contains("empty")) {
    savedResponseBeforeWorking = answerOutput.textContent;
  } else {
    savedResponseBeforeWorking = null;
  }
  answerOutput.classList.add("working");
  answerOutput.classList.remove("empty");
  applyResponseTypography(3);
  let step = 0;
  const tick = () => {
    step = (step % 3) + 1;
    answerOutput.textContent = ".".repeat(step);
  };
  tick();
  workingDotsTimer = window.setInterval(tick, 450);
}

function stopWorkingResponse({ restore = true } = {}) {
  if (workingDotsTimer !== null) {
    window.clearInterval(workingDotsTimer);
    workingDotsTimer = null;
  }
  if (!answerOutput.classList.contains("working")) {
    savedResponseBeforeWorking = null;
    return;
  }
  answerOutput.classList.remove("working");
  if (!restore) {
    savedResponseBeforeWorking = null;
    return;
  }
  if (savedResponseBeforeWorking) {
    answerOutput.textContent = savedResponseBeforeWorking;
    answerOutput.classList.remove("empty");
    applyResponseTypography(savedResponseBeforeWorking.length);
    savedResponseBeforeWorking = null;
    return;
  }
  if (!hasScheduledAnswerContent()) {
    restoreBaseAnswer();
  }
}

function renderState() {
  const displayState = reconnectInProgress ? "reconnecting" : getDisplayState();
  if (!reconnectInProgress) {
    stateLine.textContent = displayState;
  }
  document.body.dataset.displayState = displayState;
  applyControlsVisibility();
  renderActivityStatus();
  if (displayState === "working") {
    if (!suppressWorkingResponse) {
      startWorkingResponse();
    }
  } else {
    suppressWorkingResponse = false;
    stopWorkingResponse();
    if (answerClearPending) {
      resumeAnswerClearAfterSpeech();
    }
  }
  updateEssenceState();
  updateInputLock();
  syncInputActions();
  syncDebugNanoState();
}

function resetVoiceListeningMode() {
  waitingForVoiceAnswer = false;
  waitingForFollowUp = false;
  waitingForYesNoConfirmation = false;
  currentAnswerPendingKind = null;
}

function openKeyboardPanel() {
  if (getDisplayState() === "working") {
    return;
  }
  keyboardOpen = true;
  keyboardPanel.hidden = false;
  document.body.classList.add("keyboard-open");
  messageBox.focus();
}

function closeKeyboardPanel() {
  keyboardOpen = false;
  document.body.classList.remove("keyboard-open");
  keyboardPanel.hidden = true;
}

function cancelAnswerReveal() {
  if (answerRevealTimer !== null) {
    window.clearTimeout(answerRevealTimer);
    answerRevealTimer = null;
  }
  answerOutput.classList.remove("rolling");
}

function computeResponseFontSize(length) {
  if (length <= 90) {
    return "clamp(1.35rem, 3.5vw + 0.6rem, 2.6rem)";
  }
  if (length <= 180) {
    return "clamp(1.15rem, 2.8vw + 0.45rem, 2.1rem)";
  }
  if (length <= 320) {
    return "clamp(1rem, 2.2vw + 0.3rem, 1.65rem)";
  }
  if (length <= 480) {
    return "clamp(0.92rem, 1.8vw + 0.2rem, 1.35rem)";
  }
  return "clamp(0.82rem, 1.4vw + 0.15rem, 1.1rem)";
}

function applyResponseTypography(length) {
  answerOutput.style.setProperty("--response-font-size", computeResponseFontSize(length));
}

function revealAnswerRolling(content, onComplete) {
  const tokens = content.match(/\S+\s*/gu) || [content];
  let index = 0;
  answerOutput.textContent = "";
  answerOutput.classList.add("rolling");

  const step = () => {
    if (index >= tokens.length) {
      answerOutput.classList.remove("rolling");
      answerRevealTimer = null;
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }
    answerOutput.textContent += tokens[index];
    index += 1;
    const delay = content.length > 420 ? 18 : content.length > 240 ? 24 : content.length > 120 ? 32 : 42;
    answerRevealTimer = window.setTimeout(step, delay);
  };

  step();
}

function clearAnswerClearTimer() {
  if (answerClearTimer !== null) {
    window.clearTimeout(answerClearTimer);
    answerClearTimer = null;
  }
}

function clearStatusClearTimer() {
  if (statusClearTimer !== null) {
    window.clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
}

function scheduleStatusClear() {
  if (speakingActive) {
    statusClearPending = true;
    return;
  }
  clearStatusClearTimer();
  statusClearPending = false;
  statusClearTimer = window.setTimeout(() => {
    statusClearTimer = null;
    if (speakingActive) {
      statusClearPending = true;
      return;
    }
    resetActivityStatusIfIdle();
  }, ANSWER_CLEAR_DELAY_MS);
}

function clearAnswerTimeoutTimer() {
  if (answerTimeoutTimer !== null) {
    window.clearTimeout(answerTimeoutTimer);
    answerTimeoutTimer = null;
  }
}

function scheduleAnswerTimeout() {
  if (!isWaitingForUserAnswer()) {
    clearAnswerTimeoutTimer();
    answerTimeoutPending = false;
    return;
  }
  if (speakingActive) {
    answerTimeoutPending = true;
    return;
  }
  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  answerTimeoutTimer = window.setTimeout(() => {
    answerTimeoutTimer = null;
    if (speakingActive || requestInFlight) {
      answerTimeoutPending = true;
      return;
    }
    if (!isWaitingForUserAnswer()) {
      return;
    }
    void submitDefaultNoAnswer();
  }, ANSWER_CLEAR_DELAY_MS);
}

function scheduleAnswerClear() {
  if (isWaitingForUserAnswer()) {
    answerClearPending = false;
    return;
  }
  if (getDisplayState() === "working" || requestInFlight) {
    answerClearPending = true;
    return;
  }
  if (speakingActive) {
    answerClearPending = true;
    return;
  }
  clearAnswerClearTimer();
  answerClearPending = false;
  answerClearTimer = window.setTimeout(() => {
    answerClearTimer = null;
    if (speakingActive) {
      answerClearPending = true;
      return;
    }
    if (isWaitingForUserAnswer()) {
      return;
    }
    restoreBaseAnswer();
  }, ANSWER_CLEAR_DELAY_MS);
}

function resumeStatusClearIfPending() {
  if (speakingActive || shouldDeferStatusClear()) {
    statusClearPending = true;
    return;
  }
  if (
    !statusClearPending &&
    getDisplayState() !== "working" &&
    !hasCustomStandbyActivityCopy()
  ) {
    return;
  }
  statusClearPending = false;
  scheduleStatusClear();
}

function hasScheduledAnswerContent() {
  const content = (answerOutput.textContent || "").trim();
  return Boolean(content && !isBaseAnswerContent(content));
}

function resumeAnswerClearAfterSpeech() {
  resumeStatusClearIfPending();
  if (isWaitingForUserAnswer()) {
    answerClearPending = false;
    if (speakingActive) {
      answerTimeoutPending = true;
      return;
    }
    scheduleAnswerTimeout();
    return;
  }
  if (!hasScheduledAnswerContent()) {
    answerClearPending = false;
    return;
  }
  if (getDisplayState() === "working" || requestInFlight) {
    answerClearPending = true;
    return;
  }
  answerClearPending = false;
  scheduleAnswerClear();
}

function isConfusedReply(text) {
  const lowered = String(text || "").toLowerCase();
  return (
    /does not resolve/.test(lowered) ||
    /not in my catalog/.test(lowered) ||
    /can't help with that/.test(lowered) ||
    /don't understand/.test(lowered) ||
    /not sure what you mean/.test(lowered)
  );
}

function clearAnswerOutput() {
  stopWorkingResponse({ restore: false });
  clearAnswerClearTimer();
  clearAnswerTimeoutTimer();
  answerClearPending = false;
  cancelAnswerReveal();
  if (!answerOutput) {
    return;
  }
  answerOutput.textContent = "";
  answerOutput.classList.add("empty");
  answerOutput.classList.remove("working", "rolling");
  delete answerOutput.dataset.taskAck;
  delete answerOutput.dataset.confused;
  savedResponseBeforeWorking = null;
  applyResponseTypography(IDLE_RESPONSE.length);
  renderActivityStatus();
}

function setAnswer(text, options = {}) {
  const content = text.trim();
  const animate = options.animate !== false;
  const bypassSpeechGuard = options.bypassSpeechGuard === true;
  const isTaskAck = options.isTaskAck === true;
  const isBaseState = options.isBaseState === true || isBaseAnswerContent(content);
  const preserveWorkingDots =
    !options.allowDuringWorking &&
    isWorkingOnTask();

  if (preserveWorkingDots) {
    renderActivityStatus();
    return;
  }

  if (!content && speakingActive && !bypassSpeechGuard) {
    answerClearPending = true;
    return;
  }

  if (content) {
    suppressWorkingResponse = true;
    stopWorkingResponse({ restore: false });
  }

  if (!isWaitingForUserAnswer()) {
    clearAnswerClearTimer();
    answerClearPending = false;
  }
  cancelAnswerReveal();
  if (!content) {
    answerOutput.textContent = "";
    answerOutput.classList.add("empty");
    delete answerOutput.dataset.taskAck;
    delete answerOutput.dataset.confused;
    applyResponseTypography(IDLE_RESPONSE.length);
    renderActivityStatus();
    return;
  }
  if (isTaskAck) {
    answerOutput.dataset.taskAck = "true";
  } else {
    delete answerOutput.dataset.taskAck;
  }
  if (options.confused === true || isConfusedReply(content)) {
    answerOutput.dataset.confused = "true";
  } else {
    delete answerOutput.dataset.confused;
  }
  answerOutput.classList.remove("empty");
  applyResponseTypography(content.length);

  const finish = () => {
    renderActivityStatus();
    if (isBaseState || isWaitingForUserAnswer() || isTaskAck) {
      return;
    }
    if (shouldDeferAnswerClear(options)) {
      answerClearPending = true;
      return;
    }
    scheduleAnswerClear();
  };

  if (!animate) {
    answerOutput.textContent = content;
    finish();
    return;
  }

  revealAnswerRolling(content, finish);
}
