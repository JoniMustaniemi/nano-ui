const homeModules = await fetch("./static/home-modules.json?v=module-entry-21").then((response) => {
  if (!response.ok) {
    throw new Error("Failed to load home module manifest.");
  }
  return response.json();
});

const HOME_SCRIPT_ORDER = ["nano-api.js", "nano-settings.js", ...homeModules];

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
  await loadClassicScript(`./static/${file}?v=module-entry-21`);
}
