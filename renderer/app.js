'use strict';

const $ = (id) => document.getElementById(id);
// Aktivitas live (privasi, rapat, unduhan) — diisi lewat onLive.
let live = { privacy: { mic: [], camera: [] }, meeting: null, downloads: [] };
const shell = $('shell');
const appsEl = $('apps');

let media = { playing: false, title: null };
let claudeState = { active: [] };
let focusState = { phase: null, running: false, endsAt: null, remaining: 0, cycle: 1, done: 0 };
let focusSettings = { focusMinutes: 25, cycles: 4 };
let open = false;
let peekState = null;
let lastPeek = { kind: null, at: 0 };
let calendarEvents = null; // null = kalender belum disambungkan
let habitItems = [];
let systemNow = null;

// Claude sedang bekerja (berpikir / menjalankan tool) atau menunggu jawaban.
const claudeBusy = () => claudeState.active.some((s) => s.state === 'thinking' || s.state === 'working');
const claudeWaiting = () => claudeState.active.some((s) => s.state === 'waiting');

// ---------- Buka / tutup ----------

// Menutup saat kursor pergi diurus proses utama (lebih andal daripada mouseleave).
// Hover membuka panel setelah 0,3 dtk (supaya kapsul sempat "dipegang" untuk digeser).
// Selama kartu peek tampil, hover tidak membuka panel (supaya tombolnya bisa diklik).
let hoverTimer = null;
let afterDrag = false;

shell.addEventListener('mouseenter', () => {
  if (open || peekState || afterDrag) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => window.kapsul.expand(true), 300);
});
shell.addEventListener('mouseleave', () => {
  clearTimeout(hoverTimer);
  afterDrag = false;
});

// Tekan lalu seret (kapsul kecil, atau pegangan ⋮⋮ di panel) = pindahkan Zenopod.
function makeDraggable(handle, { clickToOpen = false } = {}) {
  let start = null;
  let dragging = false;
  let frame = 0;
  let last = { dx: 0, dy: 0 };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button:not(.grip)')) return;
    clearTimeout(hoverTimer);
    start = { x: event.screenX, y: event.screenY };
    dragging = false;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!start) return;
    last = { dx: event.screenX - start.x, dy: event.screenY - start.y };
    if (!dragging && Math.hypot(last.dx, last.dy) > 5) {
      dragging = true;
      shell.classList.add('dragging');
      window.kapsul.dragStart();
    }
    if (dragging && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        window.kapsul.dragMove(last.dx, last.dy);
      });
    }
  });
  const release = () => {
    if (!start) return;
    start = null;
    if (dragging) {
      dragging = false;
      afterDrag = true;
      shell.classList.remove('dragging');
      window.kapsul.dragMove(last.dx, last.dy);
      window.kapsul.dragEnd();
      sfx('tick');
    } else if (clickToOpen && !open) {
      window.kapsul.expand(true, true);
    }
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}

// Panel dibuka = hanya kartu atas; isi bawah (detail) dibuka lewat kartu, gagang ⌄, atau panah bawah.
let detail = false;

function setDetail(value, { sync = true } = {}) {
  if (value === detail) return;
  detail = value;
  shell.classList.toggle('detail', value);
  $('detail-btn').setAttribute('aria-expanded', String(value));
  $('detail-btn').title = value ? 'Sembunyikan detail' : 'Tampilkan detail';
  $('detail-btn').setAttribute('aria-label', $('detail-btn').title);
  if (sync) window.kapsul.detail(value);
  if (value) {
    sfx('swipe');
    // Ukuran isi bawah baru benar setelah panel melebar (mis. posisi lirik).
    setTimeout(renderPage, 240);
  }
}

$('detail-btn').addEventListener('click', () => setDetail(!detail));
// Klik kartu atas (bukan tombolnya) = buka detail.
$('hero-view').addEventListener('click', (event) => {
  if (!event.target.closest('button, a, input')) setDetail(true);
});

window.kapsul.onExpanded((value) => {
  open = value;
  shell.classList.toggle('open', value);
  if (!value) setDetail(false, { sync: false });
  // Panel dibuka tak lama setelah notifikasi tampil = langsung ke Kotak masuk.
  if (value && lastPeek.kind === 'notification' && Date.now() - lastPeek.at < 4000) {
    setInboxMode('notifs');
    goToSection('inbox', { sound: false });
  }
  // "Lihat detail" di laporan mingguan → detail Perangkat (waktu layar).
  if (value && lastPeek.kind === 'weekly' && Date.now() - lastPeek.at < 20_000) {
    lastPeek = { kind: null, at: 0 };
    goToSection('device', { sound: false });
    setDetail(true);
  }
  if (!value) {
    hoveringBig = false;
    if (!$('power-sheet').hidden) closePower();
    $('app-search').value = '';
    renderSearch();
  }
  if (value) renderPage();
  renderBuddy();
  if (value) window.kapsul.media('refresh');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('power-sheet').hidden) return closePower();
    if (detail && !(event.target === $('app-search') && $('app-search').value)) return setDetail(false);
    if (event.target === $('app-search') && $('app-search').value) {
      $('app-search').value = '';
      renderSearch();
      return;
    }
    window.kapsul.expand(false);
    return;
  }
  if (!open || event.target instanceof HTMLInputElement) return;
  // Panel terbuka + ketik huruf = langsung cari aplikasi (di Beranda).
  if (/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey && $('power-sheet').hidden) {
    goToSection('home', { sound: false });
    setDetail(true);
    $('app-search').focus();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    setDetail(event.key === 'ArrowDown');
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    goToPage(pageIndex + (event.key === 'ArrowRight' ? 1 : -1));
    return;
  }
  if (/^[1-9]$/.test(event.key)) {
    launch(Number(event.key) - 1);
  } else if (event.key === ' ' && event.target === document.body) {
    event.preventDefault();
    window.kapsul.media('toggle');
  }
});

// ---------- Mode jam di kapsul ----------
// Tanpa aktivitas (kursor diam) 30 dtk: Zeno menghilang, kapsul hanya menampilkan jam di tengah;
// baterai, notifikasi, dan indikator musik tetap tampil. Kursor bergerak = Zeno bangun lagi.
// Yang mendesak (suara, Claude menunggu, fokus, timer, kartu, reaksi) tetap memakai tampilan biasa.
const REST_AFTER_MS = 30_000;
let resting = false;

function updateResting() {
  const should = !open && !peekState && !voiceState && !saying && !reaction && !pillOverride() && Date.now() - lastMove > REST_AFTER_MS;
  if (should === resting) {
    if (resting) renderPillClock();
    return;
  }
  resting = should;
  shell.classList.toggle('resting', resting);
  // Masuk mode jam: kedua slot mulai dari isi pertama.
  if (resting) {
    for (const slot of Object.values(restSlots)) Object.assign(slot, { index: 0, since: Date.now() });
    renderPillClock();
  }
  else wakeUp();
}

// Mode jam: jam di tengah tetap. Slot kiri & kanan bergantian hanya kalau isinya lebih dari satu:
//   kiri  = baterai / mic-kamera dipakai / timer / pengingat hari ini
//   kanan = musik (equalizer) / notifikasi / server dev mati / panggilan / unduhan
const REST_SLOT_MS = 4000;
const restSlots = { left: { index: 0, since: 0 }, right: { index: 0, since: 0 } };
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const restText = (icon, text, tone = '') => ({ html: `<span class="rest-chip ${tone}">${icon}<b>${escapeHtml(text)}</b></span>`, sig: text });

function restActivityItems() {
  const items = [];
  if (media.playing) items.push({ key: 'music', html: '<span class="rest-eq"><i></i><i></i><i></i></span>', sig: '' });
  const count = notifs.items.length;
  if (count) items.push({ key: 'notif', ...restText('<i class="rest-dot notif"></i>', count > 9 ? '9+' : String(count)) });
  const down = (lastDev?.services ?? []).filter((x) => x.status === 'down').length;
  if (down) items.push({ key: 'dev', ...restText('<i class="rest-dot dev"></i>', String(down)) });
  if (live.meeting) items.push({ key: 'meeting', ...restText(PILL_ICONS.mic, clock(Date.now() - live.meeting.since), live.meeting.muted ? 'muted' : 'on-call') });
  if (live.downloads[0]) items.push({ key: 'download', ...restText(PILL_ICONS.download, sizeLabel(live.downloads[0].bytes)) });
  return items;
}

function restStatusItems() {
  const items = [];
  if (battery && hasBattery) {
    // Ikon baterai yang sama dengan kapsul biasa (angka di dalam, petir saat mengisi).
    const bat = $('pill-battery').cloneNode(true);
    bat.removeAttribute('id');
    bat.hidden = false;
    for (const el of bat.querySelectorAll('[id]')) el.removeAttribute('id');
    // Elemen langsung (bukan HTML): lebar isi baterai memakai style inline yang diblokir CSP lewat innerHTML.
    items.push({ key: 'battery', node: bat, sig: `${Math.round(battery.level * 100)}|${battery.charging}` });
  }
  const mic = live.privacy.mic.length > 0;
  const cam = live.privacy.camera.length > 0;
  if (mic || cam) items.push({ key: 'privacy', html: `<span class="rest-chip">${mic ? '<i class="rest-dot mic"></i>' : ''}${cam ? '<i class="rest-dot cam"></i>' : ''}</span>`, sig: `${mic}|${cam}` });
  const timer = quickTimers[0];
  if (timer) items.push({ key: 'timer', ...restText(PILL_ICONS.bell, clock(timer.endsAt - Date.now())) });
  if (nextReminder && /^Hari ini/.test(nextReminder.when)) items.push({ key: 'reminder', ...restText(PILL_ICONS.calendar, nextReminder.when.replace(/^Hari ini\s*/, '').replace('.', ':')) });
  return items;
}

function renderRestSlot(name, items) {
  const el = $(`rest-${name}`);
  const slot = restSlots[name];
  if (!items.length) {
    if (el.dataset.key) el.replaceChildren();
    delete el.dataset.key;
    delete el.dataset.sig;
    return;
  }
  const now = Date.now();
  if (slot.index >= items.length) slot.index = 0;
  if (items.length > 1 && now - slot.since >= REST_SLOT_MS) {
    slot.index = (slot.index + 1) % items.length;
    slot.since = now;
  }
  const item = items[slot.index];
  const sig = `${item.key}|${item.sig}`;
  if (el.dataset.sig === sig) return;
  const changed = el.dataset.key !== item.key;
  el.dataset.sig = sig;
  el.dataset.key = item.key;
  const wrap = document.createElement('span');
  wrap.className = `rest-slot-item${changed ? ' enter' : ''}`;
  if (item.node) wrap.append(item.node);
  else wrap.innerHTML = item.html;
  el.replaceChildren(wrap);
}

function renderPillClock() {
  const now = new Date();
  const clockEl = $('pill-clock');
  const text = `${String(now.getHours()).padStart(2, '0')}|${String(now.getMinutes()).padStart(2, '0')}`;
  if (clockEl.dataset.text !== text) {
    clockEl.dataset.text = text;
    const [h, m] = text.split('|');
    const colon = document.createElement('span');
    colon.className = 'colon';
    colon.textContent = ':';
    clockEl.replaceChildren(h, colon, m);
  }
  renderRestSlots();
}

// Slot kiri & kanan dipakai di mode jam dan saat Zeno diam di tengah.
function renderRestSlots() {
  renderRestSlot('left', restStatusItems());
  renderRestSlot('right', restActivityItems());
}

// Bangun tidur: muncul kecil sambil menggeliat, lalu menguap sebentar.
function wakeUp() {
  const el = buddy.el;
  el.classList.remove('waking');
  void el.getBoundingClientRect();
  el.classList.add('waking');
  setTimeout(() => el.classList.remove('waking'), 1000);
  react('yawn', 1400);
}

// Tanpa aktivitas: Zeno diam di tengah kapsul (teks slide disembunyikan). Ada aktivitas: kembali
// ke kiri dan teksnya muncul.
let centered = false;

function hasActivity() {
  return Boolean(
    media.playing ||
      focusState.phase ||
      claudeState.active.length ||
      quickTimers.length ||
      live.meeting ||
      live.downloads.length ||
      systemNow?.online === false ||
      pillOverride(),
  );
}

function updateCentered() {
  const should = !open && !hasActivity();
  if (should) {
    // Tengah kapsul dihitung ulang (lebar kapsul bisa berubah): setengah lebar − padding kiri − setengah Zeno.
    const pill = $('pill');
    const pad = parseFloat(getComputedStyle(pill).paddingLeft) || 0;
    shell.style.setProperty('--buddy-center', `${Math.max(0, pill.clientWidth / 2 - pad - 15).toFixed(1)}px`);
  }
  if (should !== centered) {
    centered = should;
    shell.classList.toggle('centered', centered);
    if (centered) for (const slot of Object.values(restSlots)) Object.assign(slot, { index: 0, since: Date.now() });
  }
  // Mode jam merender slotnya sendiri (renderPillClock).
  if (centered && !resting) renderRestSlots();
}

setInterval(() => {
  updateResting();
  updateCentered();
}, 1000);

// ---------- Maskot ----------

// Dua maskot: kecil di kapsul, besar di panel (komponen dari buddy.js).
const buddy = window.createBuddy();
const bigBuddy = window.createBuddy();
const peekBuddy = window.createBuddy();
$('buddy-slot').replaceWith(buddy.el);
$('buddy-big').append(bigBuddy.el);
$('peek-slot').append(peekBuddy.el);

const IDLE_SLEEP_MS = 3 * 60 * 1000;
let lastMove = Date.now();
let hoveringBig = false;
let reaction = null;
let reactionTimer = null;

function isNight() {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

function sleepy() {
  return isNight() || Date.now() - lastMove > IDLE_SLEEP_MS;
}

// Ekspresi dasar tanpa reaksi.
// Zenopod: musik > tidur (malam / kursor diam 3 menit) > biasa.
// Panel: musik > senang; disentuh kursor = jatuh cinta.
// Claude bekerja = berpikir; Claude menunggu jawaban = kaget memanggil.
// Fokus = berkacamata, istirahat = peregangan.
function renderBuddy() {
  const busy = claudeBusy();
  const tired = lowBattery() && !busy;
  const resting = (focusState.phase === 'break' || focusState.phase === 'long') && focusState.running;
  const focused = focusState.phase === 'focus' && focusState.running;
  const work = busy ? 'think' : focused ? 'focus' : resting ? 'stretch' : null;
  if (voiceState) {
    const mood = voiceState === 'listening' ? 'hear' : 'think';
    buddy.setMood(mood);
    bigBuddy.setMood(mood);
    return;
  }
  buddy.setMood(reaction ?? (claudeWaiting() ? 'surprised' : tired ? 'lowbat' : work ?? (sleepy() && !media.playing ? 'sleep' : (pillSlide?.mood ?? (media.playing ? 'music' : 'idle')))));
  bigBuddy.setMood(reaction ?? (hoveringBig ? 'love' : tired ? 'lowbat' : pageMood()));
}

// Reaksi sementara, lalu kembali ke ekspresi dasar.
function react(mood, ms) {
  reaction = mood;
  renderBuddy();
  clearTimeout(reactionTimer);
  reactionTimer = setTimeout(() => {
    reaction = null;
    clicks = 0;
    renderBuddy();
  }, ms);
}

// ---------- Interaksi dengan Zeno ----------
// Bagian yang diklik menentukan reaksi: kepala = dielus, pipi = dicolek, tengah = hidung (boop),
// bawah = digelitik. Klik beruntun makin lama makin kesal: bingung → cemberut → kesal → marah →
// menangis → pusing → ngambek (klik diabaikan sebentar, lalu baikan lagi).
// Panel: tahan = dipencet, elus (kursor bolak-balik di atas Zeno) = mendengkur, klik dua kali = salto.

let clicks = 0;
let lastClick = 0;
let lastLine = null;
let sulkUntil = 0;
let makeUp = false;
let ignoreClickUntil = 0;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Pilihan acak yang tidak sama dengan sebelumnya, supaya terasa variatif.
function pickFresh(list, previous) {
  const options = list.length > 1 ? list.filter((item) => item !== previous) : list;
  return pick(options);
}

const ZONE_REACTIONS = {
  head: [
    { mood: 'purr', sound: 'pat', anim: 'pat', say: ['Hehe, enak dielus~', 'Lagi dong~', 'Nyaman…'] },
    { mood: 'shy', sound: 'shy', anim: 'pat', say: ['Ih, jadi malu…', 'Hehe… makasih'] },
    { mood: 'happy', sound: 'pat', anim: 'pat', say: ['Hihi~', 'Aku anak baik ya?'] },
  ],
  cheek: [
    { mood: 'surprised', sound: 'boing', anim: 'boing', say: ['Boing!', 'Eh, pipiku!'] },
    { mood: 'pout', sound: 'boing', anim: 'boing', say: ['Jangan dicubit…', 'Pipiku empuk ya?'] },
    { mood: 'wink', sound: 'boing', anim: 'boing', say: ['Hehe~', 'Colek balik!'] },
  ],
  nose: [
    { mood: 'boop', sound: 'boop', say: ['Boop!', 'Hidungku!'] },
    { mood: 'starstruck', sound: 'sparkle', anim: 'jump', say: ['Wah, halo!', 'Ada apa nih?'] },
    { mood: 'kiss', sound: 'boop', say: ['Muah~', 'Hehe, boop balik'] },
    { mood: 'mischief', sound: 'giggle', say: ['Hehehe…', 'Aku punya rencana…'] },
  ],
  tummy: [
    { mood: 'tickle', sound: 'giggle', say: ['Hahaha geli!', 'Ampun, geli!', 'Hihihi!'] },
    { mood: 'laugh', sound: 'giggle', anim: 'jump', say: ['Hehehe!', 'Jangan di situ!'] },
  ],
};

// Klik beruntun (jarak < 1,5 dtk). Sebelum tahap ini: reaksi per bagian yang diklik.
const ESCALATION = [
  { from: 12, mood: 'dizzy', sound: 'dizzy', anim: 'spin', ms: 2400, say: ['Pusing… muter-muter…', 'Bintangnya banyak…'] },
  { from: 10, mood: 'cry', sound: 'cry', ms: 4000, say: ['Huaaa… jahat…', 'Hiks… sakit…'] },
  { from: 8, mood: 'angry', sound: 'angry', ms: 3500, say: ['IH! Aku marah!', 'Grrr!'] },
  { from: 6, mood: 'annoyed', sound: 'grumble', ms: 2600, say: ['Berhenti dong!', 'Aku lagi kerja lho…'] },
  { from: 4, mood: 'pout', sound: 'hmph', ms: 2400, say: ['Ih, udah dong…', 'Hmph!'] },
  { from: 3, mood: 'confused', sound: 'boop', ms: 2000, say: ['Hm? Kenapa?', 'Ada apa sih?'] },
];

function zoneOf(el, event) {
  const rect = el.getBoundingClientRect();
  if (!rect.width) return 'nose';
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (y < 0.42) return 'head';
  if (y > 0.74) return 'tummy';
  if (Math.abs(x - 0.5) > 0.2) return 'cheek';
  return 'nose';
}

// Balon kata: di panel muncul di samping Zeno besar, di kapsul tampil sebagai teks kapsul.
let saying = null;
let sayTimer = null;

function say(lines, ms = 1900) {
  const text = pickFresh(lines, lastLine);
  lastLine = text;
  saying = text;
  const bubble = $('buddy-say');
  bubble.textContent = text;
  bubble.hidden = !open;
  bubble.classList.remove('pop');
  void bubble.offsetWidth;
  bubble.classList.add('pop');
  renderPillText();
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => {
    saying = null;
    bubble.hidden = true;
    renderPillText();
  }, ms);
}

function perform(target, reaction, ms = 1800) {
  react(reaction.mood, reaction.ms ?? ms);
  if (reaction.anim === 'jump') target.jump();
  else if (reaction.anim) target.play(reaction.anim);
  if (reaction.sound) sfx(reaction.sound);
  if (reaction.say) say(reaction.say);
}

