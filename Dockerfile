FROM node:20-slim

# Piper's original repo (rhasspy/piper) is archived and its prebuilt binary
# tarballs are gone. Active development moved to OHF-Voice/piper1-gpl, which
# as of v1.3.0 ships as a pip package only (no standalone binary release) —
# so we install it via pip instead of downloading a tarball.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages 'piper-tts[http]'

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Voice model: not baked in here on purpose — see README, step 2.
# businesses aside, this app is single-voice; PIPER_VOICE env var points at
# whatever .onnx file you commit into ./voices/.

# Piper now runs as a persistent HTTP server (loads the model once, stays
# warm) instead of being spawned fresh per request — that per-request
# spawn was the source of the 1-2 minute reply delay, since it meant
# booting Python + reloading the ONNX model from disk on every single
# message. start.sh launches the Piper server in the background, then Node.
RUN chmod +x start.sh

EXPOSE 8080
CMD ["./start.sh"]