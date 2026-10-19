'use strict';

// Uji Pomodoro (lib/focus.js): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { Focus } = require('../lib/focus');

const settings = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cycles: 4, autoStartBreak: false };
const make = () => new Focus({ settings: () => settings, onChange: () => {}, onPhaseEnd: () => {} });

test('lama fokus pilihan dipakai sampai dihentikan', () => {
  const f = make();
  f.start('focus', { minutes: 45 });
  assert.equal(f.state.total, 45 * 60_000);
  f.finish(); // → istirahat
  f.finish(); // → fokus berikutnya, menunggu
  assert.equal(f.state.phase, 'focus');
  assert.equal(f.state.remaining, 45 * 60_000);
  f.stop();
  f.start('focus');
  assert.equal(f.state.total, 25 * 60_000);
  f.stop();
});

test('tambah waktu saat berjalan dan saat dijeda', () => {
  const f = make();
  f.start('focus');
  const endsAt = f.state.endsAt;
  f.extend(5 * 60_000);
  assert.equal(f.state.endsAt, endsAt + 5 * 60_000);
  assert.equal(f.state.total, 30 * 60_000);
  f.pause();
  const left = f.state.remaining;
  f.extend(60_000);
  assert.equal(f.state.remaining, left + 60_000);
  assert.equal(f.state.total, 31 * 60_000);
  // Dilanjutkan: total tetap termasuk tambahan.
  f.start();
  assert.equal(f.state.total, 31 * 60_000);
  f.stop();
  f.extend(60_000); // tanpa fase: diabaikan
  assert.equal(f.state.phase, null);
});

test('lama fokus yang dijalani dilaporkan saat fase selesai', () => {
  const spentList = [];
  const f = new Focus({ settings: () => settings, onChange: () => {}, onPhaseEnd: (_phase, _state, spent) => spentList.push(spent) });
  f.start('focus');
  f.state.endsAt = Date.now() + 15 * 60_000; // tersisa 15 dari 25 menit
  f.skip();
  assert.ok(Math.abs(spentList[0] - 10 * 60_000) < 1000);
  f.stop();
});
