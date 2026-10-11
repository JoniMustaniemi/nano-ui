function bindActiveTimerActions() {
  if (!activeTimersRoot || activeTimersRoot.dataset.actionsBound === "true") {
    return;
  }
  activeTimersRoot.dataset.actionsBound = "true";
  activeTimersRoot.addEventListener("click", (event) => {
    const button = event.target.closest(".active-timer-action");
    if (!button || button.disabled) {
      return;
    }
    const item = button.closest("[data-timer-key]");
    if (!item) {
      return;
    }
    const timer = findCountdownTimerForAction(item);
    if (!timer) {
      return;
    }
    const action = button.textContent.trim();
    if (action === "Cancel") {
      if (typeof cancelActiveTimer === "function") {
        void cancelActiveTimer(timer);
      }
      return;
    }
    if (action === "OK") {
      okExpiredTimer(timer);
    }
  });
}


function createActiveTimerNameElement(timer) {
  const expired = isTimerExpired(timer);
  const defaultLabel = getTimerDefaultLabel(timer);
  const name = expired
    ? "Time's up"
    : sanitizeTimerLabel(timer.label, defaultLabel);
  const nameEl = document.createElement("span");
  nameEl.className = "active-timer-name";
  if (!expired && name === defaultLabel) {
    nameEl.classList.add("active-timer-name--default");
  }
  nameEl.textContent = name;
  if (!expired) {
    nameEl.setAttribute("role", "button");
    nameEl.tabIndex = 0;
    nameEl.setAttribute(
      "aria-label",
      isStopwatchTimer(timer) ? "Rename stopwatch" : "Rename timer",
    );
  }
  return nameEl;
}

function applyActiveTimerNameToItem(item, timer) {
  if (!item || !item.isConnected || item.classList.contains("active-timer-item--editing")) {
    return;
  }
  const expired = isTimerExpired(timer);
  const defaultLabel = getTimerDefaultLabel(timer);
  const name = expired
    ? "Time's up"
    : sanitizeTimerLabel(timer.label, defaultLabel);
  let nameEl = item.querySelector(".active-timer-name");
  if (!nameEl) {
    const header = item.querySelector(".active-timer-header");
    if (!header) {
      return;
    }
    nameEl = createActiveTimerNameElement(timer);
    header.replaceChildren(nameEl);
    return;
  }
  nameEl.textContent = name;
  nameEl.classList.toggle("active-timer-name--default", !expired && name === defaultLabel);
}

function beginActiveTimerNameEdit(item, timerKey) {
  if (!item || item.classList.contains("active-timer-item--editing")) {
    return;
  }
  const timer = findActiveTimerByKey(timerKey);
  if (!timer || isTimerExpired(timer)) {
    return;
  }
  const nameEl = item.querySelector(".active-timer-name");
  if (!nameEl) {
    return;
  }
  const defaultLabel = getTimerDefaultLabel(timer);
  const currentName = sanitizeTimerLabel(timer.label, defaultLabel);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "active-timer-name-input";
  input.value = currentName === defaultLabel ? "" : currentName;
  input.setAttribute("aria-label", isStopwatchTimer(timer) ? "Stopwatch name" : "Timer name");
  input.maxLength = 64;
  item.classList.add("active-timer-item--editing");
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished || !item.classList.contains("active-timer-item--editing")) {
      return;
    }
    finished = true;
    item.classList.remove("active-timer-item--editing");
    if (commit) {
      void commitActiveTimerNameEdit(item, timerKey, input);
    } else {
      cancelActiveTimerNameEdit(item, timerKey);
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => {
    finish(true);
  });
}

async function commitActiveTimerNameEdit(item, timerKey, input) {
  const timer = findActiveTimerByKey(timerKey);
  if (!timer) {
    return;
  }
  const defaultLabel = getTimerDefaultLabel(timer);
  const nextName = sanitizeTimerLabel(input.value, defaultLabel);
  const replacement = createActiveTimerNameElement({ ...timer, label: nextName });
  if (input.isConnected) {
    input.replaceWith(replacement);
  } else if (item.isConnected) {
    const header = item.querySelector(".active-timer-header");
    if (header && !header.querySelector(".active-timer-name")) {
      header.append(replacement);
    }
  }
  if (typeof renameActiveTimer === "function") {
    await renameActiveTimer(timer, nextName);
  } else if (isStopwatchTimer(timer)) {
    updateLocalStopwatchLabel(timerKey, nextName);
  } else {
    updateCountdownTimerLabel(timerKey, nextName);
  }
  const liveItem = item.isConnected
    ? item
    : (activeTimersRoot || activeStopwatchesRoot)?.querySelector(`[data-timer-key="${timerKey}"]`);
  const refreshedTimer = findActiveTimerByKey(timerKey);
  if (liveItem && refreshedTimer) {
    applyActiveTimerNameToItem(liveItem, refreshedTimer);
  }
}

function cancelActiveTimerNameEdit(item, timerKey) {
  const timer = findActiveTimerByKey(timerKey);
  if (!timer) {
    return;
  }
  const input = item.querySelector(".active-timer-name-input");
  const replacement = createActiveTimerNameElement(timer);
  if (input) {
    input.replaceWith(replacement);
  }
}

function handleActiveTimerNameEditTrigger(event) {
  const nameEl = event.target.closest(".active-timer-name");
  if (!nameEl || nameEl.getAttribute("role") !== "button") {
    return;
  }
  const item = nameEl.closest("[data-timer-key]");
  if (!item) {
    return;
  }
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
    return;
  }
  if (event.type === "keydown") {
    event.preventDefault();
  }
  if (event.type === "click") {
    event.preventDefault();
  }
  beginActiveTimerNameEdit(item, item.dataset.timerKey);
}

function bindActiveTimerNameEdit() {
  for (const root of [activeTimersRoot, activeStopwatchesRoot]) {
    if (!root || root.dataset.nameEditBound === "true") {
      continue;
    }
    root.dataset.nameEditBound = "true";
    root.addEventListener("click", handleActiveTimerNameEditTrigger);
    root.addEventListener("keydown", handleActiveTimerNameEditTrigger);
  }
}
