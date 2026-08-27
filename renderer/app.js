(async function () {
  setTimeout(() => { const b = document.getElementById('boot'); if (b) b.remove(); }, 2400);

  const $ = id => document.getElementById(id);

  // background rotation
  (function () {
    const imgs = ['../assets/bg.png', '../assets/bg1.png', '../assets/bg2.png', '../assets/bg3.png'];
    let i = 0;
    let front = document.getElementById('bgA'), back = document.getElementById('bgB');
    front.style.backgroundImage = 'url("' + imgs[0] + ')';
    front.classList.add('on');
    setInterval(() => {
      i = (i + 1) % imgs.length;
      back.style.backgroundImage = 'url("' + imgs[i] + ')';
      back.classList.add('on');
      front.classList.remove('on');
      const t = front; front = back; back = t;
    }, 60000);
  })();

  // clock
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); }, 1000);

  // window controls
  $('btn-min').onclick = () => window.cyber.minimize();
  $('btn-close').onclick = () => window.cyber.hide();
  $('btn-pin').onclick = async () => {
    const now = $('btn-pin').classList.contains('active');
    const v = await window.cyber.setAlwaysOnTop(!now);
    $('btn-pin').classList.toggle('active', v);
  };
  $('opacity').oninput = e => window.cyber.setOpacity(+e.target.value / 100);

  // visualizer modes
  document.querySelectorAll('.mode:not([data-src])').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.mode:not([data-src])').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      Viz.setMode(b.dataset.mode);
    };
  });

  let spotifyOnPc = false;
  Viz.setGate(() => spotifyOnPc);
  document.querySelectorAll('[data-src]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('[data-src]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      Viz.setSourceMode(b.dataset.src);
    };
  });
  const savedSrc = localStorage.getItem('viz_src') || 'all';
  if (savedSrc !== 'all') {
    document.querySelectorAll('[data-src]').forEach(x => x.classList.toggle('active', x.dataset.src === savedSrc));
    Viz.setSourceMode(savedSrc);
  }

  // status UI
  function setStatus(kind, text) {
    const s = $('status');
    s.className = 'status ' + kind;
    s.innerHTML = '&#9679; ' + text;
  }

  Spotify.onStatus(kind => {
    if (kind === 'online') { setStatus('online', 'LINK ONLINE'); $('btn-login').classList.add('hidden'); }
    else if (kind === 'offline') setStatus('offline', 'LINK OFFLINE');
    else if (kind === 'auth-error') { setStatus('offline', 'AUTH FAIL'); $('btn-login').classList.remove('hidden'); }
    else if (kind === 'premium-error') setStatus('offline', 'NEED PREMIUM');
    else if (kind === 'sdk-error') setStatus('offline', 'SDK ERROR');
  });

  // track UI
  let lastTrackId = null;
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  Spotify.onState(state => {
    const hint = $('source-hint');
    if (state && state.device) {
      hint.textContent = state.device.type === 'Computer' ? 'AUDIO SOURCE: SYSTEM LOOPBACK' : ('⚠ 声音在「' + state.device.name + '」上 - 频谱需本机播放(桌面版/网页版)');
    }
    spotifyOnPc = !!(state && !state.paused && state.device && state.device.type === 'Computer');
    if (!state || !state.track_window || !state.track_window.current_track) {
      $('idle').classList.remove('hidden');
      $('title').textContent = 'NO SIGNAL';
      $('title').dataset.text = 'NO SIGNAL';
      $('artist').textContent = '— 等待 Spotify 连接 —';
      return;
    }
    const tr = state.track_window.current_track;
    $('idle').classList.add('hidden');
    $('title').textContent = tr.name;
    $('title').dataset.text = tr.name;
    $('artist').textContent = tr.artists.map(a => a.name).join(' / ');
    if (tr.album && tr.album.images && tr.album.images.length) $('art').src = tr.album.images[0].url; $('art').classList.remove('hidden');
    $('btn-play').innerHTML = state.paused ? '&#9654;' : '&#10074;&#10074;';
    if (tr.id !== lastTrackId) {
      lastTrackId = tr.id;
      Lyrics.fetchFor({ title: tr.name, artist: tr.artists.map(a => a.name).join(' '), duration: tr.duration_ms, id: tr.id }).then(v => showOff(v));
    }
  });

  // progress + lyrics polling
  setInterval(async () => {
    const st = await Spotify.getState();
    if (!st || !st.track_window || !st.track_window.current_track) return;
    const tr = st.track_window.current_track;
    const pct = tr.duration_ms ? (st.position / tr.duration_ms) * 100 : 0;
    $('progress').style.width = Math.min(100, pct) + '%';
    $('time').textContent = fmt(st.position) + ' / ' + fmt(tr.duration_ms);
    Lyrics.update(st.position / 1000);
  }, 250);

  // transport controls
  $('btn-play').onclick = () => Spotify.togglePlay();
  $('btn-next').onclick = () => Spotify.next();
  $('btn-prev').onclick = () => Spotify.prev();
  $('vol').oninput = e => Spotify.setVolume(+e.target.value / 100);

  // setup / auth flow
  document.querySelector('.brand').onclick = () => $('setup').classList.remove('hidden');
  window.cyber.onSpotifyCallback(d => Spotify.handleCallback(d));
  $('btn-login').onclick = () => Spotify.login();
  $('dash-link').onclick = e => { e.preventDefault(); window.cyber.openExternal('https://developer.spotify.com/dashboard'); };
  $('save-cfg').onclick = async () => {
    const id = $('client-id').value.trim();
    if (!id) return;
    await window.cyber.configSet({ spotify_client_id: id });
    $('setup').classList.add('hidden');
    Spotify.init(id);
    $('btn-login').classList.remove('hidden');
    setStatus('idle', 'READY TO LOGIN');
  };
  $('copy-redirect').onclick = () => { navigator.clipboard.writeText('http://127.0.0.1:8901/callback'); $('copy-redirect').textContent = '已复制 ✔'; };
  $('skip-cfg').onclick = () => $('setup').classList.add('hidden');

  const cfg = await window.cyber.configGet();
  if (cfg && cfg.spotify_client_id) {
    Spotify.init(cfg.spotify_client_id);
    if (Spotify.hasToken()) {
      setStatus('idle', 'CONNECTING...');
      Spotify.initPlayer();
    } else {
      $('btn-login').classList.remove('hidden');
      setStatus('idle', 'READY TO LOGIN');
    }
  } else {
    $('setup').classList.remove('hidden');
  }

  const showOff = v => { $('off-val').textContent = (v > 0 ? '+' : '') + v.toFixed(1) + 's'; };
  $('off-earlier').onclick = () => showOff(Lyrics.adjustOffset(0.5));
  $('off-later').onclick = () => showOff(Lyrics.adjustOffset(-0.5));
  Lyrics.onSeek(ms => Spotify.seek(ms));
  Lyrics.init();
  Viz.init();
})();





