async function sendMessage() {
  const message = messageBox.value.trim();
  if (!message) {
    replyStatus.textContent = "Write a message first.";
    return;
  }
  if (isViewSessionActive()) {
    if (tryHandleUiCommand(message, "text")) {
      if (lastUiCommandResult) {
        await completeUiCommand("text");
      }
      messageBox.value = "";
      return;
    }
    replyStatus.textContent = "Type close to dismiss.";
    return;
  }
  if (tryHandleUiCommand(message, "text")) {
    if (lastUiCommandResult) {
      await completeUiCommand("text");
    }
    messageBox.value = "";
    return;
  }
  if (isBusy()) {
    replyStatus.textContent = "I'm still working. Wait for the current task to finish.";
    return;
  }
  await submitMessage(message, "text");
  messageBox.value = "";
}

async function acknowledgeRequest(source, commandHint) {
  const commandLabel = (commandHint?.label || "").trim();
  const ackText = pickTaskAck();
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    state: "working",
    headline: ackText,
    detail: commandLabel || RECEIVED_DETAIL,
  };
  setAnswer(ackText, {
    animate: true,
    allowDuringWorking: true,
    isTaskAck: true,
  });
  renderState();
  const shouldSpeakAck = voiceAvailable || source === "voice";
  if (shouldSpeakAck) {
    if (source === "voice") {
      await resumeVoiceAudioContext();
    }
    await playVoice(ackText, {
      skipAnswerUpdate: true,
      allowDuringWorking: true,
      forcePlayback: source === "voice",
    });
  }
}

async function submitDefaultNoAnswer() {
  if (!isWaitingForUserAnswer() || requestInFlight) {
    return;
  }
  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  await submitMessage(DEFAULT_NO_ANSWER, "voice");
}

async function submitInputAnswer(answer) {
  if (requestInFlight || reconnectInProgress) {
    return;
  }
  if (!inputActions || inputActions.hidden) {
    return;
  }
  const isYesNo = answer === "yes" || answer === "no";
  const hint =
    isYesNo && (waitingForYesNoConfirmation || waitingForPresence)
      ? { confirmationAnswer: true }
      : { inputAnswer: true };
  let message = answer;
  if (
    !isYesNo &&
    (currentAnswerPendingKind === "timer_duration" || currentInputKind === "timer_duration")
  ) {
    message = formatTimerDurationAnswer(answer);
  }
  await submitMessage(message, "text", hint);
}

function formatTimerDurationAnswer(answer) {
  const value = String(answer || "").trim();
  if (!value || value.toLowerCase() === "cancel") {
    return value || "cancel";
  }
  if (/^start a timer\b/i.test(value)) {
    return value;
  }
  return `Start a timer for ${value}`;
}

async function submitConfirmationAnswer(answer) {
  await submitInputAnswer(answer);
}

function findToolCommandById(commandId) {
  const targetId = String(commandId || "").trim().toLowerCase();
  if (!targetId || !Array.isArray(toolCommands)) {
    return null;
  }
  return (
    toolCommands.find((command) => String(command?.id || "").trim().toLowerCase() === targetId) ||
    null
  );
}

async function followUpClearAllTimersOnServer() {
  let snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (_error) {
    return;
  }
  const remainingStopwatches = extractStopwatchSeedTimers(snapshot);
  const remainingCountdown = extractCountdownTimersFromSnapshot(snapshot);
  if (remainingStopwatches.length > 0) {
    const stopCommand = findToolCommandById("stop_stopwatches");
    const stopMessage = stopCommand ? resolveToolCommandMessage(stopCommand) : "";
    if (stopMessage) {
      await submitMessage(stopMessage, "command", stopCommand, { skipClearAllFollowUp: true });
    }
  }
  if (remainingCountdown.length > 0) {
    const cancelCommand = findToolCommandById("cancel_timers");
    const cancelMessage = cancelCommand ? resolveToolCommandMessage(cancelCommand) : "";
    if (cancelMessage) {
      await submitMessage(cancelMessage, "command", cancelCommand, { skipClearAllFollowUp: true });
    }
  }
}

