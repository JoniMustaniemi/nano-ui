const DEFAULT_API_ORIGIN = "http://86.60.218.175:8000";
const IP_PROXY_HOSTNAME = "nano-api.internal";

function resolveApiOrigin(env) {
  const configured = (env.NANO_API_ORIGIN || DEFAULT_API_ORIGIN).trim();
  return configured.replace(/\/$/, "");
}

function isIpAddress(hostname) {
  if (!hostname) {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return true;
  }

  return hostname.startsWith("[") && hostname.endsWith("]");
}

function buildProxyHeaders(request, backendUrl) {
  const headers = new Headers(request.headers);
  headers.set("host", backendUrl.host);
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  return headers;
}

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const apiOrigin = resolveApiOrigin(context.env);
  const backend = new URL(`${apiOrigin}${incoming.pathname}${incoming.search}`);
  const method = context.request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const fetchUrl = new URL(backend);
  const fetchOptions = {
    method,
    headers: buildProxyHeaders(context.request, backend),
    body: hasBody ? context.request.body : undefined,
    redirect: "manual",
  };

  // Cloudflare blocks fetch() to literal IP addresses (error 1003 -> 403).
  if (isIpAddress(backend.hostname)) {
    fetchOptions.cf = { resolveOverride: backend.hostname };
    fetchUrl.hostname = IP_PROXY_HOSTNAME;
  }

  return fetch(fetchUrl, fetchOptions);
}
