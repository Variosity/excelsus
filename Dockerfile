FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget tar ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Piper's original repo (rhasspy/piper) is archived; the last stable binary
# release still works and is mirrored under the new org. Check
# https://github.com/OHF-Voice/piper1-gpl/releases for anything newer.
RUN wget -q -O /tmp/piper.tar.gz \
      https://github.com/OHF-Voice/piper1-gpl/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /opt \
    && rm /tmp/piper.tar.gz
ENV PATH="/opt/piper:${PATH}"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Voice model: not baked in here on purpose — see README, step 2.
# businesses aside, this app is single-voice; PIPER_VOICE env var points at
# whatever .onnx file you commit into ./voices/.

EXPOSE 8080
CMD ["node", "server.js"]
