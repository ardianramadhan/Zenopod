'use strict';

// Monitor sistem & internet: CPU, RAM, disk C:, dan koneksi internet.
// Internet dicek ke alamat uji koneksi Windows (yang juga dipakai ikon jaringan di taskbar).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROBE_URL = 'http://www.msftconnecttest.com/connecttest.txt';
const PROBE_TEXT = 'Microsoft Connect Test';

let lastCpu = null;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const [kind, ms] of Object.entries(cpu.times)) {
      total += ms;
      if (kind === 'idle') idle += ms;
    }
  }
  return { idle, total };
}

// Persen CPU sejak pemanggilan sebelumnya (pemanggilan pertama = null).
function cpuPercent() {
  const now = cpuTimes();
  const before = lastCpu;
  lastCpu = now;
  if (!before || now.total <= before.total) return null;
  return Math.round(100 * (1 - (now.idle - before.idle) / (now.total - before.total)));
}

function memory() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return { percent: Math.round((used / total) * 100), used, total };
}

const SYSTEM_DISK = process.platform === 'win32' ? path.parse(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\').root : '/';

// drive: "C:" di Windows, kosong di Mac (tampil sebagai "Disk").
function disk(root = SYSTEM_DISK) {
  try {
    const s = fs.statfsSync(root);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { drive: process.platform === 'win32' ? root.replace(/\\$/, '') : '', percent: Math.round(((total - free) / total) * 100), free, total };
  } catch {
    return null;
  }
}

// { online, ms } — online=false juga saat Wi-Fi tersambung tapi internetnya mati / butuh login hotspot.
async function probe() {
  const started = Date.now();
  try {
    const res = await fetch(PROBE_URL, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const body = await res.text();
    return { online: res.ok && body.trim().startsWith(PROBE_TEXT), ms: Date.now() - started };
  } catch {
    return { online: false, ms: null };
  }
}

// 12,3 GB / 840 MB
function bytes(n) {
  if (n == null) return '–';
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1).replace('.', ',')} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

module.exports = { cpuPercent, memory, disk, probe, bytes };