function armVoiceFollowUpIfNeeded(answerText, { inferCommandFromMessage } = {}) {
  if (!answerNeedsVoiceFollowUp(answerText)) {
    return false;
  }
  if (!pendingSystemCommandId && inferCommandFromMessage) {
    const inferredCommandId =
      inferSystemCommandFromMessage(inferCommandFromMessage) || inferSystemCommandFromText(answerText);
    if (inferredCommandId) {
      setPendingSystemCommand(inferredCommandId);
    }
  }
  const isYesNoConfirmation =
    answerNeedsYesNoConfirmation(answerText) ||
    answerText.toLowerCase().includes("reply yes to proceed or no to cancel") ||
    Boolean(pendingSystemCommandId);
  const isTimerFollowUp = answerNeedsTimerDuration(answerText);
  const followUpPrompt = isYesNoConfirmation
    ? "Reply yes to confirm or no to cancel."
    : 'Say your answer after "hey nano".';
  setVoiceStatus('Say your answer after "hey nano".');
  armVoiceFollowUp(followUpPrompt, {
    yesNo: isYesNoConfirmation,
    inputKind: isTimerFollowUp ? "timer_duration" : null,
  });
  return true;
}

function buildSubmitMessageContext(message, source, commandHint, options = {}) {
  const skipClearAllFollowUp = Boolean(options.skipClearAllFollowUp);
  const confirmationAnswer = Boolean(commandHint?.confirmationAnswer);
  const inputAnswer = Boolean(commandHint?.inputAnswer);
  const typedConfirmationAnswer =
    !confirmationAnswer &&
    (message === "yes" || message === "no") &&
    (waitingForYesNoConfirmation || waitingForPresence);
  const isConfirmationAnswer = confirmationAnswer || typedConfirmationAnswer;
  const isPendingInputAnswer = isConfirmationAnswer || inputAnswer;
  const isVoicePendingAnswer =
    source === "voice" &&
    (waitingForFollowUp ||
      waitingForVoiceAnswer ||
      waitingForYesNoConfirmation ||
      currentAnswerPendingKind === "reboot_confirmation" ||
      currentAnswerPendingKind === "service_restart_confirmation" ||
      currentAnswerPendingKind === "wipe_confirmation" ||
      currentAnswerPendingKind === "timer_duration" ||
      currentInputKind === "timer_duration");

  return {
    clearAllRequested:
      !skipClearAllFollowUp &&
      (isClearAllTimersCommand(commandHint) || isClearAllTimersMessage(message)),
    confirmationAnswer,
    inputAnswer,
    isConfirmationAnswer,
    isPendingInputAnswer,
    isVoicePendingAnswer,
  };
}

function prepareSubmitMessageState(message, source, commandHint, context) {
  const { isConfirmationAnswer, inputAnswer, isVoicePendingAnswer } = context;

  if (context.isPendingInputAnswer || isVoicePendingAnswer) {
    suppressPendingRearm = true;
  }

  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  waitingForYesNoConfirmation = false;
  syncInputActions();

  if (isConfirmationAnswer) {
    returnToWakeDetection();
  } else if (inputAnswer || isVoicePendingAnswer) {
    waitingForFollowUp = false;
    waitingForVoiceAnswer = false;
    currentInputKind = null;
    syncInputActions();
  }

  if (isSystemCommandId(commandHint?.id)) {
    setPendingSystemCommand(commandHint.id);
  }
  if (isClearAllTimersCommand(commandHint) || isClearAllTimersMessage(message)) {
    clearAllLocalTimerState();
  }
}

