'use strict';

// Zenopod.exe --zenopod-hook <Event>: jalankan hook Claude Code saja (versi terpasang tanpa Node.js).
if (process.argv.includes('--zenopod-hook')) {
  require('./hooks/kapsul-hook.js');
  return;
}

const { app, BrowserWindow, Tray, Menu, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, screen, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Folder data selalu %APPDATA%\kapsul (dari kode maupun versi terpasang "Zenopod"),
// supaya config, statistik, dan token hook Claude tetap di tempat yang sama.
// ZENOPOD_DATA_DIR = folder lain (untuk mencoba versi kode di samping versi terpasang).
app.setPath('userData', process.env.ZENOPOD_DATA_DIR || path.join(app.getPath('appData'), 'kapsul'));

const { CONFIG_FILE, DEFAULT_OFFSET, normalize, readConfig, writeConfig } = require('./lib/config');
const paths = require('./lib/paths');
const apps = require('./lib/apps');
const claude = require('./lib/claude');
const schedule = require('./lib/schedule');
const { Focus } = require('./lib/focus');
const { ClipboardHistory } = require('./lib/clipboard');
const devwatch = require('./lib/devwatch');
const { Stats, duration, dayKey } = require('./lib/stats');
const calc = require('./lib/calc');
const chat = require('./lib/chat');
const season = require('./lib/season');
const weather = require('./lib/weather');
const voice = require('./lib/voice');
const commands = require('./lib/commands');
const { createMacBridge } = require('./lib/macbridge');
const calendar = require('./lib/calendar');
const sysmon = require('./lib/sysmon');
const habits = require('./lib/habits');
const lyrics = require('./lib/lyrics');

const SIZE = {
  collapsed: { width: 236, height: 40 },
  peek: { width: 388, height: 84 },
  peekTall: { width: 388, height: 122 },
  // Dibuka: hanya kartu atas (seperti island melebar); detail di bawahnya opsional.
  compact: { width: 468, height: 152 },
  expanded: { width: 468, height: 468 },
};

let win = null;
let settingsWin = null;
let tray = null;
let bridge = null;
let expanded = false;
let detail = false; // panel dibuka sampai isi bawah (dipilih lewat kartu / gagang ⌄)
let items = [];
let config = readConfig();
let shortcut = null;
let lastMedia = { playing: false, title: null };
let notifications = { access: 'Unknown', items: [] };
let knownIds = null; // null = belum ada daftar pertama (notifikasi lama tidak dianggap baru)
let lastActivity = Date.now();
let devTimers = null;
let quickState = null; // volume, muted, brightness, wifi, bluetooth (dari bridge.ps1)
const appIcons = {};

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
}

// Log diagnosa, aktif bila KAPSUL_DEBUG berisi path file log.
const debugLog = (msg) => process.env.KAPSUL_DEBUG && fs.appendFileSync(process.env.KAPSUL_DEBUG, `${new Date().toISOString()} ${msg}\n`);

const send = (channel, payload) => win?.webContents.send(channel, payload);

const IS_MAC = process.platform === 'darwin';
const RELEASES_URL = 'https://github.com/ardianramadhan/Zenopod/releases/latest';

// Nama tombol pintas untuk ditampilkan: Ctrl+Alt+K (Windows) / ⌃⌥K (Mac).
const MAC_KEYS = { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘', Command: '⌘', CommandOrControl: '⌘' };
const shortcutKeys = (combo) =>
  combo ? combo.split('+').map((k) => (IS_MAC ? (MAC_KEYS[k] ?? k) : k === 'Control' ? 'Ctrl' : k)) : [];

// ---------- Jendela kapsul ----------

// Zenopod menempel di tepi atas; saat melebar tetap di sisi yang sama.
// offsetX = jarak dari tepi kiri/kanan layar (left/right) atau geser dari tengah (center).
// Posisi bebas (hasil geser): config.custom = titik kiri-atas kapsul kecil; y = tepi atas
// layar kerja artinya menempel di atas (gaya notch kalau config.island = 'auto').
// Panel membuka ke arah yang masih muat: ke kiri kalau mepet kanan, ke atas kalau mepet bawah.
function customLayout() {
  const point = { x: Math.round(config.custom?.x ?? 0), y: Math.round(config.custom?.y ?? 0) };
  const display = screen.getDisplayNearestPoint(point);
  const wa = display.workArea;
  const px = Math.min(Math.max(point.x, wa.x), wa.x + wa.width - SIZE.collapsed.width);
  const py = Math.min(Math.max(point.y, wa.y), wa.y + wa.height - SIZE.collapsed.height);
  return {
    display,
    px,
    py,
    top: py <= wa.y,
    align: px + SIZE.expanded.width <= wa.x + wa.width ? 'left' : 'right',
    valign: py + SIZE.expanded.height <= wa.y + wa.height ? 'top' : 'bottom',
  };
}

const isCustom = () => config.position === 'custom' && config.custom;

// Jarak dari tepi atas layar: kapsul yang dilepas di sini menempel ke atas.
const SNAP_TOP = 28;

// Gaya otomatis: menempel di tepi atas = notch, digeser ke bawah = pill.
const isNotch = () => config.island !== 'pill' && (!isCustom() || customLayout().top);

// macOS: notch menutup bilah menu, isi kapsul turun di bawahnya (menyatu dengan notch layar).
function notchInset(display = screen.getPrimaryDisplay()) {
  if (!IS_MAC || !isNotch()) return 0;
  return Math.max(0, display.workArea.y - display.bounds.y);
}

function boundsFor(state) {
  const { width, height } = SIZE[state];
  if (isCustom()) {
    const l = customLayout();
    const x = l.align === 'left' ? l.px : l.px + SIZE.collapsed.width - width;
    if (isNotch()) return { x, y: l.display.bounds.y, width, height: height + notchInset(l.display) };
    return { x, y: l.valign === 'top' ? l.py : l.py + SIZE.collapsed.height - height, width, height };
  }
  const { workArea, bounds } = screen.getPrimaryDisplay();
  const offset = Number(config.offsetX) || 0;
  let x;
  if (config.position === 'top-left') {
    x = workArea.x + offset;
  } else if (config.position === 'top-right') {
    x = workArea.x + workArea.width - width - offset;
  } else {
    x = workArea.x + (workArea.width - width) / 2 + offset;
  }
  if (isNotch()) return { x: Math.round(x), y: bounds.y, width, height: height + notchInset() };
  return { x: Math.round(x), y: workArea.y + 6, width, height };
}

function align() {
  if (isCustom()) return customLayout().align;
  return { 'top-left': 'left', 'top-right': 'right' }[config.position] ?? 'center';
}

function valign() {
  return isCustom() && !isNotch() ? customLayout().valign : 'top';
}

// ---------- Geser kapsul ----------

let drag = null; // { bounds, align, valign, snapped } saat mulai digeser

function dragStart() {
  if (!win) return;
  clearTimeout(shrinkTimer);
  drag = { bounds: win.getBounds(), align: align(), valign: valign(), snapped: null };
}

// Titik kiri-atas kapsul kecil dari posisi jendela sekarang.
function pillPoint(b) {
  const pw = SIZE.collapsed.width;
  const ph = SIZE.collapsed.height;
  const px = drag.align === 'right' ? b.x + b.width - pw : drag.align === 'center' ? b.x + (b.width - pw) / 2 : b.x;
  const py = drag.valign === 'bottom' ? b.y + b.height - ph : b.y;
  return { px, py };
}

const nearTop = (py, wa) => py - wa.y < SNAP_TOP;

// Selama digeser: dekat tepi atas = tertarik menempel (dan berubah jadi notch), lebih ke bawah = pill.
function dragMove(dx, dy) {
  if (!drag) return;
  const next = { ...drag.bounds, x: Math.round(drag.bounds.x + dx), y: Math.round(drag.bounds.y + dy) };
  const { px, py } = pillPoint(next);
  const display = screen.getDisplayNearestPoint({ x: Math.round(px), y: Math.round(py) });
  const snapped = config.island !== 'pill' && nearTop(py, display.workArea);
  if (snapped) next.y = display.workArea.y;
  win.setBounds(next);
  if (snapped !== drag.snapped) {
    drag.snapped = snapped;
    send('kapsul:island-preview', snapped ? 'notch' : 'pill');
  }
}

// Lepas: simpan titik kapsul kecil. Dekat kiri/tengah/kanan atas = menempel ke posisi itu;
// dekat tepi atas di tempat lain = menempel di situ; lebih ke bawah = melayang (pill).
function dragEnd() {
  if (!drag) return;
  const { px, py } = pillPoint(win.getBounds());
  drag = null;

  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(px), y: Math.round(py) });
  const primary = screen.getPrimaryDisplay().workArea;
  const top = nearTop(py, wa) || py < wa.y;
  if (wa.x === primary.x && wa.y === primary.y && top) {
    for (const preset of ['top-left', 'top-center', 'top-right']) {
      const at = presetPillX(preset, wa);
      if (Math.abs(px - at) < 60) {
        setPosition(preset, { force: true });
        return;
      }
    }
  }
  const y = top && config.island !== 'pill' ? wa.y : Math.max(wa.y, py);
  saveConfig({ ...config, position: 'custom', custom: { x: Math.round(px), y: Math.round(y) } });
  loadConfig();
}

function presetPillX(preset, wa) {
  const w = SIZE.collapsed.width;
  const offset = { 'top-left': 12, 'top-center': 0, 'top-right': 160 }[preset];
  if (preset === 'top-left') return wa.x + offset;
  if (preset === 'top-right') return wa.x + wa.width - w - offset;
  return wa.x + (wa.width - w) / 2;
}

function currentState() {
  if (expanded) return detail ? 'expanded' : 'compact';
  if (currentPeek) return currentPeek.actions?.length ? 'peekTall' : 'peek';
  return 'collapsed';
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('collapsed'),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    icon: appIcon(32),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  applyWindowLevel();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  // Klik di luar widget = tutup panel.
  win.on('blur', () => setExpanded(false));

  // Layar berubah (monitor dicolok/dicabut, resolusi) = posisikan ulang.
  screen.on('display-metrics-changed', () => win.setBounds(boundsFor(currentState())));
}

// macOS: notch harus di atas bilah menu.
function applyWindowLevel() {
  win?.setAlwaysOnTop(true, IS_MAC && isNotch() ? 'status' : 'floating');
}

let shrinkTimer = null;
let cursorTimer = null;

function resize() {
  clearTimeout(shrinkTimer);
  const next = boundsFor(currentState());
  const now = win.getBounds();
  // Membesar langsung; mengecil setelah animasi CSS selesai.
  if (next.width * next.height >= now.width * now.height) win.setBounds(next);
  else shrinkTimer = setTimeout(() => win.setBounds(boundsFor(currentState())), 220);
}

// Dibuka lewat hover: tutup lagi ~0,4 dtk setelah kursor keluar.
// Dibuka lewat shortcut/klik (jendela fokus): tetap terbuka sampai Esc atau klik di luar.
function watchCursor() {
  clearInterval(cursorTimer);
  let outside = 0;
  cursorTimer = setInterval(() => {
    if (!win || win.isFocused()) {
      outside = 0;
      return;
    }
    const { x, y } = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = x >= b.x && x < b.x + b.width && y >= b.y - 6 && y < b.y + b.height;
    outside = inside ? 0 : outside + 1;
    if (outside >= 2) setExpanded(false);
  }, 200);
}

function setExpanded(next, { focus = false } = {}) {
  if (!win || next === expanded) {
    if (next && focus) win.focus();
    return;
  }
  expanded = next;

  if (next) {
    // Kartu peek biasa hilang saat panel dibuka; pengingat ditunda sampai panel ditutup.
    if (currentPeek) {
      if (currentPeek.sticky) peekQueue.unshift(currentPeek);
      clearTimeout(peekTimer);
      currentPeek = null;
      send('kapsul:peek', null);
    }
    send('kapsul:expanded', true);
    resize();
    if (focus) win.focus();
    watchCursor();
  } else {
    clearInterval(cursorTimer);
    detail = false;
    send('kapsul:expanded', false);
    resize();
    if (peekQueue.length) setTimeout(nextPeek, 260);
  }
}

// Posisi kursor (relatif ke jendela) untuk mata maskot; dikirim hanya saat kursor bergerak.
function feedCursor() {
  let last = '';
  setInterval(() => {
    if (!win) return;
    const { x, y } = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const key = `${x},${y}`;
    if (key === last) return;
    last = key;
    lastActivity = Date.now();
    send('kapsul:cursor', { x: x - b.x, y: y - b.y });
  }, 50);
}

// ---------- Kartu peek (notifikasi, Claude, sapaan, pengingat) ----------
// { id, kind, mood, app, title, body, icon, actions: [{id, label, primary}], sticky, seconds, ref, sound }

const peekQueue = [];
let currentPeek = null;
let peekTimer = null;

function showPeek(peek) {
  peekQueue.push({ id: crypto.randomUUID(), seconds: 6, ...peek });
  // Izin Claude didahulukan dari kartu lain yang sedang antre.
  if (peek.kind === 'permission' && peekQueue.length > 1) peekQueue.unshift(peekQueue.pop());
  if (!currentPeek) nextPeek();
}

function nextPeek() {
  if (!win || expanded || currentPeek) return;
  currentPeek = peekQueue.shift() ?? null;
  if (!currentPeek) return;
  send('kapsul:peek', currentPeek);
  resize();
  if (!currentPeek.sticky) peekTimer = setTimeout(endPeek, currentPeek.seconds * 1000);
}

