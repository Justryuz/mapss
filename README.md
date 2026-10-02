# NADMA Disaster API

REST API yang mengumpul data bencana Malaysia secara **live** dari sumber rasmi, kemudian serve balik sebagai JSON API yang kemas dengan caching + auto-refresh.

Sumber data terbuka yang digunakan:
- **JKM InfoBencana** — bencana aktif & pusat pemindahan (PPS)
- **MetMalaysia** — amaran cuaca
- **Portal Bencana NADMA** — pengumuman & siaran media
- **Zoom Earth** — ribut tropika, kebakaran, tile satelit (Himawari)

> Nota: API dalaman `mydims.nadma.gov.my` (`/api/disasters`, `/api/profile`, `/api/warning-portal`) memerlukan role/permission dari admin NADMA, jadi API ini guna sumber terbuka yang setara.

## Setup

```bash
npm install
npm start          # start API server di port 3000
```

Buka demo map: **http://localhost:3000/map.html**

## Endpoints

| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| GET | `/` | Info API |
| GET | `/api/disasters` | Bencana aktif JKM. Filter: `?negeri=Sabah`, `?jenis=Banjir` |
| GET | `/api/warnings` | Amaran cuaca MetMalaysia |
| GET | `/api/announcements` | Pengumuman & siaran media NADMA |
| GET | `/api/storms` | Ribut tropika aktif (track, angin, tekanan) |
| GET | `/api/storms/:id` | Track penuh satu ribut, cth `/api/storms/choi-wan-2026` |
| GET | `/api/fires` | Kebakaran di Malaysia (NASA FIRMS via Zoom Earth) |
| GET | `/api/satellite` | Template tile satelit untuk map (Himawari geocolor) |
| GET | `/api/satellite/times/:layer` | Timestamp frame: `geocolor`\|`radar`\|`gibs`\|`gfs`\|`icon` |
| GET | `/api/all` | Semua data sekaligus |
| GET | `/api/status` | Status cache & kesihatan |
| POST | `/api/refresh` | Force refresh semua data |
| GET | `/tiles/:layer/:src/:date/:time/:z/:y/:x` | **Proxy tile satelit** (fix CORS blocking) |
| GET | `/api/history/:source` | Sejarah snapshot sesuatu sumber |
| GET | `/api/snapshot/:source/:id` | Ambil snapshot lampau penuh |
| GET | `/api/trend` | Trend bencana (mangsa/PPS dari masa ke masa) |
| GET | `/api/storage/stats` | Statistik data tersimpan |

## Storage (Sejarah Data)

Setiap kali data di-refresh, snapshot disimpan ke `data/` (fail JSON, tiada database server diperlukan):

```
data/
├── snapshots/<source>/<timestamp>.json   # setiap snapshot
├── latest/<source>.json                  # terkini
└── index.json                            # metadata
```

Guna `/api/trend` untuk lihat perubahan bilangan mangsa/PPS, atau `/api/history/disasters` untuk senarai snapshot.

## Fix: Tile Satelit Blocked (ERR_BLOCKED_BY_RESPONSE)

Zoom Earth block hotlinking tile dari domain lain. Server ini proxy tile melalui `/tiles/...` dengan header `Referer` betul, jadi map boleh paparkan satelit tanpa error. Guna `tile_proxy` dari `/api/satellite`, bukan `tile_template`.

## Contoh Response

`GET /api/disasters`
```json
{
  "success": true,
  "source": "JKM InfoBencana",
  "ringkasan": { "pps": 9, "keluarga": 140, "mangsa": 398 },
  "total": 7,
  "bencana": [
    { "jenis_bencana": "Banjir", "negeri": "Perak", "daerah": "Hilir Perak",
      "bilangan_pps": 1, "bilangan_keluarga": 2, "bilangan_mangsa": 3, "kapasiti": "15%" }
  ]
}
```

`GET /api/satellite`
```json
{
  "satelit": "himawari",
  "layer": "geocolor",
  "timestamp": "2026-10-02T11:50:00.000Z",
  "tile_template": "https://tiles.zoom.earth/geocolor/himawari/2026-10-02/1150/{z}/{y}/{x}.jpg"
}
```

Guna `tile_template` terus dalam Leaflet/MapLibre sebagai raster source.

## Konfigurasi

Environment variables:
- `PORT` — port server (default `3000`)
- `REFRESH_MS` — interval auto-refresh dalam ms (default `300000` = 5 min)

## Struktur

```
nadma-api/
├── server.js              # Express API server
├── src/
│   ├── fetchers.js        # Scrape & normalize JKM, MetMalaysia, NADMA
│   ├── zoomearth.js       # Client Zoom Earth (storms, fires, satellite)
│   ├── cache.js           # In-memory cache + auto-refresh
│   ├── zoomearth-sniff.js # Tool: sniff endpoint zoom.earth (Playwright)
│   ├── playwright-intercept.js  # Tool: intercept MyDIMS (perlu login)
│   ├── public-api.js      # Tool: test pelbagai API awam
│   └── scraper.js         # Tool: scraper standalone
└── public/map.html        # Demo map (Leaflet + satelit live)
```

## Tools Tambahan

```bash
npm run playwright     # intercept MyDIMS API (perlu akaun berrole)
node src/zoomearth-sniff.js   # cari endpoint zoom.earth baharu
```
