'use strict';

// Uji aksi Zeno dari obrolan (tool calling) di OpenAI & Gemini dengan fetch palsu: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { askOpenAI, askGemini } = require('../lib/chat-providers');
const { TOOLS, callTool, actionsText } = require('../lib/zeno-tools');

const messages = [{ role: 'user', content: 'Ingatkan aku rapat besok jam 9' }];

// fetch palsu yang menjawab berurutan (satu isi per permintaan).
function sequence(...bodies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => bodies[Math.min(calls.length - 1, bodies.length - 1)] };
  };
  return { impl, calls };
}

const fakeRun = (log) => async (name, input) => {
  log.push({ name, input });
  if (name === 'set_reminder') return { ok: true, label: `Pengingat · ${input.title}`, result: { when: 'Besok 09.00' } };
  return { ok: false, label: 'Gagal', result: { error: 'x' } };
};

test('definisi tool: nama unik, skema objek dengan properti wajib yang ada', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assert.equal(t.parameters.type, 'object');
    for (const key of t.parameters.required ?? []) assert.ok(t.parameters.properties[key], `${t.name}.${key}`);
  }
});

test('OpenAI: panggil tool, kirim hasilnya, lalu jawab dengan teks + chip aksi', async () => {
  const { impl, calls } = sequence(
    { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'set_reminder', arguments: '{"title":"Rapat","date":"2026-10-20","time":"09:00"}' } }] } }] },
    { choices: [{ message: { content: 'Siap, besok jam 9 aku ingatkan.' } }] },
  );
  const log = [];
  const answer = await askOpenAI({ apiKey: 'sk', model: 'gpt-5-mini', system: 's', messages, tools: TOOLS, runTool: fakeRun(log), fetchImpl: impl });
  assert.equal(answer.text, 'Siap, besok jam 9 aku ingatkan.');
  assert.deepEqual(answer.actions, [{ name: 'set_reminder', label: 'Pengingat · Rapat', ok: true }]);
  assert.deepEqual(log[0].input, { title: 'Rapat', date: '2026-10-20', time: '09:00' });
  assert.equal(calls[0].tools.length, TOOLS.length);
  const tail = calls[1].messages.slice(-2);
  assert.equal(tail[0].tool_calls[0].id, 'c1');
  assert.deepEqual(tail[1], { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ ok: true, when: 'Besok 09.00' }) });
});

test('OpenAI: tanpa runTool tidak ada daftar tool', async () => {
  const { impl, calls } = sequence({ choices: [{ message: { content: 'Halo' } }] });
  await askOpenAI({ apiKey: 'sk', model: 'gpt-5-mini', system: 's', messages, tools: TOOLS, fetchImpl: impl });
  assert.equal(calls[0].tools, undefined);
});

test('Gemini: functionCall → functionResponse, bagian model (thoughtSignature) dikirim balik', async () => {
  const modelParts = [{ functionCall: { name: 'set_reminder', args: { title: 'Rapat', date: '2026-10-20', time: '09:00' } }, thoughtSignature: 'sig' }];
  const { impl, calls } = sequence(
    { candidates: [{ content: { role: 'model', parts: modelParts } }] },
    { candidates: [{ content: { parts: [{ text: 'Sudah kucatat.' }] } }] },
  );
  const answer = await askGemini({ apiKey: 'AIza', model: 'gemini-flash-latest', system: 's', messages, tools: TOOLS, runTool: fakeRun([]), fetchImpl: impl });
  assert.equal(answer.text, 'Sudah kucatat.');
  assert.equal(answer.actions.length, 1);
  assert.equal(calls[0].tools[0].functionDeclarations.length, TOOLS.length);
  const [model, user] = calls[1].contents.slice(-2);
  assert.deepEqual(model, { role: 'model', parts: modelParts });
  assert.deepEqual(user.parts[0].functionResponse, { name: 'set_reminder', response: { ok: true, when: 'Besok 09.00' } });
});

test('putaran aksi dibatasi supaya tidak berputar terus', async () => {
  const loop = { choices: [{ message: { content: null, tool_calls: [{ id: 'c', function: { name: 'open_app', arguments: '{}' } }] } }] };
  const { impl, calls } = sequence(loop);
  const answer = await askOpenAI({ apiKey: 'sk', model: 'gpt-5-mini', system: 's', messages, tools: TOOLS, runTool: fakeRun([]), fetchImpl: impl });
  assert.equal(calls.length, 5);
  assert.equal(answer.actions.length, 4);
});

test('callTool: error & aksi baca-saja', async () => {
  const actions = [];
  const failed = await callTool(async () => {
    throw new Error('rusak');
  }, 'x', {}, actions);
  assert.equal(failed.ok, false);
  assert.equal(actions[0].ok, false);
  await callTool(async () => ({ ok: true, label: '', result: { calendar: 'kosong' } }), 'get_schedule', {}, actions);
  assert.equal(actions.length, 1); // tanpa chip
  assert.equal(actionsText([{ ok: true }]), 'Beres!');
  assert.equal(actionsText([]), '');
});
