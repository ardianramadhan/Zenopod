'use strict';

// Ngobrol dengan Zeno lewat Claude API (SDK resmi @anthropic-ai/sdk).
// API key disimpan terenkripsi (Electron safeStorage / DPAPI) di config.json dan tidak pernah dikirim ke tampilan.

const { safeStorage } = require('electron');
const Anthropic = require('@anthropic-ai/sdk').default;

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

  systemPrompt({ buddyName, userName }) {
    return [
      `Kamu adalah ${buddyName || 'Zeno'}, maskot berbentuk bola kecil yang lucu di aplikasi desktop Zenopod.`,
      userName ? `Kamu sedang mengobrol dengan ${userName}.` : '',
      'Jawab dalam bahasa Indonesia yang santai dan ramah, maksimal 2-3 kalimat pendek, karena jawabanmu tampil di kartu kecil dan bisa dibacakan.',
      'Tanpa markdown, tanpa daftar, tanpa emoji berlebihan. Kalau tidak tahu, bilang saja tidak tahu.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  async ask(text, { apiKey, model, buddyName, userName }) {
    if (Date.now() - this.lastAt > FORGET_AFTER_MS) this.history = [];
    this.lastAt = Date.now();

    const chosen = MODELS[model] ? model : DEFAULT_MODEL;
    const messages = [...this.history, { role: 'user', content: String(text).slice(0, 2000) }];

    const params = {
      model: chosen,
      max_tokens: 4096,
      system: this.systemPrompt({ buddyName, userName }),
      messages,
    };
    // Obrolan singkat: effort rendah (Haiku 4.5 tidak mendukung effort).
    if (chosen !== 'claude-haiku-4-5') params.output_config = { effort: 'low' };

    let response;
    try {
      // Tanpa key tersimpan: SDK memakai ANTHROPIC_API_KEY / profil `ant auth login` kalau ada.
      const client = new Anthropic({ ...(apiKey ? { apiKey } : {}), maxRetries: 1, timeout: 60_000 });
      response =
        chosen === 'claude-opus-5'
          ? // Opus 5: kalau classifier menolak, server mengulang di model cadangan yang direkomendasikan.
            await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
          : await client.messages.create(params);
    } catch (error) {
      throw new Error(friendlyError(error));
    }

    if (response.stop_reason === 'refusal') return 'Maaf, aku tidak bisa membantu yang itu.';
    const answer = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim();

    this.history = [...messages, { role: 'assistant', content: answer || '…' }].slice(-HISTORY_TURNS);
    // Riwayat harus diawali pesan user.
    while (this.history.length && this.history[0].role !== 'user') this.history.shift();
    return answer || 'Hmm, aku kehabisan kata-kata.';
  }

  reset() {
    this.history = [];
  }
}

function friendlyError(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'API key Claude tidak valid. Cek di Pengaturan › Ngobrol.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'API key ini tidak punya akses ke model yang dipilih.';
  if (error instanceof Anthropic.RateLimitError) return 'Lagi ramai, coba lagi sebentar.';
  if (error instanceof Anthropic.BadRequestError) return `Permintaan ditolak: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'Tidak bisa tersambung ke internet.';
  if (error instanceof Anthropic.APIError) return `Claude sedang bermasalah (${error.status ?? 'tanpa status'}).`;
  if (/api key|apiKey|authentication/i.test(String(error?.message))) return 'Belum ada API key Claude. Isi di Pengaturan › Ngobrol.';
  return 'Maaf, aku gagal menjawab.';
}

module.exports = { Chat, MODELS, DEFAULT_MODEL, encryptKey, decryptKey, maskKey };
