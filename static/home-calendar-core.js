const CALENDAR_LOCALE_TAGS = {
  en: "en-GB",
  fi: "fi-FI",
};
const CALENDAR_COPY = {
  en: {
    month: "Month",
    week: "Week",
    day: "Day",
    today: "Today",
    previous: "Previous",
    next: "Next",
    noEvents: "No events",
    allDay: "All day",
    moreEvents: (count) => `+${count} more`,
    openInGoogleCalendar: "Open in Google Calendar",
    primarySuffix: " (primary)",
    noCalendars: "No calendars found for this Google account.",
    requestFailed: "Calendar request failed.",
    loadEventsFailed: "Could not load calendar events.",
    notConnected: "Calendar not connected. Run `nano-core auth-google` on the Pi.",
    uiLoadFailed: "Calendar UI failed to load. Hard-refresh the page.",
    loadingInit: "INITIALIZING CALENDAR",
    loadingCalendar: "SWITCHING CALENDAR",
    loadingView: "SWITCHING VIEW",
    loadingNav: "SYNCING PERIOD",
    loadingDefault: "SYNCING CALENDAR",
    loadingDetail: "fetching events...",
    closeDay: "Close",
    eventEmail: "Email",
    remindLabel: "Remind",
    remindOff: "Off",
    remind15: "15m",
    remind30: "30m",
    remind1h: "1h",
    remindStatus15: "Reminder: 15 min before",
    remindStatus30: "Reminder: 30 min before",
    remindStatus1h: "Reminder: 1 hour before",
  },
  fi: {
    month: "Kuukausi",
    week: "Viikko",
    day: "Päivä",
    today: "Tänään",
    previous: "Edellinen",
    next: "Seuraava",
    noEvents: "Ei tapahtumia",
    allDay: "Koko päivä",
    moreEvents: (count) => `+${count} lisää`,
    openInGoogleCalendar: "Avaa Google Kalenterissa",
    primarySuffix: " (ensisijainen)",
    noCalendars: "Google-tililtä ei löytynyt kalentereita.",
    requestFailed: "Kalenteripyyntö epäonnistui.",
    loadEventsFailed: "Kalenteritapahtumia ei voitu ladata.",
    notConnected: "Kalenteria ei ole yhdistetty. Aja Pi:llä `nano-core auth-google`.",
    uiLoadFailed: "Kalenterin käyttöliittymää ei voitu ladata. Päivitä sivu.",
    loadingInit: "ALUSTETAAN KALENTERI",
    loadingCalendar: "VAIHDETAAN KALENTERIA",
    loadingView: "VAIHDETAAN NÄKYMÄÄ",
    loadingNav: "SYNKATAAN AIKAJAKSOA",
    loadingDefault: "SYNKATAAN KALENTERIA",
    loadingDetail: "haetaan tapahtumia...",
    closeDay: "Sulje",
    eventEmail: "Sähköposti",
    remindLabel: "Muistutus",
    remindOff: "Pois",
    remind15: "15 min",
    remind30: "30 min",
    remind1h: "1 t",
    remindStatus15: "Muistutus: 15 min ennen",
    remindStatus30: "Muistutus: 30 min ennen",
    remindStatus1h: "Muistutus: 1 t ennen",
  },
};

let calendarViewMode = "month";
let calendarAnchorDate = new Date();
let calendarSelectedId = null;
let calendarEvents = [];
let calendarList = [];
let calendarLoading = false;
let calendarLoadingDepth = 0;
let calendarInitialized = false;
let calendarLocale = "en";
let calendarDateFormatter = null;
let calendarDayFormatter = null;
let calendarTimeFormatter = null;
let calendarWeekdayFormatter = null;
let calendarControlsBound = false;

function calendarCopy() {
  return CALENDAR_COPY[calendarLocale] || CALENDAR_COPY.en;
}

function calendarLocaleTag() {
  return CALENDAR_LOCALE_TAGS[calendarLocale] || CALENDAR_LOCALE_TAGS.en;
}

function loadStoredCalendarLocale() {
  try {
    const stored = window.localStorage.getItem(CALENDAR_LANG_STORAGE_KEY);
    if (stored === "en" || stored === "fi") {
      calendarLocale = stored;
    }
  } catch (_error) {
    calendarLocale = "en";
  }
}

