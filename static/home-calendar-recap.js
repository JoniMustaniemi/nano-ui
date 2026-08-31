const MEETING_RECAP_AUTO_CLOSE_MS = 300000;
const MEETING_RECAP_SPEECH_CAP = 5;
const MEETING_RECAP_IMMINENT_MS = 60 * 60 * 1000;

let meetingRecapAutoCloseTimer = null;

function getRecapRangeForPeriod(period) {
  const now = new Date();
  const todayStart = startOfDay(now);
  if (period === "week") {
    const weekStart = startOfWeek(now);
    return { start: weekStart, end: addDays(weekStart, 7) };
  }
  if (period === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: monthStart, end: addDays(endOfMonth(now), 1) };
  }
  return { start: todayStart, end: addDays(todayStart, 1) };
}

function eventOverlapsRange(event, rangeStart, rangeEnd) {
  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end) || start;
  if (!start) {
    return false;
  }
  const eventEnd = end || start;
  return start < rangeEnd && eventEnd > rangeStart;
}

function isEventStillRelevant(event, now) {
  if (event.all_day) {
    const start = parseEventDate(event.start);
    if (!start) {
      return false;
    }
    const end = parseEventDate(event.end);
    const eventEndDay = end && end > start ? addDays(end, -1) : start;
    return eventEndDay >= startOfDay(now);
  }
  const end = parseEventDate(event.end) || parseEventDate(event.start);
  return end && end > now;
}

function sortEventsByStart(events) {
  return [...events].sort((left, right) => {
    if (left.all_day !== right.all_day) {
      return left.all_day ? -1 : 1;
    }
    const leftStart = parseEventDate(left.start)?.getTime() ?? 0;
    const rightStart = parseEventDate(right.start)?.getTime() ?? 0;
    return leftStart - rightStart;
  });
}

function filterRelevantEventsInRange(events, range) {
  const now = new Date();
  return sortEventsByStart(
    events.filter(
      (event) => eventOverlapsRange(event, range.start, range.end) && isEventStillRelevant(event, now)
    )
  );
}

function findImminentUpcomingEvent(events) {
  const now = new Date();
  const upcoming = events
    .filter((event) => {
      if (event.all_day) {
        return false;
      }
      const start = parseEventDate(event.start);
      return start && start > now;
    })
    .sort((left, right) => {
      const leftStart = parseEventDate(left.start)?.getTime() ?? 0;
      const rightStart = parseEventDate(right.start)?.getTime() ?? 0;
      return leftStart - rightStart;
    });
  if (!upcoming.length) {
    return null;
  }
  const next = upcoming[0];
  const start = parseEventDate(next.start);
  if (!start) {
    return null;
  }
  const msUntil = start.getTime() - now.getTime();
  if (msUntil > 0 && msUntil <= MEETING_RECAP_IMMINENT_MS) {
    return next;
  }
  return null;
}

function isSameCalendarEvent(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left.id && right.id) {
    return left.id === right.id;
  }
  return left.start === right.start && left.summary === right.summary;
}

function buildRecapPlan(events, period, fullPeriod) {
  const range = getRecapRangeForPeriod(period);
  const inRange = filterRelevantEventsInRange(events, range);
  const imminent = findImminentUpcomingEvent(inRange);

  if (!fullPeriod && imminent && period === "day") {
    return {
      events: [imminent],
      focused: true,
      period,
      totalInRange: inRange.length,
      imminent,
    };
  }

  return {
    events: inRange,
    focused: false,
    period,
    totalInRange: inRange.length,
    imminent: imminent || null,
  };
}

function recapPeriodLabel(period) {
  if (period === "week") {
    return "this week";
  }
  if (period === "month") {
    return "this month";
  }
  return "today";
}

function recapShouldIncludeWeekday(events, period) {
  if (period === "day") {
    return false;
  }
  const dayKeys = new Set();
  for (const event of events) {
    const start = parseEventDate(event.start);
    if (start) {
      dayKeys.add(toDateKey(start));
    }
  }
  return dayKeys.size > 1;
}

