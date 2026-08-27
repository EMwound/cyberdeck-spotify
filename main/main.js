const { app, BrowserWindow, Tray, Menu, ipcMain, screen, desktopCapturer, shell, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');

let win = null;
let tray = null;

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function saveJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function defaultBounds() {
  const displays = screen.getAllDisplays();
  const second = displays.find(d => !d.primary) || displays[0];
  const b = second.workArea;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function createWindow() {
  const saved = loadJSON(STATE_PATH, null);
  const b = Object.assign(defaultBounds(), saved ? saved.bounds : {});
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    backgroundColor: '#04040a',
    show: false,
    minWidth: 760, minHeight: 480,
    alwaysOnTop: saved ? !!saved.alwaysOnTop : true,
    title: 'CYBERDECK_2077',
    icon: path.join(ROOT, 'assets', 'emblem.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setOpacity(saved && saved.opacity ? saved.opacity : 0.96);
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  let t = null;
  const persist = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      try {
        saveJSON(STATE_PATH, { bounds: win.getNormalBounds(), alwaysOnTop: win.isAlwaysOnTop(), opacity: win.getOpacity() });
      } catch (e) {}
    }, 400);
  };
  win.on('moved', persist);
  win.on('resized', persist);
  win.on('close', persist);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'emblem.png')).resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.setToolTip('CYBERDECK_2077');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏 SHOW/HIDE', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { type: 'separator' },
    { label: '退出 QUIT', click: () => app.quit() }
  ]));
  tray.on('double-click', () => win.show());
}

function startCallbackServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/callback') {
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      if (win) win.webContents.send('spotify-callback', { code, error });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="background:#000;color:#fcee0a;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>// AUTHORIZED //</h2><p style="color:#00f0ff">授权成功，可关闭此页返回 CYBERDECK。</p></div></body></html>');
    } else { res.writeHead(404); res.end(); }
  });
  server.on('error', e => { console.error('callback server:', e.message); });
  server.listen(8901, '127.0.0.1');
}

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map(s => ({ id: s.id, name: s.name }));
});
ipcMain.handle('config-get', () => loadJSON(CONFIG_PATH, { spotify_client_id: '' }));
ipcMain.handle('config-set', (e, cfg) => { saveJSON(CONFIG_PATH, cfg); return cfg; });
ipcMain.handle('open-external', (e, url) => shell.openExternal(url));
ipcMain.handle('set-always-on-top', (e, v) => { win.setAlwaysOnTop(!!v); return win.isAlwaysOnTop(); });
ipcMain.handle('set-opacity', (e, v) => win.setOpacity(v));
ipcMain.handle('win-minimize', () => win.minimize());
ipcMain.handle('win-hide', () => win.hide());
ipcMain.handle('http-json', async (e, req) => {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), req.timeout || 15000);
    const res = await net.fetch(req.url, { method: req.method || 'GET', headers: req.headers || {}, body: req.body, signal: ctl.signal });
    clearTimeout(to);
    const text = await res.text();
    return { status: res.status, text };
  } catch (err) {
    return { status: 0, text: String(err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  startCallbackServer();
});

app.on('activate', () => { if (win) win.show(); });



