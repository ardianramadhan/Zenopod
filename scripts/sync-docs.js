// Salin maskot Zeno (renderer/buddy.*) ke landing page GitHub Pages (docs/zeno/) dan naikkan versi aset.
// GitHub Pages hanya menyajikan folder docs/, jadi maskotnya perlu salinan. Jalankan: npm run docs:sync
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'zeno');
fs.mkdirSync(out, { recursive: true });
for (const name of ['buddy.js', 'buddy.css']) {
  fs.copyFileSync(path.join(root, 'renderer', name), path.join(out, name));
  console.log(`docs/zeno/${name}`);
}

// Naikkan versi di link CSS/JS supaya browser pengunjung tidak memakai salinan lama dari cache
// (GitHub Pages menyimpan file di cache browser sampai 10 menit).
const index = path.join(root, 'docs', 'index.html');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/\?v=\d+/g, `?v=${stamp}`));
console.log(`docs/index.html ?v=${stamp}`);
