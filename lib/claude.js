'use strict';

// Integrasi Claude Code: hook (hooks/kapsul-hook.js) mengirim event ke server lokal ini.
// Hook dipasang/dilepas di ~/.claude/settings.json tanpa menyentuh hook lain (mis. Coucou).

const { app } = require('electron');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PORT = 47821;
const HOOK_SCRIPT = path.join(__dirname, '..', 'hooks', 'kapsul-hook.js');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
// PermissionRequest menunggu jawaban dari Zenopod (Zenopod menyerah setelah 90 dtk).
const TIMEOUTS = { PermissionRequest: 120 };
const MARK = 'kapsul-hook.js';

// ---------- Server ----------

function tokenFile() {
  return path.join(app.getPath('userData'), 'hook-token');
}

function ensureToken() {
  const file = tokenFile();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // belum ada
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token);
  return token;
}

// Hanya menerima dari 127.0.0.1 dengan token yang sama dengan file hook-token.
// /claude            → event biasa, langsung dijawab 204.
// /claude/permission → ditahan sampai onPermission memanggil respond('allow'|'deny'|null).
function startServer(onEvent, onPermission) {
  const token = ensureToken();
  const server = http.createServer((req, res) => {
    const known = req.url === '/claude' || req.url === '/claude/permission';
    if (req.method !== 'POST' || !known || req.headers['x-kapsul-token'] !== token) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      let message = null;
      try {
        message = JSON.parse(body);
      } catch {
        // data rusak
      }

      if (req.url === '/claude/permission') {
        let answered = false;
        const respond = (decision) => {
          if (answered) return;
          answered = true;
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ decision: decision ?? null }));
        };
        // Hook dihentikan (Claude dibatalkan / waktu habis) = jangan tunggu lagi.
        res.on('close', () => respond(null));
        if (!message) return respond(null);
        onPermission(message.data ?? {}, respond, () => answered);
        return;
      }

      res.writeHead(204).end();
      if (message) onEvent(String(message.event), message.data ?? {});
    });
  });
  server.on('error', (error) => console.warn('Server hook Claude tidak bisa dibuka:', error.message));
  server.listen(PORT, '127.0.0.1');
  return server;
}

// ---------- Pesan terakhir Claude (dari transcript JSONL) ----------

function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    const size = fs.statSync(transcriptPath).size;
    const length = Math.min(size, 512 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);

    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
      const text = entry.message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .trim();
      if (text) return text;
    }
  } catch {
    // transcript tidak bisa dibaca
  }
  return '';
}

// Teks markdown → satu paragraf pendek untuk kartu.
function plain(text, max = 220) {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

const TOOL_LABELS = {
  Read: 'Membaca file',
  Edit: 'Menulis kode',
  Write: 'Menulis kode',
  NotebookEdit: 'Menulis kode',
  Bash: 'Menjalankan perintah',
  PowerShell: 'Menjalankan perintah',
  Grep: 'Mencari',
  Glob: 'Mencari',
  WebFetch: 'Browsing',
  WebSearch: 'Browsing',
  Task: 'Mengutus agen',
  Agent: 'Mengutus agen',
  TodoWrite: 'Menyusun rencana',
};

// Perintah/pola ditampilkan apa adanya (hanya spasi dirapikan) — penting untuk keputusan izin.
function clip(text, max) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

// Rincian singkat tool untuk daftar aktivitas & kartu izin: perintah, nama file, pola, atau alamat.
function toolDetail(tool, input = {}, max = 80) {
  const base = (p) => (p ? path.basename(String(p)) : '');
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return clip(input.command ?? '', max);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return base(input.file_path ?? input.notebook_path);
    case 'Grep':
    case 'Glob':
      return clip(input.pattern ?? '', 60);
    case 'WebFetch':
      try {
        return new URL(input.url).host;
      } catch {
        return '';
      }
    case 'WebSearch':
      return clip(input.query ?? '', 60);
    case 'Task':
    case 'Agent':
      return clip(input.description ?? '', 60);
    default:
      return '';
  }
}

function toolLabel(tool) {
  if (!tool) return 'Berpikir';
  if (tool.startsWith('mcp__')) return 'Memakai ' + tool.split('__')[1];
  return TOOL_LABELS[tool] ?? tool;
}

// ---------- Pasang / lepas hook di ~/.claude/settings.json ----------

function nodePath() {
  try {
    const found = execFileSync('where', ['node'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
    if (found) return found;
  } catch {
    // tidak ketemu
  }
  return 'node';
}

const slash = (p) => p.replace(/\\/g, '/');

function hookCommand(event) {
  return `"${slash(nodePath())}" "${slash(HOOK_SCRIPT)}" ${event}`;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('settings.json Claude Code tidak bisa dibaca: ' + error.message);
  }
}

function writeSettings(settings) {
  if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.kapsul-backup');
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
}

const ours = (hook) => typeof hook?.command === 'string' && hook.command.includes(MARK);

function hooksStatus() {
  let settings = {};
  try {
    settings = readSettings();
  } catch (error) {
    return { installed: false, error: error.message, file: SETTINGS_FILE };
  }
  const installed = EVENTS.every((event) =>
    (settings.hooks?.[event] ?? []).some((group) => (group.hooks ?? []).some(ours)),
  );
  return { installed, file: SETTINGS_FILE };
}

function installHooks() {
  const settings = readSettings();
  settings.hooks ??= {};
  for (const event of EVENTS) {
    const groups = settings.hooks[event] ?? [];
    if (!groups.some((group) => (group.hooks ?? []).some(ours))) {
      groups.push({ hooks: [{ type: 'command', command: hookCommand(event), timeout: TIMEOUTS[event] ?? 5 }] });
    }
    settings.hooks[event] = groups;
  }
  writeSettings(settings);
}

function uninstallHooks() {
  const settings = readSettings();
  if (!settings.hooks) return;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !ours(hook)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  writeSettings(settings);
}

module.exports = { startServer, lastAssistantText, plain, toolLabel, toolDetail, hooksStatus, installHooks, uninstallHooks };
