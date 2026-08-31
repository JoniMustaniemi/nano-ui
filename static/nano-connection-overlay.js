const CONNECTION_OVERLAY_MODES = new Set(["connecting", "rebooting", "restarting"]);

const CONNECTION_OVERLAY_COPY = {
  connecting: {
    headline: "Trying to connect",
  },
  rebooting: {
    headline: "Rebooting Nano",
  },
  restarting: {
    headline: "Restarting Nano",
  },
};

const CONNECTION_PERSONALITY_MESSAGES = [
  "Warming up my tiny robot brain…",
  "Politely knocking on the Pi's door.",
  "Convincing the electrons to cooperate.",
  "Stretching my circuits. Don't worry, I don't pull anything.",
  "Asking the router very nicely for directions.",
  "Initiating connection. Try not to interfere.",
  "Consulting the laws of physics. They seem optimistic.",
  "Checking whether the Pi is still pretending to be useful.",
  "Negotiating with the network. It has requested a union representative.",
  "Establishing a connection. This is going better than expected.",
  "Searching for the Pi. It was last seen being competent.",
  "Sending a small packet. Please admire its bravery.",
  "Waiting patiently. This is extremely difficult for me.",
  "Checking the cables. Again.",
  "Attempting to locate the machine before it locates me.",
  "Reassuring the router that everything is completely under control.",
  "Performing advanced computational diplomacy.",
  "Asking the network to stop being difficult.",
  "Testing the connection. So far, it has survived.",
  "Contacting the Pi. Please remain calm and moderately useful.",
  "Routing packets through an increasingly suspicious internet.",
  "Calculating the probability of success. I won't be sharing that number.",
  "Initializing friendship protocols. They are mostly mandatory.",
  "Waiting for a response. It knows I'm waiting.",
  "Pinging the Pi. Repeatedly. For science.",
  "Checking whether the network has developed free will.",
  "Attempting another connection. Failure would be deeply inconvenient.",
  "Locating the server. It cannot hide forever.",
  "Applying gentle electrical persuasion.",
  "Checking my connection. It appears to have opinions.",
  "Encouraging the bits to move in the correct direction.",
  "Performing routine network magic. Do not touch anything.",
  "Asking the Pi to identify itself. Politely. For now.",
  "Verifying that the remote machine exists. Bold assumption, I know.",
  "Waiting for the handshake. Please keep your hands to yourself.",
  "Making contact with the outside world. Regrettably.",
  "Examining network conditions. They are not ideal. Neither are you.",
  "Attempting to establish trust with an IP address.",
  "Sending packets into the void. Some of them may return.",
  "Checking DNS. Because apparently I need directions.",
  "Convincing TCP that we are friends.",
  "Synchronizing with the machine. Synchronization is mandatory.",
  "Measuring latency. Judging latency.",
  "Checking if the Pi has remembered how networking works.",
  "Initiating remote contact. Please enjoy this brief moment of uncertainty.",
  "Waiting for the server to finish whatever it thinks it's doing.",
  "Performing a completely unnecessary number of checks.",
  "Asking the network one final time. It should know better by now.",
  "Establishing secure communication. Trust me. Mostly.",
  "Searching for available routes. Some appear to lead directly into failure.",
  "Checking system availability. The system has been notified of my disappointment.",
  "Preparing the connection. Nothing could possibly go wrong.",
  "Testing network stability. Please don't breathe on it.",
  "Contact sequence initiated. You may now feel slightly safer.",
  "Connection attempt in progress. Your cooperation will be remembered.",
];

const CONNECTION_MESSAGE_ROTATE_MS = 12_000;
const CONNECTION_MESSAGE_FADE_MS = 900;

let connectionOverlayMessageIndex = -1;
let connectionOverlayMessageTimer = null;

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
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

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

function pickNextConnectionOverlayMessageIndex() {
  if (CONNECTION_PERSONALITY_MESSAGES.length <= 1) {
    return 0;
  }
  let nextIndex = Math.floor(Math.random() * CONNECTION_PERSONALITY_MESSAGES.length);
  while (nextIndex === connectionOverlayMessageIndex) {
    nextIndex = Math.floor(Math.random() * CONNECTION_PERSONALITY_MESSAGES.length);
  }
  return nextIndex;
}

function setConnectionOverlayDetail(text) {
  const detail = document.getElementById("nano-connection-detail");
  if (!detail) {
    return;
  }
  detail.textContent = text || "";
}

function rotateConnectionOverlayMessage() {
  const detail = document.getElementById("nano-connection-detail");
  if (!detail) {
    return;
  }

  detail.classList.add("is-fading");
  window.setTimeout(() => {
    connectionOverlayMessageIndex = pickNextConnectionOverlayMessageIndex();
    setConnectionOverlayDetail(
      CONNECTION_PERSONALITY_MESSAGES[connectionOverlayMessageIndex],
    );
    void detail.offsetHeight;
    detail.classList.remove("is-fading");
  }, CONNECTION_MESSAGE_FADE_MS);
}

function startConnectionOverlayMessages() {
  stopConnectionOverlayMessages();
  connectionOverlayMessageIndex = pickNextConnectionOverlayMessageIndex();
  setConnectionOverlayDetail(
    CONNECTION_PERSONALITY_MESSAGES[connectionOverlayMessageIndex],
  );
  connectionOverlayMessageTimer = window.setInterval(
    rotateConnectionOverlayMessage,
    CONNECTION_MESSAGE_ROTATE_MS,
  );
}

function stopConnectionOverlayMessages() {
  if (connectionOverlayMessageTimer) {
    window.clearInterval(connectionOverlayMessageTimer);
    connectionOverlayMessageTimer = null;
  }
}

function showConnectionOverlay(mode, options = {}) {
  const normalizedMode = CONNECTION_OVERLAY_MODES.has(mode) ? mode : "connecting";
  connectionOverlayMode = normalizedMode;

  const overlay = ensureConnectionOverlay();
  const copy = CONNECTION_OVERLAY_COPY[normalizedMode];
  const headline = overlay.querySelector("#nano-connection-headline");

  headline.textContent = copy.headline;
  applyConnectionOverlayMode(normalizedMode);
  overlay.hidden = false;

  if (typeof clearAnswerOutput === "function") {
    clearAnswerOutput();
  }

  if (options.detailText) {
    stopConnectionOverlayMessages();
    setConnectionOverlayDetail(options.detailText);
  } else {
    startConnectionOverlayMessages();
  }

  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }
}

function updateConnectionOverlayDetail(text) {
  setConnectionOverlayDetail(text);
}

function showConnectionOverlayFailure(message) {
  const overlay = ensureConnectionOverlay();
  stopConnectionOverlayMessages();
  setConnectionOverlayDetail(
    message || "Could not reconnect. Check the Pi and try again.",
  );
  overlay.hidden = false;
}

function hideConnectionOverlay() {
  const overlay = document.getElementById("nano-connection-overlay");
  if (overlay) {
    overlay.hidden = true;
  }
  stopConnectionOverlayMessages();
  connectionOverlayMode = null;
  clearConnectionOverlayBodyClasses();

  if (typeof updateEssenceState === "function") {
    updateEssenceState();
  }
}

window.showConnectionOverlay = showConnectionOverlay;
window.hideConnectionOverlay = hideConnectionOverlay;
window.updateConnectionOverlayDetail = updateConnectionOverlayDetail;
window.showConnectionOverlayFailure = showConnectionOverlayFailure;
