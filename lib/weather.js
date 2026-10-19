'use strict';

// Cuaca dari Open-Meteo (gratis, tanpa API key). Yang dikirim hanya nama kota (cari) dan koordinat.

// Kode cuaca WMO → teks + jenis.
function describe(code) {
  if (code === 0) return { text: 'Cerah', kind: 'clear' };
  if (code <= 2) return { text: 'Cerah berawan', kind: 'cloud' };
  if (code === 3) return { text: 'Berawan', kind: 'cloud' };
  if (code === 45 || code === 48) return { text: 'Berkabut', kind: 'fog' };
  if (code >= 51 && code <= 57) return { text: 'Gerimis', kind: 'rain' };
  if (code >= 61 && code <= 67) return { text: 'Hujan', kind: 'rain' };
  if (code >= 80 && code <= 82) return { text: 'Hujan lokal', kind: 'rain' };
  if (code >= 95) return { text: 'Hujan petir', kind: 'storm' };
  return { text: 'Berawan', kind: 'cloud' };
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=id&name=${encodeURIComponent(name)}`;
  const data = await getJson(url);
  return (data.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

async function currentWeather({ latitude, longitude }) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day&forecast_hours=13' +
    '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&forecast_days=1&timezone=auto';
  return parseForecast(await getJson(url));
}

// Jawaban Open-Meteo → bentuk yang dipakai Zenopod (diuji di test/weather.test.js).
function parseForecast(data) {
  const c = data.current;
  const h = data.hourly ?? {};
  const d = data.daily ?? {};
  // Jam pertama = jam sekarang; ambil 12 jam berikutnya.
  const hours = (h.time ?? []).slice(1, 13).map((time, i) => ({
    hour: time.slice(11, 13),
    temperature: Math.round(h.temperature_2m[i + 1]),
    rain: h.precipitation_probability?.[i + 1] ?? null,
    isDay: h.is_day ? h.is_day[i + 1] === 1 : null,
    ...describe(h.weather_code[i + 1]),
  }));
  const clock = (iso) => (iso ? iso.slice(11, 16).replace(':', '.') : null);
  return {
    temperature: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : null,
    code: c.weather_code,
    isDay: c.is_day === 1,
    ...describe(c.weather_code),
    hours,
    next: hours.slice(0, 3),
    max: d.temperature_2m_max?.[0] != null ? Math.round(d.temperature_2m_max[0]) : null,
    min: d.temperature_2m_min?.[0] != null ? Math.round(d.temperature_2m_min[0]) : null,
    uv: d.uv_index_max?.[0] != null ? Math.round(d.uv_index_max[0]) : null,
    sunrise: clock(d.sunrise?.[0]),
    sunset: clock(d.sunset?.[0]),
    at: Date.now(),
  };
}

// Analisa singkat untuk halaman Cuaca: [{ icon, text }], paling penting dulu, maks. 3.
function advice(w) {
  if (!w) return [];
  const tips = [];
  const hours = w.hours ?? [];
  const wet = hours.find((h) => h.rain >= 50 || h.kind === 'rain' || h.kind === 'storm');
  if (w.kind === 'storm') tips.push({ icon: 'storm', text: 'Ada petir, sebaiknya di dalam ruangan dulu.' });
  else if (w.kind === 'rain') tips.push({ icon: 'rain', text: 'Sedang hujan, bawa payung kalau keluar.' });
  else if (wet) {
    const chance = wet.rain != null ? ` (${wet.rain}%)` : '';
    tips.push({ icon: 'rain', text: `Hujan kemungkinan mulai ${wet.hour}.00${chance}, siapkan payung.` });
  }
  const hottest = hours.reduce((a, b) => (b.temperature > (a?.temperature ?? -99) ? b : a), null);
  const peak = Math.max(w.temperature, hottest?.temperature ?? -99);
  if (peak >= 33) {
    const when = hottest && hottest.temperature >= w.temperature ? ` sekitar ${hottest.hour}.00` : ' sekarang';
    tips.push({ icon: 'hot', text: `Terik, puncaknya ${peak}°${when}. Minum air lebih sering.` });
  }
  if (w.uv >= 8) tips.push({ icon: 'uv', text: `UV sangat tinggi (${w.uv}), pakai tabir surya kalau keluar siang.` });
  else if (w.uv >= 6) tips.push({ icon: 'uv', text: `UV tinggi (${w.uv}) di siang hari.` });
  if (w.wind >= 30) tips.push({ icon: 'wind', text: `Angin cukup kencang (${w.wind} km/j).` });
  if (!tips.length) tips.push({ icon: 'ok', text: 'Cuaca bersahabat untuk beraktivitas.' });
  return tips.slice(0, 3);
}

// Wujud Zeno di halaman Cuaca.
function weatherLook(w) {
  if (!w) return { mood: 'idle', costume: null };
  if (w.kind === 'storm') return { mood: 'surprised', costume: 'umbrella' };
  if (w.kind === 'rain') return { mood: 'idle', costume: 'umbrella' };
  if (w.temperature >= 33) return { mood: 'smug', costume: 'sunglasses' };
  if (w.kind === 'fog') return { mood: 'confused', costume: null };
  if (w.kind === 'clear') return { mood: 'happy', costume: null };
  return { mood: 'idle', costume: null };
}

module.exports = { searchCity, currentWeather, parseForecast, advice, describe, weatherLook };
