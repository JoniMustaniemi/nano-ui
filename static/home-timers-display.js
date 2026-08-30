function renderActiveTimerItem(timer, { hero = false } = {}) {
  const item = document.createElement("article");
  const expired = isTimerExpired(timer);
  item.className = "active-timer-item";
  item.dataset.timerKey = getTimerAnnouncementKey(timer);
  const timerId = timer?.id != null ? String(timer.id).trim() : "";
  if (timerId) {
    item.dataset.timerId = timerId;
  }
  if (hero) {
    item.classList.add("active-timer-item--hero");
  }
  if (isStopwatchTimer(timer)) {
    item.classList.add("active-timer-item--stopwatch");
  } else {
    item.classList.add("active-timer-item--countdown");
  }
  if (expired) {
    item.classList.add("active-timer-item--overdue");
  }

  const name = sanitizeTimerLabel(timer.label, getTimerDefaultLabel(timer));
  const defaultLabel = getTimerDefaultLabel(timer);

  const header = document.createElement("div");
  header.className = "active-timer-header";
  header.append(createActiveTimerNameElement(timer));

  const clock = document.createElement("span");
  clock.className = "active-timer-clock";
  const displaySeconds = getActiveTimerDisplaySeconds(timer);
  clock.textContent = formatTaskWaitClock(displaySeconds);
  clock.setAttribute("role", "timer");

  const meta = document.createElement("span");
  meta.className = "active-timer-meta";
  if (expired) {
    meta.textContent = "Overdue";
  } else if (isStopwatchTimer(timer)) {
    meta.textContent = "Elapsed";
  } else {
    const total = getTimerTotalSeconds(timer);
    meta.textContent = total > 0 ? `of ${formatTaskWaitClock(total)}` : "Remaining";
  }

  item.append(header, clock, meta);

  if (expired) {
    const progress = document.createElement("div");
    progress.className = "active-timer-progress active-timer-progress--overdue";
    progress.append(document.createElement("span"));
    progress.firstElementChild.className = "active-timer-progress-indeterminate";
    item.append(progress);
  } else {
    const progressValue = getTimerProgress(timer);
    if (isStopwatchTimer(timer)) {
      const progress = document.createElement("div");
      progress.className = "active-timer-progress active-timer-progress--stopwatch";
      progress.append(document.createElement("span"));
      progress.firstElementChild.className = "active-timer-progress-indeterminate";
      item.append(progress);
    } else if (progressValue !== null) {
      const progress = document.createElement("div");
      progress.className = "active-timer-progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(Math.round(progressValue * 100)));
      const fill = document.createElement("span");
      fill.className = "active-timer-progress-fill";
      fill.style.width = `${Math.round(progressValue * 100)}%`;
      progress.append(fill);
      item.append(progress);
    }
  }

  const actions = document.createElement("div");
  actions.className = "active-timer-actions";
  const actionButton = document.createElement("button");
  actionButton.type = "button";
  actionButton.className = "active-timer-action";
  if (expired) {
    actionButton.textContent = "OK";
    actionButton.setAttribute("aria-label", "Acknowledge timer");
  } else {
    actionButton.textContent = isStopwatchTimer(timer) ? "Stop" : "Cancel";
  }
  actions.append(actionButton);
  item.append(actions);

  const ariaLabel = name && name !== defaultLabel ? `${name} ${clock.textContent}` : `${defaultLabel} ${clock.textContent}`;
  item.setAttribute("aria-label", ariaLabel);
  return item;
}

function renderActiveTimersGrid(timers, { singleTypeMode = false } = {}) {
  const grid = document.createElement("div");
  grid.className = "active-timers-grid";
  if (singleTypeMode) {
    grid.classList.add("active-timers-grid--single-type");
  }
  for (const timer of timers) {
    grid.appendChild(renderActiveTimerItem(timer, { hero: singleTypeMode && timers.length === 1 }));
  }
  return grid;
}

let activeTimersRenderSignature = "";
let activeStopwatchesRenderSignature = "";

function getActiveTimersLayoutSignature(timers) {
  const items = Array.isArray(timers) ? timers : [];
  const itemSignature = items
    .map((timer) => `${getTimerAnnouncementKey(timer)}:${isTimerExpired(timer) ? "expired" : "active"}:countdown`)
    .join("|");
  return `grid:${itemSignature}`;
}

function getActiveStopwatchesLayoutSignature(stopwatches) {
  const items = Array.isArray(stopwatches) ? stopwatches : [];
  const itemSignature = items
    .map((timer) => `${getTimerAnnouncementKey(timer)}:stopwatch`)
    .join("|");
  return `grid:${itemSignature}`;
}

function updateActiveTimerItemElement(item, timer) {
  const clock = item.querySelector(".active-timer-clock");
  if (!clock) {
    return;
  }
  const displaySeconds = getActiveTimerDisplaySeconds(timer);
  const formattedClock = formatTaskWaitClock(displaySeconds);
  if (clock.textContent !== formattedClock) {
    clock.textContent = formattedClock;
  }

  const progressFill = item.querySelector(".active-timer-progress-fill");
  if (progressFill) {
    const progressValue = getTimerProgress(timer);
    if (progressValue !== null) {
      const percent = Math.round(progressValue * 100);
      progressFill.style.width = `${percent}%`;
      const progress = progressFill.parentElement;
      if (progress) {
        progress.setAttribute("aria-valuenow", String(percent));
      }
    }
  }

  applyActiveTimerNameToItem(item, timer);

  const timerId = timer?.id != null ? String(timer.id).trim() : "";
  if (timerId) {
    if (item.dataset.timerId !== timerId) {
      item.dataset.timerId = timerId;
    }
  } else if (item.dataset.timerId) {
    delete item.dataset.timerId;
  }

  const name = sanitizeTimerLabel(timer.label, getTimerDefaultLabel(timer));
  const defaultLabel = getTimerDefaultLabel(timer);
  const ariaLabel = name && name !== defaultLabel ? `${name} ${formattedClock}` : `${defaultLabel} ${formattedClock}`;
  if (item.getAttribute("aria-label") !== ariaLabel) {
    item.setAttribute("aria-label", ariaLabel);
  }
}

