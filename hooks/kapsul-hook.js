'use strict';

// Hook Claude Code untuk Zenopod. Dipasang dari Pengaturan Zenopod › Claude Code.
// Dipanggil sebagai: node kapsul-hook.js <EventName>, dengan data hook di stdin (JSON).
// Meneruskan event ke Zenopod (127.0.0.1) lalu keluar. Hanya PermissionRequest yang menulis ke stdout
// (keputusan Izinkan/Tolak); event lain diam karena output UserPromptSubmit masuk ke konteks Claude. Selalu exit 0,
// jadi Claude tetap jalan walau Zenopod sedang mati.

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PORT = 47821;
const event = process.argv[2] || 'Unknown';

function token() {
  const dir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  try {
    return fs.readFileSync(path.join(dir, 'kapsul', 'hook-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', send);
setTimeout(send, 1500); // stdin tidak pernah ditutup = kirim apa adanya

let sent = false;
function send() {
  if (sent) return;
  sent = true;

  let data = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {
    // Data rusak: tetap kirim nama event saja.
  }

  // PermissionRequest menunggu kamu menekan Izinkan/Tolak di Zenopod (maks. ~100 dtk).
  // Tanpa jawaban (Zenopod mati, "Di terminal", atau waktu habis) hook tidak mencetak apa pun,
  // sehingga Claude Code menampilkan dialog izin biasa di terminal.
  const asking = event === 'PermissionRequest';
  const body = JSON.stringify({ event, data });
  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: asking ? '/claude/permission' : '/claude',
      method: 'POST',
      timeout: asking ? 100_000 : 800,
      headers: { 'content-type': 'application/json', 'x-kapsul-token': token(), 'content-length': Buffer.byteLength(body) },
    },
    (res) => {
      let reply = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (reply += chunk));
      res.on('end', () => {
        if (asking) decide(reply);
        process.exit(0);
      });
    },
  );
  req.on('error', () => process.exit(0));
  req.on('timeout', () => {
    req.destroy();
    process.exit(0);
  });
  req.end(body);
}

function decide(reply) {
  let decision = null;
  try {
    decision = JSON.parse(reply).decision;
  } catch {
    return;
  }
  if (decision !== 'allow' && decision !== 'deny') return;
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', reason: 'Ditolak dari Zenopod.' },
    },
  };
  fs.writeSync(1, JSON.stringify(output)); // sinkron: pasti terkirim sebelum process.exit
}
