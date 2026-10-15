'use strict';

// Pengganti bridge.ps1 untuk macOS. Bentuknya meniru proses anak (stdin.write / kill) dan
// mengirim pesan yang sama: media, notifications, voices, quick, speech, ocr — jadi main.js
// tidak perlu tahu sedang di Windows atau Mac.
//
// - Musik: AppleScript ke Spotify / Apple Music (aplikasi lain tidak bisa dibaca di macOS).
// - Notifikasi aplikasi lain: tidak tersedia di macOS (tidak ada API untuk membacanya).
// - Volume: AppleScript. Wi-Fi: networksetup. Kecerahan & Bluetooth: tidak tersedia (null).
// - Suara Zeno: perintah `say`. Ambil teks: helper Vision (native/mac/zenopod-helper.swift).

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(cmd, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

const osa = (script) => run('osascript', ['-e', script]);

// ---------- Pengurai teks (diuji di test/macbridge.test.js) ----------

// `say -v '?'` → [{ id, name, lang }]; contoh baris: "Damayanti           id_ID    # Halo, …"
function parseVoices(output) {
  const voices = [];
  for (const line of String(output ?? '').split('\n')) {
    // Nama panjang (mis. "Eddy (English (US))") kadang hanya dipisah satu spasi dari kode bahasa.
    const match = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#/);
    if (match) voices.push({ id: match[1].trim(), name: match[1].trim(), lang: match[2].replace('_', '-') });
  }
  return voices;
}

// `networksetup -listallhardwareports` → nama perangkat Wi-Fi (mis. en0)
function parseWifiDevice(output) {
  const match = String(output ?? '').match(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/);
  return match ? match[1] : null;
}

// `networksetup -getairportpower en0` → 'On' | 'Off' | null
function parseWifiPower(output) {
  const match = String(output ?? '').match(/:\s*(On|Off)\s*$/m);
  return match ? match[1] : null;
}

// Keluaran skrip musik: "app\tstate\tjudul\tartis\turl sampul"
function parseTrack(output) {
  const [app, state, title, artist, art] = String(output ?? '').trim().split('\t');
  if (!app || !title) return null;
  return { app, state, title, artist: artist || '', art: art || '' };
}

// "45,false" → { volume: 45, muted: false }
function parseVolume(output) {
  const [volume = '', muted] = String(output ?? '').trim().split(',');
  const n = Number(volume);
  return { volume: /^\d+$/.test(volume) && Number.isFinite(n) ? n : null, muted: muted === 'true' };
}

// ---------- Musik ----------

const PLAYERS = ['Spotify', 'Music'];

const trackScript = (player) => `
tell application "${player}"
  if player state is playing or player state is paused then
    set t to current track
    set art to ""
    ${player === 'Spotify' ? 'try\n      set art to artwork url of t\n    end try' : ''}
    return "${player}" & tab & (player state as text) & tab & (name of t) & tab & (artist of t) & tab & art
  end if
end tell
return ""`;

async function running(name) {
  return (await run('pgrep', ['-x', name], 2000)) !== null;
}

class MacBridge {
  constructor(onMessage, { helper = null, log = () => {} } = {}) {
    this.onMessage = onMessage;
    this.helper = helper;
    this.log = log;
    this.timers = [];
    this.lastMedia = null;
    this.player = null;
    this.artCache = new Map();
    this.wifiDevice = undefined;
    this.lastQuick = null;
    // Meniru ChildProcess supaya main.js bisa memakai bridge.stdin.write(...) dan bridge.kill().
    this.stdin = { write: (text) => String(text).split('\n').forEach((line) => line.trim() && this.command(line.trim())), end: () => {} };
  }

  send(message) {
    try {
      this.onMessage(message);
    } catch (error) {
      this.log('macbridge: ' + error.message);
    }
  }

  start() {
    this.send({ type: 'notifications', access: 'Unsupported', items: [] });
    this.voices();
    this.media(true);
    this.quick(true);
    this.timers.push(setInterval(() => this.media(false), 2000));
    this.timers.push(setInterval(() => this.quick(false), 4000));
    return this;
  }

  kill() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async command(line) {
    const [cmd, rest = ''] = line.split(/\s+(.*)/s);
    try {
      if (cmd === 'toggle' || cmd === 'next' || cmd === 'prev') await this.mediaCommand(cmd);
      else if (cmd === 'refresh') await this.media(true);
      else if (cmd === 'voices') await this.voices();
      else if (cmd === 'speak') {
        const [id, payload] = rest.split(/\s+/);
        await this.speak(id, payload);
      } else if (cmd === 'quick') {
        const [what, value] = rest.split(/\s+/);
        await this.setQuick(what, value);
      } else if (cmd === 'ocr') {
        const [id, ...file] = rest.split(/\s+/);
        await this.ocr(id, file.join(' '));
      }
      // dismiss / clear: notifikasi tidak tersedia di macOS.
    } catch (error) {
      this.log(`macbridge ${cmd}: ${error.message}`);
    }
  }

  // ---------- Musik ----------

  async currentTrack() {
    let paused = null;
    for (const player of PLAYERS) {
      if (!(await running(player))) continue;
      const track = parseTrack(await osa(trackScript(player)));
      if (!track) continue;
      if (track.state === 'playing') return track;
      paused ??= track;
    }
    return paused;
  }

  // Sampul Spotify berupa URL https; tampilan hanya menerima data: (CSP), jadi diunduh dulu.
  async artwork(url) {
    if (!url) return null;
    if (this.artCache.has(url)) return this.artCache.get(url);
    let data = null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) data = `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    } catch {
      // tanpa sampul
    }
    if (this.artCache.size > 20) this.artCache.clear();
    this.artCache.set(url, data);
    return data;
  }

  async media(force) {
    const track = await this.currentTrack();
    this.player = track?.app ?? this.player;
    const key = track ? `${track.app}|${track.title}|${track.artist}|${track.state}` : 'none';
    if (!force && key === this.lastMedia) return;
    this.lastMedia = key;
    if (!track) return this.send({ type: 'media', playing: false, title: null });
    this.send({
      type: 'media',
      app: track.app,
      title: track.title,
      artist: track.artist,
      playing: track.state === 'playing',
      status: track.state === 'playing' ? 'Playing' : 'Paused',
      art: await this.artwork(track.art),
    });
  }

  async mediaCommand(cmd) {
    const player = this.player ?? (await this.currentTrack())?.app;
    if (!player) return;
    const verb = { toggle: 'playpause', next: 'next track', prev: 'previous track' }[cmd];
    await osa(`tell application "${player}" to ${verb}`);
    setTimeout(() => this.media(true), 400);
  }

  // ---------- Kontrol cepat ----------

  async wifi() {
    if (this.wifiDevice === undefined) this.wifiDevice = parseWifiDevice(await run('networksetup', ['-listallhardwareports']));
    if (!this.wifiDevice) return null;
    return parseWifiPower(await run('networksetup', ['-getairportpower', this.wifiDevice]));
  }

  async quick(force) {
    const { volume, muted } = parseVolume(await osa('set s to get volume settings\nreturn (output volume of s as text) & "," & (output muted of s as text)'));
    const state = { type: 'quick', volume, muted, brightness: null, wifi: await this.wifi(), bluetooth: null };
    const key = JSON.stringify(state);
    if (!force && key === this.lastQuick) return;
    this.lastQuick = key;
    this.send(state);
  }

  async setQuick(what, value) {
    if (what === 'volume') {
      const n = Math.max(0, Math.min(100, Math.round(Number(value))));
      await osa(`set volume output volume ${n}\nset volume output muted false`);
    } else if (what === 'mute') {
      const current = parseVolume(await osa('set s to get volume settings\nreturn "0," & (output muted of s as text)')).muted;
      const next = value === 'toggle' ? !current : value === '1';
      await osa(`set volume output muted ${next}`);
    } else if (what === 'wifi') {
      await this.wifi();
      if (this.wifiDevice) await run('networksetup', ['-setairportpower', this.wifiDevice, value === 'on' ? 'on' : 'off']);
    }
    setTimeout(() => this.quick(true), 300);
  }

  // ---------- Suara Zeno ----------

  async voices() {
    this.send({ type: 'voices', voices: parseVoices(await run('say', ['-v', '?'])) });
  }

  // Sama dengan bridge.ps1: speak <id> <base64 JSON {text, voice, rate, pitch}> → {type: speech, id, data}
  async speak(id, payload) {
    const { text, voice, rate } = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    const file = path.join(os.tmpdir(), `zenopod-say-${Date.now()}.wav`);
    const args = ['-o', file, '--file-format=WAVE', '--data-format=LEI16@22050', '-r', String(Math.round(180 * (Number(rate) || 1)))];
    if (voice) args.push('-v', voice);
    args.push(String(text));
    if ((await run('say', args, 20000)) === null) return;
    try {
      this.send({ type: 'speech', id, data: 'data:audio/wav;base64,' + fs.readFileSync(file).toString('base64') });
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  // ---------- Ambil teks ----------

  async ocr(id, file) {
    try {
      if (!this.helper || !fs.existsSync(this.helper)) return this.send({ type: 'ocr', id, error: 'no-helper' });
      const out = await run(this.helper, ['ocr', file], 30000);
      const result = out ? JSON.parse(out) : { error: 'Helper tidak menjawab' };
      this.send({ type: 'ocr', id, ...result });
    } catch (error) {
      this.send({ type: 'ocr', id, error: error.message });
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
}

function createMacBridge(onMessage, options) {
  return new MacBridge(onMessage, options).start();
}

module.exports = { createMacBridge, parseVoices, parseWifiDevice, parseWifiPower, parseTrack, parseVolume };
