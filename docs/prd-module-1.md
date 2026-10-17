# Feature Specification: Tampermonkey Instant Link Collector

## Overview

Modul ini adalah ekstensi berbasis Tampermonkey yang memungkinkan pengguna menyimpan tautan web (link) secara instan ke dalam database dengan satu klik. Ekstensi ini mengekstrak metadata (URL, judul, dan \*thumbnail\* Open Graph) langsung dari browser klien dan mengirimkannya ke API Next.js, memastikan performa \*zero-scraping\* pada server Vercel untuk menjaga penggunaan \*Free Tier\* tetap aman.

## Goals

\* \*\*User-facing goal:\*\* Pengguna dapat menyimpan artikel, referensi, atau halaman web apa pun dalam waktu kurang dari 1 detik dengan satu klik (1-click save) tanpa meninggalkan halaman tersebut.
\* \*\*Business goal:\*\* Menghilangkan beban komputasi \*scraping\* dari server (Vercel) dengan mendelegasikan ekstraksi DOM/metadata ke browser klien, menekan biaya infrastruktur hingga Rp0.
\* \*\*Non-goal:\*\* Rilis ini tidak mencakup manajemen \*tag/folder\* saat menyimpan, sinkronisasi IndexedDB lokal, atau dasbor manajemen tautan (akan di-\*handle\* terpisah).

## Core Concepts

\* \*\*Client-Side Ingestion:\*\* Proses ekstraksi data (URL, Title, og:image) yang dilakukan sepenuhnya oleh DOM web browser melalui skrip Tampermonkey.
\* \*\*Secret-Key Auth:\*\* Lapisan keamanan sederhana menggunakan token statis yang di-\*hardcode\* pada skrip klien untuk memvalidasi permintaan masuk ke \*Route Handler\* Next.js.
\* \*\*1-Click Save:\*\* Interaksi tanpa hambatan di mana tombol simpan tidak memunculkan modal \*input\*, melainkan langsung memproses dan menampilkan \*toast feedback\*.

## Entry Points

### Tampermonkey Floating Action Button (FAB)

\* \*\*UI element added:\*\* Sebuah \*floating button\* kecil dan tidak mengganggu (misal: ikon \*bookmark\* atau \*save\*) yang disuntikkan secara otomatis di pojok kanan bawah pada setiap halaman web yang dikunjungi.
\* \*\*Trigger condition:\*\* Muncul secara persisten setelah DOM halaman web selesai dimuat (\*DOMContentLoaded\*).

## User Flows

### 1. 1-Click Save Flow (Success)

\*\*Trigger:\*\* Pengguna mengklik \*floating button\* Tampermonkey di halaman web yang sedang dibuka.

\*\*Steps:\*\*

