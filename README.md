# Excelsus

Your portable Jarvis — a voice AI assistant wired directly into the
Excelsus CRM at excelsus.base44.app, running on Gemini 2.5 Flash, with a
neon-red futuristic HUD you can install on your phone and PC as a PWA.

## Stack (all free)

- **Brain**: Gemini 2.5 Flash (Google AI Studio) — generous free tier, strong tool-calling
- **CRM bridge**: `@base44/sdk`, authenticated as you, talking directly to your Lead/Client/Proposal entities
- **STT**: browser's built-in Web Speech API — free, works on phone and PC, zero server audio streaming
- **TTS**: Piper, self-hosted, unlimited, no character caps
- **Web search**: Brave Search API free tier
- **Email**: your Gmail via an app password
- **Hosting**: Render or Fly.io free tier
- **UI**: installable PWA — add to home screen on phone, or just keep a tab pinned on PC

## How it thinks

Every message you send goes to Gemini along with a set of tool
definitions (`lib/base44Tools.js`, `lib/generalTools.js`). Gemini decides
on its own whether it needs to call a tool — pull your leads, check MRR,
search the web, send an email — before answering. This is effectively
your "subagents": each tool is a scoped capability, and Gemini routes to
whichever one the request needs. You can add more tools later by adding
a declaration + handler and including them in `TOOL_SETS` in `server.js`.

## 1. Get your keys

- **Gemini**: aistudio.google.com/apikey — free, no card
- **Base44 app ID**: open excelsus.base44.app in the Base44 editor, grab the ID from the URL
- **Base44 login**: your own email/password for that app (external apps get user-level permissions only — there's no service-role access from outside Base44, so Excelsus operates as you)
- **Brave Search** (optional, for web search): api.search.brave.com — free tier, 2,000 queries/month
- **Gmail app password** (optional, for sending email): Google Account → Security → 2-Step Verification → App passwords. Generate one specifically for this, not your real password.

## 2. Get a voice

Download a Piper voice model from https://huggingface.co/rhasspy/piper-voices
and drop the `.onnx` + `.onnx.json` files into `./voices/`. I defaulted
`PIPER_VOICE` to `en_US-ryan-high.onnx` — a deeper, more "assistant"-sounding
male voice — but try a couple before you commit; voice preference is
personal and I can't hear them from here. If you use a different one,
update `PIPER_VOICE` in `.env` to match the filename.

You'll also need the `piper` binary itself locally (the Dockerfile handles
this automatically for deployment) — grab it from
https://github.com/OHF-Voice/piper1-gpl/releases (the original rhasspy/piper
repo is archived but its last release still works).

## 3. Run it locally

```bash
npm install
cp .env.example .env   # fill in the keys above
node server.js
```

Open `http://localhost:8080` in Chrome (Web Speech API needs Chrome or
Edge — Safari and Firefox support is inconsistent). Tap the mic, talk,
watch the ring pulse.

## 4. Deploy so it's reachable from your phone anywhere

**Render** (simplest): New → Web Service → point at this repo → choose
**Docker** as the environment → add your `.env` values as dashboard env
vars → deploy. You'll get a permanent `https://your-app.onrender.com` URL.

Free tier spins down after inactivity — the first request after a quiet
stretch has a several-second cold start. Ping `/health` every ~10 minutes
with a free uptime monitor (UptimeRobot) if that bugs you.

## 5. Install it on your phone

Visit your Render URL in Chrome on your phone → menu → "Add to Home
Screen." It launches full-screen, no browser chrome, like a real app. Same
works on desktop Chrome via the install icon in the address bar.

## What each tool actually does right now

- `list_leads` / `create_lead` / `update_lead_status` — your Lead pipeline
- `list_clients` — your Client roster
- `get_dashboard_stats` — lead counts by stage, client counts by status, live MRR (sums `monthly_revenue` across active clients)
- `list_proposals` — recently generated proposals
- `web_search` — live web results via Brave
- `send_email` — sends from your Gmail, as you
- `get_current_datetime` — so it doesn't guess what day it is

Try things like: *"How many qualified leads do I have in Orlando?"*,
*"What's my current MRR?"*, *"Add a lead — Bella's Nail Studio, Winter
Garden, no website yet"*, *"Search for the latest Base44 pricing changes
and summarize it."*

## Known limitations / next steps

- **Subagents are currently just tool-scoped routing inside one Gemini
  call**, not separate persistent agents with their own memory — genuinely
  fine for this scale of task, but if you want a dedicated "lead-gen agent"
  that runs multi-step autonomous scraping on a schedule, that's a
  different, bigger build (a real background job, not a chat turn).
- **Ollama/Gemma3 isn't wired in yet.** If you want a private/local mode
  for anything sensitive, the cleanest add is a `local_llm` tool that
  proxies to your PC's Ollama over Tailscale, only invoked when you
  explicitly ask for it.
- **No calendar/booking tool yet** — natural next addition once you're
  using this daily and know what you actually reach for.
- **send_email has no confirmation step in the UI** — the system prompt
  tells Gemini to describe the email back to you before sending, but
  that's a soft instruction, not a hard gate. If you want a real "are you
  sure" click-to-confirm before anything goes out, that's worth adding
  before you rely on this for anything sensitive.
- Conversation history is kept in memory per browser tab/connection only —
  refreshing the page starts a fresh conversation. Worth knowing before
  you lean on it for continuity across sessions.
