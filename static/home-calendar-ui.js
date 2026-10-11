function renderMonthGrid() {
  if (!calendarGrid) {
    return;
  }
  calendarGrid.className = "calendar-grid calendar-grid-month";
  calendarGrid.innerHTML = "";

  for (const weekday of weekdayLabels()) {
    const header = document.createElement("div");
    header.className = "calendar-weekday";
    header.textContent = weekday;
    calendarGrid.appendChild(header);
  }

  const monthStart = startOfMonth(calendarAnchorDate);
  const gridStart = startOfWeek(monthStart);
  const todayKey = toDateKey(new Date());

  for (let index = 0; index < 42; index += 1) {
    const dayDate = addDays(gridStart, index);
    const dayKey = toDateKey(dayDate);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.dataset.date = dayKey;
    if (dayDate.getMonth() !== calendarAnchorDate.getMonth()) {
      cell.classList.add("is-outside");
    }
    if (dayKey === todayKey) {
      cell.classList.add("is-today");
    }

    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = String(dayDate.getDate());
    cell.appendChild(dayNumber);

    const dayEvents = sortDayEvents(eventsForDay(dayKey));
    const chips = document.createElement("div");
    chips.className = "calendar-day-chips";
    const visibleEvents = dayEvents.slice(0, 2);
    for (const event of visibleEvents) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "calendar-event-chip";
      const eventKey = buildMeetingReminderKey(event);
      if (eventKey) {
        chip.dataset.eventKey = eventKey;
      }
      chip.classList.toggle("calendar-event-chip--remind", hasActiveMeetingReminder(event));
      chip.textContent = event.summary;
      chip.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        openCalendarEventPanel(event, dayKey, clickEvent.currentTarget);
      });
      chips.appendChild(chip);
    }
    if (dayEvents.length > 2) {
      const more = document.createElement("span");
      more.className = "calendar-event-more";
      more.textContent = calendarCopy().moreEvents(dayEvents.length - 2);
      chips.appendChild(more);
    }
    cell.appendChild(chips);
    cell.addEventListener("click", (event) => openCalendarDayPanel(dayKey, event.currentTarget));
    calendarGrid.appendChild(cell);
  }
}

function renderWeekGrid() {
  if (!calendarGrid) {
    return;
  }
  calendarGrid.className = "calendar-grid calendar-grid-week";
  calendarGrid.innerHTML = "";

  const weekStart = startOfWeek(calendarAnchorDate);
  const todayKey = toDateKey(new Date());

  const labels = weekdayLabels();

  for (let index = 0; index < 7; index += 1) {
    const dayDate = addDays(weekStart, index);
    const dayKey = toDateKey(dayDate);
    const column = document.createElement("div");
    column.className = "calendar-week-column";
    if (dayKey === todayKey) {
      column.classList.add("is-today");
    }

    const header = document.createElement("button");
    header.type = "button";
    header.className = "calendar-week-header";
    header.dataset.date = dayKey;
    header.innerHTML = `<span class="calendar-weekday-name">${labels[index]}</span><span class="calendar-weekday-date">${dayDate.getDate()}</span>`;
    header.addEventListener("click", (event) => openCalendarDayPanel(dayKey, event.currentTarget));
    column.appendChild(header);

    const list = document.createElement("div");
    list.className = "calendar-week-events";
    const dayEvents = sortDayEvents(eventsForDay(dayKey));
    if (dayEvents.length === 0) {
      const empty = document.createElement("p");
      empty.className = "calendar-week-empty";
      empty.textContent = calendarCopy().noEvents;
      list.appendChild(empty);
    } else {
      for (const event of dayEvents) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "calendar-week-event";
        const timeLabel = event.all_day
          ? calendarCopy().allDay
          : calendarTimeFormatter.format(parseEventDate(event.start));
        const timeSpan = document.createElement("span");
        timeSpan.className = "calendar-week-event-time";
        timeSpan.textContent = timeLabel;
        const titleSpan = document.createElement("span");
        titleSpan.className = "calendar-week-event-title";
        titleSpan.textContent = event.summary;
        item.append(timeSpan, titleSpan);
        item.addEventListener("click", (clickEvent) =>
          openCalendarEventPanel(event, dayKey, clickEvent.currentTarget)
        );
        list.appendChild(item);
      }
    }
    column.appendChild(list);
    calendarGrid.appendChild(column);
  }
}

