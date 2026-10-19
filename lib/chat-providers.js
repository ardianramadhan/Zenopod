'use strict';

// Ngobrol lewat OpenAI (ChatGPT) dan Google Gemini, langsung lewat REST API masing-masing
// (tanpa SDK tambahan). Riwayat memakai bentuk yang sama untuk semua penyedia:
//   [{ role: 'user'|'assistant', content, files?: [{ name, mime, kind: 'image'|'pdf'|'text', data?, text? }] }]
// data = isi file (base64) untuk gambar & PDF; text = isi file teks/kode.
// Diuji di test/chat.test.js (fetch dipalsukan).

// File teks/kode dikirim sebagai teks biasa, diberi nama supaya AI tahu asalnya.
const fileText = (f) => `Isi file "${f.name}":\n${f.text ?? ''}`;

const { MAX_ROUNDS, callTool } = require('./zeno-tools');

// ---------- Claude: blok konten (gambar, dokumen PDF, teks) ----------

function claudeMessages(messages) {
  return messages.map((m) => {
    if (!m.files?.length) return { role: m.role, content: m.content };
    const blocks = [];
    for (const f of m.files) {
      if (f.kind === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.data } });
      else if (f.kind === 'pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name });
      else blocks.push({ type: 'text', text: fileText(f) });
    }
    blocks.push({ type: 'text', text: m.content });
    return { role: m.role, content: blocks };
  });
}

const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    short: 'Claude',
    keyField: 'apiKeyEnc',
    modelField: 'model',
    env: 'ANTHROPIC_API_KEY',
    keyPattern: /^sk-ant-/,
    keyHint: 'sk-ant-…',
    keyError: 'API key Claude diawali "sk-ant-".',
    keyWhere: 'platform.claude.com › API Keys',
    customModel: false,
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    short: 'ChatGPT',
    keyField: 'openaiKeyEnc',
    modelField: 'openaiModel',
    env: 'OPENAI_API_KEY',
    keyPattern: /^sk-/,
    keyHint: 'sk-…',
    keyError: 'API key OpenAI diawali "sk-".',
    keyWhere: 'platform.openai.com › API keys',
    customModel: true,
    models: {
      'gpt-5': 'GPT-5 (paling pintar)',
      'gpt-5-mini': 'GPT-5 mini (seimbang)',
      'gpt-5-nano': 'GPT-5 nano (paling cepat & murah)',
    },
    defaultModel: 'gpt-5-mini',
  },
  gemini: {
    label: 'Gemini (Google)',
    short: 'Gemini',
    keyField: 'geminiKeyEnc',
    modelField: 'geminiModel',
    env: 'GEMINI_API_KEY',
    // Key AI Studio lama "AIza…", yang baru "AQ.…".
    keyPattern: /^(AIza|AQ\.)/,
    keyHint: 'AIza… atau AQ.…',
    keyError: 'API key Gemini diawali "AIza" atau "AQ.".',
    keyWhere: 'aistudio.google.com › Get API key',
    customModel: true,
    // Alias "-latest" selalu menunjuk ke versi terbaru, jadi tidak usang saat Google merilis model baru.
    models: {
      'gemini-flash-latest': 'Gemini Flash terbaru (seimbang)',
      'gemini-pro-latest': 'Gemini Pro terbaru (paling pintar, butuh paket berbayar)',
      'gemini-flash-lite-latest': 'Gemini Flash-Lite terbaru (paling cepat & hemat)',
    },
    defaultModel: 'gemini-flash-latest',
  },
};

// Nama model bebas (untuk model baru): huruf, angka, titik, titik dua, garis.
const validModel = (id) => /^[\w.:-]{2,80}$/.test(String(id ?? ''));

function pickModel(provider, model) {
  const p = PROVIDERS[provider];
  if (p.models?.[model]) return model;
  return p.customModel && validModel(model) ? model : p.defaultModel;
}

class ProviderError extends Error {}

// Pesan galat ramah untuk kartu Zeno.
function httpError(provider, status, body) {
  const name = PROVIDERS[provider].short;
  const text = JSON.stringify(body ?? '');
  if (status === 401 || /API_KEY_INVALID|invalid api key|Incorrect API key/i.test(text)) return new ProviderError(`API key ${name} tidak valid. Cek di Pengaturan › Ngobrol.`);
  if (status === 403) return new ProviderError(`API key ${name} tidak punya akses ke model yang dipilih.`);
  if (status === 404) return new ProviderError(`Model ${name} yang dipilih tidak ditemukan. Ganti model di Pengaturan › Ngobrol.`);
  if (status === 429) return new ProviderError(/quota|billing|insufficient/i.test(text) ? `Kuota ${name} untuk model ini habis atau butuh paket berbayar. Coba model lain, atau cek tagihan akunnya.` : 'Lagi ramai, coba lagi sebentar.');
  if (status >= 500) return new ProviderError(`${name} sedang bermasalah (${status}).`);
  return new ProviderError(`Permintaan ke ${name} ditolak (${status}).`);
}

