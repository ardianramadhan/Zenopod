'use strict';

// Ngobrol dengan Zeno lewat Claude API (SDK resmi @anthropic-ai/sdk), atau OpenAI / Gemini
// (lib/chat-providers.js). API key disimpan terenkripsi (Electron safeStorage / DPAPI) di config.json
// dan tidak pernah dikirim ke tampilan.

const { safeStorage } = require('electron');
// SDK Claude baru dimuat saat dipakai (±16 MB memori), bukan saat Zenopod dibuka.
let sdk = null;
const Anthropic = () => (sdk ??= require('@anthropic-ai/sdk').default);
const providers = require('./chat-providers');
const zenoTools = require('./zeno-tools');

const MODELS = {
  'claude-opus-5': 'Claude Opus 5 (paling pintar)',
  'claude-sonnet-5': 'Claude Sonnet 5 (seimbang)',
  'claude-haiku-4-5': 'Claude Haiku 4.5 (paling cepat & murah)',
};
const DEFAULT_MODEL = 'claude-opus-5';
const HISTORY_TURNS = 10; // pesan terakhir yang diingat
const FORGET_AFTER_MS = 10 * 60_000; // diam 10 menit = mulai obrolan baru

function encryptKey(key) {
  if (!key) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Enkripsi Windows tidak tersedia.');
  return safeStorage.encryptString(key).toString('base64');
}

function decryptKey(encrypted) {
  if (!encrypted) return '';
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return '';
  }
}

// "sk-ant-…a1b2" untuk ditampilkan di Pengaturan.
function maskKey(encrypted) {
  const key = decryptKey(encrypted);
  return key ? `${key.slice(0, 7)}…${key.slice(-4)}` : '';
}

class Chat {
  constructor() {
    this.history = []; // Anthropic.MessageParam[]
    this.lastAt = 0;
  }

