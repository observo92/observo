# Observo — Setup & Deploy Guide

## 1. Kredensial yang sudah lu punya (sudah dipakai selama build)
Isi ini ke `.env.local` (untuk local dev) DAN ke Vercel Environment Variables (untuk production):

```
NEXT_PUBLIC_SUPABASE_URL=https://xlwywelkvqklfimzqzum.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key lu>
SUPABASE_SERVICE_ROLE_KEY=<service role key lu>
GROQ_API_KEY=<groq key lu>
BLOCKSCOUT_BASE_URL=https://robinhoodchain.blockscout.com
BOWFUN_API_URL=https://bow.fun/api/tokens
GECKOTERMINAL_BASE_URL=https://api.geckoterminal.com/api/v2
OBSERVO_SIGNING_PRIVATE_KEY=<sudah digenerate, lihat pesan/file terpisah>
NEXT_PUBLIC_OBSERVO_SIGNING_PUBLIC_KEY=<sudah digenerate, lihat pesan/file terpisah>
CRON_SECRET=<sudah digenerate, lihat pesan/file terpisah>
```

**PENTING**: `.env.local` yang asli (isi lengkap) TIDAK ikut di zip ini (sengaja, biar secrets gak ke-commit ke git). Nilai aslinya sudah ada di device lain — copy manual, atau minta saya kirim ulang isi `.env.local` lewat chat kalau hilang.

## 2. Setup repo lokal
```bash
# extract zip ini ke folder repo github.com/observo92/observo
cd observo
npm install
# buat .env.local, isi seperti di atas
npm run dev
# buka http://localhost:3000 — pastikan heatmap muncul & gak ada error di console
```

## 3. Setup Supabase (kalau belum, tapi harusnya udah karena schema udah dijalankan)
- `supabase/schema.sql` — sudah dijalankan (3 tabel: raw_snapshots, verdicts, sync_state)
- `supabase/rls_policies.sql` — sudah dijalankan (anon read-only untuk raw_snapshots + verdicts)
- Kalau bikin project Supabase baru dari nol, jalankan kedua file itu urut di SQL Editor.

## 4. Deploy ke Vercel
1. Push semua isi zip ini ke repo `github.com/observo92/observo` (replace/merge dengan yang sudah ada).
2. Buka [vercel.com/new](https://vercel.com/new), import repo tersebut.
3. Framework preset: Next.js (otomatis kedeteksi).
4. **Sebelum klik Deploy**, buka "Environment Variables" dan masukin semua variabel di langkah 1 (satu-satu, jangan lupa `NEXT_PUBLIC_` prefix untuk yang dua itu — harus persis).
5. Klik Deploy.

## 5. Cron job — via external trigger (karena plan Vercel Hobby/free, cron native cuma boleh 1x/hari)

Vercel Hobby plan gak izinin cron per-jam, jadi `vercel.json` sengaja DIHAPUS dari project ini —
gantinya kita trigger endpoint `/api/cron/tick` dari luar Vercel, pakai layanan cron gratis.

### Setup cron-job.org (gratis, gak perlu kartu kredit)
1. Daftar/login di [cron-job.org](https://console.cron-job.org).
2. Klik "Create cronjob".
3. **Title**: `observo-hourly-tick` (bebas).
4. **URL**: `https://<domain-vercel-lu>/api/cron/tick`
5. **Schedule**: every hour (`0 * * * *` — cron-job.org izinin ini karena bukan Vercel).
6. Buka bagian **Advanced / Headers** (nama tepatnya tergantung versi UI cron-job.org — cari opsi "Request headers" atau "Custom headers"), tambahkan:
   ```
   Authorization: Bearer <CRON_SECRET>
   ```
   (Ganti `<CRON_SECRET>` dengan nilai asli dari `.env.local`/Vercel env vars.)
7. Method: GET.
8. Save & enable.

Endpoint ini sudah dilindungi secret di kode (`app/api/cron/tick/route.ts`) — request tanpa header
`Authorization` yang benar otomatis ditolak (401), jadi aman dipanggil dari luar Vercel.

### Verifikasi cron jalan
Test manual dulu sebelum mengandalkan scheduler:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/cron/tick
```
Harus balikin JSON `{"dayOfWeek":..,"hourOfDay":..,"results":{"rawData":"ok","volume/trader":"ok",...}}`.

Kalau cron-job.org sudah aktif, cek log run-nya di dashboard cron-job.org — status 200 = berhasil.

## 6. Verifikasi setelah deploy
- Buka `https://<domain>/` — heatmap harus muncul (boleh ada sel kosong/abu-abu kalau verdict-nya belum di-generate untuk slot itu — itu normal, akan terisi sendiri).
- Cek `/api-docs`, `/about`, `/privacy`, `/terms` semua kebuka normal.

## 7. Catatan operasional
- Proses generate verdict grid penuh (672 slot) masih jalan di background di server lama — TIDAK terkait dengan deploy Vercel ini, itu cuma nge-fill tabel `verdicts` di Supabase yang sama. Begitu selesai, otomatis kepakai baik di dev lama maupun deployment Vercel baru (karena sama-sama baca dari Supabase yang sama).
- Data raw (`raw_snapshots`) didesain TIDAK menumpuk lintas minggu — tiap kali `/api/cron/tick` jalan, data minggu lama di slot yang sama dihapus dulu sebelum data baru masuk. Ini supaya angka volume/launch selalu representasi minggu terbaru, bukan akumulasi lama yang bikin AI salah baca "rame".
- `vercel.json` sengaja tidak ada di project ini karena plan Hobby — jangan tambahkan `crons` config lagi kecuali upgrade ke Pro plan, nanti deploy bisa gagal.
