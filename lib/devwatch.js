'use strict';

// Pantau server lokal (HTTP/TCP) dan status Git project. Semua lokal, tanpa layanan luar.

const { execFile } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

// ---------- Server ----------
// service: { name, type: 'http'|'tcp', target: 'http://crm.localhost:3000' | '127.0.0.1:5433' }
// hasil: { status: 'up'|'error'|'down', detail, ms }

function checkTcp(target) {
  const [host = '127.0.0.1', port] = target.includes(':') ? target.split(':') : ['127.0.0.1', target];
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: host || '127.0.0.1', port: Number(port), timeout: 2000 });
    socket.on('connect', () => {
      socket.destroy();
      resolve({ status: 'up', detail: 'Terhubung', ms: Date.now() - started });
    });
    socket.on('error', (error) => resolve({ status: 'down', detail: error.code === 'ECONNREFUSED' ? 'Mati' : error.code }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ status: 'down', detail: 'Tidak menjawab' });
    });
  });
}

// *.localhost tidak selalu bisa di-resolve Node di Windows: hubungi 127.0.0.1 dengan header Host.
function checkHttp(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return Promise.resolve({ status: 'down', detail: 'Alamat tidak valid' });
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  return new Promise((resolve) => {
    const started = Date.now();
    const request = http.get(
      {
        host: local ? '127.0.0.1' : url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        headers: { Host: url.host },
        timeout: 8000,
      },
      (res) => {
        res.resume();
        const ms = Date.now() - started;
        // Server menjawab = hidup; 5xx = hidup tapi error.
        if (res.statusCode >= 500) resolve({ status: 'error', detail: `Error ${res.statusCode}`, ms });
        else resolve({ status: 'up', detail: `${ms} ms`, ms });
      },
    );
    request.on('error', (error) => resolve({ status: 'down', detail: error.code === 'ECONNREFUSED' ? 'Mati' : error.code }));
    request.on('timeout', () => {
      request.destroy();
      resolve({ status: 'error', detail: 'Lambat (> 8 dtk)' });
    });
  });
}

function checkService(service) {
  return service.type === 'tcp' ? checkTcp(String(service.target)) : checkHttp(String(service.target));
}

// ---------- Git ----------

function gitStatus(dir) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'status', '--porcelain=v2', '--branch'], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) return resolve({ ok: false, detail: 'Bukan repo Git' });
      let branch = '';
      let ahead = 0;
      let behind = 0;
      let upstream = null;
      let changed = 0;
      let untracked = 0;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
        else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim();
        else if (line.startsWith('# branch.ab ')) {
          const [a, b] = line.slice(12).trim().split(' ');
          ahead = Math.abs(Number(a));
          behind = Math.abs(Number(b));
        } else if (line.startsWith('? ')) untracked++;
        else if (/^[12u] /.test(line)) changed++;
      }
      resolve({ ok: true, branch, upstream, ahead, behind, changed, untracked });
    });
  });
}

function projectName(dir) {
  return path.basename(dir.replace(/[\\/]+$/, ''));
}

module.exports = { checkService, gitStatus, projectName };
