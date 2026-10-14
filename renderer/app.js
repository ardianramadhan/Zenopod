'use strict';

const $ = (id) => document.getElementById(id);
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

window.kapsul.onExpanded((value) => {
  open = value;
  shell.classList.toggle('open', value);
  // Panel dibuka tak lama setelah notifikasi tampil = langsung ke tab Notifikasi.
  if (value && lastPeek.kind === 'notification' && Date.now() - lastPeek.at < 4000) selectTab('notifs');
  if (!value) {
    hoveringBig = false;
    if (!$('power-sheet').hidden) closePower();
    $('quick-sheet').hidden = true;
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
    if (!$('quick-sheet').hidden) {
      $('quick-sheet').hidden = true;
      return;
    }
    if (event.target === $('app-search') && $('app-search').value) {
      $('app-search').value = '';
      renderSearch();
      return;
    }
    window.kapsul.expand(false);
    return;
  }
  if (!open || event.target instanceof HTMLInputElement) return;
  // Panel terbuka + ketik huruf = langsung cari aplikasi.
  if (/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey && $('power-sheet').hidden) {
    selectTab('apps');
    $('app-search').focus();
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

function say(lines) {
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
  }, 1900);
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
  if (media.playing && Math.random() < 0.3) return { mood: 'music', sound: 'note', anim: 'jump', say: ['♪ Asik!', 'Lagunya enak!'] };
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

function renderApps(apps) {
  appsEl.replaceChildren();
  if (apps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Belum ada aplikasi. Klik "Pengaturan".';
    appsEl.append(empty);
    return;
  }

  for (const item of apps) {
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

for (const button of document.querySelectorAll('[data-position]')) {
  button.addEventListener('click', () => window.kapsul.setPosition(button.dataset.position));
}

window.kapsul.onState((state) => {
  document.body.dataset.align = state.align;
  document.body.dataset.valign = state.valign ?? 'top';
  if (state.sound) soundSettings = state.sound;
  chatReady = Boolean(state.chatReady);
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
  $('buddy-big').title = state.buddyName ? `Halo, aku ${state.buddyName}!` : 'Halo!';
  for (const button of document.querySelectorAll('[data-position]')) {
    button.setAttribute('aria-pressed', String(button.dataset.position === state.position));
  }
  renderShortcut(state.shortcut);
  renderApps(state.apps);
  launcherApps = state.apps;
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

let currentTab = 'apps';
const TAB_PANELS = { apps: 'apps-tab', notifs: 'notifs', focus: 'focus-tab', clips: 'clips', todos: 'todos', dev: 'dev' };

function selectTab(tab) {
  currentTab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  for (const [name, id] of Object.entries(TAB_PANELS)) $(id).hidden = name !== tab;
  renderTabAction();
}

for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
}

// Tombol kanan di baris tab: berubah sesuai tab yang dibuka.
function renderTabAction() {
  const button = $('tab-action');
  const action = {
    notifs: notifs.items.length ? 'Hapus semua' : null,
    clips: clipItems.length ? 'Hapus semua' : null,
    todos: todoItems.some((t) => t.done) ? 'Hapus yang selesai' : null,
    dev: 'Periksa sekarang',
  }[currentTab];
  button.hidden = !action;
  button.textContent = action ?? '';
}

$('tab-action').addEventListener('click', () => {
  if (currentTab === 'notifs') window.kapsul.clearNotifications();
  if (currentTab === 'clips') window.kapsul.clip('clear');
  if (currentTab === 'todos') window.kapsul.todo('clear-done');
  if (currentTab === 'dev') window.kapsul.devRefresh();
});

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

function renderNotifications() {
  const list = $('notifs');
  list.replaceChildren();
  const count = notifs.items.length;

  $('badge').hidden = count === 0;
  $('badge').textContent = count > 9 ? '9+' : String(count);
  $('notif-count').hidden = count === 0;
  $('notif-count').textContent = String(count);
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
  if (claudeState.active.length && !wasActive) goToPage(PAGES.findIndex((p) => p.id === 'claude'), { sound: false });
  else goToPage(pageIndex, { sound: false });
});

const elapsed = (since) => {
  const minutes = Math.floor((Date.now() - since) / 60000);
  return minutes < 1 ? 'baru mulai' : `${minutes} mnt`;
};

// Halaman Claude di carousel (hanya ada saat Claude bekerja/menunggu).
function renderClaudeCard() {
  const session = claudeState.active[0];
  if (!session) return;
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
  for (const item of activity.slice(-2)) {
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

function focusButton(label, action, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'peek-btn primary' : 'peek-btn';
  button.textContent = label;
  button.addEventListener('click', () => window.kapsul.focus(action));
  return button;
}

function renderFocus() {
  const { phase, running, cycle, done } = focusState;
  const tab = $('focus-tab');
  const total = phaseLength(phase ?? 'focus');
  const remaining = phase ? focusRemaining() : total;
  // Belum dimulai sama sekali = menunggu tombol Mulai (beda dengan dijeda di tengah).
  const waiting = Boolean(phase) && !running && remaining >= total - 1000;

  tab.classList.toggle('rest', phase === 'break' || phase === 'long');
  tab.classList.toggle('paused', Boolean(phase) && !running);
  $('focus-time').textContent = clock(remaining);
  $('ring-bar').style.strokeDashoffset = String(276.46 * (1 - Math.min(1, remaining / total)));

  $('focus-phase').textContent = !phase
    ? 'Siap fokus?'
    : running
      ? PHASE[phase]
      : waiting
        ? phase === 'focus'
          ? 'Siap fokus lagi?'
          : `${PHASE[phase]} menunggu`
        : `${PHASE[phase]} dijeda`;

  const sub = !phase
    ? `${focusSettings.focusMinutes} menit fokus, notifikasi ditahan dulu.`
    : phase === 'focus'
      ? `Sesi ${cycle} dari ${focusSettings.cycles}`
      : 'Regangkan badan dan minum air.';
  $('focus-sub').textContent = done ? `${sub} · ${done} fokus selesai` : sub;

  const dots = $('focus-dots');
  dots.replaceChildren();
  for (let i = 1; i <= focusSettings.cycles; i++) {
    const dot = document.createElement('i');
    if (i < cycle || (i === cycle && phase && phase !== 'focus')) dot.className = 'done';
    else if (i === cycle && phase === 'focus') dot.className = 'now';
    dots.append(dot);
  }

  const actions = $('focus-actions');
  actions.replaceChildren();
  if (!phase) {
    actions.append(focusButton(`Mulai fokus ${focusSettings.focusMinutes} mnt`, 'focus', true));
  } else if (running) {
    actions.append(focusButton('Jeda', 'pause'), focusButton('Lewati', 'skip'), focusButton('Berhenti', 'stop'));
  } else {
    actions.append(focusButton(waiting ? 'Mulai' : 'Lanjut', 'start', true), focusButton('Berhenti', 'stop'));
  }

  const count = $('focus-count');
  count.hidden = !phase;
  count.textContent = phase ? clock(remaining) : '';
}

window.kapsul.onFocus((state) => {
  focusState = state;
  renderFocus();
  renderMedia();
});

setInterval(() => {
  if (!focusState.phase || !focusState.running) return;
  renderFocus();
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
  if (PAGES[pageIndex].id === 'today') renderPage();
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

// ---------- Kartu atas: halaman yang bisa di-swipe ----------

const PAGES = [
  { id: 'claude', label: 'Claude Code', sound: 'tick' },
  { id: 'music', label: 'Musik', sound: 'note' },
  { id: 'greeting', label: 'Sapaan', sound: 'hello' },
  { id: 'clock', label: 'Tanggal & jam', sound: 'ticktock' },
  { id: 'agenda', label: 'Agenda', sound: 'today' },
  { id: 'weather', label: 'Cuaca', sound: 'today' },
  { id: 'today', label: 'Hari ini', sound: 'today' },
  { id: 'habits', label: 'Kebiasaan', sound: 'tick' },
  { id: 'pet', label: 'Zeno', sound: 'pop' },
  { id: 'system', label: 'Sistem', sound: 'tick' },
];

// Halaman Cuaca hanya ada kalau cuaca aktif; halaman Claude hanya saat Claude bekerja;
// Agenda kalau kalender tersambung; Kebiasaan kalau sudah ada kebiasaan.
function pageAvailable(page) {
  if (page.id === 'weather') return Boolean(weatherNow);
  if (page.id === 'claude') return claudeState.active.length > 0;
  if (page.id === 'agenda') return calendarEvents !== null;
  if (page.id === 'habits') return habitItems.length > 0;
  return true;
}

let pageIndex = 0;
try {
  pageIndex = Math.max(0, PAGES.findIndex((p) => p.id === localStorage.getItem('kapsul.page')));
} catch {
  // tanpa penyimpanan
}

// Wujud Zeno per halaman.
function pageMood() {
  const page = PAGES[pageIndex].id;
  if (page === 'claude') return claudeWaiting() ? 'surprised' : 'think';
  if (page === 'music') return media.playing ? 'music' : 'listen';
  if (page === 'greeting') return 'greet';
  if (page === 'clock') return 'clock';
  if (page === 'weather') return weatherNow?.look?.mood ?? 'idle';
  if (page === 'pet') return (petState?.hunger ?? 100) < 25 ? 'hungry' : 'happy';
  if (page === 'agenda') return 'clock';
  if (page === 'habits') return habitItems.length && habitItems.every((h) => h.done || !h.scheduled) ? 'laugh' : 'happy';
  if (page === 'system') return systemNow?.online === false ? 'cry' : 'focus';
  return 'focus';
}

function goToPage(index, { sound = true } = {}) {
  let next = (index + PAGES.length) % PAGES.length;
  const step = index < pageIndex ? -1 : 1;
  for (let i = 0; i < PAGES.length && !pageAvailable(PAGES[next]); i++) next = (next + step + PAGES.length) % PAGES.length;
  const changed = next !== pageIndex;
  pageIndex = next;
  try {
    localStorage.setItem('kapsul.page', PAGES[next].id);
  } catch {
    // tanpa penyimpanan
  }
  $('hero-track').style.transform = `translateX(${-next * 100}%)`;
  for (const [i, dot] of [...$('hero-dots').children].entries()) {
    dot.setAttribute('aria-selected', String(i === next));
    dot.hidden = !pageAvailable(PAGES[i]);
  }
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

for (const [i, page] of PAGES.entries()) {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.setAttribute('role', 'tab');
  dot.setAttribute('aria-label', page.label);
  dot.title = page.label;
  dot.addEventListener('click', () => goToPage(i));
  $('hero-dots').append(dot);
}

// Seret dengan mouse: ikuti jari/kursor, lepas > 40px = pindah halaman.
(() => {
  const view = $('hero-view');
  const track = $('hero-track');
  let startX = null;
  let dx = 0;
  view.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    startX = event.clientX;
    dx = 0;
    view.setPointerCapture(event.pointerId);
    view.classList.add('dragging');
  });
  view.addEventListener('pointermove', (event) => {
    if (startX === null) return;
    dx = event.clientX - startX;
    const width = view.clientWidth || 1;
    track.style.transform = `translateX(calc(${-pageIndex * 100}% + ${dx}px))`;
    if (Math.abs(dx) > width) dx = Math.sign(dx) * width;
  });
  const release = () => {
    if (startX === null) return;
    startX = null;
    view.classList.remove('dragging');
    if (dx < -40) goToPage(pageIndex + 1);
    else if (dx > 40) goToPage(pageIndex - 1);
    else goToPage(pageIndex, { sound: false });
  };
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);

  // Scroll horizontal (touchpad) atau Shift+scroll.
  let wheelLock = 0;
  view.addEventListener(
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

const ICON = {
  bell: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.2" /><path d="M8 6.4V9l1.8 1.2" /></svg>',
  check: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="3" /><path d="M5.3 8.2l1.9 1.9 3.6-4" /></svg>',
  target: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" /></svg>',
  cloud: '<svg viewBox="0 0 16 16"><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .2-5.6 4 4 0 0 0-7.7 1A2.3 2.3 0 0 0 4.5 12.5z" /></svg>',
  calendar: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>',
};

function todayRow(icon, text) {
  const li = document.createElement('li');
  li.innerHTML = ICON[icon];
  const span = document.createElement('span');
  span.textContent = text;
  li.append(span);
  return li;
}

function renderPage() {
  const page = PAGES[pageIndex].id;
  const now = new Date();

  if (page === 'greeting') {
    const period = periodNow(now);
    const firstName = (profile.userName || '').split(/\s+/)[0];
    $('greet-kicker').textContent = profile.buddyName ? `${profile.buddyName} menyapa` : 'Halo';
    $('greet-title').textContent = `Selamat ${period}${firstName ? `, ${firstName}` : ''}!`;
    const lines = GREET_LINES[period];
    $('greet-sub').textContent = lines[now.getDate() % lines.length];
  } else if (page === 'clock') {
    const time = $('clock-time');
    time.replaceChildren(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    const sec = document.createElement('span');
    sec.className = 'sec';
    sec.textContent = `:${pad2(now.getSeconds())}`;
    time.append(sec);
    $('clock-date').textContent = LONG_DATE.format(now);
    $('clock-hijri').textContent = HIJRI ? HIJRI.format(now) : '';
  } else if (page === 'weather' && weatherNow) {
    const w = weatherNow;
    $('weather-city').textContent = `Cuaca · ${w.city}`;
    $('weather-temp').textContent = `${w.temperature}°`;
    $('weather-cond').textContent = w.text;
    $('weather-feels').textContent = [w.feels != null ? `Terasa ${w.feels}°` : '', w.humidity != null ? `Lembap ${w.humidity}%` : '']
      .filter(Boolean)
      .join(' · ');
    const next = $('weather-next');
    next.replaceChildren();
    for (const hour of w.next ?? []) {
      const span = document.createElement('span');
      const time = document.createElement('b');
      time.textContent = `${hour.hour}.00`;
      span.append(time, ` ${hour.temperature}°`);
      if (hour.rain != null && hour.rain >= 30) {
        const rain = document.createElement('span');
        rain.className = 'wet';
        rain.textContent = ` ☂ ${hour.rain}%`;
        span.append(rain);
      }
      next.append(span);
    }
  } else if (page === 'today') {
    const list = $('today-list');
    list.replaceChildren();
    const open = todoItems.filter((t) => !t.done);
    if (weatherNow) list.append(todayRow('cloud', weatherText()));
    list.append(todayRow('bell', nextReminder ? `${nextReminder.title} · ${nextReminder.when}` : 'Tidak ada pengingat'));
    const meeting = nextMeeting();
    if (meeting) list.append(todayRow('calendar', `${meeting.title} · ${eventTime(meeting)}`));
    list.append(todayRow('check', open.length ? `${open.length} tugas: ${open[0].text}` : 'Semua tugas beres'));
    const t = statsToday ?? {};
    const minutes = Math.round((t.claudeMs ?? 0) / 60_000);
    const claudeText = minutes >= 60 ? `${Math.floor(minutes / 60)} j ${minutes % 60} m` : `${minutes} m`;
    list.append(todayRow('target', `${t.focus ?? 0} fokus · ${t.todos ?? 0} tugas selesai${minutes ? ` · Claude ${claudeText}` : ''}`));
  } else if (page === 'agenda') {
    renderAgenda();
  } else if (page === 'habits') {
    renderHabits();
  } else if (page === 'system') {
    renderSystem();
  }
}

setInterval(() => {
  if (open && !$('media').hidden && PAGES[pageIndex].id === 'clock') renderPage();
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

function weatherText() {
  return weatherNow ? `${weatherNow.temperature}° ${weatherNow.text} · ${weatherNow.city}` : '';
}

let battery = null;

const lowBattery = () => Boolean(battery && !battery.charging && battery.level <= 0.2);

function renderBattery() {
  const badge = $('pill-battery');
  badge.hidden = !lowBattery();
  if (battery) badge.textContent = `${Math.round(battery.level * 100)}%`;
  renderBuddy();
}

// Battery Status API: laptop saja; di PC tanpa baterai level selalu 100% & charging.
(async () => {
  try {
    const b = await navigator.getBattery();
    const update = () => {
      const wasCharging = battery?.charging;
      battery = { level: b.level, charging: b.charging };
      // Charger dicolok saat baterai < 90%: Zeno senang.
      if (wasCharging === false && b.charging && b.level < 0.9) {
        react('happy', 1500);
        sfx('charge');
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

async function startListening() {
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
      await window.kapsul.sendAudio(encodeWav(samples, 16000));
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
      selectTab('focus');
    } });
  }
  // Pertanyaan ("…?", "tanya …") atau tidak ada aplikasi yang cocok: tawarkan tanya Zeno.
  const looksLikeQuestion = /\?$|^(tanya|apa|siapa|kenapa|mengapa|bagaimana|gimana|kapan|dimana|di mana|berapa)\b/.test(query);
  if (chatReady && query.length > 2 && !quick && (looksLikeQuestion || !searchMatches.length)) {
    const question = $('app-search').value.trim().replace(/^tanya\s+/i, '');
    searchMatches.push({ name: `Tanya ${profile.buddyName || 'Zeno'}: “${question}”`, ask: true, tag: 'Claude', open: () => askFromSearch(question) });
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
  $('quick-sheet').hidden = true;
  if ($('power-sheet').hidden) openPower();
  else closePower();
});
$('power-cancel').addEventListener('click', closePower);

// ---------- Statistik & Zeno peliharaan ----------

let statsToday = null;
let petState = null;

window.kapsul.onStats((data) => {
  statsToday = data?.today ?? null;
  petState = data?.pet ?? null;
  if (PAGES[pageIndex].id === 'today') renderPage();
  if (typeof renderPet === 'function') renderPet();
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
  const events = (calendarEvents ?? []).filter((e) => e.end > now).slice(0, 3);
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
  goToPage(pageIndex, { sound: false });
  renderPillText();
});

setInterval(() => {
  if (open && PAGES[pageIndex].id === 'agenda') renderAgenda();
}, 30_000);

// ---------- Kebiasaan ----------

function renderHabits() {
  const chips = $('habit-chips');
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
  goToPage(pageIndex, { sound: false });
  renderPillText();
});

// ---------- Sistem & internet ----------

function bar(id, percent, text, warn) {
  $(id).style.width = `${percent ?? 0}%`;
  $(id).classList.toggle('low', Boolean(warn));
  $(`${id}-text`).textContent = text;
}

function renderSystem() {
  const s = systemNow;
  if (!s) return;
  const net = $('system-net');
  net.className = `system-net ${s.online === false ? 'off' : s.online ? 'on' : ''}`;
  net.textContent = s.online == null ? 'Mengecek internet…' : s.online ? `Internet tersambung${s.ms ? ` · ${s.ms} ms` : ''}` : 'Internet putus';
  bar('system-cpu', s.cpu, s.cpu != null ? `${s.cpu}%` : '–', s.cpu >= 90);
  bar('system-ram', s.memory?.percent, s.memory ? `${s.memory.percent}%` : '–', s.memory?.percent >= 90);
  const diskFree = s.disk ? 100 - s.disk.percent : null;
  $('system-disk-label').textContent = s.disk ? `Disk ${s.disk.drive}` : 'Disk';
  bar('system-disk', s.disk?.percent, s.disk ? `sisa ${bytesText(s.disk.free)}` : '–', diskFree != null && diskFree < 10);
}

function bytesText(n) {
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1).replace('.', ',')} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

window.kapsul.onSystem((state) => {
  const was = systemNow?.online;
  systemNow = state;
  if (PAGES[pageIndex].id === 'system') renderPage();
  if (was !== state?.online) renderPillText();
});

$('snip-btn').addEventListener('click', () => window.kapsul.snip());

// ---------- Timer cepat ----------

let quickTimers = [];

function renderTimers() {
  const list = $('timer-list');
  list.replaceChildren();
  for (const t of quickTimers) {
    const row = document.createElement('div');
    row.className = 'timer-row';
    const time = document.createElement('b');
    time.textContent = clock(t.endsAt - Date.now());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'notif-x';
    close.title = 'Batalkan timer';
    close.setAttribute('aria-label', `Batalkan ${t.label}`);
    close.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>';
    close.addEventListener('click', () => window.kapsul.timer('cancel', { id: t.id }));
    row.append('⏱ ', time, ` · ${t.label}`, close);
    list.append(row);
  }
}

window.kapsul.onTimers((list) => {
  quickTimers = list ?? [];
  renderTimers();
  renderPillText();
});

setInterval(() => {
  if (!quickTimers.length) return;
  renderTimers();
  if (tickKey === 'timer') renderPillText();
}, 1000);

// ---------- Zeno peliharaan ----------

function renderPet() {
  if (!petState) return;
  const hunger = Math.round(petState.hunger);
  $('pet-level').textContent = `${profile.buddyName || 'Zeno'} · Level ${petState.level}`;
  $('pet-xp').textContent = `${Math.floor(petState.xp)}/${petState.needed} XP`;
  $('pet-hunger').style.width = `${hunger}%`;
  $('pet-hunger').classList.toggle('low', hunger < 25);
  $('pet-xpbar').style.width = `${Math.min(100, (petState.xp / petState.needed) * 100)}%`;
  if (PAGES[pageIndex].id === 'pet') renderBuddy();
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
    button.setAttribute('aria-pressed', String(quick[what] === 'On'));
  }
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
for (const what of ['wifi', 'bluetooth']) {
  $(`quick-${what}`).addEventListener('click', () => {
    const on = $(`quick-${what}`).getAttribute('aria-pressed') === 'true';
    window.kapsul.quickSet(what, on ? 'off' : 'on');
  });
}

$('quick-btn').addEventListener('click', () => {
  if (!$('power-sheet').hidden) closePower();
  $('quick-sheet').hidden = !$('quick-sheet').hidden;
  renderQuick();
});

// ---------- Pengingat berikutnya (footer panel) ----------

window.kapsul.onReminders((next) => {
  nextReminder = next;
  if (PAGES[pageIndex].id === 'today') renderPage();
  $('next-reminder').hidden = !next;
  $('shortcut').hidden = Boolean(next);
  if (next) $('next-reminder-text').textContent = `${next.title} · ${next.when}`;
});

setInterval(() => {
  if (!$('notifs').hidden) renderNotifications();
}, 60_000);

// ---------- Musik ----------

for (const button of document.querySelectorAll('[data-cmd]')) {
  button.addEventListener('click', () => window.kapsul.media(button.dataset.cmd));
}

$('edit').addEventListener('click', () => window.kapsul.openSettings());

function renderMedia() {
  const hasTrack = Boolean(media.title);

  $('media').classList.toggle('idle', !hasTrack);
  $('title').textContent = hasTrack ? media.title : 'Tidak ada yang diputar';
  $('artist').textContent = hasTrack ? media.artist || '' : 'Putar lagu di Spotify atau Chrome';
  $('icon-play').toggleAttribute('hidden', media.playing);
  $('icon-pause').toggleAttribute('hidden', !media.playing);

  const artImg = $('art-img');
  if (hasTrack && media.art) artImg.src = media.art;
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
      render: (el) => {
        const date = document.createElement('span');
        date.className = 'dim';
        date.textContent = `${clockFormat.format(now)}  `;
        el.append(date, timeFormat.format(now).replace('.', ':'));
      },
    },
  ];
  if (systemNow?.online === false) slides.push({ key: 'offline', mood: 'cry', render: slideContent('offline', 'Internet putus') });
  // Rapat dalam 2 jam ke depan (atau yang sedang berjalan).
  const meeting = nextMeeting(now.getTime());
  if (meeting && meeting.start - now.getTime() < 2 * 3_600_000) {
    slides.push({ key: 'meeting', mood: 'clock', render: slideContent('calendar', meeting.title, eventTime(meeting, now.getTime())) });
  }
  if (media.title) slides.push({ key: 'music', mood: media.playing ? 'music' : 'listen', eq: media.playing, render: slideContent('music', media.title, media.artist) });
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
  pillSlide = override || ['focus', 'claude', 'timer'].includes(slide.key) ? null : slide;

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

window.kapsul.onMedia((state) => {
  media = state ?? { playing: false, title: null };
  renderMedia();
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
goToPage(pageIndex, { sound: false });
setTimeout(emote, 6000);
window.kapsul.ready();
