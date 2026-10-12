'use strict';

// Kalkulator & durasi untuk kotak cari / perintah suara. Parser sendiri (tanpa eval).
// Mendukung + - * / x × ÷ % ^ dan kurung; koma atau titik sebagai desimal.

// Gaya Indonesia: "250.000" = 250 ribu, "1.250.000,5" = koma desimal; "2.5" tetap 2,5.
function parseNumber(raw) {
  if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ''));
  return Number(raw);
}

function tokenize(text) {
  const tokens = [];
  const src = text.replace(/\s+/g, '').replace(/[x×]/gi, '*').replace(/÷|:/g, '/');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.,]/.test(src[j])) j++;
      const n = parseNumber(src.slice(i, j));
      if (!Number.isFinite(n)) return null;
      tokens.push(n);
      i = j;
    } else if ('+-*/%^()'.includes(c)) {
      tokens.push(c);
      i++;
    } else {
      return null;
    }
  }
  return tokens;
}

// expr := term (('+'|'-') term)* ; term := power (('*'|'/'|'%') power)* ; power := unary ('^' power)?
function evaluate(text) {
  const tokens = tokenize(String(text));
  if (!tokens || !tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];

  function primary() {
    const t = take();
    if (typeof t === 'number') return t;
    if (t === '(') {
      const v = expr();
      if (take() !== ')') throw new Error('kurung');
      return v;
    }
    throw new Error('token');
  }
  function unary() {
    if (peek() === '-') {
      take();
      return -unary();
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return primary();
  }
  function power() {
    const base = unary();
    if (peek() === '^') {
      take();
      return base ** power();
    }
    return base;
  }
  function term() {
    let v = power();
    while (['*', '/', '%'].includes(peek())) {
      const op = take();
      // "50%" di akhir / sebelum operator = persen; "10 % 3" = sisa bagi.
      if (op === '%' && (pos >= tokens.length || typeof peek() !== 'number')) {
        v = v / 100;
        continue;
      }
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  }

  try {
    const value = expr();
    if (pos !== tokens.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

// Teks terlihat seperti hitungan: diawali "=", atau angka dengan setidaknya satu operator.
function looksLikeMath(text) {
  const t = String(text).trim();
  if (t.startsWith('=')) return true;
  return /^[\d\s.,()+\-*/x×÷%^]+$/i.test(t) && /\d\s*[+\-*/x×÷%^]\s*[\d(]|\d%$/.test(t);
}

function format(value) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 }).format(value);
}

// "10 menit", "1 jam 30 menit", "30 detik", "90" (= menit) → milidetik.
function parseDuration(text) {
  const t = String(text).toLowerCase();
  let ms = 0;
  let found = false;
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(jam|j|h|menit|mnt|m|detik|dtk|d|s)\b/g)) {
    const n = Number(m[1].replace(',', '.'));
    const unit = m[2];
    ms += n * (/^(jam|j|h)$/.test(unit) ? 3_600_000 : /^(detik|dtk|d|s)$/.test(unit) ? 1000 : 60_000);
    found = true;
  }
  if (!found) {
    const bare = t.match(/(\d+(?:[.,]\d+)?)/);
    if (bare) ms = Number(bare[1].replace(',', '.')) * 60_000;
  }
  return ms > 0 && ms <= 24 * 3_600_000 ? Math.round(ms) : null;
}

function durationLabel(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h ? `${h} jam` : '', m ? `${m} menit` : '', sec ? `${sec} detik` : ''].filter(Boolean).join(' ') || '0 detik';
}

module.exports = { evaluate, looksLikeMath, format, parseDuration, durationLabel };
