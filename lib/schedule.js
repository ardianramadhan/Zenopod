'use strict';

// Sapaan menurut waktu & penghitungan jadwal pengingat (waktu lokal laptop).

// Pagi 04.00–10.59, siang 11.00–14.59, sore 15.00–17.59, malam 18.00–03.59.
function period(date = new Date()) {
  const h = date.getHours();
  if (h >= 4 && h < 11) return 'pagi';
  if (h >= 11 && h < 15) return 'siang';
  if (h >= 15 && h < 18) return 'sore';
  return 'malam';
}

const LINES = {
  pagi: ['Semangat memulai hari!', 'Sudah sarapan belum?', 'Hari baru, cerita baru.'],
  siang: ['Jangan lupa makan siang ya.', 'Istirahat sebentar juga penting.', 'Tetap semangat sampai sore!'],
  sore: ['Sedikit lagi, kerjaan hampir beres.', 'Jangan lupa minum air.', 'Sore yang pas buat menuntaskan tugas.'],
  malam: ['Jangan begadang terlalu larut ya.', 'Waktunya santai sejenak.', 'Terima kasih sudah kerja keras hari ini.'],
};

function greeting(userName, date = new Date()) {
  const p = period(date);
  const lines = LINES[p];
  return {
    period: p,
    title: `Selamat ${p}${userName ? `, ${userName}` : ''}!`,
    body: lines[Math.floor(Math.random() * lines.length)],
  };
}

// ---------- Pengingat ----------
// { id, title, date: 'YYYY-MM-DD', time: 'HH:mm', repeat: 'none'|'daily'|'weekdays',
//   next: epoch ms kejadian berikutnya, firedFor: epoch ms kejadian yang sudah ditampilkan, done }

function at(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

const isWeekday = (date) => date.getDay() !== 0 && date.getDay() !== 6;

// Kejadian pertama pada/sesudah `from` (untuk 'none' selalu tanggal & jam yang diisi).
function nextOccurrence(reminder, from = Date.now()) {
  const start = at(reminder.date, reminder.time);
  if (reminder.repeat === 'none' || !reminder.repeat) return start.getTime();

  const candidate = new Date(Math.max(from, start.getTime()));
  candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);
  if (candidate.getTime() < from || candidate.getTime() < start.getTime()) candidate.setDate(candidate.getDate() + 1);
  while (reminder.repeat === 'weekdays' && !isWeekday(candidate)) candidate.setDate(candidate.getDate() + 1);
  return candidate.getTime();
}

function prepare(reminder) {
  return { repeat: 'none', done: false, firedFor: null, ...reminder, next: nextOccurrence(reminder) };
}

// Setelah "Oke": selesai (sekali) atau maju ke kejadian berikutnya (berulang).
function acknowledge(reminder, now = Date.now()) {
  if (reminder.repeat === 'none' || !reminder.repeat) return { ...reminder, done: true };
  return { ...reminder, next: nextOccurrence(reminder, now + 60_000), firedFor: null };
}

function snooze(reminder, minutes, now = Date.now()) {
  return { ...reminder, next: now + minutes * 60_000, firedFor: null };
}

const due = (reminder, now = Date.now()) => !reminder.done && reminder.next <= now && reminder.firedFor !== reminder.next;

function upcoming(reminders, now = Date.now()) {
  return reminders.filter((r) => !r.done && r.next >= now - 60_000).sort((a, b) => a.next - b.next)[0] ?? null;
}

module.exports = { period, greeting, nextOccurrence, prepare, acknowledge, snooze, due, upcoming };
