'use strict';

// Statistik harian & peliharaan Zeno. Disimpan di stats.json (folder data pengguna), 30 hari terakhir.
//
// Hari: { claudeMs, focus, focusMs, todos, reminders, water, eyes, apps, voice, feeds, habits, songs: { "Judul · Artis": ms } }
// Zeno: { hunger 0–100, xp, level, updatedAt }  — lapar turun ±12,5/jam selama Zenopod menyala.

const fs = require('node:fs');
const path = require('node:path');

const KEEP_DAYS = 30;
const HUNGER_PER_HOUR = 12.5;
const XP = { focus: 20, habits: 10, todos: 5, reminders: 3, water: 2, eyes: 2, feeds: 1 };

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const emptyDay = () => ({ claudeMs: 0, focus: 0, focusMs: 0, todos: 0, reminders: 0, water: 0, eyes: 0, apps: 0, voice: 0, feeds: 0, habits: 0, songs: {} });
const xpForLevel = (level) => 100 * level; // XP yang dibutuhkan untuk naik dari level ini

class Stats {
  constructor(file, { onLevelUp = () => {} } = {}) {
    this.file = file;
    this.onLevelUp = onLevelUp;
    // habits: riwayat centang kebiasaan { id: ['2026-10-13', …] } (lihat lib/habits.js)
    this.data = { days: {}, habits: {}, pet: { hunger: 80, xp: 0, level: 1, updatedAt: Date.now() } };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...saved, days: saved.days ?? {}, habits: saved.habits ?? {}, pet: { ...this.data.pet, ...(saved.pet ?? {}) } };
    } catch {
      // file belum ada
    }
    this.saveTimer = null;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const keep = Object.keys(this.data.days).sort().slice(-KEEP_DAYS);
      this.data.days = Object.fromEntries(keep.map((k) => [k, this.data.days[k]]));
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    }, 2000);
  }

  day(key = dayKey()) {
    this.data.days[key] = { ...emptyDay(), ...(this.data.days[key] ?? {}) };
    return this.data.days[key];
  }

  // Tambah hitungan (fokus, tugas, …) dan XP Zeno kalau ada.
  add(field, amount = 1) {
    const d = this.day();
    d[field] = (d[field] ?? 0) + amount;
    if (XP[field]) this.gainXp(XP[field] * amount);
    this.save();
  }

  song(name, ms) {
    if (!name) return;
    const d = this.day();
    d.songs[name] = (d.songs[name] ?? 0) + ms;
    this.save();
  }

  topSong(key = dayKey()) {
    const songs = Object.entries(this.day(key).songs);
    return songs.sort((a, b) => b[1] - a[1])[0] ?? null;
  }

  // 7 hari terakhir (lama → baru), untuk Pengaturan › Statistik.
  week() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      out.push({ key, ...emptyDay(), ...(this.data.days[key] ?? {}), top: this.topSong(key) });
    }
    return out;
  }

  // ---------- Zeno peliharaan ----------

  pet() {
    const p = this.data.pet;
    const now = Date.now();
    const hours = Math.max(0, (now - p.updatedAt) / 3_600_000);
    // Lapar hanya turun saat Zenopod menyala (lompatan > 2 jam = laptop mati/tidur, tidak dihitung).
    if (hours < 2) p.hunger = Math.max(0, p.hunger - hours * HUNGER_PER_HOUR);
    p.updatedAt = now;
    return { ...p, needed: xpForLevel(p.level) };
  }

  feed(amount = 30) {
    const p = this.data.pet;
    this.pet();
    p.hunger = Math.min(100, p.hunger + amount);
    this.add('feeds');
    this.save();
    return this.pet();
  }

  gainXp(amount) {
    const p = this.data.pet;
    p.xp += amount;
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level += 1;
      this.onLevelUp(p.level);
    }
    this.save();
  }
}

// "2 j 15 m" / "45 m" / "< 1 m"
function duration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '< 1 m';
  const h = Math.floor(minutes / 60);
  return h ? `${h} j ${minutes % 60} m` : `${minutes} m`;
}

module.exports = { Stats, duration, dayKey };
