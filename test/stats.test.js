'use strict';

// Uji waktu layar & laporan mingguan (lib/stats.js): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { Stats, dayKey } = require('../lib/stats');

const fresh = () => {
  const s = new Stats(path.join(os.tmpdir(), `zenopod-stats-test-${process.pid}-${Math.random()}.json`));
  s.save = () => {}; // jangan menulis file
  return s;
};

test('waktu layar per aplikasi dijumlahkan dan diurutkan', () => {
  const s = fresh();
  s.screen('Google Chrome', 60_000);
  s.screen('Visual Studio Code', 90_000);
  s.screen('Google Chrome', 60_000);
  s.screen('', 10_000);
  s.screen('Spotify', -5);
  assert.deepEqual(s.screenApps([dayKey()]), [
    { name: 'Google Chrome', ms: 120_000 },
    { name: 'Visual Studio Code', ms: 90_000 },
  ]);
});

test('laporan mingguan: Senin–Minggu, total, aplikasi teratas, hari aktif', () => {
  const s = fresh();
  s.data.days = {
    '2026-10-12': { screen: { Chrome: 3_600_000 }, focusMs: 1_500_000, focus: 1, songs: { 'A · B': 600_000 } },
    '2026-10-14': { screen: { Chrome: 1_800_000, Code: 7_200_000 }, todos: 2 },
    '2026-10-18': { screen: { Code: 600_000 } },
    '2026-10-19': { screen: { Chrome: 99_000_000 } }, // minggu berikutnya: tidak ikut
  };
  const r = s.weekReport(new Date(2026, 9, 12));
  assert.equal(r.from, '2026-10-12');
  assert.equal(r.to, '2026-10-18');
  assert.equal(r.screenMs, 3_600_000 + 1_800_000 + 7_200_000 + 600_000);
  assert.deepEqual(r.apps[0], { name: 'Code', ms: 7_800_000 });
  assert.equal(r.focusMs, 1_500_000);
  assert.equal(r.listenMs, 600_000);
  assert.equal(r.todos, 2);
  assert.equal(r.activeDays, 3);
});
