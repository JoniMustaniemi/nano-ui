# Google Drive (read-only) — nano-ui integration

Nano Core exposes read-only Google Drive access (agent tool + optional REST). Nano UI provides a full-screen **Google Drive** view for asking questions about files.

## Prerequisites (Pi)

- Valid `token.json` with `drive.readonly` (re-run `nano-core auth-google` after enabling the Drive API in GCP).
- The Google account on the Pi must be able to open the file in Drive (sharing).

## Opening Drive mode

- **Commands → Interface → Google Drive** (supplemental `open_drive` client action).

## How users ask (three paths)

All paths use `POST /api/chat` with `{ "message": "...", "mode": "agent" }`.

| File context | UI | Message body |
|--------------|-----|----------------|
| Saved bookmark | Select a link in the list | `{canonical_url}\n\n{question}` |
| Paste link / ID | **Link to file** field (overrides selection) | Same |
| No file | Empty selection and empty link field | `{question}` only |

The UI does **not** add English wrappers (`Context file`, `Question:`). Reply language follows the user’s question text (e.g. Finnish in → Finnish out), same as normal chat.

## Optional preview (REST)

Same Bearer `API_KEY` as other `/api/*` routes (`nanoFetch`).

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/drive/files/{file_id}` | JSON `{ id, name, mime_type, size }` |
| GET | `/api/drive/files/{file_id}/content` | `text/plain` body; headers `X-File-Name`, `X-Content-Truncated=true` when clipped |

Preview errors do not block **Ask Nano**; the agent may still read via `read_google_drive_file`.

### Error hints

| HTTP | Meaning |
|------|---------|
| 503 | Missing/invalid Google token on Pi → run `nano-core auth-google` |
| 404 / 403 | File missing or not shared with the Pi account |

## Local bookmarks

Saved links live in browser `localStorage` (`nano.driveLinks`). Nano Core has no link registry.

## Out of scope (v1)

- Drive file picker / `files.list`
- Write/edit to Drive
- `mode: "chat"` for automatic Drive reads
