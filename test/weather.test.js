'use strict';

// Uji olahan cuaca Open-Meteo (lib/weather.js): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { parseForecast, advice } = require('../lib/weather');

const hourly = (codes, rain, temps) => ({
  time: codes.map((_, i) => `2026-10-19T${String(10 + i).padStart(2, '0')}:00`),
  weather_code: codes,
  precipitation_probability: rain,
  temperature_2m: temps,
  is_day: codes.map((_, i) => (10 + i < 18 ? 1 : 0)),
});

const sample = {
  current: { temperature_2m: 32.9, apparent_temperature: 37.4, relative_humidity_2m: 45, weather_code: 3, is_day: 1, wind_speed_10m: 5.1 },
  hourly: hourly([3, 3, 3, 3, 3, 2, 2, 53, 53], [0, 0, 2, 6, 13, 24, 30, 46, 73], [32.6, 33.7, 34.9, 35.8, 36.7, 36.3, 34.3, 31, 28.9]),
  daily: { temperature_2m_max: [36.7], temperature_2m_min: [23.4], sunrise: ['2026-10-19T05:29'], sunset: ['2026-10-19T17:48'], uv_index_max: [9.2] },
};

test('ramalan diolah: 12 jam ke depan, min/maks, matahari', () => {
  const w = parseForecast(sample);
  assert.equal(w.temperature, 33);
  assert.equal(w.hours.length, 8);
  assert.deepEqual(w.hours[0], { hour: '11', temperature: 34, rain: 0, isDay: true, text: 'Berawan', kind: 'cloud' });
  assert.deepEqual(w.next, w.hours.slice(0, 3));
  assert.equal(w.max, 37);
  assert.equal(w.uv, 9);
  assert.equal(w.sunrise, '05.29');
  assert.equal(w.sunset, '17.48');
  assert.equal(w.wind, 5);
});

test('saran: hujan nanti, terik, UV', () => {
  const tips = advice(parseForecast(sample));
  assert.deepEqual(tips.map((t) => t.icon), ['rain', 'hot', 'uv']);
  assert.match(tips[0].text, /mulai 17\.00/);
  assert.match(tips[1].text, /37° sekitar 14\.00/);
});

test('saran: sedang hujan, angin, dan cuaca aman', () => {
  assert.equal(advice({ kind: 'rain', temperature: 25, hours: [] })[0].icon, 'rain');
  assert.deepEqual(advice({ kind: 'cloud', temperature: 26, wind: 35, hours: [] }).map((t) => t.icon), ['wind']);
  assert.deepEqual(advice({ kind: 'clear', temperature: 28, uv: 3, hours: [{ hour: '12', temperature: 29, rain: 10, kind: 'clear' }] }).map((t) => t.icon), ['ok']);
  assert.deepEqual(advice(null), []);
});
