// Salin maskot Zeno (renderer/buddy.*) ke landing page GitHub Pages (docs/zeno/).
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
