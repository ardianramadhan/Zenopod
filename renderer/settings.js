'use strict';

const $ = (id) => document.getElementById(id);
const api = window.settings;

let state = null;
let section = 'profile';

const ICONS = {
  up: '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4" /></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></svg>',
  remove: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>',
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconBox(icon, name, color) {
  const box = el('span', 'item-icon');
  if (icon) {
    const img = el('img');
    img.src = icon;
    img.alt = '';
    box.append(img);
  } else {
    box.textContent = (name || '?').slice(0, 1).toUpperCase();
    box.style.background = color || 'var(--surface-hover)';
  }
  return box;
}

function iconButton(kind, label, onClick, disabled = false) {
  const button = el('button', 'icon-btn');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = ICONS[kind];
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

// ---------- Simpan ----------

let savedTimer = null;

async function save(patch) {
  state = await api.save(patch);
  renderIdentity();
  const saved = $('saved');
  saved.textContent = 'Tersimpan';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.textContent = ''), 1600);
  return state;
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Maskot di sidebar & perkenalan ----------

const sideBuddy = window.createBuddy();
const introBuddy = window.createBuddy();
$('side-buddy').append(sideBuddy.el);
$('intro-buddy').append(introBuddy.el);
sideBuddy.setMood('happy');

// Mata maskot mengikuti kursor di dalam jendela ini.
document.addEventListener('mousemove', (event) => {
  for (const buddy of [sideBuddy, introBuddy]) {
    const rect = buddy.el.getBoundingClientRect();
    if (!rect.width) continue;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, distance / 160);
    buddy.look((dx / distance) * reach, (dy / distance) * reach);
  }
});

sideBuddy.el.addEventListener('click', () => {
  sideBuddy.setMood('laugh');
  sideBuddy.jump();
  setTimeout(() => sideBuddy.setMood('happy'), 1500);
});

function renderIdentity() {
  $('side-name').textContent = state.config.buddy.name || 'Zenopod';
  sideBuddy.setCostume(state.costumeNow?.costume ?? null);
}

// ---------- Navigasi ----------

function show(next) {
  section = next;
  for (const button of document.querySelectorAll('[data-section]')) {
    if (button.dataset.section === next) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== next;
  render();
}

for (const button of document.querySelectorAll('[data-section]')) {
  button.addEventListener('click', () => show(button.dataset.section));
}

// Cari pengaturan: menyaring menu berdasarkan nama dan kata kunci; Enter membuka hasil pertama.
function filterNav() {
  const query = $('nav-search').value.trim().toLowerCase();
  let shown = 0;
  for (const button of document.querySelectorAll('#nav [data-section]')) {
    const text = `${button.textContent} ${button.dataset.keywords ?? ''}`.toLowerCase();
    button.hidden = Boolean(query) && !query.split(/\s+/).every((word) => text.includes(word));
    if (!button.hidden) shown++;
  }
  // Judul grup ikut hilang kalau semua menunya tersaring.
  for (const group of document.querySelectorAll('#nav .nav-group')) {
    let next = group.nextElementSibling;
    let any = false;
    while (next && !next.classList.contains('nav-group')) {
      if (next.dataset.section && !next.hidden) any = true;
      next = next.nextElementSibling;
    }
    group.hidden = !any;
  }
  $('nav-empty').hidden = shown > 0;
}

$('nav-search').addEventListener('input', filterNav);
$('nav-search').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $('nav-search').value = '';
    filterNav();
  }
  if (event.key !== 'Enter') return;
  const first = [...document.querySelectorAll('#nav [data-section]')].find((b) => !b.hidden);
  if (first) show(first.dataset.section);
});

for (const button of document.querySelectorAll('[data-goto]')) {
  button.addEventListener('click', () => show(button.dataset.goto));
}

// ---------- Panduan ----------

const GUIDE = [
  { title: 'Klik kepala', how: 'Dielus, Zeno mendengkur senang.', mood: 'purr', anim: 'pat', sound: 'pat' },
  { title: 'Klik pipi', how: 'Dicolek, memantul “boing!”.', mood: 'surprised', anim: 'boing', sound: 'boing' },
  { title: 'Klik tengah', how: 'Boop hidungnya.', mood: 'boop', sound: 'boop' },
  { title: 'Klik bawah', how: 'Digelitik sampai tertawa.', mood: 'tickle', sound: 'giggle' },
  { title: 'Klik dua kali', how: 'Salto! (Zeno besar di panel)', mood: 'starstruck', anim: 'spin', sound: 'sparkle' },
  { title: 'Tahan', how: 'Dipencet sampai gepeng, lalu memantul.', mood: 'squish', hold: true, sound: 'boop' },
  { title: 'Elus', how: 'Gerakkan kursor bolak-balik di atas Zeno besar.', mood: 'purr', anim: 'pat', sound: 'purr' },
  { title: 'Klik terus-terusan', how: 'Makin kesal, pusing, lalu ngambek.', steps: ['confused', 'pout', 'angry', 'cry', 'dizzy', 'sulk'], sound: 'grumble' },
  { title: 'Bangunkan', how: 'Klik saat Zeno tidur: menguap.', mood: 'yawn', sound: 'yawn' },
];

function guideSound(name) {
  const s = state.config.sound;
  if (s.enabled && s.buddy !== false) window.KapsulSound.play(name, s.volume || 0.6);
}

function tryGuide(item, buddy) {
  clearTimeout(buddy.timer);
  if (item.steps) {
    item.steps.forEach((mood, i) => {
      setTimeout(() => {
        buddy.setMood(mood);
        if (mood === 'dizzy') buddy.play('spin');
      }, i * 650);
    });
    guideSound(item.sound);
    buddy.timer = setTimeout(() => buddy.setMood('happy'), item.steps.length * 650 + 1200);
    return;
  }
  buddy.setMood(item.mood);
  if (item.hold) {
    buddy.hold(true);
    setTimeout(() => {
      buddy.hold(false);
      buddy.jump();
      buddy.setMood('love');
    }, 900);
  } else if (item.anim) {
    buddy.play(item.anim);
  }
  guideSound(item.sound);
  buddy.timer = setTimeout(() => buddy.setMood('happy'), 2000);
}

let guideBuilt = false;

function renderGuide() {
  $('guide-shortcut').textContent = state.config.shortcut.replace('Control', 'Ctrl');
  $('guide-voice').textContent = state.config.voice.shortcut.replace('Control', 'Ctrl');
  if (guideBuilt) return;
  guideBuilt = true;
  const grid = $('guide-interactions');
  for (const item of GUIDE) {
    const card = el('div', 'guide-card');
    const buddy = window.createBuddy();
    buddy.setMood('happy');
    const stage = el('button', 'guide-buddy');
    stage.type = 'button';
    stage.title = 'Coba';
    stage.setAttribute('aria-label', `Coba: ${item.title}`);
    stage.append(buddy.el);
    const text = el('div', 'guide-text');
    text.append(el('div', 'item-title', item.title), el('div', 'item-sub', item.how));
    const button = el('button', 'btn small', 'Coba');
    button.type = 'button';
    const run = () => tryGuide(item, buddy);
    stage.addEventListener('click', run);
    button.addEventListener('click', run);
    card.append(stage, text, button);
    grid.append(card);
  }
}

