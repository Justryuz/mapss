/**
 * Zoom Earth Data Client
 * Akses data cuaca/satelit live dari zoom.earth (reverse-engineered endpoints)
 *
 * Endpoint ditemui via network sniffing:
 *   - https://zoom.earth/data/storms/?date=<ISO>&to=<hours>  → ribut tropika
 *   - https://zoom.earth/data/fires/latest.json              → kebakaran global
 *   - https://zoom.earth/data/notices/                       → notis
 *   - https://tiles.zoom.earth/times/<layer>.json            → timestamp frame satelit
 *   - https://tiles.zoom.earth/<layer>/<src>/<date>/<HHMM>/{z}/{y}/{x}.jpg → tiles
 */

import axios from 'axios';

const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://zoom.earth/',
  },
});

// Format tarikh ISO ringkas: 2026-10-02T00:00Z
function isoHour(date = new Date()) {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z').replace(/:00Z$/, ':00Z');
}

// ── 1. Ribut tropika aktif ──────────────────────────────────────────────
export async function fetchStorms(hours = 12) {
  const date = isoHour();
  const url = `https://zoom.earth/data/storms/?date=${encodeURIComponent(date)}&to=${hours}`;
  const { data } = await http.get(url);

  // Response: { storms: [id,...], disturbances: [id,...] }
  const stormIds = Array.isArray(data?.storms) ? data.storms : [];
  const disturbanceIds = Array.isArray(data?.disturbances) ? data.disturbances : [];

  // Ambil butiran penuh setiap storm (track, kategori, angin)
  const details = await Promise.all(
    [...stormIds, ...disturbanceIds].map(async (id) => {
      try {
        const { data: d } = await http.get(`https://zoom.earth/data/storms/?id=${encodeURIComponent(id)}`);
        const info = d?.[id] || d || {};
        // Ambil posisi terkini dari track jika ada
        const track = info.track || info.coordinates || [];
        const latest = Array.isArray(track) && track.length ? track[track.length - 1] : null;
        return {
          id,
          nama: info.name || info.title || id,
          kategori: info.category || info.class || null,
          jenis: stormIds.includes(id) ? 'storm' : 'disturbance',
          kedudukan_terkini: latest,
          butiran: info,
        };
      } catch (_) {
        return { id, jenis: stormIds.includes(id) ? 'storm' : 'disturbance', butiran: null };
      }
    })
  );

  return {
    source: 'Zoom Earth',
    source_url: 'https://zoom.earth',
    fetched_at: new Date().toISOString(),
    query_date: date,
    total: details.length,
    ribut: details,
  };
}

// ── 2. Butiran satu ribut (track penuh) ──────────────────────────────────
export async function fetchStormById(id) {
  const url = `https://zoom.earth/data/storms/?id=${encodeURIComponent(id)}`;
  const { data } = await http.get(url);
  return { source: 'Zoom Earth', fetched_at: new Date().toISOString(), id, data };
}

// ── 3. Kebakaran (wildfire) global ────────────────────────────────────────
export async function fetchFires(bbox = null) {
  const { data } = await http.get('https://zoom.earth/data/fires/latest.json');

  let fires = [];
  if (Array.isArray(data)) fires = data;
  else if (Array.isArray(data?.fires)) fires = data.fires;
  else if (Array.isArray(data?.features)) fires = data.features;
  else if (data && typeof data === 'object') {
    // Object keyed by id → tukar jadi array
    fires = Object.entries(data).map(([id, v]) => ({ id, ...(typeof v === 'object' ? v : { value: v }) }));
  }

  // Tapis ikut bounding box Malaysia jika diminta
  // Malaysia approx: lat 0.8–7.5, lon 99.5–119.5
  if (bbox === 'malaysia' && Array.isArray(fires)) {
    fires = fires.filter(f => {
      const lat = f.lat ?? f.latitude ?? f.geometry?.coordinates?.[1];
      const lon = f.lon ?? f.lng ?? f.longitude ?? f.geometry?.coordinates?.[0];
      return lat >= 0.5 && lat <= 7.6 && lon >= 99 && lon <= 120;
    });
  }

  return {
    source: 'Zoom Earth / NASA FIRMS',
    source_url: 'https://zoom.earth/data/fires/latest.json',
    fetched_at: new Date().toISOString(),
    region: bbox || 'global',
    total: Array.isArray(fires) ? fires.length : 0,
    kebakaran: fires,
  };
}