function renderDayGrid() {
  if (!calendarGrid) {
    return;
  }
  calendarGrid.className = "calendar-grid calendar-grid-day";
  calendarGrid.innerHTML = "";

  const dayKey = toDateKey(calendarAnchorDate);
  const todayKey = toDateKey(new Date());
  const localeTag = calendarLocaleTag();

  const column = document.createElement("div");
  column.className = "calendar-day-column";
  if (dayKey === todayKey) {
    column.classList.add("is-today");
  }

  const header = document.createElement("div");
  header.className = "calendar-day-view-header";
  const weekday = calendarWeekdayFormatter.format(calendarAnchorDate);
  const dateLabel = calendarAnchorDate.toLocaleDateString(localeTag, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  header.innerHTML = `<span class="calendar-day-view-weekday">${weekday}</span><span class="calendar-day-view-date">${dateLabel}</span>`;
  column.appendChild(header);

  const list = document.createElement("div");
  list.className = "calendar-day-view-events";
  const dayEvents = sortDayEvents(eventsForDay(dayKey));
  if (dayEvents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "calendar-day-view-empty";
    empty.textContent = calendarCopy().noEvents;
    list.appendChild(empty);
  } else {
    for (const event of dayEvents) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "calendar-day-view-event";
      const timeLabel = event.all_day
        ? calendarCopy().allDay
        : calendarTimeFormatter.format(parseEventDate(event.start));
      const timeSpan = document.createElement("span");
      timeSpan.className = "calendar-day-view-event-time";
      timeSpan.textContent = timeLabel;
      const titleSpan = document.createElement("span");
      titleSpan.className = "calendar-day-view-event-title";
      titleSpan.textContent = event.summary;
      item.append(timeSpan, titleSpan);
      item.addEventListener("click", (clickEvent) =>
        openCalendarEventPanel(event, dayKey, clickEvent.currentTarget)
      );
      list.appendChild(item);
    }
  }
  column.appendChild(list);
  calendarGrid.appendChild(column);
}

function renderCalendarGrid() {
  updatePeriodLabel();
  if (calendarViewMode === "day") {
    renderDayGrid();
  } else if (calendarViewMode === "week") {
    renderWeekGrid();
  } else {
    renderMonthGrid();
  }
}

function formatSpeechDayPeriod(hours24, minutes) {
  if (hours24 === 0 && minutes === 0) {
    return "midnight";
  }
  if (hours24 === 12 && minutes === 0) {
    return "noon";
  }
  if (hours24 >= 5 && hours24 < 12) {
    return "in the morning";
  }
  if (hours24 >= 12 && hours24 < 18) {
    return "in the afternoon";
  }
  if (hours24 >= 18 && hours24 < 22) {
    return "in the evening";
  }
  return "at night";
}

function formatSpeechWeekday(date) {
  if (!date) {
    return "";
  }
  return new Intl.DateTimeFormat(calendarLocaleTag(), { weekday: "long" }).format(date);
}

function formatSpeechClockTime(date) {
  if (!date) {
    return "";
  }
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const period = formatSpeechDayPeriod(hours24, minutes);
  if (period === "midnight" || period === "noon") {
    return period;
  }
  const hours12 = hours24 % 12 || 12;

  if (minutes === 0) {
    return `${hours12} ${period}`;
  }
  if (minutes < 10) {
    return `${hours12} oh ${minutes} ${period}`;
  }
  return `${hours12} ${minutes} ${period}`;
}

function formatSpeechDuration(start, end) {
  if (!start || !end) {
    return null;
  }
  const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (totalMinutes <= 0) {
    return null;
  }
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  if (remainder === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} ${remainder} minute${remainder === 1 ? "" : "s"}`;
}

function formatMeetingSpeechLine(event, options = {}) {
  const includeWeekday = Boolean(options.includeWeekday);
  if (event.all_day) {
    const start = parseEventDate(event.start);
    if (includeWeekday && start) {
      return `On ${formatSpeechWeekday(start)}, meeting is all day`;
    }
    return "Meeting is all day";
  }

  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  if (!start) {
    return "Meeting time unavailable";
  }

  const startSpeech = formatSpeechClockTime(start);
  const duration = end ? formatSpeechDuration(start, end) : null;
  let line = duration
    ? `Meeting is from ${startSpeech} and lasts ${duration}`
    : `Meeting starts at ${startSpeech}`;

  if (includeWeekday) {
    line = `On ${formatSpeechWeekday(start)}, ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
  }
  return line;
}

