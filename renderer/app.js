'use strict';

const $ = (id) => document.getElementById(id);
// Aktivitas live (privasi, rapat, unduhan) — diisi lewat onLive.
let live = { privacy: { mic: [], camera: [] }, meeting: null, downloads: [] };
// Perangkat Bluetooth / USB / flashdisk tersambung (diisi onDevices).
let connectedDevices = { bluetooth: [], usb: [], drives: [] };
// Slot kanan ikut menampilkan cuaca (slot kiri lalu memakai ikon Wi-Fi, bukan cuaca lagi).
let rightIsWeather = false;

const shell = $('shell');
const appsEl = $('apps');

let media = { playing: false, title: null };
let claudeState = { active: [] };
let focusState = { phase: null, running: false, endsAt: null, remaining: 0, cycle: 1, done: 0 };
let focusSettings = { focusMinutes: 25, cycles: 4 };
let open = false;
let theater = false; // mode bioskop: island jadi layar video
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
  // Selama digeser jendela bergerak di bawah kursor: mouseenter bisa terpicu lagi, jangan buka panel.
  if (open || peekState || afterDrag || shell.classList.contains('dragging')) return;
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
      clearTimeout(hoverTimer);
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
  queueMicrotask(() => typeof placeYouTube === 'function' && placeYouTube());
  // Lirik di island hanya saat panel bawah tertutup (panel bawah sudah menampilkan lirik).
  queueMicrotask(renderIslandLyrics);
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

// Section yang cocok dengan isi kapsul saat panel dibuka (null = tetap di section terakhir).
const SECTION_FOR_SLIDE = {
  music: 'music',
  focus: 'focus',
  timer: 'focus',
  claude: 'work',
  'claude-wait': 'work',
  meeting: 'device',
  offline: 'device',
  weather: 'home',
  reminder: 'time',
  todos: 'time',
  habits: 'time',
  notifs: 'inbox',
  hungry: 'home',
};

function sectionForDisplay(wasCentered) {
  // Tata letak tengah: yang terlihat hanya Zeno + slot; musik diputar = section Musik.
  if (wasCentered) return media.playing ? 'music' : null;
  return SECTION_FOR_SLIDE[tickKey] ?? null;
}

window.kapsul.onExpanded((value) => {
  // Diambil sebelum updateCentered: saat panel terbuka, kapsul tidak lagi "di tengah".
  const wasCentered = centered;
  open = value;
  shell.classList.toggle('open', value);
  renderPillFocus();
  if (!value) setDetail(false, { sync: false });
  // Panel dibuka tak lama setelah notifikasi tampil = langsung ke Kotak masuk.
  if (value && lastPeek.kind === 'notification' && Date.now() - lastPeek.at < 4000) {
    setInboxMode('notifs');
    goToSection('inbox', { sound: false });
  }
  // "Lihat detail" di laporan mingguan → detail Perangkat (waktu layar).
  else if (value && lastPeek.kind === 'weekly' && Date.now() - lastPeek.at < 20_000) {
    lastPeek = { kind: null, at: 0 };
    goToSection('device', { sound: false });
    setDetail(true);
  }
  // Selain itu: buka section sesuai yang sedang tampil di kapsul (musik → Musik, fokus → Fokus, …).
  else if (value) {
    const id = sectionForDisplay(wasCentered);
    if (id && pageAvailable(PAGES[sectionIndex(id)])) goToSection(id, { sound: false });
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
    // Mode bioskop menutupi isi panel: Esc pertama selalu kembali ke island biasa.
    if (theater) return window.kapsul.theater(false);
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
  // Mode bioskop: ← / → = mundur / maju 10 detik, spasi = putar/jeda.
  if (theater && yt) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return ytSeek(yt.time + (event.key === 'ArrowLeft' ? -10 : 10));
    if (event.key === ' ') {
      event.preventDefault();
      return $('yt-play-btn').click();
    }
  }
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
// Lama kursor diam sebelum mode jam (Pengaturan › Tampilan › Mode jam). null = mode jam mati.
let restAfterMs = 30_000;
let resting = false;

function updateResting() {
  const should = restAfterMs !== null && !open && !peekState && !voiceState && !saying && !reaction && !pillOverride() && Date.now() - lastMove > restAfterMs;
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
  if (live.meeting) items.push({ key: 'meeting', ...restText(`<i class="rest-dot ${live.meeting.muted ? 'muted' : 'call'}"></i>`, clock(Date.now() - live.meeting.since).replace(/^0(?=\d:)/, '')) });
  if (live.downloads[0]) items.push({ key: 'download', ...restText('<i class="rest-dot download"></i>', sizeLabel(live.downloads[0].bytes).replace(/,\d(?= )/, '')) });
  return items;
}

function restStatusItems() {
  const items = [];
  if (battery && hasBattery) {
    // Baterai mini tanpa angka, satu warna putih: isi menunjukkan level. Persen ada di Perangkat.
    const percent = Math.round(battery.level * 100);
    const tone = battery.charging ? 'charging' : lowBattery() ? 'low' : '';
    const fill = (10.6 * Math.max(0.08, battery.level)).toFixed(1);
    const icon = `<svg class="mini-bat ${tone}" viewBox="0 0 17 9"><rect class="case" x="0.6" y="0.6" width="13.6" height="7.8" rx="2.2" /><rect class="level" x="2.1" y="2.1" width="${fill}" height="4.8" rx="1" /><rect class="tip" x="14.9" y="3" width="1.4" height="3" rx="0.7" /></svg>`;
    items.push({ key: 'battery', ...restText(icon, ''), sig: `${percent}|${tone}` });
  }
  // Headset / earbuds Bluetooth tersambung
  const headset = connectedDevices.bluetooth.find((d) => d.kind === 'audio');
  if (headset) items.push({ key: 'headset', ...restText(HEADSET_ICON, ''), sig: headset.name ?? '' });
  const mic = live.privacy.mic.length > 0;
  const cam = live.privacy.camera.length > 0;
  if (mic || cam) items.push({ key: 'privacy', html: `<span class="rest-chip">${mic ? '<i class="rest-dot mic"></i>' : ''}${cam ? '<i class="rest-dot cam"></i>' : ''}</span>`, sig: `${mic}|${cam}` });
  return items;
}

const HEADSET_ICON = '<svg viewBox="0 0 16 16"><path d="M3 10.5V8a5 5 0 0 1 10 0v2.5" /><rect x="2" y="9.5" width="3.2" height="4.6" rx="1.3" /><rect x="10.8" y="9.5" width="3.2" height="4.6" rx="1.3" /></svg>';

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
// Kiri & kanan selalu terisi supaya seimbang: kalau kosong, kanan diisi cuaca (atau jam saat Zeno
// di tengah / tanggal di mode jam), kiri diisi tanggal (PC tanpa baterai).

function restFallback(side) {
  if (side === 'right' && weatherNow) {
    const icon = weatherNow.look?.costume === 'umbrella' ? 'rain' : weatherNow.kind === 'clear' ? 'sun' : 'cloud';
    return { key: 'weather', ...restText(PILL_ICONS[icon], `${weatherNow.temperature}°`, 'small') };
  }
  if (side === 'right' && !resting) return { key: 'time', ...restText('', timeFormat.format(new Date()).replace('.', ':')) };
  // Mode jam tanpa cuaca: status internet (jam sudah di tengah, tanggal di kiri).
  if (side === 'right') return { key: 'net', ...(systemNow?.online === false ? restText(PILL_ICONS.offline, 'Offline', 'muted') : restText(WIFI_ICON, '')) };
  // Kiri: ikon saja supaya ringkas.
  if (weatherNow && !rightIsWeather) {
    const icon = weatherNow.look?.costume === 'umbrella' ? 'rain' : weatherNow.kind === 'clear' ? 'sun' : 'cloud';
    return { key: 'weather-icon', ...restText(PILL_ICONS[icon], '') };
  }
  return { key: 'net', ...restText(systemNow?.online === false ? PILL_ICONS.offline : WIFI_ICON, '') };
}


const WIFI_ICON = '<svg viewBox="0 0 16 16"><path d="M1.8 6a9 9 0 0 1 12.4 0M4 8.4a6 6 0 0 1 8 0M6.2 10.8a3 3 0 0 1 3.6 0" /><circle cx="8" cy="13" r="0.6" /></svg>';

function renderRestSlots() {
  const left = restStatusItems();
  // Kanan: aktivitas (musik, notifikasi, dev, panggilan, unduhan) bergantian dengan cuaca.
  const right = restActivityItems();
  if (weatherNow) right.push(restFallback('right'));
  if (!right.length) right.push(restFallback('right'));
  rightIsWeather = right.some((item) => item.key === 'weather');
  if (!left.length) left.push(restFallback('left'));
  renderRestSlot('left', left);
  renderRestSlot('right', right);
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

// Musik saja tidak dihitung: kapsul tetap tata letak tengah (Zeno berheadset di tengah,
// equalizer di slot kanan). Aktivitas lain memindahkan Zeno ke kiri dengan teks statusnya.
function hasActivity() {
  return Boolean(
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
    renderBuddy();
    applyCostume();
    if (centered) for (const slot of Object.values(restSlots)) Object.assign(slot, { index: 0, since: Date.now() });
  }
  // Mode jam merender slotnya sendiri (renderPillClock).
  if (centered && !resting) renderRestSlots();
}

// Kapsul selama sesi fokus/istirahat: cincin progres + hitung mundur di tengah, tanpa Zeno & teks lain.
function renderPillFocus() {
  const { phase, running } = focusState;
  const timer = activeTimer();
  const on = (Boolean(phase) || Boolean(timer)) && !open;
  shell.classList.toggle('focus-live', on);
  const box = $('pill-focus');
  box.hidden = !on;
  if (!on) return;
  const total = timer ? timer.total || 1 : focusTotal();
  const remaining = timer ? Math.max(0, timer.endsAt - Date.now()) : Math.max(0, focusRemaining());
  const time = clock(remaining);
  if ($('pf-time').textContent !== time) $('pf-time').textContent = time;
  const progress = Math.max(0, Math.min(1, 1 - remaining / total));
  $('pf-bar').style.strokeDasharray = `${(100 * progress).toFixed(2)} 100`;
  $('pf-bar').style.opacity = progress > 0.005 ? '1' : '0';
  box.classList.toggle('rest', Boolean(phase) && phase !== 'focus');
  box.classList.toggle('paused', Boolean(phase) && !running);
  box.classList.toggle('final', timer ? remaining < 10_000 : phase === 'focus' && running && remaining < 60_000);
  box.setAttribute('aria-label', timer ? `${timer.label}, sisa ${time}` : `${PHASE[phase]}${running ? '' : ' dijeda'}, sisa ${time}`);
}

setInterval(() => {
  updateResting();
  updateCentered();
  renderPillFocus();
}, 1000);

// ---------- Maskot ----------

// Dua maskot: kecil di kapsul, besar di panel (komponen dari buddy.js).
const buddy = window.createBuddy();
const bigBuddy = window.createBuddy();
const peekBuddy = window.createBuddy();
$('buddy-slot').replaceWith(buddy.el);
$('buddy-big').append(bigBuddy.el);
// Section Musik: Zeno kecil di kotak sampul (Zeno besar disembunyikan supaya lirik dapat ruang).
const artBuddy = window.createBuddy();
document.querySelector('.np-art').append(artBuddy.el);
$('peek-slot').append(peekBuddy.el);

const IDLE_SLEEP_MS = 3 * 60 * 1000;
let lastMove = Date.now();
let hoveringBig = false;
let reaction = null;
let userTyping = false; // diisi bridge (lihat onTyping)
let waterSettings = { ml: 250, target: 2000 }; // sekali minum & target harian (ml), dari state
const waterLiters = (ml) => (ml / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 });
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
// Panel: musik > senang; disentuh kursor = menyapa.
// Claude bekerja = berpikir; Claude menunggu jawaban = kaget memanggil.
// Fokus = berkacamata, istirahat = peregangan.
// Section Minum: layar Zeno besar terisi air sesuai target hari ini.
const waterRatio = () => (statsToday?.waterMl ?? 0) / (waterSettings.target || 2000);

function renderBuddy() {
  bigBuddy.setWater(PAGES[pageIndex]?.id === 'water' ? waterRatio() : null);
  // Fokus: layar Zeno = hitung mundur (diisi tickFocusIsland), section lain = wajah biasa.
  if (PAGES[pageIndex]?.id === 'focus') queueMicrotask(tickFocusIsland);
  else bigBuddy.setDisplay(null);
  const busy = claudeBusy();
  const tired = lowBattery() && !busy;
  const resting = (focusState.phase === 'break' || focusState.phase === 'long') && focusState.running;
  const focused = focusState.phase === 'focus' && focusState.running;
  const thinking = claudeState.active[0]?.state === 'thinking';
  const work = busy ? (thinking ? 'think' : 'work') : focused ? 'focus' : resting ? 'stretch' : null;
  if (voiceState) {
    const mood = voiceState === 'listening' ? 'hear' : 'think';
    buddy.setMood(mood);
    bigBuddy.setMood(mood);
    return;
  }
  // Tata letak tengah: teks slide tersembunyi, jadi ekspresinya tidak ikut slide (musik = berheadset).
  const slideMood = centered ? null : pillSlide?.mood;
  buddy.setMood(reaction ?? (claudeWaiting() ? 'surprised' : tired ? 'lowbat' : work ?? (userTyping ? 'typing' : sleepy() && !media.playing ? 'sleep' : (slideMood ?? (media.playing ? 'music' : 'idle')))));
  bigBuddy.setMood(reaction ?? (hoveringBig ? 'greet' : tired ? 'lowbat' : userTyping && !busy ? 'typing' : pageMood()));
  artBuddy.setMood(reaction ?? (tired ? 'lowbat' : media.playing ? 'music' : 'listen'));
}

// Kamu sedang mengetik (dari bridge: ada input sementara kursor diam) → Zeno ikut mengetik.
window.kapsul.onTyping?.((active) => {
  if (active === userTyping) return;
  userTyping = active;
  renderBuddy();
});

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
  if (state.clockMode) {
    restAfterMs = state.clockMode.enabled ? Math.max(5, Number(state.clockMode.seconds) || 30) * 1000 : null;
    updateResting();
  }
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
  if (typeof state.panelPinned === 'boolean') queueMicrotask(() => {
    panelPinned = state.panelPinned;
    renderPin();
  });
  if (state.water) {
    waterSettings = state.water;
    renderWater();
  }
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
  // Garis (bukan isian): chip mengisi path dengan warna teks, kecuali .line.
  reset: '<svg viewBox="0 0 16 16"><path class="line" d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4" /><path class="line" d="M4.2 2.2v2.6h2.6" /></svg>',
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
  renderPillFocus();
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

// ---------- Tenggat tugas ----------
const DUE_WEEKDAY = new Intl.DateTimeFormat('id-ID', { weekday: 'short' });
const DUE_DATE = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const DUE_TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const dayStart = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
// Urutan tugas terbuka: tenggat terdekat dulu, lalu yang tanpa tenggat (urutan dibuat).
const byDue = (a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || (a.at ?? 0) - (b.at ?? 0);

// "Hari ini 14.00", "Besok 09.00", "Sen 14.00", "28 Okt"; short = versi ringkas untuk island.
function dueLabel(due, { short = false } = {}) {
  const now = Date.now();
  const days = Math.round((dayStart(due) - dayStart(now)) / 86_400_000);
  const time = DUE_TIME.format(due);
  const state = due < now ? 'late' : due - now < 2 * 3_600_000 ? 'soon' : '';
  let text;
  if (days === 0) text = short ? time : `Hari ini ${time}`;
  else if (days === 1) text = short ? 'Besok' : `Besok ${time}`;
  else if (days === -1) text = short ? 'Kemarin' : `Kemarin ${time}`;
  else if (days > 1 && days < 7) text = short ? DUE_WEEKDAY.format(due) : `${DUE_WEEKDAY.format(due)} ${time}`;
  else text = DUE_DATE.format(due);
  if (state === 'late' && !short) text = `Terlambat · ${text}`;
  return { text, state };
}

const dueAt = (dayOffset, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};
const two = (n) => String(n).padStart(2, '0');
const localDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
const localTime = (ms) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

// Editor tenggat di dalam panel (tanpa popup tanggal bawaan: popup bisa mencuri fokus dan menutup panel).
let dueEditor = null;
function closeDueEditor() {
  dueEditor?.remove();
  dueEditor = null;
}

function openDueEditor(after, current, onPick) {
  const reopen = dueEditor?.previousElementSibling === after;
  closeDueEditor();
  if (reopen) return;
  const box = document.createElement('div');
  box.className = 'due-editor';
  const monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  const quick = [
    ['Hari ini 17.00', dueAt(0, 17)],
    ['Besok 09.00', dueAt(1, 9)],
    ['Besok 17.00', dueAt(1, 17)],
    ['Senin 09.00', monday.getTime()],
  ].filter(([, ms]) => ms > Date.now());
  const chips = document.createElement('div');
  chips.className = 'due-chips';
  for (const [label, ms] of quick) {
    chips.append(
      actionChip(label, () => {
        closeDueEditor();
        onPick(ms);
      }),
    );
  }
  const row = document.createElement('div');
  row.className = 'due-custom';
  const base = current ?? dueAt(0, 17);
  const date = Object.assign(document.createElement('input'), { type: 'date', value: localDate(base) });
  const time = Object.assign(document.createElement('input'), { type: 'time', value: localTime(base) });
  const save = actionChip(
    'Pasang',
    () => {
      const ms = new Date(`${date.value}T${time.value || '17:00'}:00`).getTime();
      if (!Number.isFinite(ms)) return;
      closeDueEditor();
      onPick(ms);
    },
    { primary: true },
  );
  row.append(date, time, save);
  box.append(chips, row);
  if (current) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'link due-clear';
    clear.textContent = 'Tanpa tenggat';
    clear.addEventListener('click', () => {
      closeDueEditor();
      onPick(null);
    });
    box.append(clear);
  }
  after.after(box);
  dueEditor = box;
}

const DUE_ICON = '<svg viewBox="0 0 12 12"><circle cx="6" cy="6.4" r="4.2" /><path d="M6 4.3v2.2l1.4.9" /></svg>';

function dueChip(todo) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'due-chip';
  chip.innerHTML = DUE_ICON;
  if (todo.due) {
    const { text, state } = dueLabel(todo.due);
    chip.append(text);
    if (state) chip.classList.add(state);
    chip.title = 'Ubah tenggat';
  } else {
    chip.classList.add('empty');
    chip.title = 'Pasang tenggat';
  }
  chip.setAttribute('aria-label', chip.title);
  return chip;
}

// ---------- Kalender bulanan ----------
// Titik per hari: acara kalender (biru), tenggat tugas (kuning), pengingat (ungu). Klik hari = daftar isinya.
let reminderList = [];
let calMonth = (() => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
})();
let calSelected = dayStart(Date.now());
// Bawaan: satu baris minggu ini (padat). "Bulan" = tampilan sebulan penuh.
let calMonthView = false;
const CAL_RANGE = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
const CAL_TITLE = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const CAL_DAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
const CAL_WEEK = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

