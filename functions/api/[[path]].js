const DEFAULT_API_ORIGIN = "http://86.60.218.175:8000";

function resolveApiOrigin(env) {
  const configured = (env.NANO_API_ORIGIN || DEFAULT_API_ORIGIN).trim();
  return configured.replace(/\/$/, "");
}

function buildProxyHeaders(request, targetUrl) {
  const headers = new Headers(request.headers);
  headers.set("host", targetUrl.host);
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  return headers;
}

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const apiOrigin = resolveApiOrigin(context.env);
  const target = new URL(`${apiOrigin}${incoming.pathname}${incoming.search}`);
  const method = context.request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  return fetch(target, {
    method,
    headers: buildProxyHeaders(context.request, target),
    body: hasBody ? context.request.body : undefined,
    redirect: "manual",
  });
}
