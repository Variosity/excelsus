(() => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const core = document.getElementById('core');
  const coreLabel = document.getElementById('coreLabel');
  const transcript = document.getElementById('transcript');
  const micBtn = document.getElementById('micBtn');
  const textForm = document.getElementById('textForm');
  const textInput = document.getElementById('textInput');
  const voiceToggle = document.getElementById('voiceToggle');
  const player = document.getElementById('player');
  const canvas = document.getElementById('waveform');
  const ctx = canvas.getContext('2d');

  let ws = null;
  let voiceEnabled = true;
  let recognizing = false;
  let recognition = null;

  // ---------------------------------------------------------------------
  // Audio unlock — MUST run synchronously inside a real user tap/click.
  // Once player (an <audio> element) is routed through createMediaElement-
  // Source into this AudioContext, ALL of its sound depends on the context
  // being 'running'. Calling resume() later, from an async event like the
  // <audio> element's own 'play' handler (which can fire seconds after the
  // last real tap, once a WebSocket reply comes back), gets silently
  // ignored by mobile browsers — the element still plays/ends normally,
  // just with zero audible output. That silent-but-"working" state was
  // the actual bug. Calling this directly inside mic/send tap handlers
  // keeps it inside the gesture's call stack, where resume() reliably works.
  let audioCtx, analyser, sourceNode, dataArray;

  function unlockAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      sourceNode = audioCtx.createMediaElementSource(player);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  // ---------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => setStatus(true, 'ONLINE');
    ws.onclose = () => {
      setStatus(false, 'RECONNECTING');
      setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'ready':
          setStatus(true, 'ONLINE');
          break;
        case 'thinking':
          setCoreState('thinking', 'PROCESSING');
          break;
        case 'reply':
          addMessage('bot', msg.text);
          if (!voiceEnabled) setCoreState('idle', 'STANDING BY');
          break;
        case 'audio':
          playAudio(msg.audio);
          break;
        case 'audio_error':
          setCoreState('idle', 'STANDING BY');
          break;
        case 'pending_email':
          addEmailCard('pending', msg.email);
          break;
        case 'email_sent':
          addEmailCard('sent', msg.email);
          break;
        case 'email_cancelled':
          addEmailCard('cancelled', msg.email);
          break;
        case 'email_failed':
          addEmailCard('failed', msg.email, msg.error);
          break;
      }
    };
  }

  function setStatus(online, label) {
    statusDot.classList.toggle('online', online);
    statusText.textContent = label;
  }

  function setCoreState(state, label) {
    core.classList.remove('listening', 'speaking', 'thinking');
    if (state !== 'idle') core.classList.add(state);
    coreLabel.textContent = label;
  }

  function send(text) {
    if (!text.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;
    addMessage('user', text);
    ws.send(JSON.stringify({ type: 'message', text, voice: voiceEnabled }));
  }

  // ---------------------------------------------------------------------
  // Transcript UI
  // ---------------------------------------------------------------------
  let activeEmailCardEl = null;

  const STATUS_LABEL = {
    pending: 'AWAITING CONFIRMATION',
    sent: 'SENT',
    cancelled: 'CANCELLED',
    failed: 'SEND FAILED'
  };

  function addEmailCard(status, email, error) {
    // Resolve an existing pending card in place rather than stacking a
    // second one — makes it visually obvious the same draft went through.
    let el = status !== 'pending' && activeEmailCardEl ? activeEmailCardEl : null;
    if (!el) {
      el = document.createElement('div');
      transcript.appendChild(el);
    }

    el.className = `email-card ${status}`;
    el.innerHTML = `
      <div class="ec-header"><span class="dot"></span>${STATUS_LABEL[status]}</div>
      <div class="ec-field"><b>TO</b>${escapeHtml(email.to)}</div>
      <div class="ec-field"><b>SUBJECT</b>${escapeHtml(email.subject)}</div>
      <div class="ec-body">${escapeHtml(email.body)}</div>
      ${error ? `<div class="ec-field" style="margin-top:8px;color:var(--red-bright);"><b>ERROR</b>${escapeHtml(error)}</div>` : ''}
    `;

    activeEmailCardEl = status === 'pending' ? el : null;
    transcript.scrollTop = transcript.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function addMessage(role, text) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = role === 'user' ? 'YOU' : 'EXCELSUS';
    el.appendChild(label);
    el.appendChild(document.createTextNode(text));
    transcript.appendChild(el);
    transcript.scrollTop = transcript.scrollHeight;
  }

  textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudio();
    send(textInput.value);
    textInput.value = '';
  });

  voiceToggle.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('on', voiceEnabled);
  });
  voiceToggle.classList.add('on');

  // ---------------------------------------------------------------------
  // Speech recognition (STT) — free, built into the browser
  // ---------------------------------------------------------------------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add('active');
      setCoreState('listening', 'LISTENING');
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      send(text);
    };

    recognition.onerror = () => {
      recognizing = false;
      micBtn.classList.remove('active');
      setCoreState('idle', 'STANDING BY');
    };

    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove('active');
      if (coreLabel.textContent === 'LISTENING') setCoreState('idle', 'STANDING BY');
    };
  } else {
    micBtn.title = 'Speech recognition not supported in this browser — use Chrome/Edge, or type instead.';
    micBtn.style.opacity = '0.35';
  }

  micBtn.addEventListener('click', () => {
    unlockAudio();
    if (!recognition) return;
    if (recognizing) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch {
        /* already started */
      }
    }
  });

  // ---------------------------------------------------------------------
  // Audio playback (TTS)
  // ---------------------------------------------------------------------
  // State only flips to SPEAKING once the browser actually confirms
  // playback started (the 'playing' event) — not the moment play() is
  // called, since play() can silently fail (blocked autoplay, bad blob,
  // decode error) and previously left the UI stuck showing SPEAKING
  // forever with no audio and no way back to idle.
  let playbackWatchdog = null;

  function playAudio(base64Wav) {
    const blob = b64ToBlob(base64Wav, 'audio/wav');
    const url = URL.createObjectURL(blob);
    player.src = url;

    // Stay on PROCESSING (set by the 'thinking' message) until playback
    // is actually confirmed — don't jump to SPEAKING early.
    clearTimeout(playbackWatchdog);
    playbackWatchdog = setTimeout(() => {
      // Playback never started or never fired an event within a
      // reasonable window — don't leave the UI stuck.
      setCoreState('idle', 'STANDING BY');
    }, 8000);

    player.play().catch(() => {
      // Autoplay can be blocked before the first user gesture on mobile.
      // The 'error' listener below and the watchdog above both cover
      // recovering from this — nothing further needed here.
    });
  }

  player.addEventListener('playing', () => {
    clearTimeout(playbackWatchdog);
    setCoreState('speaking', 'SPEAKING');
  });

  player.addEventListener('ended', () => {
    clearTimeout(playbackWatchdog);
    setCoreState('idle', 'STANDING BY');
  });

  player.addEventListener('error', () => {
    clearTimeout(playbackWatchdog);
    setCoreState('idle', 'STANDING BY');
  });

  function b64ToBlob(base64, mime) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    return new Blob([new Uint8Array(byteNumbers)], { type: mime });
  }

  // ---------------------------------------------------------------------
  // Waveform visualizer — reacts to actual TTS playback level via
  // Web Audio's AnalyserNode; idle-animates otherwise. The context/graph
  // itself is set up by unlockAudio() (called on mic/send tap) — see note
  // above. This just does a defensive resume() in case a browser needs a
  // nudge right as playback starts; unlockAudio() is what does the real work.
  player.addEventListener('play', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });

  function draw() {
    requestAnimationFrame(draw);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = 78;
    const bars = 64;

    let levels;
    if (analyser && core.classList.contains('speaking')) {
      analyser.getByteFrequencyData(dataArray);
      levels = dataArray;
    } else {
      levels = null;
    }

    ctx.strokeStyle = '#ff1a2e';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,26,46,0.8)';
    ctx.shadowBlur = 8;

    const t = performance.now() / 1000;

    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2;
      let amp;
      if (levels) {
        const v = levels[i % levels.length] / 255;
        amp = 8 + v * 46;
      } else if (core.classList.contains('listening')) {
        amp = 6 + Math.abs(Math.sin(t * 4 + i * 0.5)) * 18;
      } else if (core.classList.contains('thinking')) {
        amp = 6 + Math.abs(Math.sin(t * 8 + i * 0.9)) * 10;
      } else {
        amp = 5 + Math.sin(t * 1.2 + i * 0.3) * 3;
      }

      const x1 = cx + Math.cos(angle) * baseRadius;
      const y1 = cy + Math.sin(angle) * baseRadius;
      const x2 = cx + Math.cos(angle) * (baseRadius + amp);
      const y2 = cy + Math.sin(angle) * (baseRadius + amp);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  requestAnimationFrame(draw);

  // ---------------------------------------------------------------------
  // Service worker (installable PWA)
  // ---------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  connect();
})();