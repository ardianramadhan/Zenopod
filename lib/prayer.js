'use strict';

// Jadwal sholat offline (tanpa internet), metode Kemenag RI: Subuh 20°, Isya 18°, Ashar mazhab Syafi'i
// (bayangan = 1× tinggi benda), Maghrib = matahari terbenam. Rumus astronomi dari praytimes.org.
// ihtiyat: menit pengaman yang ditambahkan seperti jadwal resmi Kemenag (bawaan 2 menit).

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const tan = (d) => Math.tan(d * RAD);
const arcsin = (x) => Math.asin(x) / RAD;
const arccos = (x) => Math.acos(Math.max(-1, Math.min(1, x))) / RAD;
const arctan2 = (y, x) => Math.atan2(y, x) / RAD;
const arccot = (x) => Math.atan(1 / x) / RAD;
const fix = (a, b) => {
  const r = a - b * Math.floor(a / b);
  return r < 0 ? r + b : r;
};

const NAMES = { fajr: 'Subuh', sunrise: 'Terbit', dhuhr: 'Dzuhur', asr: 'Ashar', maghrib: 'Maghrib', isha: 'Isya' };
// Waktu yang dihitung sebagai "sholat" (terbit hanya penanda batas Subuh).
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function julian(year, month, day) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

function sunPosition(jd) {
  const d = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * d, 360);
  const q = fix(280.459 + 0.98564736 * d, 360);
  const l = fix(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * d;
  const ra = fix(arctan2(cos(e) * sin(l), cos(l)) / 15, 24);
  return { declination: arcsin(sin(e) * sin(l)), equation: q / 15 - ra };
}

// Waktu dalam jam UTC untuk tanggal (tahun, bulan, hari) di lokasi itu.
function computeUtc(year, month, day, lat, lon) {
  const jd = julian(year, month, day) - lon / (15 * 24);
  const midDay = (t) => fix(12 - sunPosition(jd + t).equation, 24);
  const angleTime = (angle, t, before) => {
    const decl = sunPosition(jd + t).declination;
    const noon = midDay(t);
    const h = arccos((-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
    return noon + (before ? -h : h);
  };
  const asrTime = (factor, t) => {
    const decl = sunPosition(jd + t).declination;
    return angleTime(-arccot(factor + tan(Math.abs(lat - decl))), t);
  };
  // Perkiraan awal (jam lokal matahari) lalu satu iterasi, seperti praytimes.org.
  const guess = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, maghrib: 18, isha: 18 };
  const p = Object.fromEntries(Object.entries(guess).map(([k, v]) => [k, v / 24]));
  const solar = {
    fajr: angleTime(20, p.fajr, true),
    sunrise: angleTime(0.833, p.sunrise, true),
    dhuhr: midDay(p.dhuhr),
    asr: asrTime(1, p.asr),
    maghrib: angleTime(0.833, p.maghrib),
    isha: angleTime(18, p.isha),
  };
  return Object.fromEntries(Object.entries(solar).map(([k, v]) => [k, v - lon / 15]));
}

// Jadwal untuk hari (lokal) dari `date`: { fajr, sunrise, dhuhr, asr, maghrib, isha } sebagai Date.
function prayerTimes(date, latitude, longitude, { ihtiyat = 2 } = {}) {
  if (latitude == null || longitude == null || latitude === '' || longitude === '') return null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const utc = computeUtc(y, m, d, lat, lon);
  const base = Date.UTC(y, m - 1, d);
  const out = {};
  for (const [key, hours] of Object.entries(utc)) {
    // Terbit tidak diberi ihtiyat ke belakang: batas akhir Subuh justru dimajukan.
    const extra = key === 'sunrise' ? -ihtiyat : ihtiyat;
    // Dibulatkan ke menit (jadwal resmi juga per menit).
    out[key] = new Date(Math.round((base + hours * 3_600_000 + extra * 60_000) / 60_000) * 60_000);
  }
  // Lokasi jauh dari zona waktu komputer: tanggal lokal bisa bergeser; geser sehari bila Dzuhur jatuh di hari lain.
  if (out.dhuhr.getDate() !== d) {
    const shift = out.dhuhr < date ? 86_400_000 : -86_400_000;
    for (const key of Object.keys(out)) out[key] = new Date(out[key].getTime() + shift);
  }
  return out;
}

// Sholat berikutnya dari `now` (melewati Isya = Subuh besok).
function nextPrayer(now, latitude, longitude, options) {
  const today = prayerTimes(now, latitude, longitude, options);
  if (!today) return null;
  for (const key of PRAYERS) if (today[key] > now) return { key, name: NAMES[key], at: today[key] };
  const tomorrow = prayerTimes(new Date(now.getTime() + 86_400_000), latitude, longitude, options);
  return { key: 'fajr', name: NAMES.fajr, at: tomorrow.fajr };
}

module.exports = { prayerTimes, nextPrayer, NAMES, PRAYERS };
