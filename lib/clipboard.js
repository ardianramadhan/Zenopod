'use strict';

// Riwayat clipboard: hanya di memori (tidak ditulis ke disk) karena clipboard sering berisi
// password/token. Salinan yang ditandai password manager sebagai "jangan dicatat" dilewati.

const { clipboard } = require('electron');
const crypto = require('node:crypto');

// Format Windows yang dipasang password manager (Bitwarden, 1Password, KeePass, …).
const EXCLUDE_FORMATS = ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'Clipboard Viewer Ignore'];

class ClipboardHistory {
  constructor({ max = 20, onChange }) {
    this.max = max;
    this.onChange = onChange;
    this.items = []; // { id, type: 'text'|'image', text, image, thumb, at }
    this.lastKey = null;
    this.timer = null;
  }

  excluded() {
    try {
      const formats = clipboard.availableFormats();
      return EXCLUDE_FORMATS.some((f) => formats.includes(f) || clipboard.has(f));
    } catch {
      return false;
    }
  }

  start() {
    this.lastKey = this.currentKey(); // isi yang sudah ada sebelum Zenopod jalan tidak dicatat
    this.timer = setInterval(() => this.poll(), 800);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  currentKey() {
    const text = clipboard.readText();
    if (text) return 't:' + text;
    const image = clipboard.readImage();
    if (!image.isEmpty()) return 'i:' + crypto.createHash('sha1').update(image.toBitmap()).digest('hex');
    return null;
  }

  poll() {
    const key = this.currentKey();
    if (!key || key === this.lastKey) return;
    this.lastKey = key;
    if (this.excluded()) return;

    if (key.startsWith('t:')) {
      const text = key.slice(2);
      if (!text.trim()) return;
      this.add({ type: 'text', text, key });
    } else {
      const image = clipboard.readImage();
      const size = image.getSize();
      const thumb = image.resize(size.width > size.height ? { width: 96 } : { height: 96 }).toDataURL();
      this.add({ type: 'image', image, thumb, text: `Gambar ${size.width}×${size.height}`, key });
    }
  }

  add(item) {
    this.items = [{ id: crypto.randomUUID(), at: Date.now(), ...item }, ...this.items.filter((i) => i.key !== item.key)].slice(0, this.max);
    this.onChange(this.list());
  }

  // Salin ulang item lama; ia naik ke paling atas.
  copy(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    if (item.type === 'text') clipboard.writeText(item.text);
    else clipboard.writeImage(item.image);
    this.lastKey = item.key;
    this.items = [{ ...item, at: Date.now() }, ...this.items.filter((i) => i.id !== id)];
    this.onChange(this.list());
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.onChange(this.list());
  }

  clear() {
    this.items = [];
    this.onChange(this.list());
  }

  // Untuk renderer: tanpa gambar penuh, teks dipotong.
  list() {
    return this.items.map(({ id, type, text, thumb, at }) => ({ id, type, text: text.length > 500 ? text.slice(0, 500) + '…' : text, thumb, at }));
  }
}

module.exports = { ClipboardHistory };