// Penyesuaian per sistem: label & bagian yang tidak ada di macOS.
let platformApplied = false;
function applyPlatform() {
  if (platformApplied || !state) return;
  platformApplied = true;
  const mac = state.platform === 'darwin';
  document.body.dataset.platform = state.platform;
  if (!mac) return;
  for (const el of document.querySelectorAll('[data-win-only]')) el.hidden = true;
  for (const el of document.querySelectorAll('[data-mac-text]')) el.textContent = el.dataset.macText;
  for (const el of document.querySelectorAll('[data-mac-only]')) el.hidden = false;
}

function render() {
  applyPlatform();
  renderIdentity();
  if (section === 'guide') renderGuide();
  if (section === 'profile') renderProfile();
  if (section === 'apps') renderLauncher();
  if (section === 'notifications') renderNotifications();
  if (section === 'reminders') renderReminders();
  if (section === 'claude') renderClaude();
  if (section === 'focus') renderFocus();
  if (section === 'dev') renderDevSettings();
  if (section === 'sound') renderSound();
  if (section === 'weather') renderWeather();
  if (section === 'voice') renderVoice();
  if (section === 'stats') renderStats();
  if (section === 'chat') renderChat();
  if (section === 'display') renderDisplay();
  if (section === 'calendar') renderCalendar();
  if (section === 'habits') renderHabitSettings();
  if (section === 'system') {
    renderSystemSettings();
    renderLive();
  }
}

// ---------- Perkenalan ----------

function startIntro() {
  let step = 0;
  let userName = '';
  const bubble = $('intro-bubble');
  const input = $('intro-input');
  const next = $('intro-next');
  $('intro').hidden = false;
  $('layout').hidden = true;

  const steps = [
    () => {
      introBuddy.setMood('happy');
      bubble.textContent = 'Halo! Aku maskot barumu. Boleh kenalan? Siapa namamu?';
      input.placeholder = 'Namamu';
      next.textContent = 'Lanjut';
    },
    () => {
      introBuddy.setMood('love');
      bubble.textContent = `Senang kenalan, ${userName}! Sekarang kasih aku nama dong.`;
      input.placeholder = 'mis. Kapsi';
      next.textContent = 'Simpan';
    },
  ];

  const go = (i) => {
    step = i;
    input.value = '';
    $('intro-step').textContent = `Langkah ${i + 1} dari 2`;
    steps[i]();
    input.focus();
  };

  $('intro-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      introBuddy.setMood('confused');
      input.focus();
      return;
    }
    if (step === 0) {
      userName = value;
      go(1);
      return;
    }
    introBuddy.setMood('laugh');
    introBuddy.jump();
    bubble.textContent = `Yeay! Mulai sekarang panggil aku ${value}. Aku akan menyapamu tiap pagi, siang, sore, dan malam.`;
    $('intro-form').hidden = true;
    $('intro-step').textContent = '';
    await save({ user: { name: userName }, buddy: { name: value } });
    setTimeout(() => {
      $('intro').hidden = true;
      $('layout').hidden = false;
      show('guide');
    }, 2200);
  });

  go(0);
}

// ---------- Profil ----------

const saveProfile = debounce(() => {
  save({
    user: { ...state.config.user, name: $('user-name').value.trim(), birthday: $('user-birthday').value },
    buddy: { ...state.config.buddy, name: $('buddy-name').value.trim() },
  });
}, 600);

function renderProfile() {
  if (document.activeElement !== $('user-name')) $('user-name').value = state.config.user.name;
  if (document.activeElement !== $('buddy-name')) $('buddy-name').value = state.config.buddy.name;
  $('user-birthday').value = state.config.user.birthday || '';
  $('greetings').checked = state.config.greetings;
}

$('user-name').addEventListener('input', saveProfile);
$('user-birthday').addEventListener('change', (e) => save({ user: { ...state.config.user, birthday: e.target.value } }));
$('buddy-name').addEventListener('input', saveProfile);
$('greetings').addEventListener('change', (e) => save({ greetings: e.target.checked }));
$('preview-greeting').addEventListener('click', () => api.preview('greeting'));

// ---------- Aplikasi ----------

function appKey(item) {
  return item.aumid ? 'aumid:' + item.aumid : item.target ? 'lnk:' + item.target : 'name:' + item.name;
}

