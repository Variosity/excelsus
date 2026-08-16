/**
 * Piper TTS -> WAV buffer, ready to base64-encode and play in the browser
 * via an <audio> element.
 *
 * Talks to a persistent Piper HTTP server (started by start.sh /
 * `python3 -m piper.http_server`) rather than spawning a fresh `piper`
 * process per request, so the ONNX model loads once and stays warm.
 *
 * IMPORTANT: the actual installed piper-tts HTTP server (piper/http_server.py,
 * OHF-Voice/piper1-gpl) only synthesizes audio on POST /synthesize with a
 * JSON body. GET / always returns its built-in HTML test page regardless of
 * any query string — there is no GET-with-?text= synthesis route. An
 * earlier version of this file called GET /?text=..., which returned 200
 * every time (so it looked like it was working in the logs) but the body
 * was always that HTML page, not audio — which the browser then failed to
 * decode as WAV. Confirmed by reading the installed package source and
 * reproducing both requests against a mock server before shipping this fix.
 */

const PIPER_HTTP_PORT = process.env.PIPER_HTTP_PORT || '5001';
const PIPER_HTTP_URL = `http://127.0.0.1:${PIPER_HTTP_PORT}`;

/**
 * @param {string} text
 * @returns {Promise<Buffer>} a complete WAV file
 */
async function synthesize(text) {
  const resp = await fetch(`${PIPER_HTTP_URL}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Piper HTTP server error ${resp.status}: ${errText}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const arrayBuffer = await resp.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  // Defensive check: catch a wrong-route or misconfigured-proxy regression
  // immediately with a clear error, instead of shipping non-audio bytes to
  // the browser again and getting a cryptic NotSupportedError three hops
  // downstream.
  const looksLikeWav = buf.subarray(0, 4).toString('ascii') === 'RIFF';
  if (!looksLikeWav) {
    throw new Error(
      `Piper HTTP server did not return WAV audio (content-type: ${contentType || 'unknown'}, first bytes: ${buf.subarray(0, 40).toString('utf8')})`
    );
  }

  return buf;
}

module.exports = { synthesize };