function buildImminentSpeechLead(imminent, period) {
  const includeWeekday = recapShouldIncludeWeekday([imminent], period);
  const line = formatMeetingSpeechLine(imminent, { includeWeekday });
  const minutes = minutesUntilEvent(imminent);
  if (minutes !== null) {
    return `Your next meeting is coming up soon. ${line}. It starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `Your next meeting is coming up soon. ${line}`;
}

function buildRecapSpeech(plan) {
  const { events, focused, period, imminent } = plan;
  const periodLabel = recapPeriodLabel(period);

  if (!events.length) {
    return `You have no meetings ${periodLabel}.`;
  }

  const includeWeekday = recapShouldIncludeWeekday(events, period);
  const imminentLead =
    imminent && !focused ? `${buildImminentSpeechLead(imminent, period)}. ` : "";
  const speechEvents =
    imminent && !focused
      ? events.filter((event) => !isSameCalendarEvent(event, imminent))
      : events;

  if (focused && events.length === 1) {
    const event = events[0];
    const line = formatMeetingSpeechLine(event, { includeWeekday });
    const minutes = minutesUntilEvent(event);
    if (minutes !== null) {
      return `${line}. It starts in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return `You have one meeting ${periodLabel}. ${line}.`;
  }

  if (speechEvents.length === 0) {
    return imminentLead.trim();
  }

  if (speechEvents.length === 1) {
    const line = formatMeetingSpeechLine(speechEvents[0], { includeWeekday });
    return `${imminentLead}You have one meeting ${periodLabel}. ${line}.`.trim();
  }

  const spokenEvents = speechEvents.slice(0, MEETING_RECAP_SPEECH_CAP);
  const lines = spokenEvents.map((event) => formatMeetingSpeechLine(event, { includeWeekday }));
  let speech = `${imminentLead}You have ${events.length} meeting${events.length === 1 ? "" : "s"} ${periodLabel}. ${lines.join(". ")}`;
  const remaining = speechEvents.length - spokenEvents.length;
  if (remaining > 0) {
    speech += `. And ${remaining} more`;
  }
  speech += ".";
  return speech;
}

function minutesUntilEvent(event) {
  const now = new Date();
  const start = parseEventDate(event.start);
  if (!start || event.all_day) {
    return null;
  }
  const ms = start.getTime() - now.getTime();
  if (ms <= 0) {
    return null;
  }
  return Math.max(1, Math.round(ms / 60000));
}

function calendarDaysUntilEvent(start, now = new Date()) {
  const eventDay = startOfDay(start);
  const today = startOfDay(now);
  return Math.round((eventDay.getTime() - today.getTime()) / 86400000);
}

function formatTimeUntilEvent(event) {
  const now = new Date();
  if (event.all_day) {
    return null;
  }
  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end) || start;
  if (!start) {
    return null;
  }
  if (start > now) {
    const totalMinutes = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60000));
    if (totalMinutes < 24 * 60) {
      if (totalMinutes < 60) {
        return `Starts in ${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
      }
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (minutes === 0) {
        return `Starts in ${hours} hour${hours === 1 ? "" : "s"}`;
      }
      return `Starts in ${hours}h ${minutes}m`;
    }
    const daysUntil = calendarDaysUntilEvent(start, now);
    if (daysUntil === 1) {
      return "Starts tomorrow";
    }
    if (daysUntil > 1) {
      return `Starts in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
    }
    return null;
  }
  if (end && end > now) {
    return "In progress";
  }
  return null;
}

async function ensureCalendarApiReady() {
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
    throw new Error(calendarCopy().noCalendars);
  }
}

async function fetchCalendarEventsForRange(start, end) {
  if (!calendarSelectedId) {
    return [];
  }
  const params = new URLSearchParams({
    calendar_id: calendarSelectedId,
    time_min: start.toISOString(),
    time_max: end.toISOString(),
  });
  return await fetchCalendarJson(`/api/calendar/events?${params.toString()}`);
}

function clearMeetingRecapAutoCloseTimer() {
  if (meetingRecapAutoCloseTimer !== null) {
    window.clearTimeout(meetingRecapAutoCloseTimer);
    meetingRecapAutoCloseTimer = null;
  }
}

function hideMeetingRecapContainerIfEmpty() {
  if (!meetingRecapModals) {
    return;
  }
  if (meetingRecapModals.children.length === 0) {
    meetingRecapModals.hidden = true;
    meetingRecapModals.replaceChildren();
  }
}

function closeMeetingRecapCard(card) {
  if (!card || !meetingRecapModals) {
    return;
  }
  card.remove();
  hideMeetingRecapContainerIfEmpty();
}