// Klik pertama yang mengikuti keadaan: dibangunkan, sedang fokus, lagu diputar, lapar.
function contextReaction() {
  if (sleepy() && !media.playing && !open) {
    lastMove = Date.now();
    return { mood: 'yawn', sound: 'yawn', ms: 1900, say: ['Hoaam… aku bangun!', 'Lima menit lagi…'] };
  }
  if (focusState.phase === 'focus' && focusState.running) return { mood: 'pout', sound: 'hmph', say: ['Ssst, lagi fokus nih!', 'Nanti dulu, fokus!'] };
  if ((petState?.hunger ?? 100) < 25) return { mood: 'hungry', sound: 'hmph', ms: 2200, say: ['Laper… kasih makan dong', 'Perutku bunyi…'] };
  if (media.playing && Math.random() < 0.85) {
    return Math.random() < 0.5
      ? { mood: 'music', sound: 'note', anim: 'spin', ms: 1600, say: ['Ayo joget!', '♪ Muter dulu~', 'Lagunya enak banget!'] }
      : { mood: 'music', sound: 'note', anim: 'jump', ms: 1400, say: ['♪ Asik!', 'Naik-naik~', 'Goyang terus!'] };
  }
  return null;
}

let lastZoneReaction = null;

function poke(target, event) {
  const now = Date.now();
  if (now < ignoreClickUntil) return;

  // Ngambek: klik tidak dihitung, Zeno cuma mendengus.
  if (now < sulkUntil) {
    target.play('boing');
    sfx('hmph');
    say(['Hmph!', 'Nggak denger…', 'Aku masih ngambek.', '…']);
    return;
  }
  // Klik pertama sesudah ngambek = baikan.
  if (makeUp) {
    makeUp = false;
    clicks = 0;
    perform(target, { mood: 'shy', sound: 'shy', anim: 'pat', ms: 2400, say: ['Iya iya, aku maafin…', 'Jangan gitu lagi ya…'] });
    return;
  }

  clicks = now - lastClick < 1500 ? clicks + 1 : 1;
  lastClick = now;

  const stage = ESCALATION.find((s) => clicks >= s.from);
  if (stage) {
    perform(target, stage);
    if (stage.mood === 'dizzy') {
      // Setelah pusing: ngambek beberapa detik, lalu mau baikan.
      sulkUntil = now + 2400 + 7000;
      setTimeout(() => {
        react('sulk', 7000);
        say(['Hmph, aku ngambek.', 'Udah, aku nggak mau main.']);
        setTimeout(() => {
          makeUp = true;
          clicks = 0;
        }, 7000);
      }, 2400);
    }
    return;
  }

  const context = clicks === 1 ? contextReaction() : null;
  if (context) return perform(target, context);

  const pool = ZONE_REACTIONS[zoneOf(target.el, event)];
  const choice = pickFresh(pool, lastZoneReaction);
  lastZoneReaction = choice;
  perform(target, choice);
}

buddy.el.addEventListener('click', (event) => poke(buddy, event));
$('buddy-big').addEventListener('click', (event) => poke(bigBuddy, event));

// Klik dua kali: salto.
$('buddy-big').addEventListener('dblclick', () => {
  if (Date.now() < sulkUntil) return;
  bigBuddy.play('spin');
  react('starstruck', 1600);
  sfx('sparkle');
  say(['Salto!', 'Ta-da!', 'Wiii~']);
});

// Tahan = dipencet sampai gepeng; lepas = memantul.
(() => {
  const el = $('buddy-big');
  let timer = null;
  let held = false;
  const release = () => {
    clearTimeout(timer);
    if (!held) return;
    held = false;
    bigBuddy.hold(false);
    bigBuddy.jump();
    ignoreClickUntil = Date.now() + 350;
    react('love', 2000);
    sfx('pat');
    say(['Peluk balik!', 'Hehe, sesak tapi suka~']);
  };
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || Date.now() < sulkUntil) return;
    timer = setTimeout(() => {
      held = true;
      bigBuddy.hold(true);
      react('squish', 60_000);
      sfx('boop');
      say(['Uugh, gepeng!', 'Aku dipencet!']);
    }, 450);
  });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('pointercancel', release);
})();

// Elus-elus: kursor bolak-balik ≥ 4 kali dalam 1,2 dtk di atas Zeno besar = mendengkur.
(() => {
  let lastX = null;
  let direction = 0;
  let turns = [];
  let cooldown = 0;
  $('buddy-big').addEventListener('mousemove', (event) => {
    if (lastX !== null) {
      const dx = event.clientX - lastX;
      if (Math.abs(dx) >= 3) {
        const next = Math.sign(dx);
        if (direction && next !== direction) turns.push(Date.now());
        direction = next;
      }
    }
    lastX = event.clientX;
    const now = Date.now();
    turns = turns.filter((t) => now - t < 1200);
    if (turns.length >= 4 && now > cooldown && now > sulkUntil && !reaction) {
      turns = [];
      cooldown = now + 3500;
      bigBuddy.play('pat');
      react('purr', 2600);
      sfx('purr');
      say(['Purrr… nyaman~', 'Elus terus~', 'Zzz… enak…']);
    }
  });
  $('buddy-big').addEventListener('mouseleave', () => {
    lastX = null;
    turns = [];
  });
})();

$('buddy-big').addEventListener('mouseenter', () => {
  hoveringBig = true;
  renderBuddy();
});
$('buddy-big').addEventListener('mouseleave', () => {
  hoveringBig = false;
  renderBuddy();
});

// Sesekali berekspresi sendiri supaya tidak kaku.
const EMOTES = {
  idle: ['wink', 'smug', 'surprised', 'confused', 'kiss', 'love', 'happy'],
  happy: ['laugh', 'wink', 'love', 'kiss', 'smug'],
};

function emote() {
  const base = open ? 'happy' : 'idle';
  const usable =
    !reaction && !hoveringBig && !media.playing && !claudeBusy() && !focusState.running && !(base === 'idle' && sleepy());
  if (usable) {
    const pool = EMOTES[base];
    react(pool[Math.floor(Math.random() * pool.length)], 1800);
  }
  setTimeout(emote, 9000 + Math.random() * 11000);
}

// Kepala & mata mengikuti kursor (titik dari proses utama, relatif ke jendela).
function lookAt(target, point) {
  const rect = target.el.getBoundingClientRect();
  if (rect.width === 0) return;
  const dx = point.x - (rect.left + rect.width / 2);
  const dy = point.y - (rect.top + rect.height / 2);
  const distance = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, distance / 100);
  target.look((dx / distance) * reach, (dy / distance) * reach);
}

window.kapsul.onCursor((point) => {
  const wasSleeping = !isNight() && Date.now() - lastMove > IDLE_SLEEP_MS;
  lastMove = Date.now();
  if (resting) updateResting();
  // Dibangunkan setelah lama tidak ada gerakan: kaget sebentar.
  if (wasSleeping && !reaction && !media.playing) react('surprised', 1200);

  lookAt(buddy, point);
  if (open) lookAt(bigBuddy, point);
  if (peekState) lookAt(peekBuddy, point);
});

// ---------- Peluncur ----------