function endPeek() {
  clearTimeout(peekTimer);
  if (!currentPeek) return;
  currentPeek = null;
  send('kapsul:peek', null);
  resize();
  if (peekQueue.length) setTimeout(nextPeek, 400);
}

function peekAction(id, action) {
  if (!currentPeek || currentPeek.id !== id) return;
  const peek = currentPeek;
  if (peek.kind === 'reminder') {
    if (action !== 'snooze') statsAdd('reminders');
    updateReminder(peek.ref, (r) => (action === 'snooze' ? schedule.snooze(r, 10) : schedule.acknowledge(r)));
  } else if (peek.kind === 'notification' && action === 'open') {
    openNotification(peek.ref);
  } else if (peek.kind === 'permission') {
    const finish = permissionReplies.get(peek.id);
    finish?.(action === 'allow' ? 'allow' : action === 'deny' ? 'deny' : null);
    return; // finish() sudah menutup kartunya
  } else if (peek.kind === 'pet') {
    if (action === 'feed') feedPet('cookie');
  } else if (peek.kind === 'water') {
    if (action === 'drank') statsAdd('water');
    // "Nanti" = ingatkan lagi 10 menit kemudian.
    if (action === 'later') wellness.water = Math.max(0, Number(config.wellness.waterMinutes || 60) - 10);
  } else if (peek.kind === 'update') {
    if (action === 'install' && updater) {
      app.isQuitting = true;
      setImmediate(() => updater.quitAndInstall());
    }
  } else if (peek.kind === 'timer') {
    if (action === 'again') startTimer(peek.ref.total, peek.ref.label);
  } else if (peek.kind === 'meeting') {
    if (action === 'join') openMeeting(peek.ref);
  } else if (peek.kind === 'habit') {
    if (action === 'done') habitDone(peek.ref, true);
  } else if (peek.kind === 'ocr') {
    if (action === 'again') setTimeout(startSnip, 300);
  } else if (peek.kind === 'power') {
    if (action === 'confirm') power(peek.ref);
  } else if (peek.kind === 'focus') {
    if (action === 'start') focus.start('focus');
    if (action === 'break') focus.start();
  } else if (peek.kind === 'drive') {
    if (action === 'open') openDrive(peek.ref);
    if (action === 'eject') ejectDrive(peek.ref);
  }
  endPeek();
}

// ---------- Config ----------

let selfWriteAt = 0;

function saveConfig(next) {
  config = normalize(next);
  selfWriteAt = Date.now();
  writeConfig(config);
}

async function loadConfig() {
  config = readConfig(config);
  registerShortcut();
  registerVoiceShortcut();
  registerOcrShortcut();
  applyWindowLevel();
  if (win) win.setBounds(boundsFor(currentState()));
  tray?.setContextMenu(buildTrayMenu());
  items = await apps.resolveItems(config.apps);
  send('kapsul:state', publicState());
  sendNotifications();
  sendReminders();
  sendTodos();
  syncClipboard();
  sendHabits();
  updateLyrics();
  if (devTimers) {
    pollServices();
    pollGit();
    pollWeather();
    pollCalendarIfChanged();
  }
  settingsWin?.webContents.send('settings:changed');
}

function watchConfig() {
  let timer = null;
  // Pantau foldernya: editor sering menyimpan dengan mengganti file, bukan menimpanya.
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.watch(path.dirname(CONFIG_FILE), (_event, file) => {
    if (file !== path.basename(CONFIG_FILE) || Date.now() - selfWriteAt < 1500) return;
    clearTimeout(timer);
    timer = setTimeout(loadConfig, 300);
  });
}

function publicState() {
  return {
    apps: items.map(({ launch, ...rest }) => rest),
    align: align(),
    valign: valign(),
    position: config.position,
    island: isNotch() ? 'notch' : 'pill',
    notchInset: notchInset(isCustom() ? customLayout().display : undefined),
    buddyName: config.buddy.name,
    chatReady: chatReady(),
    devEnabled: config.dev.services.length > 0 || config.dev.projects.length > 0,
    focus: config.focus,
    sound: config.sound,
    ticker: config.ticker,
    lyrics: config.lyrics,
    battery: config.battery,
    userName: config.user.name,
    shortcut: shortcutKeys(shortcut),
    platform: process.platform,
  };
}

function registerShortcut() {
  if (shortcut === config.shortcut) return;
  if (shortcut) globalShortcut.unregister(shortcut);
  shortcut = null;
  try {
    if (globalShortcut.register(config.shortcut, () => setExpanded(!expanded, { focus: true }))) {
      shortcut = config.shortcut;
    } else {
      console.warn(`Shortcut ${config.shortcut} sudah dipakai aplikasi lain.`);
    }
  } catch (error) {
    console.warn(`Shortcut ${config.shortcut} tidak valid:`, error.message);
  }
}

function setIsland(island) {
  if (island === config.island) return;
  saveConfig({ ...config, island });
  loadConfig();
}

function setPosition(position, { force = false } = {}) {
  if (!(position in DEFAULT_OFFSET) || (position === config.position && !force)) return;
  saveConfig({ ...config, position, offsetX: DEFAULT_OFFSET[position] });
  loadConfig();
}

// ---------- Bridge (musik + notifikasi, lihat bridge.ps1) ----------

function startBridge() {
  debugLog('start bridge');
  // macOS: pengganti bridge.ps1 dengan pesan yang sama (lib/macbridge.js).
  if (IS_MAC) {
    bridge = createMacBridge(handleBridge, { helper: paths.macHelper, log: debugLog });
    return;
  }
  bridge = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.bridgeScript], {
    windowsHide: true,
  });
  bridge.stdout.setEncoding('utf8');

  let buffer = '';
  bridge.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('{')) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // baris tidak utuh
      }
      handleBridge(message);
    }
  });
  bridge.stderr.on('data', (chunk) => debugLog('stderr ' + String(chunk).trim().slice(0, 300)));
  bridge.on('exit', (code) => {
    debugLog('bridge exit ' + code);
    bridge = null;
    // Helper mati (mis. error WinRT) = nyalakan lagi sebentar kemudian.
    if (!app.isQuitting) setTimeout(startBridge, 3000);
  });
}

function handleBridge(message) {
  if (message.type === 'media') {
    lastMedia = message;
    send('kapsul:media', lastMedia);
    updateLyrics();
  } else if (message.type === 'icon') {
    appIcons[message.app] = message.data;
    sendNotifications();
  } else if (message.type === 'notifications') {
    receiveNotifications(message);
  } else if (message.type === 'voices') {
    ttsVoices = Array.isArray(message.voices) ? message.voices : [message.voices].filter(Boolean);
    settingsWin?.webContents.send('settings:changed');
  } else if (message.type === 'usb') {
    onUsb(message);
  } else if (message.type === 'bluetooth') {
    onBluetooth(Array.isArray(message.devices) ? message.devices : [message.devices].filter(Boolean));
  } else if (message.type === 'quick') {
    quickState = message;
    send('kapsul:quick-state', quickState);
  } else if (message.type === 'speech') {
    send('kapsul:speech', message.data);
  } else if (message.type === 'ocr') {
    onOcr(message);
  }
}

// ---------- Lirik lagu (lib/lyrics.js) ----------

let lyricsState = { key: null, status: 'none', synced: false, lines: [] };
const trackKey = (m) => (m?.title ? `${m.app}|${m.title}|${m.artist}` : null);

// Gagal (mis. LRCLIB sibuk / 503): coba lagi untuk lagu yang sama setelah 15 dtk, 45 dtk, 2 & 5 mnt.
const LYRICS_RETRY_MS = [15_000, 45_000, 120_000, 300_000];
let lyricsRetry = { key: null, tries: 0, timer: null };

async function updateLyrics({ force = false } = {}) {
  const key = config.lyrics.enabled ? trackKey(lastMedia) : null;
  if (!force && key === lyricsState.key) return;
  if (key !== lyricsRetry.key) {
    clearTimeout(lyricsRetry.timer);
    lyricsRetry = { key, tries: 0, timer: null };
  }
  if (!key) {
    lyricsState = { key: null, status: 'none', synced: false, lines: [] };
    send('kapsul:lyrics', lyricsState);
    return;
  }
  lyricsState = { key, status: 'loading', synced: false, lines: [] };
  send('kapsul:lyrics', lyricsState);
  let found = null;
  let status = 'missing';
  try {
    found = await lyrics.find({ title: lastMedia.title, artist: lastMedia.artist, duration: lastMedia.duration });
    if (found?.instrumental) status = 'instrumental';
    else if (found) status = 'ready';
  } catch (error) {
    debugLog('lyrics ' + error.message);
    status = 'error';
  }
  // Lagu sudah berganti selagi mencari: hasilnya dibuang.
  if (lyricsState.key !== key) return;
  lyricsState = { key, status, synced: Boolean(found?.synced), lines: found?.lines ?? [] };
  send('kapsul:lyrics', lyricsState);
  if (status === 'error' && lyricsRetry.tries < LYRICS_RETRY_MS.length) {
    const wait = LYRICS_RETRY_MS[lyricsRetry.tries++];
    lyricsRetry.timer = setTimeout(() => lyricsState.key === key && updateLyrics({ force: true }), wait);
  }
}

// ---------- Bluetooth: Zeno bereaksi saat perangkat tersambung / terputus ----------

let btDevices = null; // null = daftar pertama (perangkat yang sudah tersambung tidak dianggap baru)

const BT_GLYPHS = {
  audio: '<path d="M11 24v-4a9 9 0 0 1 18 0v4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><rect x="9" y="22" width="5.5" height="9" rx="2.5" fill="#fff"/><rect x="25.5" y="22" width="5.5" height="9" rx="2.5" fill="#fff"/>',
  input: '<rect x="13" y="9" width="14" height="22" rx="7" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M20 13v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  phone: '<rect x="13.5" y="8" width="13" height="24" rx="3" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M18.5 28h3" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  other: '<path d="M14.5 15 25 24.5 20 29.5V10.5l5 5-10.5 9.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};

function bluetoothIcon(kind, connected) {
  const glyph = BT_GLYPHS[kind] ?? BT_GLYPHS.other;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${connected ? '#2563eb' : '#3f3f46'}"/>${glyph}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const BT_TEXT = {
  audio: ['Siap untuk musik dan panggilan', 'Asik, ayo dengar musik!'],
  input: ['Siap dipakai'],
  phone: ['HP tersambung ke laptop'],
  other: ['Siap dipakai'],
};

// Tersambung / terputus: kartu seperti "Claude selesai". Panel terbuka = Zeno yang bereaksi.
function bluetoothEvent(event, device) {
  if (expanded) {
    send('kapsul:device', { event, device });
    return;
  }
  const connected = event === 'connected';
  const lines = BT_TEXT[device.kind] ?? BT_TEXT.other;
  showPeek({
    kind: 'bluetooth',
    mood: connected ? (device.kind === 'audio' ? 'music' : 'paired') : 'surprised',
    sound: connected ? 'connect' : 'disconnect',
    app: connected ? 'Bluetooth · tersambung' : 'Bluetooth · terputus',
    title: device.name || 'Perangkat Bluetooth',
    body: connected ? lines[Math.floor(Math.random() * lines.length)] : 'Sampai jumpa lagi!',
    icon: bluetoothIcon(device.kind, connected),
    seconds: 5,
  });
}

// ---------- USB: perangkat & drive yang dicolok ----------

let usbDevices = null; // null = daftar pertama (yang sudah tercolok tidak dianggap baru)
let usbDrives = null;

const USB_GLYPHS = {
  storage: '<rect x="13" y="7" width="14" height="26" rx="3" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M17 12h6M17 16h6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  phone: BT_GLYPHS.phone,
  camera: '<rect x="8" y="13" width="24" height="16" rx="3" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="20" cy="21" r="4.5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M15 13l2-3h6l2 3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>',
  audio: BT_GLYPHS.audio,
  mouse: BT_GLYPHS.input,
  keyboard: '<rect x="7" y="13" width="26" height="15" rx="3" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M12 18h.01M16 18h.01M20 18h.01M24 18h.01M28 18h.01M14 23h12" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  other: '<path d="M20 8v20M20 8l-3 4h6zM20 28a2.5 2.5 0 1 0 0 .01M20 22l-6-4v-4M20 19l6-3v-3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="12" y="11" width="4" height="4" fill="#fff"/><circle cx="26" cy="12" r="2" fill="#fff"/>',
};

function usbIcon(kind, connected) {
  const glyph = USB_GLYPHS[kind] ?? USB_GLYPHS.other;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${connected ? '#7c3aed' : '#3f3f46'}"/>${glyph}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const USB_TEXT = {
  phone: ['HP tersambung, bisa transfer file'],
  camera: ['Kamera siap dipakai'],
  audio: ['Audio siap dipakai'],
  mouse: ['Mouse siap dipakai'],
  keyboard: ['Keyboard siap dipakai'],
  network: ['Jaringan lewat USB tersambung'],
  serial: ['Port serial siap (mis. Arduino)'],
  printer: ['Printer siap dipakai'],
  other: ['Perangkat USB siap dipakai'],
};

