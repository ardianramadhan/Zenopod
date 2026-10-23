'use strict';

// Koleksi wallpaper Zenopod: gambar yang diunggah pengguna disalin ke folder data
// (userData/wallpapers), lalu dipasang sebagai wallpaper desktop dari island.
// Modul ini hanya mengurus file; memasang wallpaper ada di main.js (bridge.ps1 / osascript).

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 40;
const MAX_BYTES = 30 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/bmp': 'bmp' };

function list(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.(jpe?g|png|webp|bmp)$/i.test(n));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return { id: name, file, at: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
}

// dataUrl "data:image/png;base64,…" → simpan sebagai file baru. Mengembalikan id (nama file) atau error.
function add(dir, dataUrl, now = Date.now()) {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  const ext = match && TYPES[match[1]];
  if (!ext) return { ok: false, error: 'Format gambar tidak didukung (pakai JPG, PNG, WebP, atau BMP).' };
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'Gambar terlalu besar (maksimal 30 MB).' };
  const existing = list(dir);
  if (existing.length >= MAX_FILES) return { ok: false, error: `Maksimal ${MAX_FILES} wallpaper. Hapus beberapa dulu.` };
  fs.mkdirSync(dir, { recursive: true });
  const id = `wallpaper-${now}.${ext}`;
  fs.writeFileSync(path.join(dir, id), bytes);
  return { ok: true, id };
}

// id harus nama file di folder koleksi (bukan path lain).
function fileFor(dir, id) {
  const name = path.basename(String(id ?? ''));
  if (name !== id || !list(dir).some((w) => w.id === name)) return null;
  return path.join(dir, name);
}

function remove(dir, id) {
  const file = fileFor(dir, id);
  if (!file) return false;
  fs.rmSync(file, { force: true });
  return true;
}

module.exports = { list, add, fileFor, remove, MAX_FILES };
