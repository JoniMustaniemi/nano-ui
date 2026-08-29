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

function getConfiguredApiUrl() {
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

function shouldUseDevApiProxy(configuredBase) {
  if (window.NANO_DEV_API_PROXY !== true) {
    return false;
  }
  if (!configuredBase) {
    return true;
  }
  try {
    return new URL(configuredBase).origin !== window.location.origin;
  } catch (_error) {
    return true;
  }
}

function resolveApiBase(configuredBase) {
  const normalized = (configuredBase || "").trim().replace(/\/$/, "");
  if (shouldUseDevApiProxy(normalized)) {
    return window.location.origin.replace(/\/$/, "");
  }
  if (normalized) {
    return normalized;
  }
  return window.location.origin.replace(/\/$/, "");
}

function getApiBase() {
  return resolveApiBase(getConfiguredApiUrl());
}

function isCrossOriginApi() {
  try {
    return new URL(getApiBase()).origin !== window.location.origin;
  } catch (_error) {
    return true;
  }
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
  let response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...options,
      headers: withAuthHeaders(options.headers || {}),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Could not reach the API. If you are developing locally, run npm run dev and open http://localhost:3000.",
      );
    }
    throw error;
  }
  return response;
}

function nanoEventSource(path) {
  const apiKey = getApiKey();
  const separator = path.includes("?") ? "&" : "?";
  const authSuffix = apiKey ? `${separator}api_key=${encodeURIComponent(apiKey)}` : "";
  return new EventSource(`${buildApiUrl(path)}${authSuffix}`);
}

async function waitForNano({ timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await nanoFetch("/api/health");
      if (response.ok) {
        return true;
      }
    } catch (_error) {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  return false;
}

window.getApiBase = getApiBase;
window.getConfiguredApiUrl = getConfiguredApiUrl;
window.isCrossOriginApi = isCrossOriginApi;
window.getApiKey = getApiKey;
window.setApiConnection = setApiConnection;
window.hasApiConnection = hasApiConnection;
window.buildApiUrl = buildApiUrl;
window.nanoFetch = nanoFetch;
window.nanoEventSource = nanoEventSource;
window.waitForNano = waitForNano;
