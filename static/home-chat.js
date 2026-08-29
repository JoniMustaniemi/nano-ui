async function sendMessage() {
  const message = messageBox.value.trim();
  if (!message) {
    replyStatus.textContent = "Write a message first.";
    return;
  }
  if (isViewSessionActive()) {
    if (tryHandleUiCommand(message, "text")) {
      await completeUiCommand("text");
      messageBox.value = "";
      return;
    }
    replyStatus.textContent = "Type close to dismiss.";
    return;
  }
  if (tryHandleUiCommand(message, "text")) {
    await completeUiCommand("text");
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

async function submitMessage(message, source, commandHint) {
  const confirmationAnswer = Boolean(commandHint?.confirmationAnswer);
  const inputAnswer = Boolean(commandHint?.inputAnswer);
  const typedConfirmationAnswer =
    !confirmationAnswer &&
    (message === "yes" || message === "no") &&
    inputActions &&
    !inputActions.hidden &&
    (waitingForYesNoConfirmation || waitingForPresence);
  const isConfirmationAnswer = confirmationAnswer || typedConfirmationAnswer;
  const isPendingInputAnswer = isConfirmationAnswer || inputAnswer;

  if (isPendingInputAnswer) {
    suppressPendingRearm = true;
  }

  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  waitingForYesNoConfirmation = false;
  syncInputActions();
  if (isConfirmationAnswer) {
    returnToWakeDetection();
  } else if (inputAnswer) {
    waitingForFollowUp = false;
    waitingForVoiceAnswer = false;
    currentInputKind = null;
    syncInputActions();
  }
  if (tryHandleUiCommand(message, source)) {
    await completeUiCommand(source);
    return;
  }
  if (isViewSessionActive() && source !== "command") {
    return;
  }
  if (isSystemCommandId(commandHint?.id)) {
    setPendingSystemCommand(commandHint.id);
  }
  if (isStopwatchStartMessage(message)) {
    startLocalStopwatch({ label: parseStopwatchLabel(message) });
  } else if (isStopwatchStopMessage(message)) {
    showUserSpeech(message);
    stopAllLocalStopwatches();
    return;
  }
  showUserSpeech(message);
  requestInFlight = true;
  if (!isPendingInputAnswer) {
    await acknowledgeRequest(source, commandHint);
  }
  replyStatus.textContent = source === "voice" ? "Sending voice command..." : "Sending...";
  let answerText = "";
  let shouldSpeak = true;
  let requestFailed = false;
  try {
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
    answerText = data.content;
    shouldSpeak = data.speak !== false;
    setAnswer(answerText, { deferClearUntilSpeech: shouldSpeak, allowDuringWorking: true });
    replyStatus.textContent = "";
    await refreshStorage();
  } catch (error) {
    requestFailed = true;
    replyStatus.textContent = error.message;
    returnToWakeDetection();
    if (isPendingInputAnswer) {
      suppressPendingRearm = false;
    }
  } finally {
    requestInFlight = false;
    if (!reconnectInProgress) {
      await syncRuntimeStatus();
      if (isConfirmationAnswer) {
        returnToWakeDetection();
      }
    }
  }

  if (requestFailed || !answerText) {
    return;
  }

  if (isStopwatchStartedText(answerText)) {
    startLocalStopwatch();
  }

  const systemResponse = handleSystemCommandResponse(answerText);
  if (systemResponse.handled) {
    if (systemResponse.reconnect) {
      returnToWakeDetection();
      if (shouldSpeak) {
        await playVoice(answerText);
      }
      void beginNanoReconnect(systemResponse.kind);
      return;
    }
    if (shouldSpeak) {
      await playVoice(answerText);
    }
    returnToWakeDetection();
    return;
  }

  if (isConfirmationAnswer) {
    resetStandbySnapshot();
    if (shouldSpeak) {
      await playVoice(answerText);
    }
    suppressPendingRearm = false;
    return;
  }

  if (isWaitingForUserAnswer()) {
    if (shouldSpeak) {
      await playVoice(answerText);
    }
    ensureDirectAnswerListening();
    return;
  }

  if (!shouldSpeak) {
    returnToWakeDetection();
    return;
  }

  const needsVoiceFollowUp = answerNeedsVoiceFollowUp(answerText);
  if (needsVoiceFollowUp) {
    if (!pendingSystemCommandId) {
      const inferredCommandId =
        inferSystemCommandFromMessage(message) || inferSystemCommandFromText(answerText);
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
      : "Hold the mic button and speak your answer.";
    setVoiceStatus("Hold the mic button after I finish speaking.");
    await playVoice(answerText);
    armVoiceFollowUp(followUpPrompt, {
      yesNo: isYesNoConfirmation,
      inputKind: isTimerFollowUp ? "timer_duration" : null,
    });
    return;
  }

  await playVoice(answerText);
  returnToWakeDetection();
}

async function cancelActiveTimer(timer) {
  if (isStopwatchTimer(timer)) {
    stopLocalStopwatch(timer);
    return;
  }
  clearCountdownTimerState(timer, { suppress: true });
  refreshTimerDisplays();
  if (isBusy() || requestInFlight || reconnectInProgress) {
    replyStatus.textContent = "Wait for the current task to finish.";
    return;
  }
  const label = (timer?.label || "").trim();
  const message = label ? `Cancel the timer "${label}"` : "Cancel the timer";
  await submitMessage(message, "command");
}

