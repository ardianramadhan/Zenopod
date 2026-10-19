'use strict';

// Aksi yang boleh dijalankan Zeno dari obrolan (tool calling). Definisi di sini netral (JSON Schema
// sederhana, tanpa fitur yang tidak didukung Gemini); lib/chat.js & lib/chat-providers.js
// mengubahnya ke format Claude / OpenAI / Gemini. Yang menjalankan aksinya: main.js (runZenoTool).

const TOOLS = [
  {
    name: 'set_reminder',
    description: 'Buat pengingat yang muncul di island pada waktu tertentu. Pakai waktu lokal pengguna.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Isi pengingat, singkat. Contoh: "Rapat tim".' },
        date: { type: 'string', description: 'Tanggal, format YYYY-MM-DD.' },
        time: { type: 'string', description: 'Jam 24 jam, format HH:MM.' },
        repeat: { type: 'string', enum: ['none', 'daily', 'weekdays'], description: 'Ulangi: none (sekali), daily (setiap hari), weekdays (hari kerja).' },
        note: { type: 'string', description: 'Catatan tambahan (opsional).' },
      },
      required: ['title', 'date', 'time'],
    },
  },
  {
    name: 'start_timer',
    description: 'Mulai timer hitung mundur yang tampil di island dan berbunyi saat selesai.',
    parameters: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'Lama timer dalam menit (boleh pecahan, mis. 0.5 = 30 detik).' },
        label: { type: 'string', description: 'Nama timer (opsional). Contoh: "Rebus mi".' },
      },
      required: ['minutes'],
    },
  },
  {
    name: 'focus',
    description: 'Atur sesi fokus Pomodoro: mulai (opsional dengan lama menit), jeda, atau hentikan.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'pause', 'stop'] },
        minutes: { type: 'number', description: 'Lama fokus dalam menit (hanya untuk start, opsional).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'open_app',
    description: 'Buka aplikasi yang terpasang di komputer pengguna berdasarkan namanya.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nama aplikasi. Contoh: "Spotify", "VS Code".' } },
      required: ['name'],
    },
  },
  {
    name: 'media_control',
    description: 'Kendalikan musik/video yang sedang diputar (Spotify, browser, dll.).',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'prev'] } },
      required: ['action'],
    },
  },
  {
    name: 'add_todo',
    description: 'Tambahkan satu tugas ke daftar tugas pengguna. Panggil sekali per tugas.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Isi tugas, singkat.' } },
      required: ['text'],
    },
  },
  {
    name: 'get_schedule',
    description: 'Baca jadwal kalender pengguna, pengingat yang akan datang, dan daftar tugas yang belum selesai.',
    parameters: {
      type: 'object',
      properties: { day: { type: 'string', enum: ['today', 'tomorrow'] } },
      required: ['day'],
    },
  },
];

const MAX_ROUNDS = 4; // maksimal putaran aksi per pertanyaan

// Jalankan satu aksi dengan aman; catat chip-nya untuk kotak chat.
async function callTool(runTool, name, args, actions) {
  let outcome;
  try {
    outcome = await runTool(String(name), args && typeof args === 'object' ? args : {});
  } catch (error) {
    outcome = { ok: false, label: 'Gagal menjalankan aksi', result: { error: String(error?.message ?? error) } };
  }
  outcome = outcome ?? { ok: false, label: 'Aksi tidak dikenal', result: { error: 'unknown tool' } };
  // get_schedule hanya membaca: tidak perlu chip.
  if (outcome.label) actions.push({ name: String(name), label: String(outcome.label), ok: Boolean(outcome.ok) });
  return { ok: Boolean(outcome.ok), ...(outcome.result ?? {}) };
}

// Teks pengganti kalau model hanya beraksi tanpa menulis jawaban.
function actionsText(actions) {
  if (!actions.length) return '';
  return actions.every((a) => a.ok) ? 'Beres!' : 'Ada yang gagal, coba cek lagi ya.';
}

function toolPrompt(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const day = new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(now);
  return [
    `Sekarang ${day}, ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} jam ${pad(now.getHours())}:${pad(now.getMinutes())} (waktu lokal pengguna).`,
    'Kamu bisa menjalankan aksi di komputer pengguna lewat tool: pengingat, timer, fokus, membuka aplikasi, mengatur musik, menambah tugas, dan membaca jadwal.',
    'Jalankan aksi hanya kalau pengguna memintanya (atau jelas menginginkannya); kalau waktunya tidak jelas, tanya dulu.',
    'Setelah beraksi, konfirmasi singkat dalam satu kalimat apa yang sudah kamu lakukan.',
  ].join(' ');
}

module.exports = { TOOLS, MAX_ROUNDS, callTool, actionsText, toolPrompt };
