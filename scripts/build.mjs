import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

writeFileSync(
  join(root, "config.js"),
  'window.NANO_DEFAULT_API_URL = "";\nwindow.NANO_DEFAULT_API_KEY = "";\n',
);
