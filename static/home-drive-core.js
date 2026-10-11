const DRIVE_LINKS_STORAGE_KEY = "nano.driveLinks";
const DRIVE_FILE_PATH_PATTERN = /\/file\/d\/([a-zA-Z0-9_-]+)/;
const DRIVE_OPEN_ID_PATTERN = /[?&]id=([a-zA-Z0-9_-]+)/;
const DRIVE_BARE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;

function parseDriveFileId(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return null;
  }
  const pathMatch = trimmed.match(DRIVE_FILE_PATH_PATTERN);
  if (pathMatch) {
    return pathMatch[1];
  }
  try {
    const url = new URL(trimmed);
    const urlPathMatch = url.pathname.match(DRIVE_FILE_PATH_PATTERN);
    if (urlPathMatch) {
      return urlPathMatch[1];
    }
    const idParam = url.searchParams.get("id");
    if (idParam && DRIVE_BARE_ID_PATTERN.test(idParam)) {
      return idParam;
    }
  } catch (_error) {
    // Not a URL; fall through to bare id / query patterns.
  }
  const openMatch = trimmed.match(DRIVE_OPEN_ID_PATTERN);
  if (openMatch) {
    return openMatch[1];
  }
  if (DRIVE_BARE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function driveCanonicalFileUrl(fileId) {
  const id = String(fileId || "").trim();
  if (!id) {
    return "";
  }
  return `https://drive.google.com/file/d/${id}/view`;
}

function composeDriveAgentMessage({ url, question }) {
  const q = String(question || "").trim();
  const u = String(url || "").trim();
  if (!u) {
    return q;
  }
  if (!q) {
    return u;
  }
  return `${u}\n\n${q}`;
}

function messageAlreadyHasDriveContext(message) {
  const text = String(message || "").trim();
  if (!text) {
    return false;
  }
  if (parseDriveFileId(text)) {
    return true;
  }
  return DRIVE_FILE_PATH_PATTERN.test(text) || DRIVE_OPEN_ID_PATTERN.test(text);
}

function loadDriveLinks() {
  try {
    const raw = window.localStorage.getItem(DRIVE_LINKS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => ({
        id: String(entry?.id || "").trim(),
        label: String(entry?.label || "").trim(),
        url: String(entry?.url || "").trim(),
      }))
      .filter((entry) => entry.id && entry.label && entry.url && parseDriveFileId(entry.url));
  } catch (_error) {
    return [];
  }
}

function saveDriveLinks(links) {
  const normalized = Array.isArray(links)
    ? links.filter((entry) => entry?.id && entry?.label && entry?.url)
    : [];
  window.localStorage.setItem(DRIVE_LINKS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function createDriveLinkId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `drive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapDriveApiError(status, detail) {
  const message = typeof detail === "string" ? detail.trim() : "";
  if (status === 503) {
    return (
      message ||
      "Google is not connected on the Pi. Enable the Drive API in GCP, then run `nano-core auth-google`."
    );
  }
  if (status === 404 || status === 403) {
    return message || "File not found or not shared with the Pi Google account.";
  }
  return message || "Could not load Drive file.";
}

async function fetchDriveMetadata(fileId) {
  const id = parseDriveFileId(fileId);
  if (!id) {
    throw new Error("Invalid Drive file link or ID.");
  }
  const response = await nanoFetch(`/api/drive/files/${encodeURIComponent(id)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(mapDriveApiError(response.status, data.detail));
  }
  return data;
}

async function fetchDriveContent(fileId) {
  const id = parseDriveFileId(fileId);
  if (!id) {
    throw new Error("Invalid Drive file link or ID.");
  }
  const response = await nanoFetch(`/api/drive/files/${encodeURIComponent(id)}/content`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(mapDriveApiError(response.status, data.detail));
  }
  const text = await response.text();
  return {
    text,
    fileName: response.headers.get("X-File-Name") || "",
    truncated: response.headers.get("X-Content-Truncated") === "true",
  };
}

function resolveDriveContextUrl({ linkInput, selectedLink }) {
  const linkText = String(linkInput || "").trim();
  if (linkText) {
    const fileId = parseDriveFileId(linkText);
    if (!fileId) {
      return { url: null, error: "Enter a valid Google Drive link or file ID." };
    }
    return { url: driveCanonicalFileUrl(fileId), error: null };
  }
  const bookmarkUrl = String(selectedLink?.url || "").trim();
  if (bookmarkUrl && parseDriveFileId(bookmarkUrl)) {
    return { url: bookmarkUrl, error: null };
  }
  return { url: null, error: null };
}

window.DRIVE_LINKS_STORAGE_KEY = DRIVE_LINKS_STORAGE_KEY;
window.parseDriveFileId = parseDriveFileId;
window.driveCanonicalFileUrl = driveCanonicalFileUrl;
window.composeDriveAgentMessage = composeDriveAgentMessage;
window.messageAlreadyHasDriveContext = messageAlreadyHasDriveContext;
window.loadDriveLinks = loadDriveLinks;
window.saveDriveLinks = saveDriveLinks;
window.createDriveLinkId = createDriveLinkId;
window.mapDriveApiError = mapDriveApiError;
window.fetchDriveMetadata = fetchDriveMetadata;
window.fetchDriveContent = fetchDriveContent;
window.resolveDriveContextUrl = resolveDriveContextUrl;
