# Zenopod

Widget kecil berbentuk kapsul di tepi layar Windows, dengan maskot bulat bernama **Zeno** yang ikut bereaksi saat kamu bekerja.

**Yang bisa dilakukan Zenopod:**

- 🎵 **Musik:** judul lagu dan tombol putar/jeda/lanjut untuk Spotify, YouTube di browser, dan pemutar lain.
- 🔔 **Notifikasi:** notifikasi dari aplikasi lain (WhatsApp, Chrome, Outlook, …) muncul di kapsul, dan kamu bisa memilih aplikasi mana yang boleh masuk.
- 🚀 **Peluncur dan pencarian aplikasi:** buka aplikasi atau website favorit dengan sekali klik atau tombol 1–9, atau ketik untuk mencari semua aplikasi terpasang.
- ⏻ **Menu daya:** kunci, tidur, mulai ulang, matikan, dan keluar akun (dengan hitung mundur yang bisa dibatalkan).
- 🤖 **Claude Code:** Zeno ikut "berpikir" saat Claude bekerja, kamu bisa menjawab izin Claude langsung dari kapsul, dan pesan terakhir Claude muncul saat selesai.
- ⏰ **Pengingat, Pomodoro, catatan, dan riwayat clipboard.**
- 🌦️ **Cuaca, tanggal Masehi dan Hijriah, serta peringatan baterai.**
- 🎙️ **Perintah suara:** "Zeno, buka WhatsApp", "ingatkan aku pulang kerja jam 5", dan lainnya, diproses offline di laptopmu.
- 🐣 **Zeno peliharaan:** beri makan, ajak main, dan naik level dari kebiasaan baikmu (fokus, menyelesaikan tugas, minum air).
- 📊 **Statistik harian:** waktu fokus, tugas selesai, lagu paling sering diputar, dan ringkasan tiap malam.
- 💧 **Istirahat sehat:** pengingat istirahat mata (aturan 20-20-20) dan minum air.
- ⏱️ **Timer dan kalkulator cepat:** ketik `250.000 x 3` atau `timer 10 menit` di kotak cari.
- 🔊 **Kontrol cepat Windows:** volume, kecerahan layar, Wi-Fi, dan Bluetooth dari panel atau suara.
- 💬 **Ngobrol dengan Zeno** lewat Claude API (pakai API key milikmu sendiri).
- 📅 **Rapat berikutnya** dari Google Calendar atau Outlook, dengan pengingat dan tombol **Gabung** untuk Zoom, Meet, dan Teams.
- 🔍 **Ambil teks dari layar:** seret kotak di atas gambar, PDF hasil scan, atau video, dan teksnya langsung tersalin (offline).
- 📶 **Monitor sistem & internet:** CPU, RAM, disk, dan kabar saat internet putus atau tersambung lagi.
- 🔥 **Kebiasaan harian:** centang kebiasaan, jaga streak, dan Zeno dapat XP.
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
| Koneksi internet | Saat mengunduh, untuk cuaca, pembaruan otomatis, ngobrol dengan Zeno, dan sekali untuk mengunduh mesin suara |
| Ruang disk | Sekitar 400 MB (ditambah ~170 MB kalau memakai perintah suara) |
| [Node.js](https://nodejs.org/) 20+ | **Hanya** kalau menjalankan dari kode sumber (Cara B di bawah) |

---

## 2. Unduh dan pasang

### Cara A: installer (disarankan)

1. Buka halaman **[Releases](https://github.com/ardianramadhan/Zenopod/releases/latest)**.
2. Unduh `Zenopod-Setup-x.y.z.exe`, lalu jalankan.
3. Windows mungkin menampilkan **"Windows protected your PC"** karena installer belum ditandatangani. Klik **More info › Run anyway**.
4. Pilih folder (atau biarkan bawaan), lalu **Install**. Pintasan dibuat di Desktop dan Start Menu.

Kapsul hitam kecil muncul di kanan atas layar, dan ikon Zeno muncul di system tray (pojok kanan bawah, dekat jam). Versi installer **memperbarui dirinya sendiri** (lihat [bagian 9](#9-memperbarui-dan-menghapus)).

### Cara B: dari kode sumber

Butuh [Node.js](https://nodejs.org/) 20 atau lebih baru (cek dengan `node -v` di PowerShell).

```powershell
git clone https://github.com/ardianramadhan/Zenopod.git C:\Zenopod
cd C:\Zenopod
npm install
npm start
```

`npm install` butuh 1–3 menit karena mengunduh Electron. Tanpa Git: di halaman GitHub klik **Code › Download ZIP**, ekstrak, lalu jalankan `npm install` dan `npm start` di folder itu.

> **Tips:** supaya Zenopod menyala sendiri setiap hari, nyalakan **Jalankan saat Windows mulai** di Pengaturan › Tampilan (lihat [bagian 5](#5-pengaturan)).

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

- **Berganti isi sendiri** setiap 5 detik: jam, rapat berikutnya, lagu, cuaca, pengingat, tugas, kebiasaan yang belum dicentang (sore/malam), notifikasi, internet putus, dan sapaan.
- **Arahkan kursor** ke kapsul untuk membuka panel. Panel menutup sendiri saat kursor pergi.
- **Klik** kapsul untuk membuka panel dan menahannya tetap terbuka. Tekan **Esc** atau klik di luar untuk menutup.
- **Seret** kapsul untuk memindahkannya ke mana saja. Lepas di dekat kiri/tengah/kanan atas layar supaya menempel rapi. Saat panel terbuka, pakai pegangan **⋮⋮** di atas panel.
- **Main dengan Zeno:** klik kepala (dielus), pipi (dicolek), tengah (boop), atau bawah (digelitik). Di panel: tahan untuk memencet, klik dua kali untuk salto, gerakkan kursor bolak-balik untuk mengelus. Kalau diklik terus, Zeno kesal, pusing, lalu ngambek sebentar. Semua cara ini bisa dicoba di Pengaturan › **Panduan**.

### Panel

**Kontrol cepat:** klik ikon kontrol cepat (slider) di pojok kanan bawah panel untuk menggeser volume dan kecerahan, membisukan suara, serta menyalakan/mematikan Wi-Fi dan Bluetooth. Lewat suara: "Zeno, volume 30", "kecilkan volume", "bisukan", "kecerahan 70", "redupkan layar", "matikan wifi", "nyalakan bluetooth". Kecerahan hanya untuk layar laptop, bukan monitor eksternal.

**Ikon di pojok kanan bawah panel:** ambil teks dari layar, kontrol cepat, daya, dan ⚙ Pengaturan. Pengingat berikutnya tampil di kiri bawah; klik untuk membuka daftar pengingat.

**Ambil teks dari layar:** klik ikon pindai di pojok kanan bawah panel (atau `Ctrl` + `Alt` + `O`), lalu seret kotak di sekitar tulisan.

**Menu daya:** klik ikon ⏻ di bawah panel. **Kunci** dan **Tidur** langsung berjalan. **Mulai ulang**, **Matikan**, dan **Keluar akun** menunggu 10 detik (tekan **Batal** untuk membatalkan, atau tutup panel). Aplikasi yang punya pekerjaan belum disimpan tetap bisa menahan Windows. Lewat suara: "Zeno, matikan laptop", "restart", "kunci layar", atau "mode tidur". Untuk mematikan dan memulai ulang, muncul kartu konfirmasi dulu.

**Kartu atas** bisa di-swipe (seret, scroll horizontal, klik titik, atau tombol ← →):

| Halaman | Isi |
|---|---|
| Claude Code | Muncul saat Claude bekerja: proyek, langkah, aktivitas terakhir |
| Musik | Lagu yang diputar dan kontrolnya |
| Sapaan | Selamat pagi/siang/sore/malam |
| Tanggal & jam | Jam, tanggal Masehi dan Hijriah |
| Agenda | 3 acara berikutnya dan tombol **Gabung** rapat online (kalau kalender disambungkan) |
| Cuaca | Suhu, kondisi, perkiraan 3 jam (kalau cuaca diaktifkan) |
| Hari ini | Pengingat berikutnya, rapat berikutnya, tugas, sesi fokus, dan statistik hari ini |
| Kebiasaan | Kebiasaan hari ini: klik untuk mencentang, 🔥 = streak (kalau sudah ada kebiasaan) |
| Zeno | Peliharaanmu: rasa kenyang, level, tombol beri makan (🍪 🍎 🍙) dan ajak main |
| Sistem | Internet (tersambung/putus, waktu respons), CPU, RAM, dan sisa disk |

**Tab di bawahnya:**

| Tab | Isi |
|---|---|
| Aplikasi | Tombol peluncur dan kotak **Cari aplikasi** (ketik saja saat panel terbuka; ↑↓ pilih, Enter buka). Kotak yang sama juga kalkulator, timer, dan tempat bertanya ke Zeno |
| Notif | Notifikasi masuk. Klik untuk membuka aplikasinya, × untuk menghapus |
| Fokus | Timer Pomodoro (25 menit fokus, 5 menit istirahat) dan timer cepat yang sedang berjalan |
| Klip | 20 teks atau gambar terakhir yang kamu salin. Klik untuk menyalin lagi |
| Catatan | Daftar tugas cepat |
| Dev | Status server lokal dan Git (muncul setelah ada server/project di Pengaturan › Dev) |

### Kalkulator, timer, dan bertanya dari kotak cari

Ketik di kotak **Cari aplikasi**:

| Ketik | Hasil |
|---|---|
| `250.000 x 3` · `(12+8)/4` · `15% x 80.000` | Hasilnya langsung tampil, Enter = salin. Titik = ribuan, koma = desimal |
| `timer 10 menit` · `timer 1 jam 30 menit` | Enter = mulai timer. Zeno berbunyi saat waktunya habis. Batalkan di tab Fokus |
| Pertanyaan apa saja | Baris **Tanya Zeno** (kalau ngobrol sudah disiapkan, lihat [bagian 6](#6-menyiapkan-fitur-khusus)) |

Lewat suara: "Zeno, berapa 250 ribu kali 3", "timer 10 menit", "batalkan timer".

### Zeno peliharaan

- Zeno pelan-pelan lapar (rasa kenyang turun sekitar 12% per jam saat laptop menyala). Kalau lapar, Zeno memberi tahu dan wajahnya berubah.
- Beri makan dari halaman **Zeno** di panel, atau bilang "Zeno, makan dulu" / "kasih makan Zeno".
- Zeno mendapat XP dari kebiasaan baikmu: sesi fokus selesai, tugas dicentang, pengingat selesai, minum air, istirahat mata, dan diberi makan. Saat naik level, Zeno berpesta.

### Statistik dan ringkasan harian

Halaman **Hari ini** menampilkan waktu fokus, tugas selesai, dan lagu yang paling sering diputar hari ini. Setiap malam (bawaan jam 20.00) Zeno mengirim ringkasan hari itu. Riwayat 7 hari ada di Pengaturan › **Statistik**. Lewat suara: "Zeno, statistik hari ini".

### Ambil teks dari layar

1. Tekan `Ctrl` + `Alt` + `O`, klik ikon pindai di pojok kanan bawah panel, atau bilang "Zeno, ambil teks".
2. Layar membeku. Seret kotak di sekitar tulisan (**Esc** atau klik kanan = batal).
3. Teksnya langsung tersalin, siap ditempel. Kartu Zeno menampilkan cuplikannya.

Memakai OCR bawaan Windows, jadi offline dan gratis. Cocok untuk gambar, PDF hasil scan, slide di video, atau pesan error yang tidak bisa diseleksi.

### Kebiasaan harian

- Tambahkan kebiasaan di Pengaturan › **Kebiasaan**: ikon, nama, hari (setiap hari, hari kerja, atau pilih sendiri), dan jam pengingat (opsional).
- Centang dari halaman **Kebiasaan** di panel, tombol **Sudah** di kartu pengingat, atau suara: "Zeno, sudah olahraga".
- 🔥 **Streak** = hari terjadwal berturut-turut yang dicentang. Hari yang tidak dijadwalkan tidak memutus streak, dan hari ini baru dihitung putus besok.
- Setiap kebiasaan yang dicentang memberi Zeno 10 XP (sekali per hari).

### Rapat dan agenda

Setelah kalender disambungkan (lihat [bagian 6](#6-menyiapkan-fitur-khusus)):

- Rapat 2 jam ke depan tampil di kapsul, dan 3 acara berikutnya di halaman **Agenda**.
- 10 menit sebelum mulai (bisa diatur), Zeno memunculkan kartu rapat. Kalau ada link Zoom, Google Meet, Teams, atau Webex, tekan **Gabung**.
- Lewat suara: "Zeno, jadwal hari ini" atau "ada rapat besok?".

### Sistem & internet

- Internet dicek tiap 15 detik. Saat putus, Zeno sedih dan kapsul menampilkan "Internet putus". Saat tersambung lagi, Zeno memberi tahu berapa lama tadi putus.
- Zeno memberi tahu saat CPU ≥ 90% selama satu menit, RAM ≥ 90%, atau disk sistem tinggal kurang dari 10%.
- Lewat suara: "Zeno, internetnya nyala?" atau "status laptop".

### Istirahat sehat

- **Mata:** setiap 20 menit di depan layar, Zeno mengajak memandang sesuatu sekitar 6 meter selama 20 detik.
- **Air:** setiap 60 menit, Zeno mengingatkan minum. Tekan **Sudah minum** untuk mencatatnya.

Pengingat tidak muncul saat laptop tidak dipakai, dan bisa diatur atau dimatikan di Pengaturan › **Fokus** › Istirahat sehat.

### Tombol pintas

| Tombol | Fungsi |
|---|---|
| `Ctrl` + `Alt` + `K` | Buka/tutup panel |
| `Ctrl` + `Alt` + `Z` | Perintah suara (bicara, lalu diam sebentar) |
| `Ctrl` + `Alt` + `O` | Ambil teks dari layar |
| `1` – `9` (saat panel terbuka) | Jalankan aplikasi ke-1 sampai ke-9 |
| `Spasi` (saat panel terbuka) | Putar/jeda musik |
| `←` `→` (saat panel terbuka) | Pindah halaman kartu atas |
| Huruf apa saja (saat panel terbuka) | Langsung mencari aplikasi |
| `Esc` | Tutup panel (atau tutup menu daya / kosongkan pencarian) |

Semua tombol pintas bisa diganti di Pengaturan.

---

## 5. Pengaturan

Buka dari ikon ⚙ di pojok kanan bawah panel, atau klik kanan ikon tray › **Pengaturan…**. Semua perubahan langsung tersimpan. Menu dikelompokkan (Mulai, Panel, Produktivitas, Asisten, Info & sistem, Developer), dan kotak **Cari pengaturan** di atas menu membantu menemukan yang dicari (mis. ketik "rapat" atau "ocr").

| Bagian | Yang bisa diatur |
|---|---|
| **Panduan** | Cara memakai kapsul & panel, cara bermain dengan Zeno (dengan tombol **Coba**), arti ikon, contoh kotak cari dan perintah suara |
| **Profil** | Namamu, nama maskot, tanggal lahir (untuk topi pesta di hari ulang tahunmu), sapaan |
| **Aplikasi** | **Tambah aplikasi** (pilih dari daftar aplikasi terpasang), **Tambah website**, atur urutan ↑↓, hapus |
| **Notifikasi** | Kartu notifikasi baru dan lama tampilnya, saklar per aplikasi (aplikasi muncul setelah notifikasi pertamanya masuk), riwayat clipboard |
| **Pengingat** | Judul, tanggal, jam, dan pengulangan: sekali, setiap hari, atau hari kerja |
| **Kalender** | Sambungkan Google Calendar / Outlook, kapan diingatkan sebelum rapat |
| **Fokus** | Durasi fokus, istirahat, dan istirahat panjang; istirahat otomatis; tahan notifikasi saat fokus; pengingat istirahat mata dan minum air |
| **Kebiasaan** | Tambah, urutkan, hapus kebiasaan; hari dan jam pengingat; centang hari ini |
| **Statistik** | Tabel 7 hari terakhir, ringkasan harian dan jamnya |
| **Claude Code** | Pasang/lepas hook, jawab izin dari Zenopod, kartu Claude |
| **Dev** | Daftar server lokal (website atau port) dan folder project Git yang dipantau |
| **Ngobrol** | API key Claude, pilihan model, tombol coba |
| **Perintah suara** | Unduh mesin suara, tombol pintas, suara jawaban Zeno, kecepatan dan nada |
| **Cuaca & baterai** | Pilih kota, kabar saat hujan, peringatan baterai |
| **Sistem & layar** | Tombol pintas ambil teks, kabar internet putus, kabar CPU/RAM/disk |
| **Suara** | Saklar utama, volume, saklar per kategori, dan tombol ▶ untuk mendengarkan tiap suara |
| **Tampilan** | Posisi, kostum Zeno (otomatis atau pilih sendiri), tombol pintas panel, versi dan **Cek pembaruan**, **Jalankan saat Windows mulai** |

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
   - "Kunci layar" · "Mode tidur" · "Restart" · "Matikan laptop" (selalu dikonfirmasi dulu)

Kalau Windows meminta izin mikrofon, izinkan. Atau buka **Pengaturan Windows › Privasi & keamanan › Mikrofon** dan nyalakan akses untuk aplikasi desktop.

**Supaya Zeno menjawab dengan suara**, pasang suara Bahasa Indonesia (gratis):

1. **Pengaturan Windows › Waktu & bahasa › Ucapan › Tambahkan suara**.
2. Pilih **Bahasa Indonesia (Microsoft Andika)**, lalu pasang.
3. Tutup lalu buka lagi Zenopod. Coba lewat Pengaturan › Perintah suara › **Coba suara Zeno**.

Tanpa suara itu, jawaban Zeno tetap muncul sebagai kartu.

### 🌦️ Cuaca

Pengaturan › **Cuaca & baterai** › ketik nama kota › **Cari kota** › pilih. Halaman Cuaca langsung muncul di panel.

### 📅 Kalender (Google Calendar / Outlook)

Zenopod membaca kalender lewat **alamat iCal rahasia** (hanya-baca, tanpa login):

**Google Calendar**
1. Buka [calendar.google.com](https://calendar.google.com/) › ⚙ **Setelan**.
2. Di kiri, pilih kalendermu › **Integrasikan kalender**.
3. Salin **Alamat rahasia dalam format iCal** (berakhiran `basic.ics`).

**Outlook / Microsoft 365**
1. Buka [outlook.office.com](https://outlook.office.com/) › ⚙ **Pengaturan** › **Kalender** › **Kalender bersama**.
2. Di **Publikasikan kalender**, pilih kalender dan **Dapat melihat semua detail**, lalu **Publikasikan**.
3. Salin tautan **ICS**.

Lalu di Zenopod: Pengaturan › **Kalender** › isi nama dan alamatnya › **Sambungkan**. Bisa lebih dari satu kalender. Kalender diperbarui tiap 10 menit.

> Alamat iCal rahasia seperti kunci baca kalendermu. Zenopod menyimpannya terenkripsi dan tidak pernah menampilkannya utuh. Kalau alamatnya bocor, buat ulang di Google/Outlook (alamat lama langsung mati), lalu sambungkan lagi.

### 💬 Ngobrol dengan Zeno

Zeno menjawab pertanyaan singkat memakai Claude API. Kamu butuh API key sendiri, dan pemakaiannya **berbayar** sesuai tarif Anthropic (ditagih ke akunmu, bukan ke Zenopod).

1. Buat API key di [console.anthropic.com](https://console.anthropic.com/) › **API Keys**.
2. Pengaturan › **Ngobrol** › tempel key › **Simpan**, lalu **Coba**.
3. Pilih model: **Claude Opus 5** (paling pintar, bawaan), **Claude Sonnet 5** (seimbang), atau **Claude Haiku 4.5** (paling cepat dan murah).
4. Bertanya lewat kotak cari (baris **Tanya Zeno**) atau suara: "Zeno, apa ibu kota Australia?". Ucapan yang bukan perintah juga diteruskan ke Claude.

Zeno mengingat 10 pesan terakhir, dan lupa setelah 10 menit tidak diajak ngobrol. API key disimpan terenkripsi oleh Windows dan tidak pernah ditampilkan utuh. Kalau variabel lingkungan `ANTHROPIC_API_KEY` sudah ada, Zeno bisa memakainya.

### 🤖 Claude Code

Untuk yang memakai [Claude Code](https://claude.com/claude-code):

1. Pengaturan › **Claude Code** › **Pasang hook**.
2. Mulai sesi Claude Code baru. Zeno akan:
   - **berpikir** dan menampilkan aktivitas Claude saat Claude bekerja;
   - memunculkan tombol **Izinkan / Tolak / Di terminal** saat Claude minta izin (kalau tidak dijawab 90 detik, dialog biasa muncul di terminal);
   - menampilkan pesan terakhir Claude saat selesai.

Hook ditambahkan ke `%USERPROFILE%\.claude\settings.json` tanpa mengubah hook lain, dan salinannya disimpan sebagai `settings.json.kapsul-backup`. Hook memakai Node.js kalau terpasang; kalau tidak, versi installer menjalankan hook lewat `Zenopod.exe` sendiri.

> Kalau kamu memakai aplikasi lain yang juga memasang hook izin Claude Code, sebaiknya fitur "Jawab izin" hanya dinyalakan di salah satu aplikasi.

---

## 7. Privasi

- **Lokal:** semua data tersimpan di laptopmu: pengaturan di `config.json` (versi installer: `%APPDATA%\kapsul`, versi kode sumber: folder Zenopod), statistik dan peliharaan di `%APPDATA%\kapsul\stats.json`. Tidak ada akun dan tidak ada server Zenopod.
- **Ngobrol:** hanya pertanyaan yang kamu kirim ke Zeno (dan percakapan 10 menit terakhir) yang dikirim ke Anthropic. Mati kalau tidak ada API key.
- **Pembaruan:** versi installer mengecek GitHub Releases tiap 6 jam.
- **Kalender:** Zenopod hanya mengunduh file kalender dari Google/Outlook. Alamatnya disimpan terenkripsi oleh Windows.
- **Ambil teks:** gambar potongan layar diproses OCR Windows di laptop ini lalu langsung dihapus. Teksnya hanya masuk clipboard.
- **Internet:** dicek ke alamat uji koneksi Microsoft (`msftconnecttest.com`), yang juga dipakai Windows untuk ikon jaringan.
- **Suara:** diproses offline oleh whisper.cpp dan tidak pernah dikirim ke internet. Mikrofon hanya menyala selama Zeno mendengar.
- **Notifikasi dan clipboard:** hanya dibaca untuk ditampilkan. Riwayat clipboard hanya ada di memori (hilang saat Zenopod ditutup), dan salinan dari password manager dilewati.
- **Cuaca:** yang dikirim ke [Open-Meteo](https://open-meteo.com/) hanya nama kota yang kamu cari dan koordinatnya.

---

## 8. Masalah umum

| Masalah | Solusi |
|---|---|
| "Windows protected your PC" saat memasang | Installer belum ditandatangani. Klik **More info › Run anyway** |
| Ngobrol: "API key Claude tidak valid" | Periksa key di Pengaturan › Ngobrol, atau buat key baru di console.anthropic.com |
| Ngobrol: saldo habis | Isi saldo di console.anthropic.com › Billing |
| Kalender: "alamat tidak valid atau sudah diganti" | Salin ulang alamat iCal rahasia (Google) atau tautan ICS (Outlook). Alamat lama mati kalau pernah dibuat ulang |
| Rapat tidak muncul | Pastikan kalendernya yang benar disambungkan, lalu Pengaturan › Kalender › **Muat ulang**. Outlook bisa butuh beberapa menit sampai perubahan terbit |
| Ambil teks: "Paket OCR Windows belum ada" | Tambahkan bahasa Inggris di Pengaturan Windows › Waktu & bahasa › Bahasa & wilayah |
| Kecerahan tidak berubah | Hanya layar laptop yang didukung; monitor eksternal diatur dari tombol monitornya |
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

**Versi installer:** otomatis. Zenopod mengecek versi baru tiap 6 jam, mengunduhnya diam-diam, lalu Zeno menawarkan **Mulai ulang**. Kalau dilewati, versi baru dipasang saat Zenopod ditutup. Cek manual: Pengaturan › Tampilan › **Cek pembaruan**.

**Versi kode sumber:**

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
4. Versi installer: **Pengaturan Windows › Aplikasi › Aplikasi terinstal › Zenopod › Uninstall**. Versi kode sumber: hapus folder Zenopod.
5. Hapus folder `%APPDATA%\kapsul` untuk menghapus pengaturan dan statistik.

---

## 10. Untuk developer

```text
main.js              Proses utama Electron: jendela kapsul, kartu, tray, shortcut, Pengaturan
bridge.ps1           Helper PowerShell (WinRT): musik, notifikasi Windows, suara Zeno (TTS),
                     volume, kecerahan, Wi-Fi, Bluetooth, OCR
lib/
  config.js          Baca/tulis config.json
  paths.js           Lokasi file (kode sumber vs versi terpasang)
  stats.js           Statistik harian dan Zeno peliharaan (stats.json)
  calc.js            Kalkulator aman (tanpa eval) dan pengurai durasi timer
  chat.js            Ngobrol lewat Claude API (@anthropic-ai/sdk)
  calendar.js        Kalender dari alamat iCal (node-ical): acara berulang, link rapat
  habits.js          Kebiasaan & streak
  sysmon.js          CPU, RAM, disk, dan cek internet
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
- Mesin suara diunduh ke `vendor/whisper` (tidak masuk Git; versi terpasang: `%APPDATA%\kapsul\whisper`).

- Mencoba versi kode di samping versi terpasang: isi variabel `ZENOPOD_DATA_DIR` dengan folder lain. Config, statistik, dan kunci tunggal (single instance) ikut pindah ke sana, jadi keduanya bisa jalan bersamaan.

### Membuat installer dan rilis

```powershell
npm run dist      # dist\Zenopod-Setup-<versi>.exe, tanpa diunggah
```

Untuk merilis versi baru (dan memicu pembaruan otomatis di laptop pengguna):

1. Naikkan `version` di `package.json`.
2. Buat token GitHub (scope `repo`), lalu `$env:GH_TOKEN = "<token>"`.
3. `npm run release`. Installer dan `latest.yml` diunggah sebagai draft release di GitHub.
4. Buka halaman Releases, periksa draft-nya, lalu **Publish release**.

### Kredit

- Pengenal suara [whisper.cpp](https://github.com/ggml-org/whisper.cpp).
- Data cuaca [Open-Meteo](https://open-meteo.com/).
- Ngobrol lewat [Claude API](https://docs.claude.com/) dari Anthropic.
