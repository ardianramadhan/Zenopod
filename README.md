# Zenopod

Widget kecil berbentuk kapsul di tepi layar Windows, dengan maskot bulat bernama **Zeno** yang ikut bereaksi saat kamu bekerja. Terinspirasi [Coucou](https://github.com/Louis-CFM/coucou).

**Yang bisa dilakukan Zenopod:**

- 🎵 **Musik:** judul lagu dan tombol putar/jeda/lanjut untuk Spotify, YouTube di browser, dan pemutar lain.
- 🔔 **Notifikasi:** notifikasi dari aplikasi lain (WhatsApp, Chrome, Outlook, …) muncul di kapsul, dan kamu bisa memilih aplikasi mana yang boleh masuk.
- 🚀 **Peluncur aplikasi:** buka aplikasi atau website favorit dengan sekali klik atau tombol 1–9.
- 🤖 **Claude Code:** Zeno ikut "berpikir" saat Claude bekerja, kamu bisa menjawab izin Claude langsung dari kapsul, dan pesan terakhir Claude muncul saat selesai.
- ⏰ **Pengingat, Pomodoro, catatan, dan riwayat clipboard.**
- 🌦️ **Cuaca, tanggal Masehi dan Hijriah, serta peringatan baterai.**
- 🎙️ **Perintah suara:** "Zeno, buka WhatsApp", "ingatkan aku pulang kerja jam 5", dan lainnya, diproses offline di laptopmu.
- 🎭 **Maskot hidup:** puluhan ekspresi, mata mengikuti kursor, suara-suara kecil, dan kostum musiman (peci saat Jumat dan Ramadan, ketupat saat Lebaran, merah putih saat 17 Agustus, topi pesta saat ulang tahunmu).

> Zenopod saat ini **hanya untuk Windows 10/11**.

---

## Daftar isi

1. [Kebutuhan](#1-kebutuhan)
2. [Unduh dan pasang](#2-unduh-dan-pasang)
3. [Pertama kali dibuka](#3-pertama-kali-dibuka)
4. [Cara pakai sehari-hari](#4-cara-pakai-sehari-hari)
5. [Pengaturan](#5-pengaturan)
6. [Menyiapkan fitur khusus](#6-menyiapkan-fitur-khusus)
7. [Privasi](#7-privasi)
8. [Masalah umum](#8-masalah-umum)
9. [Memperbarui dan menghapus](#9-memperbarui-dan-menghapus)
10. [Untuk developer](#10-untuk-developer)

---

## 1. Kebutuhan

| Kebutuhan | Keterangan |
|---|---|
| Windows 10 atau 11 | 64-bit |
| [Node.js](https://nodejs.org/) versi 20 atau lebih baru | Pilih versi **LTS**, lalu install dengan pilihan bawaan |
| Koneksi internet | Hanya saat instalasi, untuk cuaca, dan sekali untuk mengunduh mesin suara |
| Ruang disk | Sekitar 400 MB (ditambah ~170 MB kalau memakai perintah suara) |

Untuk mengecek apakah Node.js sudah terpasang, buka **PowerShell** lalu ketik:

```powershell
node -v
```

Kalau keluar angka seperti `v22.x.x`, Node.js sudah siap.

---

## 2. Unduh dan pasang

### Langkah 1: Unduh Zenopod

**Cara A, tanpa Git (paling mudah):**

1. Buka https://github.com/ardianramadhan/Zenopod
2. Klik tombol hijau **Code** › **Download ZIP**.
3. Ekstrak ZIP ke folder yang mudah ditemukan, misalnya `C:\Zenopod`.

**Cara B, dengan Git (lebih mudah untuk memperbarui nanti):**

```powershell
git clone https://github.com/ardianramadhan/Zenopod.git C:\Zenopod
```

### Langkah 2: Pasang

Buka **PowerShell**, masuk ke folder Zenopod, lalu jalankan:

```powershell
cd C:\Zenopod
npm install
```

Tunggu sampai selesai (1–3 menit, karena mengunduh Electron).

### Langkah 3: Jalankan

```powershell
npm start
```

Kapsul hitam kecil muncul di kanan atas layar, dan ikon titik biru muncul di system tray (pojok kanan bawah, dekat jam).

> **Tips:** supaya tidak perlu mengetik `npm start` setiap hari, nyalakan **Jalankan saat Windows mulai** di Pengaturan › Tampilan (lihat [bagian 5](#5-pengaturan)).

---

## 3. Pertama kali dibuka

Jendela perkenalan langsung terbuka:

1. Zeno menanyakan **namamu**.
2. Zeno minta **diberi nama**. Bebas, misalnya "Zeno".
3. Selesai. Zeno akan menyapamu setiap pagi, siang, sore, dan malam.

Setelah itu, buka **Pengaturan** (lihat di bawah) untuk memilih aplikasi di peluncur, kota untuk cuaca, dan lainnya.

---

## 4. Cara pakai sehari-hari

### Kapsul kecil

- **Berganti isi sendiri** setiap 5 detik: jam, lagu, cuaca, pengingat, tugas, notifikasi, dan sapaan.
- **Arahkan kursor** ke kapsul untuk membuka panel. Panel menutup sendiri saat kursor pergi.
- **Klik** kapsul untuk membuka panel dan menahannya tetap terbuka. Tekan **Esc** atau klik di luar untuk menutup.
- **Seret** kapsul untuk memindahkannya ke mana saja. Lepas di dekat kiri/tengah/kanan atas layar supaya menempel rapi. Saat panel terbuka, pakai pegangan **⋮⋮** di atas panel.
- **Klik Zeno** dan lihat reaksinya. Kalau diklik terus, Zeno bisa marah lalu menangis.

### Panel

**Kartu atas** bisa di-swipe (seret, scroll horizontal, klik titik, atau tombol ← →):

| Halaman | Isi |
|---|---|
| Claude Code | Muncul saat Claude bekerja: proyek, langkah, aktivitas terakhir |
| Musik | Lagu yang diputar dan kontrolnya |
| Sapaan | Selamat pagi/siang/sore/malam |
| Tanggal & jam | Jam, tanggal Masehi dan Hijriah |
| Cuaca | Suhu, kondisi, perkiraan 3 jam (kalau cuaca diaktifkan) |
| Hari ini | Pengingat berikutnya, tugas, sesi fokus |

**Tab di bawahnya:**

| Tab | Isi |
|---|---|
| Aplikasi | Tombol peluncur |
| Notif | Notifikasi masuk. Klik untuk membuka aplikasinya, × untuk menghapus |
| Fokus | Timer Pomodoro (25 menit fokus, 5 menit istirahat) |
| Klip | 20 teks atau gambar terakhir yang kamu salin. Klik untuk menyalin lagi |
| Catatan | Daftar tugas cepat |
| Dev | Status server lokal dan Git (untuk programmer) |

### Tombol pintas

| Tombol | Fungsi |
|---|---|
| `Ctrl` + `Alt` + `K` | Buka/tutup panel |
| `Ctrl` + `Alt` + `Z` | Perintah suara (bicara, lalu diam sebentar) |
| `1` – `9` (saat panel terbuka) | Jalankan aplikasi ke-1 sampai ke-9 |
| `Spasi` (saat panel terbuka) | Putar/jeda musik |
| `←` `→` (saat panel terbuka) | Pindah halaman kartu atas |
| `Esc` | Tutup panel |

Semua tombol pintas bisa diganti di Pengaturan.

---

## 5. Pengaturan

Buka dari tombol **Pengaturan** di bawah panel, atau klik kanan ikon tray › **Pengaturan…**. Semua perubahan langsung tersimpan.

| Bagian | Yang bisa diatur |
|---|---|
| **Profil** | Namamu, nama maskot, tanggal lahir (untuk topi pesta di hari ulang tahunmu), sapaan |
| **Aplikasi** | **Tambah aplikasi** (pilih dari daftar aplikasi terpasang), **Tambah website**, atur urutan ↑↓, hapus |
| **Notifikasi** | Kartu notifikasi baru dan lama tampilnya, saklar per aplikasi (aplikasi muncul setelah notifikasi pertamanya masuk), riwayat clipboard |
| **Pengingat** | Judul, tanggal, jam, dan pengulangan: sekali, setiap hari, atau hari kerja |
| **Fokus** | Durasi fokus, istirahat, dan istirahat panjang; istirahat otomatis; tahan notifikasi saat fokus |
| **Claude Code** | Pasang/lepas hook, jawab izin dari Zenopod, kartu Claude |
| **Dev** | Daftar server lokal (website atau port) dan folder project Git yang dipantau |
| **Perintah suara** | Unduh mesin suara, tombol pintas, suara jawaban Zeno, kecepatan dan nada |
| **Cuaca & baterai** | Pilih kota, kabar saat hujan, peringatan baterai |
| **Suara** | Saklar utama, volume, saklar per kategori, dan tombol ▶ untuk mendengarkan tiap suara |
| **Tampilan** | Posisi, kostum Zeno (otomatis atau pilih sendiri), tombol pintas panel, **Jalankan saat Windows mulai** |

---

## 6. Menyiapkan fitur khusus

### 🔔 Notifikasi dari aplikasi lain

Biasanya langsung jalan. Kalau tab **Notif** bilang belum diizinkan:

1. Buka **Pengaturan Windows › Privasi & keamanan › Notifikasi**.
2. Nyalakan akses notifikasi untuk aplikasi desktop.
3. Tutup lalu buka lagi Zenopod.

### 🎙️ Perintah suara

1. Buka Pengaturan › **Perintah suara**, lalu klik **Unduh mesin suara** (~170 MB, sekali saja).
2. Tekan `Ctrl` + `Alt` + `Z`, bicara, lalu diam sebentar. Zeno berhenti mendengar sendiri.
3. Contoh perintah:
   - "Zeno, buka WhatsApp"
   - "Putar musik" · "Jeda lagu" · "Lagu berikutnya"
   - "Ingatkan aku pulang kerja jam 5" · "Ingetin 10 menit lagi angkat jemuran"
   - "Catat beli kopi"
   - "Mulai fokus" · "Berhenti fokus"
   - "Jam berapa?" · "Hari ini tanggal berapa?" · "Gimana cuacanya?"

Kalau Windows meminta izin mikrofon, izinkan. Atau buka **Pengaturan Windows › Privasi & keamanan › Mikrofon** dan nyalakan akses untuk aplikasi desktop.

**Supaya Zeno menjawab dengan suara**, pasang suara Bahasa Indonesia (gratis):

1. **Pengaturan Windows › Waktu & bahasa › Ucapan › Tambahkan suara**.
2. Pilih **Bahasa Indonesia (Microsoft Andika)**, lalu pasang.
3. Tutup lalu buka lagi Zenopod. Coba lewat Pengaturan › Perintah suara › **Coba suara Zeno**.

Tanpa suara itu, jawaban Zeno tetap muncul sebagai kartu.

### 🌦️ Cuaca

Pengaturan › **Cuaca & baterai** › ketik nama kota › **Cari kota** › pilih. Halaman Cuaca langsung muncul di panel.

### 🤖 Claude Code

Untuk yang memakai [Claude Code](https://claude.com/claude-code):

1. Pengaturan › **Claude Code** › **Pasang hook**.
2. Mulai sesi Claude Code baru. Zeno akan:
   - **berpikir** dan menampilkan aktivitas Claude saat Claude bekerja;
   - memunculkan tombol **Izinkan / Tolak / Di terminal** saat Claude minta izin (kalau tidak dijawab 90 detik, dialog biasa muncul di terminal);
   - menampilkan pesan terakhir Claude saat selesai.

Hook ditambahkan ke `%USERPROFILE%\.claude\settings.json` tanpa mengubah hook lain, dan salinannya disimpan sebagai `settings.json.kapsul-backup`.

> Kalau kamu juga memakai Coucou, sebaiknya fitur "Jawab izin" hanya dinyalakan di salah satu aplikasi.

---

## 7. Privasi

- **Lokal:** semua data tersimpan di laptopmu (`config.json` di folder Zenopod). Tidak ada akun dan tidak ada server Zenopod.
- **Suara:** diproses offline oleh whisper.cpp dan tidak pernah dikirim ke internet. Mikrofon hanya menyala selama Zeno mendengar.
- **Notifikasi dan clipboard:** hanya dibaca untuk ditampilkan. Riwayat clipboard hanya ada di memori (hilang saat Zenopod ditutup), dan salinan dari password manager dilewati.
- **Cuaca:** yang dikirim ke [Open-Meteo](https://open-meteo.com/) hanya nama kota yang kamu cari dan koordinatnya.

---

## 8. Masalah umum

| Masalah | Solusi |
|---|---|
| `npm` atau `node` tidak dikenali | Node.js belum terpasang, atau PowerShell dibuka sebelum Node.js terpasang. Pasang Node.js, lalu buka PowerShell baru |
| Setelah `npm start` tidak muncul apa-apa | Lihat pesan error di PowerShell. Pastikan `npm install` sudah selesai tanpa error |
| Kapsul tidak terlihat | Mungkin tertutup aplikasi lain di posisi yang sama. Klik kanan ikon tray › **Posisi** › pilih posisi lain, atau seret kapsulnya |
| Tombol pintas tidak bekerja | Kemungkinan dipakai aplikasi lain. Ganti di Pengaturan › Tampilan (panel) atau Perintah suara |
| Judul lagu tidak muncul | Pastikan pemutarnya mendukung kontrol media Windows (Spotify, Chrome, Edge, dan sebagian besar pemutar sudah mendukung) |
| Zeno salah dengar | Bicara lebih dekat ke mikrofon dan jelas, lalu diam sebentar setelah selesai |
| Ikon aplikasi kosong | Hapus lalu tambahkan lagi aplikasinya di Pengaturan › Aplikasi |
| Muncul peringatan "Electron Security Warning" di PowerShell | Normal saat dijalankan dari sumber. Bisa diabaikan |

---

## 9. Memperbarui dan menghapus

### Memperbarui

Kalau memakai Git:

```powershell
cd C:\Zenopod
git pull
npm install
```

Kalau memakai ZIP: unduh ZIP terbaru, lalu salin `config.json` dari folder lama ke folder baru supaya pengaturanmu tetap ada.

### Menghapus

1. Pengaturan › **Claude Code** › **Lepas hook** (kalau pernah dipasang).
2. Pengaturan › **Tampilan** › matikan **Jalankan saat Windows mulai**.
3. Klik kanan ikon tray › **Keluar**.
4. Hapus folder Zenopod dan folder `%APPDATA%\kapsul`.

---

## 10. Untuk developer

```text
main.js              Proses utama Electron: jendela kapsul, kartu, tray, shortcut, Pengaturan
bridge.ps1           Helper PowerShell (WinRT): musik, notifikasi Windows, suara Zeno (TTS)
lib/
  config.js          Baca/tulis config.json
  apps.js            Peluncur dan daftar aplikasi terpasang
  claude.js          Server hook Claude Code (127.0.0.1:47821) dan pemasang hook
  commands.js        Pengurai perintah suara (bahasa Indonesia)
  voice.js           whisper.cpp: unduh dan transkripsi
  schedule.js        Sapaan dan jadwal pengingat
  focus.js           Pomodoro
  clipboard.js       Riwayat clipboard (hanya memori)
  devwatch.js        Status server lokal dan Git
  season.js          Kostum musiman (Hijriah Umm al-Qura)
  weather.js         Open-Meteo
hooks/kapsul-hook.js Hook Claude Code
renderer/            Tampilan: kapsul (index.html, app.js), Pengaturan (settings.*),
                     maskot (buddy.js/css), suara efek (sounds.js)
start.js             Menjalankan Electron tanpa ELECTRON_RUN_AS_NODE (diset oleh terminal VS Code)
```

- Untuk diagnosa, jalankan dengan variabel `KAPSUL_DEBUG` berisi path file log. Lognya mencatat kapan helper PowerShell mulai, error-nya, dan kapan ia keluar.
- Mesin suara diunduh ke `vendor/whisper` (tidak masuk Git).

### Kredit

- Ide dari [Coucou](https://github.com/Louis-CFM/coucou) oleh Louis Raillé. Karakter Mochi tidak dipakai; Zeno adalah maskot baru.
- Pengenal suara [whisper.cpp](https://github.com/ggml-org/whisper.cpp).
- Data cuaca [Open-Meteo](https://open-meteo.com/).