function storeCalendarLocale(locale) {
  try {
    window.localStorage.setItem(CALENDAR_LANG_STORAGE_KEY, locale);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function rebuildCalendarFormatters() {
  const localeTag = calendarLocaleTag();
  calendarDateFormatter = new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
  });
  calendarDayFormatter = new Intl.DateTimeFormat(localeTag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  calendarTimeFormatter = new Intl.DateTimeFormat(localeTag, {
    hour: "2-digit",
    minute: "2-digit",
  });
  calendarWeekdayFormatter = new Intl.DateTimeFormat(localeTag, {
    weekday: "short",
  });
}

function weekdayLabels() {
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) =>
    calendarWeekdayFormatter.format(addDays(monday, index))
  );
}

function applyCalendarLocaleUi() {
  const copy = calendarCopy();
  if (calendarViewMonth) {
    calendarViewMonth.textContent = copy.month;
  }
  if (calendarViewWeek) {
    calendarViewWeek.textContent = copy.week;
  }
  if (calendarViewDay) {
    calendarViewDay.textContent = copy.day;
  }
  if (calendarToday) {
    calendarToday.textContent = copy.today;
    calendarToday.setAttribute("aria-label", copy.today);
  }
  if (calendarPrev) {
    calendarPrev.setAttribute("aria-label", copy.previous);
  }
  if (calendarNext) {
    calendarNext.setAttribute("aria-label", copy.next);
  }
  if (calendarDayClose) {
    calendarDayClose.setAttribute("aria-label", copy.closeDay);
  }
  if (calendarLangToggle) {
    const isFinnish = calendarLocale === "fi";
    calendarLangToggle.checked = isFinnish;
    calendarLangToggle.setAttribute("aria-checked", isFinnish ? "true" : "false");
  }
  if (calendarLangLabel) {
    calendarLangLabel.textContent = calendarLocale === "fi" ? "FI" : "EN";
  }
}

function setCalendarLocale(locale) {
  if (locale !== "en" && locale !== "fi") {
    return;
  }
  calendarLocale = locale;
  storeCalendarLocale(locale);
  rebuildCalendarFormatters();
  applyCalendarLocaleUi();
  populateCalendarPicker();
  renderCalendarGrid();
  if (calendarDayModal && !calendarDayModal.hidden) {
    const activeDate = calendarDayModal.dataset.activeDate;
    const eventId = calendarDayModal.dataset.eventId;
    if (activeDate && eventId) {
      const event = eventsForDay(activeDate).find((entry) => entry.id === eventId);
      if (event) {
        openCalendarEventPanel(event, activeDate);
        return;
      }
    }
    if (activeDate) {
      openCalendarDayPanel(activeDate);
    }
  }
}

