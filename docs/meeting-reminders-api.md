# Meeting reminders API

**Status:** Implemented in nano-core. nano-ui uses GET/PUT/DELETE on this API plus `scheduler.meeting_reminders` activity events for rich browser speech when the tab is open.

## Overview

Persisted meeting reminders on the Pi (SQLite), keyed by Google Calendar event instance: `calendar_id` + `event_id` + `start`.

- One lead time per instance: 15, 30, or 60 minutes before start
- Server computes `remind_at = start - lead_minutes`
- Background scheduler fires at `remind_at` (activity log + voice), sets `fired_at`
- All routes require Google Calendar connected (503 if token missing)
- v1 rejects all-day events (400)

## Base URL

All routes under: `/api/calendar/meeting-reminders`

Auth: same as other `/api/*` routes (Bearer API_KEY if configured).

## Endpoints

### 1) LIST active reminders

`GET /api/calendar/meeting-reminders`

Returns reminders where `fired_at IS NULL` and `start > now`.

Response: array of Reminder objects.

### 2) UPSERT reminder

`PUT /api/calendar/meeting-reminders`

Body:

```json
{
  "calendar_id": "primary",
  "event_id": "abc123google",
  "start": "2026-08-31T10:00:00+03:00",
  "end": "2026-08-31T11:00:00+03:00",
  "summary": "Team sync",
  "all_day": false,
  "lead_minutes": 30
}
```

Returns full Reminder object (includes `id`, `remind_at`, `fired_at`, `created_at`, `updated_at`).

Re-upserting same `calendar_id` + `event_id` + `start` replaces `lead_minutes` and clears `fired_at`.

### 3) DELETE reminder

`DELETE /api/calendar/meeting-reminders?calendar_id=primary&event_id=abc123google&start=2026-08-31T10:00:00+03:00`

Response: 204 (idempotent if already missing).

## Reminder response shape

```json
{
  "id": "rem_01h2example",
  "calendar_id": "primary",
  "event_id": "abc123google",
  "start": "2026-08-31T10:00:00+03:00",
  "end": "2026-08-31T11:00:00+03:00",
  "summary": "Team sync",
  "all_day": false,
  "lead_minutes": 30,
  "remind_at": "2026-08-31T09:30:00+03:00",
  "fired_at": null,
  "created_at": "2026-08-31T08:00:00+03:00",
  "updated_at": "2026-08-31T08:00:00+03:00"
}
```

## Errors

Align with calendar API:

- 400: `all_day=true`, start in past, invalid `lead_minutes` (must be 15|30|60)
- 422: bad ISO datetime
- 503: calendar not connected

## UI integration (nano-ui)

Implemented in `static/home-meeting-reminders.js`:

- In-memory `meetingRemindersCache` synced via `GET /api/calendar/meeting-reminders` (30s poll)
- `PUT` / `DELETE` on user toggle changes
- One-time migration from legacy `localStorage` key `nano.meetingReminders` on first load
- Rich client speech when tab is open: `handleMeetingReminderActivityEvent` on `scheduler.meeting_reminders` SSE events
- When tab is closed, core fires with basic voice: `Reminder: {summary} starts in {lead_minutes} minutes.`

## Reschedule behavior

If Google moves an event, `start` changes → treat as new instance. UI should PUT new reminder with new start. Old instance naturally drops out of GET once `start <= now` (server prunes expired rows). Optional: UI can DELETE old instance explicitly when it detects reschedule.

## Not in v1 (defer)

- `POST /api/calendar/meeting-reminders/bulk`
- `GET /api/calendar/meeting-reminders/pending`
- `POST /api/calendar/meeting-reminders/{id}/ack`