function launch(index) {
  sfx('blip');
  window.kapsul.launch(index);
  // Panel menutup dulu, lalu maskot di kapsul mengedip dan melompat.
  setTimeout(() => {
    react('wink', 1600);
    buddy.jump();
  }, 180);
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

// Island Beranda memuat 5 aplikasi pertama; detail hanya menampilkan sisanya (tidak berulang).
const QUICK_APPS = 5;

$('apps-manage').addEventListener('click', () => window.kapsul.openSettings('apps'));

function renderApps(apps) {
  appsEl.replaceChildren();
  $('apps-head').hidden = apps.length <= QUICK_APPS;
  if (apps.length > 0 && apps.length <= QUICK_APPS) {
    const hint = document.createElement('div');
    hint.className = 'empty';
    hint.textContent = 'Semua aplikasimu ada di atas. Ketik untuk mencari aplikasi lain, menghitung, atau memasang timer.';
    appsEl.append(hint);
    return;
  }
  if (apps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'empty-action';
    add.textContent = '+ Tambah aplikasi favorit';
    add.addEventListener('click', () => window.kapsul.openSettings('apps'));
    empty.append('Belum ada aplikasi di sini.', add);
    appsEl.append(empty);
    return;
  }

  for (const item of apps.slice(QUICK_APPS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app';
    button.title = item.name;
    button.addEventListener('click', () => launch(item.index));

    const icon = document.createElement('span');
    icon.className = 'app-icon';
    if (item.icon) {
      const img = document.createElement('img');
      img.src = item.icon;
      img.alt = '';
      icon.append(img);
    } else {
      icon.textContent = initials(item.name);
      icon.style.background = item.color ?? 'var(--surface-hover)';
    }

    const name = document.createElement('span');
    name.className = 'app-name';
    name.textContent = item.name;

    button.append(icon, name);

    if (item.index < 9) {
      const key = document.createElement('span');
      key.className = 'app-key';
      key.textContent = String(item.index + 1);
      button.append(key);
    }

    appsEl.append(button);
  }
}

function renderShortcut(keys) {
  const el = $('shortcut');
  el.replaceChildren();
  if (keys.length === 0) return;
  for (const key of keys) {
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    el.append(kbd);
  }
  el.append(' buka');
}

window.kapsul.onState((state) => {
  document.body.dataset.align = state.align;
  document.body.dataset.valign = state.valign ?? 'top';
  document.body.dataset.island = state.island ?? 'pill';
  delete document.body.dataset.preview;
  document.body.style.setProperty('--inset', `${state.notchInset ?? 0}px`);
  if (state.sound) soundSettings = state.sound;
  chatReady = Boolean(state.chatReady);
  chatName = state.chatName || 'AI';
  if (state.ticker && (state.ticker.enabled !== tickerSettings.enabled || state.ticker.seconds !== tickerSettings.seconds)) {
    tickerSettings = state.ticker;
    startTicker();
    renderPillText(true);
  }
  profile = { userName: state.userName ?? '', buddyName: state.buddyName ?? '' };
  renderPage();
  if (state.focus) {
    focusSettings = state.focus;
    renderFocus();
  }
  if (state.battery) {
    batterySettings = state.battery;
    renderBattery();
  }
  $('buddy-big').title = state.buddyName ? `Halo, aku ${state.buddyName}!` : 'Halo!';
  document.body.dataset.platform = state.platform ?? '';
  // macOS tidak bisa membaca notifikasi aplikasi lain: Kotak masuk hanya berisi Klip.
  const noNotifs = state.platform === 'darwin';
  $('inbox-notifs-tab').hidden = noNotifs;
  if (noNotifs && inboxMode === 'notifs') setInboxMode('clips');
  // Section Kerja: saat Claude bekerja, atau kalau ada server/project yang dipantau.
  devEnabled = Boolean(state.devEnabled);
  goToPage(pageIndex, { sound: false });
  renderShortcut(state.shortcut);
  renderApps(state.apps);
  launcherApps = state.apps;
  renderQuickApps();
});

// ---------- Notifikasi ----------

let notifs = { access: 'Unknown', items: [] };

const ago = (time) => {
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} jam`;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(time);
};

let devEnabled = false;
let inboxMode = 'notifs';

function setInboxMode(mode) {
  inboxMode = mode;
  for (const b of document.querySelectorAll('[data-inbox]')) b.setAttribute('aria-selected', String(b.dataset.inbox === mode));
  $('notifs').hidden = mode !== 'notifs';
  $('clips').hidden = mode !== 'clips';
  renderTabAction();
}

for (const b of document.querySelectorAll('[data-inbox]')) b.addEventListener('click', () => setInboxMode(b.dataset.inbox));

// Tombol aksi di tiap section (Hapus semua, Hapus yang selesai) + ringkasan Kotak masuk.
function renderTabAction() {
  const button = $('inbox-action');
  const action = (inboxMode === 'notifs' ? notifs.items.length : clipItems.length) ? 'Hapus semua' : null;
  button.hidden = !action;
  button.textContent = action ?? '';
  $('todo-clear').hidden = !todoItems.some((t) => t.done);
  renderInboxSummary();
}

$('inbox-action').addEventListener('click', () => {
  if (inboxMode === 'notifs') window.kapsul.clearNotifications();
  else window.kapsul.clip('clear');
});
$('todo-clear').addEventListener('click', () => window.kapsul.todo('clear-done'));
$('dev-refresh').addEventListener('click', () => window.kapsul.devRefresh());

function iconEl(item, className) {
  const icon = document.createElement('span');
  icon.className = className;
  if (item.icon) {
    const img = document.createElement('img');
    img.src = item.icon;
    img.alt = '';
    icon.append(img);
  } else {
    icon.textContent = (item.appName || '?').slice(0, 1).toUpperCase();
  }
  return icon;
}

let lastNotifCount = 0;
$('tab-notifs').addEventListener('animationend', (e) => e.target.closest('.bell') && $('tab-notifs').classList.remove('ring'));

function renderNotifications() {
  const list = $('notifs');
  list.replaceChildren();
  const count = notifs.items.length;

  // Kapsul: titik kecil tanpa angka (jumlahnya ada di tab Kotak masuk).
  $('badge').hidden = count === 0;
  $('badge').title = `${count} notifikasi`;
  $('notif-count').hidden = count === 0;
  $('notif-count').textContent = count > 99 ? '99+' : String(count);
  // Notifikasi bertambah: lonceng di tab ikut bergoyang.
  if (count > lastNotifCount) {
    const tab = $('tab-notifs');
    tab.classList.remove('ring');
    void tab.offsetWidth;
    tab.classList.add('ring');
  }
  lastNotifCount = count;
  renderTabAction();

  if (notifs.access !== 'Allowed' && notifs.access !== 'Unknown') {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Zenopod belum diizinkan membaca notifikasi. Buka Pengaturan Windows › Privasi & keamanan › Notifikasi.';
    list.append(empty);
    return;
  }
  if (count === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Belum ada notifikasi.';
    list.append(empty);
    return;
  }

  for (const item of notifs.items) {
    const row = document.createElement('div');
    row.className = 'notif';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'notif-main';
    main.title = 'Buka aplikasi';
    main.addEventListener('click', () => window.kapsul.openNotification(item.id));

    const text = document.createElement('span');
    text.className = 'notif-text';
    const head = document.createElement('span');
    head.className = 'notif-head';
    head.textContent = `${item.appName || 'Aplikasi'} · ${ago(item.time)}`;
    const title = document.createElement('span');
    title.className = 'notif-title';
    title.textContent = item.title;
    const body = document.createElement('span');
    body.className = 'notif-body';
    body.textContent = item.body;
    text.append(head, title, body);
    main.append(iconEl(item, 'notif-icon'), text);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notif-x';
    close.title = 'Hapus';
    close.setAttribute('aria-label', 'Hapus notifikasi');
    close.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>';
    close.addEventListener('click', () => window.kapsul.dismissNotification(item.id));

    row.append(main, close);
    list.append(row);
  }
}

window.kapsul.onNotifications((state) => {
  notifs = state;
  renderNotifications();
});

// ---------- Kartu peek (notifikasi, Claude, sapaan, pengingat) ----------

function renderPeek(peek) {
  $('peek-app').textContent = peek.app || '';
  $('peek-title').textContent = peek.title || '';
  $('peek-body').textContent = peek.body || '';
  $('peek-body').hidden = !peek.body;
  const icon = $('peek-icon');
  icon.hidden = !peek.icon;
  if (peek.icon) icon.src = peek.icon;

  const actions = $('peek-actions');
  actions.replaceChildren();
  actions.hidden = !peek.actions?.length;
  for (const action of peek.actions ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary ? 'peek-btn primary' : 'peek-btn';
    button.textContent = action.label;
    button.addEventListener('click', () => window.kapsul.peekAction(peek.id, action.id));
    actions.append(button);
  }

  peekBuddy.setMood(peek.mood || 'happy');
  peekBuddy.setCostume(peek.costume ?? seasonalCostume);
  if (peek.mood === 'surprised') setTimeout(() => peekState === peek && peekBuddy.setMood('happy'), 1300);
  if (peek.sound) sfx(peek.sound);
}

window.kapsul.onPeek((peek) => {
  if (peekState) lastPeek = { kind: peekState.kind, at: Date.now() };
  peekState = peek;
  if (peek) renderPeek(peek);
  shell.classList.toggle('peeking', Boolean(peek));
  shell.classList.toggle('peek-tall', Boolean(peek?.actions?.length));
});

$('peek-content').addEventListener('click', () => {
  if (peekState) window.kapsul.peekClick(peekState.id);
});

// Suara (renderer/sounds.js), mengikuti saklar & volume di Pengaturan › Suara.
let soundSettings = { enabled: true, volume: 0.6 };

function sfx(name) {
  if (!soundSettings.enabled) return;
  const category = window.KapsulSound.category(name);
  if (category && soundSettings[category] === false) return;
  window.KapsulSound.play(name, soundSettings.volume);
}

// ---------- Claude Code ----------

window.kapsul.onClaude((state) => {
  const wasActive = claudeState.active.length > 0;
  claudeState = state ?? { active: [] };
  renderClaudeCard();
  renderMedia();
  if (claudeState.active.length && !wasActive) goToSection('work', { sound: false });
  else goToPage(pageIndex, { sound: false });
});

const elapsed = (since) => {
  const minutes = Math.floor((Date.now() - since) / 60000);
  return minutes < 1 ? 'baru mulai' : `${minutes} mnt`;
};

// Kartu Claude di section Kerja; tanpa sesi = keterangan singkat.
function renderClaudeCard() {
  const session = claudeState.active[0];
  if (!session) {
    $('claude-live').classList.remove('waiting');
    $('claude-live').classList.add('off');
    $('claude-project').textContent = 'Kerja hari ini';
    const last = claudeState.last;
    $('claude-meta').textContent = last
      ? `${last.failed ? 'Berhenti karena error' : 'Claude selesai'} ${hm(last.endedAt)} · ${last.project}${last.steps ? ` · ${last.steps} langkah` : ''}`
      : 'Claude Code sedang diam';
    $('claude-activity').replaceChildren();
    renderWorkStats();
    renderClaudeLog(null);
    renderWorkActions();
    return;
  }
  renderWorkActions();
  $('work-stats').hidden = true;
  $('claude-live').classList.remove('off');
  const waiting = session.state === 'waiting';
  $('claude-live').classList.toggle('waiting', waiting);
  $('claude-project').textContent = session.project;
  const others = claudeState.active.length - 1;
  $('claude-meta').textContent = [
    waiting ? 'Menunggu kamu' : 'Claude Code',
    session.steps ? `${session.steps} langkah` : '',
    session.started ? elapsed(session.started) : '',
    others > 0 ? `+${others} sesi` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const list = $('claude-activity');
  list.replaceChildren();
  const activity = session.activity?.length ? session.activity : [{ label: session.label || 'Berpikir', detail: session.prompt || '' }];
  renderClaudeLog(activity);
  for (const item of activity.slice(-1)) {
    const li = document.createElement('li');
    const label = document.createElement('b');
    label.textContent = item.label;
    li.append(label);
    if (item.detail) {
      const detail = document.createElement('code');
      detail.textContent = ` · ${item.detail}`;
      li.append(detail);
    }
    list.append(li);
  }
}

setInterval(() => {
  if (open) renderClaudeCard();
}, 30_000);

// ---------- Fokus (Pomodoro) ----------

const PHASE = { focus: 'Fokus', break: 'Istirahat', long: 'Istirahat panjang' };
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
};
const focusRemaining = () => (focusState.running ? focusState.endsAt - Date.now() : focusState.remaining);

// Lama penuh fase sekarang (untuk lingkaran progres).
function phaseLength(phase) {
  const s = focusSettings;
  return ({ focus: s.focusMinutes, break: s.breakMinutes, long: s.longBreakMinutes }[phase] ?? s.focusMinutes) * 60_000;
}

const FOCUS_PRESETS = [15, 25, 45, 60];
const TIMER_PRESETS = [1, 3, 5, 10, 15, 30, 60];
const endTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

const CONTROL_ICONS = {
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.8 8z" /></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M5 3.5v9M11 3.5v9" /></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.6" /></svg>',
  skip: '<svg viewBox="0 0 16 16"><path d="M3.5 3.5v9L10 8zM12.5 3.5v9" /></svg>',
  timer: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5" /><path d="M6.5 2h3M8 9V6.5" /></svg>',
};

let focusPick = null; // lama fokus yang dipilih sebelum mulai (menit)
try {
  focusPick = Number(localStorage.getItem('kapsul.focusPick')) || null;
} catch {
  // tanpa penyimpanan
}

const pickedMinutes = () => focusPick || focusSettings.focusMinutes;
const focusTotal = () => focusState.total || phaseLength(focusState.phase ?? 'focus');

// Struktur tab (dipanggil saat status berubah); angka & lingkaran diperbarui tickFocus().
function renderFocus() {
  const { phase, running, cycle } = focusState;
  const tab = $('focus-tab');
  const total = focusTotal();
  const remaining = phase ? focusRemaining() : pickedMinutes() * 60_000;
  // Belum dimulai sama sekali = menunggu tombol Mulai (beda dengan dijeda di tengah).
  const waiting = Boolean(phase) && !running && remaining >= total - 1000;
  const rest = phase === 'break' || phase === 'long';

  tab.classList.toggle('idle', !phase);
  tab.classList.toggle('rest', rest);
  tab.classList.toggle('running', running);
  tab.classList.toggle('paused', Boolean(phase) && !running && !waiting);

  // Detail = laporan: posisi di siklus Pomodoro (titik per sesi) + keterangan.
  const cycles = focusSettings.cycles;
  $('focus-cycle-text').textContent = !phase ? `${cycles} sesi = 1 siklus` : phase === 'focus' ? `Sesi ${cycle} dari ${cycles}` : PHASE[phase];
  const left = cycles - cycle;
  $('focus-sub').textContent = !phase
    ? `Fokus ${focusSettings.focusMinutes} menit, istirahat ${focusSettings.breakMinutes} menit; setelah ${cycles} sesi istirahat panjang ${focusSettings.longBreakMinutes} menit.`
    : phase === 'focus'
      ? left > 0
        ? `${left} sesi lagi sebelum istirahat panjang.`
        : 'Sesi terakhir di siklus ini, habis ini istirahat panjang.'
      : 'Regangkan badan dan minum air dulu.';

  const dots = $('focus-dots');
  dots.replaceChildren();
  for (let i = 1; i <= focusSettings.cycles; i++) {
    const dot = document.createElement('i');
    if (i < cycle || (i === cycle && phase && phase !== 'focus')) dot.className = 'done';
    else if (i === cycle && phase === 'focus') dot.className = 'now';
    dots.append(dot);
  }

  $('focus-count').hidden = !phase;
  $('tab-focus').classList.toggle('running', Boolean(phase && running));
  renderFocusSummary();
  tickFocus();
  if (phase && running) startFocusLoop();
}

// Sisa waktu di chip ikon Fokus (baris navigasi). Hitung mundur besarnya ada di island.
function tickFocus() {
  const { phase } = focusState;
  const remaining = phase ? Math.max(0, focusRemaining()) : 0;
  $('focus-count').textContent = phase ? clock(remaining) : '';
}

let focusFrame = null;

function startFocusLoop() {
  if (focusFrame) return;
  const step = () => {
    focusFrame = null;
    if (!focusState.phase || !focusState.running) return;
    if (open && PAGES[pageIndex].id === 'focus') {
      tickFocusIsland();
      if (detail) tickFocus();
    }
    focusFrame = requestAnimationFrame(step);
  };
  focusFrame = requestAnimationFrame(step);
}

window.kapsul.onFocus((state) => {
  focusState = state;
  renderFocus();
  renderMedia();
});

// Tab tertutup: cukup perbarui angka di tab & kapsul tiap detik.
setInterval(() => {
  if (!focusState.phase || !focusState.running) return;
  tickFocus();
  renderPillText();
}, 1000);

// ---------- Klip (riwayat clipboard) ----------

let clipItems = [];
let copiedId = null;

function renderClips() {
  const list = $('clips');
  list.replaceChildren();
  renderTabAction();
  if (!clipItems.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Salin teks atau gambar, nanti muncul di sini. Riwayat hanya disimpan selama Zenopod menyala.';
    list.append(empty);
    return;
  }
  for (const item of clipItems) {
    const row = document.createElement('div');
    row.className = item.id === copiedId ? 'notif copied' : 'notif';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'notif-main';
    main.title = 'Salin lagi';
    main.addEventListener('click', () => {
      copiedId = item.id;
      window.kapsul.clip('copy', item.id);
      react('wink', 1200);
      sfx('tick');
      setTimeout(() => {
        copiedId = null;
        renderClips();
      }, 1500);
    });

    const text = document.createElement('span');
    text.className = 'notif-text';
    const head = document.createElement('span');
    head.className = 'notif-head';
    head.textContent = item.id === copiedId ? 'Disalin' : ago(item.at);
    const body = document.createElement('span');
    body.className = item.type === 'image' ? 'notif-body' : 'clip-text';
    body.textContent = item.text;
    text.append(head, body);

    if (item.type === 'image' && item.thumb) {
      const img = document.createElement('img');
      img.className = 'clip-thumb';
      img.src = item.thumb;
      img.alt = '';
      main.append(img, text);
    } else {
      main.append(text);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notif-x';
    close.title = 'Hapus';
    close.setAttribute('aria-label', 'Hapus dari riwayat');
    close.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>';
    close.addEventListener('click', () => window.kapsul.clip('remove', item.id));

    row.append(main, close);
    list.append(row);
  }
}

window.kapsul.onClips((items) => {
  clipItems = items ?? [];
  renderClips();
});

// ---------- Catatan / todo ----------

let todoItems = [];

function renderTodos() {
  const list = $('todo-list');
  list.replaceChildren();
  const open = todoItems.filter((t) => !t.done);
  const done = todoItems.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  $('todo-count').hidden = open.length === 0;
  $('todo-count').textContent = String(open.length);
  renderTabAction();

  if (!todoItems.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Belum ada catatan. Tugas yang belum selesai diingatkan saat sapaan sore.';
    list.append(empty);
    return;
  }
  for (const todo of [...open, ...done]) {
    const row = document.createElement('div');
    row.className = todo.done ? 'todo done' : 'todo';

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'todo-check';
    check.setAttribute('aria-label', todo.done ? 'Tandai belum selesai' : 'Tandai selesai');
    check.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>';
    check.addEventListener('click', () => {
      if (!todo.done) {
        react('happy', 1200);
        sfx('tick');
      }
      window.kapsul.todo('toggle', { id: todo.id });
    });

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;
    text.title = todo.text;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notif-x';
    close.setAttribute('aria-label', 'Hapus catatan');
    close.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>';
    close.addEventListener('click', () => window.kapsul.todo('remove', { id: todo.id }));

    row.append(check, text, close);
    list.append(row);
  }
}

$('todo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('todo-input');
  if (!input.value.trim()) return;
  window.kapsul.todo('add', { text: input.value });
  input.value = '';
});

window.kapsul.onTodos((items) => {
  todoItems = items ?? [];
  renderTodos();
});

// ---------- Dev: server lokal & Git ----------

const GIT_ICON =
  '<svg class="git-icon" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.6" /><circle cx="4" cy="12.5" r="1.6" /><circle cx="12" cy="6" r="1.6" /><path d="M4 5.1v5.8M12 7.6c0 2.4-2.4 2.6-6.6 3.6" /></svg>';

function devLabel(text, extra) {
  const label = document.createElement('div');
  label.className = 'dev-label';
  const name = document.createElement('span');
  name.textContent = text;
  label.append(name);
  if (extra) {
    const right = document.createElement('span');
    right.textContent = extra;
    label.append(right);
  }
  return label;
}

function devCell(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function renderDev(state) {
  lastDev = state;
  renderWorkActions();
  if (!claudeState.active.length) renderClaudeCard();
  const services = state?.services ?? [];
  const projects = state?.projects ?? [];
  const down = services.filter((s) => s.status === 'down').length;
  $('dev-alert').hidden = down === 0;
  $('pill-dev-alert').hidden = down === 0;

  const serviceBox = $('dev-services');
  serviceBox.replaceChildren();
  if (services.length) {
    const up = services.filter((s) => s.status === 'up').length;
    serviceBox.append(devLabel('Server', `${up}/${services.length} hidup`));
    services.forEach((s, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dev-row';
      row.disabled = s.type !== 'http';
      row.title = s.type === 'http' ? 'Buka di browser' : s.target;
      row.addEventListener('click', () => window.kapsul.devOpen('service', i));
      row.append(
        devCell(`status-dot ${s.status ?? ''}`, ''),
        devCell('dev-name', s.name),
        devCell('dev-target', s.target.replace(/^https?:\/\//, '')),
        devCell(`dev-detail ${s.status === 'down' ? 'down' : ''}`, s.detail ?? '…'),
      );
      serviceBox.append(row);
    });
  }

  const projectBox = $('dev-projects');
  projectBox.replaceChildren();
  if (projects.length) {
    projectBox.append(devLabel('Git'));
    projects.forEach((p, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dev-row';
      row.title = 'Buka di VS Code';
      row.addEventListener('click', () => window.kapsul.devOpen('project', i));
      const icon = document.createElement('span');
      icon.innerHTML = GIT_ICON;
      icon.style.display = 'contents';
      const sync = [p.ahead ? `↑${p.ahead}` : '', p.behind ? `↓${p.behind}` : ''].filter(Boolean).join(' ');
      const changes = p.ok
        ? [p.changed ? `${p.changed} berubah` : '', p.untracked ? `${p.untracked} baru` : '', sync].filter(Boolean).join(' · ') || 'Bersih'
        : p.detail;
      row.append(icon, devCell('dev-name', p.name), devCell('branch', p.branch || '—'), devCell('dev-target', ''), devCell('dev-detail', changes));
      projectBox.append(row);
    });
  }

  if (!services.length && !projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Belum ada server atau project. Tambahkan di Pengaturan › Dev.';
    serviceBox.append(empty);
  }
}

window.kapsul.onDev(renderDev);

// ---------- Section: kartu atas + isi bawah, di-swipe bersama ----------

const PAGES = [
  { id: 'home', label: 'Beranda', sound: 'hello' },
  { id: 'chat', label: 'Chat', sound: 'pop' },
  { id: 'music', label: 'Musik', sound: 'note' },
  { id: 'time', label: 'Waktu & jadwal', sound: 'ticktock' },
  { id: 'weather', label: 'Cuaca', sound: 'today' },
  { id: 'focus', label: 'Fokus & timer', sound: 'tick' },
  { id: 'device', label: 'Perangkat', sound: 'tick' },
  { id: 'inbox', label: 'Kotak masuk', sound: 'pop' },
  { id: 'work', label: 'Kerja', sound: 'tick' },
];

// Cuaca hanya kalau kota sudah dipilih; Kerja saat Claude bekerja atau ada server/project dipantau.
function pageAvailable(page) {
  if (page.id === 'weather') return Boolean(weatherNow);
  if (page.id === 'work') return claudeState.active.length > 0 || devEnabled;
  return true;
}

let pageIndex = 0;
try {
  pageIndex = Math.max(0, PAGES.findIndex((p) => p.id === localStorage.getItem('kapsul.section')));
} catch {
  // tanpa penyimpanan
}

// Wujud Zeno per section.
function pageMood() {
  const page = PAGES[pageIndex].id;
  if (page === 'home') return (petState?.hunger ?? 100) < 25 ? 'hungry' : 'greet';
  if (page === 'chat') return chatState.busy ? 'think' : pendingFiles.length ? 'hungry' : 'happy';
  if (page === 'music') return media.playing ? 'music' : 'listen';
  if (page === 'time') return 'clock';
  if (page === 'weather') return weatherNow?.look?.mood ?? 'idle';
  if (page === 'focus') return focusState.running && focusState.phase !== 'focus' ? 'stretch' : 'focus';
  if (page === 'device') return systemNow?.online === false ? 'cry' : battery?.charging ? 'charging' : lowBattery() ? 'lowbat' : 'smug';
  if (page === 'inbox') return notifs.items.length ? 'surprised' : 'happy';
  if (page === 'work') return claudeWaiting() ? 'surprised' : claudeBusy() ? 'think' : 'focus';
  return 'idle';
}

const sectionIndex = (id) => PAGES.findIndex((p) => p.id === id);
const goToSection = (id, options) => goToPage(sectionIndex(id), options);

function placeTracks(offsetPx = 0) {
  const x = `translateX(calc(${-pageIndex * 100}% + ${offsetPx}px))`;
  $('hero-track').style.transform = x;
  $('deck-track').style.transform = x;
}

function goToPage(index, { sound = true } = {}) {
  let next = (index + PAGES.length) % PAGES.length;
  const step = index < pageIndex ? -1 : 1;
  for (let i = 0; i < PAGES.length && !pageAvailable(PAGES[next]); i++) next = (next + step + PAGES.length) % PAGES.length;
  const changed = next !== pageIndex;
  pageIndex = next;
  try {
    localStorage.setItem('kapsul.section', PAGES[next].id);
  } catch {
    // tanpa penyimpanan
  }
  placeTracks();
  $('media').classList.toggle('on-music', PAGES[next].id === 'music');
  for (const button of $('nav').querySelectorAll('[data-section]')) {
    const page = PAGES[sectionIndex(button.dataset.section)];
    button.setAttribute('aria-selected', String(page.id === PAGES[next].id));
    button.hidden = !pageAvailable(page);
  }
  for (const [i, dot] of [...$('hero-dots').children].entries()) {
    dot.setAttribute('aria-selected', String(i === next));
    dot.hidden = !pageAvailable(PAGES[i]);
  }
  // Isi section lain tidak bisa difokus dengan Tab (tetap ada di DOM untuk animasi geser).
  for (const [i, pane] of [...$('deck-track').children].entries()) pane.inert = i !== next;
  for (const [i, page] of [...$('hero-track').children].entries()) page.inert = i !== next;
  applyCostume();
  renderPage();
  if (changed) {
    bigBuddy.morph();
    if (sound) {
      sfx('swipe');
      const wet = PAGES[next].id === 'weather' && weatherNow?.look?.costume === 'umbrella';
      setTimeout(() => sfx(wet ? 'rain' : PAGES[next].sound), 140);
    }
  }
  renderBuddy();
}

for (const button of $('nav').querySelectorAll('[data-section]')) {
  button.addEventListener('click', () => goToSection(button.dataset.section));
}

// Titik penanda section di kartu atas (tampilan ringkas).
for (const [i, page] of PAGES.entries()) {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.setAttribute('role', 'tab');
  dot.setAttribute('aria-label', page.label);
  dot.title = page.label;
  dot.addEventListener('click', () => goToPage(i));
  $('hero-dots').append(dot);
}

// Geser dengan mouse di mana saja di kartu atas atau isi bawah: ikuti kursor, lepas > 50px =
// pindah section. Geseran baru dihitung kalau arahnya jelas mendatar, jadi klik tombol dan
// scroll daftar tetap normal; kalau sudah jadi geseran, klik di akhir geseran dibatalkan.
(() => {
  const SKIP = 'input, textarea, select, [contenteditable], .grip';
  let drag = null;
  const swallowClick = () => {
    const stop = (event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 300);
  };
  for (const view of [$('hero-view'), $('deck-view')]) {
    view.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest(SKIP)) return;
      drag = { view, id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, active: false };
    });
    view.addEventListener('pointermove', (event) => {
      if (!drag || drag.view !== view) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return (drag = null);
        if (Math.abs(dx) < 10) return;
        drag.active = true;
        view.setPointerCapture(drag.id);
      }
      const width = view.clientWidth || 1;
      drag.dx = Math.max(-width, Math.min(width, dx));
      $('panel').classList.add('swiping');
      placeTracks(drag.dx);
    });
    const release = () => {
      if (!drag || drag.view !== view) return;
      const { dx, active } = drag;
      drag = null;
      $('panel').classList.remove('swiping');
      if (!active) return;
      swallowClick();
      if (dx < -50) goToPage(pageIndex + 1);
      else if (dx > 50) goToPage(pageIndex - 1);
      else goToPage(pageIndex, { sound: false });
    };
    view.addEventListener('pointerup', release);
    view.addEventListener('pointercancel', release);
  }

  // Scroll horizontal (touchpad) atau Shift+scroll di mana saja di panel.
  let wheelLock = 0;
  $('panel').addEventListener(
    'wheel',
    (event) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (Math.abs(delta) < 15 || Date.now() < wheelLock) return;
      event.preventDefault();
      wheelLock = Date.now() + 450;
      goToPage(pageIndex + Math.sign(delta));
    },
    { passive: false },
  );
})();

const HIJRI = (() => {
  try {
    return new Intl.DateTimeFormat('id-ID-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return null;
  }
})();
const LONG_DATE = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const GREET_LINES = {
  pagi: ['Semangat memulai hari!', 'Sudah sarapan belum?', 'Hari baru, cerita baru.'],
  siang: ['Jangan lupa makan siang ya.', 'Istirahat sebentar juga penting.', 'Tetap semangat sampai sore!'],
  sore: ['Sedikit lagi, kerjaan hampir beres.', 'Jangan lupa minum air.', 'Sore yang pas buat menuntaskan tugas.'],
  malam: ['Jangan begadang terlalu larut ya.', 'Waktunya santai sejenak.', 'Terima kasih sudah kerja keras hari ini.'],
};
let profile = { userName: '', buddyName: '' };
let nextReminder = null;

// Sama dengan lib/schedule.js: pagi 04–10, siang 11–14, sore 15–17, malam 18–03.
function periodNow(date = new Date()) {
  const h = date.getHours();
  if (h >= 4 && h < 11) return 'pagi';
  if (h >= 11 && h < 15) return 'siang';
  if (h >= 15 && h < 18) return 'sore';
  return 'malam';
}

const ADVICE_ICONS = {
  rain: 'rain',
  storm: 'rain',
  hot: 'sun',
  uv: 'sun',
  wind: 'cloud',
  ok: 'check',
};

// ---------- Island: aksi langsung per section ----------

function actionChip(label, onClick, { icon = null, primary = false, title = null, round = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-chip${primary ? ' primary' : ''}${round ? ' round' : ''}`;
  if (icon) {
    const i = document.createElement('span');
    i.className = 'action-icon';
    i.innerHTML = CONTROL_ICONS[icon] ?? PILL_ICONS[icon] ?? '';
    button.append(i);
  }
  if (label) button.append(label);
  if (title) {
    button.title = title;
    button.setAttribute('aria-label', title);
  }
  button.addEventListener('click', onClick);
  return button;
}

function renderHome(now) {
  const period = periodNow(now);
  const firstName = (profile.userName || '').split(/\s+/)[0];
  $('greet-title').textContent = `Selamat ${period}${firstName ? `, ${firstName}` : ''}!`;
  renderQuickApps();
  renderPet();
}

// 5 aplikasi pertama sekali klik + tombol cari (membuka detail Beranda).
function renderQuickApps() {
  const box = $('quick-apps');
  box.replaceChildren();
  for (const item of launcherApps.slice(0, QUICK_APPS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-app';
    button.title = item.name;
    button.setAttribute('aria-label', `Buka ${item.name}`);
    if (item.icon) {
      const img = document.createElement('img');
      img.src = item.icon;
      img.alt = '';
      button.append(img);
    } else {
      button.textContent = initials(item.name);
      button.style.background = item.color ?? 'var(--surface-hover)';
    }
    button.addEventListener('click', () => launch(item.index));
    box.append(button);
  }
  if (!launcherApps.length) box.append(actionChip('+ Tambah aplikasi', () => window.kapsul.openSettings('apps')));
  const search = document.createElement('button');
  search.type = 'button';
  search.className = 'quick-app search';
  search.title = 'Cari aplikasi, hitung, timer…';
  search.setAttribute('aria-label', search.title);
  search.innerHTML = '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>';
  search.addEventListener('click', () => {
    setDetail(true);
    $('app-search').focus();
  });
  box.append(search);
}

function renderClock(now) {
  const time = $('clock-time');
  time.replaceChildren(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  const sec = document.createElement('span');
  sec.className = 'sec';
  sec.textContent = `:${pad2(now.getSeconds())}`;
  time.append(sec);
  $('clock-date').textContent = LONG_DATE.format(now);
  $('clock-hijri').textContent = HIJRI ? HIJRI.format(now) : '';
}

// Jadwal terdekat: rapat ≤ 2 jam lagi (Gabung kalau ada link) > pengingat > kosong.
function renderTimeCard() {
  const now = Date.now();
  const button = $('time-next');
  const meeting = nextMeeting(now);
  const soon = meeting && meeting.start - now < 2 * 3_600_000;
  let icon = 'bell';
  let text = 'Tidak ada jadwal dekat';
  let action = () => setDetail(true);
  if (soon) {
    icon = 'calendar';
    text = `${meeting.link ? 'Gabung · ' : ''}${meeting.title} · ${eventTime(meeting, now)}`;
    if (meeting.link) action = () => window.kapsul.meeting(meeting.link);
  } else if (nextReminder) {
    text = `${nextReminder.title} · ${nextReminder.when}`;
  }
  const i = document.createElement('span');
  i.className = 'action-icon';
  i.innerHTML = PILL_ICONS[icon];
  const label = document.createElement('span');
  label.className = 'action-text';
  label.textContent = text;
  button.replaceChildren(i, label);
  button.title = text;
  button.classList.toggle('primary', Boolean(soon && meeting.link));
  button.onclick = action;
}

$('time-add-todo').addEventListener('click', () => {
  setDetail(true);
  setTimeout(() => $('todo-input').focus(), 260);
});

function renderWeather() {
  const w = weatherNow;
  if (!w) return;
  const scene = $('weather-scene');
  const sceneKey = `${w.kind}|${w.code}|${w.isDay}`;
  // Gambar ulang hanya saat cuaca berganti, supaya animasinya tidak mulai dari awal.
  if (scene.dataset.key !== sceneKey) {
    scene.dataset.key = sceneKey;
    scene.innerHTML = weatherSvg(w.kind, { code: w.code, day: w.isDay !== false });
  }
  $('weather-temp').textContent = `${w.temperature}°`;
  $('weather-cond').textContent = w.text;
  $('weather-feels').textContent = [w.city, w.max != null ? `${w.min}°–${w.max}°` : ''].filter(Boolean).join(' · ');
  // Saran terpenting langsung di island; lengkapnya di detail.
  const top = w.advice?.[0];
  const tip = $('weather-tip');
  tip.replaceChildren();
  if (top) {
    const icon = document.createElement('span');
    icon.className = 'tick-icon';
    icon.innerHTML = PILL_ICONS[ADVICE_ICONS[top.icon] ?? 'check'];
    const text = document.createElement('span');
    text.textContent = top.text;
    tip.className = `weather-tip tip-${top.icon}`;
    tip.append(icon, text);
  }

  renderWeatherChart();

  // Fakta ringkas dalam satu kartu
  const facts = [
    ['Terasa', w.feels != null ? `${w.feels}°` : null],
    ['Lembap', w.humidity != null ? `${w.humidity}%` : null],
    ['Angin', w.wind != null ? `${w.wind} km/j` : null],
    ['UV maks', w.uv != null ? String(w.uv) : null],
    ['Terbit', w.sunrise],
    ['Terbenam', w.sunset],
  ].filter(([, v]) => v);
  $('weather-details').replaceChildren(
    ...facts.map(([label, value]) => {
      const cell = document.createElement('div');
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('b');
      v.textContent = value;
      cell.append(l, v);
      return cell;
    }),
  );

  // Saran lain (yang pertama sudah tampil di island)
  const more = (w.advice ?? []).slice(1);
  $('weather-advice').hidden = !more.length;
  $('weather-advice').replaceChildren(
    ...more.map((tip) => {
      const li = document.createElement('li');
      li.className = `tip-${tip.icon}`;
      const icon = document.createElement('span');
      icon.className = 'tick-icon';
      icon.innerHTML = PILL_ICONS[ADVICE_ICONS[tip.icon] ?? 'check'];
      const text = document.createElement('span');
      text.textContent = tip.text;
      li.append(icon, text);
      return li;
    }),
  );
}

// ---------- Grafik cuaca: suhu (garis) + peluang hujan (batang), satu sumbu x ----------
// Dua strip terpisah karena skalanya berbeda (° dan %); lebar mengikuti wadah.
const WX = { temp: '#d97706', rain: '#3b82f6' };
let wxHover = null; // indeks jam yang sedang ditunjuk

function renderWeatherChart() {
  const box = $('wx-chart');
  const w = weatherNow;
  if (!w || !box.clientWidth) return;
  const points = [{ hour: 'Kini', temperature: w.temperature, rain: null, kind: w.kind, isDay: w.isDay, text: w.text, now: true }, ...(w.hours ?? [])];
  const W = box.clientWidth;
  const pad = 12;
  const iconY = 2;
  const top = 34; // ruang ikon + label puncak
  const tempH = 54;
  const rainTop = top + tempH + 16;
  const rainH = 26;
  const labelY = rainTop + rainH + 14;
  const H = labelY + 4;
  const step = (W - pad * 2) / (points.length - 1);
  const x = (i) => pad + i * step;
  const temps = points.map((p) => p.temperature);
  const lo = Math.min(...temps) - 1;
  const hi = Math.max(...temps) + 1;
  const y = (t) => top + tempH - ((t - lo) / (hi - lo || 1)) * tempH;
  const maxI = temps.indexOf(Math.max(...temps));
  const minI = temps.lastIndexOf(Math.min(...temps));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.temperature).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)} ${top + tempH}L${x(0).toFixed(1)} ${top + tempH}Z`;
  const parts = [];
  parts.push(`<path class="wx-area" d="${area}" fill="${WX.temp}" />`);
  parts.push(`<line class="wx-base" x1="${pad}" x2="${W - pad}" y1="${rainTop + rainH}" y2="${rainTop + rainH}" />`);
  parts.push(`<path class="wx-line" d="${line}" stroke="${WX.temp}" />`);

  // Batang peluang hujan (skala tetap 0–100%), sudut atas membulat 4px, dasar rata.
  const bw = Math.min(14, step * 0.55);
  let wettest = -1;
  points.forEach((p, i) => {
    if (p.rain == null) return;
    if (wettest < 0 || p.rain > points[wettest].rain) wettest = i;
    const h = Math.max(1.5, (p.rain / 100) * rainH);
    const r = Math.min(4, h, bw / 2);
    const bx = x(i) - bw / 2;
    const by = rainTop + rainH - h;
    parts.push(
      `<path class="wx-bar${p.rain < 30 ? ' dry' : ''}" fill="${WX.rain}" d="M${bx.toFixed(1)} ${(by + h).toFixed(1)}V${(by + r).toFixed(1)}Q${bx.toFixed(1)} ${by.toFixed(1)} ${(bx + r).toFixed(1)} ${by.toFixed(1)}H${(bx + bw - r).toFixed(1)}Q${(bx + bw).toFixed(1)} ${by.toFixed(1)} ${(bx + bw).toFixed(1)} ${(by + r).toFixed(1)}V${(by + h).toFixed(1)}Z" />`,
    );
  });
  if (wettest > 0 && points[wettest].rain >= 30) {
    parts.push(`<text class="wx-label" x="${x(wettest).toFixed(1)}" y="${(rainTop + rainH - (points[wettest].rain / 100) * rainH - 4).toFixed(1)}">${points[wettest].rain}%</text>`);
  }
  parts.push(`<text class="wx-axis start" x="${pad}" y="${rainTop - 4}">Peluang hujan</text>`);

  // Penanda selektif: sekarang, puncak, terendah (label suhu memakai warna teks, bukan warna data).
  const marks = [[0, 'above'], [maxI, 'above'], [minI, 'below']].filter(([i], k, all) => all.findIndex(([j]) => j === i) === k);
  for (const [i, where] of marks) {
    if (where === 'below' && Math.abs(i - maxI) < 2) continue;
    const cy = y(points[i].temperature);
    parts.push(`<circle class="wx-dot" cx="${x(i).toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${WX.temp}" />`);
    const ty = where === 'above' ? cy - 9 : cy + 16;
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    parts.push(`<text class="wx-label strong ${anchor}" x="${(x(i) + (anchor === 'start' ? -2 : 0)).toFixed(1)}" y="${ty.toFixed(1)}">${points[i].temperature}°</text>`);
  }

  // Ikon & jam tiap 3 jam
  points.forEach((p, i) => {
    if (i % 3) return;
    const day = p.isDay ?? (Number(p.hour) >= 6 && Number(p.hour) < 18);
    const icon = weatherSvg(p.kind, { day, code: p.now ? w.code : null, mini: true }).replace('<svg ', `<svg x="${(x(i) - 8).toFixed(1)}" y="${iconY}" width="16" height="16" `);
    parts.push(icon);
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    parts.push(`<text class="wx-axis ${anchor}" x="${(x(i) + (anchor === 'start' ? -2 : 0)).toFixed(1)}" y="${labelY}">${p.now ? 'Kini' : `${p.hour}.00`}</text>`);
  });

  // Lapisan hover: garis vertikal di jam terdekat
  if (wxHover != null && points[wxHover]) {
    parts.push(`<line class="wx-cross" x1="${x(wxHover).toFixed(1)}" x2="${x(wxHover).toFixed(1)}" y1="${top - 6}" y2="${rainTop + rainH}" />`);
    parts.push(`<circle class="wx-dot" cx="${x(wxHover).toFixed(1)}" cy="${y(points[wxHover].temperature).toFixed(1)}" r="4" fill="${WX.temp}" />`);
  }

  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${parts.join('')}</svg><div class="wx-tip" id="wx-tip" hidden></div>`;
  box.dataset.step = String(step);
  box.dataset.pad = String(pad);
  box.dataset.count = String(points.length);

  if (wxHover != null && points[wxHover]) {
    const p = points[wxHover];
    const tip = $('wx-tip');
    tip.hidden = false;
    const value = document.createElement('b');
    value.textContent = `${p.temperature}°`;
    const meta = document.createElement('span');
    meta.textContent = [p.now ? 'Sekarang' : `${p.hour}.00`, p.text, p.rain != null ? `hujan ${p.rain}%` : null].filter(Boolean).join(' · ');
    tip.replaceChildren(value, meta);
    // Lebar mengikuti isi; posisi dijaga tetap di dalam grafik.
    const tipW = tip.offsetWidth;
    tip.style.left = `${Math.min(W - tipW, Math.max(0, x(wxHover) - tipW / 2))}px`;
  }

  // Ringkasan & tabel untuk pembaca layar
  $('wx-peak').textContent = `Puncak ${points[maxI].temperature}° · ${points[maxI].now ? 'sekarang' : `${points[maxI].hour}.00`}`;
  const table = $('wx-table');
  table.replaceChildren();
  const head = document.createElement('tr');
  for (const t of ['Jam', 'Suhu', 'Peluang hujan', 'Cuaca']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.append(th);
  }
  table.append(head);
  for (const p of points) {
    const tr = document.createElement('tr');
    for (const v of [p.now ? 'Sekarang' : `${p.hour}.00`, `${p.temperature}°`, p.rain != null ? `${p.rain}%` : '–', p.text ?? '']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    table.append(tr);
  }
}

(() => {
  const box = $('wx-chart');
  const indexAt = (clientX) => {
    const rect = box.getBoundingClientRect();
    const step = Number(box.dataset.step) || 1;
    const pad = Number(box.dataset.pad) || 0;
    const count = Number(box.dataset.count) || 1;
    return Math.max(0, Math.min(count - 1, Math.round((clientX - rect.left - pad) / step)));
  };
  box.addEventListener('pointermove', (event) => {
    if (event.buttons) return;
    const i = indexAt(event.clientX);
    if (i !== wxHover) {
      wxHover = i;
      renderWeatherChart();
    }
  });
  box.addEventListener('pointerleave', () => {
    wxHover = null;
    renderWeatherChart();
  });
  // Keyboard: panah kiri/kanan menggeser jam (tidak memindah section).
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const count = Number(box.dataset.count) || 1;
    wxHover = Math.max(0, Math.min(count - 1, (wxHover ?? -1) + (event.key === 'ArrowRight' ? 1 : -1)));
    renderWeatherChart();
  });
  box.addEventListener('blur', () => {
    wxHover = null;
    renderWeatherChart();
  });
  // Gambar ulang hanya kalau lebarnya berubah (tingginya diatur grafik sendiri).
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (box.clientWidth === lastWidth) return;
    lastWidth = box.clientWidth;
    requestAnimationFrame(renderWeatherChart);
  }).observe(box);
})();