function describe(item) {
  if (item.target && /^https?:/i.test(item.target)) return item.target.replace(/^https?:\/\//, '');
  if (item.aumid || item.appx) return 'Aplikasi Microsoft Store';
  if (item.target && /^[a-z][a-z0-9+.-]+:/i.test(item.target) && !/^[a-z]:/i.test(item.target)) return item.target;
  return 'Aplikasi';
}

function saveApps(list) {
  return save({ apps: list }).then(renderLauncher);
}

function renderLauncher() {
  const list = $('launcher-list');
  list.replaceChildren();
  const apps = state.config.apps;
  if (!apps.length) {
    list.append(el('p', 'empty', 'Belum ada aplikasi. Klik "Tambah aplikasi".'));
    return;
  }
  apps.forEach((item, i) => {
    const row = el('div', 'item');
    const icon = state.launcher[i]?.icon;
    const main = el('div', 'item-main');
    main.append(el('div', 'item-title', item.name), el('div', 'item-sub', describe(item)));
    const move = (to) => {
      const next = [...apps];
      [next[i], next[to]] = [next[to], next[i]];
      saveApps(next);
    };
    row.append(
      el('span', 'tag', i < 9 ? String(i + 1) : '–'),
      iconBox(icon, item.name, item.color),
      main,
      iconButton('up', 'Naikkan', () => move(i - 1), i === 0),
      iconButton('down', 'Turunkan', () => move(i + 1), i === apps.length - 1),
      iconButton('remove', 'Hapus', () => saveApps(apps.filter((_, j) => j !== i))),
    );
    list.append(row);
  });
  if (!$('app-picker').hidden) renderPicker();
}

let installed = null;

async function openPicker() {
  $('app-picker').hidden = false;
  $('site-form').hidden = true;
  $('picker-search').value = '';
  $('picker-search').focus();
  if (!installed) {
    $('picker-list').replaceChildren(el('p', 'empty', 'Memuat daftar aplikasi…'));
    installed = await api.installedApps();
  }
  renderPicker();
}

function renderPicker() {
  if (!installed) return;
  const query = $('picker-search').value.trim().toLowerCase();
  const added = new Set(state.config.apps.map(appKey));
  const list = $('picker-list');
  list.replaceChildren();
  const matches = installed.filter((app) => app.name.toLowerCase().includes(query)).slice(0, 200);
  if (!matches.length) {
    list.append(el('p', 'empty', 'Tidak ada aplikasi yang cocok.'));
    return;
  }
  for (const app of matches) {
    const key = app.aumid ? 'aumid:' + app.aumid : 'lnk:' + app.target;
    const isAdded = added.has(key);
    const row = el('button', 'item');
    row.type = 'button';
    row.setAttribute('aria-pressed', String(isAdded));
    const main = el('div', 'item-main');
    main.append(el('div', 'item-title', app.name));
    row.append(iconBox(app.icon, app.name), main, el('span', 'tag', isAdded ? 'Ditambahkan' : 'Tambah'));
    row.addEventListener('click', () => {
      if (isAdded) {
        saveApps(state.config.apps.filter((item) => appKey(item) !== key));
      } else {
        const item = app.aumid ? { name: app.name, aumid: app.aumid, icon: app.iconPath ?? undefined } : { name: app.name, target: app.target };
        saveApps([...state.config.apps, item]);
      }
    });
    list.append(row);
  }
}

$('add-app').addEventListener('click', openPicker);
$('picker-close').addEventListener('click', () => ($('app-picker').hidden = true));
$('picker-search').addEventListener('input', renderPicker);
$('add-site').addEventListener('click', () => {
  $('site-form').hidden = false;
  $('app-picker').hidden = true;
  $('site-name').focus();
});
$('site-cancel').addEventListener('click', () => ($('site-form').hidden = true));
$('site-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('site-name').value.trim();
  const url = $('site-url').value.trim();
  if (!name || !/^https?:\/\//i.test(url)) return;
  saveApps([...state.config.apps, { name, target: url }]);
  $('site-form').reset();
  $('site-form').hidden = true;
});

// ---------- Notifikasi ----------

function renderNotifications() {
  const n = state.config.notifications;
  $('notif-peek').checked = n.peek;
  $('clipboard-enabled').checked = state.config.clipboard.enabled;
  $('notif-seconds').value = String(n.peekSeconds);

  const list = $('notif-apps');
  list.replaceChildren();
  const seen = n.seen ?? [];
  if (!seen.length) {
    list.append(el('p', 'empty', 'Belum ada aplikasi yang mengirim notifikasi. Aplikasi akan muncul di sini setelah notifikasi pertamanya masuk.'));
    return;
  }
  const ignore = new Set((n.ignore ?? []).map((name) => name.toLowerCase()));
  for (const app of [...seen].sort((a, b) => a.name.localeCompare(b.name, 'id'))) {
    const row = el('label', 'item');
    const main = el('div', 'item-main');
    const allowed = !ignore.has(app.name.toLowerCase());
    main.append(el('div', 'item-title', app.name), el('div', 'item-sub', allowed ? 'Masuk ke Zenopod' : 'Disembunyikan'));
    const toggle = el('span', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = allowed;
    input.setAttribute('aria-label', `Tampilkan notifikasi ${app.name}`);
    input.addEventListener('change', () => {
      const rest = (n.ignore ?? []).filter((name) => name.toLowerCase() !== app.name.toLowerCase());
      save({ notifications: { ...n, ignore: input.checked ? rest : [...rest, app.name] } }).then(renderNotifications);
    });
    toggle.append(input, el('span'));
    row.append(iconBox(state.notificationIcons?.[app.name], app.name), main, toggle);
    list.append(row);
  }
}

$('clipboard-enabled').addEventListener('change', (e) =>
  save({ clipboard: { ...state.config.clipboard, enabled: e.target.checked } }),
);
$('notif-peek').addEventListener('change', (e) => save({ notifications: { ...state.config.notifications, peek: e.target.checked } }));
$('notif-seconds').addEventListener('change', (e) =>
  save({ notifications: { ...state.config.notifications, peekSeconds: Number(e.target.value) } }),
);

// ---------- Pengingat ----------

const REPEAT = { none: 'Sekali', daily: 'Setiap hari', weekdays: 'Hari kerja' };
const pad = (n) => String(n).padStart(2, '0');

function whenText(ms) {
  const date = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}`;
  if (date.toDateString() === today.toDateString()) return `Hari ini ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Besok ${time}`;
  return `${date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

function resetReminderForm() {
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60_000);
  $('reminder-form').reset();
  $('reminder-date').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  $('reminder-time').value = `${pad(nextHour.getHours())}:00`;
}

function renderReminders() {
  const list = $('reminder-list');
  list.replaceChildren();
  const reminders = [...state.config.reminders].sort((a, b) => Number(a.done) - Number(b.done) || a.next - b.next);
  if (!reminders.length) {
    list.append(el('p', 'empty', 'Belum ada pengingat.'));
    return;
  }
  for (const r of reminders) {
    const row = el('div', r.done ? 'item done' : 'item');
    const main = el('div', 'item-main');
    const sub = r.done ? 'Selesai' : [whenText(r.next), REPEAT[r.repeat] ?? '', r.note].filter(Boolean).join(' · ');
    main.append(el('div', 'item-title', r.title), el('div', 'item-sub', sub));
    row.append(
      main,
      iconButton('remove', 'Hapus pengingat', () =>
        save({ reminders: state.config.reminders.filter((x) => x.id !== r.id) }).then(renderReminders),
      ),
    );
    list.append(row);
  }
}

$('reminder-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const reminder = {
    id: uid(),
    title: $('reminder-title').value.trim(),
    date: $('reminder-date').value,
    time: $('reminder-time').value,
    repeat: $('reminder-repeat').value,
    note: $('reminder-note').value.trim(),
  };
  if (!reminder.title || !reminder.date || !reminder.time) return;
  await save({ reminders: [...state.config.reminders, reminder] });
  resetReminderForm();
  renderReminders();
});

// ---------- Claude Code ----------

function renderClaude() {
  const hooks = state.hooks;
  $('hooks-dot').classList.toggle('on', hooks.installed);
  $('hooks-status').textContent = hooks.error ? hooks.error : hooks.installed ? 'Hook terpasang' : 'Hook belum terpasang';
  $('hooks-file').textContent = hooks.file ? `File: ${hooks.file}` : '';
  $('hooks-install').disabled = hooks.installed;
  $('hooks-uninstall').disabled = !hooks.installed;
  $('claude-peek').checked = state.config.claude.peek;
  $('claude-permissions').checked = state.config.claude.permissions;
}

async function hooks(action) {
  try {
    state.hooks = await api.hooks(action);
  } catch (error) {
    state.hooks = { installed: false, error: String(error.message || error) };
  }
  renderClaude();
}

$('hooks-install').addEventListener('click', () => hooks('install'));
$('hooks-uninstall').addEventListener('click', () => hooks('uninstall'));
$('claude-peek').addEventListener('change', (e) => save({ claude: { ...state.config.claude, peek: e.target.checked } }));
$('claude-permissions').addEventListener('change', (e) =>
  save({ claude: { ...state.config.claude, permissions: e.target.checked } }),
);

// ---------- Fokus ----------

const FOCUS_FIELDS = {
  'focus-minutes': 'focusMinutes',
  'break-minutes': 'breakMinutes',
  'long-minutes': 'longBreakMinutes',
  'focus-cycles': 'cycles',
};

function renderFocus() {
  const f = state.config.focus;
  for (const [id, key] of Object.entries(FOCUS_FIELDS)) {
    if (document.activeElement !== $(id)) $(id).value = String(f[key]);
  }
  $('focus-autobreak').checked = f.autoStartBreak;
  const w = state.config.wellness;
  $('eyes-enabled').checked = w.eyes;
  $('eyes-minutes').value = String(w.eyesMinutes);
  $('eyes-minutes').disabled = !w.eyes;
  $('water-enabled').checked = w.water;
  $('water-minutes').value = String(w.waterMinutes);
  $('water-minutes').disabled = !w.water;
  // Nilai di luar pilihan (diubah manual di config) tetap tampil sebagai opsi tambahan.
  for (const [id, value, label] of [['water-ml', w.waterMl, `${w.waterMl} ml`], ['water-target', w.waterTargetMl, `${(w.waterTargetMl / 1000).toLocaleString('id-ID')} liter`]]) {
    const select = $(id);
    if (![...select.options].some((o) => Number(o.value) === value)) select.add(new Option(label, String(value)));
    select.value = String(value);
  }
  $('focus-mute').checked = f.muteNotifications;
}

