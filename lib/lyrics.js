'use strict';

// Lirik lagu dari LRCLIB (lrclib.net): gratis, tanpa API key, banyak yang tersinkron (format LRC).
// Spotify tidak membagikan liriknya ke aplikasi lain, jadi dicari dari judul + artis + durasi.

const API = 'https://lrclib.net/api';
const HEADERS = { 'User-Agent': 'Zenopod (https://github.com/ardianramadhan/Zenopod)' };

// "[01:23.45] baris" → [{ t: 83450, text: 'baris' }]; satu baris bisa punya beberapa waktu.
function parseLrc(text) {
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const words = raw.slice(stamps.at(-1).index + stamps.at(-1)[0].length).trim();
    for (const [, min, sec, frac = '0'] of stamps) {
      lines.push({ t: Number(min) * 60_000 + Number(sec) * 1000 + Number(frac.padEnd(3, '0')), text: words });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

// Indeks baris yang sedang dinyanyikan pada posisi `ms` (-1 = sebelum baris pertama).
function lineAt(lines, ms) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// Judul dari Spotify sering berekor: "Lagu - Remastered 2011", "Lagu (feat. X)", "Lagu - Live".
function cleanTitle(title) {
  return String(title ?? '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([](feat\.?|ft\.?|with|from|remaster|live|versi|version)[^)\]]*[)\]]/gi, '')
    .trim();
}

// Artis pertama saja: "Tulus, Gita" / "Tulus & Gita" / "Tulus feat. Gita" → "Tulus".
const firstArtist = (artist) => String(artist ?? '').split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i)[0].trim();

// Hasil pencarian terbaik: yang tersinkron, durasinya paling dekat dengan lagu yang diputar.
function pickBest(results, durationMs) {
  const usable = (results ?? []).filter((r) => r && (r.syncedLyrics || r.plainLyrics || r.instrumental));
  const off = (r) => (durationMs && r.duration ? Math.abs(r.duration * 1000 - durationMs) : 0);
  // Durasi beda jauh = kemungkinan versi lain (live, remix, potongan).
  const close = durationMs ? usable.filter((r) => !r.duration || off(r) < 8000) : usable;
  return close.sort((a, b) => Boolean(b.syncedLyrics) - Boolean(a.syncedLyrics) || off(a) - off(b))[0] ?? null;
}

// Bentuk yang dikirim ke tampilan: { synced, lines: [{ t, text }] } atau { instrumental } atau null.
function toLyrics(record) {
  if (!record) return null;
  if (record.instrumental) return { instrumental: true, synced: false, lines: [] };
  const synced = parseLrc(record.syncedLyrics);
  if (synced.length) return { synced: true, lines: synced };
  const plain = String(record.plainLyrics ?? '')
    .split(/\r?\n/)
    .map((text) => ({ t: 0, text: text.trim() }));
  return plain.some((l) => l.text) ? { synced: false, lines: plain } : null;
}

async function request(endpoint, params) {
  const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

const cache = new Map();

// { title, artist, duration (ms, boleh kosong) } → lirik atau null (tidak ditemukan).
// Gagal jaringan dilempar (tidak disimpan di cache, supaya dicoba lagi di lagu berikutnya).
async function find({ title, artist, duration }) {
  const key = `${artist}\n${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const track = cleanTitle(title) || title;
  const singer = firstArtist(artist) || artist;
  let record = null;
  if (singer) {
    const exact = { track_name: track, artist_name: singer };
    if (duration) exact.duration = Math.round(duration / 1000);
    record = await request('get', exact);
  }
  if (!record?.syncedLyrics) {
    const results = await request('search', singer ? { track_name: track, artist_name: singer } : { q: track });
    record = pickBest(results, duration) ?? record;
  }

  const lyrics = toLyrics(record);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, lyrics);
  return lyrics;
}

module.exports = { parseLrc, lineAt, cleanTitle, firstArtist, pickBest, toLyrics, find };