function closeAllMeetingRecapModals() {
  clearMeetingRecapAutoCloseTimer();
  if (!meetingRecapModals) {
    return;
  }
  meetingRecapModals.hidden = true;
  meetingRecapModals.replaceChildren();
}

function scheduleMeetingRecapAutoClose() {
  clearMeetingRecapAutoCloseTimer();
  meetingRecapAutoCloseTimer = window.setTimeout(() => {
    meetingRecapAutoCloseTimer = null;
    closeAllMeetingRecapModals();
  }, MEETING_RECAP_AUTO_CLOSE_MS);
}

function buildMeetingRecapCard(event) {
  const card = document.createElement("article");
  card.className = "meeting-recap-card calendar-day-modal-panel calendar-day-modal-panel--event";

  const layout = document.createElement("div");
  layout.className = "calendar-day-modal-layout";

  const main = document.createElement("div");
  main.className = "calendar-day-modal-main";

  const header = document.createElement("header");
  header.className = "calendar-day-modal-header";

  const title = document.createElement("h4");
  title.className = "calendar-day-title";
  title.textContent = event.summary || calendarCopy().noEvents;

  header.appendChild(title);
  main.appendChild(header);

  const detail = document.createElement("div");
  detail.className = "calendar-event-detail";

  const start = parseEventDate(event.start);
  const dateLine = document.createElement("p");
  dateLine.className = "calendar-event-detail-date";
  dateLine.textContent = start ? calendarDayFormatter.format(start) : "";

  const timeLine = document.createElement("p");
  timeLine.className = "calendar-event-detail-time";
  timeLine.textContent = formatEventTime(event);

  detail.append(dateLine, timeLine);

  const untilLabel = formatTimeUntilEvent(event);
  if (untilLabel) {
    const untilLine = document.createElement("p");
    untilLine.className = "calendar-event-detail-until";
    untilLine.textContent = untilLabel;
    detail.appendChild(untilLine);
  }

  const contactEmail = resolveEventContactEmail(event);
  if (contactEmail) {
    const emailLine = document.createElement("p");
    emailLine.className = "calendar-event-detail-email";
    emailLine.textContent = contactEmail;
    emailLine.title = calendarCopy().eventEmail;
    detail.appendChild(emailLine);
  }

  const reminderControl = createMeetingReminderControl(event);
  if (reminderControl) {
    detail.appendChild(reminderControl);
  }

  main.appendChild(detail);

  const rail = document.createElement("aside");
  rail.className = "calendar-day-modal-rail";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "calendar-day-close ghost chrome-close-btn";
  closeBtn.setAttribute("aria-label", calendarCopy().closeDay);
  closeBtn.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  closeBtn.addEventListener("click", () => {
    closeMeetingRecapCard(card);
  });

  rail.appendChild(closeBtn);

  if (event.html_link) {
    const extras = document.createElement("div");
    extras.className = "calendar-day-modal-rail-extras";
    extras.appendChild(createGoogleCalendarEventLink(event.html_link, { hero: true }));
    rail.appendChild(extras);
  }

  layout.append(main, rail);
  card.appendChild(layout);

  return card;
}

function showMeetingRecapModals(events) {
  if (!meetingRecapModals) {
    return;
  }
  closeAllMeetingRecapModals();
  if (!events.length) {
    return;
  }
  for (const event of events) {
    meetingRecapModals.appendChild(buildMeetingRecapCard(event));
  }
  meetingRecapModals.hidden = false;
  scheduleMeetingRecapAutoClose();
}

async function handleCalendarRecap(command, source = "ui") {
  let speech = "";
  try {
    await ensureCalendarApiReady();
    const range = getRecapRangeForPeriod(command.period);
    const events = await fetchCalendarEventsForRange(range.start, range.end);
    const plan = buildRecapPlan(events, command.period, command.fullPeriod);
    speech = buildRecapSpeech(plan);
    showMeetingRecapModals(plan.events);
  } catch (error) {
    speech = error.message || calendarCopy().notConnected;
    closeAllMeetingRecapModals();
  }

  replyStatus.textContent = speech;
  setVoiceStatus(speech);
  setAnswer(speech, { allowDuringWorking: false });

  if (source === "voice") {
    try {
      await playVoice(speech);
    } finally {
      returnToWakeDetection();
    }
  }
}