for (const [id, key] of Object.entries(FOCUS_FIELDS)) {
  $(id).addEventListener(
    'input',
    debounce(() => {
      const input = $(id);
      const value = Math.round(Number(input.value));
      if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) return;
      save({ focus: { ...state.config.focus, [key]: value } });
    }, 600),
  );
}
for (const [key, input, minutes] of [['eyes', 'eyes-enabled', 'eyes-minutes'], ['water', 'water-enabled', 'water-minutes']]) {
  $(input).addEventListener('change', (e) => save({ wellness: { ...state.config.wellness, [key]: e.target.checked } }).then(renderFocus));
  $(minutes).addEventListener('change', (e) => save({ wellness: { ...state.config.wellness, [`${key}Minutes`]: Number(e.target.value) } }));
}
$('water-ml').addEventListener('change', (e) => save({ wellness: { ...state.config.wellness, waterMl: Number(e.target.value) } }));
$('water-target').addEventListener('change', (e) => save({ wellness: { ...state.config.wellness, waterTargetMl: Number(e.target.value) } }));
$('focus-autobreak').addEventListener('change', (e) => save({ focus: { ...state.config.focus, autoStartBreak: e.target.checked } }));
$('focus-mute').addEventListener('change', (e) => save({ focus: { ...state.config.focus, muteNotifications: e.target.checked } }));

// ---------- Dev ----------

function saveDev(patch) {
  return save({ dev: { ...state.config.dev, ...patch } }).then(renderDevSettings);
}

function renderDevSettings() {
  const dev = state.config.dev;
  $('dev-alerts').checked = dev.alerts;

  const services = $('service-list');
  services.replaceChildren();
  if (!dev.services.length) services.append(el('p', 'empty', 'Belum ada server.'));
  dev.services.forEach((s, i) => {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    main.append(el('div', 'item-title', s.name), el('div', 'item-sub', `${s.type === 'tcp' ? 'Port' : 'Website'} · ${s.target}`));
    const move = (to) => {
      const next = [...dev.services];
      [next[i], next[to]] = [next[to], next[i]];
      saveDev({ services: next });
    };
    row.append(
      main,
      iconButton('up', 'Naikkan', () => move(i - 1), i === 0),
      iconButton('down', 'Turunkan', () => move(i + 1), i === dev.services.length - 1),
      iconButton('remove', 'Hapus', () => saveDev({ services: dev.services.filter((_, j) => j !== i) })),
    );
    services.append(row);
  });

  const projects = $('project-list');
  projects.replaceChildren();
  if (!dev.projects.length) projects.append(el('p', 'empty', 'Belum ada project.'));
  dev.projects.forEach((dir, i) => {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    main.append(el('div', 'item-title', dir.split(/[\\/]/).filter(Boolean).pop()), el('div', 'item-sub', dir));
    row.append(main, iconButton('remove', 'Hapus', () => saveDev({ projects: dev.projects.filter((_, j) => j !== i) })));
    projects.append(row);
  });
}

$('dev-alerts').addEventListener('change', (e) => saveDev({ alerts: e.target.checked }));

$('service-type').addEventListener('change', (e) => {
  $('service-target').placeholder = e.target.value === 'tcp' ? '127.0.0.1:5432' : 'http://crm.localhost:3000';
});

$('service-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const type = $('service-type').value;
  const target = $('service-target').value.trim();
  const valid = type === 'tcp' ? /^[\w.-]*:?\d{2,5}$/.test(target) : /^https?:\/\/.+/i.test(target);
  if (!valid) {
    $('service-target').setCustomValidity(type === 'tcp' ? 'Contoh: 127.0.0.1:5432' : 'Contoh: http://localhost:3000');
    $('service-target').reportValidity();
    return;
  }
  saveDev({ services: [...state.config.dev.services, { name: $('service-name').value.trim(), type, target }] });
  $('service-form').reset();
});
$('service-target').addEventListener('input', (e) => e.target.setCustomValidity(''));

$('add-project').addEventListener('click', async () => {
  const dir = await api.pickFolder();
  if (dir && !state.config.dev.projects.includes(dir)) saveDev({ projects: [...state.config.dev.projects, dir] });
});

// ---------- Aktivitas live ----------

for (const key of ['privacy', 'meetings', 'downloads']) {
  $(`live-${key}`).addEventListener('change', (e) => save({ live: { ...state.config.live, [key]: e.target.checked } }));
}

function renderLive() {
  for (const key of ['privacy', 'meetings', 'downloads']) $(`live-${key}`).checked = state.config.live[key];
}

// ---------- Ngobrol ----------

const CUSTOM_MODEL = '__lain__';
// Model yang tersedia untuk key tersimpan, dimuat sekali per penyedia: { openai: [...], gemini: [...] }.
const accountModels = {};
const loadingModels = new Set();

async function loadAccountModels(provider) {
  if (loadingModels.has(provider)) return;
  loadingModels.add(provider);
  const result = await api.chatModels(provider);
  loadingModels.delete(provider);
  accountModels[provider] = result.ok ? result.models : [];
  if (chatProvider() === provider) renderChat();
}
const chatProvider = () => state.config.chat.provider || 'anthropic';
const providerInfo = () => state.chatProviders?.[chatProvider()] ?? null;

function renderChat() {
  const c = state.config.chat;
  const info = providerInfo();
  $('chat-enabled').checked = c.enabled;
  $('chat-actions').checked = c.actions;

  // Kartu pilihan penyedia
  const box = $('chat-providers');
  box.replaceChildren();
  for (const [id, p] of Object.entries(state.chatProviders ?? {})) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'chat-provider';
    input.value = id;
    input.checked = id === chatProvider();
    input.addEventListener('change', () => save({ chat: { ...state.config.chat, provider: id } }).then(renderChat));
    const name = document.createElement('b');
    name.textContent = p.label;
    const status = document.createElement('small');
    status.textContent = p.keyMask ? 'Key tersimpan' : p.envKey ? `Pakai ${p.env}` : 'Belum ada key';
    status.className = p.keyMask || p.envKey ? 'ok' : '';
    label.append(input, name, status);
    box.append(label);
  }
  if (!info) return;

  $('chat-key-label').textContent = `API key ${info.short}`;
  $('chat-key').placeholder = info.keyHint;
  $('chat-key-where').textContent = `Buat key di ${info.keyWhere}. Key disimpan terenkripsi di laptop ini dan tidak pernah ditampilkan utuh.`;
  $('chat-key-status').textContent = info.keyMask ? `Tersimpan: ${info.keyMask}` : info.envKey ? `Memakai variabel lingkungan ${info.env}.` : 'Belum ada API key.';
  $('chat-key-remove').disabled = !info.keyMask;

  // Model: pilihan cepat + model dari akunmu (OpenAI & Gemini) + "Model lain…"
  const provider = chatProvider();
  const hasKey = Boolean(info.keyMask || info.envKey);
  if (info.customModel && hasKey && !(provider in accountModels)) loadAccountModels(provider);
  const select = $('chat-model');
  const quick = Object.entries(info.models ?? {}).map(([id, label]) => new Option(label, id));
  const fromAccount = (accountModels[provider] ?? []).filter((m) => !info.models?.[m.id]);
  if (fromAccount.length) {
    const g1 = document.createElement('optgroup');
    g1.label = 'Pilihan cepat';
    g1.append(...quick);
    const g2 = document.createElement('optgroup');
    g2.label = 'Dari akunmu';
    g2.append(...fromAccount.map((m) => new Option(m.label ? `${m.label} (${m.id})` : m.id, m.id)));
    select.replaceChildren(g1, g2);
  } else {
    select.replaceChildren(...quick);
  }
  if (info.customModel) select.append(new Option('Model lain…', CUSTOM_MODEL));
  const current = c[info.modelField];
  const known = Boolean(info.models?.[current]) || fromAccount.some((m) => m.id === current);
  select.value = known ? current : info.customModel && current ? CUSTOM_MODEL : Object.keys(info.models ?? {})[0];
  $('chat-custom-field').hidden = select.value !== CUSTOM_MODEL;
  if (select.value === CUSTOM_MODEL && document.activeElement !== $('chat-custom-model')) $('chat-custom-model').value = known ? '' : current || '';
}