function updateActiveTimersInPlace(timers) {
  if (!activeTimersRoot) {
    return;
  }
  const itemsByKey = new Map();
  for (const item of activeTimersRoot.querySelectorAll(".active-timer-item")) {
    if (item.dataset.timerKey) {
      itemsByKey.set(item.dataset.timerKey, item);
    }
  }
  for (const timer of timers) {
    const item = itemsByKey.get(getTimerAnnouncementKey(timer));
    if (item) {
      updateActiveTimerItemElement(item, timer);
    }
  }
}

function updateActiveStopwatchesInPlace(stopwatches) {
  if (!activeStopwatchesRoot) {
    return;
  }
  const itemsByKey = new Map();
  for (const item of activeStopwatchesRoot.querySelectorAll(".active-timer-item")) {
    if (item.dataset.timerKey) {
      itemsByKey.set(item.dataset.timerKey, item);
    }
  }
  for (const timer of stopwatches) {
    const item = itemsByKey.get(getTimerAnnouncementKey(timer));
    if (item) {
      updateActiveTimerItemElement(item, timer);
    }
  }
}

function displayActiveTimers(timers) {
  if (!activeTimersRoot) {
    return;
  }
  const items = Array.isArray(timers) ? timers : [];
  const signature = getActiveTimersLayoutSignature(items);
  if (!items.length) {
    activeTimersRoot.hidden = true;
    activeTimersRoot.replaceChildren();
    activeTimersRenderSignature = "";
    return;
  }
  activeTimersRoot.hidden = false;
  if (signature === activeTimersRenderSignature && activeTimersRoot.childElementCount > 0) {
    updateActiveTimersInPlace(items);
    return;
  }
  activeTimersRenderSignature = signature;
  renderActiveTimers(items);
}

function renderActiveTimers(timers) {
  if (!activeTimersRoot) {
    return;
  }
  const items = Array.isArray(timers) ? timers : [];
  if (!items.length) {
    activeTimersRoot.hidden = true;
    activeTimersRoot.replaceChildren();
    return;
  }
  activeTimersRoot.hidden = false;
  activeTimersRoot.replaceChildren();
  activeTimersRoot.appendChild(
    renderActiveTimersGrid(items, { singleTypeMode: true }),
  );
}

function displayActiveStopwatches(stopwatches) {
  if (!activeStopwatchesRoot) {
    return;
  }
  const items = Array.isArray(stopwatches) ? stopwatches : [];
  const signature = getActiveStopwatchesLayoutSignature(items);
  if (!items.length) {
    activeStopwatchesRoot.hidden = true;
    activeStopwatchesRoot.replaceChildren();
    activeStopwatchesRenderSignature = "";
    return;
  }
  activeStopwatchesRoot.hidden = false;
  if (signature === activeStopwatchesRenderSignature && activeStopwatchesRoot.childElementCount > 0) {
    updateActiveStopwatchesInPlace(items);
    return;
  }
  activeStopwatchesRenderSignature = signature;
  renderActiveStopwatches(items);
}

function renderActiveStopwatches(stopwatches) {
  if (!activeStopwatchesRoot) {
    return;
  }
  const items = Array.isArray(stopwatches) ? stopwatches : [];
  if (!items.length) {
    activeStopwatchesRoot.hidden = true;
    activeStopwatchesRoot.replaceChildren();
    return;
  }
  activeStopwatchesRoot.hidden = false;
  activeStopwatchesRoot.replaceChildren();
  const grid = renderActiveTimersGrid(items, { singleTypeMode: true });
  grid.classList.remove("active-timers-grid");
  grid.classList.add("active-stopwatches-grid");
  activeStopwatchesRoot.appendChild(grid);
}

function clearActiveTimersInterval() {
  if (activeTimersInterval !== null) {
    window.clearInterval(activeTimersInterval);
    activeTimersInterval = null;
  }
}

function syncActiveTimers(timers) {
  const nextTimers = extractCountdownTimers(timers);
  const activeKeys = new Set(nextTimers.map((timer) => getTimerAnnouncementKey(timer)));
  currentActiveTimers = nextTimers;
  pruneOrphanedTimerState(activeKeys);
  clearScheduledTimerExpiries();
  rescheduleTimerExpiries();
  refreshTimerDisplays();
}

function clearTaskWaitTimerInterval() {
  if (taskWaitClockInterval !== null) {
    window.clearInterval(taskWaitClockInterval);
    taskWaitClockInterval = null;
  }
}

function syncTaskWaitTimer(taskTimer) {
  currentTaskTimer = taskTimer && taskTimer.label ? taskTimer : null;
  clearTaskWaitTimerInterval();
  renderTaskWaitTimer(currentTaskTimer);
  if (!currentTaskTimer) {
    return;
  }
  taskWaitClockInterval = window.setInterval(() => {
    renderTaskWaitTimer(currentTaskTimer);
  }, 1000);
}