const USB_NAMES = { phone: 'HP', camera: 'Kamera USB', audio: 'Audio USB', mouse: 'Mouse USB', keyboard: 'Keyboard USB', network: 'Jaringan USB', serial: 'Perangkat serial', printer: 'Printer', other: 'Perangkat USB' };
// Nama bawaan driver yang tidak berarti apa-apa bagi pengguna.
const GENERIC_USB = /^(USB (Composite|Input|Mass Storage) Device|USB Serial Device|HID-compliant .*)$/i;
const usbName = (d) => (!d.name || GENERIC_USB.test(d.name) ? USB_NAMES[d.kind] ?? USB_NAMES.other : d.name);

const bytes = (n) => {
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1).replace('.', ',')} GB` : `${Math.round(n / 1024 ** 2)} MB`;
};
const driveName = (d) => `${d.label || (d.removable ? 'Flashdisk' : 'Drive eksternal')} (${d.letter})`;

// Kartu seperti "Claude selesai". Panel terbuka = Zeno yang bereaksi (kartu akan telat).
function usbPeek(peek, reaction) {
  if (expanded) send('kapsul:device', reaction);
  else showPeek(peek);
}

function onUsb({ devices = [], drives = [] }) {
  const beforeDevices = usbDevices;
  const beforeDrives = usbDrives;
  usbDevices = new Map((Array.isArray(devices) ? devices : [devices]).filter((d) => d && d.id).map((d) => [d.id, d]));
  usbDrives = new Map((Array.isArray(drives) ? drives : [drives]).filter((d) => d && d.letter).map((d) => [d.letter, d]));
  sendDevices();
  if (!beforeDevices || !config.usb.alerts) return;

  for (const [letter, drive] of usbDrives) {
    if (beforeDrives.has(letter)) continue;
    usbPeek(
      {
        kind: 'drive',
        mood: 'starstruck',
        sound: 'connect',
        app: `USB · ${drive.removable ? 'Flashdisk' : 'Penyimpanan'} tersambung`,
        title: driveName(drive),
        body: drive.size ? `${bytes(drive.free)} kosong dari ${bytes(drive.size)}` : '',
        icon: usbIcon('storage', true),
        ref: drive.letter,
        seconds: 8,
        actions: [
          { id: 'eject', label: 'Keluarkan' },
          { id: 'open', label: 'Buka', primary: true },
        ],
      },
      { event: 'connected', device: { name: driveName(drive), kind: 'storage' } },
    );
  }
  for (const [letter, drive] of beforeDrives) {
    if (usbDrives.has(letter)) continue;
    usbPeek(
      { kind: 'usb', mood: 'surprised', sound: 'disconnect', app: 'USB · dilepas', title: driveName(drive), body: 'Sudah aman dicabut.', icon: usbIcon('storage', false), seconds: 4 },
      { event: 'disconnected', device: { name: driveName(drive), kind: 'storage' } },
    );
  }
  // Penyimpanan USB diwakili kartu drive di atas.
  for (const [id, device] of usbDevices) {
    if (beforeDevices.has(id) || device.kind === 'storage') continue;
    const lines = USB_TEXT[device.kind] ?? USB_TEXT.other;
    usbPeek(
      { kind: 'usb', mood: device.kind === 'audio' ? 'music' : 'happy', sound: 'connect', app: 'USB · tersambung', title: usbName(device), body: lines[0], icon: usbIcon(device.kind, true), seconds: 5 },
      { event: 'connected', device: { ...device, name: usbName(device) } },
    );
  }
  for (const [id, device] of beforeDevices) {
    if (usbDevices.has(id) || device.kind === 'storage') continue;
    usbPeek(
      { kind: 'usb', mood: 'surprised', sound: 'disconnect', app: 'USB · dicabut', title: usbName(device), body: 'Sampai jumpa lagi!', icon: usbIcon(device.kind, false), seconds: 4 },
      { event: 'disconnected', device: { ...device, name: usbName(device) } },
    );
  }
}

function openDrive(letter) {
  shell.openPath(IS_MAC ? letter : `${letter}\\`);
}

const ejectDrive = (letter) => bridgeCommand(`eject ${letter}`);

// Daftar perangkat tersambung untuk section Perangkat di panel.
function sendDevices() {
  send('kapsul:devices', {
    bluetooth: [...(btDevices?.values() ?? [])],
    usb: [...(usbDevices?.values() ?? [])].map((d) => ({ ...d, name: usbName(d) })),
    drives: [...(usbDrives?.values() ?? [])].map((d) => ({ ...d, name: driveName(d) })),
  });
}

function onBluetooth(devices) {
  const before = btDevices;
  btDevices = new Map(devices.filter((d) => d && d.id).map((d) => [d.id, d]));
  sendDevices();
  if (!before || !config.bluetooth.alerts) return;
  for (const [id, device] of btDevices) if (!before.has(id)) bluetoothEvent('connected', device);
  for (const [id, device] of before) if (!btDevices.has(id)) bluetoothEvent('disconnected', device);
}

function bridgeCommand(command) {
  bridge?.stdin.write(command + '\n');
}

function mediaCommand(command) {
  if (['toggle', 'next', 'prev', 'refresh'].includes(command)) bridgeCommand(command);
}

// ---------- Notifikasi Windows ----------

function ignored(item) {
  const list = config.notifications.ignore ?? [];
  return list.some((name) => {
    const needle = String(name).toLowerCase();
    return item.appName?.toLowerCase() === needle || item.app?.toLowerCase() === needle;
  });
}

function visibleNotifications() {
  return notifications.items
    .filter((item) => !ignored(item))
    .sort((a, b) => b.time - a.time)
    .map((item) => ({ ...item, icon: appIcons[item.app] ?? null }));
}

function sendNotifications() {
  send('kapsul:notifications', { access: notifications.access, items: visibleNotifications() });
}

// Catat aplikasi yang pernah mengirim notifikasi, untuk pilihan di Pengaturan.
function rememberApps(list) {
  const seen = config.notifications.seen ?? [];
  const names = new Set(seen.map((s) => s.name));
  const added = list.filter((item) => item.appName && !names.has(item.appName) && names.add(item.appName));
  if (!added.length) return;
  const next = [...seen, ...added.map((item) => ({ name: item.appName, app: item.app }))];
  saveConfig({ ...config, notifications: { ...config.notifications, seen: next } });
  settingsWin?.webContents.send('settings:changed');
}

function receiveNotifications(message) {
  notifications = { access: message.access, items: Array.isArray(message.items) ? message.items : [] };
  rememberApps(notifications.items);
  const ids = new Set(notifications.items.map((item) => item.id));
  const fresh = knownIds ? notifications.items.filter((item) => !knownIds.has(item.id) && !ignored(item)) : [];
  knownIds = ids;
  sendNotifications();

  // Saat fokus, notifikasi tetap masuk daftar tapi kartunya ditahan.
  const muted = focusing() && config.focus.muteNotifications;
  if (fresh.length && config.notifications.peek && !expanded && !muted) {
    const newest = fresh.sort((a, b) => b.time - a.time)[0];
    showPeek({
      kind: 'notification',
      mood: 'surprised',
      sound: 'notif',
      app: `${newest.appName || 'Aplikasi'} · baru saja`,
      title: newest.title || newest.appName || 'Notifikasi',
      body: (newest.body || '').replace(/\s+/g, ' '),
      icon: appIcons[newest.app] ?? null,
      seconds: Number(config.notifications.peekSeconds) || 6,
      ref: newest.id,
    });
  }
}

// Klik notifikasi: buka aplikasi asalnya (lewat AppUserModelId) lalu hapus notifikasinya.
function openNotification(id) {
  const item = notifications.items.find((n) => n.id === id);
  if (!item) return;
  if (item.app) {
    spawn('explorer.exe', [`shell:AppsFolder\\${item.app}`], { detached: true, stdio: 'ignore' }).unref();
  }
  bridgeCommand(`dismiss ${id}`);
  setExpanded(false);
}

// ---------- Claude Code ----------

const sessions = new Map(); // session_id → { project, state: thinking|working|waiting|idle, label, updated }

function sendClaude() {
  const now = Date.now();
  const active = [...sessions.values()]
    // Sesi yang 10 menit tanpa kabar dianggap diam.
    .filter((s) => s.state !== 'idle' && now - s.updated < 10 * 60_000)
    .sort((a, b) => b.updated - a.updated);
  send('kapsul:claude', { active });
}

function onClaudeEvent(event, data) {
  const id = data.session_id || 'default';
  const project = data.cwd ? path.basename(data.cwd) : 'Claude Code';
  const session = sessions.get(id) ?? { project, state: 'idle', label: '' };
  session.project = project;
  session.updated = Date.now();
  sessions.set(id, session);
  lastActivity = Date.now();

  switch (event) {
    case 'UserPromptSubmit':
      Object.assign(session, {
        state: 'thinking',
        label: 'Berpikir',
        prompt: claude.plain(data.prompt ?? '', 140),
        started: Date.now(),
        steps: 0,
        activity: [],
      });
      break;
    case 'PreToolUse': {
      const label = claude.toolLabel(data.tool_name);
      // Simpan 4 aktivitas terakhir untuk kartu Claude di panel.
      const activity = [...(session.activity ?? []), { label, detail: claude.toolDetail(data.tool_name, data.tool_input) }].slice(-4);
      Object.assign(session, { state: 'working', label, activity, steps: (session.steps ?? 0) + 1 });
      session.started ??= Date.now();
      break;
    }
    case 'Notification':
      Object.assign(session, { state: 'waiting', label: 'Menunggu kamu' });
      if (config.claude.peek) {
        showPeek({
          kind: 'claude',
          mood: 'surprised',
          app: `${project} · Claude Code`,
          title: 'Claude butuh kamu',
          sound: 'attention',
          body: claude.plain(data.message || 'Claude menunggu jawabanmu.'),
          seconds: 10,
        });
      }
      break;
    case 'Stop':
      Object.assign(session, { state: 'idle', label: '' });
      if (config.claude.peek) {
        showPeek({
          kind: 'claude',
          mood: 'happy',
          app: `${project} · Claude Code selesai`,
          title: 'Claude selesai',
          sound: 'success',
          body: claude.plain(claude.lastAssistantText(data.transcript_path)) || 'Tugasnya sudah beres.',
          seconds: 10,
        });
      }
      break;
    case 'StopFailure':
      Object.assign(session, { state: 'idle', label: '' });
      if (config.claude.peek) {
        showPeek({
          kind: 'claude',
          mood: 'cry',
          app: `${project} · Claude Code`,
          title: 'Claude berhenti karena error',
          sound: 'error',
          body: claude.plain(data.error || data.message || 'Coba cek terminalnya.'),
          seconds: 10,
        });
      }
      break;
    case 'SessionEnd':
      sessions.delete(id);
      break;
    default:
      break;
  }
  sendClaude();
}

// Claude minta izin: kartu Izinkan / Tolak / Di terminal. Tanpa jawaban 90 dtk
// (atau fitur dimatikan) = serahkan ke dialog izin biasa di terminal.
const PERMISSION_WAIT_MS = 90_000;
const permissionReplies = new Map(); // id kartu → respond()

function onPermission(data, respond, isAnswered) {
  if (!config.claude.permissions) return respond(null);

  const id = crypto.randomUUID();
  const project = data.cwd ? path.basename(data.cwd) : 'Claude Code';
  const session = sessions.get(data.session_id || 'default');
  if (session) Object.assign(session, { state: 'waiting', label: 'Minta izin', updated: Date.now() });
  sendClaude();

  const detail = claude.toolDetail(data.tool_name, data.tool_input, 200);
  permissionReplies.set(id, respond);
  showPeek({
    id,
    kind: 'permission',
    mood: 'surprised',
    app: `${project} · Claude minta izin`,
    title: claude.toolLabel(data.tool_name),
    body: detail || data.tool_name || '',
    sticky: true,
    sound: 'question',
    actions: [
      { id: 'deny', label: 'Tolak' },
      { id: 'terminal', label: 'Di terminal' },
      { id: 'allow', label: 'Izinkan', primary: true },
    ],
  });

  const finish = (decision) => {
    if (!permissionReplies.has(id)) return;
    permissionReplies.delete(id);
    respond(decision);
    if (session) Object.assign(session, { state: 'working', label: claude.toolLabel(data.tool_name), updated: Date.now() });
    sendClaude();
    dropPeek(id);
  };
  permissionReplies.set(id, finish);

  // Hook berhenti duluan (Claude dibatalkan) atau terlalu lama = tutup kartunya.
  const check = setInterval(() => {
    if (!permissionReplies.has(id)) return clearInterval(check);
    if (isAnswered()) {
      clearInterval(check);
      finish(null);
    }
  }, 1000);
  setTimeout(() => {
    clearInterval(check);
    finish(null);
  }, PERMISSION_WAIT_MS);
}

// Buang kartu tertentu, baik yang sedang tampil maupun yang masih antre.
function dropPeek(id) {
  const queued = peekQueue.findIndex((p) => p.id === id);
  if (queued >= 0) peekQueue.splice(queued, 1);
  if (currentPeek?.id === id) endPeek();
}

// ---------- Fokus (Pomodoro) ----------

const focus = new Focus({
  settings: () => config.focus,
  onChange: (state) => send('kapsul:focus', state),
  onPhaseEnd: (phase, state, spent) => {
    if (phase === 'focus') {
      statsAdd('focus');
      if (spent > 0) statsAdd('focusMs', spent);
      const minutes = state.phase === 'long' ? config.focus.longBreakMinutes : config.focus.breakMinutes;
      showPeek({
        kind: 'focus',
        mood: 'stretch',
        app: `${config.buddy.name || 'Zenopod'} · Fokus ${state.done} selesai`,
        title: state.phase === 'long' ? `Kerja bagus! Istirahat panjang ${minutes} menit` : `Waktunya istirahat ${minutes} menit`,
        body: 'Berdiri, regangkan badan, dan minum air dulu.',
        sound: 'chime',
        seconds: 10,
        ...(config.focus.autoStartBreak ? {} : { sticky: true, actions: [{ id: 'later', label: 'Nanti' }, { id: 'break', label: 'Mulai istirahat', primary: true }] }),
      });
    } else {
      showPeek({
        kind: 'focus',
        mood: 'happy',
        app: `${config.buddy.name || 'Zenopod'} · Istirahat selesai`,
        title: 'Siap fokus lagi?',
        body: `${config.focus.focusMinutes} menit berikutnya, semangat!`,
        sound: 'wake',
        sticky: true,
        actions: [
          { id: 'later', label: 'Nanti' },
          { id: 'start', label: 'Mulai fokus', primary: true },
        ],
      });
    }
  },
});

const focusing = () => focus.state.phase === 'focus' && focus.state.running;

function focusCommand(action, minutes) {
  if (action === 'start') focus.start();
  else if (action === 'focus') focus.start('focus', { minutes });
  else if (action === 'extend') focus.extend((minutes || 5) * 60_000);
  else if (action === 'pause') focus.pause();
  else if (action === 'stop') focus.stop();
  else if (action === 'skip') focus.skip();
}

// ---------- Clipboard & catatan ----------

const clips = new ClipboardHistory({ onChange: (list) => send('kapsul:clips', list) });

function syncClipboard() {
  clips.max = Number(config.clipboard.max) || 20;
  if (config.clipboard.enabled && !clips.timer) clips.start();
  if (!config.clipboard.enabled && clips.timer) {
    clips.stop();
    clips.clear();
  }
}

function clipCommand(action, id) {
  if (action === 'copy') clips.copy(id);
  else if (action === 'remove') clips.remove(id);
  else if (action === 'clear') clips.clear();
}

const sendTodos = () => send('kapsul:todos', config.todos);

function todoCommand(action, payload = {}) {
  let todos = config.todos;
  if (action === 'add') {
    const text = String(payload.text ?? '').trim().slice(0, 200);
    if (!text) return;
    todos = [...todos, { id: crypto.randomUUID(), text, done: false, at: Date.now() }];
  } else if (action === 'toggle') {
    const target = todos.find((t) => t.id === payload.id);
    if (target && !target.done) statsAdd('todos');
    todos = todos.map((t) => (t.id === payload.id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t));
  } else if (action === 'remove') {
    todos = todos.filter((t) => t.id !== payload.id);
  } else if (action === 'clear-done') {
    todos = todos.filter((t) => !t.done);
  } else {
    return;
  }
  saveConfig({ ...config, todos });
  sendTodos();
}

// ---------- Dev: server lokal & Git ----------

let devState = { services: [], projects: [], checkedAt: null };
const lastStatus = new Map(); // nama layanan → status terakhir (untuk deteksi "baru mati")

async function pollServices() {
  const services = config.dev.services;
  const results = await Promise.all(services.map((s) => devwatch.checkService(s)));
  devState.services = services.map((s, i) => ({ name: s.name, type: s.type, target: s.target, ...results[i] }));
  devState.checkedAt = Date.now();

  for (const s of devState.services) {
    const before = lastStatus.get(s.name);
    lastStatus.set(s.name, s.status);
    // Hanya saat berubah dari hidup → mati (bukan saat Zenopod baru menyala).
    if (before === 'up' && s.status === 'down' && config.dev.alerts) {
      showPeek({
        kind: 'dev',
        mood: 'surprised',
        app: 'Server lokal',
        title: `${s.name} mati`,
        sound: 'uhoh',
        body: s.target,
        seconds: 8,
      });
    }
  }
  send('kapsul:dev', devState);
}

async function pollGit() {
  devState.projects = await Promise.all(
    config.dev.projects.map(async (dir) => ({ dir, name: devwatch.projectName(dir), ...(await devwatch.gitStatus(dir)) })),
  );
  send('kapsul:dev', devState);
}

const VSCODE = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');

function devOpen(kind, index) {
  if (kind === 'service') {
    const s = config.dev.services[index];
    if (s?.type === 'http') shell.openExternal(s.target);
  } else if (kind === 'project') {
    const dir = config.dev.projects[index];
    if (!dir) return;
    if (IS_MAC) {
      // Buka dengan VS Code kalau ada; kalau tidak, buka foldernya di Finder.
      spawn('open', ['-a', 'Visual Studio Code', dir]).on('exit', (code) => code && shell.openPath(dir));
    } else if (fs.existsSync(VSCODE)) spawn(VSCODE, [dir], { detached: true, stdio: 'ignore' }).unref();
    else shell.openPath(dir);
  }
  setExpanded(false);
}

// ---------- Kostum, cuaca & baterai ----------

let weatherState = null;
let costumeState = { costume: null, reason: '' };

function updateCostume() {
  costumeState = season.costumeFor(config.costume, { birthday: config.user.birthday });
  send('kapsul:costume', costumeState);
  settingsWin?.webContents.send('settings:changed');
}

async function pollWeather() {
  if (!config.weather.enabled || !config.weather.city) {
    weatherState = null;
    send('kapsul:weather', null);
    updateCostume();
    return;
  }
  try {
    const before = weatherState;
    const now = await weather.currentWeather(config.weather.city);
    weatherState = { ...now, city: config.weather.city.name, look: weather.weatherLook(now), advice: weather.advice(now) };
    const wet = (w) => w && (w.kind === 'rain' || w.kind === 'storm');
    // Kabari saat mulai hujan (bukan saat Zenopod baru menyala).
    if (before && !wet(before) && wet(weatherState) && config.weather.alerts) {
      showPeek({
        kind: 'weather',
        mood: 'surprised',
        sound: 'rain',
        app: `Cuaca · ${weatherState.city}`,
        title: `${weatherState.text} mulai turun`,
        body: 'Jangan lupa bawa payung kalau mau keluar ya.',
        seconds: 9,
      });
    }
  } catch (error) {
    debugLog('cuaca gagal: ' + error.message);
  }
  send('kapsul:weather', weatherState);
  updateCostume();
}

// Baterai dibaca renderer (navigator.getBattery); peringatan di 20% dan 10%.
const batteryWarned = new Set();
let lastBattery = null;

// Ikon kartu (kanan): baterai dengan isi sesuai persen, hijau + petir saat mengisi.
function batteryIcon(percent, charging) {
  const color = charging ? '#4ade80' : percent <= 20 ? '#f87171' : '#e4e4e7';
  const width = Math.max(2, Math.round((22 * percent) / 100));
  const bolt = charging ? '<path d="M21.5 11 15.5 20.5h4.2L18 29l6.5-10h-4.2z" fill="#14532d" stroke="#4ade80" stroke-width="0.8" stroke-linejoin="round"/>' : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#1f1f24"/>` +
    `<rect x="6" y="13" width="26" height="14" rx="3.5" fill="none" stroke="${color}" stroke-opacity="0.6" stroke-width="1.6"/>` +
    `<rect x="33.2" y="17.5" width="2" height="5" rx="1" fill="${color}" fill-opacity="0.6"/>` +
    `<rect x="8" y="15" width="${width}" height="10" rx="2" fill="${color}"/>${bolt}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const aboutTime = (seconds) => calc.durationLabel(Math.round(seconds / 60) * 60_000);

function onBattery({ level, charging, chargingTime, dischargingTime }) {
  const percent = Math.round(level * 100);
  // Charger dicolok / dicabut: kartu seperti "Claude selesai". Panel terbuka = Zeno yang bereaksi.
  if (lastBattery && lastBattery.charging !== charging && !expanded && config.battery.showPercent) {
    const name = config.buddy.name || 'Zeno';
    const time = charging
      ? Number.isFinite(chargingTime) && chargingTime > 0 ? `penuh sekitar ${aboutTime(chargingTime)}` : percent >= 95 ? 'hampir penuh' : 'Nyam, setrum!'
      : Number.isFinite(dischargingTime) && dischargingTime > 0 ? `cukup sekitar ${aboutTime(dischargingTime)}` : 'Hemat-hemat ya.';
    showPeek({
      kind: 'battery',
      mood: charging ? 'charging' : 'unplug',
      sound: charging ? 'charge' : 'unplug',
      app: `${name} · Baterai`,
      title: charging ? `Mengisi daya · ${percent}%` : `Charger dicabut · ${percent}%`,
      body: time,
      icon: batteryIcon(percent, charging),
      seconds: 5,
    });
  }
  if (charging || percent > 25) batteryWarned.clear();
  if (!charging && config.battery.alerts) {
    for (const threshold of [20, 10]) {
      if (percent <= threshold && !batteryWarned.has(threshold)) {
        batteryWarned.add(threshold);
        if (percent <= 10) batteryWarned.add(20);
        showPeek({
          kind: 'battery',
          mood: 'lowbat',
          sound: 'lowbat',
          app: `${config.buddy.name || 'Zenopod'} · Baterai`,
          title: `Baterai tinggal ${percent}%`,
          body: percent <= 10 ? 'Aku hampir pingsan… colokkan charger sekarang ya.' : 'Aku mulai lemas, colokkan charger ya.',
          seconds: 10,
        });
        break;
      }
    }
  }
  lastBattery = { level, charging };
}

// ---------- Perintah suara ----------
// Ctrl+Alt+Z → renderer merekam (berhenti sendiri setelah diam) → whisper.cpp → lib/commands → aksi + jawaban.

let ttsVoices = [];
let voiceShortcut = null;
let installedForVoice = [];

function registerVoiceShortcut() {
  const wanted = config.voice.enabled ? config.voice.shortcut : null;
  if (voiceShortcut === wanted) return;
  if (voiceShortcut) globalShortcut.unregister(voiceShortcut);
  voiceShortcut = null;
  if (!wanted) return;
  try {
    if (globalShortcut.register(wanted, () => send('kapsul:listen', 'toggle'))) voiceShortcut = wanted;
    else console.warn(`Shortcut suara ${wanted} sudah dipakai aplikasi lain.`);
  } catch (error) {
    console.warn(`Shortcut suara ${wanted} tidak valid:`, error.message);
  }
}

// Suara Indonesia dipakai otomatis; tanpa itu Zeno menjawab lewat teks saja
// (kalimat Indonesia dengan suara Inggris terdengar aneh), kecuali dipilih manual.
function ttsVoice() {
  if (config.voice.voiceId) return ttsVoices.find((v) => v.id === config.voice.voiceId) ?? null;
  return ttsVoices.find((v) => String(v.lang).toLowerCase().startsWith('id')) ?? null;
}

function speak(text) {
  const chosen = ttsVoice();
  if (!config.voice.speak || !chosen || !bridge) return;
  const payload = Buffer.from(JSON.stringify({ text, voice: chosen.id, rate: config.voice.rate, pitch: config.voice.pitch })).toString('base64');
  bridgeCommand(`speak ${Date.now()} ${payload}`);
}

function reply(heard, answer, mood = 'happy') {
  showPeek({ kind: 'voice', mood, app: heard ? `Kamu: “${heard}”` : 'Perintah suara', title: answer, seconds: 6 });
  speak(answer);
}

const LONG_DATE = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const HIJRI_DATE = new Intl.DateTimeFormat('id-ID-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;

function voiceApps() {
  // Tombol panel didahulukan, lalu semua aplikasi terpasang.
  return [
    ...items.map((item) => ({ name: item.name, item, priority: 0 })),
    ...installedForVoice.map((a) => ({ name: a.name, installed: a, priority: 1 })),
  ];
}

async function runVoiceCommand(heard) {
  const intent = commands.parse(heard, { apps: voiceApps() });
  if (intent.action !== 'empty') statsAdd('voice');
  const firstName = (config.user.name || '').split(/\s+/)[0];
  switch (intent.action) {
    case 'empty':
      return reply('', 'Aku nggak dengar apa-apa. Coba lagi ya.', 'confused');
    case 'open': {
      const target = intent.app.item ?? {
        launch: intent.app.installed.aumid ? { aumid: intent.app.installed.aumid } : { target: intent.app.installed.target },
      };
      apps.launch(target);
      return reply(heard, `Membuka ${intent.app.name}.`, 'wink');
    }
    case 'open-missing':
      return reply(heard, `Aku nggak menemukan aplikasi “${intent.query}”.`, 'confused');
    case 'settings':
      openSettings();
      return reply(heard, 'Membuka pengaturan.', 'wink');
    case 'media': {
      const playing = Boolean(lastMedia.playing);
      if (intent.command === 'play' && !playing) bridgeCommand('toggle');
      if (intent.command === 'pause' && playing) bridgeCommand('toggle');
      if (intent.command === 'next' || intent.command === 'prev') bridgeCommand(intent.command);
      const text = { play: 'Oke, musik diputar.', pause: 'Musik dijeda.', next: 'Lagu berikutnya.', prev: 'Lagu sebelumnya.' }[intent.command];
      return reply(heard, text, 'music');
    }
    case 'focus':
      focusCommand(intent.command);
      return reply(
        heard,
        { focus: `Mulai fokus ${config.focus.focusMinutes} menit. Semangat!`, pause: 'Fokus dijeda.', stop: 'Fokus dihentikan.' }[intent.command],
        'focus',
      );
    case 'reminder': {
      const reminder = schedule.prepare({ id: crypto.randomUUID(), title: intent.title, date: intent.date, time: intent.time, repeat: 'none', note: '' });
      saveConfig({ ...config, reminders: [...config.reminders, reminder] });
      sendReminders();
      settingsWin?.webContents.send('settings:changed');
      const today = new Date().toDateString() === intent.when.toDateString();
      return reply(heard, `Siap, aku ingatkan “${intent.title}” ${today ? 'hari ini' : 'besok'} jam ${hhmm(intent.when)}.`, 'happy');
    }
    case 'reminder-missing-time':
      return reply(heard, 'Jam berapa? Coba bilang: ingatkan aku rapat jam 3.', 'confused');
    case 'todo':
      todoCommand('add', { text: intent.text });
      return reply(heard, `Dicatat: ${intent.text}.`, 'happy');
    case 'time':
      return reply(heard, `Sekarang jam ${hhmm(new Date())}.`, 'clock');
    case 'date':
      return reply(heard, `Hari ini ${LONG_DATE.format(new Date())}, atau ${HIJRI_DATE.format(new Date())}.`, 'clock');
    case 'weather':
      if (!weatherState) return reply(heard, 'Cuaca belum diatur. Pilih kota dulu di pengaturan ya.', 'confused');
      return reply(
        heard,
        `Di ${weatherState.city} ${weatherState.temperature} derajat, ${weatherState.text.toLowerCase()}. Terasa ${weatherState.feels} derajat.`,
        weatherState.look?.costume === 'umbrella' ? 'surprised' : 'happy',
      );
    case 'greet':
      return reply(heard, `Halo${firstName ? ` ${firstName}` : ''}! Ada yang bisa aku bantu?`, 'greet');
    case 'power':
      return askPower(intent.command, heard);
    case 'timer': {
      const ms = calc.parseDuration(intent.text);
      if (!ms) return reply(heard, 'Berapa lama? Coba bilang: timer 10 menit.', 'confused');
      const timer = startTimer(ms);
      return reply(heard, `${timer.label} dimulai.`, 'clock');
    }
    case 'timer-cancel':
      if (!timers.length) return reply(heard, 'Tidak ada timer yang berjalan.', 'confused');
      cancelTimer(null);
      return reply(heard, 'Timer dibatalkan.', 'happy');
    case 'calc': {
      const value = calc.evaluate(intent.text);
      if (value === null) return reply(heard, 'Maaf, aku belum bisa menghitung itu.', 'confused');
      clipboard.writeText(String(value));
      return reply(heard, `Hasilnya ${calc.format(value)}.`, 'happy');
    }
    case 'feed': {
      const { food } = feedPet('cookie');
      return reply(heard, `Nyam! Terima kasih ${food.name}nya.`, 'eat');
    }
    case 'play':
      playPet();
      return reply(heard, 'Yeay, main!', 'laugh');
    case 'quick': {
      const q = quickState ?? {};
      if (intent.what === 'volume') {
        const now = q.volume ?? 50;
        const next = intent.value ?? Math.max(0, Math.min(100, now + intent.delta));
        quickSet('volume', next);
        return reply(heard, `Volume ${next}%.`, 'music');
      }
      if (intent.what === 'mute') {
        quickSet('mute', intent.value);
        return reply(heard, intent.value === '1' ? 'Suara dibisukan.' : 'Suara dinyalakan.', 'happy');
      }
      if (intent.what === 'brightness') {
        if (q.brightness == null) return reply(heard, 'Kecerahan layar ini tidak bisa diatur dari Zenopod.', 'confused');
        const next = intent.value ?? Math.max(0, Math.min(100, q.brightness + intent.delta));
        quickSet('brightness', next);
        return reply(heard, `Kecerahan ${next}%.`, 'happy');
      }
      quickSet(intent.what, intent.value);
      const name = intent.what === 'wifi' ? 'Wi-Fi' : 'Bluetooth';
      return reply(heard, `${name} ${intent.value === 'on' ? 'dinyalakan' : 'dimatikan'}.`, 'happy');
    }
    case 'stats': {
      const s = summaryText();
      return reply(heard, `${s.title}. ${s.body}`, 'happy');
    }
    case 'habit': {
      const found = habits.findByText(config.habits, intent.text);
      if (found) {
        const after = habitDone(found.id, true);
        return reply(heard, `Mantap! ${found.name} tercatat${after?.streak > 1 ? `, ${after.streak} hari berturut-turut` : ''}.`, 'laugh');
      }
      if (/\bminum\b/.test(intent.text)) {
        statsAdd('water');
        return reply(heard, 'Sip, minum air tercatat.', 'happy');
      }
      if (chatReady()) return fallbackAnswer(heard);
      return reply(heard, `Kebiasaan “${intent.text}” belum ada. Tambahkan di Pengaturan › Kebiasaan ya.`, 'confused');
    }
    case 'ocr':
      setTimeout(startSnip, 400);
      return reply(heard, 'Seret kotak di sekitar teksnya ya.', 'wink');
    case 'agenda':
      return reply(heard, agendaText(intent.tomorrow), 'clock');
    case 'system':
      return reply(heard, systemText(intent.what), systemState.online === false ? 'cry' : 'happy');
    default:
      return fallbackAnswer(heard);
  }
}

// Bukan perintah: tanya Zeno (Claude) kalau sudah diatur.
async function fallbackAnswer(heard) {
  if (chatReady()) {
    try {
      return showAnswer(heard, await askZeno(heard));
    } catch (error) {
      return reply(heard, error.message, 'confused');
    }
  }
  return reply(heard, `Maaf, aku belum paham “${heard}”.`, 'confused');
}

ipcMain.handle('kapsul:audio', async (_event, wav) => {
  if (!voice.status().ready) {
    reply('', 'Mesin suaraku belum diunduh. Buka Pengaturan › Perintah suara ya.', 'confused');
    return { ok: false };
  }
  try {
    const prompt = `Zeno, buka ${items.map((i) => i.name).join(', ')}. Putar musik, ingatkan aku, catat, jam berapa, cuaca.`;
    const heard = await voice.transcribe(Buffer.from(wav), prompt);
    await runVoiceCommand(heard);
    return { ok: true, heard };
  } catch (error) {
    reply('', 'Maaf, aku gagal mendengar. Coba lagi ya.', 'cry');
    debugLog('transkripsi gagal: ' + error.message);
    return { ok: false };
  }
});

// ---------- Daya: kunci, tidur, mulai ulang, matikan, keluar akun ----------
// Tanpa /f: aplikasi yang punya pekerjaan belum disimpan tetap bisa menahan/menanyakan.

const POWER_LABELS = { lock: 'Kunci layar', sleep: 'Tidur', restart: 'Mulai ulang', shutdown: 'Matikan', signout: 'Keluar akun' };
const POWER_CONFIRM = new Set(['restart', 'shutdown', 'signout']);

function power(action) {
  const run = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  debugLog('power ' + action);
  if (IS_MAC) {
    // Kunci = layar tidur (terkunci bila "minta kata sandi" aktif); sisanya lewat System Events.
    const verb = { restart: 'restart', shutdown: 'shut down', signout: 'log out' }[action];
    if (action === 'lock') run('pmset', ['displaysleepnow']);
    else if (action === 'sleep') run('pmset', ['sleepnow']);
    else if (verb) run('osascript', ['-e', `tell application "System Events" to ${verb}`]);
    return;
  }
  if (action === 'lock') run('rundll32.exe', ['user32.dll,LockWorkStation']);
  else if (action === 'sleep') {
    // SetSuspendState('Suspend') = tidur (bukan hibernasi).
    run('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"]);
  } else if (action === 'restart') run('shutdown.exe', ['/r', '/t', '0']);
  else if (action === 'shutdown') run('shutdown.exe', ['/s', '/t', '0']);
  else if (action === 'signout') run('shutdown.exe', ['/l']);
}

// Dari suara: kunci/tidur langsung; mulai ulang/matikan/keluar akun lewat kartu konfirmasi.
function askPower(action, heard) {
  if (!POWER_CONFIRM.has(action)) {
    reply(heard, action === 'lock' ? 'Mengunci layar.' : 'Selamat istirahat, laptop.', 'sleep');
    setTimeout(() => power(action), 1500);
    return;
  }
  showPeek({
    kind: 'power',
    mood: 'cry',
    sound: 'uhoh',
    app: heard ? `Kamu: “${heard}”` : 'Daya',
    title: `${POWER_LABELS[action]} sekarang?`,
    body: 'Simpan pekerjaanmu dulu ya.',
    sticky: true,
    ref: action,
    actions: [
      { id: 'cancel', label: 'Batal' },
      { id: 'confirm', label: POWER_LABELS[action], primary: true },
    ],
  });
}

// ---------- Update otomatis (versi terpasang, dari GitHub Releases) ----------

let updater = null;
// macOS tanpa tanda tangan Apple tidak bisa memperbarui diri: arahkan ke halaman Releases.
let updateStatus = { state: !paths.packaged ? 'dev' : IS_MAC ? 'manual' : 'idle', version: null };

function setupUpdates() {
  if (!paths.packaged || IS_MAC) return;
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => (updateStatus = { state: 'checking', version: null }));
  autoUpdater.on('update-not-available', () => (updateStatus = { state: 'latest', version: null }));
  autoUpdater.on('update-available', (info) => (updateStatus = { state: 'downloading', version: info.version }));
  autoUpdater.on('error', (error) => {
    updateStatus = { state: 'error', version: null, error: error.message };
    debugLog('update gagal: ' + error.message);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = { state: 'ready', version: info.version };
    showPeek({
      kind: 'update',
      mood: 'laugh',
      sound: 'levelup',
      app: 'Zenopod',
      title: `Versi ${info.version} siap dipasang`,
      body: 'Mulai ulang Zenopod untuk memakai versi baru.',
      sticky: true,
      actions: [
        { id: 'later', label: 'Nanti' },
        { id: 'install', label: 'Mulai ulang', primary: true },
      ],
    });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, 6 * 3_600_000);
}

// ---------- Kontrol cepat Windows ----------

const QUICK_KEYS = new Set(['volume', 'mute', 'brightness', 'wifi', 'bluetooth']);

function quickSet(what, value) {
  if (!QUICK_KEYS.has(what)) return;
  bridgeCommand(`quick ${what} ${String(value).replace(/\s+/g, '')}`);
}

// ---------- Ngobrol dengan Zeno (Claude API) ----------

const conversation = new chat.Chat();

const chatReady = () => config.chat.enabled && (Boolean(config.chat.apiKeyEnc) || Boolean(process.env.ANTHROPIC_API_KEY));

async function askZeno(question) {
  return conversation.ask(question, {
    apiKey: chat.decryptKey(config.chat.apiKeyEnc),
    model: config.chat.model,
    buddyName: config.buddy.name,
    userName: config.user.name,
  });
}

// Tampilkan jawaban di kartu (lama tampil mengikuti panjang jawaban) dan bacakan.
function showAnswer(question, answer, mood = 'happy') {
  showPeek({
    kind: 'chat',
    mood,
    app: `Kamu: “${claude.plain(question, 80)}”`,
    title: config.buddy.name || 'Zeno',
    body: answer,
    seconds: Math.min(25, 6 + Math.ceil(answer.length / 20)),
  });
  speak(answer);
}

// ---------- Timer cepat ----------

const timers = []; // { id, label, endsAt, total, handle }

function sendTimers() {
  send('kapsul:timers', timers.map(({ handle, ...t }) => t).sort((a, b) => a.endsAt - b.endsAt));
}

function startTimer(ms, label) {
  const id = crypto.randomUUID();
  const timer = { id, label: label || `Timer ${calc.durationLabel(ms)}`, endsAt: Date.now() + ms, total: ms };
  timer.handle = setTimeout(() => fireTimer(id), ms);
  timers.push(timer);
  sendTimers();
  return timer;
}

function fireTimer(id) {
  const index = timers.findIndex((t) => t.id === id);
  if (index < 0) return;
  const [timer] = timers.splice(index, 1);
  sendTimers();
  showPeek({
    kind: 'timer',
    mood: 'alarm',
    sound: 'alarm',
    app: `${config.buddy.name || 'Zeno'} · Timer`,
    title: `${timer.label} selesai!`,
    body: '',
    sticky: true,
    ref: { total: timer.total, label: timer.label },
    actions: [
      { id: 'again', label: 'Ulangi' },
      { id: 'ok', label: 'Oke', primary: true },
    ],
  });
}

function cancelTimer(id) {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (id && timers[i].id !== id) continue;
    clearTimeout(timers[i].handle);
    timers.splice(i, 1);
  }
  sendTimers();
}

// Kotak cari: "= 250.000*12" → hasil; "timer 10" → tawaran timer.
function quickQuery(query) {
  const q = String(query).trim();
  const timer = q.match(/^(?:timer|tmr)\s+(.+)$/i);
  if (timer) {
    const ms = calc.parseDuration(timer[1]);
    return ms ? { kind: 'timer', ms, label: `Timer ${calc.durationLabel(ms)}` } : null;
  }
  if (calc.looksLikeMath(q)) {
    const value = calc.evaluate(q.replace(/^=/, ''));
    return value === null ? null : { kind: 'math', value, text: calc.format(value) };
  }
  return null;
}

// ---------- Zeno peliharaan ----------

const FOODS = { cookie: { name: 'kue', amount: 20 }, apple: { name: 'apel', amount: 25 }, rice: { name: 'nasi', amount: 40 } };
let hungerWarned = false;
let lastPlay = 0;

function feedPet(food = 'cookie') {
  const f = FOODS[food] ?? FOODS.cookie;
  const pet = stats.feed(f.amount);
  send('kapsul:pet-event', { type: 'eat', food });
  sendStats();
  return { pet, food: f };
}

// Ajak main: trik kecil; XP paling banyak sekali tiap 10 menit (biar tidak bisa "farming").
function playPet() {
  if (Date.now() - lastPlay > 10 * 60_000) {
    stats.gainXp(3);
    lastPlay = Date.now();
  }
  send('kapsul:pet-event', { type: 'play' });
  sendStats();
}

function checkHunger() {
  const pet = stats.pet();
  if (pet.hunger > 40) hungerWarned = false;
  if (pet.hunger < 20 && !hungerWarned) {
    hungerWarned = true;
    showPeek({
      kind: 'pet',
      mood: 'hungry',
      sound: 'question',
      app: config.buddy.name || 'Zeno',
      title: `${config.buddy.name || 'Zeno'} lapar…`,
      body: 'Boleh minta camilan?',
      seconds: 15,
      actions: [
        { id: 'later', label: 'Nanti' },
        { id: 'feed', label: 'Beri makan', primary: true },
      ],
    });
  }
}

// ---------- Istirahat mata & minum air ----------
// Menghitung menit aktif (ada gerakan kursor). Pergi > 5 menit = sudah istirahat → hitungan diulang.

const wellness = { eyes: 0, water: 0 };

function tickWellness() {
  const idleMs = Date.now() - lastActivity;
  if (idleMs > 5 * 60_000) {
    wellness.eyes = 0;
    wellness.water = 0;
    return;
  }
  if (idleMs > 2 * 60_000) return; // tidak sedang di depan laptop
  const w = config.wellness;
  if (w.eyes) wellness.eyes += 1;
  if (w.water) wellness.water += 1;

  // Saat fokus (dengan notifikasi ditahan) tunggu sampai istirahat.
  if (focusing() && config.focus.muteNotifications) return;

  if (w.eyes && wellness.eyes >= Number(w.eyesMinutes || 20)) {
    wellness.eyes = 0;
    statsAdd('eyes');
    showPeek({
      kind: 'wellness',
      mood: 'stretch',
      sound: 'today',
      app: `${config.buddy.name || 'Zeno'} · Istirahat mata`,
      title: 'Lihat yang jauh 20 detik',
      body: 'Pandang sesuatu sekitar 6 meter, lalu kedipkan mata beberapa kali.',
      seconds: 20,
    });
  } else if (w.water && wellness.water >= Number(w.waterMinutes || 60)) {
    wellness.water = 0;
    showPeek({
      kind: 'water',
      mood: 'happy',
      sound: 'wake',
      app: `${config.buddy.name || 'Zeno'} · Minum air`,
      title: 'Waktunya minum air',
      body: 'Satu gelas dulu, biar tetap segar.',
      seconds: 20,
      actions: [
        { id: 'later', label: 'Nanti' },
        { id: 'drank', label: 'Sudah minum', primary: true },
      ],
    });
  }
}

// ---------- Statistik harian ----------

const stats = new Stats(path.join(app.getPath('userData'), 'stats.json'), {
  onLevelUp: (level) =>
    showPeek({
      kind: 'pet',
      mood: 'laugh',
      sound: 'levelup',
      costume: 'party',
      app: `${config.buddy.name || 'Zeno'} naik level!`,
      title: `Level ${level}`,
      body: 'Terima kasih sudah rajin hari ini.',
      seconds: 7,
    }),
});

let statsTimer = null;
function sendStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    const today = stats.day();
    const top = stats.topSong();
    const listen = (songs) => Object.values(songs ?? {}).reduce((sum, ms) => sum + ms, 0);
    const week = stats.week().map((d) => ({ key: d.key, focus: d.focus, focusMs: d.focusMs, listenMs: listen(d.songs) }));
    // Ringkasan musik di detail Musik: 5 lagu terlama hari ini + total waktu dengar.
    const songs = Object.entries(today.songs ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, ms]) => ({ name, ms }));
    const music = { listenMs: listen(today.songs), count: Object.keys(today.songs ?? {}).length, songs };
    const payload = { today: { ...today, songs: undefined, top }, pet: stats.pet(), week, music };
    send('kapsul:stats', payload);
    settingsWin?.webContents.send('settings:changed');
  }, 300);
}

function statsAdd(field, amount = 1) {
  stats.add(field, amount);
  sendStats();
}

function summaryText() {
  const d = stats.day();
  const top = stats.topSong();
  const parts = [
    d.claudeMs ? `Claude ${duration(d.claudeMs)}` : '',
    d.focus ? `${d.focus} fokus` : '',
    d.todos ? `${d.todos} tugas selesai` : '',
    d.habits ? `${d.habits} kebiasaan` : '',
    d.reminders ? `${d.reminders} pengingat` : '',
  ].filter(Boolean);
  return {
    title: parts.length ? parts.join(' · ') : 'Hari yang santai',
    body: top ? `Lagu favorit: ${top[0]} (${duration(top[1])})` : 'Terima kasih sudah bekerja hari ini.',
  };
}

function showSummary() {
  const s = summaryText();
  showPeek({ kind: 'stats', mood: 'happy', sound: 'today', app: `${config.buddy.name || 'Zeno'} · Ringkasan hari ini`, title: s.title, body: s.body, seconds: 12 });
}

// Tiap 30 dtk: catat lama Claude bekerja & lagu yang diputar; ringkasan sekali sehari di jam yang dipilih.
function tickStats() {
  const busy = [...sessions.values()].some((s) => (s.state === 'thinking' || s.state === 'working') && Date.now() - s.updated < 10 * 60_000);
  if (busy) stats.add('claudeMs', 30_000);
  if (lastMedia.playing && lastMedia.title) {
    stats.song([lastMedia.title, lastMedia.artist].filter(Boolean).join(' · '), 30_000);
    sendStats();
  }

  const [hh, mm] = String(config.stats.time || '20:00').split(':').map(Number);
  const now = new Date();
  const due = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
  checkHunger();
  if (config.stats.summary && due && stats.data.lastSummary !== dayKey()) {
    stats.data.lastSummary = dayKey();
    stats.save();
    showSummary();
  }
  sendStats();
}

// ---------- Kalender (alamat iCal Google / Outlook) ----------

let calendarState = { events: [], errors: {}, checkedAt: null };
let calendarKey = null;
const calendarReminded = new Set();

const calendarFeeds = () => config.calendar.feeds.map((f) => ({ id: f.id, name: f.name, url: chat.decryptKey(f.urlEnc) }));

function sendCalendar() {
  const now = Date.now();
  const connected = config.calendar.enabled && config.calendar.feeds.length > 0;
  send('kapsul:calendar', { connected, events: calendarState.events.filter((e) => e.end > now).slice(0, 10) });
}

async function pollCalendar() {
  const feeds = config.calendar.enabled ? calendarFeeds() : [];
  if (!feeds.length) {
    calendarState = { events: [], errors: {}, checkedAt: null };
  } else {
    const result = await calendar.upcoming(feeds);
    // Semua gagal (mis. internet putus sebentar) = pakai daftar terakhir.
    const failedAll = Object.keys(result.errors).length === feeds.length;
    calendarState = {
      events: failedAll ? calendarState.events : result.events,
      errors: result.errors,
      checkedAt: Date.now(),
    };
    if (Object.keys(result.errors).length) debugLog('kalender: ' + JSON.stringify(result.errors));
  }
  sendCalendar();
  settingsWin?.webContents.send('settings:changed');
}

// Muat ulang hanya bila daftar kalender berubah (loadConfig dipanggil tiap kali config disimpan).
function pollCalendarIfChanged() {
  const key = JSON.stringify([config.calendar.enabled, config.calendar.feeds.map((f) => f.id + f.urlEnc)]);
  if (key === calendarKey) return;
  calendarKey = key;
  pollCalendar();
}

const isMeetingLink = (url) => /^https:\/\//i.test(String(url ?? ''));

function openMeeting(url) {
  if (isMeetingLink(url)) shell.openExternal(url);
  setExpanded(false);
}

// Kartu rapat beberapa menit sebelum mulai (sekali per acara), dengan tombol Gabung kalau ada link.
function checkCalendar() {
  const lead = Number(config.calendar.remindMinutes) || 0;
  const now = Date.now();
  sendCalendar();
  if (!lead) return;
  for (const e of calendarState.events) {
    if (e.allDay || calendarReminded.has(e.id)) continue;
    if (e.start - now > lead * 60_000 || e.start < now - 60_000) continue;
    calendarReminded.add(e.id);
    const minutes = Math.max(0, Math.round((e.start - now) / 60_000));
    showPeek({
      kind: 'meeting',
      mood: 'alarm',
      sound: 'alarm',
      app: `${e.calendar} · ${hhmm(new Date(e.start))}–${hhmm(new Date(e.end))}`,
      title: e.title,
      body: [minutes ? `Mulai ${minutes} menit lagi` : 'Mulai sekarang', e.link ? '' : e.location].filter(Boolean).join(' · '),
      sticky: true,
      ref: e.link,
      actions: e.link
        ? [
            { id: 'later', label: 'Nanti' },
            { id: 'join', label: 'Gabung', primary: true },
          ]
        : [{ id: 'ok', label: 'Oke', primary: true }],
    });
  }
}

// Jawaban suara "jadwal hari ini" / "rapat besok".
function agendaText(tomorrow = false) {
  if (!config.calendar.feeds.length) return 'Kalender belum disambungkan. Tambahkan di Pengaturan › Kalender ya.';
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (tomorrow ? 1 : 0));
  const dayEnd = day.getTime() + 86_400_000;
  const list = calendarState.events.filter((e) => e.start < dayEnd && e.end > Math.max(day.getTime(), tomorrow ? 0 : now.getTime()));
  const when = tomorrow ? 'Besok' : 'Hari ini';
  if (!list.length) return `${when} tidak ada acara lagi.`;
  const parts = list.slice(0, 4).map((e) => (e.allDay ? `${e.title} (seharian)` : `${e.title} jam ${hhmm(new Date(e.start))}`));
  return `${when} ada ${list.length} acara: ${parts.join(', ')}${list.length > 4 ? ', dan lainnya' : ''}.`;
}

// ---------- Ambil teks dari layar (OCR) ----------
// Tangkap layar di bawah kursor → jendela pilih area → potong → OCR Windows (bridge.ps1) → clipboard.

let snipWin = null;
let snipShot = null; // { image, display }
let ocrShortcut = null;
const ocrJobs = new Map(); // id → file gambar sementara

function registerOcrShortcut() {
  const wanted = config.ocr.shortcut || null;
  if (ocrShortcut === wanted) return;
  if (ocrShortcut) globalShortcut.unregister(ocrShortcut);
  ocrShortcut = null;
  if (!wanted) return;
  try {
    if (globalShortcut.register(wanted, () => startSnip())) ocrShortcut = wanted;
    else console.warn(`Shortcut ambil teks ${wanted} sudah dipakai aplikasi lain.`);
  } catch (error) {
    console.warn(`Shortcut ambil teks ${wanted} tidak valid:`, error.message);
  }
}

async function startSnip() {
  if (snipWin) return snipWin.focus();
  setExpanded(false);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
  // Kapsul disembunyikan sebentar supaya tidak ikut tertangkap.
  win?.setOpacity(0);
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  } catch (error) {
    debugLog('tangkap layar gagal: ' + error.message);
  } finally {
    win?.setOpacity(1);
  }
  const source = sources.find((s) => String(s.display_id) === String(display.id)) ?? (sources.length === 1 ? sources[0] : null);
  if (!source || source.thumbnail.isEmpty()) {
    showPeek({ kind: 'ocr', mood: 'confused', app: 'Ambil teks', title: 'Layar tidak bisa ditangkap', body: 'Coba lagi sebentar lagi.', seconds: 6 });
    return;
  }
  snipShot = { image: source.thumbnail, display };
  snipWin = new BrowserWindow({
    ...display.bounds,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#000000',
    webPreferences: { preload: path.join(__dirname, 'preload-snip.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  snipWin.setAlwaysOnTop(true, 'screen-saver');
  snipWin.loadFile(path.join(__dirname, 'renderer', 'snip.html'));
  snipWin.webContents.once('did-finish-load', () => {
    snipWin?.webContents.send('snip:image', snipShot.image.toDataURL());
    snipWin?.setBounds(display.bounds);
    snipWin?.show();
    snipWin?.focus();
  });
  snipWin.on('blur', () => closeSnip());
  snipWin.on('closed', () => {
    snipWin = null;
  });
}

function closeSnip() {
  const target = snipWin;
  snipWin = null;
  if (target && !target.isDestroyed()) target.destroy();
}

ipcMain.on('snip:done', (_event, rect) => {
  const shot = snipShot;
  snipShot = null;
  closeSnip();
  if (!shot || !rect) return;
  const scale = shot.image.getSize().width / shot.display.bounds.width;
  const crop = {
    x: Math.max(0, Math.round(Number(rect.x) * scale)),
    y: Math.max(0, Math.round(Number(rect.y) * scale)),
    width: Math.round(Number(rect.width) * scale),
    height: Math.round(Number(rect.height) * scale),
  };
  if (!(crop.width > 4 && crop.height > 4)) return;
  let image = shot.image.crop(crop);
  // Teks kecil lebih mudah dibaca OCR kalau gambarnya diperbesar.
  if (crop.height < 120) image = image.resize({ height: crop.height * 2, quality: 'best' });
  const id = crypto.randomUUID().slice(0, 8);
  const file = path.join(os.tmpdir(), `zenopod-ocr-${id}.png`);
  fs.writeFileSync(file, image.toPNG());
  ocrJobs.set(id, file);
  bridgeCommand(`ocr ${id} ${file}`);
  setTimeout(() => {
    fs.rmSync(file, { force: true });
    if (!ocrJobs.delete(id)) return;
    showPeek({ kind: 'ocr', mood: 'confused', app: 'Ambil teks', title: 'Teksnya tidak terbaca', body: 'Helper Windows tidak menjawab. Coba lagi ya.', seconds: 6 });
  }, 20_000);
});

function onOcr(message) {
  const file = ocrJobs.get(String(message.id));
  if (!file) return;
  ocrJobs.delete(String(message.id));
  // Gambar potongan layar tidak disimpan (bridge juga menghapusnya; ini cadangan).
  setTimeout(() => fs.rmSync(file, { force: true }), 1000);
  const ocrPeek = (mood, title, body, extra = {}) =>
    showPeek({ kind: 'ocr', mood, app: 'Ambil teks dari layar', title, body, seconds: 8, actions: [{ id: 'again', label: 'Ambil lagi' }, { id: 'ok', label: 'Oke', primary: true }], ...extra });
  if (message.error) {
    debugLog('ocr gagal: ' + message.error);
    if (message.error === 'no-helper') return ocrPeek('confused', 'Ambil teks belum tersedia', 'Pasang Zenopod dari file .dmg untuk memakai fitur ini.');
    return message.error === 'no-language'
      ? ocrPeek('confused', 'Paket OCR Windows belum ada', 'Tambahkan bahasa Inggris di Pengaturan Windows › Waktu & bahasa › Bahasa, lalu coba lagi.')
      : ocrPeek('confused', 'Teksnya tidak terbaca', 'Coba pilih area yang lebih pas ya.');
  }
  const text = String(message.text ?? '').trim();
  if (!text) return ocrPeek('confused', 'Tidak ada teks di area itu', 'Coba pilih area yang berisi tulisan ya.');
  clipboard.writeText(text);
  statsAdd('ocr');
  const lines = text.split('\n').length;
  ocrPeek('happy', `Teks tersalin · ${lines} baris`, text.replace(/\s+/g, ' ').slice(0, 160), { sound: 'pop' });
}

// ---------- Sistem & internet ----------

let systemState = { cpu: null, memory: null, disk: null, online: null, ms: null, offlineSince: null };
const systemWarned = { cpu: false, memory: false, disk: null };
let cpuHighTicks = 0;
let probeFails = 0;

function systemPeek(mood, title, body, sound = 'uhoh') {
  showPeek({ kind: 'system', mood, sound, app: `${config.buddy.name || 'Zeno'} · Sistem`, title, body, seconds: 9 });
}

async function pollSystem() {
  const cpu = sysmon.cpuPercent();
  const memory = sysmon.memory();
  const disk = sysmon.disk();
  const probe = await sysmon.probe();
  const before = systemState.online;
  let { online, offlineSince } = systemState;

  // Dua kali gagal berturut-turut baru dianggap putus (satu kali bisa cuma lambat).
  if (probe.online) {
    if (before === false && config.system.internetAlerts) {
      const minutes = Math.max(1, Math.round((Date.now() - offlineSince) / 60_000));
      systemPeek('laugh', 'Internet tersambung lagi', `Tadi putus sekitar ${minutes} menit.`, 'success');
    }
    probeFails = 0;
    online = true;
    offlineSince = null;
  } else if (++probeFails >= 2 && before !== false) {
    online = false;
    offlineSince = Date.now() - 15_000;
    if (before === true && config.system.internetAlerts) systemPeek('cry', 'Internet putus', 'Aku kabari lagi kalau sudah tersambung.');
  }

  if (config.system.resourceAlerts) {
    // CPU ≥ 90% selama ±1 menit, RAM ≥ 90%, disk sisa < 10% (sekali sehari).
    cpuHighTicks = cpu != null && cpu >= 90 ? cpuHighTicks + 1 : 0;
    if (cpuHighTicks >= 4 && !systemWarned.cpu) {
      systemWarned.cpu = true;
      systemPeek('stretch', `CPU sibuk ${cpu}%`, 'Laptop sedang kerja keras. Tutup aplikasi yang tidak dipakai ya.');
    }
    if (cpu != null && cpu < 70) systemWarned.cpu = false;
    if (memory.percent >= 90 && !systemWarned.memory) {
      systemWarned.memory = true;
      systemPeek('stretch', `RAM terpakai ${memory.percent}%`, `Sisa ${sysmon.bytes(memory.total - memory.used)}. Tutup tab atau aplikasi yang berat ya.`);
    }
    if (memory.percent < 80) systemWarned.memory = false;
    if (disk && 100 - disk.percent < 10 && systemWarned.disk !== dayKey()) {
      systemWarned.disk = dayKey();
      systemPeek('surprised', `${['Disk', disk.drive].filter(Boolean).join(' ')} hampir penuh`, `Sisa ${sysmon.bytes(disk.free)}. Kosongkan Downloads atau ${IS_MAC ? 'Trash' : 'Recycle Bin'} ya.`);
    }
  }

  systemState = { cpu: cpu ?? systemState.cpu, memory, disk, online, ms: probe.online ? probe.ms : null, offlineSince };
  send('kapsul:system', systemState);
}

function systemText(what) {
  const s = systemState;
  if (what === 'internet') {
    if (s.online == null) return 'Sebentar, aku cek dulu koneksinya.';
    return s.online ? `Internet tersambung${s.ms ? `, waktu respons ${s.ms} milidetik` : ''}.` : 'Internet sedang putus.';
  }
  const parts = [s.cpu != null ? `CPU ${s.cpu}%` : '', s.memory ? `RAM ${s.memory.percent}%` : '', s.disk ? `${['disk', s.disk.drive].filter(Boolean).join(' ')} sisa ${sysmon.bytes(s.disk.free)}` : ''];
  return `${parts.filter(Boolean).join(', ')}.`;
}

// ---------- Kebiasaan (streak) ----------

const habitReminded = new Set(); // `${id}:${tanggal}`

function habitList() {
  return habits.today(config.habits, stats.data.habits);
}

function sendHabits() {
  send('kapsul:habits', habitList());
}

// XP hanya sekali per kebiasaan per hari (centang-batal-centang tidak menambah XP lagi).
function habitDone(id, done = true) {
  if (!config.habits.some((h) => h.id === id)) return null;
  stats.data.habits = habits.setDone(stats.data.habits, id, done);
  const day = stats.day();
  day.habitIds ??= [];
  if (done && !day.habitIds.includes(id)) {
    day.habitIds.push(id);
    statsAdd('habits');
  } else {
    stats.save();
  }
  if (done) send('kapsul:pet-event', { type: 'habit' });
  sendHabits();
  settingsWin?.webContents.send('settings:changed');
  return habitList().find((h) => h.id === id) ?? null;
}

function checkHabits() {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const h of habitList()) {
    const key = `${h.id}:${dayKey(now)}`;
    if (!h.remind || !h.scheduled || h.done || time < h.remind || habitReminded.has(key)) continue;
    habitReminded.add(key);
    showPeek({
      kind: 'habit',
      mood: 'happy',
      sound: 'today',
      app: `${config.buddy.name || 'Zeno'} · Kebiasaan`,
      title: `${h.emoji} Sudah ${h.name.toLowerCase()} hari ini?`,
      body: h.streak ? `Streak ${h.streak} hari, jangan sampai putus!` : 'Yuk mulai streak-nya hari ini.',
      sticky: true,
      ref: h.id,
      actions: [
        { id: 'later', label: 'Nanti' },
        { id: 'done', label: 'Sudah', primary: true },
      ],
    });
  }
  sendHabits(); // ganti hari = status centang ikut berganti
}

// ---------- Sapaan ----------

let lastGreetPeriod = null;

function greet() {
  const g = schedule.greeting(config.user.name);
  lastGreetPeriod = g.period;
  // Sore: ingatkan tugas yang belum selesai.
  const open = config.todos.filter((t) => !t.done);
  const body =
    g.period === 'sore' && open.length
      ? `Masih ada ${open.length} tugas belum selesai: ${open[0].text}${open.length > 1 ? ', …' : ''}`
      : g.body;
  showPeek({ kind: 'greeting', mood: 'happy', sound: 'hello', app: config.buddy.name || 'Zenopod', title: g.title, body, seconds: open.length && g.period === 'sore' ? 9 : 7 });
}

// Sapa saat Zenopod dibuka, lalu sekali di awal pagi/siang/sore/malam bila sedang di depan laptop.
function watchGreetings() {
  setInterval(() => {
    if (!config.greetings || !config.user.name) return;
    const active = Date.now() - lastActivity < 2 * 60_000;
    if (active && schedule.period() !== lastGreetPeriod) greet();
  }, 60_000);
}

// ---------- Pengingat ----------

const formatTime = (ms) => {
  const date = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const time = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Hari ini ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Besok ${time}`;
  return `${date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
};

function sendReminders() {
  const next = schedule.upcoming(config.reminders);
  send('kapsul:reminders', next ? { title: next.title, when: formatTime(next.next) } : null);
}

function updateReminder(id, change) {
  saveConfig({ ...config, reminders: config.reminders.map((r) => (r.id === id ? change(r) : r)) });
  sendReminders();
  settingsWin?.webContents.send('settings:changed');
}

function checkReminders() {
  const now = Date.now();
  for (const reminder of config.reminders) {
    if (!schedule.due(reminder, now)) continue;
    updateReminder(reminder.id, (r) => ({ ...r, firedFor: r.next }));
    showPeek({
      kind: 'reminder',
      mood: 'alarm',
      app: `${config.buddy.name || 'Zenopod'} mengingatkan · ${formatTime(reminder.next)}`,
      title: reminder.title,
      body: reminder.note || '',
      sticky: true,
      sound: 'alarm',
      ref: reminder.id,
      actions: [
        { id: 'snooze', label: 'Tunda 10 menit' },
        { id: 'ok', label: 'Oke', primary: true },
      ],
    });
  }
  sendReminders();
}

// ---------- Jendela Pengaturan ----------

function openSettings(section) {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('settings:section', section);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 720,
    minHeight: 520,
    title: 'Pengaturan Zenopod',
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    icon: appIcon(32),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: section ? { section } : {} });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
  setExpanded(false);
}

// Dari kode: electron.exe <folder project>. Versi terpasang: Zenopod.exe tanpa argumen.
const loginArgs = () => (paths.packaged ? [] : [app.getAppPath()]);

function autostartEnabled() {
  return app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
}

function setAutostart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: loginArgs() });
  tray?.setContextMenu(buildTrayMenu());
}

function settingsState() {
  return {
    config,
    autostart: autostartEnabled(),
    hooks: claude.hooksStatus(),
    launcher: items.map(({ launch, ...rest }) => rest),
    costumeNow: costumeState,
    costumes: season.COSTUMES,
    weatherNow: weatherState,
    statsWeek: stats.week().map((d) => ({ ...d, songs: undefined })),
    pet: stats.pet(),
    voiceStatus: voice.status(),
    appVersion: app.getVersion(),
    updateStatus,
    chatModels: chat.MODELS,
    chatKeyMask: chat.maskKey(config.chat.apiKeyEnc),
    chatEnvKey: Boolean(process.env.ANTHROPIC_API_KEY),
    platform: process.platform,
    calendarStatus: {
      checkedAt: calendarState.checkedAt,
      errors: calendarState.errors,
      count: calendarState.events.length,
      next: calendar.nextTimed(calendarState.events),
    },
    habitsToday: habitList(),
    systemNow: systemState,
    ttsVoices,
    ttsAuto: ttsVoice(),
    notificationIcons: Object.fromEntries((config.notifications.seen ?? []).map((s) => [s.name, appIcons[s.app] ?? null])),
  };
}

ipcMain.handle('settings:get', () => settingsState());

ipcMain.handle('settings:save', async (_event, patch) => {
  const firstIntro = !config.user.name && patch.user?.name;
  const next = { ...config, ...patch };
  if (patch.reminders) {
    // Hitung ulang jadwal hanya untuk pengingat baru atau yang waktunya diubah,
    // supaya status tunda/sudah tampil tidak hilang.
    next.reminders = patch.reminders.map((r) => {
      const old = config.reminders.find((o) => o.id === r.id);
      const same = old && old.date === r.date && old.time === r.time && old.repeat === r.repeat;
      return same ? { ...old, title: r.title, note: r.note } : schedule.prepare(r);
    });
  }
  if (patch.position && patch.position !== config.position && patch.offsetX === undefined) {
    next.offsetX = DEFAULT_OFFSET[patch.position] ?? config.offsetX;
  }
  saveConfig(next);
  await loadConfig();
  if (firstIntro) setTimeout(greet, 600);
  return settingsState();
});

ipcMain.handle('settings:installed-apps', () => apps.installedApps());

ipcMain.handle('settings:hooks', (_event, action) => {
  if (action === 'install') claude.installHooks();
  else if (action === 'uninstall') claude.uninstallHooks();
  return claude.hooksStatus();
});

ipcMain.handle('settings:autostart', (_event, enabled) => {
  setAutostart(Boolean(enabled));
  return autostartEnabled();
});

ipcMain.handle('settings:voice-download', () => {
  voice.download((status) => settingsWin?.webContents.send('settings:voice-status', status));
  return voice.status();
});

ipcMain.handle('settings:voice-test', (_event, text) => {
  if (!ttsVoice()) return false;
  speak(String(text || `Halo, aku ${config.buddy.name || 'Zeno'}!`).slice(0, 200));
  return true;
});

ipcMain.handle('settings:search-city', async (_event, name) => {
  try {
    return { results: await weather.searchCity(String(name).slice(0, 80)) };
  } catch (error) {
    return { error: 'Pencarian kota gagal: ' + error.message, results: [] };
  }
});

// API key hanya lewat sini: dienkripsi sebelum disimpan, tidak pernah dikirim balik utuh.
ipcMain.handle('settings:chat-key', async (_event, key) => {
  const value = typeof key === 'string' ? key.trim() : '';
  if (value && !/^sk-ant-/.test(value)) return { ok: false, error: 'API key Claude diawali "sk-ant-".' };
  try {
    saveConfig({ ...config, chat: { ...config.chat, apiKeyEnc: chat.encryptKey(value) } });
    conversation.reset();
    await loadConfig();
    return { ok: true, state: settingsState() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('settings:chat-test', async () => {
  try {
    return { ok: true, answer: await askZeno('Halo! Perkenalkan dirimu dalam satu kalimat.') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Alamat iCal = kunci baca kalender: dienkripsi, hanya host-nya yang ditampilkan.
ipcMain.handle('settings:calendar-add', async (_event, name, url) => {
  const clean = calendar.normalizeUrl(url);
  if (!clean) return { ok: false, error: 'Alamat kalender diawali https:// atau webcal:// dan berakhiran .ics.' };
  const feed = { id: crypto.randomUUID(), name: String(name || '').trim().slice(0, 30) || 'Kalender', url: clean };
  const test = await calendar.upcoming([feed]);
  if (test.errors[feed.id]) return { ok: false, error: `Kalender tidak bisa dibaca: ${test.errors[feed.id]}.` };
  try {
    const stored = { id: feed.id, name: feed.name, host: new URL(clean).host, urlEnc: chat.encryptKey(clean) };
    saveConfig({ ...config, calendar: { ...config.calendar, enabled: true, feeds: [...config.calendar.feeds, stored] } });
  } catch (error) {
    return { ok: false, error: error.message };
  }
  await loadConfig();
  return { ok: true, state: settingsState() };
});

ipcMain.handle('settings:calendar-refresh', async () => {
  await pollCalendar();
  return settingsState();
});

ipcMain.handle('settings:habit-done', (_event, id, done) => {
  habitDone(String(id), Boolean(done));
  return settingsState();
});

ipcMain.handle('settings:check-update', async () => {
  if (updateStatus.state === 'manual') shell.openExternal(RELEASES_URL);
  if (!updater) return updateStatus;
  try {
    await updater.checkForUpdates();
  } catch {
    // status diisi event 'error'
  }
  return updateStatus;
});

ipcMain.handle('settings:pick-folder', async () => {
  const result = await dialog.showOpenDialog(settingsWin, { title: 'Pilih folder project', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0].replace(/\\/g, '/');
});

ipcMain.handle('settings:preview', (_event, kind) => {
  if (kind === 'greeting') greet();
  if (kind === 'summary') showSummary();
  return true;
});

// ---------- Tray ----------

// Ikon titik bulat dibuat langsung dari piksel, jadi tidak perlu file gambar.
function dotIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const alpha = Math.max(0, Math.min(1, r - 1 - d + 0.5));
      const i = (y * size + x) * 4;
      pixels[i] = 0xf5; // B
      pixels[i + 1] = 0xa8; // G
      pixels[i + 2] = 0x5b; // R
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: shortcut ? `Buka Zenopod (${shortcutKeys(shortcut).join(IS_MAC ? '' : '+')})` : 'Buka Zenopod',
      click: () => setExpanded(true, { focus: true }),
    },
    { label: 'Pengaturan…', click: () => openSettings() },
    { label: ocrShortcut ? `Ambil teks dari layar (${shortcutKeys(ocrShortcut).join(IS_MAC ? '' : '+')})` : 'Ambil teks dari layar', click: () => startSnip() },
    {
      label: 'Posisi',
      submenu: [
        ['top-left', 'Kiri atas'],
        ['top-center', 'Tengah atas'],
        ['top-right', 'Kanan atas'],
      ]
        .map(([value, label]) => ({
          label,
          type: 'radio',
          checked: config.position === value,
          click: () => setPosition(value),
        }))
        .concat([{ label: 'Bebas (hasil geser)', type: 'radio', checked: config.position === 'custom', enabled: false }]),
    },
    {
      label: 'Gaya',
      submenu: [
        ['auto', 'Otomatis (menempel di tepi atas)'],
        ['pill', 'Selalu melayang (pill)'],
      ].map(([value, label]) => ({
        label,
        type: 'radio',
        checked: config.island === value,
        click: () => setIsland(value),
      })),
    },
    {
      label: 'Muat ulang',
      click: () => {
        loadConfig();
        bridgeCommand('refresh');
      },
    },
    { type: 'separator' },
    {
      label: IS_MAC ? 'Jalankan saat login' : 'Jalankan saat Windows mulai',
      type: 'checkbox',
      checked: autostartEnabled(),
      click: (menuItem) => setAutostart(menuItem.checked),
    },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() },
  ]);
}

function appIcon(size) {
  try {
    const image = nativeImage.createFromPath(paths.icon);
    if (!image.isEmpty()) return image.resize({ width: size, height: size, quality: 'best' });
  } catch {
    // tanpa ikon
  }
  return dotIcon(size);
}

function createTray() {
  tray = new Tray(appIcon(IS_MAC ? 18 : 16));
  tray.setToolTip('Zenopod');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => setExpanded(!expanded, { focus: true }));
}

// ---------- IPC kapsul ----------

ipcMain.on('kapsul:expand', (_event, next, focus) => setExpanded(Boolean(next), { focus: Boolean(focus) }));
ipcMain.on('kapsul:launch', (_event, index) => {
  const item = items[Number(index)];
  if (item) {
    apps.launch(item);
    statsAdd('apps');
  }
  setExpanded(false);
});
ipcMain.on('kapsul:media', (_event, command) => mediaCommand(String(command)));
ipcMain.on('kapsul:notif-open', (_event, id) => openNotification(Number(id)));
ipcMain.on('kapsul:notif-dismiss', (_event, id) => bridgeCommand(`dismiss ${Number(id)}`));
ipcMain.on('kapsul:notif-clear', () => bridgeCommand('clear'));
ipcMain.on('kapsul:peek-action', (_event, id, action) => peekAction(String(id), String(action)));
ipcMain.on('kapsul:peek-click', (_event, id) => {
  if (currentPeek?.id !== id) return;
  if (currentPeek.kind === 'notification' || currentPeek.kind === 'drive') peekAction(id, 'open');
  else if (!currentPeek.sticky) endPeek();
});
ipcMain.on('kapsul:detail', (_event, value) => {
  detail = Boolean(value);
  if (expanded) resize();
});
ipcMain.on('kapsul:drive', (_event, action, letter) => {
  if (!usbDrives?.has(String(letter))) return;
  if (action === 'open') openDrive(String(letter));
  if (action === 'eject') ejectDrive(String(letter));
});
ipcMain.on('kapsul:focus', (_event, action, minutes) => focusCommand(String(action), Number(minutes) || undefined));
ipcMain.on('kapsul:battery', (_event, state) => {
  if (state && typeof state.level === 'number') {
    onBattery({
      level: state.level,
      charging: Boolean(state.charging),
      chargingTime: Number(state.chargingTime),
      dischargingTime: Number(state.dischargingTime),
    });
  }
});
ipcMain.on('kapsul:dev-open', (_event, kind, index) => devOpen(String(kind), Number(index)));
ipcMain.on('kapsul:dev-refresh', () => {
  pollServices();
  pollGit();
});
ipcMain.on('kapsul:clip', (_event, action, id) => clipCommand(String(action), id ? String(id) : null));
ipcMain.on('kapsul:todo', (_event, action, payload) => todoCommand(String(action), payload ?? {}));
ipcMain.on('kapsul:position', (_event, position) => setPosition(String(position)));
ipcMain.on('kapsul:drag-start', () => dragStart());
ipcMain.handle('kapsul:ask', async (_event, question) => {
  const q = String(question).trim();
  if (!q) return { ok: false };
  if (!chatReady()) {
    reply(q, 'Atur dulu API key Claude di Pengaturan › Ngobrol ya.', 'confused');
    return { ok: false };
  }
  try {
    const answer = await askZeno(q);
    showAnswer(q, answer);
    return { ok: true, answer };
  } catch (error) {
    reply(q, error.message, 'confused');
    return { ok: false };
  }
});
ipcMain.on('kapsul:quick-set', (_event, what, value) => quickSet(String(what), value));
ipcMain.on('kapsul:pet', (_event, action, food) => {
  if (action === 'feed') feedPet(String(food));
  if (action === 'play') playPet();
});
ipcMain.handle('kapsul:quick', (_event, query) => quickQuery(query));
ipcMain.on('kapsul:copy', (_event, text) => clipboard.writeText(String(text)));
ipcMain.on('kapsul:timer', (_event, action, payload = {}) => {
  if (action === 'start' && Number(payload.ms) > 0) startTimer(Number(payload.ms), payload.label);
  if (action === 'cancel') cancelTimer(payload.id ? String(payload.id) : null);
});
ipcMain.on('kapsul:power', (_event, action) => {
  if (String(action) in POWER_LABELS) power(String(action));
});
ipcMain.handle('kapsul:installed', async () => {
  const list = await apps.installedApps();
  installedForVoice = list;
  return list.map((a) => ({ key: a.key, name: a.name, icon: a.icon }));
});
ipcMain.on('kapsul:launch-installed', (_event, key) => {
  const found = installedForVoice.find((a) => a.key === key);
  if (!found) return;
  apps.launch({ launch: found.aumid ? { aumid: found.aumid } : { target: found.target } });
  statsAdd('apps');
  setExpanded(false);
});
ipcMain.on('kapsul:drag-move', (_event, dx, dy) => dragMove(Number(dx), Number(dy)));
ipcMain.on('kapsul:drag-end', () => dragEnd());
ipcMain.on('kapsul:settings', (_event, section) => openSettings(typeof section === 'string' ? section : undefined));
ipcMain.on('kapsul:snip', () => setTimeout(startSnip, 250));
ipcMain.on('kapsul:habit', (_event, id, done) => habitDone(String(id), Boolean(done)));
ipcMain.on('kapsul:meeting', (_event, url) => openMeeting(String(url)));
ipcMain.on('kapsul:ready', (event) => {
  event.sender.send('kapsul:state', publicState());
  event.sender.send('kapsul:media', lastMedia);
  event.sender.send('kapsul:lyrics', lyricsState);
  sendDevices();
  sendNotifications();
  sendReminders();
  sendClaude();
  event.sender.send('kapsul:focus', focus.state);
  event.sender.send('kapsul:clips', clips.list());
  event.sender.send('kapsul:dev', devState);
  event.sender.send('kapsul:weather', weatherState);
  event.sender.send('kapsul:costume', costumeState);
  event.sender.send('kapsul:todos', config.todos);
  sendStats();
  sendTimers();
  sendCalendar();
  sendHabits();
  event.sender.send('kapsul:system', systemState);
  if (quickState) event.sender.send('kapsul:quick-state', quickState);
  if (currentPeek) event.sender.send('kapsul:peek', currentPeek);
});

// ---------- Lifecycle ----------

app.on('second-instance', () => setExpanded(true, { focus: true }));

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  if (IS_MAC) app.dock?.hide(); // aplikasi menu bar, tanpa ikon di Dock
  else app.setAppUserModelId('local.kapsul');
  // Mikrofon hanya untuk jendela Zenopod sendiri (perintah suara).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  createWindow();
  createTray();
  await loadConfig();
  watchConfig();
  startBridge();
  feedCursor();
  claude.startServer(onClaudeEvent, onPermission);
  watchGreetings();
  setInterval(checkReminders, 15_000);
  setInterval(sendClaude, 60_000);
  setInterval(tickStats, 30_000);
  setInterval(tickWellness, 60_000);
  setInterval(checkCalendar, 30_000);
  setInterval(checkHabits, 60_000);
  setInterval(pollSystem, 15_000);
  devTimers = [
    setInterval(pollServices, 30_000),
    setInterval(pollGit, 20_000),
    setInterval(pollWeather, 30 * 60_000),
    setInterval(updateCostume, 10 * 60_000),
    setInterval(pollCalendar, 10 * 60_000),
  ];
  pollCalendarIfChanged();
  pollSystem();
  pollWeather();
  pollServices();
  pollGit();
  // Daftar aplikasi terpasang untuk "buka …" dan pencarian (dimuat di belakang).
  apps.installedApps().then((list) => (installedForVoice = list)).catch(() => {});
  setupUpdates();

  // Pertama kali: kenalan dulu. Sesudahnya: sapa + cek pengingat yang terlewat.
  if (!config.user.name) {
    openSettings('intro');
  } else {
    setTimeout(() => {
      if (config.greetings) greet();
      checkReminders();
    }, 2500);
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  bridge?.stdin.end();
  bridge?.kill();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (event) => event.preventDefault());
