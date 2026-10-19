'use strict';

// Uji pengurai keluaran perintah macOS (bisa dijalankan di Windows): node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { parseVoices, parseWifiDevice, parseWifiPower, parseTrack, parseVolume, parseBluetooth, parseUsb } = require('../lib/macbridge');

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
    position: 0,
    duration: null,
  });
  assert.deepEqual(parseTrack('Music\tpaused\tSial\tMahalini\t\t61250\t245000'), {
    app: 'Music',
    state: 'paused',
    title: 'Sial',
    artist: 'Mahalini',
    art: '',
    position: 61250,
    duration: 245000,
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

test('perangkat Bluetooth tersambung dari system_profiler', () => {
  const out = JSON.stringify({
    SPBluetoothDataType: [
      {
        controller_properties: { controller_state: 'attrib_on' },
        device_connected: [
          { 'AirPods Pro': { device_address: 'AA:BB', device_minorType: 'Headphones' } },
          { 'Magic Mouse': { device_address: 'CC:DD', device_minorType: 'Mouse' } },
        ],
        device_not_connected: [{ 'Speaker Lama': { device_address: 'EE:FF', device_minorType: 'Speaker' } }],
      },
    ],
  });
  assert.deepEqual(parseBluetooth(out), [
    { id: 'AA:BB', name: 'AirPods Pro', kind: 'audio', battery: null },
    { id: 'CC:DD', name: 'Magic Mouse', kind: 'input', battery: null },
  ]);
  assert.deepEqual(parseBluetooth('bukan json'), []);
  assert.deepEqual(parseBluetooth(JSON.stringify({ SPBluetoothDataType: [{}] })), []);
});

test('perangkat USB dari system_profiler (tanpa hub & bawaan)', () => {
  const out = JSON.stringify({
    SPUSBDataType: [
      {
        _name: 'USB31Bus',
        _items: [
          { _name: 'USB3.1 Hub', vendor_id: '0x05e3', _items: [{ _name: 'USB Receiver', vendor_id: '0x046d', product_id: '0xc52b', serial_num: 'X1' }] },
          { _name: 'SanDisk Ultra', vendor_id: '0x0781', product_id: '0x5581', Media: [{}] },
          { _name: 'iPhone', vendor_id: '0x05ac', product_id: '0x12a8', serial_num: 'P1' },
          { _name: 'FaceTime HD Camera', vendor_id: '0x05ac', built_in: 'Yes' },
        ],
      },
    ],
  });
  assert.deepEqual(
    parseUsb(out).map((d) => [d.name, d.kind]),
    [['USB Receiver', 'mouse'], ['SanDisk Ultra', 'storage'], ['iPhone', 'phone']],
  );
  assert.deepEqual(parseUsb(''), []);
});

test('baterai perangkat Bluetooth dari system_profiler', () => {
  const out = JSON.stringify({
    SPBluetoothDataType: [
      {
        device_connected: [
          { 'Magic Mouse': { device_address: 'A1', device_minorType: 'Mouse', device_batteryLevelMain: '64%' } },
          { AirPods: { device_address: 'A2', device_minorType: 'Headphones', device_batteryLevelLeft: '80%', device_batteryLevelRight: '45%', device_batteryLevelCase: '10%' } },
          { Speaker: { device_address: 'A3', device_minorType: 'Speaker' } },
        ],
      },
    ],
  });
  assert.deepEqual(parseBluetooth(out).map((d) => [d.name, d.battery]), [['Magic Mouse', 64], ['AirPods', 45], ['Speaker', null]]);
});

test('aplikasi di depan dari lsappinfo', () => {
  const { parseFrontApp } = require('../lib/macbridge');
  assert.equal(parseFrontApp('"LSDisplayName"="Safari"\n'), 'Safari');
  assert.equal(parseFrontApp('"name"="Visual Studio Code"'), 'Visual Studio Code');
  assert.equal(parseFrontApp(''), null);
});
