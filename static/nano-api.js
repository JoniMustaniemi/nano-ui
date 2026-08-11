const NANO_API_URL_KEY = "nano.apiUrl";
const NANO_API_KEY_KEY = "nano.apiKey";

function getDefaultApiUrl() {
  if (typeof window.NANO_DEFAULT_API_URL === "string" && window.NANO_DEFAULT_API_URL.trim()) {
    return window.NANO_DEFAULT_API_URL.trim().replace(/\/$/, "");
  }
  return "";
}

function getDefaultApiKey() {
  if (typeof window.NANO_DEFAULT_API_KEY === "string") {
    return window.NANO_DEFAULT_API_KEY.trim();
  }
  return "";
}

function getApiBase() {
  try {
    const stored = window.localStorage.getItem(NANO_API_URL_KEY);
    if (stored && stored.trim()) {
      return stored.trim().replace(/\/$/, "");
    }
  } catch (_error) {
    return getDefaultApiUrl();
  }
  return getDefaultApiUrl();
}

function getApiKey() {
  try {
    const stored = window.localStorage.getItem(NANO_API_KEY_KEY);
    if (stored !== null) {
      return stored.trim();
    }
  } catch (_error) {
    return getDefaultApiKey();
  }
  return getDefaultApiKey();
}

function setApiConnection(apiUrl, apiKey) {
  const normalizedUrl = (apiUrl || "").trim().replace(/\/$/, "");
  window.localStorage.setItem(NANO_API_URL_KEY, normalizedUrl);
  window.localStorage.setItem(NANO_API_KEY_KEY, (apiKey || "").trim());
}

function hasApiConnection() {
  return Boolean(getApiBase());
}

function buildApiUrl(path) {
  const base = getApiBase();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function withAuthHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  const apiKey = getApiKey();
  if (apiKey) {
    nextHeaders.Authorization = `Bearer ${apiKey}`;
  }
  return nextHeaders;
}

async function nanoFetch(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers: withAuthHeaders(options.headers || {}),
  });
  return response;
}

function nanoEventSource(path) {
  const apiKey = getApiKey();
  const separator = path.includes("?") ? "&" : "?";
  const authSuffix = apiKey ? `${separator}api_key=${encodeURIComponent(apiKey)}` : "";
  return new EventSource(`${buildApiUrl(path)}${authSuffix}`);
}

window.getApiBase = getApiBase;
window.getApiKey = getApiKey;
window.setApiConnection = setApiConnection;
window.hasApiConnection = hasApiConnection;
window.buildApiUrl = buildApiUrl;
window.nanoFetch = nanoFetch;
window.nanoEventSource = nanoEventSource;
