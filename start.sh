#!/bin/bash
# Starts Piper as a persistent HTTP server (model loaded once, stays warm)
# in the background, waits for it to actually be ready, then starts Node.
# This replaces the old per-request `spawn(piper, ...)` approach, which
# reloaded the ONNX model from scratch on every single reply.
set -e

PIPER_HTTP_PORT="${PIPER_HTTP_PORT:-5001}"
VOICE="${PIPER_VOICE:-./voices/en_GB-cori-medium.onnx}"

echo "[start.sh] launching Piper HTTP server on port ${PIPER_HTTP_PORT} with voice ${VOICE}"
python3 -m piper.http_server -m "$VOICE" --host 127.0.0.1 --port "$PIPER_HTTP_PORT" &
PIPER_PID=$!

# Wait for Piper to actually be up before starting Node, so the very first
# request doesn't race a server that isn't listening yet. GET with a query
# param, not POST -- the installed server version rejects POST with 405.
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PIPER_HTTP_PORT}/?text=ready" -o /dev/null; then
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