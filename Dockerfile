FROM node:20-slim

# Piper's original repo (rhasspy/piper) is archived and its prebuilt binary
# tarballs are gone. Active development moved to OHF-Voice/piper1-gpl, which
# as of v1.3.0 ships as a pip package only (no standalone binary release) —
# so we install it via pip instead of downloading a tarball.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages piper-tts

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]