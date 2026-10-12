'use strict';

// Lokasi file Zenopod.
// - Dijalankan dari kode (npm start): config.json & mesin suara di folder project (seperti biasa).
// - Versi terpasang (.exe): folder aplikasi hanya-baca, jadi data pindah ke %APPDATA%\kapsul;
//   bridge.ps1 & hook dikeluarkan dari app.asar (asarUnpack) karena PowerShell/Node butuh file sungguhan.

const { app } = require('electron');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const packaged = app.isPackaged;
const unpacked = (file) => file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

module.exports = {
  packaged,
  configFile: path.join(packaged ? app.getPath('userData') : ROOT, 'config.json'),
  whisperDir: packaged ? path.join(app.getPath('userData'), 'whisper') : path.join(ROOT, 'vendor', 'whisper'),
  bridgeScript: unpacked(path.join(ROOT, 'bridge.ps1')),
  hookScript: unpacked(path.join(ROOT, 'hooks', 'kapsul-hook.js')),
  icon: path.join(ROOT, 'build', 'icon.png'),
};
