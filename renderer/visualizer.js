const Viz = (() => {
  let canvas, ctx, analyser = null, freq = null, wave = null;
  let mode = 'bars';
  let demo = false;
  let sourceMode = 'all';
  let gateCb = null;
  try { sourceMode = localStorage.getItem('viz_src') || 'all'; } catch (e) {}
  let t = 0;
  const Y = '#FCEE0A', C = '#00F0FF', M = '#FF2A3C';

  function setAudioStatus(s) {
    const el = document.getElementById('audio-status');
    if (el) { el.dataset.base = s; el.textContent = s; }
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  async function init() {
    canvas = document.getElementById('viz');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    try {
      const sources = await window.cyber.getSources();
      if (!sources.length) throw new Error('no capture sources');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } },
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } }
      });
      // keep video track alive: stopping it can kill loopback audio in some Electron builds
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      if (ac.state !== 'running') ac.resume();
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
      setAudioStatus('AUDIO: LOOPBACK ONLINE');
    } catch (e) {
      demo = true;
      freq = new Uint8Array(512);
      wave = new Uint8Array(1024);
      setAudioStatus('AUDIO: DEMO MODE (capture unavailable)');
    }
    requestAnimationFrame(loop);
  }

  function sample() {
    if (analyser) {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);
    } else if (demo) {
      for (let i = 0; i < freq.length; i++) {
        const base = Math.exp(-i / 140) * 150;
        freq[i] = Math.max(0, Math.min(255, base * (0.6 + 0.4 * Math.sin(t / 22 + i * 0.35)) + 18 * Math.sin(t / 9 + i)));
      }
      for (let i = 0; i < wave.length; i++) {
        wave[i] = 128 + 60 * Math.sin(i / 26 + t / 8) * Math.sin(t / 40);
      }
    }
  }

  function drawBars() {
    const W = canvas.width, H = canvas.height;
    const N = 72;
    const bw = W / N;
    for (let i = 0; i < N; i++) {
      const v = freq[Math.floor(Math.pow(i / N, 1.6) * (freq.length * 0.7))] / 255;
      const h = Math.max(3 + Math.abs(Math.sin(t / 30 + i * 0.4)) * 5, v * H * 0.42);
      const x = i * bw + 1;
      const ratio = i / N;
      const col = ratio < 0.55 ? Y : (ratio < 0.8 ? '#FF7A00' : M);
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, H - h, bw - 3, h);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x, H - h - 6 - h * 0.25, bw - 3, h * 0.25);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawWave() {
    const W = canvas.width, H = canvas.height;
    const mid = H * 0.78;
    const passes = [
      { col: C, dx: -2, dy: 0 },
      { col: M, dx: 2, dy: 1 },
      { col: Y, dx: 0, dy: -1 }
    ];
    for (const p of passes) {
      ctx.beginPath();
      for (let i = 0; i < wave.length; i += 2) {
        const x = (i / wave.length) * W + p.dx;
        const y = mid + ((wave[i] - 128) / 128) * H * 0.16 + p.dy;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = p.col;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = p.col;
      ctx.shadowBlur = 10;
      ctx.globalAlpha = p.col === Y ? 0.9 : 0.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawRing() {
    const art = document.getElementById('art-frame');
    const r0 = art ? art.getBoundingClientRect() : null;
    const cx = r0 ? r0.left + r0.width / 2 : canvas.width / 2;
    const cy = r0 ? r0.top + r0.height / 2 : canvas.height / 2;
    const base = (r0 ? r0.width / 2 : 150) + 16;
    const N = 96;
    const rot = t / 120;
    for (let i = 0; i < N; i++) {
      const v = freq[Math.floor(Math.pow(i / N, 1.4) * (freq.length * 0.6))] / 255;
      const len = 6 + v * 90;
      const a = (i / N) * Math.PI * 2 + rot;
      const x1 = cx + Math.cos(a) * base;
      const y1 = cy + Math.sin(a) * base;
      const x2 = cx + Math.cos(a) * (base + len);
      const y2 = cy + Math.sin(a) * (base + len);
      const col = i % 3 === 0 ? Y : (i % 3 === 1 ? M : 'rgba(232,236,239,.7)');
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = C;
    ctx.setLineDash([4, 10]);
    ctx.lineDashOffset = -t / 4;
    ctx.beginPath();
    ctx.arc(cx, cy, base + 100, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function loop() {
    t++;
    sample();
    if (sourceMode === 'spotify' && gateCb && !gateCb()) { freq.fill(0); if (wave) wave.fill(128); }
    if (t % 30 === 0) { let sum = 0; for (let i = 0; i < 64; i++) sum += freq[i]; const lvl = Math.round(sum / 64); const el2 = document.getElementById('audio-status'); if (el2 && el2.dataset.base) el2.textContent = el2.dataset.base + ' · LVL ' + lvl; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === 'bars') drawBars();
    else if (mode === 'wave') drawWave();
    else drawRing();
    requestAnimationFrame(loop);
  }

  return {
    init,
    setMode: m => { mode = m; },
    setSourceMode: m => { sourceMode = m; try { localStorage.setItem('viz_src', m); } catch (e) {} },
    setGate: cb => { gateCb = cb; }
  };
})();