async function post(provider, url, headers, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new ProviderError('Tidak bisa tersambung ke internet.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw httpError(provider, res.status, data);
  return data;
}

// ---------- OpenAI: Chat Completions ----------

function openaiMessage(m) {
  if (!m.files?.length) return { role: m.role, content: m.content };
  const parts = [];
  for (const f of m.files) {
    if (f.kind === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.data}` } });
    else if (f.kind === 'pdf') parts.push({ type: 'file', file: { filename: f.name, file_data: `data:application/pdf;base64,${f.data}` } });
    else parts.push({ type: 'text', text: fileText(f) });
  }
  parts.push({ type: 'text', text: m.content });
  return { role: m.role, content: parts };
}

function openaiRequest({ model, system, messages }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...messages.map(openaiMessage)],
    max_completion_tokens: 2048,
  };
  // Model penalar (GPT-5, o-series): cukup berpikir sedikit untuk obrolan singkat.
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'low';
  return body;
}

function openaiAnswer(data) {
  const message = data?.choices?.[0]?.message;
  if (message?.refusal) return { refusal: true, text: '' };
  return { refusal: false, text: String(message?.content ?? '').trim() };
}

// tools + runTool: Zeno boleh beraksi; tiap panggilan dijalankan lalu hasilnya dikirim balik
// sampai model menjawab dengan teks (maks. MAX_ROUNDS putaran). actions = chip untuk kotak chat.
async function askOpenAI({ apiKey, model, system, messages, tools = [], runTool, fetchImpl = fetch }) {
  if (!apiKey) throw new ProviderError('Belum ada API key OpenAI. Isi di Pengaturan › Ngobrol.');
  const body = openaiRequest({ model, system, messages });
  if (tools.length && runTool) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const actions = [];
  for (let round = 0; ; round++) {
    const data = await post('openai', 'https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${apiKey}` }, body, fetchImpl);
    const message = data?.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];
    if (!calls.length || !runTool || round >= MAX_ROUNDS) return { ...openaiAnswer(data), actions };
    body.messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        // argumen rusak → aksi menolak sendiri
      }
      const result = await callTool(runTool, call.function?.name, args, actions);
      body.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
}

// ---------- Google Gemini: generateContent ----------

function geminiRequest({ system, messages }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(m.files ?? []).map((f) => (f.kind === 'text' ? { text: fileText(f) } : { inline_data: { mime_type: f.mime, data: f.data } })),
        { text: m.content },
      ],
    })),
    generationConfig: { maxOutputTokens: 2048 },
  };
}

function geminiAnswer(data) {
  if (data?.promptFeedback?.blockReason) return { refusal: true, text: '' };
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') return { refusal: true, text: '' };
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join(' ')
    .trim();
  return { refusal: false, text };
}

async function askGemini({ apiKey, model, system, messages, tools = [], runTool, fetchImpl = fetch }) {
  if (!apiKey) throw new ProviderError('Belum ada API key Gemini. Isi di Pengaturan › Ngobrol.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = geminiRequest({ system, messages });
  if (tools.length && runTool) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  const actions = [];
  for (let round = 0; ; round++) {
    const data = await post('gemini', url, { 'x-goog-api-key': apiKey }, body, fetchImpl);
    const content = data?.candidates?.[0]?.content;
    const calls = (content?.parts ?? []).filter((p) => p.functionCall);
    if (!calls.length || !runTool || round >= MAX_ROUNDS) return { ...geminiAnswer(data), actions };
    // Bagian model dikirim balik apa adanya (termasuk thoughtSignature yang diwajibkan Gemini 3).
    body.contents.push({ role: 'model', parts: content.parts });
    const responses = [];
    for (const part of calls) {
      const result = await callTool(runTool, part.functionCall.name, part.functionCall.args ?? {}, actions);
      responses.push({ functionResponse: { name: part.functionCall.name, ...(part.functionCall.id ? { id: part.functionCall.id } : {}), response: result } });
    }
    body.contents.push({ role: 'user', parts: responses });
  }
}

// ---------- Daftar model dari akun pengguna ----------
// Hanya model obrolan teks (tanpa gambar, suara, embedding, dll.), terbaru dulu.

const NOT_CHAT = /(tts|image|banana|lyria|robotics|computer-use|transcribe|omni|embedding|embed|live|audio|realtime|search|moderation|dall-e|whisper|instruct|codex|deep-research|antigravity|aqa|veo|imagen)/i;

function chatModels(provider, data) {
  if (provider === 'gemini') {
    return (data?.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({ id: String(m.name ?? '').replace(/^models\//, ''), label: m.displayName || '' }))
      .filter((m) => /^gemini-/.test(m.id) && !NOT_CHAT.test(m.id))
      .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
  }
  return (data?.data ?? [])
    .map((m) => ({ id: String(m.id ?? ''), label: '' }))
    .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !NOT_CHAT.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
}

async function listModels(provider, apiKey, fetchImpl = fetch) {
  if (!apiKey) return [];
  const [url, headers] =
    provider === 'gemini'
      ? ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': apiKey }]
      : ['https://api.openai.com/v1/models', { authorization: `Bearer ${apiKey}` }];
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new ProviderError('Tidak bisa tersambung ke internet.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw httpError(provider, res.status, data);
  return chatModels(provider, data);
}

module.exports = {
  PROVIDERS,
  ProviderError,
  pickModel,
  validModel,
  claudeMessages,
  openaiRequest,
  openaiAnswer,
  askOpenAI,
  geminiRequest,
  geminiAnswer,
  askGemini,
  chatModels,
  listModels,
};