  // style 'card' = jawaban di kartu kecil / dibacakan; 'chat' = kotak chat (boleh lebih panjang).
  systemPrompt({ buddyName, userName, style = 'card', tools = false }) {
    return [
      `Kamu adalah ${buddyName || 'Zeno'}, maskot berbentuk bola kecil yang lucu di aplikasi desktop Zenopod.`,
      userName ? `Kamu sedang mengobrol dengan ${userName}.` : '',
      style === 'chat'
        ? 'Jawab dalam bahasa Indonesia yang santai dan ramah. Ringkas, tapi boleh beberapa paragraf pendek atau daftar sederhana dengan tanda "-" kalau perlu (misalnya saat merangkum file). Tanpa tabel dan tanpa judul markdown.'
        : 'Jawab dalam bahasa Indonesia yang santai dan ramah, maksimal 2-3 kalimat pendek, karena jawabanmu tampil di kartu kecil dan bisa dibacakan.',
      style === 'chat' ? 'Kalau ada file terlampir, gunakan isinya untuk menjawab.' : 'Tanpa markdown, tanpa daftar, tanpa emoji berlebihan.',
      'Kalau tidak tahu, bilang saja tidak tahu.',
      tools ? zenoTools.toolPrompt() : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  // files: [{ name, mime, kind, data?, text? }] (lihat lib/chat-providers.js).
  // runTool(name, input) → { ok, label, result }: kalau ada, Zeno boleh menjalankan aksi (lib/zeno-tools.js).
  async ask(text, { provider = 'anthropic', apiKey, model, buddyName, userName, style = 'card', files = [], runTool = null }) {
    if (Date.now() - this.lastAt > FORGET_AFTER_MS) this.history = [];
    this.lastAt = Date.now();
    const message = { role: 'user', content: String(text).slice(0, 4000) };
    if (files.length) message.files = files;
    const messages = [...this.history, message];
    const system = this.systemPrompt({ buddyName, userName, style, tools: Boolean(runTool) });
    const tools = runTool ? zenoTools.TOOLS : [];

    let result;
    if (provider === 'openai' || provider === 'gemini') {
      const ask = provider === 'openai' ? providers.askOpenAI : providers.askGemini;
      result = await ask({ apiKey, model: providers.pickModel(provider, model), system, messages, tools, runTool });
    } else {
      result = await this.askClaude({ apiKey, model, system, messages: providers.claudeMessages(messages), tools, runTool });
    }
    const actions = result.actions ?? [];
    if (result.refusal && !actions.length) return 'Maaf, aku tidak bisa membantu yang itu.';
    const answer = result.text || zenoTools.actionsText(actions);

    this.history = [...messages, { role: 'assistant', content: answer || '…', ...(actions.length ? { actions } : {}) }].slice(-HISTORY_TURNS);
    // Riwayat harus diawali pesan user.
    while (this.history.length && this.history[0].role !== 'user') this.history.shift();
    return answer || 'Hmm, aku kehabisan kata-kata.';
  }

  // Claude → { refusal, text, actions }; tool_use dijalankan lalu hasilnya dikirim balik.
  async askClaude({ apiKey, model, system, messages, tools = [], runTool = null }) {
    const chosen = MODELS[model] ? model : DEFAULT_MODEL;

    const params = {
      model: chosen,
      max_tokens: 4096,
      system,
      messages: [...messages],
    };
    if (tools.length && runTool) params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    // Obrolan singkat: effort rendah (Haiku 4.5 tidak mendukung effort).
    if (chosen !== 'claude-haiku-4-5') params.output_config = { effort: 'low' };

    // Tanpa key tersimpan: SDK memakai ANTHROPIC_API_KEY / profil `ant auth login` kalau ada.
    const client = new (Anthropic())({ ...(apiKey ? { apiKey } : {}), maxRetries: 1, timeout: 60_000 });
    const actions = [];
    for (let round = 0; ; round++) {
      let response;
      try {
        response =
          chosen === 'claude-opus-5'
            ? // Opus 5: kalau classifier menolak, server mengulang di model cadangan yang direkomendasikan.
              await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
            : await client.messages.create(params);
      } catch (error) {
        throw new Error(friendlyError(error));
      }

      if (response.stop_reason === 'refusal') return { refusal: true, text: '', actions };
      const uses = response.content.filter((block) => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !uses.length || !runTool || round >= zenoTools.MAX_ROUNDS) {
        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(' ')
          .trim();
        return { refusal: false, text, actions };
      }
      // Seluruh isi jawaban (termasuk blok thinking) dikirim balik, lalu hasil tiap aksi.
      params.messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const use of uses) {
        const result = await zenoTools.callTool(runTool, use.name, use.input, actions);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result), ...(result.ok ? {} : { is_error: true }) });
      }
      params.messages.push({ role: 'user', content: results });
    }
  }

  // Riwayat untuk ditampilkan di kotak chat (tanpa isi file).
  display() {
    if (Date.now() - this.lastAt > FORGET_AFTER_MS) return [];
    return this.history.map((m) => ({ role: m.role, text: m.content, files: (m.files ?? []).map((f) => ({ name: f.name, kind: f.kind })), actions: m.actions ?? [] }));
  }

  reset() {
    this.history = [];
  }
}

function friendlyError(error) {
  // SDK belum dimuat = error ini pasti bukan dari Claude.
  const A = sdk ?? {};
  const is = (type) => typeof type === 'function' && error instanceof type;
  if (is(A.AuthenticationError)) return 'API key Claude tidak valid. Cek di Pengaturan › Ngobrol.';
  if (is(A.PermissionDeniedError)) return 'API key ini tidak punya akses ke model yang dipilih.';
  if (is(A.RateLimitError)) return 'Lagi ramai, coba lagi sebentar.';
  if (is(A.BadRequestError)) return `Permintaan ditolak: ${error.message}`;
  if (is(A.APIConnectionError)) return 'Tidak bisa tersambung ke internet.';
  if (is(A.APIError)) return `Claude sedang bermasalah (${error.status ?? 'tanpa status'}).`;
  if (/api key|apiKey|authentication/i.test(String(error?.message))) return 'Belum ada API key Claude. Isi di Pengaturan › Ngobrol.';
  return 'Maaf, aku gagal menjawab.';
}

module.exports = { Chat, MODELS, DEFAULT_MODEL, PROVIDERS: providers.PROVIDERS, listModels: providers.listModels, encryptKey, decryptKey, maskKey };
