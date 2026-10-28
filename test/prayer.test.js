'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prayerTimes, nextPrayer } = require('../lib/prayer.js');

// Acuan: api.aladhan.com metode 20 (Kemenag RI, Subuh 20°, Isya 18°, tanpa ihtiyat), WIB (UTC+7).
const REFERENCE = [
  { city: 'Jakarta', lat: -6.2088, lon: 106.8456, date: [2026, 10, 27], times: { fajr: '04:08', sunrise: '05:27', dhuhr: '11:37', asr: '14:51', maghrib: '17:46', isha: '18:57' } },
  { city: 'Surabaya', lat: -7.2575, lon: 112.7521, date: [2026, 10, 27], times: { fajr: '03:43', sunrise: '05:03', dhuhr: '11:13', asr: '14:26', maghrib: '17:23', isha: '18:34' } },
  { city: 'Medan', lat: 3.5952, lon: 98.6722, date: [2026, 10, 27], times: { fajr: '04:50', sunrise: '06:09', dhuhr: '12:09', asr: '15:30', maghrib: '18:09', isha: '19:20' } },
  { city: 'Jakarta (Juni)', lat: -6.2088, lon: 106.8456, date: [2026, 6, 15], times: { fajr: '04:36', sunrise: '06:00', dhuhr: '11:53', asr: '15:15', maghrib: '17:46', isha: '19:01' } },
];

// Jam WIB dari Date (tidak bergantung zona waktu komputer yang menjalankan tes).
const wib = (date) => {
  const t = new Date(date.getTime() + 7 * 3_600_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

for (const ref of REFERENCE) {
  test(`jadwal ${ref.city} sesuai Kemenag (±1 menit)`, () => {
    const [y, m, d] = ref.date;
    // Siang WIB di hari itu, supaya tanggal lokalnya pasti benar di zona waktu mana pun.
    const day = new Date(Date.UTC(y, m - 1, d, 5));
    const times = prayerTimes(day, ref.lat, ref.lon, { ihtiyat: 0 });
    for (const [key, expected] of Object.entries(ref.times)) {
      const diff = Math.abs(wib(times[key]) - minutes(expected));
      assert.ok(diff <= 1, `${key}: ${wib(times[key])} vs ${expected}`);
    }
  });
}

test('ihtiyat menambah 2 menit (terbit dimajukan)', () => {
  const day = new Date(Date.UTC(2026, 9, 27, 5));
  const raw = prayerTimes(day, -6.2088, 106.8456, { ihtiyat: 0 });
  const safe = prayerTimes(day, -6.2088, 106.8456);
  assert.equal(safe.dhuhr - raw.dhuhr, 2 * 60_000);
  assert.equal(safe.sunrise - raw.sunrise, -2 * 60_000);
});

test('sholat berikutnya: setelah Isya = Subuh besok', () => {
  const day = new Date(Date.UTC(2026, 9, 27, 5));
  const times = prayerTimes(day, -6.2088, 106.8456);
  const afterAsr = nextPrayer(new Date(times.asr.getTime() + 60_000), -6.2088, 106.8456);
  assert.equal(afterAsr.key, 'maghrib');
  const late = nextPrayer(new Date(times.isha.getTime() + 60_000), -6.2088, 106.8456);
  assert.equal(late.key, 'fajr');
  assert.ok(late.at > times.isha);
});

test('lokasi tidak valid = null', () => {
  assert.equal(prayerTimes(new Date(), null, 106), null);
});