// Isi satu hari: [{ kind: 'event'|'todo'|'reminder', time (ms|null), title, late? }]
function calItems(day) {
  const end = day + 86_400_000;
  const items = [];
  for (const e of calendarEvents ?? []) {
    if (e.start < end && e.end > day) items.push({ kind: 'event', time: e.allDay ? null : e.start, title: e.title });
  }
  for (const t of todoItems) {
    if (!t.done && t.due >= day && t.due < end) items.push({ kind: 'todo', time: t.due, title: t.text, late: t.due < Date.now() });
  }
  const weekday = new Date(day).getDay();
  for (const r of reminderList) {
    const first = dayStart(r.next);
    const on = r.repeat === 'daily' ? day >= first : r.repeat === 'weekdays' ? day >= first && weekday > 0 && weekday < 6 : day === first;
    if (!on) continue;
    const d = new Date(r.next);
    items.push({ kind: 'reminder', time: new Date(day).setHours(d.getHours(), d.getMinutes(), 0, 0), title: r.title });
  }
  return items.sort((a, b) => (a.time ?? -1) - (b.time ?? -1));
}

// Senin dari minggu yang berisi tanggal terpilih.
const weekStart = (ms) => {
  const d = new Date(ms);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayStart(d.getTime());
};
const addDays = (ms, n) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

function renderCalendar() {
  const grid = $('cal-grid');
  grid.replaceChildren();
  grid.classList.toggle('week', !calMonthView);
  $('cal-mode').textContent = calMonthView ? 'Minggu' : 'Bulan';
  $('cal-mode').setAttribute('aria-pressed', String(calMonthView));
  for (const name of CAL_WEEK) {
    const head = document.createElement('span');
    head.className = 'cal-wd';
    head.textContent = name;
    grid.append(head);
  }
  const today = dayStart(Date.now());
  let list;
  if (calMonthView) {
    $('cal-title').textContent = CAL_TITLE.format(calMonth);
    const lead = (calMonth.getDay() + 6) % 7; // Senin = kolom pertama
    for (let i = 0; i < lead; i++) grid.append(document.createElement('span'));
    const count = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    list = Array.from({ length: count }, (_, i) => new Date(calMonth.getFullYear(), calMonth.getMonth(), i + 1).getTime());
  } else {
    const start = weekStart(calSelected);
    list = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    $('cal-title').textContent = `${CAL_RANGE.format(list[0])} – ${CAL_RANGE.format(list[6])}`;
  }
  for (const day of list) {
    const n = new Date(day).getDate();
    const items = calItems(day);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    cell.classList.toggle('today', day === today);
    cell.classList.toggle('picked', day === calSelected);
    cell.classList.toggle('past', day < today);
    cell.setAttribute('aria-label', `${CAL_DAY.format(day)}${items.length ? `, ${items.length} agenda` : ''}`);
    const num = document.createElement('b');
    num.textContent = String(n);
    const dots = document.createElement('i');
    for (const kind of ['event', 'todo', 'reminder']) {
      if (items.some((x) => x.kind === kind)) {
        const dot = document.createElement('span');
        dot.className = `k-${kind}`;
        dots.append(dot);
      }
    }
    cell.append(num, dots);
    cell.addEventListener('click', () => {
      calSelected = day;
      renderCalendar();
    });
    grid.append(cell);
  }
  renderCalendarDay();
}

function renderCalendarDay() {
  const list = $('cal-day');
  list.replaceChildren();
  const items = calItems(calSelected);
  const head = document.createElement('li');
  head.className = 'cal-day-head';
  head.textContent = CAL_DAY.format(calSelected);
  list.append(head);
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'dim';
    li.textContent = calendarEvents === null ? 'Kosong. Sambungkan kalender di Pengaturan › Kalender untuk melihat acaramu.' : 'Tidak ada acara, tenggat, atau pengingat.';
    list.append(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = `cal-item k-${item.kind}${item.late ? ' late' : ''}`;
    const time = document.createElement('b');
    time.textContent = item.time === null ? 'Seharian' : DUE_TIME.format(item.time);
    const title = document.createElement('span');
    title.textContent = item.title;
    const kind = document.createElement('small');
    kind.textContent = item.kind === 'event' ? 'Acara' : item.kind === 'todo' ? (item.late ? 'Terlambat' : 'Tenggat') : 'Pengingat';
    li.append(time, title, kind);
    list.append(li);
  }
}

// ‹ › pindah satu minggu (tampilan minggu) atau satu bulan (tampilan bulan).
const shiftMonth = (delta) => {
  if (calMonthView) calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
  else {
    calSelected = addDays(calSelected, 7 * delta);
    const d = new Date(calSelected);
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  renderCalendar();
};
$('cal-mode').addEventListener('click', () => {
  calMonthView = !calMonthView;
  const d = new Date(calSelected);
  calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
});
$('cal-prev').addEventListener('click', () => shiftMonth(-1));
$('cal-next').addEventListener('click', () => shiftMonth(1));
$('cal-today').addEventListener('click', () => {
  const d = new Date();
  calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  calSelected = dayStart(d.getTime());
  renderCalendar();
});

function renderTodos() {
  const list = $('todo-list');
  closeDueEditor();
  renderCalendar();
  renderRings();
  list.replaceChildren();
  const open = todoItems.filter((t) => !t.done).sort(byDue);
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

    if (todo.done) row.append(check, text, close);
    else {
      const due = dueChip(todo);
      due.addEventListener('click', () => openDueEditor(row, todo.due ?? null, (ms) => window.kapsul.todo('due', { id: todo.id, due: ms })));
      row.append(check, text, due, close);
    }
    list.append(row);
  }
}

// Tenggat untuk tugas yang sedang ditulis (tombol jam di sebelah kolom tulis).
let newTodoDue = null;
function renderNewTodoDue() {
  const button = $('todo-due');
  button.classList.toggle('set', Boolean(newTodoDue));
  button.classList.toggle('empty', !newTodoDue);
  button.innerHTML = DUE_ICON;
  if (newTodoDue) button.append(dueLabel(newTodoDue).text);
  button.title = newTodoDue ? 'Ubah tenggat' : 'Pasang tenggat';
  button.setAttribute('aria-label', button.title);
}
$('todo-due').addEventListener('click', () =>
  openDueEditor($('todo-form'), newTodoDue, (ms) => {
    newTodoDue = ms;
    renderNewTodoDue();
    $('todo-input').focus();
  }),
);
renderNewTodoDue();

$('todo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('todo-input');
  if (!input.value.trim()) return;
  window.kapsul.todo('add', { text: input.value, due: newTodoDue });
  input.value = '';
  newTodoDue = null;
  renderNewTodoDue();
  closeDueEditor();
});

