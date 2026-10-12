'use strict';

// Pengurai perintah suara (bahasa Indonesia, sebagian Inggris) → aksi.
// Murni teks: tidak menjalankan apa-apa, jadi mudah diuji.

const NUMBER_WORDS = {
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10,
  sebelas: 11, 'dua belas': 12, 'lima belas': 15, 'dua puluh': 20, 'tiga puluh': 30, 'empat puluh lima': 45, sejam: 1,
};

function normalize(text) {
  let t = ` ${String(text).toLowerCase()} `
    .replace(/[“”"!?,;]/g, ' ')
    .replace(/(\d)[.:](\d{2})/g, '$1:$2') // 17.30 → 17:30
    .replace(/\.(?!\d)/g, ' ');
  // Kata bilangan → angka (yang panjang dulu).
  for (const [word, n] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, 'g'), String(n));
  }
  return t
    .replace(/\b(hei|hey|hai|halo|oke|ok)\s+zeno\b/g, ' ')
    .replace(/\bzeno\b/g, ' ')
    .replace(/\b(tolong|dong|ya|deh|please|coba)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cocokkan nama aplikasi: sama persis > diawali > mengandung > beda ≤ 2 huruf.
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function matchApp(query, apps) {
  const q = squash(query);
  if (!q) return null;
  let best = null;
  for (const app of apps) {
    const name = squash(app.name);
    let score = null;
    if (name === q) score = 0;
    else if (name.startsWith(q) || q.startsWith(name)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (distance(name, q) <= Math.max(1, Math.floor(q.length / 4))) score = 3;
    if (score !== null && (!best || score < best.score || (score === best.score && app.priority < best.app.priority))) {
      best = { app, score };
    }
  }
  return best?.app ?? null;
}

// ---------- Waktu untuk pengingat ----------

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Ambil frasa waktu dari teks: "jam 5 sore", "pukul 17:30", "10 menit lagi", "besok jam 8".
function parseWhen(text, now = new Date()) {
  let rest = text;
  let when = null;

  const relative = rest.match(/\b(\d+)\s*(menit|jam)\s*(lagi|kemudian|dari sekarang)\b/);
  if (relative) {
    const ms = Number(relative[1]) * (relative[2] === 'menit' ? 60_000 : 3_600_000);
    when = new Date(now.getTime() + ms);
    rest = rest.replace(relative[0], ' ');
    return { when, rest };
  }

  const tomorrow = /\bbesok\b/.test(rest);
  rest = rest.replace(/\bbesok\b/, ' ');
  const clock = rest.match(/\b(?:jam|pukul)\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?\b/);
  if (!clock) return { when: null, rest: text };
  rest = rest.replace(clock[0], ' ');

  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  const part = clock[3];
  if (hour > 23 || minute > 59) return { when: null, rest: text };

  if (part === 'siang' && hour < 11) hour += 12;
  if ((part === 'sore' || part === 'malam') && hour < 12) hour += 12;

  const base = new Date(now);
  if (tomorrow) base.setDate(base.getDate() + 1);
  const at = (h) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, minute);

  if (part || hour >= 13 || tomorrow) {
    when = at(hour);
    if (!tomorrow && when <= now) when.setDate(when.getDate() + 1);
  } else {
    // "jam 5" tanpa keterangan: kejadian terdekat di masa depan (05.00 atau 17.00).
    const options = [at(hour), at(hour + 12)].filter((d) => d > now);
    when = options[0] ?? new Date(at(hour).getTime() + 86_400_000);
  }
  return { when, rest };
}

function cleanTitle(text) {
  return text
    .replace(/\b(aku|saya|gue|gw|aku untuk|untuk|buat|soal|tentang|kalau|kalo|bahwa|supaya|agar|harus|mau)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Perintah ----------

function parse(rawText, { apps = [], now = new Date() } = {}) {
  const text = normalize(rawText);
  // "Halo Zeno" tinggal kosong setelah nama Zeno dibuang: tetap sapaan.
  if (!text) return /\b(halo|hai|hi|hei|hey|hello)\b/.test(String(rawText).toLowerCase()) ? { action: 'greet' } : { action: 'empty' };

  // Musik (sebelum "buka" supaya "putar lagu" tidak dianggap aplikasi).
  if (/\b(lagu|musik)?\s*(berikutnya|selanjutnya|next|skip)\b|\bganti lagu\b/.test(text)) return { action: 'media', command: 'next' };
  if (/\b(lagu|musik)\s*(sebelumnya|tadi)\b|\bprevious\b/.test(text)) return { action: 'media', command: 'prev' };
  if (/\b(jeda|pause|stop|hentikan|matikan|berhenti)\b.*\b(musik|lagu|spotify)\b|^(jeda|pause)$/.test(text)) {
    return { action: 'media', command: 'pause' };
  }
  if (/\b(putar|play|lanjutkan|nyalakan|setel|puter)\b.*\b(musik|lagu)\b|^(putar|play|lanjutkan)$/.test(text)) {
    return { action: 'media', command: 'play' };
  }

  // Daya (setelah musik, supaya "matikan musik" tetap jeda lagu)
  if (/\b(restart|reboot|mulai ulang|nyalakan ulang|restart laptop|restart komputer)\b/.test(text)) return { action: 'power', command: 'restart' };
  if (/\b(matikan|shutdown|shut down|matiin)\b\s*(laptop|komputer|pc|windows)\b|^(shutdown|shut down)$/.test(text)) return { action: 'power', command: 'shutdown' };
  if (/\b(kunci|lock)\b\s*(layar|laptop|komputer|pc|screen)?$/.test(text)) return { action: 'power', command: 'lock' };
  if (/\b(tidurkan|sleep)\b\s*(laptop|komputer|pc)?$|\bmode tidur\b/.test(text)) return { action: 'power', command: 'sleep' };
  if (/\b(keluar akun|sign out|log ?out)\b/.test(text)) return { action: 'power', command: 'signout' };

  // Fokus
  if (/\b(mulai|start|ayo)\b.*\bfokus\b|\bfokus sekarang\b/.test(text)) return { action: 'focus', command: 'focus' };
  if (/\b(jeda)\b.*\bfokus\b/.test(text)) return { action: 'focus', command: 'pause' };
  if (/\b(berhenti|stop|selesai|akhiri)\b.*\bfokus\b/.test(text)) return { action: 'focus', command: 'stop' };

  // Timer
  if (/\b(batalkan|batalin|hapus|stop|hentikan|matikan)\b.*\btimer\b/.test(text)) return { action: 'timer-cancel' };
  const timer = text.match(/^(?:timer|setel timer|pasang timer|set timer|hitung mundur)\s+(.+)$/);
  if (timer) return { action: 'timer', text: timer[1] };

  // Hitungan: "berapa 250 ribu kali 12", "hitung 15 persen dari 200 ribu"
  const math = text.match(/^(?:berapa|hitung|hitungkan)\s+(.+)$/);
  if (math) {
    const expr = math[1]
      .replace(/(\d+)\s*persen\s*dari\s*(\d+(?:\s*(?:ribu|juta|miliar))?)/g, '$2*$1%')
      .replace(/(\d+(?:[.,]\d+)?)\s*ribu/g, '($1*1000)')
      .replace(/(\d+(?:[.,]\d+)?)\s*juta/g, '($1*1000000)')
      .replace(/(\d+(?:[.,]\d+)?)\s*miliar/g, '($1*1000000000)')
      .replace(/\b(kali|dikali)\b/g, '*')
      .replace(/\b(bagi|dibagi)\b/g, '/')
      .replace(/\b(tambah|ditambah|plus)\b/g, '+')
      .replace(/\b(kurang|dikurangi|minus)\b/g, '-')
      .replace(/\bpersen\b/g, '%')
      .replace(/\b(sama dengan|hasilnya)\b/g, '');
    if (/\d/.test(expr) && /[+\-*/%]/.test(expr)) return { action: 'calc', text: expr };
  }

  // Pengingat
  const remind = text.match(/^(?:ingatkan|ingetin|ingatin|reminder|set pengingat|buat pengingat)\b(.*)$/);
  if (remind) {
    const { when, rest } = parseWhen(remind[1], now);
    const title = cleanTitle(rest) || 'Pengingat';
    if (!when) return { action: 'reminder-missing-time', title };
    return { action: 'reminder', title: title.charAt(0).toUpperCase() + title.slice(1), date: isoDate(when), time: `${pad(when.getHours())}:${pad(when.getMinutes())}`, when };
  }

  // Catatan / tugas
  const note = text.match(/^(?:catat|tulis|tambah(?:kan)?\s+(?:tugas|catatan|todo)|catatan)\s+(.+)$/);
  if (note) return { action: 'todo', text: note[1].charAt(0).toUpperCase() + note[1].slice(1) };

  // Peliharaan
  if (/\b(beri|kasih|kasi)\b.*\bmakan\b|^(ayo )?makan( dulu)?$/.test(text)) return { action: 'feed' };
  if (/^(main|ayo main|main yuk|ajak main)\b/.test(text)) return { action: 'play' };

  // Ringkasan hari ini
  if (/\b(statistik|ringkasan|rekap)\b|\bngapain aja\b/.test(text)) return { action: 'stats' };

  // Pertanyaan
  if (/\b(jam berapa|pukul berapa|waktu sekarang|sekarang jam)\b/.test(text)) return { action: 'time' };
  if (/\b(tanggal berapa|hari apa|hari ini tanggal|tanggal hari ini)\b/.test(text)) return { action: 'date' };
  if (/\b(cuaca|hujan|panas|gerah)\b/.test(text)) return { action: 'weather' };

  // Buka aplikasi / pengaturan
  const open = text.match(/^(?:buka|bukain|bukakan|open|jalankan|jalanin|launch|start|nyalakan)\s+(?:aplikasi\s+)?(.+)$/);
  if (open) {
    const target = open[1].trim();
    if (/^(pengaturan|setting|settings|setelan)( kapsul| zenopod)?$/.test(target)) return { action: 'settings' };
    const app = matchApp(target, apps);
    return app ? { action: 'open', app, query: target } : { action: 'open-missing', query: target };
  }

  if (/^(halo|hai|hi|hello|selamat (pagi|siang|sore|malam)|assalamualaikum|apa kabar)\b/.test(text)) return { action: 'greet' };

  return { action: 'unknown', text };
}

module.exports = { parse, normalize, parseWhen, matchApp };
