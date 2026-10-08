# JobingHo Bot WhatsApp

Bot WhatsApp yang membalas pesan menggunakan endpoint OpenAI-compatible Limit Router dan model `Qwen3.8-27B`.

## Menjalankan

1. Pastikan Node.js 20 atau lebih baru terpasang.
2. Install dependency:

   ```bash
   npm install
   ```

3. Buat file konfigurasi dan isi API key:

   ```bash
   cp .env.example .env
   ```

   Isi `LIMITROUTER_API_KEY` di `.env`. Jangan commit file `.env`.
4. Jalankan bot:

   ```bash
   npm start
   ```

5. Scan QR yang muncul lewat WhatsApp → Perangkat tertaut.

Sesi login tersimpan di `auth_info_baileys`, sehingga QR tidak perlu dipindai setiap kali restart. Bot hanya membalas pesan dengan format `/c pesan Anda`; pesan biasa akan diabaikan. Kirim `/reset` untuk menghapus riwayat percakapan pada chat aktif.

## Keamanan

API key yang dikirim di chat sudah terekspos. Sebaiknya cabut/revoke key tersebut di Limit Router dan buat key baru, lalu simpan hanya di `.env` atau secret manager.