// Island Fokus: belum mulai = tombol mulai cepat; berjalan = hitung mundur + kontrol.
let focusCardKey = null;

function renderFocusSummary() {
  const { phase, running, cycle } = focusState;
  const total = focusTotal();
  const remaining = Math.max(0, focusRemaining());
  const waiting = Boolean(phase) && !running && remaining >= total - 1000;
  const card = $('focus-island');
  card.classList.toggle('idle', !phase);
  card.classList.toggle('running', running);
  card.classList.toggle('rest', phase === 'break' || phase === 'long');
  card.classList.toggle('paused', Boolean(phase) && !running);

  $('focus-sum-title').textContent = !phase
    ? 'Siap fokus?'
    : running
      ? `${PHASE[phase]}${phase === 'focus' ? ` · Sesi ${cycle}/${focusSettings.cycles}` : ''}`
      : waiting
        ? phase === 'focus'
          ? 'Siap fokus lagi?'
          : `${PHASE[phase]} menunggu`
        : `${PHASE[phase]} dijeda`;
  tickFocusIsland();

  // Tombol dibangun ulang hanya saat statusnya berubah (bukan tiap detik).
  const key = `${phase}|${running}|${waiting}|${pickedMinutes()}`;
  if (key === focusCardKey) return;
  focusCardKey = key;
  const box = $('focus-card-actions');
  box.replaceChildren();
  const act = (action, minutes) => () => window.kapsul.focus(action, minutes);
  const round = (icon, title, onClick, primary = false) => actionChip('', onClick, { icon, title, primary, round: true });
  if (!phase) {
    const picked = pickedMinutes();
    box.append(round('play', `Mulai fokus ${picked} menit`, act('focus', picked), true));
    for (const m of FOCUS_PRESETS.filter((m) => m !== picked).slice(0, 2)) box.append(actionChip(`${m}m`, act('focus', m), { title: `Mulai fokus ${m} menit` }));
    box.append(actionChip('5m', () => window.kapsul.timer('start', { ms: 5 * 60_000 }), { icon: 'timer', title: 'Mulai timer 5 menit' }));
  } else if (running) {
    box.append(
      round('pause', 'Jeda', act('pause'), true),
      actionChip('+5', act('extend', 5), { title: 'Tambah 5 menit', round: true }),
      round('skip', 'Lewati', act('skip')),
      round('stop', 'Berhenti', act('stop')),
    );
  } else {
    box.append(round('play', waiting ? 'Mulai' : 'Lanjut', act('start'), true));
    if (!waiting) box.append(actionChip('+5', act('extend', 5), { title: 'Tambah 5 menit', round: true }));
    box.append(round('stop', 'Berhenti', act('stop')));
  }
}

// Island Fokus: sisa waktu besar, garis progres (terisi seiring waktu berjalan), subjudul jam selesai.
function tickFocusIsland() {
  const t = statsToday ?? {};
  const { phase, running } = focusState;
  const total = phase ? focusTotal() : pickedMinutes() * 60_000;
  const remaining = phase ? Math.max(0, focusRemaining()) : total;
  const done = phase ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
  $('focus-line-bar').style.width = `${(done * 100).toFixed(2)}%`;
  $('focus-island').classList.toggle('final', phase === 'focus' && running && remaining < 60_000);

  const time = phase ? clock(remaining) : `${pickedMinutes()}:00`;
  if ($('focus-sum-time').textContent !== time) $('focus-sum-time').textContent = time;

  let sub = !phase ? `${t.focus ?? 0} sesi selesai hari ini` : running ? `selesai ${endTime.format(Date.now() + remaining)}` : 'Tekan ▶ untuk lanjut';
  const timer = quickTimers[0];
  if (timer) sub += ` · ⏱ ${timer.label} ${clock(timer.endsAt - Date.now())}`;
  if ($('focus-sum-sub').textContent !== sub) $('focus-sum-sub').textContent = sub;
}

function renderDeviceTop() {
  const box = $('device-battery');
  box.hidden = !battery || !hasBattery;
  if (battery && hasBattery) {
    const percent = Math.round(battery.level * 100);
    $('device-bat-fill').style.width = `${Math.max(4, percent)}%`;
    $('device-bat-percent').textContent = `${percent}%`;
    $('device-bat-state').textContent = battery.charging
      ? ` · mengisi${Number.isFinite(battery.chargingTime) && battery.chargingTime > 0 ? `, penuh ±${durationText(battery.chargingTime)}` : ''}`
      : Number.isFinite(battery.dischargingTime) && battery.dischargingTime > 0
        ? ` · cukup ±${durationText(battery.dischargingTime)}`
        : ' · pakai baterai';
    box.classList.toggle('charging', battery.charging);
    box.classList.toggle('low', lowBattery());
  }
  renderSystem();
}

// Island Kotak masuk: notifikasi terbaru + Buka / Tutup / Hapus semua; tanpa notifikasi = klip terakhir.
function renderInboxSummary() {
  const count = notifs.items.length;
  const latest = notifs.items[0];
  const clip = clipItems[0];
  $('inbox-title').textContent = count ? `${count} notifikasi` : clip ? 'Klip terakhir' : 'Kotak masuk';
  const box = $('inbox-latest');
  const actions = $('inbox-card-actions');
  box.replaceChildren();
  actions.replaceChildren();
  if (latest) {
    const text = document.createElement('span');
    text.className = 'inbox-text';
    const title = document.createElement('b');
    title.textContent = `${latest.appName || 'Aplikasi'}: ${latest.title || ''}`;
    const body = document.createElement('span');
    body.textContent = latest.body || '';
    text.append(title, body);
    box.append(iconEl(latest, 'notif-icon'), text);
    actions.append(
      actionChip('Buka', () => window.kapsul.openNotification(latest.id), { primary: true }),
      actionChip('Tutup', () => window.kapsul.dismissNotification(latest.id)),
    );
    if (count > 1) actions.append(actionChip('Hapus semua', () => window.kapsul.clearNotifications()));
  } else if (clip) {
    const text = document.createElement('span');
    text.className = 'inbox-text';
    const body = document.createElement('span');
    body.textContent = clip.type === 'image' ? 'Gambar' : (clip.text || '').replace(/\s+/g, ' ');
    text.append(body);
    box.append(text);
    actions.append(
      actionChip('Salin', () => {
        window.kapsul.clip('copy', clip.id);
        sfx('tick');
      }, { primary: true }),
      actionChip('Semua klip', () => {
        setInboxMode('clips');
        setDetail(true);
      }),
    );
  } else {
    const text = document.createElement('span');
    text.className = 'inbox-text dim';
    text.textContent = 'Tidak ada notifikasi baru.';
    box.append(text);
  }
}

// Island Kerja saat Claude diam: tiga angka hari ini. Server & Git kalau diatur (bisa diklik),
// sisanya diisi fokus dan tugas selesai.
function renderWorkStats() {
  const box = $('work-stats');
  box.replaceChildren();
  const tiles = [];
  const tile = (value, label, { tone = '', title = '', onClick = null } = {}) => tiles.push({ value, label, tone, title, onClick });
  const claudeMs = statsToday?.claudeMs ?? 0;
  tile(claudeMs >= 60_000 ? minutesText(claudeMs) : '0 m', 'Claude bekerja');
  const services = devEnabled ? (lastDev?.services ?? []) : [];
  if (services.length) {
    const up = services.filter((s) => s.status === 'up').length;
    tile(`${up}/${services.length}`, 'server hidup', { tone: up < services.length ? 'bad' : 'good', title: 'Periksa ulang server', onClick: () => window.kapsul.devRefresh() });
  }
  const projects = devEnabled ? (lastDev?.projects ?? []).filter((p) => p.ok) : [];
  if (projects.length) {
    const changed = projects.reduce((n, p) => n + (p.changed ?? 0) + (p.untracked ?? 0), 0);
    const ahead = projects.reduce((n, p) => n + (p.ahead ?? 0), 0);
    tile(changed ? String(changed) : ahead ? `↑${ahead}` : 'Bersih', changed ? 'file berubah' : ahead ? 'belum di-push' : `${projects.length} project Git`, {
      title: 'Lihat server & project',
      onClick: () => setDetail(true),
    });
  }
  if (tiles.length < 3) tile((statsToday?.focusMs ?? 0) >= 60_000 ? minutesText(statsToday.focusMs) : '0 m', 'fokus');
  if (tiles.length < 3) tile(String(statsToday?.todos ?? 0), 'tugas selesai');
  for (const t of tiles) {
    const cell = document.createElement(t.onClick ? 'button' : 'div');
    if (t.onClick) {
      cell.type = 'button';
      cell.title = t.title;
      cell.addEventListener('click', t.onClick);
    }
    if (t.tone) cell.classList.add(t.tone);
    const b = document.createElement('b');
    b.textContent = t.value;
    const span = document.createElement('span');
    span.textContent = t.label;
    cell.append(b, span);
    box.append(cell);
  }
  box.hidden = false;
}

// Island Kerja: tombol periksa server (+ jumlah yang mati) dan buka detail.
function renderWorkActions() {
  const box = $('work-card-actions');
  box.replaceChildren();
  const down = (lastDev?.services ?? []).filter((x) => x.status === 'down').length;
  // Claude diam: angka-angka di kartu sudah jadi tombol, jadi baris tombol tidak perlu.
  box.hidden = !claudeState.active.length;
  if (!claudeState.active.length) return;
  if (devEnabled) box.append(actionChip(down ? `Periksa · ${down} mati` : 'Periksa server', () => window.kapsul.devRefresh(), { primary: down > 0 }));
  box.append(actionChip('Aktivitas', () => setDetail(true)));
}

