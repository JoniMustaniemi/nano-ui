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
  currentActivitySnapshot = {
    ...currentActivitySnapshot,
    state: "working",
    headline: RECEIVED_TITLE,
    detail: commandLabel || RECEIVED_DETAIL,
  };
  suppressWorkingResponse = false;
  renderState();
  if (source === "voice" && voiceAvailable) {
    const spokenAck = commandLabel ? `${RECEIVED_TITLE} ${commandLabel}.` : RECEIVED_TITLE;
    await playVoice(spokenAck);
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

async function submitConfirmationAnswer(answer) {
  if (requestInFlight || reconnectInProgress) {
    return;
  }
  if (!confirmationActions || confirmationActions.hidden) {
    return;
  }
  await submitMessage(answer, "text", { confirmationAnswer: true });
}

async function submitMessage(message, source, commandHint) {
  const confirmationAnswer = Boolean(commandHint?.confirmationAnswer);
  const typedConfirmationAnswer =
    !confirmationAnswer &&
    (message === "yes" || message === "no") &&
    confirmationActions &&
    !confirmationActions.hidden;
  const isConfirmationAnswer = confirmationAnswer || typedConfirmationAnswer;

  if (isConfirmationAnswer) {
    suppressPendingRearm = true;
  }

  clearAnswerTimeoutTimer();
  answerTimeoutPending = false;
  waitingForYesNoConfirmation = false;
  syncConfirmationActions();
  if (isConfirmationAnswer) {
    returnToWakeDetection();
  }
  if (tryHandleUiCommand(message, source)) {
    await completeUiCommand(source);
    return;
  }
  if (isViewSessionActive()) {
    return;
  }
  if (isSystemCommandId(commandHint?.id)) {
    setPendingSystemCommand(commandHint.id);
  }
  showUserSpeech(message);
  requestInFlight = true;
  await acknowledgeRequest(source, commandHint);
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
    if (isConfirmationAnswer) {
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
    const followUpPrompt = isYesNoConfirmation
      ? "Reply yes to confirm or no to cancel."
      : "Hold the mic button and speak your answer.";
    setVoiceStatus("Hold the mic button after I finish speaking.");
    await playVoice(answerText);
    armVoiceFollowUp(followUpPrompt, { yesNo: isYesNoConfirmation });
    return;
  }

  await playVoice(answerText);
  returnToWakeDetection();
}