window.kapsul.onTodos((items) => {
  todoItems = items ?? [];
  renderTodos();
  renderTodoIsland();
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
  { id: 'time', label: 'Waktu & jadwal', sound: 'ticktock' },
  { id: 'music', label: 'Musik', sound: 'note' },
  { id: 'video', label: 'Video', sound: 'pop' },
  { id: 'inbox', label: 'Kotak masuk', sound: 'pop' },
  { id: 'focus', label: 'Fokus & timer', sound: 'tick' },
  { id: 'water', label: 'Minum air', sound: 'pop' },
  { id: 'chat', label: 'Chat', sound: 'pop' },
  { id: 'work', label: 'Kerja', sound: 'tick' },
  { id: 'device', label: 'Perangkat', sound: 'tick' },
];

// Cuaca hanya kalau kota sudah dipilih; Kerja saat Claude bekerja atau ada server/project dipantau.
function pageAvailable(page) {
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
  if (page === 'water') return waterRatio() >= 1 ? 'happy' : 'idle';
  if (page === 'focus') return focusState.running && focusState.phase !== 'focus' ? 'stretch' : 'focus';
  if (page === 'device') return systemNow?.online === false ? 'cry' : battery?.charging ? 'charging' : lowBattery() ? 'lowbat' : 'smug';
  if (page === 'inbox') return notifs.items.length ? 'surprised' : 'happy';
  if (page === 'work') return claudeWaiting() ? 'surprised' : claudeBusy() ? (claudeState.active[0]?.state === 'thinking' ? 'think' : 'work') : 'focus';
  return 'idle';
}

const sectionIndex = (id) => PAGES.findIndex((p) => p.id === id);
const goToSection = (id, options) => goToPage(sectionIndex(id), options);

// Section yang tidak sedang dibuka "tidur": tidak di-layout, digambar, atau dianimasikan (content-visibility,
// lihat style.css .asleep). Section lama baru tidur setelah animasi geser selesai.
let sleepTimer = null;
function sleepSections() {
  for (const track of [$('hero-track'), $('deck-track')]) {
    for (const [i, el] of [...track.children].entries()) el.classList.toggle('asleep', i !== pageIndex);
  }
}
function wakeSection(index) {
  for (const track of [$('hero-track'), $('deck-track')]) track.children[index]?.classList.remove('asleep');
}

function placeTracks(offsetPx = 0) {
  const x = `translateX(calc(${-pageIndex * 100}% + ${offsetPx}px))`;
  $('hero-track').style.transform = x;
  $('deck-track').style.transform = x;
}

// Baris section terlalu panjang = bisa digeser; tepi memudar sebagai petunjuk.
function updateNavFade() {
  const nav = $('nav');
  nav.classList.toggle('overflow', nav.scrollWidth > nav.clientWidth + 1);
  nav.classList.toggle('scrolled', nav.scrollLeft > 2);
}
$('nav').addEventListener('scroll', updateNavFade, { passive: true });
$('nav').addEventListener('wheel', (event) => {
  if (!event.deltaY || $('nav').scrollWidth <= $('nav').clientWidth) return;
  event.preventDefault();
  $('nav').scrollLeft += event.deltaY;
}, { passive: false });
new ResizeObserver(updateNavFade).observe($('nav'));

function goToPage(index, { sound = true } = {}) {
  let next = (index + PAGES.length) % PAGES.length;
  const step = index < pageIndex ? -1 : 1;
  for (let i = 0; i < PAGES.length && !pageAvailable(PAGES[next]); i++) next = (next + step + PAGES.length) % PAGES.length;
  const changed = next !== pageIndex;
  pageIndex = next;
  wakeSection(next);
  clearTimeout(sleepTimer);
  if (changed) sleepTimer = setTimeout(sleepSections, 450);
  else sleepSections();
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
  // Tab aktif selalu terlihat walau baris section digeser.
  queueMicrotask(() => {
    const tab = $('nav').querySelector('[aria-selected="true"]');
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateNavFade();
  });
  for (const [i, dot] of [...$('hero-dots').children].entries()) {
    dot.setAttribute('aria-selected', String(i === next));
    dot.hidden = !pageAvailable(PAGES[i]);
  }
  // Isi section lain tidak bisa difokus dengan Tab (tetap ada di DOM untuk animasi geser).
  for (const [i, pane] of [...$('deck-track').children].entries()) pane.inert = i !== next;
  for (const [i, page] of [...$('hero-track').children].entries()) page.inert = i !== next;
  applyCostume();
  renderPage();
  // Ditunda: goToPage juga dipanggil saat skrip baru dimuat (sebelum state lirik dideklarasikan).
  queueMicrotask(renderIslandLyrics);
  if (changed) {
    bigBuddy.morph();
    if (sound) {
      sfx('swipe');
      setTimeout(() => sfx(PAGES[next].sound), 140);
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
  // "Selamat Pagi Kang"
  $('greet-name').textContent = `Selamat ${period.charAt(0).toUpperCase()}${period.slice(1)}${firstName ? ` ${firstName}` : ''}`;
  renderQuickApps();
  renderPet();
  // Ditunda: renderHome juga terpanggil saat skrip dimuat, sebelum state section lain dideklarasikan.
  queueMicrotask(renderWeather);
  queueMicrotask(renderHomeDevices);
  queueMicrotask(renderOverview);
}


// 4 aplikasi pertama sebagai "dadu" 2×2: tiap beberapa detik keempatnya bergeser searah jarum jam
// (aplikasi ke-5 dst. ikut bergiliran masuk). Kotak dibangun ulang hanya saat daftar aplikasi berubah.
const DICE_CELLS = [[0, 0], [1, 0], [1, 1], [0, 1]]; // kiri atas → kanan atas → kanan bawah → kiri bawah
const DICE_STEP = 19.5; // lebar kotak 17,5px + celah 2px (style.css .home-dice)
let diceKey = null;
let diceTiles = [];
let diceTurn = 0;

function renderQuickApps() {
  const box = $('quick-apps');
  const apps = launcherApps.slice(0, Math.max(4, QUICK_APPS));
  const key = apps.map((a) => `${a.index}:${a.name}:${a.icon ? 1 : 0}`).join('|');
  if (key === diceKey) return;
  diceKey = key;
  diceTurn = 0;
  box.replaceChildren();
  diceTiles = [];
  if (!apps.length) {
    box.classList.add('empty');
    box.append(actionChip('+ Aplikasi', () => window.kapsul.openSettings('apps'), { title: 'Tambah aplikasi favorit' }));
    return;
  }
  box.classList.remove('empty');
  diceTiles = apps.map((item) => {
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
    return button;
  });
  placeDice(false);
}

// Posisi tiap aplikasi pada giliran sekarang; yang tidak kebagian kotak menunggu (tersembunyi).
function placeDice(animate = true) {
  const n = diceTiles.length;
  diceTiles.forEach((tile, i) => {
    const slot = (i + diceTurn) % Math.max(4, n);
    const cell = DICE_CELLS[slot];
    tile.classList.toggle('no-anim', !animate);
    tile.classList.toggle('away', !cell);
    if (cell) tile.style.translate = `${cell[0] * DICE_STEP}px ${cell[1] * DICE_STEP}px`;
    tile.tabIndex = cell ? 0 : -1;
  });
}

setInterval(() => {
  if (!open || PAGES[pageIndex]?.id !== 'home' || diceTiles.length < 2) return;
  if ($('quick-apps').matches(':hover, :focus-within')) return;
  diceTurn = (diceTurn + 1) % Math.max(4, diceTiles.length);
  placeDice(true);
}, 3200);

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
$('ti-edit').addEventListener('click', () => setDetail(true));

// ---------- Island Tugas: progres hari ini + daftar centang ----------
const TI_DATE = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

function renderTodoIsland() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const open = todoItems.filter((t) => !t.done).sort(byDue);
  const doneToday = todoItems.filter((t) => t.done && (t.doneAt ?? 0) >= today).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const total = open.length + doneToday.length;
  $('ti-done').textContent = String(doneToday.length);
  $('ti-total').textContent = `/${total}`;
  $('ti-ring-bar').style.strokeDashoffset = String(100 - (total ? (100 * doneToday.length) / total : 0));
  $('ti-time').textContent = timeFormat.format(now).replace('.', ':');

  // Rapat ≤ 2 jam lagi menggantikan tanggal (klik = gabung / buka jadwal).
  const meeting = nextMeeting(now.getTime());
  const soon = meeting && meeting.start - now.getTime() < 2 * 3_600_000;
  const date = $('ti-date');
  date.classList.toggle('meeting', Boolean(soon));
  date.textContent = soon ? `${meeting.title} · ${eventTime(meeting, now.getTime())}` : TI_DATE.format(now);
  date.title = soon ? (meeting.link ? 'Gabung rapat' : 'Lihat jadwal') : 'Lihat jadwal';
  date.onclick = soon && meeting.link ? () => window.kapsul.meeting(meeting.link) : () => setDetail(true);

  const list = $('ti-list');
  list.replaceChildren();
  if (!total) {
    const li = document.createElement('li');
    li.className = 'ti-empty';
    li.textContent = 'Belum ada tugas hari ini.';
    list.append(li);
    return;
  }
  for (const todo of [...open, ...doneToday]) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ti-item${todo.done ? ' done' : ''}`;
    b.setAttribute('aria-pressed', String(todo.done));
    b.title = todo.done ? 'Tandai belum selesai' : 'Tandai selesai';
    b.innerHTML = '<span class="ti-check"><svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg></span>';
    const text = document.createElement('span');
    text.className = 'ti-text';
    text.textContent = todo.text;
    b.append(text);
    if (todo.due && !todo.done) {
      const { text: label, state } = dueLabel(todo.due, { short: true });
      const due = document.createElement('span');
      due.className = `ti-due${state ? ` ${state}` : ''}`;
      due.textContent = label;
      b.append(due);
      b.title = `Tenggat ${dueLabel(todo.due).text} · klik untuk tandai selesai`;
    }
    b.addEventListener('click', () => {
      if (!todo.done) {
        react('happy', 1200);
        sfx('tick');
      }
      window.kapsul.todo('toggle', { id: todo.id });
    });
    li.append(b);
    list.append(li);
  }
}

// Kalimat santai di bawah sapaan Beranda, sesuai cuaca sekarang.
function weatherLine(w) {
  const night = w.isDay === false;
  if (w.kind === 'storm') return 'Ada petir, di dalam aja dulu';
  if (w.kind === 'rain') return /gerimis/i.test(w.text) ? 'Gerimis nih, sedia payung ya' : 'Hujan nih, sedia payung ya';
  if (w.kind === 'fog') return 'Berkabut, hati-hati di jalan';
  if (!night && w.temperature >= 33) return 'Panas banget hari ini, banyak minum ya';
  if (w.kind === 'clear') return night ? 'Langit cerah malam ini' : 'Cuaca cerah nih hari ini';
  if (/cerah/i.test(w.text)) return night ? 'Sedikit berawan malam ini' : 'Agak berawan, tetap nyaman';
  return night ? 'Berawan malam ini' : 'Berawan nih hari ini';
}

function renderWeather() {
  const w = weatherNow;
  $('home-wx').hidden = !w;
  $('home-wx-badge').hidden = !w;
  if (!w) return;
  // Kartu atas Beranda: ikon + suhu + kondisi singkat.
  const badgeKey = `${w.kind}|${w.isDay}`;
  if ($('hw-icon').dataset.key !== badgeKey) {
    $('hw-icon').dataset.key = badgeKey;
    $('hw-icon').innerHTML = weatherSvg(w.kind, { day: w.isDay !== false, mini: true });
  }
  $('hw-temp').textContent = `${w.temperature}°`;
  $('hw-cond').textContent = weatherLine(w);
  $('home-wx-badge').title = [w.text, w.city, w.max != null ? `${w.min}°–${w.max}°` : '', w.advice?.[0]?.text].filter(Boolean).join(' · ');
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
  // Tanpa prakiraan per jam (cuma titik "Kini"): grafik tidak digambar.
  box.hidden = points.length < 2;
  if (points.length < 2) return;
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

// Timer cepat yang tampil di kartu Fokus & kapsul (hanya saat tidak ada sesi fokus/istirahat).
const activeTimer = () => (focusState.phase ? null : (quickTimers[0] ?? null));

function renderFocusSummary() {
  const { phase, running, cycle } = focusState;
  const timer = activeTimer();
  const total = focusTotal();
  const remaining = Math.max(0, focusRemaining());
  const waiting = Boolean(phase) && !running && remaining >= total - 1000;
  const card = $('focus-island');
  card.classList.toggle('idle', !phase && !timer);
  card.classList.toggle('running', running || Boolean(timer));
  card.classList.toggle('rest', phase === 'break' || phase === 'long');
  card.classList.toggle('paused', Boolean(phase) && !running);

  $('focus-sum-title').textContent = timer
    ? timer.label
    : !phase
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
  const key = `${phase}|${running}|${waiting}|${pickedMinutes()}|${timer?.id ?? ''}`;
  if (key === focusCardKey) return;
  focusCardKey = key;
  const box = $('focus-card-actions');
  box.replaceChildren();
  const act = (action, minutes) => () => window.kapsul.focus(action, minutes);
  const round = (icon, title, onClick, primary = false) => actionChip('', onClick, { icon, title, primary, round: true });
  if (timer) {
    // Timer berjalan: batalkan, atau ulang dari awal dengan durasi yang sama.
    box.append(
      round('stop', 'Batalkan timer', () => window.kapsul.timer('cancel', { id: timer.id }), true),
      actionChip('Ulang', () => {
        window.kapsul.timer('cancel', { id: timer.id });
        window.kapsul.timer('start', { ms: timer.total, label: timer.label });
      }, { icon: 'reset', title: 'Ulang timer dari awal' }),
      actionChip(`Fokus ${pickedMinutes()}m`, act('focus', pickedMinutes()), { icon: 'play', title: `Mulai fokus ${pickedMinutes()} menit` }),
    );
  } else if (!phase) {
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
// Kanan kartu Fokus: menit fokus hari ini (termasuk sesi yang sedang jalan) vs target harian,
// dan segmen sesi siklus ini (selesai = penuh, berjalan = terisi sesuai progres, berikutnya = abu).
function renderFocusStats(t, phase, done) {
  const cycles = Math.max(1, focusSettings.cycles || 4);
  const goal = Math.max(1, focusSettings.focusMinutes * cycles);
  const live = phase === 'focus' ? done * (focusTotal() / 60_000) : 0;
  const minutes = Math.floor((t.focusMs ?? 0) / 60_000 + live);
  const ratio = Math.min(1, minutes / goal);
  $('fs-bar').style.strokeDasharray = `${(ratio * 100).toFixed(2)} 100`;
  // Ujung garis bulat tetap menggambar titik di 0%: sembunyikan sampai ada menit fokus.
  $('fs-bar').style.opacity = ratio > 0 ? '1' : '0';
  $('fs-pct').textContent = String(minutes);
  $('fs-min').textContent = String(minutes);
  $('fs-goal').textContent = `/ ${goal} mnt`;

  const box = $('fs-cycle');
  if (box.children.length !== cycles) box.replaceChildren(...Array.from({ length: cycles }, () => document.createElement('i')));
  // Sesi selesai di siklus ini: sebelum sesi berjalan = cycle − 1; saat istirahat = cycle.
  const finished = !phase ? Math.min(cycles, t.focus ?? 0) : phase === 'focus' ? focusState.cycle - 1 : focusState.cycle;
  [...box.children].forEach((seg, i) => {
    const fill = i < finished ? 1 : phase === 'focus' && i === finished ? done : 0;
    seg.style.setProperty('--fill', `${(fill * 100).toFixed(1)}%`);
    seg.classList.toggle('now', phase === 'focus' && i === finished);
  });
  const label = !phase ? `${t.focus ?? 0} sesi hari ini` : `Sesi ${Math.min(cycles, focusState.cycle)} dari ${cycles}`;
  $('fs-label').textContent = label;
  box.parentElement.title = `${minutes} dari ${goal} menit fokus hari ini · ${label}`;
}

function tickFocusIsland() {
  const t = statsToday ?? {};
  const { phase, running } = focusState;
  const timer = activeTimer();
  const timerLeft = timer ? Math.max(0, timer.endsAt - Date.now()) : 0;
  const total = phase ? focusTotal() : timer ? timer.total || timerLeft || 1 : pickedMinutes() * 60_000;
  const remaining = phase ? Math.max(0, focusRemaining()) : timer ? timerLeft : total;
  const done = phase || timer ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
  $('focus-line-bar').style.width = `${(done * 100).toFixed(2)}%`;
  $('focus-island').classList.toggle('final', phase === 'focus' && running && remaining < 60_000);

  const time = phase || timer ? clock(remaining) : `${pickedMinutes()}:00`;
  if ($('focus-sum-time').textContent !== time) $('focus-sum-time').textContent = time;
  // Angka hitung mundur tampil di layar Zeno besar (section Fokus).
  if (PAGES[pageIndex]?.id === 'focus') {
    const tone = timer ? (remaining < 10_000 ? 'final' : 'run') : !phase ? 'idle' : !running ? 'paused' : phase !== 'focus' ? 'rest' : remaining < 60_000 ? 'final' : 'run';
    bigBuddy.setDisplay(time, done, tone);
  }

  renderFocusStats(t, phase, done);

  let sub = timer
    ? `selesai ${endTime.format(timer.endsAt)}${quickTimers.length > 1 ? ` · +${quickTimers.length - 1} timer lain` : ''}`
    : !phase
      ? `${t.focus ?? 0} sesi selesai hari ini`
      : running
        ? `selesai ${endTime.format(Date.now() + remaining)}`
        : 'Tekan ▶ untuk lanjut';
  // Sesi fokus berjalan + ada timer cepat: timernya tetap disebut di subjudul.
  if (phase && quickTimers[0]) sub += ` · ⏱ ${clock(quickTimers[0].endsAt - Date.now())}`;
  if ($('focus-sum-sub').textContent !== sub) $('focus-sum-sub').textContent = sub;
}

function renderDeviceTop() {
  const box = $('device-battery');
  box.hidden = !battery || !hasBattery;
  if (battery && hasBattery) {
    const percent = Math.round(battery.level * 100);
    $('device-bat-fill').style.width = `${Math.max(4, percent)}%`;
    $('device-bat-percent').textContent = `${percent}%`;
    // Kotak kecil: cukup "mengisi" / sisa waktu; rinciannya di tooltip.
    $('device-bat-state').textContent = battery.charging ? ' · isi' : '';
    box.title = battery.charging
      ? `Mengisi${Number.isFinite(battery.chargingTime) && battery.chargingTime > 0 ? `, penuh ±${durationText(battery.chargingTime)}` : ''}`
      : Number.isFinite(battery.dischargingTime) && battery.dischargingTime > 0
        ? `Cukup ±${durationText(battery.dischargingTime)}`
        : 'Pakai baterai';
    box.classList.toggle('charging', battery.charging);
    box.classList.toggle('low', lowBattery());
  }
  renderHomeDevices();
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
  else if (page === 'music') {
    renderLyrics();
    queueMicrotask(renderIslandLyrics);
  }
  else if (page === 'time') {
    renderClock(now);
    renderTimeCard();
    queueMicrotask(renderTodoIsland);
    renderAgenda();
    renderHabits();
  }
  else if (page === 'focus') renderFocusSummary();
  else if (page === 'water') renderWaterPage();
  else if (page === 'device') renderDeviceTop();
  else if (page === 'inbox') renderInboxSummary();
  else if (page === 'work') renderClaudeCard();
}

setInterval(() => {
  if (open && PAGES[pageIndex].id === 'music') renderMusicProgress();
  if (open && PAGES[pageIndex].id === 'time') {
    renderClock(new Date());
    if (new Date().getSeconds() === 0) {
      renderTimeCard();
      renderTodoIsland();
    }
  }
  if (open && PAGES[pageIndex].id === 'focus' && !focusState.running) renderFocusSummary();
}, 1000);

// ---------- Kostum, cuaca & baterai ----------

let weatherNow = null;

let seasonalCostume = null;

function applyCostume() {
  peekBuddy.setCostume(seasonalCostume);
  // Slide cuaca di kapsul: payung / kacamata hitam sebentar.
  buddy.setCostume((centered ? null : pillSlide?.costume) ?? seasonalCostume);
  const onWeather = false; // cuaca kini di detail Beranda, Zeno besar tidak ganti kostum
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

// Beranda: kotak baterai per perangkat. Laptop ini dulu, lalu Bluetooth / USB / flashdisk.
// Cincin = sisa baterai (flashdisk: ruang terpakai); merah saat baterai ≤ 20%.
const LAPTOP_ICON = '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="7.5" rx="1.4" /><path d="M1.5 13h13" /></svg>';

function renderHomeDevices() {
  const box = $('home-devs');
  if (!box) return;
  const tiles = [];
  if (battery && hasBattery) {
    const pct = Math.round(battery.level * 100);
    tiles.push({ name: 'Laptop ini', icon: LAPTOP_ICON, bat: true, ratio: pct / 100, value: `${pct}%`, low: pct <= 20 && !battery.charging, charging: battery.charging });
  }
  for (const d of connectedDevices.bluetooth) {
    const kind = d.kind === 'input' ? 'mouse' : d.kind;
    tiles.push({ name: d.name, icon: DEVICE_ICONS[kind] ?? DEVICE_ICONS.other, bat: d.battery != null, ratio: d.battery != null ? d.battery / 100 : null, value: d.battery != null ? `${d.battery}%` : 'Tersambung', low: d.battery != null && d.battery <= 20 });
  }
  for (const d of connectedDevices.usb.filter((x) => x.kind !== 'storage')) {
    tiles.push({ name: d.name, icon: DEVICE_ICONS[d.kind] ?? DEVICE_ICONS.other, bat: d.battery != null, ratio: d.battery != null ? d.battery / 100 : null, value: d.battery != null ? `${d.battery}%` : 'USB' });
  }
  for (const d of connectedDevices.drives) {
    const used = d.size ? 1 - d.free / d.size : null;
    tiles.push({ name: d.name || `Drive ${d.letter}`, icon: DEVICE_ICONS.storage, ratio: used, value: bytesText(d.free), note: 'kosong' });
  }
  $('home-dev-count').textContent = tiles.length > 1 ? `${tiles.length}` : '';
  // Kartu atas Beranda: maksimal 3 perangkat yang punya info baterai, ikon + persen.
  const chips = $('hw-devs');
  chips.replaceChildren();
  for (const t of tiles.filter((x) => x.bat).slice(0, 3)) {
    const chip = document.createElement('span');
    chip.className = `hw-dev${t.low ? ' low' : ''}`;
    chip.title = `${t.name}: ${t.value}${t.charging ? ' · mengisi' : ''}`;
    chip.innerHTML = t.icon;
    chip.append(t.value);
    chips.append(chip);
  }
  box.replaceChildren();
  if (!tiles.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Belum ada perangkat Bluetooth atau USB yang tersambung.';
    box.append(empty);
    return;
  }
  for (const t of tiles.slice(0, 8)) {
    const tile = document.createElement('div');
    tile.className = `home-dev${t.low ? ' low' : ''}${t.charging ? ' charging' : ''}`;
    tile.title = `${t.name}: ${t.value}${t.note ? ` ${t.note}` : ''}${t.charging ? ' · mengisi' : ''}`;
    const ring = document.createElement('span');
    ring.className = 'home-dev-ring';
    const svg = svgEl('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
    ringMeter(svg, t.ratio ?? 0, '');
    svg.removeAttribute('aria-label');
    if (t.ratio == null) svg.classList.add('none');
    const icon = document.createElement('span');
    icon.className = 'home-dev-icon';
    icon.innerHTML = t.icon;
    ring.append(svg, icon);
    const name = document.createElement('span');
    name.className = 'home-dev-name';
    name.textContent = t.name;
    const value = document.createElement('b');
    value.textContent = t.value;
    tile.append(ring, value, name);
    box.append(tile);
  }
}

window.kapsul.onDevices((state) => {
  connectedDevices = { bluetooth: state?.bluetooth ?? [], usb: state?.usb ?? [], drives: state?.drives ?? [] };
  renderDeviceList();
  renderHomeDevices();
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
  // Selama diseret, jenis file sudah terbaca (bukan isinya): semua gambar = nanti tanya mau dipakai untuk apa.
  const onlyImages = (event) => {
    const items = [...(event.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
    return items.length > 0 && items.every((i) => i.type.startsWith('image/'));
  };
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
    const images = onlyImages(event);
    if (!images) goToSection('chat', { sound: false });
    $('drop-hint-text').textContent = images ? 'Lepas gambarnya, lalu pilih: wallpaper atau chat' : 'Lepas di sini, biar Zeno melahapnya 😋';
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
    const files = [...event.dataTransfer.files];
    const point = { x: event.clientX, y: event.clientY };
    if (files.length && files.every((f) => f.type.startsWith('image/'))) askDropTarget(files, point);
    else attachFiles(files, point);
  });
})();

// Pilihan untuk gambar yang dilepas: wallpaper atau chat.
let dropFiles = null;
function askDropTarget(files, point) {
  dropFiles = { files, point };
  const thumbs = $('drop-thumbs');
  thumbs.replaceChildren();
  // Pratinjau lewat data URL (CSP island hanya mengizinkan gambar 'self' & data:).
  for (const file of files.slice(0, 3)) {
    const img = document.createElement('img');
    img.alt = '';
    thumbs.append(img);
    const reader = new FileReader();
    reader.onload = () => (img.src = reader.result);
    reader.readAsDataURL(file);
  }
  $('drop-choice-title').textContent = files.length > 1 ? `${files.length} gambar ini untuk apa?` : 'Gambar ini untuk apa?';
  $('drop-wallpaper').lastChild.textContent = files.length > 1 ? ' Tambah ke wallpaper' : ' Jadikan wallpaper';
  $('drop-choice').hidden = false;
  react('surprised', 900);
  $('drop-wallpaper').focus();
}

function closeDropChoice() {
  $('drop-choice').hidden = true;
  $('drop-thumbs').replaceChildren();
  dropFiles = null;
}

$('drop-wallpaper').addEventListener('click', () => {
  const picked = dropFiles;
  closeDropChoice();
  if (!picked) return;
  addWallpaperFiles(picked.files);
});
$('drop-chat').addEventListener('click', () => {
  const picked = dropFiles;
  closeDropChoice();
  if (!picked) return;
  goToSection('chat', { sound: false });
  attachFiles(picked.files, picked.point);
});
$('drop-cancel').addEventListener('click', closeDropChoice);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('drop-choice').hidden) closeDropChoice();
});

// ---------- Gambar dilepas → wallpaper ----------
// Koleksi & slideshow ada di Pengaturan › Wallpaper; dari island cukup tambahkan & langsung pasang.
async function addWallpaperFiles(files) {
  let added = 0;
  for (const file of [...files].filter((f) => f.type.startsWith('image/')).slice(0, 10)) {
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    const state = dataUrl ? await window.kapsul.wallpaperAdd(dataUrl) : null;
    if (state && !state.error) added++;
  }
  if (added) {
    react('happy', 1500);
    sfx('pop');
  } else react('confused', 1500);
}

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

// ---------- Detail Fokus: analisa hari ini & 7 hari ----------
// Warna per metrik tetap (palet tervalidasi di latar panel, lihat style.css --an-*): fokus, minum, tugas.
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const WEEKDAY_LONG = new Intl.DateTimeFormat('id-ID', { weekday: 'long' });
const dayName = (key) => (key ? WEEKDAY_LONG.format(new Date(`${key}T12:00`)) : 'Hari ini');

function todayTodos() {
  const start = dayStart(Date.now());
  const done = todoItems.filter((t) => t.done && (t.doneAt ?? 0) >= start).length;
  const open = todoItems.filter((t) => !t.done).length;
  return { done, total: done + open };
}

// Satu cincin (monokrom): menit fokus hari ini terhadap target (lama fokus × sesi per siklus).
function ringMeter(svg, ratio, label) {
  svg.replaceChildren();
  const r = 50;
  const len = 2 * Math.PI * r;
  svg.append(svgEl('circle', { class: 'ring-track', cx: 60, cy: 60, r }));
  const bar = svgEl('circle', { class: 'ring-bar', cx: 60, cy: 60, r });
  // Lewat style (bukan atribut): aturan .ring-bar lama di style.css memaksa stroke-dasharray.
  bar.style.strokeDasharray = `${(len * Math.min(1, Math.max(0, ratio))).toFixed(2)} ${len.toFixed(2)}`;
  svg.append(bar);
  svg.setAttribute('aria-label', label);
}

function renderRings() {
  const t = statsToday ?? {};
  const minutes = Math.round((t.focusMs ?? 0) / 60_000);
  const goal = Math.max(1, focusSettings.focusMinutes * focusSettings.cycles);
  const ratio = minutes / goal;
  ringMeter($('focus-rings'), ratio, `Fokus hari ini ${minutes} dari ${goal} menit`);
  $('rings-pct').textContent = `${Math.min(999, Math.round(ratio * 100))}%`;
  $('kpi-min').textContent = String(minutes);
  $('kpi-sessions').textContent = String(t.focus ?? 0);
}

// Bar 7 hari + garis rata-rata; label nilai hanya hari ini & hari terbaik; tooltip per batang.
// opts: value(d) → angka, label(n) → teks nilai, tip(d, n) → teks tooltip.
function renderFocusBars(days) {
  return renderBars($('focus-bars'), days, {
    value: (d) => Math.round((d.focusMs ?? 0) / 60_000),
    label: (n) => String(n),
    tip: (d, n) => `${n} menit · ${d.focus ?? 0} sesi`,
    floor: 30,
  });
}

function renderBars(box, days, { value, label: labelText, tip: tipText, floor = 1, mini = false }) {
  box.replaceChildren();
  const minutes = days.map(value);
  const max = Math.max(floor, ...minutes);
  const avg = minutes.reduce((a, b) => a + b, 0) / Math.max(1, minutes.length);
  const best = minutes.indexOf(Math.max(...minutes));
  const W = 300;
  const H = mini ? 62 : 86;
  const base = H - 20; // garis dasar (di bawahnya label hari)
  const top = 12;
  const slot = W / days.length;
  const bw = 18;
  const y = (m) => base - ((base - top) * m) / max;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bars-svg', role: 'img', 'aria-label': days.map((d, i) => `${dayName(d.key)}: ${tipText(d, minutes[i])}`).join(', ') });
  for (const frac of [0.5, 1]) svg.append(svgEl('line', { class: 'bars-grid', x1: 0, x2: W, y1: y(max * frac), y2: y(max * frac) }));
  svg.append(svgEl('line', { class: 'bars-base', x1: 0, x2: W, y1: base, y2: base }));
  const tip = document.createElement('div');
  tip.className = 'an-tip';
  tip.hidden = true;
  days.forEach((d, i) => {
    const cx = slot * i + slot / 2;
    const m = minutes[i];
    const h = Math.max(m ? 3 : 0, base - y(m));
    const today = i === days.length - 1;
    // Batang: ujung atas membulat 4px, menempel di garis dasar.
    if (h > 0) {
      const r = Math.min(4, h);
      const x0 = cx - bw / 2;
      const y0 = base - h;
      svg.append(svgEl('path', { class: `bar k-focus${today ? ' today' : ''}`, d: `M${x0} ${base}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}H${x0 + bw - r}Q${x0 + bw} ${y0} ${x0 + bw} ${y0 + r}V${base}Z` }));
    }
    // Label nilai hanya untuk hari ini & hari terbaik (bukan di setiap batang).
    if (m && (today || i === best)) {
      const label = svgEl('text', { class: 'bars-value', x: cx, y: base - h - 4, 'text-anchor': 'middle' });
      label.textContent = labelText(m);
      svg.append(label);
    }
    const day = svgEl('text', { class: `bars-day${today ? ' today' : ''}`, x: cx, y: H - 8, 'text-anchor': 'middle' });
    day.textContent = today ? 'Ini' : WEEKDAY.format(new Date(`${d.key}T12:00`));
    svg.append(day);
    // Area sentuh selebar kolom (lebih besar dari batangnya).
    const hit = svgEl('rect', { class: 'bars-hit', x: slot * i, y: 0, width: slot, height: base });
    hit.addEventListener('pointerenter', () => {
      tip.hidden = false;
      tip.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = today ? 'Hari ini' : dayName(d.key);
      tip.append(b, tipText(d, m));
      tip.style.left = `${(100 * cx) / W}%`;
      tip.style.top = `${(100 * Math.min(y(m), base - 10)) / H}%`;
    });
    hit.addEventListener('pointerleave', () => (tip.hidden = true));
    svg.append(hit);
  });
  if (avg > 0) {
    svg.append(svgEl('line', { class: 'bars-avg', x1: 0, x2: W, y1: y(avg), y2: y(avg) }));
    const label = svgEl('text', { class: 'bars-avg-label', x: 2, y: y(avg) - 4, 'text-anchor': 'start' });
    label.textContent = `rata-rata ${labelText(Math.round(avg))}`;
    svg.append(label);
  }
  box.append(svg, tip);
  return { minutes, avg, best };
}

// Satu kalimat kesimpulan: hari ini dibanding rata-rata 7 hari + hari terbaik.
function renderFocusInsight(days, { minutes, avg, best }) {
  const today = minutes[minutes.length - 1] ?? 0;
  const el = $('focus-insight');
  if (!minutes.some((m) => m > 0)) {
    el.textContent = 'Belum ada sesi fokus minggu ini.';
    return;
  }
  const diff = avg ? Math.round(((today - avg) / avg) * 100) : 0;
  const bestText = best === minutes.length - 1 ? 'hari ini' : dayName(days[best].key);
  el.textContent = today
    ? `${Math.abs(diff)}% ${diff >= 0 ? 'di atas' : 'di bawah'} rata-rata · terbaik ${bestText}`
    : `Rata-rata ${Math.round(avg)} menit/hari · terbaik ${bestText}`;
}

function renderFocusReport() {
  const t = statsToday ?? {};
  const days = statsWeek.length ? statsWeek : [{ key: '', focus: t.focus ?? 0, focusMs: t.focusMs ?? 0 }];
  const totalMin = days.reduce((sum, d) => sum + Math.round((d.focusMs ?? 0) / 60_000), 0);
  const sessions = days.reduce((sum, d) => sum + (d.focus ?? 0), 0);
  $('focus-week-total').textContent = `${totalMin} menit`;
  $('kpi-week').textContent = String(sessions);
  renderRings();
  renderFocusInsight(days, renderFocusBars(days));
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

// Donat waktu layar: 4 aplikasi terlama + "Lainnya" (abu-abu). Celah 2px antar irisan.
const SCREEN_SLOTS = ['#3987e5', 'rgba(57, 135, 229, 0.66)', 'rgba(57, 135, 229, 0.4)'];
function renderScreenDonut(today, svgId = 'screen-donut', legendId = 'screen-legend') {
  const svg = $(svgId);
  const legend = $(legendId);
  svg.replaceChildren();
  legend.replaceChildren();
  const total = today.totalMs || 0;
  const apps = (today.apps ?? []).filter((a) => a.ms >= 30_000);
  const top = apps.slice(0, 3);
  const rest = total - top.reduce((n, a) => n + a.ms, 0);
  const slices = top.map((a, i) => ({ name: a.name, ms: a.ms, color: SCREEN_SLOTS[i] }));
  if (rest >= 30_000) slices.push({ name: 'Lainnya', ms: rest, color: '#3f3f46' });
  const r = 46;
  const len = 2 * Math.PI * r;
  svg.append(svgEl('circle', { class: 'ring-track donut', cx: 60, cy: 60, r }));
  let offset = 0;
  for (const slice of slices) {
    const part = (len * slice.ms) / Math.max(total, 1);
    const gap = slices.length > 1 ? Math.min(2.5, part / 2) : 0;
    svg.append(svgEl('circle', { class: 'donut-slice', cx: 60, cy: 60, r, stroke: slice.color, 'stroke-dasharray': `${Math.max(0, part - gap).toFixed(2)} ${len.toFixed(2)}`, 'stroke-dashoffset': (-offset).toFixed(2) }));
    offset += part;
  }
  svg.setAttribute('aria-label', slices.length ? `Waktu layar hari ini: ${slices.map((x) => `${x.name} ${minutesText(x.ms)}`).join(', ')}` : 'Belum ada waktu layar hari ini');
  if (!slices.length) {
    const li = document.createElement('li');
    li.className = 'ring-empty';
    li.textContent = 'Zeno mencatat aplikasi yang kamu pakai (tanpa saat idle atau terkunci). Datanya hanya disimpan di laptop ini.';
    legend.append(li);
    return;
  }
  for (const slice of slices) {
    const li = document.createElement('li');
    const sw = document.createElement('i');
    sw.style.background = slice.color;
    const name = document.createElement('span');
    name.textContent = slice.name;
    name.title = slice.name;
    const value = document.createElement('b');
    value.textContent = minutesText(slice.ms);
    const pct = document.createElement('small');
    pct.textContent = `${Math.round((100 * slice.ms) / total)}%`;
    li.append(sw, name, value, pct);
    legend.append(li);
  }
}

function renderScreen() {
  const s = screenState ?? { today: { totalMs: 0, apps: [], count: 0 }, week: [], lastWeek: null };
  $('screen-total').textContent = s.today.totalMs >= 60_000 ? minutesText(s.today.totalMs) : '0 m';
  renderScreenDonut(s.today);

  const days = s.week.length ? s.week : [{ key: '', ms: s.today.totalMs }];
  const total = days.reduce((n, d) => n + (d.ms ?? 0), 0);
  $('screen-week-total').textContent = total >= 60_000 ? `${minutesText(total / days.length)} / hari` : '';
  renderBars($('screen-week'), days, {
    value: (d) => Math.round((d.ms ?? 0) / 60_000),
    label: (n) => (n >= 60 ? `${(n / 60).toLocaleString('id-ID', { maximumFractionDigits: 1 })} j` : `${n} m`),
    tip: (d) => `${minutesText(d.ms ?? 0)} waktu layar`,
    floor: 60,
    mini: true,
  });

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
  if (PAGES[pageIndex]?.id === 'home') renderOverview();
});

window.kapsul.onStats((data) => {
  statsToday = data?.today ?? null;
  petState = data?.pet ?? null;
  statsWeek = data?.week ?? [];
  statsMusic = data?.music ?? null;
  renderWater();
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
  const untilTomorrow = dayStart(now) + 2 * 86_400_000;
  const events = (calendarEvents ?? []).filter((e) => e.end > now && e.start < untilTomorrow).slice(0, 5);
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
  renderCalendar();
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
  $(id).style.strokeDasharray = `${Math.max(0, Math.min(100, percent ?? 0))} 100`;
  $(id).dataset.level = level; // dipakai teks peringatan, bukan warna meter
  $(`${id}-text`).textContent = text;
}

const loadLevel = (p) => (p == null ? 'ok' : p >= 90 ? 'high' : p >= 75 ? 'mid' : 'ok');

function renderSystem() {
  const s = systemNow;
  if (!s) return;
  const net = $('system-net');
  net.className = `system-net ${s.online === false ? 'off' : s.online ? 'on' : ''}`;
  // Status internet = titik kecil di tombol Wi-Fi (hijau online, merah putus), teks di tooltip.
  $('quick-wifi').dataset.net = s.online === false ? 'off' : s.online ? 'on' : '';
  $('quick-wifi').title = `Wi-Fi · ${s.online == null ? 'mengecek internet' : s.online ? `online${s.ms ? ` ${s.ms} ms` : ''}` : 'internet putus'}`;
  net.textContent = s.online == null ? 'Mengecek…' : s.online ? `Online${s.ms ? ` · ${s.ms} ms` : ''}` : 'Internet putus';
  bar('system-cpu', s.cpu, s.cpu != null ? `${s.cpu}%` : '–', loadLevel(s.cpu));
  bar('system-ram', s.memory?.percent, s.memory ? `${s.memory.percent}%` : '–', loadLevel(s.memory?.percent));
  const diskFree = s.disk ? 100 - s.disk.percent : null;
  $('system-disk-label').textContent = s.disk?.drive ? `Disk ${s.disk.drive}` : 'Disk';
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
  renderPillFocus();
  renderPillText();
});

renderFocus();
renderTimers();

setInterval(() => {
  if (!quickTimers.length) return;
  renderTimers();
  if (tickKey === 'timer' || tickKey === 'claude') renderPillText();
}, 1000);

// ---------- Zeno peliharaan ----------

// ---------- Minum air ----------

function renderWater() {
  renderFocusReport();
  renderWaterPage();
}

// ---------- Section Minum ----------
function renderWaterPage() {
  const t = statsToday ?? {};
  const drank = t.waterMl ?? 0;
  const ratio = drank / waterSettings.target;
  $('wt-now').textContent = waterLiters(drank);
  $('wt-goal').textContent = `/ ${waterLiters(waterSettings.target)} L`;
  const left = Math.max(0, Math.ceil((waterSettings.target - drank) / waterSettings.ml));
  $('wt-sub').textContent = ratio >= 1 ? `${Math.round(ratio * 100)}% · target tercapai` : `${Math.round(ratio * 100)}% · ${left}× lagi`;
  $('wt-fill').style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
  $('wt-drink-text').textContent = `${waterSettings.ml} ml`;
  $('wt-drink').title = `Catat minum ${waterSettings.ml} ml`;
  const bell = $('wt-remind');
  bell.setAttribute('aria-checked', String(waterSettings.remind !== false));
  bell.title = waterSettings.remind !== false ? `Pengingat nyala · tiap ${waterSettings.minutes ?? 60} menit` : 'Pengingat mati';

  // Air di layar Zeno besar (section Minum).
  renderBuddy();

  // Detail: 7 hari + pengaturan.
  const days = statsWeek.length ? statsWeek : [{ key: '', waterMl: drank }];
  const avg = days.reduce((n, d) => n + (d.waterMl ?? 0), 0) / days.length;
  $('water-week-total').textContent = `rata-rata ${waterLiters(avg)} L/hari`;
  renderBars($('water-bars'), days, {
    value: (d) => d.waterMl ?? 0,
    label: (n) => `${waterLiters(n)}`,
    tip: (d) => `${waterLiters(d.waterMl ?? 0)} L`,
    floor: waterSettings.target,
  });
  const pick = (id, value) => {
    const select = $(id);
    if (![...select.options].some((o) => Number(o.value) === Number(value))) select.add(new Option(String(value), String(value)));
    select.value = String(value);
  };
  pick('wt-ml', waterSettings.ml);
  pick('wt-target', waterSettings.target);
  pick('wt-every', waterSettings.remind === false ? 0 : waterSettings.minutes ?? 60);
}

$('wt-drink').addEventListener('click', () => {
  window.kapsul.drink();
  react('happy', 1200);
  sfx('tick');
});
$('wt-settings').addEventListener('click', () => setDetail(true));
$('wt-remind').addEventListener('click', () => window.kapsul.waterSettings({ remind: waterSettings.remind === false }));
$('wt-ml').addEventListener('change', (e) => window.kapsul.waterSettings({ ml: Number(e.target.value) }));
$('wt-target').addEventListener('change', (e) => window.kapsul.waterSettings({ target: Number(e.target.value) }));
$('wt-every').addEventListener('change', (e) => {
  const minutes = Number(e.target.value);
  window.kapsul.waterSettings(minutes ? { remind: true, minutes } : { remind: false });
});

function renderPet() {
  if (!petState) return;
  const hunger = Math.round(petState.hunger);
  // Beranda: kenyang di tombol makan, cincin XP di progres.
  $('home-hunger').textContent = `${hunger}%`;
  $('home-hunger').classList.toggle('low', hunger < 25);
  $('home-level').textContent = `Lv ${petState.level}`;
  $('home-progress').title = `${profile.buddyName || 'Zeno'} level ${petState.level} · ${Math.floor(petState.xp)}/${petState.needed} XP ke level ${petState.level + 1}`;
  $('home-xpring').style.strokeDasharray = `${Math.min(100, (petState.xp / petState.needed) * 100)} 100`;
  if (PAGES[pageIndex].id === 'home') renderBuddy();
}

for (const button of document.querySelectorAll('[data-food]')) {
  button.addEventListener('click', () => window.kapsul.pet('feed', button.dataset.food));
}
$('home-feed').addEventListener('click', () => window.kapsul.pet('feed', 'apple'));
$('home-play').addEventListener('click', () => window.kapsul.pet('play'));
$('home-progress').addEventListener('click', () => setDetail(true));

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
  const before = quick;
  quick = state;
  renderQuick();
  if (!before || quickDragging.volume || quickDragging.brightness) return;
  if (state.volume !== before.volume || state.muted !== before.muted) showOsd('volume', state.volume, state.muted);
  else if (state.brightness != null && state.brightness !== before.brightness) showOsd('brightness', state.brightness);
});

// ---------- OSD di kapsul: volume, kecerahan, Caps/Num Lock ----------
const OSD_ICONS = {
  volume: (v, muted) => `<svg viewBox="0 0 16 16"><path class="fill" d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" />${
    muted || v === 0
      ? '<path d="M10.6 6.2l3.4 3.6M14 6.2l-3.4 3.6" />'
      : `<path class="w1" d="M10.4 6.3a2.4 2.4 0 0 1 0 3.4" />${v > 50 ? '<path class="w2" d="M12.1 4.6a4.8 4.8 0 0 1 0 6.8" />' : ''}`
  }</svg>`,
  brightness: () => '<svg viewBox="0 0 16 16"><circle class="fill" cx="8" cy="8" r="2.6" /><g class="rays"><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" /></g></svg>',
  lock: (on) => `<svg viewBox="0 0 16 16"><rect class="fill" x="3.6" y="7.2" width="8.8" height="6.6" rx="1.6" /><path class="shackle${on ? ' shut' : ''}" d="M5.6 7.2V5.4a2.4 2.4 0 0 1 4.8 0v1.8" /></svg>`,
};
let osdTimer = null;

function showOsd(kind, value, muted = false) {
  if (open) return;
  const osd = $('osd');
  const lock = kind === 'caps' || kind === 'num';
  osd.dataset.kind = kind;
  $('osd-icon').innerHTML = lock ? OSD_ICONS.lock(value) : OSD_ICONS[kind](value, muted);
  $('osd-label').textContent = lock ? (kind === 'caps' ? 'Caps Lock' : 'Num Lock') : '';
  $('osd-bar').hidden = lock;
  $('osd-fill').style.width = `${muted ? 0 : value}%`;
  $('osd-value').textContent = lock ? (value ? 'Nyala' : 'Mati') : muted ? 'Bisu' : `${value}%`;
  osd.classList.toggle('on-state', lock && value);
  // Mulai ulang animasi ikon tiap kali muncul lagi.
  osd.classList.remove('show');
  void osd.offsetWidth;
  osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osd.classList.remove('show'), 1600);
}

window.kapsul.onLocks?.(({ key, on }) => showOsd(key, on));

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

window.kapsul.onReminders((data) => {
  const next = data?.title ? data : null;
  reminderList = data?.list ?? [];
  renderCalendar();
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
// ---------- Island Musik: mode lirik (dua kolom: pemutar + lirik berjalan) ----------
let npLyricMode = false;

function renderIslandLyrics() {
  const on = !detail && lyricsReady() && lyricsNow.synced && lyricsNow.lines.length > 0;
  const np = document.querySelector('.np');
  np.classList.toggle('with-lyrics', on);
  // Zeno besar disembunyikan di section Musik supaya lirik dapat ruang (Zeno tetap di kapsul).
  $('media').classList.toggle('lyric-mode', on && PAGES[pageIndex]?.id === 'music');
  $('media').classList.toggle('music-mode', PAGES[pageIndex]?.id === 'music');
  $('media').classList.toggle('todo-mode', PAGES[pageIndex]?.id === 'time');
  if (on !== npLyricMode) {
    npLyricMode = on;
    renderMusicProgress();
  }
  if (!on) return;
  const list = $('np-lyric-list');
  const song = mediaKey(media);
  if (list.dataset.song !== song) {
    list.dataset.song = song;
    list.replaceChildren(
      ...lyricsNow.lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line.text || '♪';
        return li;
      }),
    );
  }
  const idx = Math.max(0, lyricLineAt(trackPosition() ?? 0));
  if (list.dataset.idx === String(idx)) return;
  list.dataset.idx = String(idx);
  for (const [i, li] of [...list.children].entries()) li.classList.toggle('now', i === idx);
  // Baris aktif di urutan kedua (satu baris sebelumnya redup di atas). Baris boleh lebih dari
  // satu baris teks, jadi posisinya diukur dari elemen sebenarnya. Kalau baris sebelumnya + baris
  // aktif tidak muat di area yang tidak memudar, baris aktif naik ke paling atas supaya utuh terlihat.
  const now = list.children[idx];
  const prev = list.children[idx - 1];
  const room = list.parentElement.clientHeight * 0.82;
  const fits = prev && now && now.offsetTop + now.offsetHeight - prev.offsetTop <= room;
  const anchor = fits ? prev : now;
  list.style.transform = `translateY(${-(anchor?.offsetTop ?? 0)}px)`;
}

setInterval(() => {
  if (open && PAGES[pageIndex]?.id === 'music' && media.playing) renderIslandLyrics();
}, 250);

$('np-lyrics-btn').addEventListener('click', () => setDetail(true));

function renderMusicProgress() {
  const ms = trackPosition();
  const duration = media.duration;
  const show = Boolean(media.title) && ms != null && duration > 0;
  $('np-progress').hidden = !show;
  if (!show) return;
  $('np-elapsed').textContent = mmss(Math.min(ms, duration));
  $('np-total').textContent = npLyricMode ? `-${mmss(Math.max(0, duration - ms))}` : mmss(duration);
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
  if (session) {
    pinned.push({
      key: 'claude',
      render: (el) => {
        const label = document.createElement('span');
        label.className = 'claude-shimmer';
        label.textContent = session.label || 'Berpikir';
        el.append(label);
        if (session.started) {
          const time = document.createElement('span');
          time.className = 'dim claude-elapsed';
          time.textContent = clock(Date.now() - session.started).replace(/^0(?=\d:)/, '');
          el.append(time);
        }
      },
    });
  }
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
  renderIslandLyrics();
  renderPillText();
});

window.kapsul.onMedia((state) => {
  const prevKey = mediaKey(media);
  const wasPlaying = media.playing;
  media = state ?? { playing: false, title: null };
  updateTrackClock(prevKey);
  renderMedia();
  renderIslandLyrics();
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

// ---------- Hemat memori ----------
// Startup (membangun semua section) membuang banyak objek sekaligus; tanpa GC cepat, heap Blink
// membesar ke ±150 MB dan tidak menyusut lagi. GC beberapa kali di awal, lalu sesekali saat panel tertutup.
if (typeof window.gc === 'function') {
  for (const ms of [2000, 5000, 10000, 20000, 40000, 70000]) setTimeout(() => window.gc(), ms);
  setInterval(() => {
    if (!open) window.gc();
  }, 3 * 60_000);
}

$('home-wx-badge').addEventListener('click', () => {
  setDetail(true);
  setTimeout(() => $('home-wx').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 260);
});

// ---------- Overview (detail Beranda) ----------
// KPI hari ini (vs target & rata-rata 7 hari), tren 7 hari per ukuran, waktu layar hari ini.
let ovMetric = 'focus';
try {
  ovMetric = ['focus', 'screen', 'water'].includes(localStorage.getItem('kapsul.ovMetric')) ? localStorage.getItem('kapsul.ovMetric') : 'focus';
} catch {
  // tanpa penyimpanan
}

const avgOf = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
// "↑20% vs 7 hari" / "↓15% vs 7 hari" (dibanding rata-rata 6 hari sebelumnya).
function vsAverage(today, before) {
  const avg = avgOf(before);
  if (!avg) return '';
  const diff = Math.round(((today - avg) / avg) * 100);
  return diff === 0 ? '= rata-rata 7 hari' : `${diff > 0 ? '↑' : '↓'}${Math.abs(diff)}% vs 7 hari`;
}

function renderOverview() {
  const box = $('ov-kpis');
  if (!box) return;
  const t = statsToday ?? {};
  const week = statsWeek.length ? statsWeek : [];
  const prev = week.slice(0, -1);
  const focusMin = Math.round((t.focusMs ?? 0) / 60_000);
  const focusGoal = Math.max(1, focusSettings.focusMinutes * focusSettings.cycles);
  const water = t.waterMl ?? 0;
  const tasks = todayTodos();
  const screenDays = screenState?.week ?? [];
  const screenToday = screenState?.today?.totalMs ?? 0;
  // Tiap target dengan grafik yang cocok: donat (fokus, tugas), gelas bersegmen (minum), sparkline 7 hari (layar).
  const glasses = Math.max(1, Math.round(waterSettings.target / waterSettings.ml));
  const kpis = [
    { label: 'Fokus', viz: 'ring', value: `${focusMin} m`, ratio: focusMin / focusGoal, sub: vsAverage(focusMin, prev.map((d) => Math.round((d.focusMs ?? 0) / 60_000))) || `target ${focusGoal} m`, go: 'focus' },
    { label: 'Minum', viz: 'glasses', value: `${waterLiters(water)} L`, filled: Math.min(glasses, Math.floor(water / waterSettings.ml)), glasses, sub: `target ${waterLiters(waterSettings.target)} L`, go: 'water' },
    { label: 'Tugas', viz: 'ring', value: `${tasks.done}/${tasks.total}`, ratio: tasks.total ? tasks.done / tasks.total : 0, sub: tasks.total ? (tasks.done === tasks.total ? 'semua selesai' : `${tasks.total - tasks.done} tersisa`) : 'belum ada', go: 'time' },
    { label: 'Layar', viz: 'spark', value: screenToday >= 60_000 ? minutesText(screenToday) : '0 m', days: screenDays.length ? screenDays.map((d) => d.ms ?? 0) : [screenToday], sub: vsAverage(screenToday, screenDays.slice(0, -1).map((d) => d.ms ?? 0)) || 'hari ini', go: 'device' },
  ];
  box.replaceChildren();
  for (const k of kpis) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ov-kpi viz-${k.viz}`;
    const label = document.createElement('span');
    label.className = 'sum-label';
    label.textContent = k.label;
    const viz = document.createElement('span');
    viz.className = 'ov-viz';
    if (k.viz === 'ring') {
      const svg = svgEl('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
      ringMeter(svg, k.ratio, '');
      svg.removeAttribute('aria-label');
      const pct = document.createElement('small');
      pct.textContent = `${Math.min(999, Math.round(k.ratio * 100))}%`;
      viz.append(svg, pct);
    } else if (k.viz === 'glasses') {
      // Satu segmen = sekali minum; terisi = sudah diminum.
      for (let i = 0; i < Math.min(k.glasses, 12); i++) {
        const g = document.createElement('i');
        if (i < k.filled) g.className = 'on';
        viz.append(g);
      }
    } else {
      const max = Math.max(1, ...k.days);
      k.days.forEach((ms, i) => {
        const bar = document.createElement('i');
        bar.style.height = `${Math.max(8, (100 * ms) / max)}%`;
        if (i === k.days.length - 1) bar.className = 'on';
        viz.append(bar);
      });
    }
    const value = document.createElement('b');
    value.className = 'sum-value';
    value.textContent = k.value;
    const sub = document.createElement('span');
    sub.className = 'sum-sub';
    sub.textContent = k.sub;
    b.append(label, viz, value, sub);
    b.title = `${k.label}: ${k.value} · ${k.sub}`;
    b.addEventListener('click', () => goToSection(k.go));
    box.append(b);
  }

  // Tren 7 hari: satu ukuran sekaligus (satuan berbeda tidak ditumpuk dalam satu sumbu).
  for (const btn of $('ov-seg').querySelectorAll('[data-metric]')) btn.setAttribute('aria-checked', String(btn.dataset.metric === ovMetric));
  let days;
  let opts;
  if (ovMetric === 'screen') {
    days = screenDays.length ? screenDays : [{ key: '', ms: screenToday }];
    opts = { value: (d) => Math.round((d.ms ?? 0) / 60_000), label: (n) => (n >= 60 ? `${(n / 60).toLocaleString('id-ID', { maximumFractionDigits: 1 })} j` : `${n} m`), tip: (d) => `${minutesText(d.ms ?? 0)} waktu layar`, floor: 60 };
  } else if (ovMetric === 'water') {
    days = week.length ? week : [{ key: '', waterMl: water }];
    opts = { value: (d) => d.waterMl ?? 0, label: (n) => waterLiters(n), tip: (d) => `${waterLiters(d.waterMl ?? 0)} L diminum`, floor: waterSettings.target };
  } else {
    days = week.length ? week : [{ key: '', focus: t.focus ?? 0, focusMs: t.focusMs ?? 0 }];
    opts = { value: (d) => Math.round((d.focusMs ?? 0) / 60_000), label: (n) => String(n), tip: (d, n) => `${n} menit · ${d.focus ?? 0} sesi`, floor: 30 };
  }
  const { minutes: values, avg, best } = renderBars($('ov-bars'), days, { ...opts, mini: true });
  const unit = (n) => opts.label(Math.round(n));
  $('ov-note').textContent = values.some((v) => v > 0)
    ? `Rata-rata ${unit(avg)}/hari · tertinggi ${best === values.length - 1 ? 'hari ini' : dayName(days[best].key)} (${unit(values[best])})`
    : 'Belum ada data minggu ini.';

  // Waktu layar hari ini
  $('ov-screen').hidden = !screenState;
  if (screenState) {
    $('ov-screen-total').textContent = screenToday >= 60_000 ? minutesText(screenToday) : '';
    renderScreenDonut(screenState.today, 'ov-donut', 'ov-legend');
  }
}