// Detail Kerja: aktivitas Claude terakhir.
function renderClaudeLog(activity) {
  $('claude-block').hidden = !activity?.length;
  const list = $('claude-log');
  list.replaceChildren();
  for (const item of (activity ?? []).slice(-5).reverse()) {
    const li = document.createElement('li');
    const label = document.createElement('b');
    label.textContent = item.label;
    li.append(label);
    if (item.detail) {
      const detail = document.createElement('code');
      detail.textContent = item.detail;
      li.append(detail);
    }
    list.append(li);
  }
}

function renderPage() {
  const page = PAGES[pageIndex].id;
  const now = new Date();
  if (page === 'home') renderHome(now);
  else if (page === 'chat') renderChat();
  else if (page === 'music') renderLyrics();
  else if (page === 'time') {
    renderClock(now);
    renderTimeCard();
    renderAgenda();
    renderHabits();
  } else if (page === 'weather') renderWeather();
  else if (page === 'focus') renderFocusSummary();
  else if (page === 'device') renderDeviceTop();
  else if (page === 'inbox') renderInboxSummary();
  else if (page === 'work') renderClaudeCard();
}

setInterval(() => {
  if (open && PAGES[pageIndex].id === 'music') renderMusicProgress();
  if (open && PAGES[pageIndex].id === 'time') {
    renderClock(new Date());
    if (new Date().getSeconds() === 0) renderTimeCard();
  }
  if (open && PAGES[pageIndex].id === 'focus' && !focusState.running) renderFocusSummary();
}, 1000);

// ---------- Kostum, cuaca & baterai ----------

let weatherNow = null;

let seasonalCostume = null;

function applyCostume() {
  peekBuddy.setCostume(seasonalCostume);
  // Slide cuaca di kapsul: payung / kacamata hitam sebentar.
  buddy.setCostume(pillSlide?.costume ?? seasonalCostume);
  const onWeather = PAGES[pageIndex]?.id === 'weather';
  bigBuddy.setCostume(onWeather ? (weatherNow?.look?.costume ?? seasonalCostume) : seasonalCostume);
}

window.kapsul.onCostume((state) => {
  seasonalCostume = state?.costume ?? null;
  applyCostume();
});

window.kapsul.onWeather((state) => {
  weatherNow = state;
  // Perbarui titik halaman; kalau cuaca dimatikan saat di halaman Cuaca, pindah ke halaman berikutnya.
  goToPage(pageIndex, { sound: false });
});

// Ilustrasi cuaca bergerak (gaya di style.css, bagian "Halaman Cuaca").
// kind: clear | cloud | fog | rain | storm (lib/weather.js); code 1–2 = cerah berawan.
function weatherSvg(kind, { code = null, day = true, mini = false } = {}) {
  const sun = (x, y, r) =>
    `<g class="ws-sun"><g class="ws-rays">${[0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => {
        const [dx, dy] = [Math.sin((i * Math.PI) / 4), -Math.cos((i * Math.PI) / 4)];
        const at = (d) => [(x + dx * d).toFixed(1), (y + dy * d).toFixed(1)];
        const [[x1, y1], [x2, y2]] = [at(r + 3), at(r + 6)];
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
      })
      .join('')}</g><circle class="ws-core" cx="${x}" cy="${y}" r="${r}" /></g>`;
  const moon = (x, y) =>
    `<g transform="translate(${x} ${y})"><path class="ws-moon" d="M2-9a9 9 0 1 0 7 14A7.5 7.5 0 0 1 2-9z" /></g>` +
    '<circle class="ws-star" cx="9" cy="9" r="1" /><circle class="ws-star s2" cx="33" cy="7" r="0.8" /><circle class="ws-star s3" cx="34" cy="17" r="0.9" />';
  const cloud = (cls, dx = 0, dy = 0, s = 1) =>
    `<g transform="translate(${dx} ${dy}) scale(${s})"><path class="ws-cloud ${cls}" d="M11 31h18a6.5 6.5 0 0 0 .5-13A9 9 0 0 0 12.3 20.6 5.3 5.3 0 0 0 11 31z" /></g>`;
  const drops = (xs = [14, 20, 26]) =>
    xs.map((x, i) => `<line class="ws-drop d${i}" x1="${x}" y1="33" x2="${x - 1.2}" y2="37" />`)
      .join('');
  const light = day ? sun(14, 14, 6) : moon(15, 15);

  let body;
  if (kind === 'clear') body = day ? sun(20, 20, 8) : moon(20, 20);
  else if (kind === 'cloud' && code !== null && code <= 2) body = light + cloud('front', 3, 4, 0.9);
  else if (kind === 'cloud') body = cloud('back', -5, -6, 0.8) + cloud('front', 2, 2, 0.95);
  else if (kind === 'fog') body = cloud('back', 0, -6, 0.85) + '<g class="ws-fog"><line x1="8" y1="27" x2="30" y2="27" /><line class="f2" x1="12" y1="32" x2="34" y2="32" /></g>';
  else if (kind === 'rain') body = cloud('front', 0, -4) + drops();
  else if (kind === 'storm') body = cloud('dark', 0, -5) + '<path class="ws-bolt" d="M21 26l-4 6h3.5l-2 6 6.5-8h-3.5l2-4z" />' + drops([12, 29]);
  else body = cloud('front', 0, 0);
  return `<svg class="ws${mini ? ' mini' : ''}" viewBox="0 0 40 40">${body}</svg>`;
}

let battery = null;
let batterySettings = { showPercent: true };
// PC tanpa baterai melapor 100% + mengisi terus; ikon baru tampil setelah pernah terlihat
// memakai baterai atau kurang dari 100% (diingat supaya tidak perlu menunggu lagi).
let hasBattery = false;
try {
  hasBattery = localStorage.getItem('kapsul.hasBattery') === '1';
} catch {
  // tanpa penyimpanan
}

const lowBattery = () => Boolean(battery && !battery.charging && battery.level <= 0.2);

function renderBattery() {
  const badge = $('pill-battery');
  badge.hidden = !battery || !hasBattery || !(batterySettings.showPercent || lowBattery());
  if (battery) {
    const percent = Math.round(battery.level * 100);
    $('bat-fill').style.width = `${Math.max(6, percent)}%`;
    // Batas warna angka mengikuti ujung isi (padding 1,5px dari lebar 24px): gelap di atas isi, terang di bagian kosong.
    $('bat-fill').parentElement.style.setProperty('--fill', `${(((1.5 + (21 * Math.max(6, percent)) / 100) / 24) * 100).toFixed(1)}%`);
    $('bat-text').textContent = String(percent);
    badge.classList.toggle('charging', battery.charging);
    badge.classList.toggle('low', lowBattery());
    // Isi tinggal sedikit: angka terang supaya tetap terbaca di atas ikon kosong.
    badge.classList.toggle('thin', percent < 45);
    badge.title = `Baterai ${percent}%${battery.charging ? ' · mengisi daya' : ''}`;
  }
  if (PAGES[pageIndex].id === 'device') renderDeviceTop();
  renderBuddy();
}

