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
  stats: { summary: true, time: '20:00' },
  wellness: { eyes: true, eyesMinutes: 20, water: true, waterMinutes: 60 },
  chat: { enabled: true, model: 'claude-opus-5', apiKeyEnc: '' },
  // feeds: [{ id, name, urlEnc (alamat .ics terenkripsi), host }]
  calendar: { enabled: true, remindMinutes: 10, feeds: [] },
  ocr: { shortcut: 'Control+Alt+O' },
  system: { internetAlerts: true, resourceAlerts: true },
  habits: [],
  weather: { enabled: false, alerts: true, city: null },
  battery: { alerts: true, showPercent: true },
  bluetooth: { alerts: true },
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
    buddy: { ...DEFAULTS.buddy, ...(raw.buddy ?? {}) },
    weather: { ...DEFAULTS.weather, ...(raw.weather ?? {}) },
    ticker: { ...DEFAULTS.ticker, ...(raw.ticker ?? {}) },
    lyrics: { ...DEFAULTS.lyrics, ...(raw.lyrics ?? {}) },
    stats: { ...DEFAULTS.stats, ...(raw.stats ?? {}) },
    wellness: { ...DEFAULTS.wellness, ...(raw.wellness ?? {}) },
    chat: { ...DEFAULTS.chat, ...(raw.chat ?? {}) },
    calendar: {
      ...DEFAULTS.calendar,
      ...(raw.calendar ?? {}),
      feeds: Array.isArray(raw.calendar?.feeds) ? raw.calendar.feeds.filter((f) => f && f.id && f.urlEnc) : [],
    },
    ocr: { ...DEFAULTS.ocr, ...(raw.ocr ?? {}) },
    system: { ...DEFAULTS.system, ...(raw.system ?? {}) },
    habits: Array.isArray(raw.habits) ? raw.habits.map(normalizeHabit).filter((h) => h.id && h.name) : [],
    battery: { ...DEFAULTS.battery, ...(raw.battery ?? {}) },
    bluetooth: { ...DEFAULTS.bluetooth, ...(raw.bluetooth ?? {}) },
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