async function sendChatRequest(message, source) {
  replyStatus.textContent = source === "voice" ? "Sending voice command..." : "Sending...";
  const response = await nanoFetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      mode: "agent",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Chat request failed.");
  }
  return {
    answerText: data.content,
    shouldSpeak: data.speak !== false,
  };
}

async function finalizeChatRequest(context) {
  requestInFlight = false;
  if (reconnectInProgress) {
    return;
  }
  await syncRuntimeStatus();
  if (rebootPendingFromStatus && !reconnectInProgress && typeof beginNanoReconnect === "function") {
    void beginNanoReconnect("reboot_pi");
  }
  if (restartPendingFromStatus && !reconnectInProgress && typeof beginNanoReconnect === "function") {
    void beginNanoReconnect("restart_nano");
  }
  if (context.clearAllRequested) {
    await followUpClearAllTimersOnServer();
  }
  if (context.isConfirmationAnswer) {
    returnToWakeDetection();
  }
}

async function handleChatSystemCommand(answerText, shouldSpeak) {
  const systemResponse = handleSystemCommandResponse(answerText);
  if (!systemResponse.handled) {
    return false;
  }
  if (systemResponse.reconnect) {
    returnToWakeDetection();
    if (typeof clearAnswerOutput === "function") {
      clearAnswerOutput();
    }
    void beginNanoReconnect(systemResponse.kind);
    if (shouldSpeak) {
      await playVoice(answerText, { skipAnswerUpdate: true });
    }
    return true;
  }
  if (shouldSpeak) {
    await playVoice(answerText);
  }
  returnToWakeDetection();
  return true;
}

async function handleChatConfirmation(answerText, shouldSpeak) {
  resetStandbySnapshot();
  if (shouldSpeak) {
    await playVoice(answerText);
  }
  suppressPendingRearm = false;
}

async function handleChatVoiceFollowUp(answerText, shouldSpeak, message) {
  if (isWaitingForUserAnswer()) {
    if (shouldSpeak) {
      await playVoice(answerText);
    }
    if (!armVoiceFollowUpIfNeeded(answerText)) {
      returnToWakeDetection();
    }
    suppressPendingRearm = false;
    return;
  }

  if (!shouldSpeak) {
    returnToWakeDetection();
    return;
  }

  if (armVoiceFollowUpIfNeeded(answerText, { inferCommandFromMessage: message })) {
    await playVoice(answerText);
    return;
  }

  await playVoice(answerText);
  returnToWakeDetection();
}

async function submitMessage(message, source, commandHint, options = {}) {
  const context = buildSubmitMessageContext(message, source, commandHint, options);
  const pendingReconnectKind = resolvePendingReconnectKind(message);
  prepareSubmitMessageState(message, source, commandHint, context);

  if (tryHandleUiCommand(message, source)) {
    if (lastUiCommandResult) {
      await completeUiCommand(source);
    }
    return;
  }
  if (isViewSessionActive() && source !== "command" && source !== "voice") {
    return;
  }

  showUserSpeech(message);
  requestInFlight = true;
  if (!context.isPendingInputAnswer) {
    await acknowledgeRequest(source, commandHint);
  }

  let answerText = "";
  let shouldSpeak = true;
  let requestFailed = false;
  try {
    const result = await sendChatRequest(message, source);
    answerText = result.answerText;
    shouldSpeak = result.shouldSpeak;
    if (!pendingReconnectKind) {
      setAnswer(answerText, { deferClearUntilSpeech: shouldSpeak, allowDuringWorking: true });
    }
    replyStatus.textContent = "";
    await refreshStorage();
  } catch (error) {
    requestFailed = true;
    replyStatus.textContent = error.message;
    returnToWakeDetection();
    if (context.isPendingInputAnswer) {
      suppressPendingRearm = false;
    }
  } finally {
    await finalizeChatRequest(context);
  }

  if (requestFailed || !answerText) {
    if (source === "voice") {
      returnToWakeDetection();
    }
    return;
  }

  if (pendingReconnectKind) {
    returnToWakeDetection();
    if (typeof clearAnswerOutput === "function") {
      clearAnswerOutput();
    }
    void beginNanoReconnect(pendingReconnectKind);
    return;
  }

  if (await handleChatSystemCommand(answerText, shouldSpeak)) {
    return;
  }

  if (context.isConfirmationAnswer) {
    await handleChatConfirmation(answerText, shouldSpeak);
    return;
  }

  await handleChatVoiceFollowUp(answerText, shouldSpeak, message);
}

