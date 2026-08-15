/**
 * Piper TTS -> WAV buffer, ready to base64-encode and play in the browser
 * via an <audio> element. No ffmpeg/resampling needed here since we're not
 * constrained to telephony's 8kHz mu-law — the browser will happily play
 * whatever sample rate Piper's voice model natively outputs (usually
 * 22050Hz), we just need to wrap it in a WAV header.
 */

const { spawn } = require('child_process');

const PIPER_BIN = process.env.PIPER_BIN || 'piper';
const PIPER_VOICE = process.env.PIPER_VOICE || './voices/en_US-ryan-high.onnx';
const PIPER_SAMPLE_RATE = parseInt(process.env.PIPER_SAMPLE_RATE || '22050', 10);

function pcm16ToWav(pcmBuffer, sampleRate) {
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

/**
 * @param {string} text
 * @returns {Promise<Buffer>} a complete WAV file
 */
function synthesize(text) {
  return new Promise((resolve, reject) => {
    const piper = spawn(PIPER_BIN, ['--model', PIPER_VOICE, '--output-raw']);

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    piper.on('error', fail);

    const chunks = [];
    piper.stdout.on('data', (chunk) => chunks.push(chunk));
    piper.stderr.on('data', () => {}); // Piper logs progress to stderr, ignore it

    piper.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`piper exited with code ${code} and produced no audio`));
        return;
      }
      const pcm = Buffer.concat(chunks);
      resolve(pcm16ToWav(pcm, PIPER_SAMPLE_RATE));
    });

    piper.stdin.write(text + '\n');
    piper.stdin.end();
  });
}

module.exports = { synthesize };
