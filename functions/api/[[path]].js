function resolveApiOrigin(env) {
  const configured = (env?.NANO_API_ORIGIN || "").trim();
  if (!configured) {
    throw new Error("NANO_API_ORIGIN environment variable is required");
  }
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

function resolveBackendUrl(apiOrigin, incoming) {
  const backend = new URL(`${apiOrigin}${incoming.pathname}${incoming.search}`);
  if (isIpAddress(backend.hostname)) {
    backend.hostname = `${backend.hostname}.nip.io`;
  }
  return backend;
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
  let apiOrigin;
  try {
    apiOrigin = resolveApiOrigin(context.env);
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
  const backend = resolveBackendUrl(apiOrigin, incoming);
  const method = context.request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  return fetch(backend, {
    method,
    headers: buildProxyHeaders(context.request, backend),
    body: hasBody ? context.request.body : undefined,
    redirect: "manual",
  });
}
