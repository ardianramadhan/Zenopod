'use strict';

// Terminal VS Code meng-set ELECTRON_RUN_AS_NODE, sehingga Electron berjalan sebagai Node biasa.
// Hapus dulu variabel itu, lalu jalankan Electron.
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { cwd: __dirname, env, stdio: 'inherit', windowsHide: false });
child.on('exit', (code) => process.exit(code ?? 0));
