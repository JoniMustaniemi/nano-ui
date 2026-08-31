const MEETING_REMINDER_POLL_MS = 30000;
const MEETING_REMINDER_LEAD_OPTIONS = [15, 30, 60];
const MEETING_REMINDERS_API = "/api/calendar/meeting-reminders";

let meetingReminderPollTimer = null;
let meetingRemindersCache = [];
const announcedMeetingReminderKeys = new Set();

function mapApiReminder(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const calendarId = String(row.calendar_id || "").trim();
  const eventId = String(row.event_id || "").trim();
  const start = String(row.start || "").trim();
  if (!calendarId || !eventId || !start) {
    return null;
  }
  return {
    id: row.id ?? null,
    key: `${calendarId}|${eventId}|${start}`,
    calendar_id: calendarId,
    event_id: eventId,
    start,
    end: String(row.end || "").trim(),
    summary: String(row.summary || "").trim(),
    all_day: Boolean(row.all_day),
    lead_minutes: Number(row.lead_minutes),
    remind_at: row.remind_at ?? null,
    fired_at: row.fired_at ?? null,
  };
}

function buildMeetingReminderKey(event) {
  const calendarId = String(event?.calendar_id || calendarSelectedId || "").trim();
  const eventId = String(event?.id || "").trim();
  const start = String(event?.start || "").trim();
  if (!calendarId || !eventId || !start) {
    return "";
  }
  return `${calendarId}|${eventId}|${start}`;
}

function reminderFromEvent(event, leadMinutes) {
  const key = buildMeetingReminderKey(event);
  if (!key || event.all_day) {
    return null;
  }
  const start = parseEventDate(event.start);
  if (!start || start <= new Date()) {
    return null;
  }
  return {
    key,
    calendar_id: String(event.calendar_id || calendarSelectedId || "").trim(),
    event_id: String(event.id || "").trim(),
    start: String(event.start || "").trim(),
    end: String(event.end || "").trim(),
    summary: String(event.summary || "").trim(),
    all_day: Boolean(event.all_day),
    lead_minutes: leadMinutes,
    fired_at: null,
  };
}

function loadMeetingReminders() {
  return meetingRemindersCache.slice();
}

function upsertMeetingReminderInCache(record) {
  if (!record?.key) {
    return;
  }
  const index = meetingRemindersCache.findIndex((entry) => entry.key === record.key);
  if (index >= 0) {
    meetingRemindersCache[index] = record;
  } else {
    meetingRemindersCache.push(record);
  }
}

function removeMeetingReminderFromCache(key) {
  if (!key) {
    return;
  }
  meetingRemindersCache = meetingRemindersCache.filter((entry) => entry.key !== key);
}

function syncAnnouncedMeetingReminderKeys() {
  const activeKeys = new Set(meetingRemindersCache.map((reminder) => reminder.key));
  for (const key of announcedMeetingReminderKeys) {
    if (!activeKeys.has(key)) {
      announcedMeetingReminderKeys.delete(key);
    }
  }
}

async function parseMeetingReminderError(response) {
  const data = await response.json().catch(() => ({}));
  const detail = data.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  return calendarCopy().requestFailed;
}

function findMeetingReminder(key) {
  if (!key) {
    return null;
  }
  return meetingRemindersCache.find((reminder) => reminder.key === key) || null;
}

async function refreshMeetingRemindersFromServer() {
  const response = await nanoFetch(MEETING_REMINDERS_API);
  if (response.status === 503) {
    meetingRemindersCache = [];
    syncAnnouncedMeetingReminderKeys();
    refreshMeetingReminderIndicators();
    return;
  }
  if (!response.ok) {
    throw new Error(await parseMeetingReminderError(response));
  }
  const rows = await response.json();
  meetingRemindersCache = Array.isArray(rows)
    ? rows.map(mapApiReminder).filter(Boolean)
    : [];
  syncAnnouncedMeetingReminderKeys();
  refreshMeetingReminderIndicators();
}

async function saveMeetingReminder(record) {
  if (!record?.key) {
    return;
  }
  const response = await nanoFetch(MEETING_REMINDERS_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      calendar_id: record.calendar_id,
      event_id: record.event_id,
      start: record.start,
      end: record.end,
      summary: record.summary,
      all_day: record.all_day,
      lead_minutes: record.lead_minutes,
    }),
  });
  if (!response.ok) {
    throw new Error(await parseMeetingReminderError(response));
  }
  const saved = mapApiReminder(await response.json());
  if (!saved) {
    throw new Error(calendarCopy().requestFailed);
  }
  upsertMeetingReminderInCache(saved);
  refreshMeetingReminderUi(saved.key);
}