async function stopActiveStopwatch(timer) {
  if (!timer) {
    return;
  }

  if (!isServerBackedStopwatch(timer)) {
    stopLocalStopwatch(timer);
    return;
  }

  const id = timer?.id != null ? String(timer.id).trim() : "";
  if (!id) {
    replyStatus.textContent = "This stopwatch cannot be stopped yet.";
    return;
  }

  const timerKey = getTimerAnnouncementKey(timer);
  const previousStopwatch = { ...timer };

  clearStopwatchState(timer);
  refreshTimerDisplays();

  if (isBusy() || requestInFlight || reconnectInProgress) {
    restoreStopwatchState(previousStopwatch, timerKey);
    replyStatus.textContent = "Wait for the current task to finish.";
    return;
  }

  await persistStopwatchStop({ id, previousStopwatch, timerKey });
}

async function postTimerAgentCommandSilently(message) {
  const response = await nanoFetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      mode: "agent",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Timer command failed.");
  }
  const errorText = String(data.content || "").trim();
  if (errorText) {
    throw new Error(errorText);
  }
  return data;
}

async function postTimerRenameSilently(message) {
  return postTimerAgentCommandSilently(message);
}

async function waitForServerTimerLabel(timerKey, expectedLabel, defaultLabel) {
  const expected = sanitizeTimerLabel(expectedLabel, defaultLabel);
  for (let attempt = 0; attempt < TIMER_SERVER_SYNC_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, TIMER_SERVER_SYNC_POLL_MS);
      });
    }
    await syncRuntimeStatus();
    const timer = findActiveTimerByKey(timerKey);
    if (timer && sanitizeTimerLabel(timer.label, defaultLabel) === expected) {
      return true;
    }
  }
  return false;
}

async function persistTimerRename({
  timerKey,
  id,
  sanitized,
  defaultLabel,
  previousLabel,
  updateLabel,
  patchFn,
  buildMessage,
}) {
  const persistViaSilentChat = async () => {
    await postTimerRenameSilently(buildMessage(id, sanitized));
    const persisted = await waitForServerTimerLabel(timerKey, sanitized, defaultLabel);
    if (!persisted) {
      throw new Error("Timer rename did not save.");
    }
  };

  try {
    const updated = await patchFn(id, sanitized);
    updateLabel(timerKey, sanitizeTimerLabel(updated.label, defaultLabel));
    return;
  } catch (_error) {
    // Fall through to silent chat when PATCH is unavailable.
  }

  try {
    await persistViaSilentChat();
  } catch (error) {
    updateLabel(timerKey, previousLabel);
    replyStatus.textContent = error.message || "Could not save timer name.";
  }
}

async function renameActiveStopwatch(timer, newLabel) {
  if (!timer) {
    return;
  }
  const defaultLabel = "Stopwatch";
  const sanitized = sanitizeTimerLabel(newLabel, defaultLabel);
  const currentLabel = sanitizeTimerLabel(timer.label, defaultLabel);
  if (sanitized === currentLabel) {
    return;
  }

  const timerKey = getTimerAnnouncementKey(timer);
  const previousLabel = timer.label;
  updateLocalStopwatchLabel(timerKey, sanitized);

  if (!isServerBackedStopwatch(timer)) {
    return;
  }

  const id = String(timer.id || "").trim();
  if (!id) {
    return;
  }

  await persistTimerRename({
    timerKey,
    id,
    sanitized,
    defaultLabel,
    previousLabel,
    updateLabel: updateLocalStopwatchLabel,
    patchFn: patchStopwatchLabel,
    buildMessage: buildRenameStopwatchMessage,
  });
}