for (const btn of $('ov-seg').querySelectorAll('[data-metric]')) {
  btn.addEventListener('click', () => {
    ovMetric = btn.dataset.metric;
    try {
      localStorage.setItem('kapsul.ovMetric', ovMetric);
    } catch {
      // tanpa penyimpanan
    }
    renderOverview();
  });
}

// ---------- Kunci island ----------
let panelPinned = false;
function renderPin() {
  const btn = $('pin-btn');
  btn.setAttribute('aria-pressed', String(panelPinned));
  btn.classList.toggle('on', panelPinned);
  btn.title = panelPinned ? 'Island terkunci terbuka · klik untuk membuka kunci' : 'Kunci island agar tetap terbuka';
  btn.setAttribute('aria-label', btn.title);
  shell.classList.toggle('pinned', panelPinned);
}
$('pin-btn').addEventListener('click', () => {
  panelPinned = !panelPinned;
  renderPin();
  sfx(panelPinned ? 'tick' : 'blip');
  window.kapsul.pin(panelPinned);
});
window.kapsul.onPinned?.((on) => {
  panelPinned = Boolean(on);
  renderPin();
});

// ---------- Mini player YouTube ----------
// Iframe dibuat sekali per video dan tidak dipindah di DOM (pindah = video dimuat ulang); posisinya
// mengikuti slot kecil di island Musik atau slot besar di detail. Ditutup = iframe dibuang (memori dilepas).
let yt = null; // { id, start, title, author }
let ytFrame = null;

