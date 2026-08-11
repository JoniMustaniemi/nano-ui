function ensureConnectionSettingsUi() {
  let overlay = document.getElementById("nano-connection-settings");
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("section");
  overlay.id = "nano-connection-settings";
  overlay.className = "nano-connection-settings";
  overlay.innerHTML = `
    <div class="nano-connection-panel" role="dialog" aria-labelledby="nano-connection-title">
      <h2 id="nano-connection-title">Connect to Nano</h2>
      <p>Enter your Pi API URL and key. All processing happens on the Pi.</p>
      <label for="nano-connection-url">API URL</label>
      <input id="nano-connection-url" type="url" placeholder="https://your-pi.example.com" />
      <label for="nano-connection-key">API key</label>
      <input id="nano-connection-key" type="password" placeholder="API key" autocomplete="off" />
      <p id="nano-connection-status" class="nano-connection-status" aria-live="polite"></p>
      <div class="nano-connection-actions">
        <button id="nano-connection-test" type="button">Test connection</button>
        <button id="nano-connection-save" type="button">Connect</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const urlInput = overlay.querySelector("#nano-connection-url");
  const keyInput = overlay.querySelector("#nano-connection-key");
  const status = overlay.querySelector("#nano-connection-status");
  const testButton = overlay.querySelector("#nano-connection-test");
  const saveButton = overlay.querySelector("#nano-connection-save");

  urlInput.value = getApiBase();
  keyInput.value = getApiKey();

  testButton.addEventListener("click", async () => {
    setApiConnection(urlInput.value, keyInput.value);
    status.textContent = "Testing connection...";
    try {
      const response = await nanoFetch("/api/health");
      if (!response.ok) {
        throw new Error(`Health check failed (${response.status}).`);
      }
      const payload = await response.json();
      status.textContent = `Connected to ${payload.app} (${payload.status}).`;
    } catch (error) {
      status.textContent = error.message;
    }
  });

  saveButton.addEventListener("click", async () => {
    setApiConnection(urlInput.value, keyInput.value);
    if (!hasApiConnection()) {
      status.textContent = "API URL is required.";
      return;
    }
    status.textContent = "Connecting...";
    try {
      const response = await nanoFetch("/api/health");
      if (!response.ok) {
        throw new Error(`Could not connect (${response.status}).`);
      }
      overlay.hidden = true;
      if (typeof bootstrap === "function") {
        await bootstrap();
      }
    } catch (error) {
      status.textContent = error.message;
    }
  });

  return overlay;
}

async function ensureApiConnection() {
  if (hasApiConnection()) {
    try {
      const response = await nanoFetch("/api/health");
      if (response.ok) {
        return true;
      }
    } catch (_error) {
      // Fall through to settings UI.
    }
  }

  const overlay = ensureConnectionSettingsUi();
  overlay.hidden = false;
  return false;
}

window.ensureApiConnection = ensureApiConnection;
