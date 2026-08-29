// For `npm run dev`, use the proxied same-origin API URL:
window.NANO_DEFAULT_API_URL = "http://localhost:3000";
window.NANO_DEFAULT_API_KEY = "";

// Direct nano-core URL (only if UI is served from the same origin, or PATCH/DELETE CORS
// and OPTIONS preflight are configured):
// window.NANO_DEFAULT_API_URL = "http://nano.local:8000";