loadStoredCalendarLocale();
rebuildCalendarFormatters();

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date, amount) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function startOfWeek(date) {
  const current = startOfDay(date);
  const day = current.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(current, mondayOffset);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseEventDate(value) {
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventOccursOnDay(event, dateKey) {
  const start = parseEventDate(event.start);
  if (!start) {
    return false;
  }
  const end = parseEventDate(event.end) || start;
  const dayStart = parseEventDate(dateKey);
  const dayEnd = addDays(dayStart, 1);
  if (event.all_day) {
    const eventStartKey = toDateKey(start);
    const eventEndDate = end > start ? addDays(end, -1) : end;
    const eventEndKey = toDateKey(eventEndDate);
    return dateKey >= eventStartKey && dateKey <= eventEndKey;
  }
  return start < dayEnd && end > dayStart;
}

function eventsForDay(dateKey) {
  return calendarEvents.filter((event) => eventOccursOnDay(event, dateKey));
}

function shiftCalendarAnchor(amount) {
  if (calendarViewMode === "day") {
    return addDays(calendarAnchorDate, amount);
  }
  if (calendarViewMode === "week") {
    return addDays(calendarAnchorDate, 7 * amount);
  }
  return addMonths(calendarAnchorDate, amount);
}

function sortDayEvents(events) {
  return [...events].sort((left, right) => {
    if (left.all_day !== right.all_day) {
      return left.all_day ? -1 : 1;
    }
    const leftStart = parseEventDate(left.start)?.getTime() ?? 0;
    const rightStart = parseEventDate(right.start)?.getTime() ?? 0;
    return leftStart - rightStart;
  });
}

function visibleRange() {
  if (calendarViewMode === "day") {
    const dayStart = startOfDay(calendarAnchorDate);
    return { start: dayStart, end: addDays(dayStart, 1) };
  }
  if (calendarViewMode === "week") {
    const weekStart = startOfWeek(calendarAnchorDate);
    const weekEnd = addDays(weekStart, 7);
    return { start: weekStart, end: weekEnd };
  }
  const monthStart = startOfMonth(calendarAnchorDate);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(gridStart, 42);
  return { start: gridStart, end: gridEnd };
}

function isCalendarViewingToday() {
  const today = startOfDay(new Date());
  const anchor = startOfDay(calendarAnchorDate);
  if (calendarViewMode === "month") {
    return anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
  }
  if (calendarViewMode === "week") {
    const weekStart = startOfWeek(calendarAnchorDate);
    const weekEnd = addDays(weekStart, 6);
    return today >= weekStart && today <= weekEnd;
  }
  return toDateKey(anchor) === toDateKey(today);
}

function updateCalendarTodayButton() {
  if (!calendarToday) {
    return;
  }
  const onToday = isCalendarViewingToday();
  calendarToday.disabled = calendarLoading || onToday;
  calendarToday.classList.toggle("is-active", onToday);
}

function goToCalendarToday() {
  if (isCalendarViewingToday()) {
    return;
  }
  calendarAnchorDate = new Date();
  closeCalendarDayPanel();
  void refreshCalendarData({ reason: "nav" });
}

function updatePeriodLabel() {
  if (!calendarPeriodLabel) {
    return;
  }
  if (calendarViewMode === "day") {
    calendarPeriodLabel.textContent = calendarDayFormatter.format(calendarAnchorDate);
  } else if (calendarViewMode === "week") {
    const weekStart = startOfWeek(calendarAnchorDate);
    const weekEnd = addDays(weekStart, 6);
    const localeTag = calendarLocaleTag();
    const startLabel = weekStart.toLocaleDateString(localeTag, {
      day: "numeric",
      month: "short",
    });
    const endLabel = weekEnd.toLocaleDateString(localeTag, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    calendarPeriodLabel.textContent = `${startLabel} – ${endLabel}`;
  } else {
    calendarPeriodLabel.textContent = calendarDateFormatter.format(calendarAnchorDate);
  }
  updateCalendarTodayButton();
}

function setCalendarError(message) {
  if (!calendarError) {
    return;
  }
  if (!message) {
    calendarError.hidden = true;
    calendarError.textContent = "";
    return;
  }
  calendarError.hidden = false;
  calendarError.textContent = message;
}

const CALENDAR_LOADING_COPY_KEYS = {
  init: "loadingInit",
  calendar: "loadingCalendar",
  view: "loadingView",
  nav: "loadingNav",
  default: "loadingDefault",
};

function setCalendarToolbarDisabled(disabled) {
  if (calendarPickerToggle) {
    calendarPickerToggle.disabled = disabled;
  }
  if (disabled) {
    closeCalendarPickerMenu();
  }
  if (calendarPrev) {
    calendarPrev.disabled = disabled;
  }
  if (calendarToday) {
    calendarToday.disabled = disabled || isCalendarViewingToday();
  }
  if (calendarNext) {
    calendarNext.disabled = disabled;
  }
  if (calendarViewMonth) {
    calendarViewMonth.disabled = disabled;
  }
  if (calendarViewWeek) {
    calendarViewWeek.disabled = disabled;
  }
  if (calendarViewDay) {
    calendarViewDay.disabled = disabled;
  }
}

function setCalendarLoading(isLoading, reason = "default") {
  if (isLoading) {
    calendarLoadingDepth += 1;
    calendarLoading = true;
    const copy = calendarCopy();
    const copyKey = CALENDAR_LOADING_COPY_KEYS[reason] || CALENDAR_LOADING_COPY_KEYS.default;
    if (calendarLoadingLabel) {
      calendarLoadingLabel.textContent = copy[copyKey];
    }
    if (calendarLoadingDetail) {
      calendarLoadingDetail.textContent = copy.loadingDetail;
    }
    if (calendarLoadingOverlay) {
      calendarLoadingOverlay.hidden = false;
    }
    if (calendarContent) {
      calendarContent.classList.add("is-loading");
    }
    if (calendarGrid) {
      calendarGrid.classList.add("is-loading");
    }
    setCalendarToolbarDisabled(true);
    return;
  }

  calendarLoadingDepth = Math.max(0, calendarLoadingDepth - 1);
  if (calendarLoadingDepth > 0) {
    return;
  }
  calendarLoading = false;
  if (calendarLoadingOverlay) {
    calendarLoadingOverlay.hidden = true;
  }
  if (calendarContent) {
    calendarContent.classList.remove("is-loading");
  }
  if (calendarGrid) {
    calendarGrid.classList.remove("is-loading");
  }
  setCalendarToolbarDisabled(false);
}

async function fetchCalendarJson(url) {
  const response = await nanoFetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail || calendarCopy().requestFailed;
    throw new Error(typeof detail === "string" ? detail : calendarCopy().requestFailed);
  }
  return data;
}

async function fetchCalendarEvents() {
  if (!calendarSelectedId) {
    return;
  }
  const range = visibleRange();
  const params = new URLSearchParams({
    calendar_id: calendarSelectedId,
    time_min: range.start.toISOString(),
    time_max: range.end.toISOString(),
  });
  calendarEvents = await fetchCalendarJson(`/api/calendar/events?${params.toString()}`);
}

function calendarOptionLabel(calendar) {
  const copy = calendarCopy();
  return calendar.primary ? `${calendar.summary}${copy.primarySuffix}` : calendar.summary;
}

function updateCalendarPickerLabel() {
  if (!calendarPickerLabel) {
    return;
  }
  const calendar = calendarList.find((entry) => entry.id === calendarSelectedId);
  calendarPickerLabel.textContent = calendar ? calendarOptionLabel(calendar) : "";
}

function closeCalendarPickerMenu() {
  if (!calendarPickerMenu) {
    return;
  }
  calendarPickerMenu.hidden = true;
  if (calendarPicker) {
    calendarPicker.classList.remove("is-open");
  }
  if (calendarPickerToggle) {
    calendarPickerToggle.setAttribute("aria-expanded", "false");
  }
}

function openCalendarPickerMenu() {
  if (!calendarPickerMenu || calendarLoading) {
    return;
  }
  calendarPickerMenu.hidden = false;
  if (calendarPicker) {
    calendarPicker.classList.add("is-open");
  }
  if (calendarPickerToggle) {
    calendarPickerToggle.setAttribute("aria-expanded", "true");
  }
}

function toggleCalendarPickerMenu() {
  if (!calendarPickerMenu) {
    return;
  }
  if (calendarPickerMenu.hidden) {
    openCalendarPickerMenu();
  } else {
    closeCalendarPickerMenu();
  }
}

function selectCalendar(calendarId) {
  if (calendarSelectedId === calendarId) {
    closeCalendarPickerMenu();
    return;
  }
  calendarSelectedId = calendarId;
  populateCalendarPicker();
  closeCalendarPickerMenu();
  closeCalendarDayPanel();
  void refreshCalendarData({ reason: "calendar" });
}

function populateCalendarPicker() {
  if (!calendarPickerMenu) {
    return;
  }
  calendarPickerMenu.innerHTML = "";
  for (const calendar of calendarList) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "calendar-picker-option";
    option.role = "option";
    option.dataset.calendarId = calendar.id;
    const isActive = calendar.id === calendarSelectedId;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", isActive ? "true" : "false");
    if (calendar.background_color) {
      option.style.setProperty("--calendar-picker-color", calendar.background_color);
      option.classList.add("calendar-picker-option--colored");
    }
    option.textContent = calendarOptionLabel(calendar);
    option.addEventListener("click", () => selectCalendar(calendar.id));
    calendarPickerMenu.appendChild(option);
  }
  updateCalendarPickerLabel();
}
