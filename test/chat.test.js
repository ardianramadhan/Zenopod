'use strict';

// Uji penyedia obrolan OpenAI & Gemini (lib/chat-providers.js) dengan fetch palsu: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { pickModel, openaiRequest, openaiAnswer, askOpenAI, geminiRequest, geminiAnswer, askGemini, PROVIDERS } = require('../lib/chat-providers');

const messages = [
  { role: 'user', content: 'Halo' },
  { role: 'assistant', content: 'Hai!' },
  { role: 'user', content: 'Apa kabar?' },
];

// fetch palsu: catat permintaan, kembalikan status & isi tertentu.
function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl, calls };
}

test('model: daftar, nama bebas yang valid, atau bawaan', () => {
  assert.equal(pickModel('openai', 'gpt-5'), 'gpt-5');
  assert.equal(pickModel('openai', 'gpt-5.1-preview'), 'gpt-5.1-preview');
  assert.equal(pickModel('openai', 'nama model; hapus'), PROVIDERS.openai.defaultModel);
  assert.equal(pickModel('gemini', ''), PROVIDERS.gemini.defaultModel);
});

test('OpenAI: pesan sistem + riwayat, effort rendah untuk model penalar', () => {
  const body = openaiRequest({ model: 'gpt-5-mini', system: 'Kamu Zeno.', messages });
  assert.deepEqual(body.messages[0], { role: 'system', content: 'Kamu Zeno.' });
  assert.equal(body.messages.length, 4);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(openaiRequest({ model: 'gpt-4.1-mini', system: 's', messages }).reasoning_effort, undefined);
  assert.deepEqual(openaiAnswer({ choices: [{ message: { content: ' Baik! ' } }] }), { refusal: false, text: 'Baik!' });
  assert.equal(openaiAnswer({ choices: [{ message: { refusal: 'tidak' } }] }).refusal, true);
});

test('OpenAI: memanggil API dengan Bearer key dan menjawab', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: 'Baik kok.' } }] });
  const answer = await askOpenAI({ apiKey: 'sk-test', model: 'gpt-5-mini', system: 's', messages, fetchImpl: impl });
  assert.equal(answer.text, 'Baik kok.');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test');
});

test('Gemini: peran "model", instruksi sistem, dan jawaban tanpa bagian "thought"', async () => {
  const body = geminiRequest({ system: 'Kamu Zeno.', messages });
  assert.equal(body.systemInstruction.parts[0].text, 'Kamu Zeno.');
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(geminiAnswer({ candidates: [{ content: { parts: [{ text: 'mikir', thought: true }, { text: 'Baik!' }] } }] }), { refusal: false, text: 'Baik!' });
  assert.equal(geminiAnswer({ promptFeedback: { blockReason: 'SAFETY' } }).refusal, true);

  const { impl, calls } = fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'Halo juga!' }] } }] });
  const answer = await askGemini({ apiKey: 'AIza-test', model: 'gemini-2.5-flash', system: 's', messages, fetchImpl: impl });
  assert.equal(answer.text, 'Halo juga!');
  assert.match(calls[0].url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-test');
});

test('galat jadi pesan ramah', async () => {
  const cases = [
    ['openai', 401, {}, /tidak valid/],
    ['openai', 429, { error: { code: 'insufficient_quota' } }, /Kuota ChatGPT untuk model ini habis/],
    ['gemini', 400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, /API key Gemini tidak valid/],
    ['gemini', 404, {}, /tidak ditemukan/],
  ];
  for (const [provider, status, body, pattern] of cases) {
    const ask = provider === 'openai' ? askOpenAI : askGemini;
    await assert.rejects(ask({ apiKey: 'k', model: 'm-1', system: 's', messages, fetchImpl: fakeFetch(status, body).impl }), pattern);
  }
  await assert.rejects(askOpenAI({ apiKey: '', model: 'gpt-5', system: 's', messages }), /Belum ada API key OpenAI/);
  const offline = async () => {
    throw new Error('ENOTFOUND');
  };
  await assert.rejects(askGemini({ apiKey: 'k', model: 'gemini-2.5-flash', system: 's', messages, fetchImpl: offline }), /internet/);
});

test('Gemini: key "AQ." diterima, model bawaan alias terbaru', () => {
  assert.ok(PROVIDERS.gemini.keyPattern.test('AQ.contoh-key-palsu'));
  assert.ok(PROVIDERS.gemini.keyPattern.test('AIzaSyX'));
  assert.ok(!PROVIDERS.gemini.keyPattern.test('sk-abc'));
  assert.equal(PROVIDERS.gemini.defaultModel, 'gemini-flash-latest');
});

test('daftar model dari akun: hanya model obrolan teks, terbaru dulu', () => {
  const { chatModels } = require('../lib/chat-providers');
  const gemini = chatModels('gemini', {
    models: [
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] },
    ],
  });
  assert.deepEqual(gemini.map((m) => m.id), ['gemini-3.8-flash', 'gemini-3.5-flash']);
  const openai = chatModels('openai', { data: [{ id: 'gpt-5-mini' }, { id: 'gpt-5.2' }, { id: 'gpt-4o-realtime-preview' }, { id: 'text-embedding-3-small' }, { id: 'o4-mini' }, { id: 'dall-e-3' }] });
  assert.deepEqual(openai.map((m) => m.id), ['o4-mini', 'gpt-5.2', 'gpt-5-mini']);
});
