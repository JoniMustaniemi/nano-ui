async function parseJsonResponse(response, fallbackMessage) {
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    if (!response.ok) {
      throw new Error(`${fallbackMessage} (${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(data.detail || `${fallbackMessage} (${response.status}).`);
  }
  return data;
}

async function patchResource(path, body, fallbackMessage) {
  const response = await nanoFetch(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, fallbackMessage);
}

async function deleteResource(path, fallbackMessage, options = {}) {
  const response = await nanoFetch(path, {
    method: "DELETE",
  });
  if (response.status === 204) {
    return;
  }
  if (response.status === 404 && typeof options.onNotFound === "function") {
    return options.onNotFound(response);
  }
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    if (!response.ok) {
      const error = options.createError
        ? options.createError(`${fallbackMessage} (${response.status}).`, response.status)
        : new Error(`${fallbackMessage} (${response.status}).`);
      throw error;
    }
    return;
  }
  if (!response.ok) {
    const message = data.detail || `${fallbackMessage} (${response.status}).`;
    throw options.createError ? options.createError(message, response.status) : new Error(message);
  }
}

async function patchTimerLabel(id, label) {
  return patchResource(
    `/api/timers/${encodeURIComponent(id)}`,
    { label },
    "Timer rename failed",
  );
}

async function patchStopwatchLabel(id, label) {
  return patchResource(
    `/api/stopwatches/${encodeURIComponent(id)}`,
    { label },
    "Stopwatch rename failed",
  );
}

async function deleteTimerById(id) {
  const normalizedId = id != null ? String(id).trim() : "";
  if (!normalizedId) {
    throw new Error("Timer id is required.");
  }
  return deleteResource(
    `/api/timers/${encodeURIComponent(normalizedId)}`,
    "Timer cancel failed",
  );
}
