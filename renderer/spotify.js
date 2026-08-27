const Spotify = (() => {
  const REDIRECT = 'http://127.0.0.1:8901/callback';
  const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing';
  let clientId = '';
  let onStateCb = null;
  let onStatusCb = null;
  let polling = null;
  let lastState = null;
  let lastDeviceId = null;

  const store = {
    get: k => localStorage.getItem('sp_' + k),
    set: (k, v) => localStorage.setItem('sp_' + k, v),
    del: k => localStorage.removeItem('sp_' + k)
  };

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function init(id) { clientId = id; }
  function hasToken() { return !!store.get('refresh'); }

  async function login() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    store.set('verifier', verifier);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const p = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge
    });
    window.cyber.openExternal('https://accounts.spotify.com/authorize?' + p.toString());
  }

  async function handleCallback(d) {
    if (!d || d.error) { onStatusCb && onStatusCb('auth-error'); return; }
    const verifier = store.get('verifier');
    const r = await window.cyber.httpJson({
      url: 'https://accounts.spotify.com/api/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: d.code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier
      }).toString()
    });
    if (r.status !== 200) { onStatusCb && onStatusCb('auth-error'); return; }
    const t = JSON.parse(r.text);
    store.set('access', t.access_token);
    store.set('refresh', t.refresh_token);
    store.set('expires', String(Date.now() + t.expires_in * 1000));
    await initPlayer();
  }

  async function ensureToken() {
    const access = store.get('access');
    const exp = +store.get('expires') || 0;
    if (access && Date.now() < exp - 60000) return access;
    const refresh = store.get('refresh');
    if (!refresh) return null;
    const r = await window.cyber.httpJson({
      url: 'https://accounts.spotify.com/api/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId }).toString()
    });
    if (r.status !== 200) return null;
    const t = JSON.parse(r.text);
    store.set('access', t.access_token);
    store.set('expires', String(Date.now() + t.expires_in * 1000));
    return t.access_token;
  }

  async function api(path, opts) {
    opts = opts || {};
    const tk = await ensureToken();
    if (!tk) return null;
    return await window.cyber.httpJson({
      url: 'https://api.spotify.com/v1' + path,
      method: opts.method || 'GET',
      headers: Object.assign({ 'Authorization': 'Bearer ' + tk }, opts.headers || {}),
      body: opts.body
    });
  }

  function mapState(body) {
    if (!body || !body.item) return null;
    const it = body.item;
    return {
      paused: !body.is_playing,
      position: body.progress_ms || 0,
      device: body.device || null,
      track_window: {
        current_track: {
          id: it.id,
          name: it.name,
          artists: (it.artists || []).map(a => ({ name: a.name })),
          album: { images: (it.album && it.album.images) || [] },
          duration_ms: it.duration_ms
        }
      }
    };
  }

  async function pollOnce() {
    const r = await api('/me/player');
    if (!r) { onStatusCb && onStatusCb('auth-error'); return; }
    if (r.status === 200) {
      onStatusCb && onStatusCb('online');
      const st = mapState(JSON.parse(r.text));
      lastState = st;
      if (st && st.device) lastDeviceId = st.device.id;
      onStateCb && onStateCb(st);
    } else if (r.status === 204) {
      onStatusCb && onStatusCb('online');
      lastState = null;
      onStateCb && onStateCb(null);
    } else if (r.status === 401) {
      onStatusCb && onStatusCb('auth-error');
    } else if (r.status === 403 || r.status === 404) {
      onStatusCb && onStatusCb('premium-error');
    } else {
      onStatusCb && onStatusCb('offline');
    }
  }

  async function ensureActiveDevice() {
    const r = await api('/me/player/devices');
    if (!r || r.status !== 200) return null;
    const devs = (JSON.parse(r.text).devices) || [];
    if (!devs.length) return null;
    const active = devs.find(d => d.is_active);
    if (active) { lastDeviceId = active.id; return active.id; }
    const pref = devs.find(d => d.type === 'Computer') || devs[0];
    await api('/me/player', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [pref.id], play: false })
    });
    lastDeviceId = pref.id;
    return pref.id;
  }

  async function initPlayer() {
    if (!clientId) return false;
    const tk = await ensureToken();
    if (!tk) return false;
    onStatusCb && onStatusCb('online');
    await ensureActiveDevice();
    if (!polling) polling = setInterval(pollOnce, 2000);
    pollOnce();
    return true;
  }

  function getState() { return Promise.resolve(lastState); }

  async function seek(ms) {
    await api('/me/player/seek?position_ms=' + ms + (lastDeviceId ? '&device_id=' + lastDeviceId : ''), { method: 'PUT' });
    setTimeout(pollOnce, 300);
  }

  async function togglePlay() {
    if (lastState && !lastState.paused) {
      await api('/me/player/pause' + (lastDeviceId ? '?device_id=' + lastDeviceId : ''), { method: 'PUT' });
    } else {
      let r = await api('/me/player/play' + (lastDeviceId ? '?device_id=' + lastDeviceId : ''), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (r && (r.status === 404 || r.status === 409)) {
        await ensureActiveDevice();
        await api('/me/player/play' + (lastDeviceId ? '?device_id=' + lastDeviceId : ''), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
      }
    }
    setTimeout(pollOnce, 400);
  }

  async function next() {
    await api('/me/player/next' + (lastDeviceId ? '?device_id=' + lastDeviceId : ''), { method: 'POST' });
    setTimeout(pollOnce, 400);
  }

  async function prev() {
    await api('/me/player/previous' + (lastDeviceId ? '?device_id=' + lastDeviceId : ''), { method: 'POST' });
    setTimeout(pollOnce, 400);
  }

  async function setVolume(v) {
    const pct = Math.round(v * 100);
    await api('/me/player/volume?volume_percent=' + pct + (lastDeviceId ? '&device_id=' + lastDeviceId : ''), { method: 'PUT' });
  }

  return {
    init, hasToken, login, handleCallback, initPlayer,
    getState, togglePlay, next, prev, setVolume, seek,
    onState: cb => { onStateCb = cb; },
    onStatus: cb => { onStatusCb = cb; }
  };
})();

