import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "static", "home-activity.js");
const src = fs.readFileSync(sourcePath, "utf8");
const lines = src.split("\n");

function extract(ranges) {
  const out = [];
  for (const [start, end] of ranges) {
    out.push(...lines.slice(start - 1, end));
  }
  return `${out.join("\n")}\n`;
}

const files = {
  "static/home-greeting.js": [[1, 193]],
  "static/home-timer-api.js": [[717, 796]],
  "static/home-stopwatches.js": [
    [312, 322],
    [353, 360],
    [412, 671],
    [677, 679],
    [691, 693],
    [798, 806],
    [838, 866],
    [906, 928],
    [1140, 1328],
    [1483, 1486],
  ],
  "static/home-timers.js": [
    [230, 311],
    [323, 352],
    [361, 363],
    [365, 411],
    [673, 716],
    [827, 837],
    [850, 905],
    [929, 1139],
    [1329, 1482],
    [1487, 1732],
  ],
  "static/home-timers-display.js": [[1733, 2049]],
  "static/home-events.js": [[2051, 2261], [2361, 2388]],
  "static/home-metrics.js": [[2263, 2318]],
  "static/home-activity.js": [[195, 228], [2167, 2177], [2320, 2359]],
};

for (const [file, ranges] of Object.entries(files)) {
  const target = path.join(root, file);
  fs.writeFileSync(target, extract(ranges));
  const lineCount = fs.readFileSync(target, "utf8").split("\n").length - 1;
  console.log(`${file}: ${lineCount} lines`);
}
