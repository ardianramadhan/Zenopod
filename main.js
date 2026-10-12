'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, globalShortcut, ipcMain, nativeImage, screen, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { CONFIG_FILE, DEFAULT_OFFSET, normalize, readConfig, writeConfig } = require('./lib/config');
const apps = require('./lib/apps');
const claude = require('./lib/claude');
const schedule = require('./lib/schedule');
const { Focus } = require('./lib/focus');
const { ClipboardHistory } = require('./lib/clipboard');
const devwatch = require('./lib/devwatch');
const season = require('./lib/season');
const weather = require('./lib/weather');
const voice = require('./lib/voice');
const commands = require('./lib/commands');

const SIZE = {
  collapsed: { width: 236, height: 40 },
  peek: { width: 388, height: 84 },
  peekTall: { width: 388, height: 122 },
  expanded: { width: 468, height: 384 },
};

let win = null;
let settingsWin = null;
let tray = null;
let bridge = null;
let expanded = false;
let items = [];
let config = readConfig();
let shortcut = null;
let lastMedia = { playing: false, title: null };
let notifications = { access: 'Unknown', items: [] };
let knownIds = null; // null = belum ada daftar pertama (notifikasi lama tidak dianggap baru)
let lastActivity = Date.now();
let devTimers = null;
const appIcons = {};

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
}

// Log diagnosa, aktif bila KAPSUL_DEBUG berisi path file log.
const debugLog = (msg) => process.env.KAPSUL_DEBUG && fs.appendFileSync(process.env.KAPSUL_DEBUG, `${new Date().toISOString()} ${msg}\n`);

const send = (channel, payload) => win?.webContents.send(channel, payload);

// ---------- Jendela kapsul ----------

// Zenopod menempel di tepi atas; saat melebar tetap di sisi yang sama.
// offsetX = jarak dari tepi kiri/kanan layar (left/right) atau geser dari tengah (center).
// Posisi bebas (hasil geser): config.custom = titik kiri-atas kapsul kecil.
// Panel membuka ke arah yang masih muat: ke kiri kalau mepet kanan, ke atas kalau mepet bawah.
function customLayout() {
  const point = { x: Math.round(config.custom?.x ?? 0), y: Math.round(config.custom?.y ?? 0) };
  const { workArea: wa } = screen.getDisplayNearestPoint(point);
  const px = Math.min(Math.max(point.x, wa.x), wa.x + wa.width - SIZE.collapsed.width);
  const py = Math.min(Math.max(point.y, wa.y), wa.y + wa.height - SIZE.collapsed.height);
  return {
    px,
    py,
    align: px + SIZE.expanded.width <= wa.x + wa.width ? 'left' : 'right',
    valign: py + SIZE.expanded.height <= wa.y + wa.height ? 'top' : 'bottom',
  };
}

const isCustom = () => config.position === 'custom' && config.custom;

function boundsFor(state) {
  const { width, height } = SIZE[state];
  if (isCustom()) {
    const l = customLayout();
    return {
      x: l.align === 'left' ? l.px : l.px + SIZE.collapsed.width - width,
      y: l.valign === 'top' ? l.py : l.py + SIZE.collapsed.height - height,
      width,
      height,
    };
  }
  const { workArea } = screen.getPrimaryDisplay();
  const offset = Number(config.offsetX) || 0;
  let x;
  if (config.position === 'top-left') {
    x = workArea.x + offset;
  } else if (config.position === 'top-right') {
    x = workArea.x + workArea.width - width - offset;
  } else {
    x = workArea.x + (workArea.width - width) / 2 + offset;
  }
  return { x: Math.round(x), y: workArea.y + 6, width, height };
}

function align() {
  if (isCustom()) return customLayout().align;
  return { 'top-left': 'left', 'top-right': 'right' }[config.position] ?? 'center';
}

function valign() {
  return isCustom() ? customLayout().valign : 'top';
}

// ---------- Geser kapsul ----------

let drag = null; // { bounds, align, valign } saat mulai digeser

function dragStart() {
  if (!win) return;
  clearTimeout(shrinkTimer);
  drag = { bounds: win.getBounds(), align: align(), valign: valign() };
}

function dragMove(dx, dy) {
  if (!drag) return;
  win.setBounds({ ...drag.bounds, x: Math.round(drag.bounds.x + dx), y: Math.round(drag.bounds.y + dy) });
}

