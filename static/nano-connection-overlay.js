const CONNECTION_OVERLAY_MODES = new Set(["connecting", "rebooting", "restarting"]);

const CONNECTION_OVERLAY_COPY = {
  connecting: {
    headline: "Trying to connect",
    detail: "Looking for Nano on your network.",
    status: "Checking connection",
  },
  rebooting: {
    headline: "Rebooting Nano",
    detail: "The Raspberry Pi is shutting down and starting back up.",
    status: "Reboot in progress",
  },
  restarting: {
    headline: "Restarting Nano",
    detail: "Nano is restarting and will be back shortly.",
    status: "Restart in progress",
  },
};

const REBOOT_OVERLAY_STEPS = [
  "Rebooting Raspberry Pi",
  "Starting up",
  "Reconnecting",
];

let connectionOverlayRetryHandler = null;

function ensureConnectionOverlay() {
  let overlay = document.getElementById("nano-connection-overlay");
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement("section");
  overlay.id = "nano-connection-overlay";
  overlay.className = "nano-connection-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="nano-connection-shell" role="status" aria-live="polite">
      <div class="nano-connection-orb" aria-hidden="true">
        <span class="nano-connection-orb-ring"></span>
        <span class="nano-connection-orb-core"></span>
      </div>
      <div class="nano-connection-copy">
        <h2 id="nano-connection-headline" class="nano-connection-headline"></h2>
        <p id="nano-connection-detail" class="nano-connection-detail"></p>
        <ol id="nano-connection-steps" class="nano-connection-steps" hidden></ol>
        <p id="nano-connection-status" class="nano-connection-status"></p>
      </div>
      <div class="nano-connection-actions" hidden>
        <button type="button" id="nano-connection-retry" class="nano-connection-retry">Refresh</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const steps = overlay.querySelector("#nano-connection-steps");
  for (const label of REBOOT_OVERLAY_STEPS) {
    const item = document.createElement("li");
    item.className = "nano-connection-step";
    item.textContent = label;
    steps.appendChild(item);
  }

  const retryButton = overlay.querySelector("#nano-connection-retry");
  retryButton.addEventListener("click", () => {
    if (typeof connectionOverlayRetryHandler === "function") {
      connectionOverlayRetryHandler();
    }
  });

  return overlay;
}

function clearConnectionOverlayBodyClasses() {
  document.body.classList.remove(
    "nano-connection-active",
    "connection-waiting",
    "nano-connection-mode--connecting",
    "nano-connection-mode--rebooting",
    "nano-connection-mode--restarting",
  );
}

function applyConnectionOverlayMode(mode) {
  clearConnectionOverlayBodyClasses();
  document.body.classList.add("nano-connection-active");
  if (mode === "connecting") {
    document.body.classList.add("connection-waiting");
  }
  document.body.classList.add(`nano-connection-mode--${mode}`);
}

function setConnectionOverlayStep(stepIndex) {
  const overlay = document.getElementById("nano-connection-overlay");
  if (!overlay) {
    return;
  }
  const steps = overlay.querySelectorAll(".nano-connection-step");
  steps.forEach((step, index) => {
    if (stepIndex < 0) {
      step.classList.remove("is-active", "is-done");
      return;
    }
    step.classList.toggle("is-active", index === stepIndex);
    step.classList.toggle("is-done", index < stepIndex);
  });
}

function showConnectionOverlay(mode, options = {}) {
  const normalizedMode = CONNECTION_OVERLAY_MODES.has(mode) ? mode : "connecting";
  connectionOverlayMode = normalizedMode;

  const overlay = ensureConnectionOverlay();
  const copy = CONNECTION_OVERLAY_COPY[normalizedMode];
  const headline = overlay.querySelector("#nano-connection-headline");
  const detail = overlay.querySelector("#nano-connection-detail");
  const status = overlay.querySelector("#nano-connection-status");
  const steps = overlay.querySelector("#nano-connection-steps");
  const actions = overlay.querySelector(".nano-connection-actions");

  headline.textContent = copy.headline;
  detail.textContent = options.detailText || copy.detail;
  status.textContent = options.statusText || copy.status;
  steps.hidden = normalizedMode !== "rebooting";
  actions.hidden = true;

  if (normalizedMode === "rebooting") {
    setConnectionOverlayStep(0);
  } else {
    setConnectionOverlayStep(-1);
  }

  applyConnectionOverlayMode(normalizedMode);
  overlay.hidden = false;

  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }
}

function updateConnectionOverlayStatus(text) {
  const status = document.getElementById("nano-connection-status");
  if (!status) {
    return;
  }
  status.textContent = text || "";
}

function updateConnectionOverlayDetail(text) {
  const detail = document.getElementById("nano-connection-detail");
  if (!detail) {
    return;
  }
  detail.textContent = text || "";
}

function showConnectionOverlayFailure(message, onRetry) {
  const overlay = ensureConnectionOverlay();
  const status = overlay.querySelector("#nano-connection-status");
  const actions = overlay.querySelector(".nano-connection-actions");
  status.textContent = message || "Could not reconnect. Check the Pi and refresh.";
  actions.hidden = false;
  connectionOverlayRetryHandler = onRetry || null;
  overlay.hidden = false;
}

function hideConnectionOverlay() {
  const overlay = document.getElementById("nano-connection-overlay");
  if (overlay) {
    overlay.hidden = true;
    const actions = overlay.querySelector(".nano-connection-actions");
    if (actions) {
      actions.hidden = true;
    }
  }
  connectionOverlayMode = null;
  connectionOverlayRetryHandler = null;
  clearConnectionOverlayBodyClasses();

  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }
}

window.showConnectionOverlay = showConnectionOverlay;
window.hideConnectionOverlay = hideConnectionOverlay;
window.updateConnectionOverlayStatus = updateConnectionOverlayStatus;
window.updateConnectionOverlayDetail = updateConnectionOverlayDetail;
window.setConnectionOverlayStep = setConnectionOverlayStep;
window.showConnectionOverlayFailure = showConnectionOverlayFailure;
