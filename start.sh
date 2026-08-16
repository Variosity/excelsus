#!/bin/bash
# Starts Piper as a persistent HTTP server (model loaded once, stays warm)
# in the background, waits for it to actually be ready, then starts Node.
set -e

PIPER_HTTP_PORT="${PIPER_HTTP_PORT:-5001}"
VOICE="${PIPER_VOICE:-./voices/en_GB-cori-medium.onnx}"

echo "[start.sh] launching Piper HTTP server on port ${PIPER_HTTP_PORT} with voice ${VOICE}"
python3 -m piper.http_server -m "$VOICE" --host 127.0.0.1 --port "$PIPER_HTTP_PORT" &
PIPER_PID=$!

# Wait for Piper to actually be ready to synthesize before starting Node.
#
# IMPORTANT: this used to poll GET /?text=ready, but the installed
# http_server only synthesizes on POST /synthesize — GET / always returns
# its HTML test page and a 200, regardless of whether the model even
# loaded. That made this check pass even when Piper was broken. Polling
# POST /synthesize with a real (tiny) payload is the only way to confirm
# the model actually loaded and can produce audio.
for i in $(seq 1 30); do
  if curl -sf -X POST "http://127.0.0.1:${PIPER_HTTP_PORT}/synthesize" \
      -H 'Content-Type: application/json' \
      -d '{"text":"ready"}' \
      -o /dev/null; then
    echo "[start.sh] Piper is ready"
    break
  fi
  sleep 1
done

node server.js &
NODE_PID=$!

# If either process dies, bring the container down so Render restarts it.
# wait -n is a bash builtin -- this script MUST run under bash, not sh.
wait -n "$PIPER_PID" "$NODE_PID"