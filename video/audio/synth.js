'use strict';

// Generator audio video promosi (tanpa file/sampel dari luar, bebas hak cipta):
// - public/music.wav : musik latar lo-fi ceria 62 detik, cukup untuk versi 30 & 60 detik (akor, bass, ketukan lembut)
// - public/sfx/*.wav : efek suara Zeno (resepnya sama dengan renderer/sounds.js)
// Jalankan: node audio/synth.js

const fs = require('node:fs');
const path = require('node:path');

const RATE = 44100;
const OUT = path.join(__dirname, '..', 'public');

// ---------- Dasar ----------

function buffer(seconds) {
  return new Float32Array(Math.ceil(seconds * RATE));
}

const WAVES = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  triangle: (p) => 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5),
  square: (p) => (p % 1 < 0.5 ? 1 : -1),
  sawtooth: (p) => 2 * (p % 1) - 1,
};

// Satu nada: attack/decay eksponensial, bisa meluncur ke frekuensi lain, vibrato, dan low-pass sederhana.
function tone(buf, t, freq, dur, { type = 'sine', gain = 0.25, attack = 0.008, slide = null, vibrato = 0, filter = null } = {}) {
  const start = Math.floor(t * RATE);
  const length = Math.floor((dur + 0.05) * RATE);
  let phase = 0;
  let lp = 0;
  const alpha = filter ? 1 - Math.exp((-2 * Math.PI * filter) / RATE) : 1;
  for (let i = 0; i < length && start + i < buf.length; i++) {
    const time = i / RATE;
    const k = Math.min(1, time / dur);
    let f = slide ? freq * Math.pow(slide / freq, k) : freq;
    if (vibrato) f += Math.sin(2 * Math.PI * 7 * time) * vibrato;
    phase += f / RATE;
    const env = time < attack ? time / attack : Math.exp(-5 * (time - attack) / Math.max(0.01, dur - attack));
    let sample = WAVES[type](phase) * env * gain;
    lp += alpha * (sample - lp);
    sample = filter ? lp : sample;
    if (start + i >= 0) buf[start + i] += sample;
  }
}

function bell(buf, t, freq, dur = 0.8, gain = 0.2) {
  tone(buf, t, freq, dur, { gain, attack: 0.004 });
  tone(buf, t, freq * 2, dur * 0.6, { gain: gain * 0.3, attack: 0.004 });
  tone(buf, t, freq * 3.01, dur * 0.35, { gain: gain * 0.12, attack: 0.004 });
}

function noise(buf, t, dur, gain, { filter = 6000 } = {}) {
  const start = Math.floor(t * RATE);
  const length = Math.floor(dur * RATE);
  const alpha = 1 - Math.exp((-2 * Math.PI * filter) / RATE);
  let lp = 0;
  for (let i = 0; i < length && start + i < buf.length; i++) {
    const env = Math.exp((-6 * i) / length);
    lp += alpha * ((Math.random() * 2 - 1) - lp);
    buf[start + i] += lp * env * gain;
  }
}

// drive > 0: soft-limiter (tanh) setelah normalisasi, supaya lebih "penuh" tanpa pecah.
function writeWav(file, buf, volume = 1, drive = 0) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  if (drive > 0 && peak > 0) {
    const norm = Math.tanh(drive);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] / peak) * drive) / norm;
    peak = 1;
  }
  const scale = peak > 0 ? Math.min(1, 0.95 / peak) * volume : volume;
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * scale)) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// ---------- Efek suara (sama dengan renderer/sounds.js) ----------

