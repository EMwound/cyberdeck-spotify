const Lyrics = (() => {
  let lines = [];
  let currentIdx = -1;
  let seekCb = null;
  let holdUntil = 0;
  let holding = false;
  let scrollCur = 0;
  let target = 0;
  let offset = 0;
  let trackId = null;

  const listEl = () => document.getElementById('lyrics');
  const scrollEl = () => document.getElementById('lyrics-scroll');
  const padEl = () => document.getElementById('lyrics-pad');
  const backBtn = () => document.getElementById('back-cur');

  function loadOffset(id) {
    trackId = id || null;
    offset = trackId ? (parseFloat(localStorage.getItem('lyroff_' + trackId)) || 0) : 0;
    return offset;
  }

  function adjustOffset(d) {
    offset = Math.round((offset + d) * 2) / 2;
    if (trackId) localStorage.setItem('lyroff_' + trackId, String(offset));
    currentIdx = -1;
    return offset;
  }

  function parseLRC(lrc) {
    const out = [];
    const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
    for (const raw of lrc.split('\n')) {
      const times = [...raw.matchAll(re)];
      if (!times.length) continue;
      const text = raw.replace(re, '').trim();
      if (!text) continue;
      for (const m of times) out.push({ t: (+m[1]) * 60 + parseFloat(m[2]), text });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  function build() {
    const list = listEl(), pad = padEl();
    list.innerHTML = '';
    pad.innerHTML = '';
    lines.forEach(l => {
      const a = document.createElement('div');
      a.className = 'line';
      a.textContent = l.text;
      if (l.t >= 0) a.onclick = () => seekCb && seekCb(Math.round(l.t * 1000));
      list.appendChild(a);
      const b = document.createElement('div');
      b.className = 'fline';
      b.textContent = l.text;
      if (l.t >= 0) b.onclick = () => seekCb && seekCb(Math.round(l.t * 1000));
      pad.appendChild(b);
    });
    currentIdx = -1;
    scrollCur = 0;
    target = 0;
    scrollEl().scrollTop = 0;
  }

  async function fetchLrclib(track) {
    const q = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.title,
      duration: String(Math.round(track.duration / 1000))
    });
    let r = await window.cyber.httpJson({ url: 'https://lrclib.net/api/get?' + q.toString(), timeout: 8000 });
    if (r.status === 200) {
      const d = JSON.parse(r.text);
      if (d && (d.syncedLyrics || d.plainLyrics)) return d;
    }
    r = await window.cyber.httpJson({ url: 'https://lrclib.net/api/search?' + new URLSearchParams({ q: track.title + ' ' + track.artist }).toString(), timeout: 8000 });
    if (r.status === 200) {
      const arr = JSON.parse(r.text);
      if (Array.isArray(arr) && arr.length) return arr[0];
    }
    return null;
  }

  async function fetchNetease(track) {
    const hdr = { 'Referer': 'https://music.163.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    const s = await window.cyber.httpJson({
      url: 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(track.title + ' ' + track.artist) + '&type=1&limit=5',
      headers: hdr, timeout: 8000
    });
    if (s.status !== 200) return null;
    const j = JSON.parse(s.text);
    const songs = j && j.result && j.result.songs;
    if (!songs || !songs.length) return null;
    let best = songs[0];
    for (const song of songs) {
      if (track.duration && Math.abs((song.duration || 0) - track.duration) < 2000) { best = song; break; }
    }
    const l = await window.cyber.httpJson({
      url: 'https://music.163.com/api/song/lyric?id=' + best.id + '&lv=1&kv=1&tv=1',
      headers: hdr, timeout: 8000
    });
    if (l.status !== 200) return null;
    const lj = JSON.parse(l.text);
    const lyric = lj && lj.lrc && lj.lrc.lyric;
    if (lyric && /\[\d+:\d+/.test(lyric)) return { syncedLyrics: lyric };
    if (lyric && lyric.trim()) return { plainLyrics: lyric };
    return null;
  }

  async function fetchFor(track) {
    const off = loadOffset(track.id);
    lines = [{ t: -1, text: '// 检索歌词数据流...' }];
    build();
    const [a, b] = await Promise.all([
      fetchLrclib(track).catch(() => null),
      fetchNetease(track).catch(() => null)
    ]);
    const data = (a && a.syncedLyrics) ? a : (b && b.syncedLyrics) ? b : (a && a.plainLyrics) ? a : (b && b.plainLyrics) ? b : null;
    if (data && data.syncedLyrics) lines = parseLRC(data.syncedLyrics);
    else if (data && data.plainLyrics) lines = data.plainLyrics.split('\n').filter(s => s.trim()).map(s => ({ t: -1, text: s.trim() }));
    if (!lines.length) lines = [{ t: -1, text: '// NO LYRICS FOUND' }, { t: -1, text: '// 信号丢失 - 无歌词数据' }];
    build();
    return off;
  }

  function update(posSec) {
    if (!lines.length || lines[0].t < 0) return;
    const p = posSec + offset;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= p) idx = i;
      else break;
    }
    if (idx === currentIdx) return;
    currentIdx = idx;
    const listKids = listEl().children;
    const padKids = padEl().children;
    for (let i = 0; i < padKids.length; i++) {
      const d = Math.abs(i - idx);
      const f = padKids[i];
      f.classList.toggle('cur', i === idx);
      f.style.opacity = i === idx ? '1' : String(Math.max(0.18, 0.75 - d * 0.11));
      f.style.filter = d === 0 ? 'none' : 'blur(' + Math.min(2.5, d * 0.5).toFixed(1) + 'px)';
      if (listKids[i]) listKids[i].classList.toggle('current', i === idx);
    }
    const cl = listKids[idx];
    if (cl) {
      const box = listEl();
      const r = cl.offsetTop, h = cl.offsetHeight;
      if (r < box.scrollTop + 8 || r + h > box.scrollTop + box.clientHeight - 8) {
        box.scrollTo({ top: Math.max(0, r - box.clientHeight / 2), behavior: 'smooth' });
      }
    }
    const cf = padKids[idx];
    if (cf) target = cf.offsetTop + cf.offsetHeight / 2 - scrollEl().clientHeight / 2;
  }

  function tick() {
    const box = scrollEl();
    if (box) {
      if (Date.now() > holdUntil) {
        if (holding) { holding = false; backBtn().classList.add('hidden'); }
        scrollCur += (target - scrollCur) * 0.1;
        box.scrollTop = Math.round(scrollCur);
      } else {
        holding = true;
        scrollCur = box.scrollTop;
      }
    }
    requestAnimationFrame(tick);
  }

  function init() {
    scrollEl().addEventListener('wheel', () => {
      holdUntil = Date.now() + 8000;
      backBtn().classList.remove('hidden');
    }, { passive: true });
    backBtn().onclick = () => { holdUntil = 0; };
    requestAnimationFrame(tick);
  }

  return {
    fetchFor, update, init, adjustOffset,
    onSeek: cb => { seekCb = cb; }
  };
})();
