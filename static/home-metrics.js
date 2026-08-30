function formatCpuTemp(celsius) {
  return `${Number(celsius).toFixed(1)} °C`;
}

function getCpuTempBand(celsius) {
  if (celsius >= 80) {
    return "hot";
  }
  if (celsius >= 60) {
    return "warm";
  }
  return "ok";
}

function applySystemMetrics(system) {
  if (!cpuTempChip) {
    return;
  }
  const temp = system?.cpu_temperature_celsius;
  if (temp == null) {
    cpuTempChip.textContent = "";
    cpuTempChip.classList.remove("cpu-temp-chip--warm", "cpu-temp-chip--hot", "cpu-temp-chip--throttled");
    cpuTempChip.setAttribute("hidden", "");
    return;
  }
  cpuTempChip.textContent = formatCpuTemp(temp);
  cpuTempChip.classList.remove("cpu-temp-chip--warm", "cpu-temp-chip--hot", "cpu-temp-chip--throttled");
  const band = getCpuTempBand(Number(temp));
  if (band === "warm") {
    cpuTempChip.classList.add("cpu-temp-chip--warm");
  } else if (band === "hot") {
    cpuTempChip.classList.add("cpu-temp-chip--hot");
  }
  if (system?.throttled === true) {
    cpuTempChip.classList.add("cpu-temp-chip--throttled");
  }
  cpuTempChip.removeAttribute("hidden");
}

async function syncSystemMetrics() {
  try {
    const response = await nanoFetch("/api/system/metrics");
    if (!response.ok) {
      return;
    }
    applySystemMetrics(await response.json());
  } catch (_error) {
    return;
  }
}

function startSystemMetricsPolling() {
  window.setInterval(() => {
    void syncSystemMetrics();
  }, SYSTEM_METRICS_POLL_MS);
}