const SFX = {
  pop: (b) => tone(b, 0.02, 380, 0.09, { gain: 0.25, slide: 1150 }),
  hello: (b) => {
    tone(b, 0.02, 600, 0.12, { gain: 0.2, slide: 900 });
    tone(b, 0.15, 900, 0.18, { gain: 0.2, slide: 1250 });
  },
  swipe: (b) => tone(b, 0.02, 520, 0.12, { type: 'triangle', gain: 0.1, slide: 780, filter: 2500 }),
  notif: (b) => {
    bell(b, 0.02, 987.8, 0.5, 0.16);
    bell(b, 0.11, 1318.5, 0.7, 0.16);
  },
  note: (b) => {
    tone(b, 0.02, 659.3, 0.12, { type: 'triangle', gain: 0.16 });
    tone(b, 0.12, 784, 0.12, { type: 'triangle', gain: 0.16 });
    tone(b, 0.22, 1046.5, 0.22, { type: 'triangle', gain: 0.16 });
  },
  alarm: (b) => {
    for (let i = 0; i < 2; i++) {
      bell(b, 0.02 + i * 0.42, 1046.5, 0.35, 0.2);
      bell(b, 0.16 + i * 0.42, 1318.5, 0.45, 0.2);
    }
  },
  click: (b) => tone(b, 0.01, 1800, 0.04, { type: 'triangle', gain: 0.18, filter: 4000 }),
  tick: (b) => {
    tone(b, 0.02, 1568, 0.05, { gain: 0.14 });
    tone(b, 0.08, 2093, 0.08, { gain: 0.12 });
  },
  success: (b) => {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(b, 0.02 + i * 0.08, f, i === 3 ? 0.45 : 0.14, { type: 'triangle', gain: 0.22 }));
    bell(b, 0.26, 2093, 0.5, 0.06);
  },
  drag: (b) => noise(b, 0.02, 0.5, 0.05, { filter: 1800 }),
  question: (b) => {
    tone(b, 0.02, 523.3, 0.16, { gain: 0.2, slide: 784 });
    tone(b, 0.19, 659.3, 0.24, { gain: 0.2, slide: 987.8 });
  },
  giggle: (b) => {
    [1200, 1500, 1250, 1600, 1300].forEach((f, i) => tone(b, 0.02 + i * 0.065, f, 0.05, { gain: 0.14, slide: f * 1.15 }));
  },
  boop: (b) => tone(b, 0.02, 1400, 0.08, { type: 'triangle', gain: 0.16, slide: 700 }),
  purr: (b) => tone(b, 0.02, 70, 0.9, { type: 'sawtooth', gain: 0.08, vibrato: 9, filter: 320 }),
  dizzy: (b) => tone(b, 0.02, 900, 0.8, { gain: 0.13, slide: 300, vibrato: 40 }),
  sparkle: (b) => {
    [1568, 2093, 2637, 3136].forEach((f, i) => bell(b, 0.02 + i * 0.05, f, 0.35, 0.06));
  },
  levelup: (b) => {
    [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => tone(b, 0.02 + i * 0.07, f, i === 4 ? 0.5 : 0.12, { type: 'triangle', gain: 0.18 }));
    bell(b, 0.37, 2093, 0.6, 0.08);
  },
  whoosh: (b) => noise(b, 0.02, 0.45, 0.12, { filter: 3000 }),
  munch: (b) => {
    for (let i = 0; i < 4; i++) tone(b, 0.02 + i * 0.12, 220 + (i % 2) * 60, 0.07, { type: 'square', gain: 0.07, filter: 900, slide: 160 });
    tone(b, 0.52, 880, 0.15, { gain: 0.12, slide: 1175 });
  },
};

for (const [name, make] of Object.entries(SFX)) {
  const b = buffer(1.4);
  make(b);
  writeWav(path.join(OUT, 'sfx', `${name}.wav`), b, 0.95, 1.4);
}

// ---------- Musik latar ----------
// 100 BPM, progresi I–V–vi–IV di C mayor (C, G, Am, F), pad lembut + bass + kick/hat, sedikit melodi lonceng.

const BPM = 100;
const BEAT = 60 / BPM;
const SECONDS = 62;
const music = buffer(SECONDS + 1);

const CHORDS = [
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
];
const BASS = [65.41, 49.0, 55.0, 43.65];
const MELODY = [784, 659.3, 587.3, 659.3, 784, 880, 784, 659.3, 587.3, 523.3, 587.3, 659.3, 523.3, 440, 523.3, 587.3];

const bars = Math.ceil(SECONDS / (BEAT * 4));
for (let bar = 0; bar < bars; bar++) {
  const t = bar * BEAT * 4;
  const chord = CHORDS[bar % 4];
  // Pad: tiap nada akor, dua osilator sedikit berbeda supaya hangat.
  for (const f of chord) {
    tone(music, t, f, BEAT * 4, { type: 'triangle', gain: 0.05, attack: 0.25, filter: 1400 });
    tone(music, t, f * 1.003, BEAT * 4, { type: 'sine', gain: 0.04, attack: 0.3 });
  }
  // Bass di ketukan 1 dan 3.
  tone(music, t, BASS[bar % 4], BEAT * 1.6, { type: 'sine', gain: 0.22, attack: 0.01 });
  tone(music, t + BEAT * 2, BASS[bar % 4], BEAT * 1.4, { type: 'sine', gain: 0.18, attack: 0.01 });
  for (let beat = 0; beat < 4; beat++) {
    const bt = t + beat * BEAT;
    // Kick lembut di 1 & 3, "snare" noise di 2 & 4, hi-hat tiap setengah ketuk.
    if (beat % 2 === 0) tone(music, bt, 110, 0.18, { gain: 0.3, slide: 45, attack: 0.002 });
    else noise(music, bt, 0.16, 0.07, { filter: 2400 });
    noise(music, bt + BEAT / 2, 0.05, 0.03, { filter: 9000 });
    noise(music, bt, 0.04, 0.02, { filter: 9000 });
  }
  // Melodi lonceng mulai bar ke-3 (setelah intro), 4 nada per bar.
  if (bar >= 2 && bar < bars - 1) {
    for (let n = 0; n < 4; n++) {
      const note = MELODY[((bar - 2) * 4 + n) % MELODY.length];
      bell(music, t + n * BEAT + (n % 2 ? BEAT * 0.5 : 0), note, 0.9, 0.035);
    }
  }
}

// Fade-out 2 detik terakhir.
const fadeStart = (SECONDS - 2) * RATE;
for (let i = Math.floor(fadeStart); i < music.length; i++) {
  music[i] *= Math.max(0, 1 - (i - fadeStart) / (2 * RATE));
}
writeWav(path.join(OUT, 'music.wav'), music, 0.95, 3);

console.log(`ok: ${Object.keys(SFX).length} efek + musik ${SECONDS} dtk di ${OUT}`);