const durationText = (seconds) => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} j ${minutes % 60} m` : `${minutes} m`;
};

// Charger dicolok / dicabut saat panel terbuka: Zeno bereaksi di panel.
// (Saat tertutup, main.js menampilkan kartu seperti "Claude selesai".)
function onChargingChange(b) {
  if (!open) return;
  const percent = Math.round(b.level * 100);
  const name = profile.buddyName || 'Zeno';
  if (b.charging) {
    // Perkiraan waktu hanya muat di gelembung panel, tidak di kapsul kecil.
    const full = open && Number.isFinite(b.chargingTime) && b.chargingTime > 0 ? ` · penuh ±${durationText(b.chargingTime)}` : '';
    react('charging', 4000);
    say(percent >= 95 ? [`Hampir penuh, ${percent}%`] : [`Nyam, setrum! ${percent}%${full}`, `${name} diisi! ${percent}%${full}`], 4000);
    sfx('charge');
  } else {
    const left = open && Number.isFinite(b.dischargingTime) ? ` · cukup ±${durationText(b.dischargingTime)}` : '';
    react('unplug', 3200);
    say([`Eh, dicabut! ${percent}%${left}`, `Pakai baterai, ${percent}%${left}`], 3600);
    sfx('unplug');
  }
}

// Sedang digeser: kapsul berubah bentuk saat mendekati / menjauhi tepi atas layar.
window.kapsul.onIslandPreview((island) => {
  document.body.dataset.island = island;
  document.body.dataset.preview = '';
  document.body.style.setProperty('--inset', '0px');
});

// ---------- Perangkat tersambung (section Perangkat) ----------

const DEVICE_ICONS = {
  audio: '<svg viewBox="0 0 16 16"><path d="M3.5 10V8a4.5 4.5 0 0 1 9 0v2" /><rect x="2.5" y="9.5" width="3" height="4" rx="1.2" /><rect x="10.5" y="9.5" width="3" height="4" rx="1.2" /></svg>',
  mouse: '<svg viewBox="0 0 16 16"><rect x="4.5" y="2.5" width="7" height="11" rx="3.5" /><path d="M8 4.5v2" /></svg>',
  keyboard: '<svg viewBox="0 0 16 16"><rect x="1.5" y="4.5" width="13" height="7" rx="1.5" /><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.3h6" /></svg>',
  phone: '<svg viewBox="0 0 16 16"><rect x="4.5" y="1.5" width="7" height="13" rx="1.6" /><path d="M7 12.3h2" /></svg>',
  storage: '<svg viewBox="0 0 16 16"><rect x="5" y="1.5" width="6" height="13" rx="1.4" /><path d="M7 4h2M7 6h2" /></svg>',
  camera: '<svg viewBox="0 0 16 16"><rect x="1.5" y="5" width="13" height="8" rx="1.6" /><circle cx="8" cy="9" r="2.2" /><path d="M5.5 5l1-1.6h3l1 1.6" /></svg>',
  other: '<svg viewBox="0 0 16 16"><path d="M8 2v9.5M8 2 6.5 4h3zM8 13.5a1 1 0 1 0 0 .01M8 10.5 5 8.5V6.5M8 9l3-1.5V6" /></svg>',
};

let connectedDevices = { bluetooth: [], usb: [], drives: [] };

function renderDeviceList() {
  const list = $('device-list');
  const rows = [
    ...connectedDevices.drives.map((d) => ({ ...d, kind: 'storage', tag: `${bytesText(d.free)} kosong`, drive: d.letter })),
    ...connectedDevices.usb.filter((d) => d.kind !== 'storage').map((d) => ({ ...d, tag: 'USB' })),
    ...connectedDevices.bluetooth.map((d) => ({ ...d, kind: d.kind === 'input' ? 'mouse' : d.kind, tag: 'Bluetooth' })),
  ];
  list.replaceChildren();
  $('device-count').textContent = rows.length ? String(rows.length) : '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Belum ada perangkat Bluetooth atau USB yang tersambung.';
    list.append(empty);
    return;
  }
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'device-row';
    const icon = document.createElement('span');
    icon.className = 'device-icon';
    icon.innerHTML = DEVICE_ICONS[row.kind] ?? DEVICE_ICONS.other;
    const name = document.createElement('span');
    name.className = 'device-name';
    name.textContent = row.name;
    const tag = document.createElement('small');
    tag.textContent = row.tag;
    el.append(icon, name);
    // Baterai perangkat (kalau dilaporkan): ikon kecil + persen, merah saat ≤ 20%.
    if (row.battery != null) {
      const bat = document.createElement('span');
      bat.className = `device-bat${row.battery <= 20 ? ' low' : ''}`;
      bat.title = `Baterai ${row.name}: ${row.battery}%`;
      const shell = document.createElement('i');
      const fill = document.createElement('b');
      fill.style.width = `${Math.max(8, row.battery)}%`;
      shell.append(fill);
      bat.append(shell, `${row.battery}%`);
      el.append(bat);
    }
    el.append(tag);
    if (row.drive) {
      for (const [label, fn] of [
        ['Buka', () => window.kapsul.openDrive(row.drive)],
        ['Keluarkan', () => window.kapsul.ejectDrive(row.drive)],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'link';
        button.textContent = label;
        button.addEventListener('click', fn);
        el.append(button);
      }
    }
    list.append(el);
  }
}

window.kapsul.onDevices((state) => {
  connectedDevices = { bluetooth: state?.bluetooth ?? [], usb: state?.usb ?? [], drives: state?.drives ?? [] };
  renderDeviceList();
});
renderDeviceList();

// ---------- Aktivitas live (dari main.js): privasi, rapat, unduhan ----------

const sizeLabel = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function renderLive() {
  const mic = live.privacy.mic.length > 0;
  const cam = live.privacy.camera.length > 0;
  $('privacy-dots').hidden = !mic && !cam;
  $('privacy-mic').hidden = !mic;
  $('privacy-cam').hidden = !cam;
  $('privacy-dots').title = [mic ? `Mikrofon dipakai: ${live.privacy.mic.join(', ')}` : '', cam ? `Kamera dipakai: ${live.privacy.camera.join(', ')}` : ''].filter(Boolean).join('\n');
  renderPillText();
}

window.kapsul.onLive((state) => {
  const started = !live.meeting && state?.meeting;
  live = { privacy: state?.privacy ?? { mic: [], camera: [] }, meeting: state?.meeting ?? null, downloads: state?.downloads ?? [] };
  // Rapat baru mulai: tampilkan durasinya di kapsul.
  if (started) tickIndex = 0;
  renderLive();
});

// Durasi rapat & ukuran unduhan di kapsul diperbarui tiap detik.
setInterval(() => {
  if ((live.meeting || live.downloads.length) && ['meeting', 'download'].includes(tickKey)) renderPillText();
}, 1000);

// Perangkat Bluetooth / USB / flashdisk tersambung atau terputus saat panel terbuka (dari main.js):
// Zeno menyapa perangkatnya. Saat tertutup, main.js menampilkan kartu.
window.kapsul.onDevice(({ event, device }) => {
  const name = device?.name || 'Perangkat';
  if (event === 'connected') {
    const lines = {
      audio: [`${name} tersambung, ayo dengar musik!`, `Asik, ${name} siap!`],
      input: [`${name} tersambung!`, `Halo, ${name}!`],
      phone: [`${name} tersambung!`],
      storage: [`${name} siap dibuka!`],
    }[device.kind] ?? [`${name} tersambung!`];
    react(device.kind === 'audio' ? 'music' : device.kind === 'storage' ? 'starstruck' : 'paired', 3500);
    say(lines, 3500);
    sfx('connect');
  } else {
    react('surprised', 2600);
    say([`${name} terputus`, `Dadah, ${name}!`], 3000);
    sfx('disconnect');
  }
});

// Battery Status API: laptop saja; di PC tanpa baterai level selalu 100% & charging.
(async () => {
  try {
    const b = await navigator.getBattery();
    const update = () => {
      const was = battery;
      battery = { level: b.level, charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime };
      if (!hasBattery && (b.level < 1 || !b.charging)) {
        hasBattery = true;
        try {
          localStorage.setItem('kapsul.hasBattery', '1');
        } catch {
          // tanpa penyimpanan
        }
      }
      if (was && was.charging !== b.charging) {
        onChargingChange(b);
        $('pill-battery').classList.remove('zap');
        void $('pill-battery').offsetWidth;
        $('pill-battery').classList.add('zap');
      }
      window.kapsul.battery(battery);
      renderBattery();
    };
    b.addEventListener('levelchange', update);
    b.addEventListener('chargingchange', update);
    update();
  } catch {
    // tanpa info baterai
  }
})();

// ---------- Perintah suara ----------
// Ctrl+Alt+Z: mulai mendengar; berhenti sendiri setelah diam ~1,1 dtk (maks. 8 dtk), atau tekan lagi.

let listening = null; // { stop() }
let voiceState = null; // 'listening' | 'thinking' | null

function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function setVoiceState(state) {
  voiceState = state;
  shell.classList.toggle('listening', state === 'listening');
  $('mic-level').hidden = state !== 'listening';
  renderPillText();
  renderBuddy();
}

// mode 'command' = perintah suara biasa; 'dictate' = isi kotak chat lalu kirim.
async function startListening(mode = 'command') {
  if (listening || voiceState === 'thinking') return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch {
    setVoiceState(null);
    react('confused', 2000);
    return;
  }
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const started = Date.now();
  let heardAt = 0;
  let lastLoud = 0;
  let done = false;

  const finish = async (send) => {
    if (done) return;
    done = true;
    listening = null;
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    sfx('tick');
    $('chat-mic').classList.remove('on');
    if (!send || !heardAt) {
      setVoiceState(null);
      if (send) react('confused', 1800);
      return;
    }
    setVoiceState('thinking');
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    try {
      const result = await window.kapsul.sendAudio(encodeWav(samples, 16000), mode);
      if (mode === 'dictate') onDictated(result);
    } finally {
      setVoiceState(null);
    }
  };

  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const now = Date.now();
    if (rms > 0.02) {
      lastLoud = now;
      if (!heardAt) heardAt = now;
    }
    // Level mikrofon untuk 4 batang di kapsul.
    [...$('mic-level').children].forEach((bar, i) => bar.style.setProperty('--lvl', String(Math.min(1, 0.2 + rms * (10 + i * 4)))));
    if (heardAt && now - lastLoud > 1100) finish(true);
    else if (!heardAt && now - started > 4000) finish(true);
    else if (now - started > 8000) finish(true);
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  listening = { stop: () => finish(true) };
  sfx('blip');
  setVoiceState('listening');
  $('chat-mic').classList.toggle('on', mode === 'dictate');
}

window.kapsul.onListen(() => {
  if (listening) listening.stop();
  else startListening();
});

// Jawaban Zeno (WAV dari suara Windows).
window.kapsul.onSpeech((data) => {
  try {
    const audio = new Audio(data);
    audio.volume = Math.min(1, (soundSettings.volume ?? 0.6) + 0.3);
    audio.play();
  } catch {
    // tanpa suara
  }
});

makeSeekable($('np-progress').querySelector('i'), {
  onPreview: (f) => {
    $('np-bar').style.width = `${f * 100}%`;
    $('np-elapsed').textContent = mmss(f * media.duration);
  },
});
makeSeekable($('lyrics-progress').parentElement, {
  onPreview: (f) => {
    $('lyrics-progress').style.width = `${f * 100}%`;
  },
});

// ---------- Chat dengan Zeno (kotak chat, suara, file) ----------

let chatState = { messages: [], busy: false, ready: false, provider: 'AI' };
let pendingFiles = []; // file yang sudah "dilahap", ikut pertanyaan berikutnya
let pendingMsg = null; // pesan yang sedang dikirim (tampil sebelum riwayat dari main datang)
let chatError = null;

const CHAT_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const CHAT_TEXT = new Set(['txt', 'md', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'php', 'rb', 'c', 'cpp', 'cs', 'html', 'css', 'xml', 'yml', 'yaml', 'sql', 'log', 'ini', 'env']);
const FILE_ICONS = {
  image: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2" /><circle cx="6" cy="6.5" r="1.2" /><path d="M2.5 11.5 6 8.5l3 2.5 2-1.5 2.5 2" /></svg>',
  pdf: '<svg viewBox="0 0 16 16"><path d="M4 1.8h5.5L13 5.3V14H4z" /><path d="M9.5 1.8v3.5H13M6 9h5M6 11.5h3.5" /></svg>',
  text: '<svg viewBox="0 0 16 16"><path d="M4 1.8h5.5L13 5.3V14H4z" /><path d="M6 7h5M6 9.3h5M6 11.6h3" /></svg>',
};

const readAs = (file, how) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader[how](file);
  });

// File dari 📎 atau seret → { name, mime, kind, data | text } atau { error }.
async function readChatFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mb = file.size / 1024 / 1024;
  if (CHAT_IMAGES.has(file.type)) {
    if (mb > 5) return { error: `${file.name} terlalu besar (maks. 5 MB untuk gambar).` };
    return { name: file.name, mime: file.type, kind: 'image', data: String(await readAs(file, 'readAsDataURL')).split(',')[1] };
  }
  if (file.type === 'application/pdf' || ext === 'pdf') {
    if (mb > 10) return { error: `${file.name} terlalu besar (maks. 10 MB untuk PDF).` };
    return { name: file.name, mime: 'application/pdf', kind: 'pdf', data: String(await readAs(file, 'readAsDataURL')).split(',')[1] };
  }
  if (CHAT_TEXT.has(ext) || file.type.startsWith('text/') || file.type === 'application/json') {
    if (mb > 1) return { error: `${file.name} terlalu besar (maks. 1 MB untuk file teks).` };
    return { name: file.name, mime: 'text/plain', kind: 'text', text: String(await readAs(file, 'readAsText')) };
  }
  return { error: `Zeno belum bisa melahap file ${ext ? `.${ext}` : 'ini'}. Coba gambar, PDF, atau file teks.` };
}

// Zeno melahap file: kartu file terbang ke mulutnya, lalu mengunyah.
function eatAnimation(file, from) {
  const big = $('buddy-big').getBoundingClientRect();
  const mouth = { x: big.left + big.width / 2, y: big.top + big.height * 0.62 };
  const start = from ?? (() => {
    const r = $('chat-attach').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })();
  const chip = document.createElement('div');
  chip.className = 'eat-chip';
  chip.innerHTML = FILE_ICONS[file.kind] ?? FILE_ICONS.text;
  const name = document.createElement('span');
  name.textContent = file.name;
  chip.append(name);
  chip.style.left = `${start.x}px`;
  chip.style.top = `${start.y}px`;
  document.body.append(chip);
  react('surprised', 700); // mulut terbuka menunggu
  const dx = mouth.x - start.x;
  const dy = mouth.y - start.y;
  const flight = chip.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
      { offset: 0.55, transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6 - 28}px)) scale(0.75) rotate(-10deg)`, opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.1) rotate(25deg)`, opacity: 0.3 },
    ],
    { duration: 720, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
  );
  flight.finished.then(() => {
    chip.remove();
    react('eat', 1800);
    sfx('munch');
    bigBuddy.jump();
  });
}

async function attachFiles(list, from) {
  const files = [...(list ?? [])];
  if (!files.length) return;
  goToSection('chat', { sound: false });
  for (const [i, file] of files.entries()) {
    if (pendingFiles.length >= 4) {
      say(['Perutku penuh, maksimal 4 file sekali kirim ya.'], 3000);
      break;
    }
    const read = await readChatFile(file).catch(() => ({ error: `${file.name} gagal dibaca.` }));
    if (read.error) {
      react('confused', 2000);
      say([read.error], 3600);
      continue;
    }
    pendingFiles.push(read);
    setTimeout(() => eatAnimation(read, from && { x: from.x + i * 14, y: from.y }), i * 260);
  }
  renderChat();
  $('chat-input').focus();
}

async function chatSend(text, { spoken = false } = {}) {
  const value = (text ?? $('chat-input').value).trim();
  if ((!value && !pendingFiles.length) || chatState.busy) return;
  const files = pendingFiles;
  pendingFiles = [];
  chatError = null;
  pendingMsg = { role: 'user', text: value || 'Tolong jelaskan file ini.', files: files.map((f) => ({ name: f.name, kind: f.kind })) };
  $('chat-input').value = '';
  sfx('blip');
  renderChat();
  const result = await window.kapsul.chatSend(value, files, { spoken });
  pendingMsg = null;
  if (!result?.ok) {
    chatError = result?.error || 'Maaf, aku gagal menjawab.';
    react('confused', 2200);
  } else {
    react('happy', 1400);
  }
  renderChat();
}

function onDictated(result) {
  const heard = result?.heard?.trim();
  if (!result?.ok || !heard) {
    react('confused', 1800);
    if (result?.error) say([result.error], 4000);
    return;
  }
  $('chat-input').value = heard;
  chatSend(heard, { spoken: true });
}

// Markdown ringan dari AI: **tebal** jadi tebal, "# Judul" jadi baris tebal; sisanya teks biasa.
function richText(el, text) {
  for (const [i, line] of String(text ?? '').split('\n').entries()) {
    if (i) el.append('\n');
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    const parts = (heading ? `**${heading[1]}**` : line).split(/(\*\*[^*]+\*\*)/);
    for (const part of parts) {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement('strong');
        b.textContent = part.slice(2, -2);
        el.append(b);
      } else if (part) el.append(part);
    }
  }
}

const plainText = (text) => String(text ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '');

function fileChip(f, onRemove) {
  const chip = document.createElement('span');
  chip.className = `file-chip ${f.kind}`;
  chip.innerHTML = FILE_ICONS[f.kind] ?? FILE_ICONS.text;
  const name = document.createElement('span');
  name.textContent = f.name;
  chip.append(name);
  if (onRemove) {
    const x = document.createElement('button');
    x.type = 'button';
    x.title = `Batalkan ${f.name}`;
    x.setAttribute('aria-label', `Batalkan ${f.name}`);
    x.textContent = '×';
    x.addEventListener('click', onRemove);
    chip.append(x);
  }
  return chip;
}

// Kartu atas: jawaban terakhir (atau petunjuk), file yang menunggu, kolom tanya.
function renderChatCard() {
  const last = $('chat-last');
  const files = $('chat-files');
  files.hidden = !pendingFiles.length;
  files.replaceChildren(...pendingFiles.map((f, i) => fileChip(f, () => {
    pendingFiles.splice(i, 1);
    renderChat();
  })));
  last.hidden = pendingFiles.length > 0;
  last.classList.toggle('setup', !chatState.ready);
  last.classList.toggle('thinking', chatState.busy);
  const lastAnswer = [...chatState.messages].reverse().find((m) => m.role === 'assistant');
  last.textContent = !chatState.ready
    ? 'Atur AI dulu di Pengaturan › Ngobrol (Claude, ChatGPT, atau Gemini).'
    : chatState.busy
      ? 'Zeno sedang berpikir…'
      : chatError ?? (lastAnswer ? plainText(lastAnswer.text) : 'Tanya apa saja, atau seret file ke sini supaya dilahap Zeno.');
  $('chat-send').disabled = chatState.busy;
}

// Isi bawah: gelembung percakapan.
function renderChatLog() {
  $('chat-head').textContent = `Obrolan dengan Zeno · ${chatState.provider}`;
  const log = $('chat-log');
  log.replaceChildren();
  if (!chatState.ready) {
    const box = document.createElement('div');
    box.className = 'chat-empty';
    box.append('Zeno perlu otak AI dulu. Pilih Claude, ChatGPT, atau Gemini lalu tempel API key-mu.');
    box.append(actionChip('Buka Pengaturan', () => window.kapsul.openSettings('chat'), { primary: true }));
    log.append(box);
    return;
  }
  const messages = [...chatState.messages, ...(pendingMsg ? [pendingMsg] : [])];
  if (!messages.length) {
    const box = document.createElement('div');
    box.className = 'chat-empty';
    box.append('Belum ada obrolan. Coba salah satu:');
    const row = document.createElement('div');
    row.className = 'action-row wrap';
    for (const q of ['Ingatkan aku minum air 30 menit lagi', 'Apa jadwalku hari ini?', 'Jelaskan file yang kulampirkan']) {
      row.append(actionChip(q, () => (q.startsWith('Jelaskan') ? $('chat-file').click() : chatSend(q))));
    }
    box.append(row);
    log.append(box);
  }
  for (const m of messages) {
    const bubble = document.createElement('div');
    bubble.className = `msg ${m.role === 'user' ? 'user' : 'zeno'}`;
    if (m.files?.length) {
      const files = document.createElement('div');
      files.className = 'msg-files';
      files.append(...m.files.map((f) => fileChip(f)));
      bubble.append(files);
    }
    // Aksi yang dijalankan Zeno untuk pesan ini (pengingat, timer, buka aplikasi, …).
    if (m.actions?.length) {
      const list = document.createElement('ul');
      list.className = 'msg-actions';
      for (const a of m.actions) {
        const li = document.createElement('li');
        li.className = a.ok ? 'ok' : 'fail';
        li.innerHTML = a.ok
          ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>'
          : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>';
        const label = document.createElement('span');
        label.textContent = a.label;
        li.append(label);
        list.append(li);
      }
      bubble.append(list);
    }
    const text = document.createElement('div');
    text.className = 'msg-text';
    if (m.role === 'user') text.textContent = m.text;
    else richText(text, m.text);
    bubble.append(text);
    log.append(bubble);
  }
  if (chatState.busy) {
    const typing = document.createElement('div');
    typing.className = 'msg zeno typing-bubble';
    typing.setAttribute('aria-label', 'Zeno sedang mengetik');
    typing.append(...[0, 1, 2].map(() => document.createElement('i')));
    log.append(typing);
  }
  if (chatError) {
    const err = document.createElement('div');
    err.className = 'msg zeno error';
    err.textContent = chatError;
    log.append(err);
  }
  log.scrollTop = log.scrollHeight;
}

function renderChat() {
  renderChatCard();
  renderChatLog();
  if (PAGES[pageIndex].id === 'chat') renderBuddy();
}

window.kapsul.onChat((state) => {
  chatState = { ...chatState, ...(state ?? {}) };
  if (!chatState.busy) pendingMsg = null;
  renderChat();
});

$('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  chatSend();
});
$('chat-attach').addEventListener('click', () => $('chat-file').click());
$('chat-file').addEventListener('change', (event) => {
  attachFiles(event.target.files);
  event.target.value = '';
});
$('chat-mic').addEventListener('click', () => {
  if (listening) listening.stop();
  else startListening('dictate');
});
$('chat-new').addEventListener('click', () => {
  chatError = null;
  pendingFiles = [];
  window.kapsul.chatReset();
  sfx('swipe');
});
$('chat-last').addEventListener('click', () => {
  if (!chatState.ready) window.kapsul.openSettings('chat');
});

// Seret file ke island: panel terbuka di section Chat, lepas = Zeno melahapnya.
(() => {
  let depth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  const hide = () => {
    depth = 0;
    $('drop-hint').hidden = true;
    shell.classList.remove('dropping');
  };
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    if (!open) window.kapsul.expand(true);
    goToSection('chat', { sound: false });
    $('drop-hint').hidden = false;
    shell.classList.add('dropping');
    if (depth === 1) react('hungry', 1600);
  });
  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) hide();
  });
  // Jangan biarkan Electron membuka file yang dilepas sebagai halaman.
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!hasFiles(event)) return;
    hide();
    attachFiles(event.dataTransfer.files, { x: event.clientX, y: event.clientY });
  });
})();

// ---------- Cari aplikasi ----------
// Tombol panel + semua aplikasi terpasang. ↑↓ pilih, Enter buka.

let launcherApps = [];
let installedList = null;
let searchSelected = 0;
let searchMatches = [];

async function ensureInstalled() {
  if (installedList) return;
  installedList = [];
  try {
    installedList = await window.kapsul.installedApps();
  } catch {
    // daftar tidak tersedia
  }
  renderSearch();
}

function searchScore(name, query) {
  const n = name.toLowerCase();
  if (n.startsWith(query)) return 0;
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(query))) return 1;
  if (n.includes(query)) return 2;
  // Singkatan: "vsc" → Visual Studio Code
  const initials = n.split(/[\s\-_.]+/).map((w) => w[0]).join('');
  return initials.startsWith(query) ? 3 : null;
}

let quickRow = null; // { kind: 'math'|'timer', ... } dari proses utama
let quickQueryText = '';

async function updateQuick() {
  const raw = $('app-search').value.trim();
  quickQueryText = raw;
  const result = raw ? await window.kapsul.quick(raw) : null;
  if (quickQueryText !== raw) return; // sudah diketik lagi
  quickRow = result;
  renderSearch();
}

function renderSearch() {
  const query = $('app-search').value.trim().toLowerCase();
  const results = $('search-results');
  $('apps').hidden = Boolean(query);
  $('apps-head').hidden = Boolean(query) || launcherApps.length <= QUICK_APPS;
  results.hidden = !query;
  if (!query) return;

  const seen = new Set();
  const pool = [
    ...launcherApps.map((a) => ({ name: a.name, icon: a.icon, color: a.color, tag: 'Panel', open: () => launch(a.index) })),
    ...(installedList ?? []).map((a) => ({ name: a.name, icon: a.icon, tag: 'Aplikasi', open: () => openInstalled(a.key) })),
  ];
  searchMatches = pool
    .map((item) => ({ item, score: searchScore(item.name, query) }))
    .filter(({ item, score }) => score !== null && !seen.has(item.name.toLowerCase()) && seen.add(item.name.toLowerCase()))
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 8)
    .map(({ item }) => item);

  // Hitungan / timer tampil paling atas.
  const quick = quickRow;
  if (quick?.kind === 'math') {
    searchMatches.unshift({ name: `= ${quick.text}`, value: true, tag: 'Salin', open: () => {
      window.kapsul.copy(String(quick.value));
      sfx('tick');
      react('wink', 1200);
    } });
  } else if (quick?.kind === 'timer') {
    searchMatches.unshift({ name: `Mulai ${quick.label}`, timer: true, tag: 'Timer', open: () => {
      window.kapsul.timer('start', { ms: quick.ms, label: quick.label });
      sfx('blip');
      goToSection('focus', { sound: false });
    } });
  }
  // Pertanyaan ("…?", "tanya …") atau tidak ada aplikasi yang cocok: tawarkan tanya Zeno.
  const looksLikeQuestion = /\?$|^(tanya|apa|siapa|kenapa|mengapa|bagaimana|gimana|kapan|dimana|di mana|berapa)\b/.test(query);
  if (chatReady && query.length > 2 && !quick && (looksLikeQuestion || !searchMatches.length)) {
    const question = $('app-search').value.trim().replace(/^tanya\s+/i, '');
    searchMatches.push({ name: `Tanya ${profile.buddyName || 'Zeno'}: “${question}”`, ask: true, tag: chatName, open: () => askFromSearch(question) });
  }
  if (quickTimers.length && /^(batal|cancel|stop)/.test(query)) {
    searchMatches.unshift({ name: 'Batalkan semua timer', tag: 'Timer', open: () => window.kapsul.timer('cancel', {}) });
  }
  searchSelected = Math.min(searchSelected, Math.max(0, searchMatches.length - 1));

  results.replaceChildren();
  if (!searchMatches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = installedList
      ? `Tidak ada aplikasi “${query}”. Coba “= 25*4”, “timer 10”${chatReady ? ', atau tanya Zeno dengan tanda “?”' : ''}.`
      : 'Memuat daftar aplikasi…';
    results.append(empty);
    return;
  }
  searchMatches.forEach((item, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'result';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === searchSelected));
    row.addEventListener('mouseenter', () => {
      searchSelected = i;
      [...results.children].forEach((r, j) => r.setAttribute('aria-selected', String(j === i)));
    });
    row.addEventListener('click', () => openResult(item));
    const icon = document.createElement('span');
    icon.className = 'result-icon';
    if (item.ask) {
      icon.textContent = '💬';
    } else if (item.value || item.timer || item.tag === 'Timer') {
      icon.textContent = item.value ? '=' : '⏱';
    } else if (item.icon) {
      const img = document.createElement('img');
      img.src = item.icon;
      img.alt = '';
      icon.append(img);
    } else {
      icon.textContent = item.name.slice(0, 1).toUpperCase();
      if (item.color) icon.style.background = item.color;
    }
    const name = document.createElement('span');
    name.className = item.value ? 'result-name result-value' : 'result-name';
    name.textContent = item.name;
    const tag = document.createElement('span');
    tag.className = 'result-tag';
    tag.textContent = item.tag;
    row.append(icon, name, tag);
    results.append(row);
  });
}

function openResult(item) {
  item.open();
  $('app-search').value = '';
  renderSearch();
}

let chatReady = false;
let chatName = 'AI'; // nama penyedia obrolan (Claude, ChatGPT, Gemini) untuk label pencarian

// Pertanyaan dari kotak cari: panel ditutup, Zeno "berpikir", jawaban muncul di kartu.
async function askFromSearch(question) {
  window.kapsul.expand(false);
  setVoiceState('thinking');
  try {
    await window.kapsul.ask(question);
  } finally {
    setVoiceState(null);
  }
}

function openInstalled(key) {
  sfx('blip');
  window.kapsul.launchInstalled(key);
  setTimeout(() => {
    react('wink', 1600);
    buddy.jump();
  }, 180);
}

$('app-search').addEventListener('focus', ensureInstalled);
$('app-search').addEventListener('input', () => {
  searchSelected = 0;
  renderSearch();
  updateQuick();
});
$('app-search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const n = searchMatches.length;
    if (!n) return;
    searchSelected = (searchSelected + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
    [...$('search-results').children].forEach((r, j) => r.setAttribute('aria-selected', String(j === searchSelected)));
    $('search-results').children[searchSelected]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && searchMatches[searchSelected]) {
    event.preventDefault();
    openResult(searchMatches[searchSelected]);
  }
});

// ---------- Menu daya ----------
// Kunci & tidur langsung; mulai ulang/matikan/keluar akun: hitung mundur 10 dtk yang bisa dibatalkan.

const POWER_TEXT = { restart: 'Mulai ulang', shutdown: 'Matikan', signout: 'Keluar akun' };
let powerTimer = null;

function openPower() {
  $('power-sheet').hidden = false;
  $('power-menu').hidden = false;
  $('power-confirm').hidden = true;
}

function closePower() {
  clearInterval(powerTimer);
  powerTimer = null;
  $('power-sheet').hidden = true;
  reaction = null;
  renderBuddy();
}

function runPower(action) {
  clearInterval(powerTimer);
  powerTimer = null;
  window.kapsul.power(action);
  closePower();
  window.kapsul.expand(false);
}

for (const button of document.querySelectorAll('[data-power]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.power;
    if (!POWER_TEXT[action]) {
      // Kunci / tidur: langsung.
      react(action === 'sleep' ? 'sleep' : 'wink', 1500);
      sfx('tick');
      setTimeout(() => runPower(action), 400);
      return;
    }
    let left = 10;
    const update = () => ($('power-title').textContent = `${POWER_TEXT[action]} dalam ${left} detik…`);
    $('power-menu').hidden = true;
    $('power-confirm').hidden = false;
    $('power-now').textContent = `${POWER_TEXT[action]} sekarang`;
    $('power-now').onclick = () => runPower(action);
    update();
    reaction = 'cry';
    renderBuddy();
    sfx('uhoh');
    powerTimer = setInterval(() => {
      left--;
      if (left <= 0) runPower(action);
      else update();
    }, 1000);
  });
}

$('power-btn').addEventListener('click', () => {
  if ($('power-sheet').hidden) openPower();
  else closePower();
});
$('power-cancel').addEventListener('click', closePower);

// ---------- Statistik & Zeno peliharaan ----------

let statsToday = null;
let petState = null;

let statsWeek = [];

const WEEKDAY = new Intl.DateTimeFormat('id-ID', { weekday: 'short' });

// Grafik batang 7 hari (lama → baru); value(d) = angka batang, text(d) = angka kecil di atasnya.
function renderWeekChart(chart, days, value, text, title) {
  const max = Math.max(1, ...days.map(value));
  chart.replaceChildren();
  for (const [i, d] of days.entries()) {
    const col = document.createElement('div');
    col.className = 'week-col';
    const today = i === days.length - 1;
    if (today) col.classList.add('today');
    const top = document.createElement('small');
    top.textContent = value(d) ? text(d) : '';
    const bar = document.createElement('i');
    bar.style.height = `${Math.max(4, (100 * value(d)) / max)}%`;
    if (!value(d)) bar.classList.add('zero');
    const label = document.createElement('span');
    label.textContent = today || !d.key ? 'Ini' : WEEKDAY.format(new Date(`${d.key}T12:00`));
    col.title = title(d);
    col.append(top, bar, label);
    chart.append(col);
  }
}

// Detail Fokus: sesi & menit hari ini, grafik 7 hari terakhir.
function renderFocusReport() {
  const t = statsToday ?? {};
  $('focus-stat-sessions').textContent = String(t.focus ?? 0);
  $('focus-stat-minutes').textContent = String(Math.round((t.focusMs ?? 0) / 60_000));
  const days = statsWeek.length ? statsWeek : [{ key: '', focus: t.focus ?? 0 }];
  $('focus-stat-week').textContent = String(days.reduce((sum, d) => sum + (d.focus ?? 0), 0));
  $('focus-week-total').textContent = `${days.reduce((sum, d) => sum + (d.focus ?? 0), 0)} sesi`;
  renderWeekChart($('focus-week'), days, (d) => d.focus ?? 0, (d) => String(d.focus), (d) => `${d.focus ?? 0} sesi${d.focusMs ? ` · ${Math.round(d.focusMs / 60_000)} menit` : ''}`);
}

// Detail Musik tanpa lirik: waktu dengar & lagu terlama hari ini, grafik 7 hari.
let statsMusic = null;
const minutesText = (ms) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} m` : `${m} m`;
};

