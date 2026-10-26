'use strict';

// Maskot Zenopod: bola 3D dengan banyak ekspresi.
// Wajah (mata, mulut, pipi) ikut "berputar" di permukaan bola ke arah kursor,
// kilau cahaya tetap di tempat sehingga bola terlihat bulat.

(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Pusat bola dan posisi mata dalam satuan viewBox.
  const CX = 20;
  const CY = 22;
  const EYE_L = 15;
  const EYE_R = 25;
  const EYE_Y = 21;

  // Bagian yang tampil per ekspresi. Bagian lain disembunyikan.
  const MOODS = {
    idle: ['e-open', 'm-smile', 'blush'],
    happy: ['e-happy', 'm-open', 'blush'],
    laugh: ['e-squint', 'm-laugh', 'blush'],
    love: ['e-heart', 'm-open', 'blush', 'x-hearts'],
    wink: ['e-wink', 'm-tongue', 'blush'],
    surprised: ['e-wide', 'm-o', 'b-raised'],
    confused: ['e-open', 'm-wavy', 'b-confused', 'x-q'],
    smug: ['e-half', 'm-smirk', 'blush'],
    annoyed: ['e-half', 'm-flat', 'x-sweat'],
    angry: ['e-open', 'b-angry', 'm-frown', 'x-vein'],
    cry: ['e-closed', 'b-worried', 'm-wavy', 't-cry'],
    sleep: ['e-closed', 'm-smile', 'x-zzz'],
    music: ['e-happy', 'm-smile', 'blush', 'x-phones', 'x-notes'],
    kiss: ['e-closed', 'm-kiss', 'blush', 'x-hearts'],
    think: ['e-up', 'm-hmm', 'b-raised', 'x-thought'],
    alarm: ['e-wide', 'm-open', 'b-raised', 'x-bang', 'blush'],
    focus: ['e-open', 'm-flat', 'x-glasses'],
    // Claude sedang bekerja: layar wajah menampilkan kode yang sedang diketik.
    work: ['x-code'],
    // Kamu sedang mengetik: layar wajah berganti jadi ketikan (huruf muncul tik-tik + kursor).
    typing: ['x-typebar'],
    listen: ['e-open', 'm-smile', 'blush', 'x-phones'],
    greet: ['e-happy', 'm-open', 'blush', 'x-sparkle'],
    clock: ['e-up', 'm-smile', 'blush', 'x-clock'],
    lowbat: ['e-closed', 'm-wavy', 'x-battery', 'x-sweat'],
    charging: ['e-happy', 'm-open', 'blush', 'x-bolt'],
    unplug: ['e-wide', 'm-o', 'b-raised', 'x-plug'],
    paired: ['e-happy', 'm-smile', 'blush', 'x-bt'],
    hear: ['e-wide', 'm-o', 'blush', 'x-waves'],
    hungry: ['e-open', 'm-wavy', 'b-worried', 'x-food'],
    eat: ['e-happy', 'm-chew', 'blush', 'x-crumbs'],
    stretch: ['e-happy', 'm-open', 'blush', 'x-sparkle'],
    // Reaksi interaksi (klik, elus, tahan)
    dizzy: ['e-spiral', 'm-wavy', 'x-stars'],
    starstruck: ['e-star', 'm-open', 'blush', 'x-sparkle'],
    shy: ['e-down', 'm-smile', 'blush-big'],
    pout: ['e-half', 'm-pout', 'blush-big'],
    yawn: ['e-closed', 'm-yawn', 'x-zzz'],
    purr: ['e-happy', 'm-cat', 'blush', 'x-hearts'],
    tickle: ['e-squint', 'm-laugh', 'blush', 't-joy'],
    sulk: ['e-closed', 'm-frown', 'b-worried'],
    mischief: ['e-half', 'm-grin', 'b-angry', 'x-sparkle'],
    squish: ['e-squint', 'm-o', 'blush-big'],
    boop: ['e-wide', 'm-kiss', 'blush'],
  };

  // Bintang 5 sudut (mata bintang).
  const star = (cx, cy, outer, inner) =>
    Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    }).join(' ') + 'Z';

  // Mata spiral (pusing): busur setengah lingkaran yang makin besar.
  const spiral = (x) => `M${x} ${EYE_Y} a0.6 0.6 0 0 1 1.2 0 a1.2 1.2 0 0 1 -2.4 0 a1.8 1.8 0 0 1 3.6 0 a2.4 2.4 0 0 1 -4.8 0`;

  const heart = (x, y, s) =>
    `M${x} ${y + 1.3 * s} C${x - 1.8 * s} ${y} ${x - 1.3 * s} ${y - 1.4 * s} ${x} ${y - 0.6 * s} ` +
    `C${x + 1.3 * s} ${y - 1.4 * s} ${x + 1.8 * s} ${y} ${x} ${y + 1.3 * s}Z`;

  // Mata bulat cokelat dengan dua titik kilau.
  const roundEye = (x, rx, ry, shine) => `
    <g transform="translate(${x} ${EYE_Y})"><g class="blink"><g class="pupil">
      <ellipse rx="${rx}" ry="${ry}" class="ink" />
      <circle cx="${-rx * 0.35}" cy="${-ry * 0.4}" r="${shine}" class="shine" />
      <circle cx="${rx * 0.35}" cy="${ry * 0.35}" r="${shine * 0.45}" class="shine" />
    </g></g></g>`;

  const perEye = (draw) => draw(EYE_L, 'l') + draw(EYE_R, 'r');

  function markup(id) {
    return `
      <defs>
        <clipPath id="${id}-clip"><circle cx="${CX}" cy="${CY}" r="15" /></clipPath>
        <!-- Bentuk robot: badan abu gelap, wajah di layar, ikat kepala kostum ikut kotak kepala -->
        <radialGradient id="${id}-robot" cx="35%" cy="28%" r="85%">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.5" stop-color="#f1f2f6" />
          <stop offset="0.85" stop-color="#d5d8e0" />
          <stop offset="1" stop-color="#b9bdc8" />
        </radialGradient>
        <radialGradient id="${id}-robot-angry" cx="35%" cy="28%" r="85%">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.5" stop-color="#ffe4e4" />
          <stop offset="0.85" stop-color="#f6b4b4" />
          <stop offset="1" stop-color="#e07a7a" />
        </radialGradient>
        <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.12" />
          <stop offset="0.45" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="${id}-depth" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stop-color="#c9ccd5" />
          <stop offset="1" stop-color="#8a8f9c" />
        </linearGradient>
        <linearGradient id="${id}-bevel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="0.45" stop-color="#ffffff" stop-opacity="0" />
          <stop offset="1" stop-color="#5b6070" stop-opacity="0.35" />
        </linearGradient>
        <linearGradient id="${id}-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7d828f" />
          <stop offset="0.5" stop-color="#b9bdc7" />
          <stop offset="1" stop-color="#f4f5f8" />
        </linearGradient>
        <linearGradient id="${id}-inset" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.75" />
          <stop offset="0.25" stop-color="#000000" stop-opacity="0" />
        </linearGradient>
        <clipPath id="${id}-screen"><rect x="9" y="11" width="22" height="20" rx="4.6" /></clipPath>
        <clipPath id="${id}-head"><rect x="5.5" y="8" width="29" height="27" rx="7.5" /></clipPath>
      </defs>

      <!-- Bayangan di lantai: mengecil saat Zeno melayang naik -->
      <ellipse class="b-shadow" cx="20" cy="38.6" rx="9.5" ry="1.4" />
      <!-- Melayang pelan naik-turun (terpisah dari animasi ekspresi di .b-body) -->
      <g class="b-float">
      <g class="b-body">
        <!-- Bando headphone: melengkung di luar kepala (di belakang bola), tidak menutupi wajah atau
             ubun-ubun. Topi tetap di atasnya; earcup ada di lapisan depan (grup .phones di bawah). -->
        <g data-part="x-phones" class="phones phones-band">
          <path class="band-shadow" d="M5.2 21 C4.2 6.6 11.6 3 20 3 C28.4 3 35.8 6.6 34.8 21" />
          <path class="band" d="M5.2 21 C4.2 6.6 11.6 3 20 3 C28.4 3 35.8 6.6 34.8 21" />
          <path class="band-shine" d="M6.4 13.4 C7.4 7.6 12.4 4.6 18.2 4.1" />
        </g>
        <rect class="robot-depth robot-only" x="6.3" y="9.6" width="29" height="27.2" rx="8.2" fill="url(#${id}-depth)" />
        <rect class="sphere robot-only" x="5.5" y="8" width="29" height="27" rx="8.2" fill="url(#${id}-robot)" />
        <rect class="robot-bevel robot-only" x="6" y="8.5" width="28" height="26" rx="7.7" fill="none" stroke="url(#${id}-bevel)" stroke-width="1" />
        <rect class="screen-rim robot-only" x="8.2" y="10.2" width="23.6" height="21.6" rx="5.4" fill="url(#${id}-rim)" />
        <rect class="screen robot-only" x="9" y="11" width="22" height="20" rx="4.6" />
        <!-- Air di dalam layar (section Minum): tingginya = progres target, permukaannya bergoyang -->
        <g class="b-water robot-only" clip-path="url(#${id}-screen)">
          <g class="b-water-level">
            <path class="b-wave back" d="M-26 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 q2.25 -0.9 4.5 0 t4.5 0 V30 H-26 Z" />
            <path class="b-wave front" d="M-26 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 q2 -0.75 4 0 t4 0 V30 H-26 Z" />
            <circle class="b-bubble" cx="14" cy="0" r="0.7" />
            <circle class="b-bubble" cx="21" cy="0" r="0.5" />
            <circle class="b-bubble" cx="26.5" cy="0" r="0.6" />
          </g>
        </g>

        <g class="face-clip" clip-path="url(#${id}-clip)">
        <g class="b-face">
          <g data-part="blush">
            <ellipse class="blush" cx="11.4" cy="25.6" rx="2.3" ry="1.3" />
            <ellipse class="blush" cx="28.6" cy="25.6" rx="2.3" ry="1.3" />
          </g>

          <g data-part="e-open">${perEye((x) => roundEye(x, 2.1, 2.7, 0.85))}</g>
          <g data-part="e-up">${perEye((x) => roundEye(x, 1.9, 2.4, 0.8).replace(`translate(${x} ${EYE_Y})`, `translate(${x + 0.9} ${EYE_Y - 1.6})`))}</g>
          <g data-part="e-wide">${perEye((x) => roundEye(x, 2.6, 3.2, 1.05))}</g>
          <g data-part="e-happy">${perEye((x) => `<path class="line" d="M${x - 2.2} ${EYE_Y + 0.8} Q${x} ${EYE_Y - 2.2} ${x + 2.2} ${EYE_Y + 0.8}" />`)}</g>
          <g data-part="e-closed">${perEye((x) => `<path class="line" d="M${x - 2.2} ${EYE_Y - 0.3} Q${x} ${EYE_Y + 1.9} ${x + 2.2} ${EYE_Y - 0.3}" />`)}</g>
          <g data-part="e-squint">
            <path class="line" d="M${EYE_L - 1.8} ${EYE_Y - 1.7} L${EYE_L + 1.6} ${EYE_Y} L${EYE_L - 1.8} ${EYE_Y + 1.7}" />
            <path class="line" d="M${EYE_R + 1.8} ${EYE_Y - 1.7} L${EYE_R - 1.6} ${EYE_Y} L${EYE_R + 1.8} ${EYE_Y + 1.7}" />
          </g>
          <g data-part="e-wink">
            ${roundEye(EYE_L, 2.1, 2.7, 0.85)}
            <path class="line" d="M${EYE_R - 2.2} ${EYE_Y + 0.8} Q${EYE_R} ${EYE_Y - 2.2} ${EYE_R + 2.2} ${EYE_Y + 0.8}" />
          </g>
          <g data-part="e-heart">${perEye((x) => `<path class="heart" d="${heart(x, EYE_Y, 1.7)}" /><circle class="shine" cx="${x - 1}" cy="${EYE_Y - 0.6}" r="0.5" />`)}</g>
          <g data-part="e-half">${perEye((x) => `<path class="ink" d="M${x - 2.2} ${EYE_Y - 0.2} h4.4 a2.2 2.2 0 0 1 -4.4 0z" /><path class="line" d="M${x - 2.7} ${EYE_Y - 0.4} h5.4" />`)}</g>
          <g data-part="e-spiral">${perEye((x) => `<path class="line thin" d="${spiral(x)}" />`)}</g>
          <g data-part="e-star">${perEye((x) => `<path class="star" d="${star(x, EYE_Y, 3.2, 1.35)}" />`)}</g>
          <g data-part="e-down">${perEye((x) => roundEye(x, 1.8, 2.2, 0.7).replace(`translate(${x} ${EYE_Y})`, `translate(${x - 0.4} ${EYE_Y + 1.4})`))}</g>
          <g data-part="blush-big">
            <ellipse class="blush strong" cx="11.2" cy="25.4" rx="3.1" ry="1.9" />
            <ellipse class="blush strong" cx="28.8" cy="25.4" rx="3.1" ry="1.9" />
          </g>
          <g data-part="t-joy">
            <path class="tear" d="M11 22.4 q-1.4 1.7 -0.5 2.9 q1.1 0.5 1.3 -0.9 z" />
            <path class="tear" d="M29 22.4 q1.4 1.7 0.5 2.9 q-1.1 0.5 -1.3 -0.9 z" />
          </g>

          <g data-part="b-angry"><path class="line" d="M11.6 16.4 l4.8 2" /><path class="line" d="M28.4 16.4 l-4.8 2" /></g>
          <g data-part="b-worried"><path class="line" d="M12 18.2 l4.4 -1.9" /><path class="line" d="M28 18.2 l-4.4 -1.9" /></g>
          <g data-part="b-raised"><path class="line" d="M12.6 16.2 q2.4 -1.7 4.8 0" /><path class="line" d="M22.6 16.2 q2.4 -1.7 4.8 0" /></g>
          <g data-part="b-confused"><path class="line" d="M12.6 15.6 q2.4 -1.7 4.8 0" /><path class="line" d="M22.8 17.6 h4.4" /></g>

          <g data-part="m-smile"><path class="line" d="M18.1 26.3 Q20 28.3 21.9 26.3" /></g>
          <g data-part="m-open"><path class="mouth" d="M17.5 25.9 Q20 30.6 22.5 25.9 Z" /><ellipse class="tongue" cx="20" cy="27.7" rx="1.2" ry="0.6" /></g>
          <g data-part="m-laugh"><path class="mouth" d="M16.4 25.4 Q20 32.4 23.6 25.4 Z" /><ellipse class="tongue" cx="20" cy="28.6" rx="1.8" ry="0.9" /></g>
          <g data-part="m-o"><ellipse class="mouth" cx="20" cy="27.4" rx="1.4" ry="1.8" /></g>
          <g data-part="m-flat"><path class="line" d="M18.3 27 h3.4" /></g>
          <g data-part="m-frown"><path class="line" d="M17.9 28 Q20 26.1 22.1 28" /></g>
          <g data-part="m-wavy"><path class="line" d="M17.4 27.4 q0.65 -0.9 1.3 0 t1.3 0 t1.3 0 t1.3 0" /></g>
          <g data-part="m-tongue"><path class="line" d="M17.7 26.1 Q20 28.6 22.3 26.1" /><path class="tongue" d="M20.3 27.3 q0 2.2 1.4 1.8 q0.9 -0.4 0.3 -2.2 z" /></g>
          <g data-part="m-kiss"><path class="line" d="M19.5 25.5 q1.9 0.5 0.2 1.25 q1.9 0.5 0 1.35" /></g>
          <g data-part="m-hmm"><path class="line" d="M18.4 27.3 q1.5 -0.7 3.2 -0.2" /></g>
          <g data-part="m-chew"><ellipse class="mouth chew" cx="20" cy="27.2" rx="1.8" ry="1.3" /></g>
          <g data-part="m-smirk"><path class="line" d="M18 27.3 Q20.6 28.1 22.5 25.8" /></g>
          <g data-part="m-cat"><path class="line" d="M17.4 26.3 q1.3 1.6 2.6 0 q1.3 1.6 2.6 0" /></g>
          <g data-part="m-pout"><ellipse class="mouth" cx="21" cy="27.5" rx="0.95" ry="0.8" /></g>
          <g data-part="m-yawn"><ellipse class="mouth" cx="20" cy="27.8" rx="2.1" ry="2.7" /><ellipse class="tongue" cx="20" cy="29.4" rx="1.3" ry="0.7" /></g>
          <g data-part="m-grin"><path class="mouth" d="M16.8 25.6 Q20 30.4 23.2 25.6 Z" /><path class="teeth" d="M17.5 25.95 h5 l-0.35 0.95 h-4.3 z" /></g>

          <g data-part="x-glasses" class="glasses">
            <circle cx="${EYE_L}" cy="${EYE_Y}" r="3.6" />
            <circle cx="${EYE_R}" cy="${EYE_Y}" r="3.6" />
            <path d="M${EYE_L + 3.6} ${EYE_Y - 0.4} q1.4 -1 2.8 0 M${EYE_L - 3.6} ${EYE_Y - 0.6} l-2.6 -0.9 M${EYE_R + 3.6} ${EYE_Y - 0.6} l2.6 -0.9" />
          </g>

          <g class="cos cos-sunglasses">
            <path d="M${EYE_L - 3.4} ${EYE_Y - 1.6} h6.8 v1.6 a3.4 3.1 0 0 1 -6.8 0z" />
            <path d="M${EYE_R - 3.4} ${EYE_Y - 1.6} h6.8 v1.6 a3.4 3.1 0 0 1 -6.8 0z" />
            <path class="bridge" d="M${EYE_L + 3.4} ${EYE_Y - 1.2} h${EYE_R - EYE_L - 6.8}" />
            <path class="glint" d="M${EYE_L - 2.2} ${EYE_Y - 0.6} l1.2 -0.6 M${EYE_R - 2.2} ${EYE_Y - 0.6} l1.2 -0.6" />
          </g>

          <g data-part="t-cry">
            <path class="tear" d="M13.4 22.6 q-0.7 4.6 0.2 9 q1 1.1 1.9 0 q0.5 -4.4 -0.4 -9 z" />
            <path class="tear" d="M26.6 22.6 q0.7 4.6 -0.2 9 q-1 1.1 -1.9 0 q-0.5 -4.4 0.4 -9 z" />
          </g>
        </g>
        </g>
        <g class="robot-only screen-layer" clip-path="url(#${id}-screen)">
          <!-- Bekerja: layar wajah jadi editor kode, baris-baris terketik bergiliran -->
          <g data-part="x-code" class="code">
            <rect class="code-bg" x="9" y="11" width="22" height="20" />
            <rect class="code-gutter" x="9" y="11" width="1.3" height="20" />
            <g class="cl l1"><rect class="kw" x="11.6" y="14.10" width="3.2" height="1.25" rx="0.6" /><rect class="fn" x="15.5" y="14.10" width="5.2" height="1.25" rx="0.6" /><rect class="pn" x="21.4" y="14.10" width="1.4" height="1.25" rx="0.6" /></g>
            <g class="cl l2"><rect class="kw" x="13.2" y="16.85" width="2.4" height="1.25" rx="0.6" /><rect class="tx" x="16.3" y="16.85" width="3.6" height="1.25" rx="0.6" /><rect class="pn" x="20.6" y="16.85" width="1" height="1.25" rx="0.6" /><rect class="st" x="22.3" y="16.85" width="5" height="1.25" rx="0.6" /></g>
            <g class="cl l3"><rect class="fn" x="13.2" y="19.60" width="4.2" height="1.25" rx="0.6" /><rect class="pn" x="18.1" y="19.60" width="1" height="1.25" rx="0.6" /><rect class="nm" x="19.8" y="19.60" width="2.2" height="1.25" rx="0.6" /><rect class="pn" x="22.7" y="19.60" width="1" height="1.25" rx="0.6" /></g>
            <g class="cl l4"><rect class="cm" x="13.2" y="22.35" width="9.6" height="1.25" rx="0.6" /></g>
            <g class="cl l5"><rect class="kw" x="13.2" y="25.10" width="3" height="1.25" rx="0.6" /><rect class="tx" x="16.9" y="25.10" width="4.4" height="1.25" rx="0.6" /><rect class="pn" x="22.0" y="25.10" width="1.2" height="1.25" rx="0.6" /></g>
            <g class="cl l6"><rect class="pn" x="11.6" y="27.85" width="1.4" height="1.25" rx="0.6" /></g>
          </g>
          <!-- Kamu mengetik: layar wajah jadi baris ketikan, huruf muncul satu per satu -->
          <g data-part="x-typebar" class="typebar">
            <rect class="tb-ch c1" x="11.60" y="20" width="1.6" height="2" rx="0.5" /><rect class="tb-ch c2" x="13.90" y="20" width="1.6" height="2" rx="0.5" /><rect class="tb-ch c3" x="16.20" y="20" width="1.6" height="2" rx="0.5" /><rect class="tb-ch c4" x="18.50" y="20" width="1.6" height="2" rx="0.5" /><rect class="tb-ch c5" x="20.80" y="20" width="1.6" height="2" rx="0.5" /><rect class="tb-ch c6" x="23.10" y="20" width="1.6" height="2" rx="0.5" /><rect class="tb-ch c7" x="25.40" y="20" width="1.6" height="2" rx="0.5" />
            <rect class="tb-caret" x="27.8" y="19.2" width="0.8" height="3.6" rx="0.3" />
          </g>
          <!-- Hitung mundur (section Fokus): angka di layar + garis progres tipis -->
          <g class="b-display">
            <rect class="b-display-bg" x="9" y="11" width="22" height="20" />
            <text class="b-display-text" x="20" y="23.3" text-anchor="middle"></text>
            <rect class="b-display-track" x="12.5" y="26.6" width="15" height="1.1" rx="0.55" />
            <rect class="b-display-bar" x="12.5" y="26.6" width="0" height="1.1" rx="0.55" />
          </g>
          <rect class="screen-glass" x="9" y="11" width="22" height="20" rx="4.6" fill="url(#${id}-glass)" />
          <rect class="screen-inset" x="9" y="11" width="22" height="20" rx="4.6" fill="url(#${id}-inset)" />
          <path class="screen-reflect" d="M20.5 11 H25 L14.5 31 H10 Z" />
        </g>
        <g class="band-clip" clip-path="url(#${id}-clip)">
          <g class="cos cos-merahputih">
            <path class="red robot-only" d="M4 8 H36 V9.6 H4 Z" />
            <path class="white robot-only" d="M4 9.6 H36 V11.2 H4 Z" />
          </g>
          <!-- Kain ikat kepala ninja & tali cermin dokter: ikut terpotong bentuk bola -->
          <g class="cos cos-ninja"><path class="cloth robot-only" d="M4 8.4 H36 V11.6 H4 Z" /></g>
          <g class="cos cos-dokter"><path class="strap robot-only" d="M4 10.2 H36" /></g>
        </g>

        <!-- Kilau cahaya: tetap di tempat walau wajah berputar -->
        <circle class="gloss-dot robot-only" cx="12" cy="13.4" r="0.55" />

        <!-- Konser (robot, saat musik): alat musik bergantian, lihat data-gig & buddy.css -->
        <g class="gig gig-guitar robot-only">
          <path class="g-neck" d="M20 31.4 L35.4 21.4" />
          <path class="g-head" d="M34.5 20.4 L37.1 18.7 L38.1 20.2 L35.5 21.9 Z" />
          <circle class="g-body" cx="15" cy="33.6" r="4.8" />
          <circle class="g-body" cx="20" cy="31.4" r="3.6" />
          <circle class="g-hole" cx="17.6" cy="32.6" r="1.4" />
          <path class="g-strings" d="M14.4 34.6 L35 21" />
        </g>

        <!-- Tangan panjang (robot): berpangkal di sisi kepala, pose & gerak per ekspresi (buddy.css) -->
        <g class="arm arm-l robot-only">
          <path class="limb" d="M5.8 25 Q3.6 29 3.4 34" />
          <circle class="hand" cx="3.4" cy="34.4" r="2.1" />
        </g>
        <g class="arm arm-r robot-only">
          <path class="limb" d="M34.2 25 Q36.4 29 36.6 34" />
          <!-- Mic (hanya saat bernyanyi): gagang dari tangan, kepala mic mengarah ke mulut -->
          <g class="mic-prop">
            <path class="mic-handle" d="M36.6 34.4 L33.6 36.4" />
            <circle class="mic-head" cx="32.9" cy="36.9" r="1.7" />
            <path class="mic-grill" d="M31.9 36.4 l1.9 1.2 M32.3 35.7 l1.6 1" />
          </g>
          <circle class="hand" cx="36.6" cy="34.4" r="2.1" />
        </g>

        <g class="cos cos-peci cos-lebaran">
          <path class="peci" d="M9.4 12 C14 8.6 26 8.6 30.6 12 L29.4 3.4 C24.8 0.8 15.2 0.8 10.6 3.4 Z" />
          <path class="peci-line" d="M10 9.6 C15 7.2 25 7.2 30 9.6" />
        </g>
        <g class="cos cos-merahputih-knot">
          <path class="red" d="M35 12.2 l3.2 -1.6 l-0.6 2.6 z M35.2 13.6 l3 1.4 l-2.4 1.2 z" />
        </g>
        <g class="cos cos-party">
          <path class="cone" d="M13.6 9.4 L21.5 -2.5 L27.6 10.6 Z" />
          <path class="stripe" d="M16.2 5.6 L24.8 8.1 M18.8 1.8 L23.1 3.4" />
          <circle class="pom" cx="21.5" cy="-2.6" r="1.7" />
        </g>
        <!-- Ikat kepala ninja: pelat logam polos + dua ujung kain yang berkibar -->
        <g class="cos cos-ninja">
          <g class="tails">
            <path class="cloth" d="M34 13 q3.6 0.2 5.6 3.4 l-1.5 0.8 q-1.6 -2.2 -4.2 -2.4 z" />
            <path class="cloth" d="M33.8 15 q3 1.2 4 4.8 l-1.6 0.4 q-0.8 -2.6 -2.8 -3.6 z" />
          </g>
          <rect class="plate" x="14.4" y="9.6" width="11.2" height="5" rx="1.1" />
          <path class="etch" d="M17.4 12.1 h5.2 M20 10.6 v3" />
          <circle class="rivet" cx="15.6" cy="12.1" r="0.45" />
          <circle class="rivet" cx="24.4" cy="12.1" r="0.45" />
        </g>
        <!-- Helm tentara: kubah loreng + pinggiran -->
        <g class="cos cos-tentara">
          <path class="dome" d="M7.6 12.4 C7.4 2.6 32.6 2.6 32.4 12.4 Z" />
          <path class="spot a" d="M11.4 9.2 q2 -2.4 4.4 -1 q-0.6 2.2 -4.4 1 z M23.4 5.4 q2.8 -1 4 1.4 q-2.4 1 -4 -1.4 z" />
          <path class="spot b" d="M17 5.2 q2.6 -1.6 4.6 0.2 q-2 1.6 -4.6 -0.2 z M26.4 9.8 q2 -1.2 3.4 0.8 q-1.8 1 -3.4 -0.8 z M14.6 11.2 q1.6 -1 3 0.4 q-1.6 0.8 -3 -0.4 z" />
          <path class="brim" d="M5.4 12.4 Q20 10 34.6 12.4 Q35 13.8 33.6 14 Q20 11.8 6.4 14 Q5 13.8 5.4 12.4 Z" />
        </g>
        <!-- Topi Natal: kerucut merah terkulai ke kanan, pinggiran & pompom putih -->
        <g class="cos cos-natal">
          <path class="body" d="M9.6 11.2 Q11.6 2 20.6 0.8 Q30 0 35.2 8 L31.4 11.2 Z" />
          <path class="trim" d="M7.8 10 C14 7.2 26 7.2 32.2 10 Q33.4 11 32.6 12.4 C26 9.8 14 9.8 7.4 12.4 Q6.6 11 7.8 10 Z" />
          <circle class="pom" cx="35.6" cy="8.6" r="2.3" />
        </g>
        <!-- Topi koki: awan putih di atas pita -->
        <g class="cos cos-koki">
          <path class="puff" d="M11.4 9.2 C7.6 8.6 7.8 2.6 12 2.8 C12.4 -1.2 17.6 -1.8 20 0.6 C22.4 -1.8 27.6 -1.2 28 2.8 C32.2 2.6 32.4 8.6 28.6 9.2 Z" />
          <path class="fold" d="M15.4 9 Q15 5.6 16.4 3.6 M24.6 9 Q25 5.6 23.6 3.6" />
          <path class="band" d="M10.6 12.2 C15 10 25 10 29.4 12.2 L29 8.8 C25 7.4 15 7.4 11 8.8 Z" />
        </g>
        <!-- Topi wisuda: papan + jumbai emas yang berayun -->
        <g class="cos cos-wisuda">
          <path class="cap" d="M12.6 12 Q20 9.6 27.4 12 L27.4 7.4 L12.6 7.4 Z" />
          <path class="board" d="M20 2 L35.4 6.2 L20 10.4 L4.6 6.2 Z" />
          <g class="tassel">
            <path class="cord" d="M20 6.2 Q29 6.4 31.6 8.4 V13.2" />
            <rect class="end" x="30.8" y="12.8" width="1.6" height="3.4" rx="0.6" />
          </g>
          <circle class="button" cx="20" cy="6.2" r="0.95" />
        </g>
        <!-- Helm proyek: kuning dengan rusuk -->
        <g class="cos cos-proyek">
          <path class="dome" d="M8 12.2 C8 2.2 32 2.2 32 12.2 Z" />
          <path class="ridge" d="M20 3.2 V11.4 M15.2 4.6 Q14.2 8 14.4 11.6 M24.8 4.6 Q25.8 8 25.6 11.6" />
          <path class="brim" d="M5 12.2 Q20 10 35 12.2 Q35.4 13.6 34 13.8 Q20 11.8 6 13.8 Q4.6 13.6 5 12.2 Z" />
        </g>
        <!-- Topi polisi & pilot: bentuk sama, warna & lencana beda (buddy.css) -->
        <g class="cos cos-cap">
          <path class="crown" d="M6.6 6.8 Q20 0.4 33.4 6.8 Q34 8.8 31.4 9.4 H8.6 Q6 8.8 6.6 6.8 Z" />
          <path class="cap-band" d="M8.6 9.4 H31.4 V11.8 Q20 10.4 8.6 11.8 Z" />
          <path class="visor" d="M9.6 11.6 Q20 10 30.4 11.6 Q27.4 14.6 20 14.2 Q12.6 14.6 9.6 11.6 Z" />
          <path class="badge-star" d="${star(20, 6.6, 1.9, 0.8)}" />
          <path class="badge-wings" d="M20 5.4 l0.9 1.3 l-0.9 1.3 l-0.9 -1.3 z M18.8 6.7 q-2.6 -1.2 -5 -0.6 q2.4 1.4 5 0.6 z M21.2 6.7 q2.6 -1.2 5 -0.6 q-2.4 1.4 -5 0.6 z" />
        </g>
        <!-- Dokter: cermin kepala di dahi -->
        <g class="cos cos-dokter">
          <circle class="mirror" cx="20" cy="9.4" r="3.7" />
          <circle class="hole" cx="20" cy="9.4" r="0.9" />
          <path class="shine" d="M17.8 8.2 q0.8 -1.4 2.4 -1.6" />
        </g>
        <!-- Helm pemadam: merah, lencana depan, pinggiran belakang panjang -->
        <g class="cos cos-pemadam">
          <path class="dome" d="M8 12.2 C8 2.4 32 2.4 32 12.2 Z" />
          <path class="ridge" d="M20 2.6 Q27 3 31.4 9" />
          <path class="brim" d="M4 12.2 Q20 10 36 12.2 L38 14.6 Q20 12 5 13.8 Q3.6 13.4 4 12.2 Z" />
          <path class="shield" d="M17.4 4.6 H22.6 V9 L20 10.8 L17.4 9 Z" />
          <path class="shield-line" d="M20 5.6 V9.4" />
        </g>
        <g class="cos cos-umbrella">
          <path class="stick" d="M33 5 V21 q0 2 -1.8 2" />
          <path class="canopy" d="M21 6.5 Q33 -6.5 45 6.5 Q42 4.4 39 6.5 Q36 4.4 33 6.5 Q30 4.4 27 6.5 Q24 4.4 21 6.5 Z" />
        </g>

        <!-- Headphone: bando berlapis + earcup dengan bantalan & lampu yang berdenyut mengikuti ketukan -->
        <g data-part="x-phones" class="phones">
          <g class="cup-l">
            <rect class="cup" x="1.8" y="16.4" width="6.4" height="11" rx="2.8" />
            <rect class="cushion" x="6.4" y="17.6" width="2.4" height="8.6" rx="1.2" />
            <circle class="led" cx="4.4" cy="21.9" r="1.15" />
          </g>
          <g class="cup-r">
            <rect class="cup" x="31.8" y="16.4" width="6.4" height="11" rx="2.8" />
            <rect class="cushion" x="31.2" y="17.6" width="2.4" height="8.6" rx="1.2" />
            <circle class="led" cx="35.6" cy="21.9" r="1.15" />
          </g>
        </g>
      </g>
      </g>

      <g data-part="x-notes" class="notes">
        <g class="note n1">
          <path d="M33 8.5v-5.2l3.2-0.9v4.8" />
          <circle cx="32.1" cy="8.6" r="1.2" />
          <circle cx="35.3" cy="7.3" r="1.2" />
        </g>
        <g class="note n2">
          <path d="M6.4 9.4v-4.6" />
          <path class="flag" d="M6.4 4.8q2.2 0.6 2 2.6" />
          <circle cx="5.5" cy="9.5" r="1.1" />
        </g>
      </g>
      <g data-part="x-zzz" class="zzz"><text x="31" y="9">z</text><text x="35.5" y="4.5">z</text></g>
      <g data-part="x-vein" class="vein"><path d="M30.6 4.6 q1.6 1.5 0 3 M34 4.6 q-1.6 1.5 0 3 M30.6 9.4 q1.7 -1.5 3.4 0" /></g>
      <g data-part="x-hearts" class="hearts"><path d="${heart(34, 7, 1.3)}" /><path d="${heart(5.5, 10, 1)}" /></g>
      <g data-part="x-q" class="qmark"><text x="32" y="10">?</text><text x="36" y="5.5">?</text></g>
      <g data-part="x-thought" class="thought">
        <circle cx="30.6" cy="12.2" r="0.9" />
        <circle cx="32.8" cy="9.4" r="1.4" />
        <ellipse cx="36" cy="4" rx="5" ry="3.6" />
        <circle class="dot" cx="33.8" cy="4.1" r="0.7" />
        <circle class="dot" cx="36" cy="4.1" r="0.7" />
        <circle class="dot" cx="38.2" cy="4.1" r="0.7" />
      </g>
      <g data-part="x-bang" class="bang"><text x="32" y="10">!</text><text x="35.6" y="7">!</text></g>
      <g data-part="x-clock" class="clockprop">
        <circle cx="35" cy="7.5" r="4.6" />
        <path class="hand hour" d="M35 7.5 v-2.4" />
        <path class="hand minute" d="M35 7.5 h2.9" />
        <circle class="pin" cx="35" cy="7.5" r="0.55" />
      </g>
      <g data-part="x-sparkle" class="sparkle">
        <path d="M33.5 4 l0.8 2 2 0.8 -2 0.8 -0.8 2 -0.8 -2 -2 -0.8 2 -0.8z" />
        <path d="M5 8 l0.5 1.3 1.3 0.5 -1.3 0.5 -0.5 1.3 -0.5 -1.3 -1.3 -0.5 1.3 -0.5z" />
      </g>
      <g class="cos cos-lebaran ketupat">
        <path class="ketupat-body" d="M34.5 1 L38.5 5 L34.5 9 L30.5 5 Z" />
        <path class="ketupat-weave" d="M32.5 3 L36.5 7 M36.5 3 L32.5 7" />
        <path class="ketupat-tail" d="M34.5 9 q-0.6 2 0.4 3.6 M34.5 9 q1 1.8 0.6 3.4" />
      </g>
      <g class="cos cos-party confetti">
        <rect x="4" y="2" width="1.6" height="0.9" />
        <rect x="35" y="0" width="1.6" height="0.9" />
        <rect x="8" y="-1" width="0.9" height="1.6" />
        <rect x="31" y="4" width="0.9" height="1.6" />
      </g>
      <g class="cos cos-umbrella rain">
        <path d="M5 4 l-0.8 2.4 M9 0 l-0.8 2.4 M3 11 l-0.8 2.4 M7 15 l-0.8 2.4" />
      </g>
      <g data-part="x-battery" class="battery">
        <rect class="case" x="30" y="2" width="7.4" height="4.2" rx="1" />
        <rect class="tip" x="37.6" y="3.3" width="0.9" height="1.6" rx="0.3" />
        <rect class="level" x="31" y="3" width="1.4" height="2.2" rx="0.3" />
      </g>
      <g data-part="x-bolt" class="bolt"><path d="M35.6 0.4 L31.6 6.4 H34.4 L33.2 11 L37.8 4.6 H35 Z" /></g>
      <g data-part="x-plug" class="plug">
        <path class="prong" d="M33.2 1 v2.6 M36.2 1 v2.6" />
        <rect class="head" x="31.8" y="3.4" width="5.8" height="4.2" rx="1.2" />
        <path class="cord" d="M34.7 7.6 q0 2.4 -2.2 3.4" />
      </g>
      <g data-part="x-bt" class="bt">
        <circle cx="34.8" cy="6" r="4.8" />
        <path d="M32.9 4.2 L36.6 7.6 L34.8 9.3 V2.7 L36.6 4.4 L32.9 7.8" />
      </g>
      <g data-part="x-waves" class="waves">
        <path d="M34.5 15.5 q1.6 2.2 0 4.4" />
        <path d="M36.8 13.8 q2.6 3.9 0 7.8" />
        <path d="M5.5 15.5 q-1.6 2.2 0 4.4" />
        <path d="M3.2 13.8 q-2.6 3.9 0 7.8" />
      </g>
      <g data-part="x-food" class="food">
        <circle class="bubble" cx="30.6" cy="12.2" r="0.9" />
        <circle class="bubble" cx="32.8" cy="9.4" r="1.4" />
        <ellipse class="bubble" cx="36" cy="4" rx="5" ry="3.6" />
        <circle class="cookie" cx="36" cy="4" r="2.3" />
        <circle class="chip" cx="35.2" cy="3.3" r="0.4" />
        <circle class="chip" cx="36.9" cy="4.4" r="0.4" />
        <circle class="chip" cx="35.6" cy="5" r="0.35" />
      </g>
      <g data-part="x-crumbs" class="crumbs">
        <circle cx="16" cy="33" r="0.5" />
        <circle cx="23.5" cy="32" r="0.45" />
        <circle cx="19.5" cy="35" r="0.4" />
      </g>
      <g data-part="x-sweat" class="sweat"><path d="M33 10 q-2.2 3.4 0 4.6 q2.2 -1.2 0 -4.6 z" /></g>
      <g data-part="x-stars" class="stars">
        <path d="${star(11, 7, 1.7, 0.75)}" />
        <path d="${star(29, 7, 1.7, 0.75)}" />
        <path d="${star(20, 2.6, 1.4, 0.6)}" />
        <path d="${star(20, 11.4, 1.2, 0.5)}" />
      </g>
    `;
  }

  let counter = 0;

  function createBuddy() {
    const id = `buddy${++counter}`;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-1 -2 42 42');
    svg.setAttribute('class', 'buddy');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = markup(id);

    const parts = [...svg.querySelectorAll('[data-part]')];
    const face = svg.querySelector('.b-face');
    const robot = svg.querySelector('.sphere.robot-only');
    let shape = 'robot';
    let mood = null;

    // Kostum: lapisan terpisah dari ekspresi (peci, party, umbrella, …) atau null.
    // Zeno berbentuk robot (kepala layar + tangan panjang): wajah & kostum dipotong bentuk layar/kepala.
    function setShape() {
      svg.dataset.shape = shape;
      svg.querySelector('.face-clip').setAttribute('clip-path', `url(#${id}-screen)`);
      svg.querySelector('.band-clip').setAttribute('clip-path', `url(#${id}-head)`);
      turnRobot(0, 0);
    }

    // Air di layar: level 0–1 (null = tidak ada air). Layar setinggi 20 unit (y 11–31).
    const waterLevel = svg.querySelector('.b-water-level');
    const bubbles = [...svg.querySelectorAll('.b-bubble')];
    function setWater(level) {
      if (level == null) {
        delete svg.dataset.water;
        return;
      }
      const shown = Math.min(1, Math.max(0, level));
      const surface = 31 - shown * 20;
      svg.dataset.water = shown >= 1 ? 'full' : shown > 0 ? 'some' : 'none';
      waterLevel.style.transform = `translateY(${surface.toFixed(2)}px)`;
      // Gelembung mulai dari dasar layar, naik sampai tepat di bawah permukaan.
      const depth = 31 - surface;
      for (const bubble of bubbles) {
        bubble.setAttribute('cy', (depth - 1).toFixed(2));
        bubble.style.setProperty('--rise', `${-Math.max(0, depth - 3).toFixed(2)}px`);
      }
    }

    // Layar jadi tampilan angka (mis. hitung mundur fokus): text null = kembali ke wajah.
    // tone: 'run' | 'idle' | 'paused' | 'final' | 'rest'; progress 0–1 = garis di bawah angka.
    const displayText = svg.querySelector('.b-display-text');
    const displayBar = svg.querySelector('.b-display-bar');
    function setDisplay(text, progress = 0, tone = 'run') {
      if (text == null) {
        delete svg.dataset.display;
        return;
      }
      svg.dataset.display = tone;
      if (displayText.textContent !== text) {
        displayText.textContent = text;
        // "25:00" muat 7; "1:30:00" perlu lebih kecil supaya tetap di dalam layar.
        displayText.setAttribute('font-size', text.length > 5 ? '4.8' : '7');
      }
      displayBar.setAttribute('width', (15 * Math.min(1, Math.max(0, progress))).toFixed(2));
    }

    function setCostume(name) {
      if (name) svg.dataset.costume = name;
      else delete svg.dataset.costume;
    }

    const GIGS = ['mic', 'guitar'];
    let gigTimer = null;
    function updateGig() {
      clearInterval(gigTimer);
      gigTimer = null;
      if (mood !== 'music') {
        delete svg.dataset.gig;
        return;
      }
      let i = Math.floor(Math.random() * GIGS.length);
      svg.dataset.gig = GIGS[i];
      gigTimer = setInterval(() => {
        i = (i + 1) % GIGS.length;
        svg.dataset.gig = GIGS[i];
      }, 12000);
    }

    function setMood(next) {
      if (!(next in MOODS) || next === mood) return;
      mood = next;
      svg.dataset.mood = next;
      updateGig();
      const visible = new Set(MOODS[next]);
      for (const part of parts) part.classList.toggle('on', visible.has(part.dataset.part));
      robot.setAttribute('fill', `url(#${id}-${next === 'angry' ? 'robot-angry' : 'robot'})`);
    }

    // lx, ly = arah kursor (-1..1). Wajah bergeser & miring seperti bola yang menoleh,
    // sedikit memipih di tepi (perspektif), pupil bergerak sedikit lebih jauh.
    // Robot menengok sebadan: muka depan (layar, wajah, kostum) bergeser & menyempit ke arah
    // tengokan, sisi kubus muncul di sisi berlawanan, tangan ikut bergeser.
    const turnEls = () => svg.querySelectorAll('.sphere.robot-only, .robot-bevel, .screen-rim, .screen, .b-water, .face-clip, .screen-layer, .band-clip, .gloss-dot.robot-only, :scope > .b-body > .cos');
    function turnRobot(lx, ly) {
      const on = shape === 'robot';
      const front = on ? `translate(${(lx * 1.5).toFixed(2)}px, ${(ly * 0.9).toFixed(2)}px) scale(${(1 - Math.abs(lx) * 0.06).toFixed(3)}, ${(1 - Math.abs(ly) * 0.04).toFixed(3)})` : '';
      for (const el of turnEls()) el.style.transform = front;
      const depth = svg.querySelector('.robot-depth');
      if (depth) depth.style.transform = on ? `translate(${(-lx * 2.8).toFixed(2)}px, ${(-ly * 1.4).toFixed(2)}px)` : '';
      for (const arm of svg.querySelectorAll('.arm')) arm.style.translate = on ? `${(lx * 1.1).toFixed(2)}px ${(ly * 0.5).toFixed(2)}px` : '';
    }

    function look(lx, ly) {
      turnRobot(lx, ly);
      const sx = 1 - Math.abs(lx) * 0.1;
      const sy = 1 - Math.abs(ly) * 0.1;
      face.style.transform =
        `translate(${(lx * 3.4).toFixed(2)}px, ${(ly * 2.6).toFixed(2)}px) ` +
        `rotate(${(lx * 8).toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      for (const pupil of svg.querySelectorAll('.pupil')) {
        pupil.style.transform = `translate(${(lx * 0.7).toFixed(2)}px, ${(ly * 0.7).toFixed(2)}px)`;
      }
    }

    // Animasi ganti wujud (dipakai saat swipe halaman).
    function morph() {
      svg.classList.remove('morph', 'jump');
      void svg.getBoundingClientRect();
      svg.classList.add('morph');
    }

    function jump() {
      svg.classList.remove('jump');
      void svg.getBoundingClientRect(); // mulai ulang animasi
      svg.classList.add('jump');
    }

    // Gerak sekali jalan: spin (berputar), boing (pipi dicolek), wobble (kepala dielus).
    const ONE_SHOT = { spin: 'buddy-flip', boing: 'buddy-boing', pat: 'buddy-pat' };
    function play(name) {
      if (!(name in ONE_SHOT)) return;
      svg.classList.remove('jump', 'morph', ...Object.keys(ONE_SHOT));
      void svg.getBoundingClientRect();
      svg.classList.add(name);
    }

    // Ditahan (dipencet): tetap gepeng sampai dilepas.
    function hold(on) {
      svg.classList.toggle('held', Boolean(on));
    }

    svg.addEventListener('animationend', (event) => {
      if (event.animationName === 'buddy-jump') svg.classList.remove('jump');
      if (event.animationName === 'buddy-morph') svg.classList.remove('morph');
      for (const [name, animation] of Object.entries(ONE_SHOT)) {
        if (event.animationName === animation) svg.classList.remove(name);
      }
    });

    setMood('idle');
    setShape();
    return { el: svg, setMood, setCostume, setWater, setDisplay, look, jump, morph, play, hold, get mood() { return mood; }, get shape() { return shape; } };
  }

  window.createBuddy = createBuddy;
  window.BUDDY_MOODS = Object.keys(MOODS);
})();
