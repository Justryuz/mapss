/**
 * NADMA Disaster API Server
 * Scrape data bencana live dari sumber rasmi, serve sebagai REST API JSON
 *
 * Endpoints:
 *   GET  /                       → info API
 *   GET  /api/disasters          → senarai bencana aktif (JKM)
 *   GET  /api/disasters?negeri=  → filter ikut negeri
 *   GET  /api/warnings           → amaran cuaca (MetMalaysia)
 *   GET  /api/announcements      → pengumuman & siaran media (NADMA)
 *   GET  /api/all                → semua data sekali
 *   GET  /api/status             → status cache & kesihatan
 *   POST /api/refresh            → force refresh semua data
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { DataCache } from './src/cache.js';
import { Storage } from './src/storage.js';
import { fetchDisasters, fetchWarnings, fetchAnnouncements } from './src/fetchers.js';
import {
  fetchStorms, fetchStormById, fetchFires,
  fetchSatelliteTimes, getSatelliteTileTemplate, getSatelliteFrames,
  getOverlay, getAllOverlays,
} from './src/zoomearth.js';

const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL = Number(process.env.REFRESH_MS) || 5 * 60 * 1000; // default 5 min

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve public/map.html

// ── Setup storage (SQLite) + cache dengan auto-refresh ─────────────────────
const storage = new Storage();
const cache = new DataCache();
const persist = (key, data) => storage.saveSnapshot(key, data);
const FETCHERS = {
  disasters: fetchDisasters,
  warnings: fetchWarnings,
  announcements: fetchAnnouncements,
  storms: () => fetchStorms(12),
  fires: () => fetchFires('malaysia'),
  satellite: getSatelliteTileTemplate,
  satellite_frames: () => getSatelliteFrames(12),
  overlays: getAllOverlays,
};

console.log('🚀 Starting NADMA Disaster API...');
console.log(`   Refresh interval: ${REFRESH_INTERVAL / 1000}s\n`);

for (const [key, fetcher] of Object.entries(FETCHERS)) {
  cache.register(key, fetcher, REFRESH_INTERVAL, persist);
}

// ── Helper: response wrapper ────────────────────────────────────────────────
function sendCache(res, key, transform) {
  const entry = cache.get(key);
  if (!entry.data) {
    return res.status(503).json({
      success: false,
      message: `Data "${key}" belum tersedia atau gagal dimuatkan`,
      error: entry.error,
    });
  }
  const data = transform ? transform(entry.data) : entry.data;
  res.json({ success: true, cached_at: entry.fetchedAt, ...data });
}

// ══════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════

// Info API
app.get('/', (req, res) => {
  res.json({
    name: 'NADMA Disaster API',
    version: '1.0.0',
    description: 'API data bencana Malaysia (JKM, MetMalaysia, Portal Bencana NADMA)',
    endpoints: {
      'GET /api/disasters': 'Senarai bencana aktif JKM. Query: ?negeri=, ?jenis=',
      'GET /api/warnings': 'Amaran cuaca MetMalaysia',
      'GET /api/announcements': 'Pengumuman & siaran media NADMA',
      'GET /api/storms': 'Ribut tropika aktif (Zoom Earth)',
      'GET /api/storms/:id': 'Track penuh satu ribut, cth: /api/storms/choi-wan-2026',
      'GET /api/fires': 'Kebakaran di Malaysia (Zoom Earth / NASA FIRMS)',
      'GET /api/satellite': 'Template tile satelit untuk map (Himawari geocolor)',
      'GET /api/satellite/times/:layer': 'Timestamp frame: geocolor|radar|gibs|gfs|icon',
      'GET /api/all': 'Semua data sekaligus',
      'GET /api/status': 'Status cache',
      'POST /api/refresh': 'Force refresh data',
    },
    note: 'Data di-cache dan auto-refresh setiap 5 minit.',
  });
});

// Disasters - dengan filter negeri & jenis
app.get('/api/disasters', (req, res) => {
  sendCache(res, 'disasters', (data) => {
    let bencana = data.bencana;
    const { negeri, jenis } = req.query;

    if (negeri) {
      bencana = bencana.filter(b => b.negeri?.toLowerCase().includes(negeri.toLowerCase()));
    }
    if (jenis) {
      bencana = bencana.filter(b => b.jenis_bencana?.toLowerCase().includes(jenis.toLowerCase()));
    }

    return {
      source: data.source,
      source_url: data.source_url,
      fetched_at: data.fetched_at,
      ringkasan: data.ringkasan,
      total: bencana.length,
      bencana,
    };
  });
});

// Warnings
app.get('/api/warnings', (req, res) => {
  sendCache(res, 'warnings');
});

// Announcements
app.get('/api/announcements', (req, res) => {
  sendCache(res, 'announcements');
});

// ── Tile Proxy: fix CORS blocking satelit (ERR_BLOCKED_BY_RESPONSE) ──────────
// Zoom Earth block hotlinking; proxy melalui server kita dengan Referer betul.
app.get('/tiles/:layer/:src/:date/:time/:z/:y/:x', async (req, res) => {
  const { layer, src, date, time, z, y, x } = req.params;
  // Tambah .jpg jika x tiada extension
  const xFile = /\.\w+$/.test(x) ? x : `${x}.jpg`;
  const upstream = `https://tiles.zoom.earth/${layer}/${src}/${date}/${time}/${z}/${y}/${xFile}`;
  try {
    const resp = await axios.get(upstream, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://zoom.earth/',
        'Origin': 'https://zoom.earth',
      },
    });
    res.set('Content-Type', resp.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=600');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(resp.data));
  } catch (err) {
    console.error(`🗺️  [tile proxy] ${upstream} → ${err.response?.status || err.message}`);
    res.status(502).send('tile proxy error');
  }
});

// ── Overlay Proxy: hujan/angin/suhu/dll (.webp dari model ICON) ──────────────
app.get('/overlay/*splat', async (req, res) => {
  const subpath = req.params.splat ? (Array.isArray(req.params.splat) ? req.params.splat.join('/') : req.params.splat) : req.path.replace('/overlay/', '');
  const upstream = `https://tiles.zoom.earth/${subpath}`;
  try {
    const resp = await axios.get(upstream, {
      responseType: 'arraybuffer', timeout: 15000, maxRedirects: 0,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://zoom.earth/', 'Origin': 'https://zoom.earth' },
      validateStatus: (s) => s < 400,  // 200 ok; biar 302 throw supaya kita tahu tiada data
    });
    res.set('Content-Type', resp.headers['content-type'] || 'image/webp');
    res.set('Cache-Control', 'public, max-age=600');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(resp.data));
  } catch (err) {
    // 302 = tiada data (blank) untuk kawasan/masa ini → hantar 1x1 telus
    res.status(204).end();
  }
});

// ── Overlay API: template tile untuk setiap layer cuaca ──────────────────────
app.get('/api/overlays', (req, res) => sendCache(res, 'overlays'));
app.get('/api/overlay/:layer', async (req, res) => {
  try {
    const data = await getOverlay(req.params.layer);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Storage: sejarah & trend ────────────────────────────────────────────────
app.get('/api/history/:source', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ success: true, source: req.params.source, history: storage.history(req.params.source, limit) });
});

app.get('/api/snapshot/:source/:id', (req, res) => {
  const snap = storage.getSnapshot(req.params.source, Number(req.params.id));
  if (!snap) return res.status(404).json({ success: false, message: 'Snapshot tidak dijumpai' });
  res.json({ success: true, ...snap });
});

app.get('/api/trend', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  res.json({ success: true, trend: storage.disasterTrend(limit) });
});

app.get('/api/storage/stats', (req, res) => {
  res.json({ success: true, ...storage.stats() });
});

// ── Zoom Earth: Ribut tropika ──────────────────────────────────────────────
app.get('/api/storms', (req, res) => {
  sendCache(res, 'storms');
});

// Butiran satu ribut (track penuh) - live, tak cache
app.get('/api/storms/:id', async (req, res) => {
  try {
    const data = await fetchStormById(req.params.id);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(502).json({ success: false, message: 'Gagal ambil data ribut', error: err.message });
  }
});

// ── Zoom Earth: Kebakaran (Malaysia) ─────────────────────────────────────────
app.get('/api/fires', (req, res) => {
  sendCache(res, 'fires');
});

// ── Zoom Earth: Satelit tile template (untuk map) ────────────────────────────
app.get('/api/satellite', (req, res) => {
  sendCache(res, 'satellite');
});

// Frame animasi awan (multi-frame untuk pergerakan live)
app.get('/api/satellite/frames', (req, res) => {
  sendCache(res, 'satellite_frames');
});

// Satelit frame times (semua layer)
app.get('/api/satellite/times/:layer', async (req, res) => {
  try {
    const data = await fetchSatelliteTimes(req.params.layer);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// All data combined
app.get('/api/all', (req, res) => {
  res.json({
    success: true,
    generated_at: new Date().toISOString(),
    disasters: cache.get('disasters').data,
    warnings: cache.get('warnings').data,
    announcements: cache.get('announcements').data,
    storms: cache.get('storms').data,
    fires: cache.get('fires').data,
    satellite: cache.get('satellite').data,
  });
});

// Cache status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    uptime_seconds: Math.floor(process.uptime()),
    refresh_interval_ms: REFRESH_INTERVAL,
    cache: cache.status(),
  });
});

// Force refresh
app.post('/api/refresh', async (req, res) => {
  const results = {};
  for (const [key, fetcher] of Object.entries(FETCHERS)) {
    const entry = await cache.forceRefresh(key, fetcher);
    results[key] = { refreshed: !entry.error, error: entry.error, fetched_at: entry.fetchedAt };
  }
  res.json({ success: true, message: 'Refresh selesai', results });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak dijumpai', path: req.path });
});

// ── Start server ────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n✅ API server running: http://localhost:${PORT}`);
  console.log(`   Try: http://localhost:${PORT}/api/disasters\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  cache.stopAll();
  server.close(() => process.exit(0));
});