function renderMusicReport() {
  const m = statsMusic ?? { listenMs: 0, count: 0, songs: [] };
  $('music-listen').textContent = String(Math.round(m.listenMs / 60_000));
  $('music-count').textContent = String(m.count);

  const list = $('music-top');
  list.replaceChildren();
  const longest = m.songs[0]?.ms || 1;
  for (const song of m.songs) {
    const [title, ...artist] = song.name.split(' · ');
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'music-name';
    const b = document.createElement('b');
    b.textContent = title;
    name.append(b);
    if (artist.length) {
      const a = document.createElement('span');
      a.textContent = ` · ${artist.join(' · ')}`;
      name.append(a);
    }
    const time = document.createElement('small');
    time.textContent = minutesText(song.ms);
    const bar = document.createElement('i');
    bar.style.width = `${(100 * song.ms) / longest}%`;
    li.append(name, time, bar);
    list.append(li);
  }
  if (!m.songs.length) {
    const li = document.createElement('li');
    li.className = 'music-empty';
    li.append('Belum ada lagu hari ini. Putar lagu di Spotify atau Chrome, Zeno mencatat lagu favoritmu.');
    const spotify = launcherApps.find((a) => /spotify/i.test(a.name));
    if (spotify) li.append(actionChip('Buka Spotify', () => launch(spotify.index), { primary: true }));
    list.append(li);
  }

  const days = statsWeek.length ? statsWeek : [{ key: '', listenMs: m.listenMs }];
  $('music-week-total').textContent = minutesText(days.reduce((sum, d) => sum + (d.listenMs ?? 0), 0));
  renderWeekChart($('music-week'), days, (d) => d.listenMs ?? 0, (d) => String(Math.round(d.listenMs / 60_000)), (d) => `${minutesText(d.listenMs ?? 0)} mendengarkan`);
}

// ---------- Waktu layar (detail Perangkat) ----------

let screenState = null;
const hoursText = (ms) => {
  const h = ms / 3_600_000;
  return h >= 10 ? String(Math.round(h)) : h.toFixed(1).replace('.', ',').replace(',0', '');
};
const shortDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });

function renderScreen() {
  const s = screenState ?? { today: { totalMs: 0, apps: [], count: 0 }, week: [], lastWeek: null };
  $('screen-total').textContent = s.today.totalMs >= 60_000 ? minutesText(s.today.totalMs) : '';
  const list = $('screen-top');
  list.replaceChildren();
  const longest = s.today.apps[0]?.ms || 1;
  for (const a of s.today.apps) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'music-name';
    const b = document.createElement('b');
    b.textContent = a.name;
    name.append(b);
    const time = document.createElement('small');
    time.textContent = minutesText(a.ms);
    const bar = document.createElement('i');
    bar.style.width = `${(100 * a.ms) / longest}%`;
    li.append(name, time, bar);
    list.append(li);
  }
  if (!s.today.apps.length) {
    const li = document.createElement('li');
    li.className = 'music-empty';
    li.textContent = 'Zeno mencatat aplikasi yang kamu pakai (tanpa saat idle atau terkunci). Datanya hanya disimpan di laptop ini.';
    list.append(li);
  }

  const days = s.week.length ? s.week : [{ key: '', ms: s.today.totalMs }];
  const total = days.reduce((n, d) => n + (d.ms ?? 0), 0);
  $('screen-week-total').textContent = total >= 60_000 ? `${minutesText(total / days.length)} / hari` : '';
  renderWeekChart($('screen-week'), days, (d) => d.ms ?? 0, (d) => `${hoursText(d.ms)} j`, (d) => `${minutesText(d.ms ?? 0)} waktu layar`);

  const w = s.lastWeek;
  $('screen-weekly').hidden = !w;
  if (w) {
    $('screen-weekly-range').textContent = `${shortDate.format(new Date(`${w.from}T12:00`))} – ${shortDate.format(new Date(`${w.to}T12:00`))}`;
    const stats = $('screen-weekly-stats');
    stats.replaceChildren();
    for (const [value, label] of [
      [w.screenMs, 'layar'],
      [w.focusMs, 'fokus'],
      [w.listenMs, 'musik'],
    ]) {
      const cell = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = value >= 60_000 ? minutesText(value) : '–';
      const span = document.createElement('span');
      span.textContent = label;
      cell.append(b, span);
      stats.append(cell);
    }
    $('screen-weekly-change').textContent = [w.change ? `Waktu layar ${w.change}.` : '', w.apps[0] ? `Paling lama di ${w.apps[0].name}.` : ''].filter(Boolean).join(' ');
  }
}

window.kapsul.onScreen((data) => {
  screenState = data;
  renderScreen();
});

window.kapsul.onStats((data) => {
  statsToday = data?.today ?? null;
  petState = data?.pet ?? null;
  statsWeek = data?.week ?? [];
  statsMusic = data?.music ?? null;
  renderFocusReport();
  renderMusicReport();
  if (!claudeState.active.length) renderWorkStats();
  if (['home', 'focus'].includes(PAGES[pageIndex].id)) renderPage();
});

// ---------- Agenda (kalender) ----------

const hm = (ms) => timeFormat.format(new Date(ms)).replace('.', ':');

// "14:00", "Besok 09:00", "Seharian", "Sedang berlangsung"
function eventTime(e, now = Date.now()) {
  if (e.allDay) return new Date(e.start).toDateString() === new Date(now).toDateString() || e.start < now ? 'Seharian' : 'Besok, seharian';
  if (e.start <= now) return `Berlangsung · sampai ${hm(e.end)}`;
  const tomorrow = new Date(e.start).toDateString() !== new Date(now).toDateString();
  return `${tomorrow ? 'Besok ' : ''}${hm(e.start)}`;
}

const nextMeeting = (now = Date.now()) => (calendarEvents ?? []).find((e) => !e.allDay && e.end > now) ?? null;

function renderAgenda() {
  const now = Date.now();
  const list = $('agenda-list');
  list.replaceChildren();
  const events = (calendarEvents ?? []).filter((e) => e.end > now).slice(0, 5);
  $('agenda-block').hidden = calendarEvents === null;
  $('agenda-kicker').textContent = events.length ? 'Agenda' : 'Agenda · kosong';
  if (!events.length) {
    const li = document.createElement('li');
    li.className = 'dim';
    li.textContent = 'Tidak ada acara hari ini & besok.';
    list.append(li);
  }
  for (const e of events) {
    const li = document.createElement('li');
    // Kolom jam dibuat pendek; "Kini" = sedang berlangsung.
    const time = document.createElement('b');
    time.textContent = e.allDay ? (e.start <= now ? 'Hari ini' : 'Besok') : e.start <= now ? 'Kini' : eventTime(e, now);
    const title = document.createElement('span');
    title.textContent = e.title;
    li.append(time, title);
    if (e.start <= now && !e.allDay) li.classList.add('now');
    list.append(li);
  }
  // Tombol Gabung untuk rapat berikutnya (atau yang sedang berjalan) yang punya link.
  const next = nextMeeting(now);
  const join = $('agenda-join');
  join.hidden = !(next?.link && next.start - now < 60 * 60_000);
  join.onclick = () => next?.link && window.kapsul.meeting(next.link);
}

window.kapsul.onCalendar((data) => {
  calendarEvents = data?.connected ? data.events : null;
  renderAgenda();
  renderPillText();
});

setInterval(() => {
  if (open && PAGES[pageIndex].id === 'time') renderAgenda();
}, 30_000);

// ---------- Kebiasaan ----------

function renderHabits() {
  const chips = $('habit-chips');
  $('habits-block').hidden = habitItems.length === 0;
  chips.replaceChildren();
  const todayList = habitItems.filter((h) => h.scheduled);
  const done = todayList.filter((h) => h.done).length;
  $('habits-kicker').textContent = todayList.length ? `Kebiasaan hari ini · ${done}/${todayList.length}` : 'Hari ini libur kebiasaan';
  for (const h of habitItems) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'habit-chip';
    chip.classList.toggle('done', h.done);
    chip.classList.toggle('off', !h.scheduled);
    chip.setAttribute('aria-pressed', String(h.done));
    chip.title = h.done ? 'Batal centang' : h.scheduled ? 'Tandai selesai' : 'Bukan jadwal hari ini';
    const streak = document.createElement('small');
    streak.textContent = h.streak ? `🔥${h.streak}` : '';
    chip.append(`${h.emoji} ${h.name}`, streak);
    chip.addEventListener('click', () => {
      if (!h.done) sfx('tick');
      window.kapsul.habit(h.id, !h.done);
    });
    chips.append(chip);
  }
}

window.kapsul.onHabits((list) => {
  habitItems = list ?? [];
  renderHabits();
  renderPillText();
});

// ---------- Sistem & internet ----------

// level: 'ok' | 'mid' (kuning) | 'high' (merah) → warna meter.
function bar(id, percent, text, level = 'ok') {
  $(id).style.width = `${percent ?? 0}%`;
  $(id).dataset.level = level;
  $(`${id}-text`).textContent = text;
}

const loadLevel = (p) => (p == null ? 'ok' : p >= 90 ? 'high' : p >= 75 ? 'mid' : 'ok');

function renderSystem() {
  const s = systemNow;
  if (!s) return;
  const net = $('system-net');
  net.className = `system-net ${s.online === false ? 'off' : s.online ? 'on' : ''}`;
  net.textContent = s.online == null ? 'Mengecek…' : s.online ? `Online${s.ms ? ` · ${s.ms} ms` : ''}` : 'Internet putus';
  bar('system-cpu', s.cpu, s.cpu != null ? `${s.cpu}%` : '–', loadLevel(s.cpu));
  bar('system-ram', s.memory?.percent, s.memory ? `${s.memory.percent}%` : '–', loadLevel(s.memory?.percent));
  const diskFree = s.disk ? 100 - s.disk.percent : null;
  $('system-disk-label').textContent = s.disk?.drive ? `Sisa disk ${s.disk.drive}` : 'Sisa disk';
  bar('system-disk', s.disk?.percent, s.disk ? bytesText(s.disk.free) : '–', diskFree == null ? 'ok' : diskFree < 10 ? 'high' : diskFree < 20 ? 'mid' : 'ok');
}

function bytesText(n) {
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1).replace('.', ',')} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

window.kapsul.onSystem((state) => {
  const was = systemNow?.online;
  systemNow = state;
  if (PAGES[pageIndex].id === 'device') renderPage();
  if (was !== state?.online) renderPillText();
});

$('snip-btn').addEventListener('click', () => window.kapsul.snip());

// ---------- Timer cepat ----------

let quickTimers = [];

// Daftar dibangun ulang hanya saat isinya berubah; angka & bar diperbarui tiap detik.
function renderTimers() {
  const list = $('timer-list');
  const count = $('timer-count');
  count.hidden = quickTimers.length === 0;
  count.textContent = String(quickTimers.length);
  $('timer-block').hidden = quickTimers.length === 0;
  const ids = quickTimers.map((t) => t.id).join(',');
  if (list.dataset.ids !== ids) {
    list.dataset.ids = ids;
    list.replaceChildren();
    for (const t of quickTimers) {
      const row = document.createElement('div');
      row.className = 'timer-row';
      row.dataset.id = t.id;
      const name = document.createElement('span');
      name.className = 'timer-name';
      name.textContent = t.label;
      const time = document.createElement('b');
      const bar = document.createElement('i');
      bar.className = 'timer-bar';
      bar.append(document.createElement('span'));
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'notif-x';
      close.title = 'Batalkan timer';
      close.setAttribute('aria-label', `Batalkan ${t.label}`);
      close.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>';
      close.addEventListener('click', () => window.kapsul.timer('cancel', { id: t.id }));
      row.append(name, time, close, bar);
      list.append(row);
    }
  }
  for (const row of list.querySelectorAll('.timer-row')) {
    const t = quickTimers.find((x) => x.id === row.dataset.id);
    if (!t) continue;
    const left = Math.max(0, t.endsAt - Date.now());
    row.querySelector('b').textContent = clock(left);
    row.querySelector('.timer-bar span').style.width = `${(100 * left) / (t.total || left || 1)}%`;
    row.classList.toggle('final', left < 10_000);
  }
}

window.kapsul.onTimers((list) => {
  quickTimers = list ?? [];
  renderTimers();
  renderFocusSummary();
  renderPillText();
});

renderFocus();
renderTimers();

setInterval(() => {
  if (!quickTimers.length) return;
  renderTimers();
  if (tickKey === 'timer') renderPillText();
}, 1000);

// ---------- Zeno peliharaan ----------

function renderPet() {
  if (!petState) return;
  const hunger = Math.round(petState.hunger);
  $('pet-level').textContent = profile.buddyName || 'Zeno';
  $('pet-xp').textContent = `${Math.floor(petState.xp)} / ${petState.needed} XP ke level ${petState.level + 1}`;
  $('pet-lv').textContent = String(petState.level);
  $('pet-xpring').style.strokeDasharray = `${Math.min(100, (petState.xp / petState.needed) * 100)} 100`;
  $('pet-hunger').style.width = `${hunger}%`;
  $('pet-hunger').classList.toggle('low', hunger < 25);
  $('pet-hunger-text').textContent = `${hunger}%`;
  $('pet-xpbar').style.width = `${Math.min(100, (petState.xp / petState.needed) * 100)}%`;
  if (PAGES[pageIndex].id === 'home') renderBuddy();
}

for (const button of document.querySelectorAll('[data-food]')) {
  button.addEventListener('click', () => window.kapsul.pet('feed', button.dataset.food));
}
$('pet-play').addEventListener('click', () => window.kapsul.pet('play'));

// Makan: mengunyah + suara nyam; main: lompat & tertawa.
window.kapsul.onPetEvent((event) => {
  if (event.type === 'eat') {
    react('eat', 1800);
    sfx('munch');
  } else if (event.type === 'habit') {
    react('laugh', 1400);
    bigBuddy.jump();
    buddy.jump();
  } else if (event.type === 'play') {
    react('laugh', 1600);
    bigBuddy.jump();
    buddy.jump();
    sfx('giggle');
  }
});

// ---------- Kontrol cepat Windows ----------

let quick = null;
let quickDragging = { volume: false, brightness: false };

function renderQuick() {
  if (!quick) return;
  const volume = $('quick-volume');
  if (!quickDragging.volume && quick.volume != null) volume.value = String(quick.volume);
  $('quick-volume-value').textContent = quick.volume != null ? `${volume.value}%` : '–';
  volume.disabled = quick.volume == null;
  $('quick-mute').classList.toggle('muted', Boolean(quick.muted));
  $('quick-mute').title = quick.muted ? 'Nyalakan suara' : 'Bisukan';

  // Layar tanpa dukungan (mis. monitor eksternal) = baris kecerahan disembunyikan.
  $('quick-brightness-row').hidden = quick.brightness == null;
  if (!quickDragging.brightness && quick.brightness != null) $('quick-brightness').value = String(quick.brightness);
  $('quick-brightness-value').textContent = `${$('quick-brightness').value}%`;

  for (const what of ['wifi', 'bluetooth']) {
    const button = $(`quick-${what}`);
    button.disabled = quick[what] == null || quick[what] === 'Disabled';
    button.hidden = quick[what] == null;
    button.setAttribute('aria-pressed', String(quick[what] === 'On'));
  }
  // Mikrofon: tombol menyala (merah) = mikrofon dibisukan.
  const mic = $('quick-mic');
  mic.hidden = quick.micMuted == null;
  mic.setAttribute('aria-pressed', String(Boolean(quick.micMuted)));
  mic.title = quick.micMuted ? 'Nyalakan mikrofon' : 'Bisukan mikrofon';
  mic.setAttribute('aria-label', mic.title);
}

window.kapsul.onQuickState((state) => {
  quick = state;
  renderQuick();
});

// Geser slider: kirim paling cepat tiap 120 ms; nilai akhir saat dilepas.
for (const what of ['volume', 'brightness']) {
  const input = $(`quick-${what}`);
  let last = 0;
  input.addEventListener('input', () => {
    quickDragging[what] = true;
    $(`quick-${what}-value`).textContent = `${input.value}%`;
    if (Date.now() - last > 120) {
      last = Date.now();
      window.kapsul.quickSet(what, input.value);
    }
  });
  input.addEventListener('change', () => {
    quickDragging[what] = false;
    window.kapsul.quickSet(what, input.value);
  });
}

$('quick-mute').addEventListener('click', () => window.kapsul.quickSet('mute', 'toggle'));
$('quick-mic').addEventListener('click', () => {
  const muted = !(quick?.micMuted);
  if (quick) quick = { ...quick, micMuted: muted };
  window.kapsul.micMute(muted);
  renderQuick();
  sfx(muted ? 'disconnect' : 'connect');
});
for (const what of ['wifi', 'bluetooth']) {
  $(`quick-${what}`).addEventListener('click', () => {
    const on = $(`quick-${what}`).getAttribute('aria-pressed') === 'true';
    window.kapsul.quickSet(what, on ? 'off' : 'on');
  });
}


// ---------- Pengingat berikutnya (section Waktu) ----------

window.kapsul.onReminders((next) => {
  nextReminder = next;
  renderTimeCard();
  $('next-reminder').classList.toggle('empty', !next);
  $('next-reminder-text').textContent = next ? `${next.title} · ${next.when}` : 'Belum ada pengingat. Tambah di Pengaturan.';
});

setInterval(() => {
  if (!$('notifs').hidden) renderNotifications();
}, 60_000);

// ---------- Musik ----------

for (const button of document.querySelectorAll('[data-cmd]')) {
  button.addEventListener('click', () => window.kapsul.media(button.dataset.cmd));
}

$('edit').addEventListener('click', () => window.kapsul.openSettings());
$('next-reminder').addEventListener('click', () => window.kapsul.openSettings('reminders'));

// "SpotifyAB.SpotifyMusic_…!Spotify" / "chrome.exe" / "Music" → nama yang dikenal orang.
function mediaSource(app) {
  const a = String(app ?? '');
  if (/spotify/i.test(a)) return 'Spotify';
  if (/msedge|edge/i.test(a)) return 'Edge';
  if (/chrome/i.test(a)) return 'Chrome';
  if (/firefox/i.test(a)) return 'Firefox';
  if (/^music$|apple/i.test(a)) return 'Apple Music';
  if (/zunemusic|mediaplayer/i.test(a)) return 'Media Player';
  if (/vlc/i.test(a)) return 'VLC';
  return '';
}

// Bar progres di kartu Musik (diperbarui tiap detik saat section Musik terbuka).
function renderMusicProgress() {
  const ms = trackPosition();
  const duration = media.duration;
  const show = Boolean(media.title) && ms != null && duration > 0;
  $('np-progress').hidden = !show;
  if (!show) return;
  $('np-elapsed').textContent = mmss(Math.min(ms, duration));
  $('np-total').textContent = mmss(duration);
  $('np-bar').style.width = `${Math.min(100, (100 * ms) / duration)}%`;
}

// Lompat ke posisi lagu; tampilan langsung ikut, bridge menyusul.
function seekTo(ms) {
  if (!media.title || !(media.duration > 0)) return;
  const pos = Math.max(0, Math.min(media.duration - 500, ms));
  media = { ...media, position: pos, positionAt: Date.now() };
  window.kapsul.seek(pos);
  lyricIndex = -1;
  renderMusicProgress();
  renderLyrics();
}

// Seret di bar progres: ikut kursor, lepas = lompat.
function makeSeekable(track, { onPreview } = {}) {
  const fraction = (event) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - r.left) / (r.width || 1)));
  };
  let dragging = false;
  // Klik di bar tidak ikut membuka detail / mengganti section.
  track.addEventListener('click', (event) => event.stopPropagation());
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !(media.duration > 0)) return;
    event.stopPropagation();
    dragging = true;
    track.setPointerCapture(event.pointerId);
    track.classList.add('seeking');
    onPreview?.(fraction(event));
  });
  track.addEventListener('pointermove', (event) => dragging && onPreview?.(fraction(event)));
  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('seeking');
    seekTo(fraction(event) * media.duration);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', () => {
    dragging = false;
    track.classList.remove('seeking');
  });
}

