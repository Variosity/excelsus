/**
 * Piper TTS -> WAV buffer, ready to base64-encode and play in the browser
 * via an <audio> element.
 *
 * This talks to a persistent Piper HTTP server (started by start.sh /
 * `python3 -m piper.http_server`) rather than spawning a fresh `piper`
 * process per request. Spawning per-request meant reloading the ONNX
 * model from disk on every single reply — the source of the 1-2 minute
 * delay before audio started. The HTTP server loads the model once and
 * stays warm, so a synthesis call is just a fast local HTTP round-trip.
 * The server already returns a complete WAV file, so no manual header
 * construction is needed here anymore.
 */

const PIPER_HTTP_PORT = process.env.PIPER_HTTP_PORT || '5001';
const PIPER_HTTP_URL = `http://127.0.0.1:${PIPER_HTTP_PORT}`;

/**
 * @param {string} text
 * @returns {Promise<Buffer>} a complete WAV file
 */
async function synthesize(text) {
  const url = `${PIPER_HTTP_URL}/?text=${encodeURIComponent(text)}`;
  const resp = await fetch(url, { method: 'GET' });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Piper HTTP server error ${resp.status}: ${errText}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { synthesize };