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
    listen: ['e-open', 'm-smile', 'blush', 'x-phones'],
    greet: ['e-happy', 'm-open', 'blush', 'x-sparkle'],
    clock: ['e-up', 'm-smile', 'blush', 'x-clock'],
    lowbat: ['e-closed', 'm-wavy', 'x-battery', 'x-sweat'],
    hear: ['e-wide', 'm-o', 'blush', 'x-waves'],
    hungry: ['e-open', 'm-wavy', 'b-worried', 'x-food'],
    eat: ['e-happy', 'm-chew', 'blush', 'x-crumbs'],
    stretch: ['e-happy', 'm-open', 'blush', 'x-sparkle'],
  };

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
        <radialGradient id="${id}-ball" cx="38%" cy="32%" r="72%">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.38" stop-color="#e3f0ff" />
          <stop offset="0.78" stop-color="#a8ccf6" />
          <stop offset="1" stop-color="#6c9fe0" />
        </radialGradient>
        <radialGradient id="${id}-angry" cx="38%" cy="32%" r="72%">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.38" stop-color="#ffe1e1" />
          <stop offset="0.78" stop-color="#f7a3a3" />
          <stop offset="1" stop-color="#e05a5a" />
        </radialGradient>
        <clipPath id="${id}-clip"><circle cx="${CX}" cy="${CY}" r="15" /></clipPath>
      </defs>

      <g class="b-body">
        <circle class="sphere" cx="${CX}" cy="${CY}" r="15" fill="url(#${id}-ball)" />

        <g clip-path="url(#${id}-clip)">
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
          <g class="cos cos-merahputih">
            <path class="red" d="M4 11.5 C12 8 28 8 36 11.5 V14 C28 10.6 12 10.6 4 14 Z" />
            <path class="white" d="M4 14 C12 10.6 28 10.6 36 14 V16.4 C28 13 12 13 4 16.4 Z" />
          </g>
        </g>

        <!-- Kilau cahaya: tetap di tempat walau wajah berputar -->
        <ellipse class="gloss" cx="15" cy="13.2" rx="3.4" ry="1.9" transform="rotate(-30 15 13.2)" />
        <circle class="gloss-dot" cx="11.6" cy="16.6" r="0.75" />

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
        <g class="cos cos-umbrella">
          <path class="stick" d="M33 5 V21 q0 2 -1.8 2" />
          <path class="canopy" d="M21 6.5 Q33 -6.5 45 6.5 Q42 4.4 39 6.5 Q36 4.4 33 6.5 Q30 4.4 27 6.5 Q24 4.4 21 6.5 Z" />
        </g>

        <g data-part="x-phones" class="phones">
          <path class="band" d="M5.4 21 Q20 -2 34.6 21" />
          <rect class="cup" x="2.6" y="17.6" width="4.8" height="8.6" rx="2.2" />
          <rect class="cup" x="32.6" y="17.6" width="4.8" height="8.6" rx="2.2" />
        </g>
      </g>

      <g data-part="x-notes" class="notes">
        <path d="M33 8.5v-5.2l3.2-0.9v4.8" />
        <circle cx="32.1" cy="8.6" r="1.2" />
        <circle cx="35.3" cy="7.3" r="1.2" />
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
        <rect class="shell" x="30" y="2" width="7.4" height="4.2" rx="1" />
        <rect class="tip" x="37.6" y="3.3" width="0.9" height="1.6" rx="0.3" />
        <rect class="level" x="31" y="3" width="1.4" height="2.2" rx="0.3" />
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
    const sphere = svg.querySelector('.sphere');
    let mood = null;

    // Kostum: lapisan terpisah dari ekspresi (peci, party, umbrella, …) atau null.
    function setCostume(name) {
      if (name) svg.dataset.costume = name;
      else delete svg.dataset.costume;
    }

    function setMood(next) {
      if (!(next in MOODS) || next === mood) return;
      mood = next;
      svg.dataset.mood = next;
      const visible = new Set(MOODS[next]);
      for (const part of parts) part.classList.toggle('on', visible.has(part.dataset.part));
      sphere.setAttribute('fill', `url(#${id}-${next === 'angry' ? 'angry' : 'ball'})`);
    }

    // lx, ly = arah kursor (-1..1). Wajah bergeser & miring seperti bola yang menoleh,
    // sedikit memipih di tepi (perspektif), pupil bergerak sedikit lebih jauh.
    function look(lx, ly) {
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

    svg.addEventListener('animationend', (event) => {
      if (event.animationName === 'buddy-jump') svg.classList.remove('jump');
      if (event.animationName === 'buddy-morph') svg.classList.remove('morph');
    });

    setMood('idle');
    return { el: svg, setMood, setCostume, look, jump, morph, get mood() { return mood; } };
  }

  window.createBuddy = createBuddy;
  window.BUDDY_MOODS = Object.keys(MOODS);
})();