// Link video (id), link playlist (list, tanpa id), atau keduanya (video di dalam playlist, + index).
function youtubeId(text) {
  const s = String(text ?? '').trim();
  if (!/youtube\.com|youtu\.be/.test(s)) return null;
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(s);
  const list = /[?&]list=([\w-]{10,})/.exec(s)?.[1] ?? null;
  if (!m && !list) return null;
  const t = /[?&](?:t|start)=(\d+)/.exec(s);
  const index = /[?&]index=(\d+)/.exec(s);
  return { id: m?.[1] ?? null, list, index: index ? Math.max(0, Number(index[1]) - 1) : 0, start: t ? Number(t[1]) : 0 };
}

const YT_PARAMS = 'autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&rel=0&playsinline=1&enablejsapi=1';
// URL embed: video tunggal, video di dalam playlist, atau playlist saja (videoseries).
function ytEmbedUrl({ id, list, index = 0, start = 0, muted = false }) {
  const base = 'https://www.youtube-nocookie.com/embed/';
  const extra = `${YT_PARAMS}&start=${Math.floor(start)}${muted ? '&mute=1' : ''}`;
  if (list && id) return `${base}${id}?list=${list}&index=${index}&${extra}`;
  if (list) return `${base}videoseries?list=${list}&index=${index}&${extra}`;
  return `${base}${id}?${extra}`;
}