const saveModel = (model) => {
  const info = providerInfo();
  if (info) save({ chat: { ...state.config.chat, [info.modelField]: model } });
};

$('chat-enabled').addEventListener('change', (e) => save({ chat: { ...state.config.chat, enabled: e.target.checked } }));
$('chat-actions').addEventListener('change', (e) => save({ chat: { ...state.config.chat, actions: e.target.checked } }));
$('chat-model').addEventListener('change', (e) => {
  const custom = e.target.value === CUSTOM_MODEL;
  $('chat-custom-field').hidden = !custom;
  if (custom) $('chat-custom-model').focus();
  else saveModel(e.target.value);
});
$('chat-custom-model').addEventListener('change', (e) => {
  const value = e.target.value.trim();
  if (/^[\w.:-]{2,80}$/.test(value)) saveModel(value);
});
$('chat-key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await api.chatKey($('chat-key').value, chatProvider());
  $('chat-key').value = '';
  if (!result.ok) {
    $('chat-key-status').textContent = result.error;
    return;
  }
  state = result.state;
  delete accountModels[chatProvider()];
  renderChat();
});
$('chat-key-remove').addEventListener('click', async () => {
  const result = await api.chatKey('', chatProvider());
  if (result.ok) {
    state = result.state;
    delete accountModels[chatProvider()];
    renderChat();
  }
});
$('chat-test').addEventListener('click', async () => {
  const out = $('chat-test-result');
  out.textContent = 'Zeno sedang berpikir…';
  const result = await api.chatTest();
  out.textContent = result.ok ? `“${result.answer}”` : result.error;
});

// ---------- Kalender ----------

const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const shortDay = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

function renderCalendar() {
  const c = state.config.calendar;
  const status = state.calendarStatus ?? {};
  $('calendar-enabled').checked = c.enabled;
  $('calendar-remind').value = String(c.remindMinutes);
  $('calendar-refresh').disabled = !c.feeds.length;
  const next = status.next;
  $('calendar-status').textContent = !c.feeds.length
    ? 'Belum ada kalender. Sambungkan di bawah.'
    : !c.enabled
      ? 'Nonaktif.'
      : status.checkedAt
        ? `${status.count} acara hari ini & besok${next ? ` · berikutnya: ${next.title}, ${shortDay.format(next.start)} ${timeFmt.format(next.start)}` : ''}`
        : 'Memuat…';

  const list = $('calendar-list');
  list.replaceChildren();
  if (!c.feeds.length) list.append(el('p', 'empty', 'Belum ada kalender.'));
  for (const feed of c.feeds) {
    const row = el('div', 'item');
    const main = el('div', 'item-main');
    const error = status.errors?.[feed.id];
    main.append(el('div', 'item-title', feed.name), el('div', `item-sub${error ? ' error-text' : ''}`, error ? `Gagal dibaca: ${error}` : feed.host));
    row.append(
      main,
      iconButton('remove', 'Lepas kalender', () =>
        save({ calendar: { ...state.config.calendar, feeds: state.config.calendar.feeds.filter((f) => f.id !== feed.id) } }).then(renderCalendar),
      ),
    );
    list.append(row);
  }
}

$('calendar-enabled').addEventListener('change', (e) => save({ calendar: { ...state.config.calendar, enabled: e.target.checked } }).then(renderCalendar));
$('calendar-remind').addEventListener('change', (e) => save({ calendar: { ...state.config.calendar, remindMinutes: Number(e.target.value) } }));
$('calendar-refresh').addEventListener('click', async () => {
  $('calendar-status').textContent = 'Memuat…';
  state = await api.calendarRefresh();
  renderCalendar();
});
$('calendar-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('calendar-add');
  button.disabled = true;
  button.textContent = 'Memeriksa…';
  $('calendar-error').textContent = '';
  const result = await api.calendarAdd($('calendar-name').value, $('calendar-url').value);
  button.disabled = false;
  button.textContent = 'Sambungkan';
  if (!result.ok) {
    $('calendar-error').textContent = result.error;
    return;
  }
  $('calendar-form').reset();
  state = result.state;
  renderCalendar();
});

// ---------- Kebiasaan ----------

const DAY_LABELS = [[1, 'Sen'], [2, 'Sel'], [3, 'Rab'], [4, 'Kam'], [5, 'Jum'], [6, 'Sab'], [0, 'Min']];

function daysText(days) {
  const set = [...days].sort().join(',');
  if (set === '0,1,2,3,4,5,6') return 'Setiap hari';
  if (set === '1,2,3,4,5') return 'Hari kerja';
  if (set === '0,6') return 'Akhir pekan';
  return DAY_LABELS.filter(([d]) => days.includes(d)).map(([, label]) => label).join(', ');
}

function dayPicker(container, selected, onChange) {
  container.replaceChildren();
  for (const [day, label] of DAY_LABELS) {
    const button = el('button', 'day', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected.includes(day)));
    button.addEventListener('click', () => {
      const next = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day];
      if (next.length) onChange(next);
    });
    container.append(button);
  }
}

let newHabitDays = [0, 1, 2, 3, 4, 5, 6];

function saveHabits(list) {
  return save({ habits: list }).then(renderHabitSettings);
}

