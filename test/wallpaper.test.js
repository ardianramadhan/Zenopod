'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wallpapers = require('../lib/wallpaper');

const PNG = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-wall-'));

test('menambah, mendaftar, dan menghapus wallpaper', () => {
  const dir = tmp();
  const a = wallpapers.add(dir, PNG, 1000);
  const b = wallpapers.add(dir, PNG, 2000);
  assert.ok(a.ok && b.ok);
  assert.deepStrictEqual(wallpapers.list(dir).map((w) => w.id).sort(), [a.id, b.id].sort());
  assert.ok(wallpapers.fileFor(dir, a.id).endsWith(a.id));
  assert.strictEqual(wallpapers.remove(dir, a.id), true);
  assert.deepStrictEqual(wallpapers.list(dir).map((w) => w.id), [b.id]);
});

test('menolak format lain dan id di luar folder koleksi', () => {
  const dir = tmp();
  assert.strictEqual(wallpapers.add(dir, 'data:text/plain;base64,aGFp').ok, false);
  assert.strictEqual(wallpapers.add(dir, 'bukan data url').ok, false);
  wallpapers.add(dir, PNG, 3000);
  assert.strictEqual(wallpapers.fileFor(dir, '../config.json'), null);
  assert.strictEqual(wallpapers.fileFor(dir, 'tidak-ada.png'), null);
  assert.strictEqual(wallpapers.remove(dir, '..\\config.json'), false);
});

test('folder yang belum ada = koleksi kosong', () => {
  assert.deepStrictEqual(wallpapers.list(path.join(tmp(), 'belum-ada')), []);
});
