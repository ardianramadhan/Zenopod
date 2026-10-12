'use strict';

// Pomodoro: fokus → istirahat pendek, setiap N sesi fokus → istirahat panjang.
// state: { phase: 'focus'|'break'|'long'|null, running, endsAt, remaining, cycle, done }
//   running=false + phase terisi = dijeda / menunggu dimulai (remaining = sisa waktu).

class Focus {
  constructor({ settings, onChange, onPhaseEnd }) {
    this.settings = settings; // () => { focusMinutes, breakMinutes, longBreakMinutes, cycles, autoStartBreak }
    this.onChange = onChange;
    this.onPhaseEnd = onPhaseEnd;
    this.timer = null;
    this.state = { phase: null, running: false, endsAt: null, remaining: 0, cycle: 1, done: 0 };
  }

  minutes(phase) {
    const s = this.settings();
    return { focus: s.focusMinutes, break: s.breakMinutes, long: s.longBreakMinutes }[phase] * 60_000;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.state.running) this.timer = setTimeout(() => this.finish(), Math.max(0, this.state.endsAt - Date.now()));
  }

  // Mulai fase (default: fokus). Fase yang sedang dijeda dilanjutkan dari sisanya.
  start(phase) {
    const next = phase ?? this.state.phase ?? 'focus';
    const resume = !phase && this.state.phase && !this.state.running && this.state.remaining > 0;
    const duration = resume ? this.state.remaining : this.minutes(next);
    this.set({ phase: next, running: true, endsAt: Date.now() + duration, remaining: duration });
    this.schedule();
  }

  pause() {
    if (!this.state.running) return;
    this.set({ running: false, remaining: Math.max(0, this.state.endsAt - Date.now()), endsAt: null });
    this.schedule();
  }

  stop() {
    clearTimeout(this.timer);
    this.set({ phase: null, running: false, endsAt: null, remaining: 0, cycle: 1 });
  }

  skip() {
    if (this.state.phase) this.finish();
  }

  // Fase habis: tentukan fase berikutnya. Istirahat bisa langsung berjalan;
  // fokus berikutnya selalu menunggu kamu menekan Mulai.
  finish() {
    clearTimeout(this.timer);
    const { phase, cycle, done } = this.state;
    const { cycles, autoStartBreak } = this.settings();

    if (phase === 'focus') {
      const next = cycle % cycles === 0 ? 'long' : 'break';
      this.set({ phase: next, running: false, endsAt: null, remaining: this.minutes(next), done: done + 1 });
      if (autoStartBreak) this.start(next);
    } else {
      this.set({ phase: 'focus', running: false, endsAt: null, remaining: this.minutes('focus'), cycle: phase === 'long' ? 1 : cycle + 1 });
    }
    this.onPhaseEnd(phase, this.state);
  }
}

module.exports = { Focus };