function renderHabitSettings() {
  const list = $('habit-list');
  list.replaceChildren();
  const today = new Map((state.habitsToday ?? []).map((h) => [h.id, h]));
  if (!state.config.habits.length) list.append(el('p', 'empty', 'Belum ada kebiasaan. Mulai dari satu yang kecil dulu.'));
  state.config.habits.forEach((habit, i) => {
    const info = today.get(habit.id) ?? {};
    const row = el('div', 'item');
    const icon = el('span', 'item-icon habit-icon', habit.emoji);
    const main = el('div', 'item-main');
    const sub = [daysText(habit.days), habit.remind ? `ingatkan ${habit.remind.replace(':', '.')}` : '', info.streak ? `🔥 ${info.streak} hari` : ''].filter(Boolean).join(' · ');
    main.append(el('div', 'item-title', habit.name), el('div', 'item-sub', sub));
    const check = el('button', `btn small${info.done ? ' done' : ''}`, info.done ? 'Selesai ✓' : 'Centang');
    check.type = 'button';
    check.disabled = !info.scheduled && !info.done;
    check.title = info.scheduled ? '' : 'Bukan jadwal hari ini';
    check.addEventListener('click', async () => {
      state = await api.habitDone(habit.id, !info.done);
      renderHabitSettings();
    });
    const move = (to) => {
      const next = [...state.config.habits];
      [next[i], next[to]] = [next[to], next[i]];
      saveHabits(next);
    };
    row.append(
      icon,
      main,
      check,
      iconButton('up', 'Naikkan', () => move(i - 1), i === 0),
      iconButton('down', 'Turunkan', () => move(i + 1), i === state.config.habits.length - 1),
      iconButton('remove', 'Hapus', () => saveHabits(state.config.habits.filter((h) => h.id !== habit.id))),
    );
    list.append(row);
  });
  dayPicker($('habit-days'), newHabitDays, (days) => {
    newHabitDays = days;
    renderHabitSettings();
  });
}

$('habit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('habit-name').value.trim();
  if (!name) return;
  const habit = { id: uid(), name, emoji: $('habit-emoji').value.trim() || '✅', days: newHabitDays, remind: $('habit-remind').value || '' };
  saveHabits([...state.config.habits, habit]);
  $('habit-form').reset();
  newHabitDays = [0, 1, 2, 3, 4, 5, 6];
});

// ---------- Sistem & layar ----------

function renderSystemSettings() {
  const s = state.config.system;
  $('system-internet').checked = s.internetAlerts;
  $('system-resources').checked = s.resourceAlerts;
  if (!$('ocr-shortcut').classList.contains('recording')) $('ocr-shortcut').value = (state.config.ocr.shortcut || '').replace('Control', 'Ctrl');
  const now = state.systemNow;
  $('system-now').textContent = now
    ? [
        now.online == null ? '' : now.online ? `Internet tersambung${now.ms ? ` (${now.ms} ms)` : ''}` : 'Internet putus',
        now.cpu != null ? `CPU ${now.cpu}%` : '',
        now.memory ? `RAM ${now.memory.percent}%` : '',
        now.disk ? `${['Disk', now.disk.drive].filter(Boolean).join(' ')} terpakai ${now.disk.percent}%` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
}

$('system-internet').addEventListener('change', (e) => save({ system: { ...state.config.system, internetAlerts: e.target.checked } }));
$('system-resources').addEventListener('change', (e) => save({ system: { ...state.config.system, resourceAlerts: e.target.checked } }));
shortcutRecorder($('ocr-shortcut'), renderSystemSettings, (combo) => save({ ocr: { ...state.config.ocr, shortcut: combo } }));

// ---------- Statistik ----------

function fmtDuration(ms) {
  const minutes = Math.round((ms ?? 0) / 60_000);
  if (!minutes) return '–';
  return minutes >= 60 ? `${Math.floor(minutes / 60)} j ${minutes % 60} m` : `${minutes} m`;
}

function renderStats() {
  const table = $('stats-table');
  table.replaceChildren();
  const head = el('tr');
  // Kelas kolom: lebar tetap & kolom kecil disembunyikan saat kartunya sempit (settings.css).
  const COLS = ['day', 'claude', 'focus', 'todos', 'habits', 'reminders', 'apps', 'song'];
  ['Hari', 'Claude', 'Fokus', 'Tugas', 'Kebiasaan', 'Pengingat', 'Aplikasi', 'Lagu favorit'].forEach((label, i) => head.append(el('th', `c-${COLS[i]}`, label)));
  table.append(head);
  const dayFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
  const week = [...(state.statsWeek ?? [])].reverse();
  week.forEach((d, i) => {
    const row = el('tr', i === 0 ? 'today' : '');
    const [y, m, dd] = d.key.split('-').map(Number);
    const song = el('td', 'song c-song', d.top ? d.top[0] : '–');
    if (d.top) song.title = d.top[0];
    row.append(
      el('td', 'c-day', i === 0 ? 'Hari ini' : dayFormat.format(new Date(y, m - 1, dd))),
      el('td', 'c-claude', fmtDuration(d.claudeMs)),
      el('td', 'c-focus', String(d.focus || '–')),
      el('td', 'c-todos', String(d.todos || '–')),
      el('td', 'c-habits', String(d.habits || '–')),
      el('td', 'c-reminders', String(d.reminders || '–')),
      el('td', 'c-apps', String(d.apps || '–')),
      song,
    );
    table.append(row);
  });
  $('summary-enabled').checked = state.config.stats.summary;
  $('weekly-enabled').checked = state.config.stats.weekly;
  $('summary-time').value = state.config.stats.time;
  $('summary-time').disabled = !state.config.stats.summary;
}

$('summary-enabled').addEventListener('change', (e) => save({ stats: { ...state.config.stats, summary: e.target.checked } }).then(renderStats));
$('summary-time').addEventListener('change', (e) => e.target.value && save({ stats: { ...state.config.stats, time: e.target.value } }));
$('preview-summary').addEventListener('click', () => api.preview('summary'));
$('weekly-enabled').addEventListener('change', (e) => save({ stats: { ...state.config.stats, weekly: e.target.checked } }));
$('preview-weekly').addEventListener('click', () => api.preview('weekly'));

// ---------- Perintah suara ----------

function renderVoiceStatus(status) {
  const s = status ?? state.voiceStatus ?? {};
  $('voice-dot').classList.toggle('on', Boolean(s.ready));
  const d = s.downloading;
  $('voice-status').textContent = s.error
    ? `Gagal: ${s.error}`
    : s.ready
      ? 'Mesin suara siap (whisper.cpp, model base)'
      : d
        ? d.stage
        : s.needsBrew
          ? s.model
            ? 'Tinggal pasang whisper.cpp: buka Terminal, jalankan  brew install whisper-cpp  lalu buka ulang Zenopod.'
            : 'Unduh model suara di bawah, lalu pasang whisper.cpp lewat Terminal:  brew install whisper-cpp'
          : 'Mesin suara belum diunduh';
  $('voice-download').hidden = Boolean(s.ready || d || (s.needsBrew && s.model));
  $('voice-progress').hidden = !d;
  if (d) {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    $('voice-bar').style.width = `${pct}%`;
    $('voice-progress-text').textContent = d.total ? `${Math.round(d.received / 1e6)} / ${Math.round(d.total / 1e6)} MB` : '';
  } else {
    $('voice-progress-text').textContent = '';
  }
}

function renderVoice() {
  const v = state.config.voice;
  renderVoiceStatus();
  $('voice-enabled').checked = v.enabled;
  $('voice-shortcut').textContent = v.shortcut.replace('Control', 'Ctrl');
  $('voice-speak').checked = v.speak;
  $('voice-rate').value = String(v.rate);
  $('voice-pitch').value = String(v.pitch);
  $('voice-rate-label').textContent = `${Number(v.rate).toFixed(2)}×`;
  $('voice-pitch-label').textContent = `${Number(v.pitch).toFixed(2)}×`;

  const select = $('voice-id');
  select.replaceChildren(new Option('Otomatis (Bahasa Indonesia)', ''));
  for (const voice of state.ttsVoices ?? []) select.append(new Option(`${voice.name} · ${voice.lang}`, voice.id));
  select.value = v.voiceId || '';

  const hasIndonesian = (state.ttsVoices ?? []).some((voice) => String(voice.lang).toLowerCase().startsWith('id'));
  $('voice-hint').textContent = hasIndonesian
    ? 'Suara Bahasa Indonesia terpasang.'
    : state.platform === 'darwin'
      ? 'Belum ada suara Bahasa Indonesia, jadi Zeno menjawab lewat kartu saja. Pasang gratis: System Settings › Accessibility › Spoken Content › System Voice › Manage Voices › Indonesian (Damayanti), lalu buka ulang Zenopod.'
      : 'Belum ada suara Bahasa Indonesia, jadi Zeno menjawab lewat kartu saja. Pasang gratis: Pengaturan Windows › Waktu & bahasa › Ucapan › Tambahkan suara › Bahasa Indonesia (Microsoft Andika), lalu buka ulang Zenopod.';
  $('voice-test').disabled = !state.ttsAuto && !v.voiceId;
}

$('voice-download').addEventListener('click', async () => {
  renderVoiceStatus(await api.voiceDownload());
});
api.onVoiceStatus((status) => {
  state.voiceStatus = status;
  if (section === 'voice') renderVoiceStatus(status);
});
$('voice-enabled').addEventListener('change', (e) => save({ voice: { ...state.config.voice, enabled: e.target.checked } }));
$('voice-speak').addEventListener('change', (e) => save({ voice: { ...state.config.voice, speak: e.target.checked } }));
$('voice-id').addEventListener('change', (e) => save({ voice: { ...state.config.voice, voiceId: e.target.value } }).then(renderVoice));
for (const key of ['rate', 'pitch']) {
  $(`voice-${key}`).addEventListener('input', (e) => ($(`voice-${key}-label`).textContent = `${Number(e.target.value).toFixed(2)}×`));
  $(`voice-${key}`).addEventListener('change', (e) => save({ voice: { ...state.config.voice, [key]: Number(e.target.value) } }));
}
$('voice-test').addEventListener('click', () => api.voiceTest(`Halo ${state.config.user.name.split(' ')[0] || ''}, aku ${state.config.buddy.name || 'Zeno'}. Ada yang bisa aku bantu?`));

// ---------- Cuaca & baterai ----------

function renderWeather() {
  const w = state.config.weather;
  $('weather-enabled').checked = w.enabled;
  $('weather-alerts').checked = w.alerts;
  $('battery-alerts').checked = state.config.battery.alerts;
  $('battery-percent').checked = state.config.battery.showPercent;
  $('bluetooth-alerts').checked = state.config.bluetooth.alerts;
  $('usb-alerts').checked = state.config.usb.alerts;
  const now = state.weatherNow;
  $('weather-now').textContent = !w.city
    ? 'Pilih kota dulu.'
    : now
      ? `${w.city.name}: ${now.temperature}° ${now.text}`
      : `${w.city.name}${w.enabled ? ' · memuat…' : ' · nonaktif'}`;
}

$('weather-enabled').addEventListener('change', (e) => {
  if (e.target.checked && !state.config.weather.city) {
    e.target.checked = false;
    $('city-input').focus();
    return;
  }
  save({ weather: { ...state.config.weather, enabled: e.target.checked } }).then(renderWeather);
});
$('weather-alerts').addEventListener('change', (e) => save({ weather: { ...state.config.weather, alerts: e.target.checked } }));
$('battery-alerts').addEventListener('change', (e) => save({ battery: { ...state.config.battery, alerts: e.target.checked } }));
$('usb-alerts').addEventListener('change', (e) => save({ usb: { ...state.config.usb, alerts: e.target.checked } }));
$('bluetooth-alerts').addEventListener('change', (e) => save({ bluetooth: { ...state.config.bluetooth, alerts: e.target.checked } }));
$('battery-percent').addEventListener('change', (e) => save({ battery: { ...state.config.battery, showPercent: e.target.checked } }));

$('city-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = $('city-input').value.trim();
  const list = $('city-results');
  if (!query) return;
  list.replaceChildren(el('p', 'empty', 'Mencari…'));
  const { results, error } = await api.searchCity(query);
  list.replaceChildren();
  if (error || !results.length) {
    list.append(el('p', 'empty', error || 'Kota tidak ditemukan.'));
    return;
  }
  for (const city of results) {
    const row = el('button', 'item');
    row.type = 'button';
    const main = el('div', 'item-main');
    main.append(el('div', 'item-title', city.name), el('div', 'item-sub', city.region));
    row.append(main, el('span', 'tag', 'Pilih'));
    row.addEventListener('click', async () => {
      await save({ weather: { ...state.config.weather, enabled: true, city } });
      list.replaceChildren();
      $('city-input').value = '';
      renderWeather();
    });
    list.append(row);
  }
});