async function playYouTube(link) {
  const found = youtubeId(link);
  if (!found) return false;
  closeYouTube();
  yt = { ...found, title: 'Memuat video…', author: '', playing: true, muted: false, time: 0, duration: 0, playlist: [], titles: {} };
  ytFrame = document.createElement('iframe');
  // Read-only: tanpa kontrol & keyboard YouTube, video tidak bisa diklik; kontrol lewat IFrame API (postMessage).
  ytFrame.src = ytEmbedUrl(found);
  ytFrame.addEventListener('load', () => ytSend('listening'));
  ytFrame.allow = 'autoplay; encrypted-media; picture-in-picture';
  ytFrame.title = 'Video YouTube';
  $('yt-box').querySelector('iframe')?.remove();
  $('yt-box').prepend(ytFrame);
  $('yt-box').hidden = false;
  $('yt-url').value = '';
  renderYouTube();
  if (!open) window.kapsul.expand(true);
  goToSection('video', { sound: false });
  react('happy', 1200);
  if (found.id) {
    const info = await window.kapsul.ytInfo(found.id);
    if (yt?.id === found.id) {
      yt.title = info?.title || 'Video YouTube';
      yt.author = info?.author || '';
      renderYouTube();
      rememberVideo(yt);
    }
  }
  return true;
}

