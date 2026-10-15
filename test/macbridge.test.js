'use strict';

// Uji pengurai keluaran perintah macOS (bisa dijalankan di Windows): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { parseVoices, parseWifiDevice, parseWifiPower, parseTrack, parseVolume } = require('../lib/macbridge');

test('daftar suara dari `say -v ?`', () => {
  const out = [
    'Alex                en_US    # Most people recognize me by my voice.',
    'Damayanti           id_ID    # Halo, nama saya Damayanti. Saya suara Bahasa Indonesia.',
    'Eddy (English (US)) en_US    # Hello! My name is Eddy.',
    'Flo (Bahasa Indonesia) id_ID    # Halo! Nama saya Flo.',
    '',
  ].join('\n');
  const voices = parseVoices(out);
  assert.equal(voices.length, 4);
  assert.deepEqual(voices[1], { id: 'Damayanti', name: 'Damayanti', lang: 'id-ID' });
  assert.equal(voices[3].id, 'Flo (Bahasa Indonesia)');
  assert.equal(voices[3].lang, 'id-ID');
});

test('perangkat Wi-Fi dari networksetup', () => {
  const out = 'Hardware Port: Thunderbolt Bridge\nDevice: bridge0\nEthernet Address: N/A\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa:bb\n';
  assert.equal(parseWifiDevice(out), 'en0');
  assert.equal(parseWifiDevice('Hardware Port: Ethernet\nDevice: en5\n'), null);
  assert.equal(parseWifiPower('Wi-Fi Power (en0): On\n'), 'On');
  assert.equal(parseWifiPower('Wi-Fi Power (en0): Off'), 'Off');
  assert.equal(parseWifiPower(null), null);
});

test('lagu dari skrip musik', () => {
  assert.deepEqual(parseTrack('Spotify\tplaying\tLofi Coding\tChill Beats\thttps://i.scdn.co/image/x\n'), {
    app: 'Spotify',
    state: 'playing',
    title: 'Lofi Coding',
    artist: 'Chill Beats',
    art: 'https://i.scdn.co/image/x',
  });
  assert.equal(parseTrack(''), null);
  assert.equal(parseTrack('\n'), null);
});

test('volume dari AppleScript', () => {
  assert.deepEqual(parseVolume('45,false\n'), { volume: 45, muted: false });
  assert.deepEqual(parseVolume('0,true'), { volume: 0, muted: true });
  // Output audio tanpa kontrol volume (mis. HDMI) memberi "missing value".
  assert.deepEqual(parseVolume('missing value,missing value'), { volume: null, muted: false });
  assert.deepEqual(parseVolume(null), { volume: null, muted: false });
});
