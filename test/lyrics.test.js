'use strict';

// Uji pengurai lirik LRCLIB: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { parseLrc, lineAt, cleanTitle, firstArtist, pickBest, toLyrics } = require('../lib/lyrics');

test('lirik LRC jadi baris bertanda waktu', () => {
  const lines = parseLrc('[ar: Tulus]\n[00:12.34] Perjalanan membawamu\n[00:15.5]Bertemu denganku\n[01:02.003][01:30.00] Reff\n[00:20.00]\nbaris tanpa waktu');
  assert.deepEqual(lines, [
    { t: 12340, text: 'Perjalanan membawamu' },
    { t: 15500, text: 'Bertemu denganku' },
    { t: 20000, text: '' },
    { t: 62003, text: 'Reff' },
    { t: 90000, text: 'Reff' },
  ]);
  assert.deepEqual(parseLrc(null), []);
});

test('baris yang sedang dinyanyikan', () => {
  const lines = [{ t: 1000 }, { t: 5000 }, { t: 9000 }];
  assert.equal(lineAt(lines, 0), -1);
  assert.equal(lineAt(lines, 1000), 0);
  assert.equal(lineAt(lines, 8999), 1);
  assert.equal(lineAt(lines, 60000), 2);
  assert.equal(lineAt([], 5000), -1);
});

test('judul dan artis dirapikan untuk pencarian', () => {
  assert.equal(cleanTitle('Here Comes The Sun - Remastered 2009'), 'Here Comes The Sun');
  assert.equal(cleanTitle('Sial (feat. Mahalini)'), 'Sial');
  assert.equal(cleanTitle('Hati-Hati di Jalan'), 'Hati-Hati di Jalan');
  assert.equal(firstArtist('Tulus, Gita Gutawa'), 'Tulus');
  assert.equal(firstArtist('Nadin Amizah & Sal Priadi'), 'Nadin Amizah');
  assert.equal(firstArtist('Tulus'), 'Tulus');
});

test('hasil pencarian: tersinkron dan durasi terdekat', () => {
  const results = [
    { id: 1, duration: 4, syncedLyrics: '[00:01.00]a' },
    { id: 2, duration: 250, plainLyrics: 'b' },
    { id: 3, duration: 262, syncedLyrics: '[00:01.00]c' },
    { id: 4, duration: 243, syncedLyrics: '[00:01.00]d' },
  ];
  assert.equal(pickBest(results, 242_000).id, 4);
  assert.equal(pickBest(results.slice(0, 2), 251_000).id, 2);
  assert.equal(pickBest([], 1000), null);
});

test('bentuk lirik untuk tampilan', () => {
  assert.deepEqual(toLyrics({ syncedLyrics: '[00:01.00]Halo' }), { synced: true, lines: [{ t: 1000, text: 'Halo' }] });
  assert.deepEqual(toLyrics({ plainLyrics: 'Satu\nDua' }), { synced: false, lines: [{ t: 0, text: 'Satu' }, { t: 0, text: 'Dua' }] });
  assert.deepEqual(toLyrics({ instrumental: true }), { instrumental: true, synced: false, lines: [] });
  assert.equal(toLyrics(null), null);
  assert.equal(toLyrics({ plainLyrics: '' }), null);
});
