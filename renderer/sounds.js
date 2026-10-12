'use strict';

// Suara Zenopod: semuanya disintesis dengan Web Audio (tanpa file audio).
// KapsulSound.play(nama, volume 0..1)

(() => {
  let ctx = null;

  function audio() {
    if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Satu nada dengan amplop attack/decay, bisa meluncur ke frekuensi lain dan bergetar (vibrato).
  function tone(out, t, freq, dur, { type = 'sine', gain = 0.25, attack = 0.008, slide = null, vibrato = 0, filter = null } = {}) {
    const c = out.context;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = 7;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc.connect(env);
    if (filter) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = filter;
      node = node.connect(lp);
    }
    node.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Lonceng: nada dasar + harmonik, meluruh pelan.
  function bell(out, t, freq, dur = 0.8, gain = 0.2) {
    tone(out, t, freq, dur, { gain, attack: 0.004 });
    tone(out, t, freq * 2.0, dur * 0.6, { gain: gain * 0.3, attack: 0.004 });
    tone(out, t, freq * 3.01, dur * 0.35, { gain: gain * 0.12, attack: 0.004 });
  }

  const SOUNDS = {
    // --- Notifikasi & Claude ---
    notif: (o, t) => {
      bell(o, t, 987.8, 0.5, 0.16);
      bell(o, t + 0.09, 1318.5, 0.7, 0.16);
    },
    success: (o, t) => {
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(o, t + i * 0.08, f, i === 3 ? 0.45 : 0.14, { type: 'triangle', gain: 0.22 }));
      bell(o, t + 0.24, 2093, 0.5, 0.06);
    },
    attention: (o, t) => {
      tone(o, t, 880, 0.12, { gain: 0.22 });
      tone(o, t + 0.16, 880, 0.18, { gain: 0.22 });
    },
    question: (o, t) => {
      tone(o, t, 523.3, 0.16, { gain: 0.2, slide: 784 });
      tone(o, t + 0.17, 659.3, 0.24, { gain: 0.2, slide: 987.8 });
    },
    error: (o, t) => {
      tone(o, t, 440, 0.22, { type: 'triangle', gain: 0.2, slide: 349.2 });
      tone(o, t + 0.22, 329.6, 0.4, { type: 'triangle', gain: 0.2, slide: 261.6, vibrato: 6 });
    },
    hello: (o, t) => {
      tone(o, t, 600, 0.12, { gain: 0.2, slide: 900 });
      tone(o, t + 0.13, 900, 0.18, { gain: 0.2, slide: 1250 });
    },

    // --- Pengingat & fokus ---
    alarm: (o, t) => {
      for (let i = 0; i < 2; i++) {
        bell(o, t + i * 0.42, 1046.5, 0.35, 0.2);
        bell(o, t + i * 0.42 + 0.14, 1318.5, 0.45, 0.2);
      }
    },
    chime: (o, t) => {
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => bell(o, t + i * 0.07, f, 1.1, 0.12));
    },
    wake: (o, t) => {
      for (let i = 0; i < 3; i++) tone(o, t + i * 0.11, 1174.7, 0.07, { type: 'triangle', gain: 0.2 });
    },

    // --- Dev ---
    uhoh: (o, t) => {
      tone(o, t, 587.3, 0.18, { type: 'triangle', gain: 0.22 });
      tone(o, t + 0.2, 440, 0.32, { type: 'triangle', gain: 0.22, slide: 415.3 });
    },

    // --- Cuaca & baterai ---
    rain: (o, t) => {
      [1760, 1397, 1568, 1175, 1319].forEach((f, i) => tone(o, t + i * 0.09 + (i % 2) * 0.02, f, 0.07, { gain: 0.1, slide: f * 0.8 }));
    },
    lowbat: (o, t) => {
      [659.3, 523.3, 392].forEach((f, i) => tone(o, t + i * 0.16, f, i === 2 ? 0.4 : 0.14, { type: 'triangle', gain: 0.16, slide: i === 2 ? 330 : null }));
    },
    charge: (o, t) => {
      tone(o, t, 330, 0.28, { type: 'triangle', gain: 0.14, slide: 990 });
      tone(o, t + 0.28, 1318.5, 0.12, { gain: 0.14 });
    },

    // --- Halaman kartu (swipe) ---
    swipe: (o, t) => tone(o, t, 520, 0.12, { type: 'triangle', gain: 0.1, slide: 780, filter: 2500 }),
    note: (o, t) => {
      tone(o, t, 659.3, 0.12, { type: 'triangle', gain: 0.16 });
      tone(o, t + 0.1, 784, 0.12, { type: 'triangle', gain: 0.16 });
      tone(o, t + 0.2, 1046.5, 0.22, { type: 'triangle', gain: 0.16 });
    },
    ticktock: (o, t) => {
      tone(o, t, 1900, 0.035, { type: 'square', gain: 0.07, filter: 3000 });
      tone(o, t + 0.22, 1500, 0.035, { type: 'square', gain: 0.07, filter: 3000 });
    },
    today: (o, t) => {
      bell(o, t, 784, 0.4, 0.1);
      bell(o, t + 0.08, 1174.7, 0.5, 0.1);
    },

    // --- Peliharaan ---
    munch: (o, t) => {
      for (let i = 0; i < 4; i++) tone(o, t + i * 0.12, 220 + (i % 2) * 60, 0.07, { type: 'square', gain: 0.07, filter: 900, slide: 160 });
      tone(o, t + 0.5, 880, 0.15, { gain: 0.12, slide: 1175 });
    },
    levelup: (o, t) => {
      [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => tone(o, t + i * 0.07, f, i === 4 ? 0.5 : 0.12, { type: 'triangle', gain: 0.18 }));
      bell(o, t + 0.35, 2093, 0.6, 0.08);
    },

    // --- Maskot ---
    pop: (o, t) => tone(o, t, 380, 0.09, { gain: 0.25, slide: 1150 }),
    giggle: (o, t) => {
      [1200, 1500, 1250, 1600, 1300].forEach((f, i) => tone(o, t + i * 0.065, f, 0.05, { gain: 0.14, slide: f * 1.15 }));
    },
    grumble: (o, t) => tone(o, t, 150, 0.35, { type: 'sawtooth', gain: 0.12, slide: 120, vibrato: 12, filter: 600 }),
    angry: (o, t) => {
      tone(o, t, 120, 0.22, { type: 'square', gain: 0.1, slide: 95, vibrato: 18, filter: 700 });
      tone(o, t + 0.24, 110, 0.3, { type: 'square', gain: 0.1, slide: 85, vibrato: 18, filter: 700 });
    },
    cry: (o, t) => tone(o, t, 720, 0.7, { gain: 0.16, slide: 420, vibrato: 14 }),
    blip: (o, t) => tone(o, t, 880, 0.09, { type: 'triangle', gain: 0.18, slide: 1320 }),
    tick: (o, t) => {
      tone(o, t, 1568, 0.05, { gain: 0.14 });
      tone(o, t + 0.06, 2093, 0.08, { gain: 0.12 });
    },
  };

  function play(name, volume = 0.6) {
    const sound = SOUNDS[name];
    if (!sound || volume <= 0) return;
    try {
      const c = audio();
      const master = c.createGain();
      master.gain.value = Math.min(1, Math.max(0, volume));
      master.connect(c.destination);
      sound(master, c.currentTime + 0.02);
    } catch {
      // tanpa suara
    }
  }

  // Kategori untuk saklar di Pengaturan.
  const CATEGORY = {
    notif: 'notifications',
    success: 'claude',
    attention: 'claude',
    question: 'claude',
    error: 'claude',
    alarm: 'reminders',
    chime: 'reminders',
    wake: 'reminders',
    uhoh: 'dev',
    hello: 'buddy',
    pop: 'buddy',
    giggle: 'buddy',
    grumble: 'buddy',
    angry: 'buddy',
    cry: 'buddy',
    blip: 'buddy',
    tick: 'buddy',
    swipe: 'buddy',
    note: 'buddy',
    ticktock: 'buddy',
    today: 'buddy',
    munch: 'buddy',
    levelup: 'buddy',
    rain: 'weather',
    lowbat: 'weather',
    charge: 'weather',
  };

  window.KapsulSound = { play, names: Object.keys(SOUNDS), category: (name) => CATEGORY[name] };
})();