async function renameActiveTimer(timer, newLabel) {
  if (!timer) {
    return;
  }
  if (isStopwatchTimer(timer)) {
    await renameActiveStopwatch(timer, newLabel);
    return;
  }

  const defaultLabel = "Timer";
  const sanitized = sanitizeTimerLabel(newLabel, defaultLabel);
  const currentLabel = sanitizeTimerLabel(timer.label, defaultLabel);
  if (sanitized === currentLabel) {
    return;
  }

  const timerKey = getTimerAnnouncementKey(timer);
  const previousLabel = timer.label;
  updateCountdownTimerLabel(timerKey, sanitized);

  const id = String(timer.id || "").trim();
  if (!id) {
    return;
  }

  await persistTimerRename({
    timerKey,
    id,
    sanitized,
    defaultLabel,
    previousLabel,
    updateLabel: updateCountdownTimerLabel,
    patchFn: patchTimerLabel,
    buildMessage: buildRenameTimerMessage,
  });
}

async function persistTimerCancel({ id, previousTimer, timerKey }) {
  const persistViaSilentChat = async () => {
    await postTimerAgentCommandSilently(buildCancelTimerMessage(id));
    const removed = await waitForServerTimerRemoved(id);
    if (!removed) {
      throw new Error("Timer cancel did not complete.");
    }
  };

  try {
    await deleteTimerById(id);
    const removed = await waitForServerTimerRemoved(id);
    if (!removed) {
      throw new Error("Timer cancel did not complete.");
    }
    return;
  } catch (_error) {
    // Fall through to silent chat when DELETE is unavailable.
  }

  try {
    await persistViaSilentChat();
  } catch (error) {
    restoreCountdownTimerState(previousTimer, timerKey);
    replyStatus.textContent = error.message || "Could not cancel timer.";
  }
}

async function persistStopwatchStop({ id, previousStopwatch, timerKey }) {
  const persistViaSilentChat = async () => {
    await postTimerAgentCommandSilently(buildStopStopwatchMessage(id));
    const removed = await waitForServerStopwatchRemoved(id);
    if (!removed) {
      throw new Error("Stopwatch stop did not complete.");
    }
  };

  try {
    await deleteStopwatchById(id);
    const removed = await waitForServerStopwatchRemoved(id);
    if (!removed) {
      throw new Error("Stopwatch stop did not complete.");
    }
    return;
  } catch (error) {
    if (isStopwatchNotFoundError(error)) {
      restoreStopwatchState(previousStopwatch, timerKey);
      replyStatus.textContent = error.message || "Stopwatch not found.";
      return;
    }
    // Fall through to silent chat when DELETE is unavailable.
  }

  try {
    await persistViaSilentChat();
  } catch (error) {
    restoreStopwatchState(previousStopwatch, timerKey);
    replyStatus.textContent = error.message || "Could not stop stopwatch.";
  }
}

async function cancelActiveTimer(timer) {
  if (isStopwatchTimer(timer)) {
    await stopActiveStopwatch(timer);
    return;
  }
  const id = timer?.id != null ? String(timer.id).trim() : "";
  if (!id) {
    replyStatus.textContent = "This timer cannot be cancelled yet.";
    return;
  }

  const timerKey = getTimerAnnouncementKey(timer);
  const previousTimer = { ...timer };

  clearCountdownTimerState(timer, { suppress: true });
  refreshTimerDisplays();

  if (isBusy() || requestInFlight || reconnectInProgress) {
    restoreCountdownTimerState(previousTimer, timerKey);
    replyStatus.textContent = "Wait for the current task to finish.";
    return;
  }

  await persistTimerCancel({ id, previousTimer, timerKey });
}