// ── 4. Senarai timestamp frame satelit (untuk animasi/tile terkini) ───────
export async function fetchSatelliteTimes(layer = 'geocolor') {
  // layer: geocolor | radar | gibs | gfs | icon
  const url = `https://tiles.zoom.earth/times/${layer}.json`;
  const { data } = await http.get(url);

  // Ambil timestamp terkini bagi setiap satelit
  const latest = {};
  if (data && typeof data === 'object') {
    for (const [sat, times] of Object.entries(data)) {
      if (Array.isArray(times) && times.length) {
        const last = times[times.length - 1];
        latest[sat] = {
          unix: last,
          iso: new Date(last * 1000).toISOString(),
          frames: times.length,
        };
      }
    }
  }

  return {
    source: 'Zoom Earth Tiles',
    layer,
    fetched_at: new Date().toISOString(),
    satelit: latest,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// LAYER OVERLAY (model ICON): hujan, angin, suhu, kelembapan, tekanan
// Format: /icon/v1/<layer>/webp/<level>/<date>/<run>/f<hour>/{z}/{y}/{x}.webp
// ══════════════════════════════════════════════════════════════════════════
const OVERLAY_LAYERS = {
  precipitation: { level: 'surface', label: 'Hujan' },
  'wind-speed':  { level: '10m',     label: 'Angin' },
  temperature:   { level: '2m',      label: 'Suhu' },
  humidity:      { level: '2m',      label: 'Kelembapan' },
  pressure:      { level: 'msl',     label: 'Tekanan' },
};

/**
 * Dapatkan template tile untuk satu overlay cuaca (model ICON).
 * Kira run terkini + forecast hour yang padan dengan masa sekarang.
 */
export async function getOverlay(layer = 'precipitation') {
  const cfg = OVERLAY_LAYERS[layer];
  if (!cfg) throw new Error(`Layer tidak disokong: ${layer}`);

  const { data } = await http.get('https://tiles.zoom.earth/times/icon.json');

  // Struktur: { <layer>: { <level>: { <runUnix>: [forecastHours...] } } }
  const levelData = data?.[layer]?.[cfg.level];
  if (!levelData) throw new Error(`Tiada data untuk ${layer}/${cfg.level}`);

  // Ambil run terkini
  const runs = Object.keys(levelData).map(Number).sort((a, b) => a - b);
  const runUnix = runs[runs.length - 1];
  const hours = levelData[runUnix]; // array of forecast hours tersedia

  // Pilih forecast hour yang paling hampir dengan masa sekarang
  const nowUnix = Math.floor(Date.now() / 1000);
  const hoursSinceRun = (nowUnix - runUnix) / 3600;
  let fh = hours.reduce((best, h) =>
    Math.abs(h - hoursSinceRun) < Math.abs(best - hoursSinceRun) ? h : best, hours[0]);

  const d = new Date(runUnix * 1000);
  const dateStr = d.toISOString().slice(0, 10);
  const runStr = d.toISOString().slice(11, 13) + d.toISOString().slice(14, 16);
  const fhStr = String(fh).padStart(3, '0');

  const path = `/icon/v1/${layer}/webp/${cfg.level}/${dateStr}/${runStr}/f${fhStr}/{z}/{y}/{x}.webp`;

  return {
    source: 'Zoom Earth / ICON model',
    layer, label: cfg.label, level: cfg.level,
    run: d.toISOString(),
    forecast_hour: fh,
    valid_time: new Date((runUnix + fh * 3600) * 1000).toISOString(),
    tile_proxy: `/overlay${path}`,   // melalui proxy server
    fetched_at: new Date().toISOString(),
  };
}

/** Dapatkan semua overlay sekaligus */
export async function getAllOverlays() {
  const out = {};
  for (const layer of Object.keys(OVERLAY_LAYERS)) {
    try { out[layer] = await getOverlay(layer); }
    catch (e) { out[layer] = { layer, error: e.message }; }
  }
  return { source: 'Zoom Earth / ICON', fetched_at: new Date().toISOString(), overlays: out };
}

/**
 * Bina senarai FRAME untuk animasi awan (pergerakan live).
 * Pulangkan N frame terkini supaya boleh di-loop di client.
 * @param {number} count - bilangan frame (default 12 = ~2 jam)
 * @param {string} sat   - satelit (himawari liputi Malaysia)
 */
export async function getSatelliteFrames(count = 12, sat = 'himawari') {
  const url = `https://tiles.zoom.earth/times/geocolor.json`;
  const { data } = await http.get(url);

  const times = Array.isArray(data?.[sat]) ? data[sat] : [];
  if (!times.length) return { source: 'Zoom Earth', satelit: sat, frames: [] };

  // Ambil N frame terkini
  const recent = times.slice(-count);

  const frames = recent.map((unix) => {
    const d = new Date(unix * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const hhmm = d.toISOString().slice(11, 16).replace(':', '');
    return {
      unix,
      iso: d.toISOString(),
      // URL proxy (elak CORS blocking)
      tile_proxy: `/tiles/geocolor/${sat}/${dateStr}/${hhmm}/{z}/{y}/{x}`,
    };
  });

  return {
    source: 'Zoom Earth',
    source_url: 'https://zoom.earth',
    fetched_at: new Date().toISOString(),
    satelit: sat,
    layer: 'geocolor',
    interval_minit: 10,
    total: frames.length,
    frames,
  };
}

/**
 * Bina URL template tile satelit untuk Malaysia.
 * Guna timestamp terkini dari Himawari (satelit meliputi Asia/Malaysia).
 */
export async function getSatelliteTileTemplate() {
  const times = await fetchSatelliteTimes('geocolor');
  // Himawari liputi Malaysia
  const himawari = times.satelit['himawari'] || Object.values(times.satelit)[0];
  if (!himawari) return null;

  const d = new Date(himawari.unix * 1000);
  const dateStr = d.toISOString().slice(0, 10);                 // 2026-10-02
  const hhmm = d.toISOString().slice(11, 16).replace(':', '');  // 1140

  return {
    satelit: 'himawari',
    layer: 'geocolor',
    timestamp: himawari.iso,
    date: dateStr,
    time: hhmm,
    // URL asal (akan di-block jika hotlink dari domain lain)
    tile_template: `https://tiles.zoom.earth/geocolor/himawari/${dateStr}/${hhmm}/{z}/{y}/{x}.jpg`,
    // URL proxy melalui server kita (elak CORS/same-site blocking)
    tile_proxy: `/tiles/geocolor/himawari/${dateStr}/${hhmm}/{z}/{y}/{x}`,
    nota: 'Guna tile_proxy dalam Leaflet untuk elak blocking. {z}=zoom, {x}=col, {y}=row.',
  };
}
