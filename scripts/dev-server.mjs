import http from "node:http";
import https from "node:https";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3000);
const API_TARGET = (process.env.NANO_API_PROXY || "http://nano.local:8000").replace(/\/$/, "");
const API_URL = new URL(API_TARGET);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function writeConfigJs(res) {
  const origin = `http://localhost:${PORT}`;
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
  res.end(
    `window.NANO_DEV_API_PROXY = true;\n` +
      `window.NANO_DEFAULT_API_URL = ${JSON.stringify(origin)};\n` +
      'window.NANO_DEFAULT_API_KEY = "";\n',
  );
}

function proxyApiRequest(req, res) {
  const headers = { ...req.headers, host: API_URL.host };
  delete headers.connection;

  const transport = API_URL.protocol === "https:" ? https : http;
  const proxyReq = transport.request(
    {
      protocol: API_URL.protocol,
      hostname: API_URL.hostname,
      port: API_URL.port || (API_URL.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`Proxy error: ${error.message}`);
  });

  req.pipe(proxyReq);
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(req.url.split("?")[0] || "/");
  let filePath = join(ROOT, requestPath === "/" ? "index.html" : requestPath.replace(/^\//, ""));

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0] || "/";
  if (path === "/config.js") {
    writeConfigJs(res);
    return;
  }
  if (path.startsWith("/api")) {
    proxyApiRequest(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`nano-ui dev server: http://localhost:${PORT}`);
  console.log(`API proxy target: ${API_TARGET}`);
  console.log("Set local API URL to http://localhost:3000 (dev server serves /config.js).");
});