// ---------- Suara ----------

const SOUND_GROUPS = [
  { key: 'notifications', title: 'Notifikasi', sub: 'Notifikasi baru dari aplikasi lain.', sounds: [['notif', 'Notifikasi']] },
  {
    key: 'claude',
    title: 'Claude Code',
    sub: 'Claude selesai, butuh kamu, minta izin, atau error.',
    sounds: [['success', 'Selesai'], ['attention', 'Butuh kamu'], ['question', 'Minta izin'], ['error', 'Error']],
  },
  {
    key: 'reminders',
    title: 'Pengingat & fokus',
    sub: 'Pengingat tiba, fokus selesai, istirahat selesai.',
    sounds: [['alarm', 'Pengingat'], ['chime', 'Fokus selesai'], ['wake', 'Istirahat selesai']],
  },
  { key: 'dev', title: 'Dev', sub: 'Server lokal mati.', sounds: [['uhoh', 'Server mati']] },
  {
    key: 'weather',
    title: 'Cuaca, baterai & Bluetooth',
    sub: 'Mulai hujan, baterai lemah, charger dicolok/dicabut, perangkat Bluetooth/USB tersambung.',
    sounds: [
      ['rain', 'Hujan'], ['lowbat', 'Baterai lemah'], ['charge', 'Charger dicolok'], ['unplug', 'Charger dicabut'],
      ['connect', 'Perangkat tersambung'], ['disconnect', 'Perangkat terputus'],
    ],
  },
  {
    key: 'buddy',
    title: 'Zeno',
    sub: 'Sapaan, saat diklik/dielus/dipencet, menjalankan aplikasi, mencentang catatan.',
    sounds: [
      ['hello', 'Sapaan'], ['giggle', 'Geli'], ['pat', 'Dielus'], ['boing', 'Pipi dicolek'], ['boop', 'Boop'], ['purr', 'Mendengkur'],
      ['shy', 'Malu'], ['yawn', 'Menguap'], ['sparkle', 'Salto'], ['hmph', 'Ngambek'], ['grumble', 'Kesal'], ['angry', 'Marah'],
      ['cry', 'Menangis'], ['dizzy', 'Pusing'], ['blip', 'Buka aplikasi'], ['tick', 'Centang'],
    ],
  },
];

const PLAY_ICON = '<svg viewBox="0 0 10 10"><path d="M2 1.2v7.6L8.6 5z" /></svg>';