function formatEventTimeForSpeech(event) {
  if (event.all_day) {
    return calendarCopy().allDay;
  }
  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  if (!start) {
    return "";
  }
  const startLabel = formatSpeechClockTime(start);
  if (!end) {
    return startLabel;
  }
  const endLabel = formatSpeechClockTime(end);
  if (startLabel === endLabel) {
    return startLabel;
  }
  return `${startLabel} to ${endLabel}`;
}

function formatEventTime(event) {
  if (event.all_day) {
    return calendarCopy().allDay;
  }
  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  if (!start) {
    return "";
  }
  const startLabel = calendarTimeFormatter.format(start);
  if (!end) {
    return startLabel;
  }
  return `${startLabel} – ${calendarTimeFormatter.format(end)}`;
}

function resolveEventContactEmail(event) {
  const organizerEmail = String(event?.organizer_email || "").trim();
  if (organizerEmail) {
    return organizerEmail;
  }
  const calendarId = String(event?.calendar_id || "").trim();
  if (calendarId.includes("@")) {
    return calendarId;
  }
  return "";
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function createGoogleCalendarEventLink(htmlLink, { hero = false } = {}) {
  const link = document.createElement("a");
  link.className = hero
    ? "calendar-day-event-link calendar-day-event-link--hero"
    : "calendar-day-event-link";
  if (isSafeHttpUrl(htmlLink)) {
    link.href = htmlLink;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  link.setAttribute("aria-label", calendarCopy().openInGoogleCalendar);
  link.title = calendarCopy().openInGoogleCalendar;
  link.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>';
  return link;
}

function clearCalendarDayModalRailExtras() {
  if (calendarDayModalRailExtras) {
    calendarDayModalRailExtras.replaceChildren();
  }
}

let calendarDayModalTrigger = null;
let calendarDayModalKeydownHandler = null;

function getCalendarDayModalFocusableElements() {
  if (!calendarDayModalPanel) {
    return [];
  }
  return Array.from(
    calendarDayModalPanel.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element instanceof HTMLElement && !element.hidden);
}

function handleCalendarDayModalKeydown(event) {
  if (!isCalendarDayModalOpen()) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeCalendarDayPanel();
    return;
  }
  if (event.key !== "Tab" || !calendarDayModalPanel) {
    return;
  }
  const focusable = getCalendarDayModalFocusableElements();
  if (!focusable.length) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showCalendarDayModal() {
  if (!calendarDayModal) {
    return;
  }
  calendarDayModal.hidden = false;
  if (!calendarDayModalKeydownHandler) {
    calendarDayModalKeydownHandler = handleCalendarDayModalKeydown;
    document.addEventListener("keydown", calendarDayModalKeydownHandler);
  }
  if (calendarDayModalPanel) {
    calendarDayModalPanel.focus();
  } else if (calendarDayClose) {
    calendarDayClose.focus();
  }
}

function buildCalendarEventListItem(event) {
  const item = document.createElement("li");
  item.className = "calendar-day-event";

  const main = document.createElement("div");
  main.className = "calendar-day-event-main";

  const time = document.createElement("span");
  time.className = "calendar-day-event-time";
  time.textContent = formatEventTime(event);

  const title = document.createElement("span");
  title.className = "calendar-day-event-title";
  title.textContent = event.summary;

  main.append(time, title);
  item.appendChild(main);

  const reminderControl = createMeetingReminderControl(event);
  if (reminderControl) {
    item.appendChild(reminderControl);
  }

  if (event.html_link) {
    item.appendChild(createGoogleCalendarEventLink(event.html_link));
  }

  return item;
}

function setCalendarDayModalVariant(variant) {
  if (!calendarDayModalPanel) {
    return;
  }
  calendarDayModalPanel.classList.toggle("calendar-day-modal-panel--event", variant === "event");
}

function openCalendarEventPanel(event, dateKey, trigger) {
  if (!calendarDayModal || !calendarDayTitle || !calendarDayEvents || !event) {
    return;
  }
  calendarDayModalTrigger = trigger || calendarDayModalTrigger;
  const dayDate = parseEventDate(dateKey);
  if (!dayDate) {
    return;
  }

  calendarDayTitle.textContent = event.summary || calendarCopy().noEvents;
  calendarDayModal.dataset.activeDate = dateKey;
  calendarDayModal.dataset.eventId = event.id || "";
  calendarDayModal.dataset.view = "event";
  setCalendarDayModalVariant("event");
  calendarDayEvents.className = "calendar-day-events calendar-day-events--single";
  calendarDayEvents.innerHTML = "";

  clearCalendarDayModalRailExtras();
  if (event.html_link && calendarDayModalRailExtras) {
    calendarDayModalRailExtras.appendChild(createGoogleCalendarEventLink(event.html_link, { hero: true }));
  }

  const detail = document.createElement("div");
  detail.className = "calendar-event-detail";

  const dateLine = document.createElement("p");
  dateLine.className = "calendar-event-detail-date";
  dateLine.textContent = calendarDayFormatter.format(dayDate);

  const timeLine = document.createElement("p");
  timeLine.className = "calendar-event-detail-time";
  timeLine.textContent = formatEventTime(event);

  detail.append(dateLine, timeLine);

  const reminderControl = createMeetingReminderControl(event);
  if (reminderControl) {
    detail.appendChild(reminderControl);
  }

  calendarDayEvents.appendChild(detail);

  showCalendarDayModal();
}

function openCalendarDayPanel(dateKey, trigger) {
  if (!calendarDayModal || !calendarDayTitle || !calendarDayEvents) {
    return;
  }
  calendarDayModalTrigger = trigger || calendarDayModalTrigger;
  const dayDate = parseEventDate(dateKey);
  if (!dayDate) {
    return;
  }
  calendarDayTitle.textContent = calendarDayFormatter.format(dayDate);
  calendarDayModal.dataset.activeDate = dateKey;
  calendarDayModal.dataset.view = "day";
  setCalendarDayModalVariant("day");
  delete calendarDayModal.dataset.eventId;
  calendarDayEvents.className = "calendar-day-events";
  calendarDayEvents.innerHTML = "";
  clearCalendarDayModalRailExtras();

  const dayEvents = eventsForDay(dateKey);
  if (dayEvents.length === 0) {
    const empty = document.createElement("li");
    empty.className = "calendar-day-empty";
    empty.textContent = calendarCopy().noEvents;
    calendarDayEvents.appendChild(empty);
  } else {
    for (const event of dayEvents) {
      calendarDayEvents.appendChild(buildCalendarEventListItem(event));
    }
  }
  showCalendarDayModal();
}

function closeCalendarDayPanel() {
  const trigger = calendarDayModalTrigger;
  if (calendarDayModal) {
    calendarDayModal.hidden = true;
    delete calendarDayModal.dataset.activeDate;
    delete calendarDayModal.dataset.eventId;
    delete calendarDayModal.dataset.view;
  }
  calendarDayModalTrigger = null;
  if (calendarDayModalKeydownHandler) {
    document.removeEventListener("keydown", calendarDayModalKeydownHandler);
    calendarDayModalKeydownHandler = null;
  }
  setCalendarDayModalVariant("day");
  clearCalendarDayModalRailExtras();
  if (trigger && typeof trigger.focus === "function") {
    trigger.focus();
  }
}

function isCalendarDayModalOpen() {
  return Boolean(calendarDayModal && !calendarDayModal.hidden);
}

function setCalendarViewMode(mode) {
  calendarViewMode = mode;
  if (calendarViewMonth) {
    const isMonth = mode === "month";
    calendarViewMonth.classList.toggle("active", isMonth);
    calendarViewMonth.setAttribute("aria-selected", isMonth ? "true" : "false");
  }
  if (calendarViewWeek) {
    const isWeek = mode === "week";
    calendarViewWeek.classList.toggle("active", isWeek);
    calendarViewWeek.setAttribute("aria-selected", isWeek ? "true" : "false");
  }
  if (calendarViewDay) {
    const isDay = mode === "day";
    calendarViewDay.classList.toggle("active", isDay);
    calendarViewDay.setAttribute("aria-selected", isDay ? "true" : "false");
  }
  closeCalendarDayPanel();
}

async function refreshCalendarData({ reason = "default", manageLoader = true } = {}) {
  if (manageLoader) {
    setCalendarLoading(true, reason);
  }
  setCalendarError("");
  try {
    await fetchCalendarEvents();
    renderCalendarGrid();
  } catch (error) {
    setCalendarError(error.message || calendarCopy().loadEventsFailed);
  } finally {
    if (manageLoader) {
      setCalendarLoading(false);
    }
  }
}

async function loadCalendarView() {
  setCalendarLoading(true, "init");
  setCalendarError("");
  closeCalendarDayPanel();
  applyCalendarLocaleUi();
  try {
    if (!calendarInitialized) {
      const [calendars, defaultCalendar] = await Promise.all([
        fetchCalendarJson("/api/calendar/calendars"),
        fetchCalendarJson("/api/calendar/default"),
      ]);
      calendarList = calendars;
      const availableIds = new Set(calendars.map((calendar) => calendar.id));
      calendarSelectedId = availableIds.has(defaultCalendar.calendar_id)
        ? defaultCalendar.calendar_id
        : calendars[0]?.id || null;
      populateCalendarPicker();
      bindCalendarControls();
      calendarInitialized = true;
    }
    if (!calendarSelectedId) {
      setCalendarError(calendarCopy().noCalendars);
      return;
    }
    await refreshCalendarData({ manageLoader: false });
  } catch (error) {
    setCalendarError(error.message || calendarCopy().notConnected);
  } finally {
    setCalendarLoading(false);
  }
}

function bindCalendarControls() {
  if (calendarControlsBound) {
    return;
  }
  calendarControlsBound = true;

  if (calendarPickerToggle) {
    calendarPickerToggle.addEventListener("click", () => {
      toggleCalendarPickerMenu();
    });
    document.addEventListener("click", (event) => {
      if (
        calendarPicker &&
        event.target instanceof Node &&
        !calendarPicker.contains(event.target)
      ) {
        closeCalendarPickerMenu();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCalendarPickerMenu();
      }
    });
  }
  if (calendarPrev) {
    calendarPrev.addEventListener("click", () => {
      calendarAnchorDate = shiftCalendarAnchor(-1);
      closeCalendarDayPanel();
      void refreshCalendarData({ reason: "nav" });
    });
  }
  if (calendarNext) {
    calendarNext.addEventListener("click", () => {
      calendarAnchorDate = shiftCalendarAnchor(1);
      closeCalendarDayPanel();
      void refreshCalendarData({ reason: "nav" });
    });
  }
  if (calendarToday) {
    calendarToday.addEventListener("click", () => {
      goToCalendarToday();
    });
  }
  if (calendarViewMonth) {
    calendarViewMonth.addEventListener("click", () => {
      if (calendarViewMode === "month") {
        return;
      }
      setCalendarViewMode("month");
      void refreshCalendarData({ reason: "view" });
    });
  }
  if (calendarViewWeek) {
    calendarViewWeek.addEventListener("click", () => {
      if (calendarViewMode === "week") {
        return;
      }
      setCalendarViewMode("week");
      void refreshCalendarData({ reason: "view" });
    });
  }
  if (calendarViewDay) {
    calendarViewDay.addEventListener("click", () => {
      if (calendarViewMode === "day") {
        return;
      }
      setCalendarViewMode("day");
      void refreshCalendarData({ reason: "view" });
    });
  }
  if (calendarLangToggle && calendarLangToggle.dataset.bound !== "true") {
    calendarLangToggle.dataset.bound = "true";
    calendarLangToggle.addEventListener("change", () => {
      setCalendarLocale(calendarLangToggle.checked ? "fi" : "en");
    });
  }
  if (calendarDayClose) {
    calendarDayClose.addEventListener("click", () => {
      closeCalendarDayPanel();
    });
  }
  if (calendarDayModal) {
    calendarDayModal.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.hasAttribute("data-calendar-day-close")) {
        closeCalendarDayPanel();
      }
    });
  }
}