1. Skrip menampilkan \*toast notification\* berstatus "Loading...".
2. Skrip membaca \`window.location.href\`, \`document.title\`, dan tag \`&lt;meta property="og:image"&gt;\`.
3. Skrip mengirim HTTP POST \*request\* (berisi metadata dan \*Secret Key\*) ke \*endpoint\* \`/api/links\` milik aplikasi Next.js.
4. API Next.js memvalidasi kunci, menyimpan payload ke Database (Turso/Supabase), dan mengembalikan respons HTTP 200.

\*\*Outcome:\*\* \*Toast notification\* berubah menjadi "Saved successfully!" dan menghilang setelah 2 detik. Data tersimpan di \*cloud database\*.

### 2. API / Network Error Flow

\*\*Trigger:\*\* Pengguna mengklik tombol, tetapi jaringan terputus atau API Next.js mengembalikan \*error\*.

\*\*Steps:\*\*

1. Skrip mencoba mengirim data.
2. Permintaan \*time out\* atau menerima respons selain HTTP 20X.

\*\*Outcome:\*\* \*Toast notification\* berubah menjadi "Error: Failed to save link" berwarna merah dan menghilang setelah 3 detik.

## UI Specification

### Injected UI (FAB &amp; Toast)

\*\*Layout:\*\*

\* \*\*FAB:\*\* Posisi \*fixed\*, \*bottom-right\*, z-index tinggi (agar tidak tertutup elemen web lain).
\* \*\*Toast Notification:\*\* Muncul tepat di atas atau di samping FAB, ukuran ringkas.

\*\*Elements:\*\*

\* \*\*Save Button:\*\* Menginisiasi proses ekstraksi dan HTTP POST.

\*\*States:\*\*

\* \*\*Default:\*\* Tombol statis/ikon \*bookmark\*.
\* \*\*Loading:\*\* Tombol berubah menjadi ikon \*spinner\*, \*toast\* menampilkan "Saving...".
\* \*\*Error:\*\* \*Toast\* menampilkan pesan \*error\* dengan latar belakang/teks merah.
\* \*\*Success:\*\* \*Toast\* menampilkan pesan sukses (warna hijau).

## Permissions

Sistem ini bersifat \*single-user\* dan berbasis token.

| Capability | Admin (Pemilik Secret Key) | Pengunjung Anonim |
| --- | --- | --- |
| Inject Script &amp; Extract | Yes (via Tampermonkey) | No |
| POST to /api/links | Yes (Header auth valid) | No (HTTP 401) |

## Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| Web target tidak memiliki \`og:image\` | Skrip mengirimkan \*string\* kosong atau \*null\* untuk field \*thumbnail\*, API tetap menerima data. |
| Tombol diklik dua kali dengan cepat (Spam) | Skrip menonaktifkan (\*disable\*) tombol selama status masih \*Loading\* untuk mencegah duplikasi pengiriman. |
| Secret Key di-\*revoke\* / diganti di \*server\* | API mengembalikan HTTP 401. \*Toast\* menampilkan "Unauthorized. Please update Secret Key." |

## Analytics Instrumentation

Mengingat proyek ini bersifat personal/\*hobby\*, analitik difokuskan pada pemantauan sisi \*server\* saja untuk melacak keandalan \*endpoint\*.

| Event name | Trigger | Key properties |
| --- | --- | --- |
| \`api\_link\_saved\` | Saat Next.js API berhasil \*insert\* ke DB | \`url\_domain\`, \`latency\_ms\` |
| \`api\_auth\_failed\` | Saat \*request\* ditolak karena token salah | \`ip\_address\` |

## Acceptance Criteria

### Tampermonkey Script

\* \[ \] Tombol \*floating\* muncul secara otomatis di semua halaman web (dengan pengecualian \*blacklist\* URL jika diperlukan).
\* \[ \] Mengekstrak URL dan Judul dengan akurat 100% dari waktu pengujian.
\* \[ \] Mampu mendeteksi \`og:image\` jika ada, dan mengirim nilai \*null/fallback\* jika tidak ada.
\* \[ \] Menampilkan \*feedback\* visual (Loading, Success, Error) menggunakan \*toast\* yang tertutup otomatis.

### Next.js API (/api/links)

\* \[ \] Menolak \*request\* tanpa \*Secret Key\* yang valid (HTTP 401).
\* \[ \] Menerima JSON \*payload\* dan memasukkannya ke Turso/Supabase dalam waktu kurang dari 100ms.
\* \[ \] Hanya menggunakan \*Edge Runtime\* atau \*Serverless function\* tanpa proses \*puppeteer/scraping\* apa pun.

## Success Metrics

| Metric | Target | Timeframe |
| --- | --- | --- |
| API Latency per request | &lt;= 50ms | 30 days post-launch |
| Server-side scraping cost | Rp0 / 0 Execution Time | Selamanya |
| Script crash/injection error | &lt; 1% dari total kunjungan web | 14 days post-launch |

## Future Enhancements (Out of Scope)

\* Penambahan \*pop-up\* kecil untuk menginput \*Tag\* atau Catatan singkat sebelum disimpan.
\* Integrasi sinkronisasi ke IndexedDB lokal jika diperlukan untuk pembacaan \*offline\* di masa mendatang (saat ini ditiadakan karena data langsung ditulis ke \*database\*).

## Open Questions

| Question | Owner | Due (YYYY-MM-DD) | Status |
| --- | --- | --- | --- |
| Apakah ada web tertentu yang harus di-\*blacklist\* dari injeksi skrip ini (misal: localhost, perbankan)? | Jeremia | TBD | Open |