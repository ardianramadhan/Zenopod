'use strict';

// Kostum otomatis menurut tanggal (lib/season.js): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { COSTUMES, seasonalCostume, costumeFor } = require('../lib/season');

test('kostum hari besar baru: HUT TNI, Hari Pahlawan, Natal', () => {
  assert.equal(seasonalCostume(new Date(2026, 9, 5)).costume, 'tentara');
  assert.equal(seasonalCostume(new Date(2026, 10, 10)).costume, 'tentara');
  assert.equal(seasonalCostume(new Date(2026, 11, 25)).costume, 'natal');
  assert.equal(seasonalCostume(new Date(2026, 11, 24)).reason, 'Natal');
});

test('kostum profesi bisa dipilih manual', () => {
  for (const name of ['ninja', 'koki', 'wisuda', 'proyek', 'polisi', 'dokter', 'pilot', 'pemadam']) {
    assert.ok(COSTUMES[name], name);
    assert.deepEqual(costumeFor(name, {}), { costume: name, reason: 'Pilihan sendiri' });
  }
  assert.equal(costumeFor('tidak-ada', {}).reason === 'Pilihan sendiri', false);
});
