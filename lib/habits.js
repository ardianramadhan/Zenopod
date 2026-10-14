'use strict';

// Kebiasaan harian (streak). Daftar kebiasaan ada di config.habits:
//   { id, name, emoji, days: [0–6] (0 = Minggu), remind: 'HH:MM' | '' }
// Riwayat centang ada di stats.json (log: { idKebiasaan: ['2026-10-13', …] }).
// Hari yang tidak dijadwalkan tidak memutus streak.

const { dayKey } = require('./stats');

const MAX_LOG = 400; // hari tercatat per kebiasaan
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function normalizeHabit(raw) {
  const days = Array.isArray(raw?.days) ? [...new Set(raw.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : ALL_DAYS;
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? '').trim().slice(0, 40),
    emoji: String(raw?.emoji ?? '').trim().slice(0, 4) || '✅',
    days: days.length ? days : ALL_DAYS,
    remind: /^\d{2}:\d{2}$/.test(raw?.remind ?? '') ? raw.remind : '',
  };
}

const scheduledOn = (habit, date) => habit.days.includes(date.getDay());

// Streak berjalan: hari terjadwal berturut-turut yang dicentang, mundur dari hari ini.
// Hari ini belum dicentang = belum putus (masih bisa dikerjakan).
function streak(habit, done, now = new Date()) {
  let count = 0;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < MAX_LOG; i++, day.setDate(day.getDate() - 1)) {
    if (!scheduledOn(habit, day)) continue;
    if (done.has(dayKey(day))) count++;
    else if (i > 0) break;
  }
  return count;
}

// Untuk panel & kapsul: kebiasaan beserta status hari ini.
function today(habits, log, now = new Date()) {
  const key = dayKey(now);
  return habits.map((habit) => {
    const done = new Set(log[habit.id] ?? []);
    return { ...habit, scheduled: scheduledOn(habit, now), done: done.has(key), streak: streak(habit, done, now) };
  });
}

// Centang / batal centang hari ini. Mengembalikan log baru.
function setDone(log, id, done, now = new Date()) {
  const key = dayKey(now);
  const list = new Set(log[id] ?? []);
  if (done) list.add(key);
  else list.delete(key);
  return { ...log, [id]: [...list].sort().slice(-MAX_LOG) };
}

// "Hari kerja", "Setiap hari", "Sen, Rab, Jum"
const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
function daysLabel(days) {
  const set = days.join(',');
  if (set === '0,1,2,3,4,5,6') return 'Setiap hari';
  if (set === '1,2,3,4,5') return 'Hari kerja';
  if (set === '0,6') return 'Akhir pekan';
  return [...days.filter((d) => d > 0), ...days.filter((d) => d === 0)].map((d) => DAY_NAMES[d]).join(', ');
}

// Cocokkan ucapan ("sudah olahraga") ke nama kebiasaan.
function findByText(habits, text) {
  const clean = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const said = clean(text);
  if (!said) return null;
  return (
    habits.find((h) => clean(h.name) === said) ??
    habits.find((h) => said.includes(clean(h.name)) || clean(h.name).includes(said)) ??
    habits.find((h) => clean(h.name).split(' ').some((w) => w.length > 3 && said.split(' ').includes(w))) ??
    null
  );
}

module.exports = { normalizeHabit, scheduledOn, streak, today, setDone, daysLabel, findByText, ALL_DAYS };
