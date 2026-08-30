let weatherInitAttempted = false;

function hideWeatherChip() {
  if (!weatherChip) {
    return;
  }
  weatherChip.textContent = "";
  weatherChip.setAttribute("hidden", "");
}

function applyWeather(data) {
  if (!weatherChip) {
    return;
  }
  const temperature = data?.temperature_c;
  const condition = data?.condition;
  if (temperature == null || !condition) {
    hideWeatherChip();
    return;
  }
  weatherChip.textContent = `${Math.round(temperature)}°C · ${condition}`;
  weatherChip.removeAttribute("hidden");
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 60000,
      timeout: 10000,
    });
  });
}

async function initWeatherOnce() {
  if (weatherInitAttempted || !weatherChip) {
    return;
  }
  weatherInitAttempted = true;

  if (!window.isSecureContext || !navigator.geolocation) {
    return;
  }

  let position;
  try {
    position = await getCurrentPosition();
  } catch (_error) {
    return;
  }

  const body = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
  if (position.coords.accuracy != null) {
    body.accuracy_m = position.coords.accuracy;
  }

  let locRes;
  try {
    locRes = await nanoFetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_error) {
    return;
  }
  if (!locRes.ok) {
    return;
  }

  let weatherRes;
  try {
    weatherRes = await nanoFetch("/api/weather/current");
  } catch (_error) {
    return;
  }
  if (!weatherRes.ok) {
    return;
  }

  try {
    applyWeather(await weatherRes.json());
  } catch (_error) {
    return;
  }
}