function renderSound() {
  const sound = state.config.sound;
  $('sound-enabled').checked = sound.enabled;
  $('sound-volume').value = String(Math.round(sound.volume * 100));
  $('sound-volume-label').textContent = `${Math.round(sound.volume * 100)}%`;

  const list = $('sound-categories');
  list.replaceChildren();
  for (const group of SOUND_GROUPS) {
    const row = el('div', 'item top');
    const main = el('div', 'item-main');
    main.append(el('div', 'item-title', group.title), el('div', 'item-sub', group.sub));
    const chips = el('div', 'chips');
    for (const [name, label] of group.sounds) {
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.innerHTML = PLAY_ICON;
      chip.append(label);
      chip.title = 'Dengarkan';
      chip.addEventListener('click', () => window.KapsulSound.play(name, state.config.sound.volume || 0.6));
      chips.append(chip);
    }
    main.append(chips);

    const toggle = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = sound[group.key] !== false;
    input.setAttribute('aria-label', `Suara ${group.title}`);
    input.addEventListener('change', () => save({ sound: { ...state.config.sound, [group.key]: input.checked } }));
    toggle.append(input, el('span'));
    row.append(main, toggle);
    list.append(row);
  }
}

$('sound-enabled').addEventListener('change', (e) => save({ sound: { ...state.config.sound, enabled: e.target.checked } }));
$('sound-volume').addEventListener('input', (e) => {
  $('sound-volume-label').textContent = `${e.target.value}%`;
});
$('sound-volume').addEventListener('change', (e) => {
  const volume = Number(e.target.value) / 100;
  save({ sound: { ...state.config.sound, volume } }).then(() => window.KapsulSound.play('notif', volume));
});

// ---------- Tampilan ----------

function renderCostume() {
  const select = $('costume');
  if (!select.options.length) {
    const options = [['auto', 'Otomatis'], ['none', 'Tanpa kostum'], ...Object.entries(state.costumes ?? {})];
    for (const [value, label] of options) select.append(new Option(label, value));
  }
  select.value = state.config.costume || 'auto';
  const now = state.costumeNow;
  $('costume-now').textContent = now?.costume
    ? `Sekarang: ${state.costumes?.[now.costume] ?? now.costume}${now.reason ? ` · ${now.reason}` : ''}`
    : 'Peci saat Jumat & Ramadan, ketupat saat Lebaran, merah putih 17 Agustus, topi pesta saat ulang tahun. Payung / kacamata hitam di halaman Cuaca.';
}

$('ticker-enabled').addEventListener('change', (e) =>
  save({ ticker: { ...state.config.ticker, enabled: e.target.checked } }).then(renderDisplay),
);
$('ticker-seconds').addEventListener('change', (e) => save({ ticker: { ...state.config.ticker, seconds: Number(e.target.value) } }));
$('clock-enabled').addEventListener('change', (e) => save({ clockMode: { ...state.config.clockMode, enabled: e.target.checked } }).then(renderDisplay));
$('clock-seconds').addEventListener('change', (e) => save({ clockMode: { ...state.config.clockMode, seconds: Number(e.target.value) } }));

$('costume').addEventListener('change', (e) => save({ costume: e.target.value }).then(renderCostume));

const UPDATE_TEXT = {
  dev: 'Dijalankan dari kode (npm start); pembaruan lewat git pull.',
  idle: 'Pembaruan dicek otomatis tiap 6 jam.',
  checking: 'Mengecek pembaruan…',
  latest: 'Sudah versi terbaru.',
  downloading: 'Mengunduh versi {v}…',
  ready: 'Versi {v} siap dipasang. Mulai ulang Zenopod untuk memakainya.',
  error: 'Gagal mengecek pembaruan.',
  manual: 'Di Mac, versi baru diunduh manual dari halaman Releases.',
};

function renderAbout(status = state.updateStatus ?? {}) {
  const text = (UPDATE_TEXT[status.state] ?? '').replace('{v}', status.version ?? '');
  $('about-text').textContent = `Versi ${state.appVersion ?? '?'} · ${text}`;
  $('check-update').hidden = status.state === 'dev';
  $('check-update').textContent = status.state === 'manual' ? 'Buka Releases' : 'Cek pembaruan';
}

$('check-update').addEventListener('click', async () => {
  renderAbout({ state: 'checking' });
  renderAbout(await api.checkUpdate());
});

function renderDisplay() {
  renderCostume();
  renderAbout();
  $('ticker-enabled').checked = state.config.ticker.enabled;
  $('ticker-seconds').value = String(state.config.ticker.seconds);
  $('ticker-seconds').disabled = !state.config.ticker.enabled;
  $('lyrics-enabled').checked = state.config.lyrics.enabled;
  $('clock-enabled').checked = state.config.clockMode.enabled;
  // Nilai lama di luar pilihan (mis. dari config.json) tetap ditampilkan sebagai pilihan sendiri.
  const seconds = String(state.config.clockMode.seconds);
  if (![...$('clock-seconds').options].some((o) => o.value === seconds)) {
    $('clock-seconds').append(new Option(`${seconds} detik`, seconds));
  }
  $('clock-seconds').value = seconds;
  $('clock-seconds').disabled = !state.config.clockMode.enabled;
  for (const input of document.querySelectorAll('[name="position"]')) input.checked = input.value === state.config.position;
  for (const input of document.querySelectorAll('[name="island"]')) input.checked = input.value === state.config.island;
  if (!$('shortcut').classList.contains('recording')) $('shortcut').value = state.config.shortcut.replace('Control', 'Ctrl');
  $('autostart').checked = state.autostart;
}

for (const input of document.querySelectorAll('[name="position"]')) {
  input.addEventListener('change', () => save({ position: input.value }));
}

$('lyrics-enabled').addEventListener('change', (e) => save({ lyrics: { enabled: e.target.checked } }));

for (const input of document.querySelectorAll('[name="island"]')) {
  input.addEventListener('change', () => save({ island: input.value }));
}

$('autostart').addEventListener('change', async (e) => {
  state.autostart = await api.autostart(e.target.checked);
  renderDisplay();
});

// Rekam tombol pintas: minimal satu modifier + satu tombol biasa.
function shortcutRecorder(input, rerender, store) {
  input.addEventListener('focus', () => {
    input.classList.add('recording');
    input.value = 'Tekan kombinasi…';
  });
  input.addEventListener('blur', () => {
    input.classList.remove('recording');
    rerender();
  });
  input.addEventListener('keydown', (event) => {
    event.preventDefault();
    if (event.key === 'Escape') return input.blur();
    const mods = [];
    if (event.ctrlKey) mods.push('Control');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (event.metaKey) mods.push('Super');
    let key = event.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    if (!mods.length) return;
    store([...mods, key].join('+')).then(() => input.blur());
  });
}

shortcutRecorder($('shortcut'), renderDisplay, (combo) => save({ shortcut: combo }));

// ---------- Mulai ----------

api.onChanged(async () => {
  state = await api.get();
  // Daftar ikut diperbarui; isian yang sedang diketik tidak ditimpa.
  render();
});

api.onSection((next) => (next === 'intro' ? startIntro() : show(next)));

(async () => {
  state = await api.get();
  resetReminderForm();
  const requested = new URLSearchParams(location.search).get('section');
  if (requested === 'intro' || !state.config.user.name) startIntro();
  else show(requested || 'guide');
})();
