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

async function createStopwatch({ label = "Stopwatch", startAt = null } = {}) {
  const body = {
    label: String(label || "Stopwatch").trim() || "Stopwatch",
  };
  if (startAt != null) {
    body.start_at = startAt;
  }
  const response = await nanoFetch("/api/stopwatches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 404 || response.status === 405) {
    const error = new Error("Stopwatch create is not available. Upgrade nano-core on the Pi.");
    error.status = response.status;
    throw error;
  }
  return parseJsonResponse(response, "Stopwatch create failed");
}

async function deleteStopwatchById(id) {
  const normalizedId = id != null ? String(id).trim() : "";
  if (!normalizedId) {
    throw new Error("Stopwatch id is required.");
  }
  return deleteResource(
    `/api/stopwatches/${encodeURIComponent(normalizedId)}`,
    "Stopwatch stop failed",
    {
      createError: (message, status) => {
        if (typeof createStopwatchApiError === "function") {
          return createStopwatchApiError(message, status);
        }
        const error = new Error(message);
        error.status = status;
        return error;
      },
    },
  );
}

async function createCountdownTimer({ durationSeconds, label = "Timer", startAt = null } = {}) {
  const duration = Math.floor(Number(durationSeconds));
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Timer duration must be a positive number of seconds.");
  }
  const body = {
    duration_seconds: duration,
    label: String(label || "Timer").trim() || "Timer",
  };
  if (startAt != null) {
    body.start_at = startAt;
  }
  const response = await nanoFetch("/api/timers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 404) {
    throw new Error("Timer create is not available. Upgrade nano-core on the Pi.");
  }
  return parseJsonResponse(response, "Timer create failed");
}
