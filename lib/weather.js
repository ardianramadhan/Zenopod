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
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=4&timezone=auto';
  const data = await getJson(url);
  const c = data.current;
  const h = data.hourly ?? {};
  // Jam pertama = jam sekarang; ambil 3 jam berikutnya.
  const next = (h.time ?? []).slice(1, 4).map((time, i) => ({
    hour: time.slice(11, 13),
    temperature: Math.round(h.temperature_2m[i + 1]),
    rain: h.precipitation_probability?.[i + 1] ?? null,
    ...describe(h.weather_code[i + 1]),
  }));
  return {
    temperature: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    code: c.weather_code,
    isDay: c.is_day === 1,
    ...describe(c.weather_code),
    next,
    at: Date.now(),
  };
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

module.exports = { searchCity, currentWeather, describe, weatherLook };