// Perintah ke pemutar: 'playVideo', 'pauseVideo', 'mute', 'unMute' (atau 'listening' untuk minta status).
function ytSend(func, args = []) {
  const target = ytFrame?.contentWindow;
  if (!target) return;
  const message = func === 'listening' ? { event: 'listening', id: 1, channel: 'widget' } : { event: 'command', func, args, id: 1, channel: 'widget' };
  target.postMessage(JSON.stringify(message), 'https://www.youtube-nocookie.com');
}

// Status dari pemutar (main/jeda, waktu, durasi, bisu) untuk tombol & keterangan waktu di luar video.
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://www.youtube-nocookie.com' || !yt || event.source !== ytFrame?.contentWindow) return;
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }
  // Video melarang diputar di luar YouTube (kode 101/150) atau tidak ada: beri tahu & tawarkan browser.
  if (data?.event === 'onError') {
    yt.error = [101, 150, 153].includes(Number(data.info)) ? 'Pemilik video tidak mengizinkan diputar di luar YouTube' : 'Video tidak bisa diputar';
    renderYouTube();
    return;
  }
  const info = data?.info;
  if (!info || typeof info !== 'object') return;
  if (typeof info.playerState === 'number') yt.playing = info.playerState === 1 || info.playerState === 3;
  if (typeof info.currentTime === 'number') yt.time = info.currentTime;
  if (typeof info.duration === 'number' && info.duration > 0) yt.duration = info.duration;
  if (typeof info.muted === 'boolean') yt.muted = info.muted;
  // Playlist: daftar id & posisi; video berganti (berikutnya/sebelumnya) → judul ikut berganti.
  if (Array.isArray(info.playlist) && info.playlist.length) {
    const changed = info.playlist.join() !== yt.playlist.join();
    yt.playlist = info.playlist.filter((x) => /^[\w-]{11}$/.test(x));
    if (changed) loadQueueTitles();
  }
  if (typeof info.playlistIndex === 'number' && info.playlistIndex >= 0) yt.index = info.playlistIndex;
  const vd = info.videoData;
  if (vd?.video_id && vd.video_id !== yt.id) {
    yt.id = vd.video_id;
    yt.title = vd.title || yt.titles[vd.video_id]?.title || 'Video YouTube';
    yt.author = vd.author || yt.titles[vd.video_id]?.author || '';
    yt.time = 0;
    renderYouTube();
    if (yt.title !== 'Video YouTube') rememberVideo(yt);
  } else if (vd?.title && yt.title === 'Memuat video…') {
    yt.title = vd.title;
    yt.author = vd.author || yt.author;
    renderYouTube();
    rememberVideo(yt);
  }
  renderYtControls();
  renderQueue();
});

// Judul tiap video di playlist (oEmbed lewat main), paling banyak 50 pertama, bertahap.
async function loadQueueTitles() {
  const list = yt?.playlist ?? [];
  for (const vid of list.slice(0, 50)) {
    if (!yt || yt.playlist !== list) return;
    if (yt.titles[vid]) continue;
    const info = await window.kapsul.ytInfo(vid);
    if (!yt) return;
    yt.titles[vid] = info ?? { title: '', author: '' };
    renderQueue();
  }
}

