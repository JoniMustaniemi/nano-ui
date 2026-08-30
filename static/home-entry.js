const HOME_SCRIPT_ORDER = [
  "nano-api.js",
  "nano-settings.js",
  "home-state.js",
  "home-calendar.js",
  "home-ui.js",
  "home-view-session.js",
  "home-voice.js",
  "home-activity.js",
  "home-reconnect.js",
  "home-chat.js",
  "home-weather.js",
  "home-bootstrap.js",
];

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

for (const file of HOME_SCRIPT_ORDER) {
  if (file === "nano-api.js" || file === "nano-settings.js") {
    continue;
  }
  await loadClassicScript(`./static/${file}?v=module-entry-20`);
}
