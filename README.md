# Nano UI

Thin web client for [Nano Core](https://github.com/). All assistant processing happens on your Pi; this UI only displays state and forwards commands.

## Setup

1. Copy `config.example.js` to `config.js` for local defaults.
2. Serve the static files from this directory.
3. On first visit, enter your Pi API URL and API key.

```bash
npm run dev
```

## Deploy

Host as a static site (Vercel, Netlify, GitHub Pages, etc.). The UI needs HTTPS for microphone capture.

Configure your Pi with:

- `API_KEY` — shared secret for UI and API clients
- `CORS_ALLOWED_ORIGINS` — your hosted UI origin(s)

## Architecture

- **nano-ui** — display client: renders Pi state via SSE/REST, collects text and push-to-talk audio
- **nano-core** — processing backend on Raspberry Pi: LLM, tools, STT, TTS, scheduling

Voice in the browser uses push-to-talk: raw audio is uploaded to `POST /api/voice/command` on the Pi. Wake phrase listening runs on Pi hardware when `VOICE_INPUT_ENABLED=true`.
