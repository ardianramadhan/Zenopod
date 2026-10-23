'use strict';

// Pengaturan Zenopod disimpan di config.json (diubah lewat jendela Pengaturan).

const fs = require('node:fs');
const path = require('node:path');

const { configFile: CONFIG_FILE } = require('./paths');
const { normalizeHabit } = require('./habits');

const DEFAULTS = {
  user: { name: '', birthday: '' },
  costume: 'auto',
  ticker: { enabled: true, seconds: 5 },
  // Lirik lagu dari lrclib.net (judul + artis lagu yang diputar dikirim ke sana).
  lyrics: { enabled: true },
  // Mode jam ("bengong"): kursor diam selama `seconds` detik → Zeno tidur, kapsul menampilkan jam.
  clockMode: { enabled: true, seconds: 30 },
  // weekly: ringkasan minggu lalu (waktu layar, fokus, musik) tiap Senin.
  stats: { summary: true, time: '20:00', weekly: true },
  // waterMl = sekali minum (ml), waterTargetMl = target harian (ml)
  wellness: { eyes: true, eyesMinutes: 20, water: true, waterMinutes: 60, waterMl: 250, waterTargetMl: 2000 },
  // provider: anthropic | openai | gemini; tiap penyedia punya key (terenkripsi) & model sendiri.
  chat: {
    enabled: true,
    // Zeno boleh menjalankan aksi dari obrolan (pengingat, timer, fokus, buka aplikasi, musik, tugas).
    actions: true,
    provider: 'anthropic',
    model: 'claude-opus-5',
    apiKeyEnc: '',
    openaiModel: 'gpt-5-mini',
    openaiKeyEnc: '',
    geminiModel: 'gemini-flash-latest',
    geminiKeyEnc: '',
  },
  // feeds: [{ id, name, urlEnc (alamat .ics terenkripsi), host }]
  calendar: { enabled: true, remindMinutes: 10, feeds: [] },
  ocr: { shortcut: 'Control+Alt+O' },
  system: { internetAlerts: true, resourceAlerts: true },
  habits: [],
  weather: { enabled: false, alerts: true, city: null },
  // showPercent mati: kapsul tetap bersih, ikon baterai hanya muncul saat lemah.
  battery: { alerts: true, showPercent: false },
  // 2 = kapsul sederhana (0.4.1): persentase baterai dimatikan sekali untuk config lama.
  pillVersion: 2,
  bluetooth: { alerts: true },
  // Aktivitas live di island: titik privasi mic/kamera, rapat (durasi + bisukan mic), unduhan.
  live: { privacy: true, meetings: true, downloads: true },
  usb: { alerts: true },
  voice: { enabled: true, shortcut: 'Control+Alt+Z', speak: true, voiceId: '', rate: 1, pitch: 1.25 },
  buddy: { name: '' },
  shortcut: 'Control+Alt+K',
  // Gaya kapsul: 'auto' = menempel ke tepi atas seperti notch macOS (jadi pill kalau digeser
  // ke bawah), 'pill' = selalu melayang.
  island: 'auto',
  position: 'top-right',
  offsetX: 160,
  greetings: true,
  notifications: { peek: true, peekSeconds: 6, ignore: [], seen: [] },
  claude: { peek: true, permissions: true },
  focus: { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cycles: 4, autoStartBreak: true, muteNotifications: true },
  clipboard: { enabled: true, max: 20 },
  sound: { enabled: true, volume: 0.6, notifications: true, claude: true, reminders: true, buddy: true, dev: true, weather: true },
  dev: { alerts: true, services: [], projects: [] },
  reminders: [],
  todos: [],
  // Wallpaper dari island: current = id file di koleksi, original = wallpaper sebelum diganti Zenopod
  // slideshow = menit antar ganti (0 = mati), shuffle = urutan acak, changedAt = terakhir diganti
  wallpaper: { current: null, original: null, slideshow: 0, shuffle: false, changedAt: 0 },
  apps: [],
};

// Jarak bawaan dari tepi per posisi. Kanan menghindari tombol tutup/maksimalkan jendela.
const DEFAULT_OFFSET = { 'top-left': 12, 'top-center': 0, 'top-right': 160 };

