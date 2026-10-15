'use strict';

// "Telinga" Zeno: whisper.cpp offline. Biner & model diunduh sekali ke vendor/whisper
// (tidak masuk Git). Rekaman suara tidak pernah keluar dari laptop.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const { whisperDir: VENDOR } = require('./paths');
const MODEL = path.join(VENDOR, 'models', 'ggml-base.bin');
const BINARY_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip';
const IS_MAC = process.platform === 'darwin';
// macOS: whisper.cpp tidak menyediakan biner siap pakai; dipasang lewat `brew install whisper-cpp`.
const MAC_BINARIES = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

function findExe(dir = VENDOR) {
  if (IS_MAC) return MAC_BINARIES.find((p) => fs.existsSync(p)) ?? null;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findExe(full);
        if (found) return found;
      } else if (entry.name.toLowerCase() === 'whisper-cli.exe') {
        return full;
      }
    }
  } catch {
    // folder belum ada
  }
  return null;
}

let downloading = null; // { stage, received, total }

function status() {
  const exe = findExe();
  const model = fs.existsSync(MODEL) && fs.statSync(MODEL).size > 100_000_000;
  return { ready: Boolean(exe && model), exe: Boolean(exe), model, downloading, needsBrew: IS_MAC && !exe };
}

async function fetchTo(url, file, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Unduhan gagal (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    onProgress(received, total);
  });
  const temp = file + '.part';
  await pipeline(body, fs.createWriteStream(temp));
  fs.renameSync(temp, file);
}

function unzip(zip, dest) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
      { windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function download(onChange) {
  if (downloading) return;
  const report = (stage, received = 0, total = 0) => {
    downloading = { stage, received, total };
    onChange(status());
  };
  try {
    fs.mkdirSync(path.join(VENDOR, 'models'), { recursive: true });
    if (!findExe() && !IS_MAC) {
      const zip = path.join(VENDOR, 'whisper.zip');
      await fetchTo(BINARY_URL, zip, (r, t) => report('Mengunduh whisper.cpp', r, t));
      report('Membuka arsip');
      await unzip(zip, VENDOR);
      fs.rmSync(zip, { force: true });
    }
    if (!status().model) {
      await fetchTo(MODEL_URL, MODEL, (r, t) => report('Mengunduh model suara', r, t));
    }
    downloading = null;
    onChange(status());
  } catch (error) {
    downloading = null;
    onChange({ ...status(), error: error.message });
  }
}

// WAV 16 kHz mono → teks. prompt = kosakata yang sering dipakai (nama aplikasi, perintah).
function transcribe(wavBuffer, prompt = '') {
  const exe = findExe();
  if (!exe || !status().model) return Promise.reject(new Error('Mesin suara belum diunduh.'));
  const file = path.join(os.tmpdir(), `kapsul-${Date.now()}.wav`);
  fs.writeFileSync(file, wavBuffer);
  const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
  const args = ['-m', MODEL, '-f', file, '-l', 'id', '-nt', '-np', '-t', threads];
  if (prompt) args.push('--prompt', prompt);
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 60_000, cwd: path.dirname(exe) }, (error, stdout) => {
      fs.rmSync(file, { force: true });
      if (error) return reject(error);
      const text = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^\[.*\]$/.test(line))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      resolve(text);
    });
  });
}

module.exports = { status, download, transcribe };
