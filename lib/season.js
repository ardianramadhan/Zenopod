'use strict';

// Kostum Zeno menurut tanggal (Masehi & Hijriah), ulang tahun, dan cuaca.
// Kostum: peci | lebaran (peci + ketupat) | merahputih | party | umbrella | sunglasses | null

const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric' });

function hijri(date) {
  const parts = Object.fromEntries(HIJRI.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: Number(parts.day), month: Number(parts.month) };
}

const COSTUMES = {
  peci: 'Peci',
  lebaran: 'Peci & ketupat',
  merahputih: 'Ikat kepala merah putih',
  party: 'Topi pesta',
  umbrella: 'Payung',
  sunglasses: 'Kacamata hitam',
};

// Urutan prioritas: hari besar > ulang tahun > Ramadan > Jumat.
// (Payung/kacamata hitam hanya di halaman Cuaca, lihat weather.weatherLook.)
function seasonalCostume(date = new Date(), { birthday = '' } = {}) {
  const h = hijri(date);
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if ((h.month === 10 && h.day <= 3) || (h.month === 12 && h.day >= 10 && h.day <= 13)) {
    return { costume: 'lebaran', reason: h.month === 10 ? 'Idul Fitri' : 'Idul Adha' };
  }
  if (m === 8 && d === 17) return { costume: 'merahputih', reason: 'Hari Kemerdekaan' };
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) return { costume: 'party', reason: 'Tahun baru' };
  if (birthday && birthday.slice(5) === `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`) {
    return { costume: 'party', reason: 'Ulang tahun' };
  }
  if (h.month === 9) return { costume: 'peci', reason: 'Ramadan' };
  if (date.getDay() === 5) return { costume: 'peci', reason: 'Jumat' };
  return { costume: null, reason: '' };
}

// mode: 'auto' | 'none' | nama kostum (pilihan manual)
function costumeFor(mode, context) {
  if (mode === 'none') return { costume: null, reason: '' };
  if (mode && mode !== 'auto' && COSTUMES[mode]) return { costume: mode, reason: 'Pilihan sendiri' };
  return seasonalCostume(new Date(), context);
}

module.exports = { COSTUMES, costumeFor, seasonalCostume, hijri };