// Lepas: simpan titik kapsul kecil. Dekat kiri/tengah/kanan atas = menempel ke posisi itu.
function dragEnd() {
  if (!drag) return;
  const b = win.getBounds();
  const pw = SIZE.collapsed.width;
  const ph = SIZE.collapsed.height;
  const px = drag.align === 'right' ? b.x + b.width - pw : drag.align === 'center' ? b.x + (b.width - pw) / 2 : b.x;
  const py = drag.valign === 'bottom' ? b.y + b.height - ph : b.y;
  drag = null;

  const { workArea: wa } = screen.getDisplayNearestPoint({ x: Math.round(px), y: Math.round(py) });
  const primary = screen.getPrimaryDisplay().workArea;
  if (wa.x === primary.x && wa.y === primary.y && py - wa.y < 40) {
    for (const preset of ['top-left', 'top-center', 'top-right']) {
      const at = presetPillX(preset, wa);
      if (Math.abs(px - at) < 60) {
        setPosition(preset, { force: true });
        return;
      }
    }
  }
  saveConfig({ ...config, position: 'custom', custom: { x: Math.round(px), y: Math.round(py) } });
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
  if (expanded) return 'expanded';
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
    icon: dotIcon(32),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  // Klik di luar widget = tutup panel.
  win.on('blur', () => setExpanded(false));

  // Layar berubah (monitor dicolok/dicabut, resolusi) = posisikan ulang.
  screen.on('display-metrics-changed', () => win.setBounds(boundsFor(currentState())));
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
    updateReminder(peek.ref, (r) => (action === 'snooze' ? schedule.snooze(r, 10) : schedule.acknowledge(r)));
  } else if (peek.kind === 'notification' && action === 'open') {
    openNotification(peek.ref);
  } else if (peek.kind === 'permission') {
    const finish = permissionReplies.get(peek.id);
    finish?.(action === 'allow' ? 'allow' : action === 'deny' ? 'deny' : null);
    return; // finish() sudah menutup kartunya
  } else if (peek.kind === 'focus') {
    if (action === 'start') focus.start('focus');
    if (action === 'break') focus.start();
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
  if (win) win.setBounds(boundsFor(currentState()));
  tray?.setContextMenu(buildTrayMenu());
  items = await apps.resolveItems(config.apps);
  send('kapsul:state', publicState());
  sendNotifications();
  sendReminders();
  sendTodos();
  syncClipboard();
  if (devTimers) {
    pollServices();
    pollGit();
    pollWeather();
  // Daftar aplikasi terpasang untuk "buka …" (dimuat di belakang).
  apps.installedApps().then((list) => (installedForVoice = list)).catch(() => {});
  }
  settingsWin?.webContents.send('settings:changed');
}

