require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const gemini = require('./lib/gemini');
const groq = require('./lib/groq');
const base44Tools = require('./lib/base44Tools');
const generalTools = require('./lib/generalTools');
const { createEmailTools } = require('./lib/emailTools');
const { stripMarkdownForSpeech } = require('./lib/textForSpeech');
const tts = require('./lib/tts');

// If Piper hangs, or the container gets OOM-killed mid-synthesis, don't
// leave the socket waiting indefinitely — fail fast with a clear error so
// the client resets instead of sitting on "PROCESSING" until the WS itself
// eventually drops.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

const PORT = process.env.PORT || 8080;

for (const key of ['GEMINI_API_KEY', 'BASE44_APP_ID', 'BASE44_EMAIL', 'BASE44_PASSWORD']) {
  if (!process.env[key]) console.warn(`[warn] ${key} is not set — related features will fail.`);
}
if (!process.env.GROQ_API_KEY) {
  console.warn('[warn] GROQ_API_KEY is not set — no fallback if Gemini fails.');
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  // Conversation history in Gemini `contents` format, kept per-connection.
  let history = [];

  // Email tools are stateful (a pending draft) and must not be shared
  // across connections — a fresh instance per tab/session, pushing its
  // state changes straight to this socket for the confirmation card.
  const emailTools = createEmailTools((event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });
  const TOOL_SETS = [base44Tools, generalTools, emailTools];

  ws.send(JSON.stringify({ type: 'ready' }));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type !== 'message' || !msg.text?.trim()) return;

    ws.send(JSON.stringify({ type: 'thinking' }));

    try {
      let replyText, newHistory;
      try {
        ({ replyText, history: newHistory } = await gemini.runTurn(history, msg.text, TOOL_SETS));
      } catch (geminiErr) {
        // Gemini failed for any reason — quota, rate limit, outage, bad
        // request — fall back to Groq rather than surfacing an error.
        console.warn('[gemini] failed, falling back to Groq:', geminiErr.message);
        ({ replyText, history: newHistory } = await groq.runTurn(history, msg.text, TOOL_SETS));
      }
      history = newHistory;
      // Trim history so the request body doesn't grow without bound over a long session
      if (history.length > 40) history = history.slice(history.length - 40);

      ws.send(JSON.stringify({ type: 'reply', text: replyText }));

      if (msg.voice !== false) {
        try {
          // Piper speaks literal characters — "**Noland's Roofing**" gets
          // the asterisks read aloud instead of skipped — and stripping
          // markdown also shrinks longer list-style replies before they
          // hit synthesis, which matters on a memory-constrained instance.
          const speechText = stripMarkdownForSpeech(replyText);
          const wav = await withTimeout(tts.synthesize(speechText), 25000, 'TTS synthesis');
          console.log(`[tts] synthesized ${wav.length} bytes for reply of ${replyText.length} chars (${speechText.length} chars after markdown strip)`);
          if (wav.length < 100) {
            console.warn('[tts] suspiciously small WAV — likely not valid audio, sending anyway for inspection');
          }
          ws.send(JSON.stringify({ type: 'audio', audio: wav.toString('base64') }));
        } catch (err) {
          console.error('[tts] error:', err.message);
          ws.send(JSON.stringify({ type: 'audio_error', error: err.message }));
        }
      }
    } catch (err) {
      console.error('[gemini] error:', err.message);
      ws.send(JSON.stringify({ type: 'reply', text: `Something broke on my end: ${err.message}` }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Excelsus is listening on port ${PORT}`);
});