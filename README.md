# LiaGold Suite

Userscript Tampermonkey untuk [liagold.cuan.co](https://liagold.cuan.co):

- **Module 1** — Payment Method Detail (metode bayar + total bayar di tabel purchasing)
- **Module 2** — Footer total kolom di halaman ERP lain
- **Module 2b** — Total per metode bayar di halaman Penjualan (`/sales`), net batal jual
- **Module 3** — Totalizer (klik-jumlahkan angka) + Scanner stock opname (solo/multiplayer)

File utama: [`liagold-suite.user.js`](./liagold-suite.user.js).

## Install

1. Pasang [Tampermonkey](https://www.tampermonkey.net/).
2. Buka file `liagold-suite.user.js` (raw dari repo ini, atau salin lokal).
3. Tampermonkey akan menawarkan install.

Repo ini **private**. Update manual dari repo, bukan lewat `@updateURL` publik.

## Phone scanner

Static site in `mobile/`. Join the same multiplayer session code from the userscript. Laptop must stay open (catalog heartbeat). Camera needs HTTPS.

Deploy: copy lib with `node scripts/sync-mobile-lib.mjs`, then Firebase Hosting (`public: mobile`). Put the live URL here after first deploy.

## Maintenance

- Bug tracker: [Issues](https://github.com/wildnfth/liagold-suite/issues)
- Label severity: `severity:critical` · `severity:important` · `severity:medium` · `severity:minor`
- Label area: `area:payment` · `area:footer` · `area:totalizer` · `area:scanner` · `area:cache` · `area:firebase`

Jangan merge fix tanpa issue yang merujuk root cause. Beberapa bug cache saling terkait — baca issue terkait sebelum mengubah `localStorage` / `memCache` / Firebase history key.

## Keamanan

Script ini berisi URL Firebase RTDB dan domain ERP internal. Jangan jadikan repo public tanpa meninjau ulang rules Firebase dan data yang tersimpan di client.

Rules yang disarankan: [`docs/firebase-rules.md`](./docs/firebase-rules.md).