function watchConfig() {
  let timer = null;
  // Pantau foldernya: editor sering menyimpan dengan mengganti file, bukan menimpanya.
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
    buddyName: config.buddy.name,
    focus: config.focus,
    sound: config.sound,
    ticker: config.ticker,
    userName: config.user.name,
    shortcut: shortcut ? shortcut.split('+').map((k) => (k === 'Control' ? 'Ctrl' : k)) : [],
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

function setPosition(position, { force = false } = {}) {
  if (!(position in DEFAULT_OFFSET) || (position === config.position && !force)) return;
  saveConfig({ ...config, position, offsetX: DEFAULT_OFFSET[position] });
  loadConfig();
}

// ---------- Bridge (musik + notifikasi, lihat bridge.ps1) ----------

function startBridge() {
  debugLog('start bridge');
  bridge = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'bridge.ps1')], {
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
  } else if (message.type === 'icon') {
    appIcons[message.app] = message.data;
    sendNotifications();
  } else if (message.type === 'notifications') {
    receiveNotifications(message);
  } else if (message.type === 'voices') {
    ttsVoices = Array.isArray(message.voices) ? message.voices : [message.voices].filter(Boolean);
    settingsWin?.webContents.send('settings:changed');
  } else if (message.type === 'speech') {
    send('kapsul:speech', message.data);
  }
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
  onPhaseEnd: (phase, state) => {
    if (phase === 'focus') {
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

function focusCommand(action) {
  if (action === 'start') focus.start();
  else if (action === 'focus') focus.start('focus');
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
    if (fs.existsSync(VSCODE)) spawn(VSCODE, [dir], { detached: true, stdio: 'ignore' }).unref();
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
    weatherState = { ...now, city: config.weather.city.name, look: weather.weatherLook(now) };
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

function onBattery({ level, charging }) {
  const percent = Math.round(level * 100);
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
    default:
      return reply(heard, `Maaf, aku belum paham “${heard}”.`, 'confused');
  }
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
    icon: dotIcon(32),
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

function autostartEnabled() {
  return app.getLoginItemSettings({ path: process.execPath, args: [app.getAppPath()] }).openAtLogin;
}

function setAutostart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [app.getAppPath()] });
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
    voiceStatus: voice.status(),
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

ipcMain.handle('settings:pick-folder', async () => {
  const result = await dialog.showOpenDialog(settingsWin, { title: 'Pilih folder project', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0].replace(/\\/g, '/');
});

ipcMain.handle('settings:preview', (_event, kind) => {
  if (kind === 'greeting') greet();
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
      label: shortcut ? `Buka Zenopod (${shortcut.replace('Control', 'Ctrl')})` : 'Buka Zenopod',
      click: () => setExpanded(true, { focus: true }),
    },
    { label: 'Pengaturan…', click: () => openSettings() },
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
      label: 'Muat ulang',
      click: () => {
        loadConfig();
        bridgeCommand('refresh');
      },
    },
    { type: 'separator' },
    {
      label: 'Jalankan saat Windows mulai',
      type: 'checkbox',
      checked: autostartEnabled(),
      click: (menuItem) => setAutostart(menuItem.checked),
    },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(dotIcon(16));
  tray.setToolTip('Zenopod');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => setExpanded(!expanded, { focus: true }));
}

// ---------- IPC kapsul ----------

ipcMain.on('kapsul:expand', (_event, next, focus) => setExpanded(Boolean(next), { focus: Boolean(focus) }));
ipcMain.on('kapsul:launch', (_event, index) => {
  const item = items[Number(index)];
  if (item) apps.launch(item);
  setExpanded(false);
});
ipcMain.on('kapsul:media', (_event, command) => mediaCommand(String(command)));
ipcMain.on('kapsul:notif-open', (_event, id) => openNotification(Number(id)));
ipcMain.on('kapsul:notif-dismiss', (_event, id) => bridgeCommand(`dismiss ${Number(id)}`));
ipcMain.on('kapsul:notif-clear', () => bridgeCommand('clear'));
ipcMain.on('kapsul:peek-action', (_event, id, action) => peekAction(String(id), String(action)));
ipcMain.on('kapsul:peek-click', (_event, id) => {
  if (currentPeek?.id !== id) return;
  if (currentPeek.kind === 'notification') peekAction(id, 'open');
  else if (!currentPeek.sticky) endPeek();
});
ipcMain.on('kapsul:focus', (_event, action) => focusCommand(String(action)));
ipcMain.on('kapsul:battery', (_event, state) => {
  if (state && typeof state.level === 'number') onBattery({ level: state.level, charging: Boolean(state.charging) });
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
ipcMain.on('kapsul:drag-move', (_event, dx, dy) => dragMove(Number(dx), Number(dy)));
ipcMain.on('kapsul:drag-end', () => dragEnd());
ipcMain.on('kapsul:settings', () => openSettings());
ipcMain.on('kapsul:ready', (event) => {
  event.sender.send('kapsul:state', publicState());
  event.sender.send('kapsul:media', lastMedia);
  sendNotifications();
  sendReminders();
  sendClaude();
  event.sender.send('kapsul:focus', focus.state);
  event.sender.send('kapsul:clips', clips.list());
  event.sender.send('kapsul:dev', devState);
  event.sender.send('kapsul:weather', weatherState);
  event.sender.send('kapsul:costume', costumeState);
  event.sender.send('kapsul:todos', config.todos);
  if (currentPeek) event.sender.send('kapsul:peek', currentPeek);
});

// ---------- Lifecycle ----------

app.on('second-instance', () => setExpanded(true, { focus: true }));

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  app.setAppUserModelId('local.kapsul');
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
  devTimers = [
    setInterval(pollServices, 30_000),
    setInterval(pollGit, 20_000),
    setInterval(pollWeather, 30 * 60_000),
    setInterval(updateCostume, 10 * 60_000),
  ];
  pollWeather();
  pollServices();
  pollGit();

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