async function removeMeetingReminder(key) {
  if (!key) {
    return;
  }
  const reminder = findMeetingReminder(key);
  if (!reminder) {
    removeMeetingReminderFromCache(key);
    refreshMeetingReminderUi(key);
    return;
  }
  const params = new URLSearchParams({
    calendar_id: reminder.calendar_id,
    event_id: reminder.event_id,
    start: reminder.start,
  });
  const response = await nanoFetch(`${MEETING_REMINDERS_API}?${params.toString()}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(await parseMeetingReminderError(response));
  }
  removeMeetingReminderFromCache(key);
  refreshMeetingReminderUi(key);
}

function loadLegacyMeetingReminders() {
  try {
    const raw = window.localStorage.getItem(MEETING_REMINDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => entry && typeof entry === "object" && entry.key);
  } catch (_error) {
    return [];
  }
}

async function migrateLegacyMeetingReminders() {
  const legacy = loadLegacyMeetingReminders();
  if (!legacy.length) {
    return;
  }
  for (const entry of legacy) {
    if (!entry?.key || entry.fired_at) {
      continue;
    }
    const leadMinutes = Number(entry.lead_minutes);
    if (!MEETING_REMINDER_LEAD_OPTIONS.includes(leadMinutes)) {
      continue;
    }
    const start = parseEventDate(entry.start);
    if (!start || start <= new Date() || entry.all_day) {
      continue;
    }
    try {
      await saveMeetingReminder({
        key: entry.key,
        calendar_id: String(entry.calendar_id || "").trim(),
        event_id: String(entry.event_id || "").trim(),
        start: String(entry.start || "").trim(),
        end: String(entry.end || "").trim(),
        summary: String(entry.summary || "").trim(),
        all_day: Boolean(entry.all_day),
        lead_minutes: leadMinutes,
        fired_at: null,
      });
    } catch (_error) {
      return;
    }
  }
  try {
    window.localStorage.removeItem(MEETING_REMINDER_STORAGE_KEY);
  } catch (_error) {
    return;
  }
}

function reminderEventSnapshot(reminder) {
  return {
    id: reminder.event_id,
    calendar_id: reminder.calendar_id,
    summary: reminder.summary,
    start: reminder.start,
    end: reminder.end,
    all_day: reminder.all_day,
  };
}

function buildMeetingReminderStatusText(leadMinutes) {
  const copy = calendarCopy();
  if (leadMinutes === 15) {
    return copy.remindStatus15;
  }
  if (leadMinutes === 30) {
    return copy.remindStatus30;
  }
  if (leadMinutes === 60) {
    return copy.remindStatus1h;
  }
  return "";
}

function buildMeetingReminderAnnouncement(reminder) {
  const event = reminderEventSnapshot(reminder);
  const line = formatMeetingSpeechLine(event, { includeWeekday: false });
  const lead = reminder.lead_minutes;
  return `Reminder. Your meeting starts in ${lead} minutes. ${line}.`;
}

function parseMeetingReminderActivityDetail(detail) {
  const match = /^Reminder:\s*(.+?)\s+starts in\s+(\d+)\s+minutes\.?$/i.exec(
    String(detail || "").trim(),
  );
  if (!match) {
    return null;
  }
  return {
    summary: match[1].trim(),
    lead_minutes: Number(match[2]),
  };
}

function findReminderForActivityEvent(event) {
  const parsed = parseMeetingReminderActivityDetail(event.detail);
  if (!parsed) {
    return null;
  }
  return (
    meetingRemindersCache.find(
      (reminder) =>
        reminder.summary === parsed.summary &&
        reminder.lead_minutes === parsed.lead_minutes &&
        !reminder.fired_at,
    ) || null
  );
}

async function announceMeetingReminderFromActivity(reminder) {
  if (!reminder?.key || announcedMeetingReminderKeys.has(reminder.key)) {
    return;
  }
  announcedMeetingReminderKeys.add(reminder.key);
  const message = buildMeetingReminderAnnouncement(reminder);
  setAnswer(message, { animate: true, allowDuringWorking: true });
  renderState();
  if (voiceAvailable) {
    await playVoice(message, { allowDuringWorking: true });
  }
}

function handleMeetingReminderActivityEvent(event) {
  if (event.kind !== "log" || event.source !== "scheduler.meeting_reminders") {
    return false;
  }
  const reminder = findReminderForActivityEvent(event);
  if (reminder) {
    void announceMeetingReminderFromActivity(reminder);
  }
  void refreshMeetingRemindersFromServer().catch(() => {});
  return true;
}

window.handleMeetingReminderActivityEvent = handleMeetingReminderActivityEvent;

function hasActiveMeetingReminder(event) {
  const key = buildMeetingReminderKey(event);
  if (!key) {
    return false;
  }
  const reminder = findMeetingReminder(key);
  return Boolean(reminder && !reminder.fired_at && reminder.lead_minutes);
}

function refreshMeetingReminderIndicators() {
  for (const chip of document.querySelectorAll(".calendar-event-chip[data-event-key]")) {
    const key = chip.dataset.eventKey || "";
    const reminder = key ? findMeetingReminder(key) : null;
    const armed = Boolean(reminder && !reminder.fired_at && reminder.lead_minutes);
    chip.classList.toggle("calendar-event-chip--remind", armed);
  }
}

function refreshMeetingReminderUi(key) {
  if (key) {
    refreshMeetingReminderControls(key);
  }
  refreshMeetingReminderIndicators();
}

function refreshMeetingReminderControls(key) {
  if (!key) {
    return;
  }
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(key)
      : key.replace(/["\\]/g, "\\$&");
  for (const control of document.querySelectorAll(`[data-meeting-reminder-key="${escaped}"]`)) {
    syncMeetingReminderControl(control);
  }
}

function syncMeetingReminderControl(control) {
  if (!control) {
    return;
  }
  const key = control.dataset.meetingReminderKey || "";
  const reminder = findMeetingReminder(key);
  const activeLead = reminder?.fired_at ? 0 : reminder?.lead_minutes || 0;
  for (const button of control.querySelectorAll(".meeting-reminder-btn")) {
    const lead = Number(button.dataset.lead || 0);
    const isActive = lead === activeLead;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
  const status = control.querySelector(".meeting-reminder-status");
  if (!status) {
    return;
  }
  const statusText = activeLead ? buildMeetingReminderStatusText(activeLead) : "";
  if (statusText) {
    status.textContent = statusText;
    status.hidden = false;
  } else {
    status.textContent = "";
    status.hidden = true;
  }
}

function createMeetingReminderControl(event) {
  if (!event || event.all_day) {
    return null;
  }
  const key = buildMeetingReminderKey(event);
  if (!key) {
    return null;
  }

  const copy = calendarCopy();
  const wrapper = document.createElement("div");
  wrapper.className = "meeting-reminder-control";
  wrapper.dataset.meetingReminderKey = key;

  const label = document.createElement("span");
  label.className = "meeting-reminder-label";
  label.textContent = copy.remindLabel;

  const toggle = document.createElement("div");
  toggle.className = "meeting-reminder-toggle voice-mode-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", copy.remindLabel);

  const offBtn = document.createElement("button");
  offBtn.type = "button";
  offBtn.className = "voice-mode-btn meeting-reminder-btn";
  offBtn.dataset.lead = "0";
  offBtn.textContent = copy.remindOff;
  offBtn.addEventListener("click", () => {
    void removeMeetingReminder(key).catch(() => syncMeetingReminderControl(wrapper));
  });

  toggle.appendChild(offBtn);

  for (const lead of MEETING_REMINDER_LEAD_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "voice-mode-btn meeting-reminder-btn";
    button.dataset.lead = String(lead);
    if (lead === 15) {
      button.textContent = copy.remind15;
    } else if (lead === 30) {
      button.textContent = copy.remind30;
    } else {
      button.textContent = copy.remind1h;
    }
    button.addEventListener("click", () => {
      const record = reminderFromEvent(event, lead);
      if (!record) {
        return;
      }
      void saveMeetingReminder(record).catch(() => syncMeetingReminderControl(wrapper));
    });
    toggle.appendChild(button);
  }

  const status = document.createElement("p");
  status.className = "meeting-reminder-status";
  status.hidden = true;

  wrapper.append(label, toggle, status);
  syncMeetingReminderControl(wrapper);
  return wrapper;
}

async function bootstrapMeetingReminders() {
  await migrateLegacyMeetingReminders();
  await refreshMeetingRemindersFromServer();
  refreshMeetingReminderIndicators();
}

function initMeetingReminders() {
  if (meetingReminderPollTimer !== null) {
    window.clearInterval(meetingReminderPollTimer);
  }
  void bootstrapMeetingReminders().catch(() => {
    meetingRemindersCache = [];
    refreshMeetingReminderIndicators();
  });
  meetingReminderPollTimer = window.setInterval(() => {
    void refreshMeetingRemindersFromServer().catch(() => {});
  }, MEETING_REMINDER_POLL_MS);
}