function renderQueue() {
  const on = Boolean(yt?.playlist?.length > 1);
  $('yt-queue-block').hidden = !on;
  $('yt-mini').classList.toggle('list', on);
  if (!on) return;
  $('yt-queue-kicker').textContent = `Daftar putar · ${yt.index + 1}/${yt.playlist.length}`;
  const box = $('yt-queue');
  const key = `${yt.playlist.join()}|${yt.index}|${Object.keys(yt.titles).length}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  yt.playlist.forEach((vid, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `yt-q${i === yt.index ? ' now' : ''}`;
    const num = document.createElement('small');
    num.textContent = i === yt.index ? '▶' : String(i + 1);
    const text = document.createElement('span');
    const t = document.createElement('b');
    t.textContent = yt.titles[vid]?.title || 'Memuat judul…';
    const s = document.createElement('i');
    s.textContent = yt.titles[vid]?.author || '';
    text.append(t, s);
    b.append(num, text);
    b.addEventListener('click', () => {
      ytSend('playVideoAt', [i]);
      yt.index = i;
      renderQueue();
    });
    li.append(b);
    box.append(li);
  });
  box.querySelector('.now')?.scrollIntoView({ block: 'nearest' });
}

$('yt-prev-btn').addEventListener('click', () => ytSend('previousVideo'));
$('yt-next-btn').addEventListener('click', () => ytSend('nextVideo'));

const ytClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function renderYtControls() {
  if (!yt) return;
  const play = $('yt-play-btn');
  play.classList.toggle('paused', !yt.playing);
  play.title = yt.playing ? 'Jeda' : 'Putar';
  play.setAttribute('aria-label', play.title);
  const mute = $('yt-mute-btn');
  mute.classList.toggle('muted', yt.muted);
  mute.title = yt.muted ? 'Nyalakan suara' : 'Bisukan';
  mute.setAttribute('aria-label', mute.title);
  $('yt-time').textContent = yt.duration ? `${ytClock(yt.time)} / ${ytClock(yt.duration)}` : '';
  // Selama jalur putar diseret, isinya mengikuti kursor (bukan posisi video).
  if (!$('yt-track').classList.contains('seeking')) $('yt-fill').style.width = ytPercent();
  if (theater) renderStage();
}

const ytPercent = () => (yt?.duration ? `${((100 * yt.time) / yt.duration).toFixed(2)}%` : '0');

// Lompat ke detik tertentu (jalur putar, ±10 detik, panah kiri/kanan di mode bioskop).
function ytSeek(seconds) {
  if (!yt?.duration) return;
  yt.time = Math.max(0, Math.min(yt.duration - 0.5, seconds));
  ytSend('seekTo', [yt.time, true]);
  renderYtControls();
}

// Jalur putar: arahkan kursor = lihat waktunya, klik / seret = lompat ke sana.
function seekTrack(track, fill, tip) {
  let seeking = false;
  const ratio = (event) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
  };
  const hint = (event) => {
    if (!yt?.duration) return;
    tip.textContent = ytClock(ratio(event) * yt.duration);
    tip.style.left = `${(ratio(event) * 100).toFixed(2)}%`;
  };
  track.addEventListener('pointerdown', (event) => {
    if (!yt?.duration || event.button !== 0) return;
    event.stopPropagation();
    seeking = true;
    track.setPointerCapture(event.pointerId);
    track.classList.add('seeking');
    fill.style.width = `${(ratio(event) * 100).toFixed(2)}%`;
    hint(event);
  });
  track.addEventListener('pointermove', (event) => {
    hint(event);
    if (seeking) fill.style.width = `${(ratio(event) * 100).toFixed(2)}%`;
  });
  const end = (event) => {
    if (!seeking) return;
    seeking = false;
    track.classList.remove('seeking');
    if (event.type === 'pointerup') ytSeek(ratio(event) * yt.duration);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
}
seekTrack($('yt-track'), $('yt-fill'), $('yt-tip'));
seekTrack($('yt-stage-track'), $('yt-stage-progress'), $('yt-stage-tip'));
for (const [id, step] of [['yt-back-btn', -10], ['yt-fwd-btn', 10], ['yt-stage-back', -10], ['yt-stage-fwd', 10]]) {
  $(id).addEventListener('click', () => yt && ytSeek(yt.time + step));
}

// ---------- Mode bioskop: island = layar video, Zeno & isi panel disembunyikan ----------
function renderStage() {
  $('yt-stage-title').textContent = yt.title;
  $('yt-stage-time').textContent = $('yt-time').textContent;
  $('yt-stage-play').classList.toggle('paused', !yt.playing);
  $('yt-stage-play').title = yt.playing ? 'Jeda' : 'Putar';
  $('yt-stage-mute').classList.toggle('muted', yt.muted);
  $('yt-stage-mute').title = yt.muted ? 'Nyalakan suara' : 'Bisukan';
  $('yt-stage').classList.toggle('list', yt.playlist?.length > 1);
  if (!$('yt-stage-track').classList.contains('seeking')) $('yt-stage-progress').style.width = ytPercent();
}
window.kapsul.onTheater((state) => {
  theater = Boolean(state?.on);
  shell.classList.toggle('theater', theater);
  // Sudah dipindah bebas: melebar ke kanan, gagang di kanan bawah (tidak ikut sisi island).
  $('yt-stage').classList.toggle('free', Boolean(state?.free));
  $('yt-box').classList.toggle('stage', theater);
  if (theater && yt) renderStage();
  placeYouTube();
});
new ResizeObserver(() => placeYouTube()).observe(shell);
$('yt-stage-prev').addEventListener('click', () => ytSend('previousVideo'));
$('yt-stage-next').addEventListener('click', () => ytSend('nextVideo'));
$('yt-stage-play').addEventListener('click', () => $('yt-play-btn').click());
$('yt-stage-mute').addEventListener('click', () => $('yt-mute-btn').click());
$('yt-stage-exit').addEventListener('click', () => window.kapsul.theater(false));
$('yt-stage-close').addEventListener('click', () => $('yt-close-btn').click());
// Seret video = pindahkan ke mana saja di layar; klik tanpa geser = putar/jeda.
{
  const stage = $('yt-stage');
  let from = null;
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button, .yt-track, .yt-stage-grip')) return;
    from = { x: event.screenX, y: event.screenY, moved: false };
    stage.setPointerCapture(event.pointerId);
    window.kapsul.theaterMove('start', 0, 0);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!from) return;
    const dx = event.screenX - from.x;
    const dy = event.screenY - from.y;
    if (!from.moved && Math.hypot(dx, dy) < 4) return;
    from.moved = true;
    stage.classList.add('moving');
    window.kapsul.theaterMove('move', dx, dy);
  });
  const end = (event) => {
    if (!from) return;
    const { moved } = from;
    from = null;
    stage.classList.remove('moving');
    window.kapsul.theaterMove('end', 0, 0, moved);
    if (!moved && event.type === 'pointerup') $('yt-play-btn').click();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}
// Gagang sudut: lebar island diubah di main (tinggi ikut 16:9).
{
  const grip = $('yt-stage-grip');
  let from = null;
  grip.addEventListener('pointerdown', (event) => {
    from = event.screenX;
    grip.setPointerCapture(event.pointerId);
    $('yt-box').classList.add('sizing');
    window.kapsul.theaterResize('start', 0);
  });
  grip.addEventListener('pointermove', (event) => {
    if (from != null) window.kapsul.theaterResize('move', event.screenX - from);
  });
  const end = (event) => {
    if (from == null) return;
    window.kapsul.theaterResize('end', event.screenX - from);
    from = null;
    $('yt-box').classList.remove('sizing');
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

$('yt-play-btn').addEventListener('click', () => {
  if (!yt) return;
  yt.playing = !yt.playing;
  ytSend(yt.playing ? 'playVideo' : 'pauseVideo');
  renderYtControls();
});
$('yt-mute-btn').addEventListener('click', () => {
  if (!yt) return;
  yt.muted = !yt.muted;
  ytSend(yt.muted ? 'mute' : 'unMute');
  renderYtControls();
});

function closeYouTube() {
  if (theater) window.kapsul.theater(false);
  ytFrame?.remove();
  ytFrame = null;
  yt = null;
  $('yt-box').hidden = true;
  $('yt-queue-block').hidden = true;
  $('yt-mini').classList.remove('list');
  renderYouTube();
}

function renderYouTube() {
  const on = Boolean(yt);
  $('yt-mini').hidden = !on;
  $('yt-empty').hidden = on;
  if (on) {
    $('yt-title').textContent = yt.title;
    $('yt-title').title = yt.title;
    $('yt-author').textContent = yt.error ?? yt.author;
    $('yt-mini').classList.toggle('error', Boolean(yt.error));
    renderYtControls();
  }
  placeYouTube();
}

// Kotak pemutar mengikuti slot yang sedang terlihat (detail terbuka = besar, selain itu = kecil di island).
function placeYouTube() {
  const box = $('yt-box');
  if (!yt) return;
  const onMusic = open && (theater || PAGES[pageIndex]?.id === 'video');
  const r = (theater ? shell : $('yt-slot-small')).getBoundingClientRect();
  const visible = onMusic && r.width > 0 && r.height > 0;
  // Tidak terlihat (section lain / panel tertutup): suara tetap jalan, kotaknya disembunyikan.
  box.classList.toggle('away', !visible);
  if (!visible) return;
  Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}

// Ikuti perubahan tata letak: pindah section, buka/tutup detail, ukuran jendela, scroll panel detail.
new ResizeObserver(() => placeYouTube()).observe($('yt-slot-small'));
for (const el of [$('hero-track'), $('deck-track')]) el.addEventListener('transitionend', () => placeYouTube());
setInterval(() => {
  if (yt) placeYouTube();
}, 500);

$('yt-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!youtubeId($('yt-url').value)) {
    $('yt-url').classList.add('bad');
    setTimeout(() => $('yt-url').classList.remove('bad'), 900);
    return;
  }
  playYouTube($('yt-url').value);
});
$('yt-url').addEventListener('paste', () => setTimeout(() => youtubeId($('yt-url').value) && playYouTube($('yt-url').value), 0));
// Perbesar = mode bioskop: island membesar jadi layar video (tanpa Zeno), ukurannya bisa diubah.
$('yt-big-btn').addEventListener('click', () => {
  if (yt) window.kapsul.theater(true);
});
// Kolom tempel di island (belum ada video).
$('yt-empty').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('yt-url-island').value;
  if (!youtubeId(value)) {
    $('yt-url-island').classList.add('bad');
    setTimeout(() => $('yt-url-island').classList.remove('bad'), 900);
    return;
  }
  playYouTube(value);
  $('yt-url-island').value = '';
});
$('yt-url-island').addEventListener('paste', () => setTimeout(() => youtubeId($('yt-url-island').value) && playYouTube($('yt-url-island').value), 0));
$('yt-open-btn').addEventListener('click', () => {
  if (!yt) return;
  window.kapsul.ytOpen(yt.id, yt.start);
  closeYouTube();
});
$('yt-close-btn').addEventListener('click', closeYouTube);

// Link YouTube terakhir di clipboard: tawarkan satu klik untuk diputar.
function renderYtClip() {
  const latest = clipItems.find((c) => c.type !== 'image');
  const found = latest && youtubeId(latest.text);
  const btn = $('yt-clip');
  btn.hidden = !found || found.id === yt?.id;
  if (found) {
    btn.textContent = 'Putar link dari clipboard';
    btn.onclick = () => playYouTube(latest.text);
  }
  $('yt-clip-island').hidden = btn.hidden;
  $('yt-clip-island').onclick = btn.onclick;
}
window.kapsul.onClips((items) => {
  clipItems = items ?? [];
  renderYtClip();
});

// Link YouTube diseret ke island (dari address bar / halaman browser) = langsung diputar.
document.addEventListener('dragover', (event) => {
  const types = [...(event.dataTransfer?.types ?? [])];
  if (!types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/plain'))) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  const types = [...(event.dataTransfer?.types ?? [])];
  if (types.includes('Files')) return;
  const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
  if (youtubeId(text)) {
    event.preventDefault();
    playYouTube(text);
  }
});

// Riwayat video (8 terakhir) di detail Video; klik = putar lagi.
let ytHistory = [];
try {
  ytHistory = JSON.parse(localStorage.getItem('kapsul.ytHistory') || '[]').filter((v) => /^[\w-]{11}$/.test(v?.id));
} catch {
  ytHistory = [];
}
function rememberVideo(v) {
  ytHistory = [{ id: v.id, list: v.list ?? null, title: v.title, author: v.author, at: Date.now() }, ...ytHistory.filter((x) => x.id !== v.id)].slice(0, 8);
  try {
    localStorage.setItem('kapsul.ytHistory', JSON.stringify(ytHistory));
  } catch {
    // tanpa penyimpanan
  }
  renderYtHistory();
}
function renderYtHistory() {
  const list = $('yt-history');
  list.replaceChildren();
  $('yt-history-clear').hidden = !ytHistory.length;
  if (!ytHistory.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Belum ada video yang ditonton.';
    list.append(empty);
    return;
  }
  for (const v of ytHistory) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yt-row';
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z" /></svg>';
    const text = document.createElement('span');
    const t = document.createElement('b');
    t.textContent = v.title || 'Video YouTube';
    const s = document.createElement('small');
    s.textContent = v.author || '';
    text.append(t, s);
    b.append(text);
    b.title = `Putar: ${v.title}`;
    b.addEventListener('click', () => playYouTube(`https://www.youtube.com/watch?v=${v.id}${v.list ? `&list=${v.list}` : ''}`));
    list.append(b);
  }
}
$('yt-history-clear').addEventListener('click', () => {
  ytHistory = [];
  try {
    localStorage.removeItem('kapsul.ytHistory');
  } catch {
    // tanpa penyimpanan
  }
  renderYtHistory();
});
renderYtHistory();
