'use strict';

// Layar beku (tangkapan dari proses utama) + kotak pilihan.
// Lepas mouse = kirim kotak (piksel CSS jendela); Esc / klik kanan = batal.

const $ = (id) => document.getElementById(id);
const box = $('box');
let start = null;
let rect = null;

window.snip.onImage((dataUrl) => {
  $('shot').src = dataUrl;
});

function draw(x, y) {
  rect = {
    x: Math.min(start.x, x),
    y: Math.min(start.y, y),
    width: Math.abs(x - start.x),
    height: Math.abs(y - start.y),
  };
  Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  box.hidden = false;
}

document.addEventListener('pointerdown', (event) => {
  if (event.button === 2) return window.snip.done(null);
  if (event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY };
  rect = null;
  document.body.setPointerCapture?.(event.pointerId);
  document.body.classList.add('selecting');
  draw(event.clientX, event.clientY);
});

document.addEventListener('pointermove', (event) => {
  if (start) draw(event.clientX, event.clientY);
});

document.addEventListener('pointerup', () => {
  if (!start) return;
  start = null;
  // Klik tanpa seret = belum memilih apa-apa.
  if (!rect || rect.width < 6 || rect.height < 6) {
    box.hidden = true;
    document.body.classList.remove('selecting');
    return;
  }
  window.snip.done(rect);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.snip.done(null);
});
document.addEventListener('contextmenu', (event) => event.preventDefault());