function normalize(raw) {
  return {
    ...DEFAULTS,
    ...raw,
    island: raw.island === 'pill' ? 'pill' : 'auto',
    user: { ...DEFAULTS.user, ...(raw.user ?? {}) },
    buddy: { name: typeof raw.buddy?.name === 'string' ? raw.buddy.name : DEFAULTS.buddy.name },
    weather: { ...DEFAULTS.weather, ...(raw.weather ?? {}) },
    ticker: { ...DEFAULTS.ticker, ...(raw.ticker ?? {}) },
    lyrics: { ...DEFAULTS.lyrics, ...(raw.lyrics ?? {}) },
    clockMode: { ...DEFAULTS.clockMode, ...(raw.clockMode ?? {}) },
    stats: { ...DEFAULTS.stats, ...(raw.stats ?? {}) },
    wellness: (() => {
      const w = { ...DEFAULTS.wellness, ...(raw.wellness ?? {}) };
      const clamp = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
      return { ...w, waterMl: clamp(w.waterMl, 50, 2000, 250), waterTargetMl: clamp(w.waterTargetMl, 500, 6000, 2000) };
    })(),
    chat: {
      ...DEFAULTS.chat,
      ...(raw.chat ?? {}),
      provider: ['anthropic', 'openai', 'gemini'].includes(raw.chat?.provider) ? raw.chat.provider : 'anthropic',
      // Bawaan lama yang sudah tidak tersedia untuk pengguna baru → alias terbaru.
      ...(raw.chat?.geminiModel === 'gemini-2.5-flash' ? { geminiModel: 'gemini-flash-latest' } : {}),
    },
    calendar: {
      ...DEFAULTS.calendar,
      ...(raw.calendar ?? {}),
      feeds: Array.isArray(raw.calendar?.feeds) ? raw.calendar.feeds.filter((f) => f && f.id && f.urlEnc) : [],
    },
    ocr: { ...DEFAULTS.ocr, ...(raw.ocr ?? {}) },
    system: { ...DEFAULTS.system, ...(raw.system ?? {}) },
    habits: Array.isArray(raw.habits) ? raw.habits.map(normalizeHabit).filter((h) => h.id && h.name) : [],
    battery: { ...DEFAULTS.battery, ...(raw.battery ?? {}), ...((raw.pillVersion ?? 1) < 2 ? { showPercent: false } : {}) },
    pillVersion: 2,
    bluetooth: { ...DEFAULTS.bluetooth, ...(raw.bluetooth ?? {}) },
    live: { ...DEFAULTS.live, ...(raw.live ?? {}) },
    usb: { ...DEFAULTS.usb, ...(raw.usb ?? {}) },
    voice: { ...DEFAULTS.voice, ...(raw.voice ?? {}) },
    notifications: { ...DEFAULTS.notifications, ...(raw.notifications ?? {}) },
    claude: { ...DEFAULTS.claude, ...(raw.claude ?? {}) },
    focus: { ...DEFAULTS.focus, ...(raw.focus ?? {}) },
    clipboard: { ...DEFAULTS.clipboard, ...(raw.clipboard ?? {}) },
    sound: { ...DEFAULTS.sound, ...(raw.sound ?? {}) },
    dev: {
      ...DEFAULTS.dev,
      ...(raw.dev ?? {}),
      services: Array.isArray(raw.dev?.services) ? raw.dev.services : [],
      projects: Array.isArray(raw.dev?.projects) ? raw.dev.projects : [],
    },
    reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    wallpaper: {
      current: typeof raw.wallpaper?.current === 'string' ? raw.wallpaper.current : null,
      original: typeof raw.wallpaper?.original === 'string' ? raw.wallpaper.original : null,
      slideshow: [0, 5, 15, 30, 60, 180, 1440].includes(Number(raw.wallpaper?.slideshow)) ? Number(raw.wallpaper.slideshow) : 0,
      shuffle: raw.wallpaper?.shuffle === true,
      changedAt: Number(raw.wallpaper?.changedAt) || 0,
    },
    apps: Array.isArray(raw.apps) ? raw.apps.filter((item) => item && item.name) : [],
  };
}

function readConfig(fallback = DEFAULTS) {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('config.json tidak bisa dibaca:', error.message);
    return fallback;
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

module.exports = { CONFIG_FILE, DEFAULTS, DEFAULT_OFFSET, normalize, readConfig, writeConfig };