function renderMedia() {
  const hasTrack = Boolean(media.title);

  $('media').classList.toggle('idle', !hasTrack);
  $('title').textContent = hasTrack ? media.title : 'Tidak ada yang diputar';
  const source = hasTrack ? mediaSource(media.app) : '';
  $('artist').textContent = hasTrack ? [media.artist, source].filter(Boolean).join(' · ') : 'Putar lagu di Spotify atau Chrome';
  $('icon-play').toggleAttribute('hidden', media.playing);
  $('icon-pause').toggleAttribute('hidden', !media.playing);

  const artImg = $('art-img');
  if (hasTrack && media.art) artImg.src = media.art;
  applyArtTint(hasTrack ? media.art : null);
  renderMusicProgress();
  artImg.hidden = !(hasTrack && media.art);
  renderPillText();
  renderBuddy();
}

const clockFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

// ---------- Teks kapsul: berganti otomatis ----------
// Yang mendesak tampil tetap (suara > Claude menunggu > fokus > Claude bekerja);
// selain itu kapsul berputar tiap beberapa detik: jam, musik, cuaca, pengingat, tugas, notifikasi, server, sapaan.

// Bisa diatur di Pengaturan › Tampilan (saklar & durasi).
let tickerSettings = { enabled: true, seconds: 5 };
const PILL_ICONS = {
  mic: '<svg viewBox="0 0 16 16"><rect x="5.5" y="1.8" width="5" height="8" rx="2.5" /><path d="M3.2 7.5a4.8 4.8 0 0 0 9.6 0M8 12.3v2" /></svg>',
  download: '<svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg>',
  music: '<svg viewBox="0 0 16 16"><path d="M6 12V3.5l7-1.5V10.5" /><circle cx="4.5" cy="12" r="1.6" /><circle cx="11.5" cy="10.5" r="1.6" /></svg>',
  cloud: '<svg viewBox="0 0 16 16"><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .2-5.6 4 4 0 0 0-7.7 1A2.3 2.3 0 0 0 4.5 12.5z" /></svg>',
  rain: '<svg viewBox="0 0 16 16"><path d="M4.5 9.5h7.2a2.8 2.8 0 0 0 .2-5.6 4 4 0 0 0-7.7 1A2.3 2.3 0 0 0 4.5 9.5zM5.5 11.5l-.7 2M8.5 11.5l-.7 2M11.5 11.5l-.7 2" /></svg>',
  sun: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>',
  bell: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.2" /><path d="M8 6.4V9l1.8 1.2M3 3.2 4.6 2M13 3.2 11.4 2" /></svg>',
  check: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /><path d="M5.3 8.2l1.9 1.9 3.6-4" /></svg>',
  notif: '<svg viewBox="0 0 16 16"><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3" /></svg>',
  server: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="4" rx="1.2" /><rect x="2.5" y="9" width="11" height="4" rx="1.2" /><path d="M5 5h.01M5 11h.01" /></svg>',
  calendar: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>',
  offline: '<svg viewBox="0 0 16 16"><path d="M1.8 6a9 9 0 0 1 12.4 0M4 8.4a6 6 0 0 1 8 0M6.2 10.8a3 3 0 0 1 3.6 0M2.5 2.5l11 11" /></svg>',
  flame: '<svg viewBox="0 0 16 16"><path d="M8 14a4.5 4.5 0 0 0 4.5-4.5C12.5 6 9 5 9 2c-2 1-3.5 3-3 5.5C5 7 4.5 6 4.6 5A4.5 4.5 0 0 0 8 14z" /></svg>',
  wave: '<svg viewBox="0 0 16 16"><path d="M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v5.5a4 4 0 0 1-7.4 2.1L2.7 9.3a1 1 0 0 1 1.6-1.2l1.2 1.2" /></svg>',
};

let tickIndex = 0;
let tickKey = null;
let pillSlide = null;
let lastDev = null;

function slideContent(icon, main, dim) {
  return (el) => {
    if (icon) {
      const i = document.createElement('span');
      i.className = 'tick-icon';
      i.innerHTML = PILL_ICONS[icon];
      el.append(i);
    }
    el.append(main);
    if (dim) {
      const d = document.createElement('span');
      d.className = 'dim';
      d.textContent = ` · ${dim}`;
      el.append(d);
    }
  };
}

// Isi kapsul yang mendesak: tampil terus (tidak berputar), atau null.
function pillOverride() {
  if (voiceState) {
    return { key: 'voice', render: slideContent(null, voiceState === 'listening' ? 'Mendengarkan…' : 'Sebentar, aku pikir dulu…') };
  }
  if (saying) return { key: `say:${saying}`, render: slideContent(null, saying) };
  const session = claudeState.active[0];
  if (session && claudeWaiting()) return { key: 'claude-wait', render: slideContent(null, session.label || 'Menunggu kamu', session.project), typing: false };
  return null;
}

// Slide tersemat (fokus, timer, Claude bekerja): tampil selang-seling dengan slide lain.
function pinnedSlides() {
  const pinned = [];
  if (live.meeting) {
    pinned.push({
      key: 'meeting',
      mood: 'hear',
      render: (el) => {
        const icon = document.createElement('span');
        icon.className = `tick-icon live-mic${live.meeting.muted ? ' muted' : ''}`;
        icon.innerHTML = PILL_ICONS.mic;
        const time = document.createElement('span');
        time.className = 'tabular';
        time.textContent = clock(Date.now() - live.meeting.since);
        const label = document.createElement('span');
        label.className = 'dim';
        label.textContent = ` · ${live.meeting.app}${live.meeting.muted ? ' · mic mati' : ''}`;
        el.append(icon, time, label);
      },
    });
  }
  const dl = live.downloads[0];
  if (dl) {
    pinned.push({
      key: 'download',
      // Ukuran & kecepatan dulu (yang berubah), nama file sesudahnya karena bisa terpotong.
      render: slideContent('download', sizeLabel(dl.bytes), `${dl.speed > 0 ? `${sizeLabel(dl.speed)}/dtk · ` : ''}${live.downloads.length > 1 ? `${live.downloads.length} file` : dl.name}`),
    });
  }
  const timer = quickTimers[0];
  if (timer) {
    pinned.push({
      key: 'timer',
      render: (el) => {
        el.append('⏱ ');
        const time = document.createElement('span');
        time.className = 'tabular';
        time.textContent = clock(timer.endsAt - Date.now());
        const label = document.createElement('span');
        label.className = 'dim';
        label.textContent = ` · ${timer.label}`;
        el.append(time, label);
      },
    });
  }
  if (focusState.phase) {
    pinned.push({
      key: 'focus',
      render: (el) => {
        el.append(`${PHASE[focusState.phase]}${focusState.running ? '' : ' dijeda'} `);
        const time = document.createElement('span');
        time.className = 'tabular';
        time.textContent = clock(focusRemaining());
        el.append(time);
      },
    });
  }
  const session = claudeState.active[0];
  if (session) pinned.push({ key: 'claude', render: slideContent(null, session.label || 'Berpikir', session.project), typing: true });
  return pinned;
}

// Slide yang berputar; hanya yang ada isinya.
function pillSlides() {
  const now = new Date();
  const slides = [
    {
      key: 'clock',
      // Jam jadi fokus (tebal, di depan); tanggal kecil & redup di belakangnya.
      render: (el) => {
        const time = document.createElement('b');
        time.className = 'slide-time';
        time.textContent = timeFormat.format(now).replace('.', ':');
        const date = document.createElement('span');
        date.className = 'dim slide-date';
        date.textContent = clockFormat.format(now);
        el.append(time, date);
      },
    },
  ];
  if (systemNow?.online === false) slides.push({ key: 'offline', mood: 'cry', render: slideContent('offline', 'Internet putus') });
  // Rapat dalam 2 jam ke depan (atau yang sedang berjalan).
  const meeting = nextMeeting(now.getTime());
  if (meeting && meeting.start - now.getTime() < 2 * 3_600_000) {
    slides.push({ key: 'meeting', mood: 'clock', render: slideContent('calendar', meeting.title, eventTime(meeting, now.getTime())) });
  }
  if (media.title) {
    // Lagu diputar dan liriknya tersinkron: kapsul menampilkan baris yang sedang dinyanyikan.
    const line = media.playing ? currentLyric() : '';
    const render = line ? lyricSlide(line) : slideContent('music', media.title, media.artist);
    slides.push({ key: 'music', mood: media.playing ? 'music' : 'listen', eq: media.playing, render });
  }
  if (weatherNow) {
    const look = weatherNow.look ?? {};
    const icon = look.costume === 'umbrella' ? 'rain' : weatherNow.kind === 'clear' ? 'sun' : 'cloud';
    slides.push({ key: 'weather', mood: look.mood, costume: look.costume, render: slideContent(icon, `${weatherNow.temperature}° ${weatherNow.text}`, weatherNow.city) });
  }
  if (nextReminder) slides.push({ key: 'reminder', mood: 'clock', render: slideContent('bell', nextReminder.title, nextReminder.when) });
  const openTodos = todoItems.filter((t) => !t.done);
  if (openTodos.length) slides.push({ key: 'todos', mood: 'focus', render: slideContent('check', `${openTodos.length} tugas`, openTodos[0].text) });
  if (notifs.items.length) {
    const latest = notifs.items[0];
    slides.push({
      key: 'notifs',
      mood: 'surprised',
      render: slideContent('notif', `${notifs.items.length} notif`, `${latest.appName || 'Aplikasi'}: ${latest.title || latest.body || ''}`),
    });
  }
  // Sore/malam: kebiasaan hari ini yang belum dicentang.
  const pendingHabits = habitItems.filter((h) => h.scheduled && !h.done);
  if (pendingHabits.length && now.getHours() >= 16) {
    slides.push({ key: 'habits', mood: 'happy', render: slideContent('flame', `${pendingHabits.length} kebiasaan`, pendingHabits.map((h) => h.name).join(', ')) });
  }
  if (petState && petState.hunger < 25) {
    slides.push({ key: 'hungry', mood: 'hungry', render: slideContent(null, `${profile.buddyName || 'Zeno'} lapar`, 'beri makan yuk') });
  }
  const down = (lastDev?.services ?? []).filter((s) => s.status === 'down');
  if (down.length) slides.push({ key: 'dev', mood: 'surprised', render: slideContent('server', `${down.map((s) => s.name).join(', ')} mati`) });
  if (profile.userName) {
    const firstName = profile.userName.split(/\s+/)[0];
    slides.push({ key: 'greet', mood: 'greet', render: slideContent('wave', `Selamat ${periodNow(now)}, ${firstName}`) });
  }
  return slides;
}

function renderPillText(animate = false) {
  updateCentered();
  const text = $('pill-text');
  const override = pillOverride();
  let slide = override;
  if (!slide && !tickerSettings.enabled) {
    // Putaran dimatikan: tersemat (fokus/Claude) > lagu > jam.
    const slides = pillSlides();
    slide = pinnedSlides()[0] ?? slides.find((s) => s.key === 'music') ?? slides[0];
  }
  if (!slide) {
    const slides = pillSlides();
    const pinned = pinnedSlides();
    // Ada slide tersemat: genap = tersemat, ganjil = slide biasa berikutnya.
    const sequence = pinned.length ? slides.flatMap((s, i) => [pinned[i % pinned.length], s]) : slides;
    if (tickIndex >= sequence.length) tickIndex = 0;
    slide = sequence[tickIndex];
  }

  const changed = slide.key !== tickKey;
  tickKey = slide.key;
  pillSlide = override || ['focus', 'claude', 'timer', 'meeting', 'download'].includes(slide.key) ? null : slide;

  const inner = document.createElement('span');
  inner.className = 'tick';
  slide.render(inner);

  const old = text.querySelector('.tick:not(.leave)');
  if (changed && animate && old) {
    old.classList.add('leave');
    setTimeout(() => old.remove(), 380);
    inner.classList.add('enter');
    text.append(inner);
  } else {
    text.replaceChildren(inner);
  }

  $('eq').hidden = !(slide.eq && !override);
  $('typing').hidden = !override?.typing;
  if (changed) {
    applyCostume();
    renderBuddy();
  }
}

// ---------- Lirik lagu (dicari main.js lewat lib/lyrics.js) ----------

let lyricsNow = { key: null, status: 'none', synced: false, lines: [] };
let lyricIndex = -1;
let pillLyric = null; // baris yang terakhir tampil di kapsul (animasi hanya saat berganti)

// Perkiraan posisi untuk aplikasi yang tidak memberi posisi lagu: dihitung sejak lagu
// terlihat berganti. Lagu yang sudah berjalan saat Zenopod dibuka tidak bisa diperkirakan.
let trackClock = { key: null, start: 0, pausedAt: null, known: false };

const mediaKey = (m) => (m?.title ? `${m.app}|${m.title}|${m.artist}` : null);

function updateTrackClock(prevKey) {
  const key = mediaKey(media);
  const now = Date.now();
  if (key !== trackClock.key) {
    trackClock = { key, start: now, pausedAt: media.playing ? null : now, known: Boolean(prevKey && key) };
  } else if (media.playing && trackClock.pausedAt !== null) {
    trackClock.start += now - trackClock.pausedAt;
    trackClock.pausedAt = null;
  } else if (!media.playing && trackClock.pausedAt === null) {
    trackClock.pausedAt = now;
  }
}

// Posisi lagu sekarang (ms), atau null kalau tidak diketahui.
function trackPosition() {
  if (Number.isFinite(media.position) && Number.isFinite(media.positionAt)) {
    return media.position + (media.playing ? Math.max(0, Date.now() - media.positionAt) : 0);
  }
  if (!trackClock.known || trackClock.key !== mediaKey(media)) return null;
  return (trackClock.pausedAt ?? Date.now()) - trackClock.start;
}

function lyricLineAt(ms) {
  const lines = lyricsNow.lines;
  let found = -1;
  for (let i = 0; i < lines.length && lines[i].t <= ms; i++) found = i;
  return found;
}

const lyricsReady = () => lyricsNow.status === 'ready' && lyricsNow.key === mediaKey(media);

function currentLyric() {
  if (!lyricsReady() || !lyricsNow.synced || lyricIndex < 0) return '';
  return lyricsNow.lines[lyricIndex]?.text ?? '';
}

function lyricSlide(line) {
  return (el) => {
    const text = document.createElement('span');
    text.className = 'lyric-text';
    text.textContent = line;
    slideContent('music', text)(el);
    if (line !== pillLyric) el.classList.add('lyric-in');
    pillLyric = line;
  };
}

function renderLyrics() {
  const box = $('lyrics-lines');
  const ready = lyricsReady();
  const searching = Boolean(media.title) && lyricsNow.status === 'loading' && lyricsNow.key === mediaKey(media);
  $('lyrics-view').hidden = !(ready || searching);
  $('music-report').hidden = ready || searching;
  // Lagu diputar tapi liriknya tidak ada: beri tahu di atas ringkasan.
  const note = media.title ? { missing: 'Lirik lagu ini belum ada', instrumental: 'Lagu instrumental', error: 'Lirik gagal dimuat' }[lyricsNow.status] : null;
  $('music-note').textContent = note ?? '';
  $('lyrics-kicker').textContent = ready && !lyricsNow.synced ? 'Lirik · tidak tersinkron' : 'Lirik';
  box.classList.toggle('synced', ready && lyricsNow.synced);
  const message = {
    loading: 'Mencari lirik…',
    missing: 'Lirik lagu ini belum ada.',
    instrumental: 'Lagu ini instrumental, nikmati saja ♪',
    error: 'Lirik tidak bisa dimuat. Cek internetnya ya.',
  }[lyricsNow.status];
  if (!ready) {
    const li = document.createElement('li');
    li.className = 'lyrics-note';
    li.textContent = message ?? '';
    box.replaceChildren(li);
    box.dataset.key = '';
    return;
  }
  if (box.dataset.key !== lyricsNow.key) {
    box.dataset.key = lyricsNow.key;
    box.scrollTop = 0;
    box.replaceChildren(
      ...lyricsNow.lines.map((line) => {
        const li = document.createElement('li');
        if (lyricsNow.synced) {
          li.title = 'Lompat ke baris ini';
          li.addEventListener('click', () => seekTo(line.t + 50));
        }
        if (line.text) {
          const text = document.createElement('span');
          text.textContent = line.text;
          li.append(text);
        } else {
          li.className = 'gap';
          li.setAttribute('aria-label', 'Jeda musik');
          li.append(...[0, 1, 2].map(() => document.createElement('i')));
        }
        return li;
      }),
    );
  }
  if (!lyricsNow.synced) return;
  // Kedalaman: baris aktif terang, berikutnya cukup jelas, yang lewat/jauh samar & sedikit buram.
  for (const [i, li] of [...box.children].entries()) {
    const d = i - lyricIndex;
    li.classList.toggle('now', d === 0);
    li.classList.toggle('next', d === 1);
    li.classList.toggle('past', d < 0);
    li.classList.toggle('far', Math.abs(d) > 2);
  }
  const active = box.children[Math.max(0, lyricIndex)];
  const top = active ? active.offsetTop - (box.clientHeight - active.offsetHeight) / 2 : 0;
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  tickLyrics();
}

const mmss = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
};

// Tiap 200 ms: isi karaoke baris aktif + bar progres lagu.
function tickLyrics() {
  const ms = trackPosition();
  const duration = media.duration;
  $('lyrics-time').textContent = ms != null && duration ? `${mmss(ms)} / ${mmss(duration)}` : '';
  $('lyrics-progress').style.width = ms != null && duration ? `${Math.min(100, (100 * ms) / duration)}%` : '0%';
  const lines = lyricsNow.lines;
  const li = $('lyrics-lines').children[lyricIndex];
  if (!li || ms == null || !lyricsNow.synced) return;
  const start = lines[lyricIndex]?.t ?? 0;
  const end = lines[lyricIndex + 1]?.t ?? start + 4000;
  li.style.setProperty('--p', `${Math.max(0, Math.min(100, (100 * (ms - start)) / Math.max(1, end - start)))}%`);
}

// Warna dominan sampul album → latar lirik (dihitung sekali per sampul).
const tintCache = new Map();

function applyArtTint(src) {
  const view = $('lyrics-view');
  const card = $('media');
  const set = (tint) => {
    for (const el of [view, card]) tint ? el.style.setProperty('--tint', tint) : el.style.removeProperty('--tint');
    card.classList.toggle('tinted', Boolean(tint));
  };
  if (!src) return set(null);
  if (tintCache.has(src)) return set(tintCache.get(src));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      // Lewati piksel yang hampir hitam/putih/abu-abu supaya warnanya tidak kusam.
      if (max < 40 || min > 225 || max - min < 24) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    const tint = n ? `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})` : null;
    if (tintCache.size > 30) tintCache.clear();
    tintCache.set(src, tint);
    set(tint);
  };
  img.src = src;
}

// Baris lirik berganti: perbarui kapsul (kalau sedang menampilkan lagu) dan halaman Lirik.
setInterval(() => {
  if (!lyricsReady() || !lyricsNow.synced) return;
  const ms = trackPosition();
  const next = ms === null ? -1 : lyricLineAt(ms);
  const showing = open && detail && PAGES[pageIndex].id === 'music';
  if (next === lyricIndex) {
    if (showing) tickLyrics();
    return;
  }
  lyricIndex = next;
  if (tickKey === 'music') renderPillText();
  if (showing) renderLyrics();
}, 200);

window.kapsul.onLyrics((state) => {
  lyricsNow = state ?? { key: null, status: 'none', synced: false, lines: [] };
  lyricIndex = -1;
  renderLyrics();
  renderPillText();
});

window.kapsul.onMedia((state) => {
  const prevKey = mediaKey(media);
  const wasPlaying = media.playing;
  media = state ?? { playing: false, title: null };
  updateTrackClock(prevKey);
  renderMedia();
  renderLyrics();
  // Lagu mulai diputar saat panel tertutup: panel berikutnya langsung di section Musik.
  if (media.playing && !wasPlaying && !open) goToSection('music', { sound: false });
});

setInterval(renderBuddy, 15_000);

// Putar isi kapsul (tidak berputar saat ada yang mendesak atau saat dimatikan).
let tickTimer = null;

function startTicker() {
  clearInterval(tickTimer);
  const ms = Math.max(2, Number(tickerSettings.seconds) || 5) * 1000;
  tickTimer = setInterval(() => {
    if (tickerSettings.enabled && !pillOverride()) tickIndex++;
    renderPillText(tickerSettings.enabled);
  }, ms);
}

startTicker();

makeDraggable($('pill'), { clickToOpen: true });
makeDraggable($('grip'));

renderMedia();
renderMusicReport();
goToPage(pageIndex, { sound: false });
setTimeout(emote, 6000);
window.kapsul.ready();
