/**
 * NADMA Data - Public API Client
 * Guna data sumber alternatif yang public:
 * - JPS (Jabatan Pengairan & Saliran) - Banjir
 * - MetMalaysia - Cuaca & Amaran
 * - data.gov.my - Dataset NADMA
 * - APIMS DOE - Kualiti Udara
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './output';

// ── HTTP client dengan timeout ─────────────────────────────────────────────
const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  },
});

// ── Helper: save JSON ──────────────────────────────────────────────────────
function save(filename, data) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`   💾 Saved: ${filepath}`);
  return filepath;
}

// ── Helper: fetch dengan error handling ───────────────────────────────────
async function fetchData(label, url, options = {}) {
  try {
    const res = await http.get(url, options);
    console.log(`   ✅ ${label}: ${res.status} (${JSON.stringify(res.data).length} chars)`);
    return res.data;
  } catch (err) {
    const status = err.response?.status || 'ERR';
    console.log(`   ❌ ${label}: ${status} - ${err.message.split('\n')[0]}`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. JPS - Info Banjir (publicinfobanjir.water.gov.my)
// ══════════════════════════════════════════════════════════════════════════
async function fetchJPS() {
  console.log('\n📡 JPS - Sistem Maklumat Banjir');
  console.log('─────────────────────────────────');

  const results = {};

  // Station list
  const stations = await fetchData(
    'Stesen JPS',
    'https://publicinfobanjir.water.gov.my/station/getStationList?district=&state=&lang=ms'
  );
  if (stations) results.stations = stations;

  // Flood warning levels
  const warnings = await fetchData(
    'Warning Banjir',
    'https://publicinfobanjir.water.gov.my/flood/getActiveFloodList?lang=ms'
  );
  if (warnings) results.warnings = warnings;

  // Active flood events
  const active = await fetchData(
    'Kejadian Banjir Aktif',
    'https://publicinfobanjir.water.gov.my/flood/getFloodEventList?lang=ms'
  );
  if (active) results.active = active;

  // Water level readings
  const waterLevel = await fetchData(
    'Paras Air Terkini',
    'https://publicinfobanjir.water.gov.my/waterlevel/getWaterLevelList?lang=ms'
  );
  if (waterLevel) results.waterLevel = waterLevel;

  if (Object.keys(results).length > 0) {
    save('jps_flood_data.json', results);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 2. MetMalaysia - API Cuaca & Amaran
// ══════════════════════════════════════════════════════════════════════════
async function fetchMetMalaysia() {
  console.log('\n📡 MetMalaysia - Cuaca & Amaran');
  console.log('─────────────────────────────────');

  const results = {};

  // Weather warning
  const warning = await fetchData(
    'Amaran Cuaca',
    'https://api.met.gov.my/v2.1/data?datasetid=WARNING_ADVISORY&start_date=2026-10-01&end_date=2026-10-02',
    { headers: { 'Authorization': 'METToken' } } // public endpoint, no token needed
  );
  if (warning) results.warning = warning;

  // Forecast
  const forecast = await fetchData(
    'Ramalan Cuaca 7 Hari',
    'https://api.met.gov.my/v2.1/data?datasetid=FORECAST&locationid=Wlgt_50480&start_date=2026-10-01&end_date=2026-10-07'
  );
  if (forecast) results.forecast = forecast;

  // Current observations - Isohyet data
  const rainfall = await fetchData(
    'Taburan Hujan',
    'https://www.met.gov.my/data/IWR31004.html'
  );
  if (rainfall) results.rainfallPage = typeof rainfall === 'string' ? 'HTML content' : rainfall;

  // Heavy rain warning image (public)
  const rainfallWarning = await fetchData(
    'Amaran Hujan Lebat',
    'https://api.met.gov.my/v2.1/data?datasetid=ADVISORY_WARNING&start_date=2026-10-01&end_date=2026-10-02'
  );
  if (rainfallWarning) results.rainfallWarning = rainfallWarning;

  if (Object.keys(results).length > 0) {
    save('metmalaysia_data.json', results);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. data.gov.my - Dataset Rasmi NADMA
// ══════════════════════════════════════════════════════════════════════════
async function fetchDataGovMy() {
  console.log('\n📡 data.gov.my - Dataset NADMA');
  console.log('─────────────────────────────────');

  const results = {};

  // NADMA datasets
  const datasets = await fetchData(
    'NADMA Datasets',
    'https://api.data.gov.my/data-catalogue?source=NADMA'
  );
  if (datasets) results.datasets = datasets;

  // Bencana dataset
  const bencana = await fetchData(
    'Data Bencana',
    'https://api.data.gov.my/data-catalogue?id=bencana'
  );
  if (bencana) results.bencana = bencana;

  // Pusat pemindahan (evacuation centres)
  const evacuation = await fetchData(
    'Pusat Pemindahan',
    'https://api.data.gov.my/data-catalogue?id=pusat_pemindahan'
  );
  if (evacuation) results.evacuation = evacuation;

  // Flood events historical
  const floodEvents = await fetchData(
    'Sejarah Banjir',
    'https://api.data.gov.my/data-catalogue?id=flood_events&limit=20'
  );
  if (floodEvents) results.floodEvents = floodEvents;

  // Try CKAN API
  const ckan = await fetchData(
    'CKAN NADMA packages',
    'https://data.gov.my/api/3/action/package_search?q=nadma&rows=20'
  );
  if (ckan) results.ckan = ckan;

  if (Object.keys(results).length > 0) {
    save('datagovmy_nadma.json', results);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 4. APIMS DOE - Indeks Pencemaran Udara
// ══════════════════════════════════════════════════════════════════════════
async function fetchAPIMSDOE() {
  console.log('\n📡 APIMS DOE - Kualiti Udara');
  console.log('─────────────────────────────────');

  const results = {};

  const ipu = await fetchData(
    'Indeks Pencemaran Udara',
    'https://apims.doe.gov.my/public_v2/API/MonitoringStation/getHourlyApiData?state=ALL'
  );
  if (ipu) results.ipu = ipu;

  const stations = await fetchData(
    'Stesen APIMS',
    'https://apims.doe.gov.my/public_v2/API/MonitoringStation/getMonitoringStationList'
  );
  if (stations) results.stations = stations;

  if (Object.keys(results).length > 0) {
    save('apims_air_quality.json', results);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 5. JKM - Info Bencana & Pusat Pemindahan
// ══════════════════════════════════════════════════════════════════════════
async function fetchJKM() {
  console.log('\n📡 JKM - Info Bencana & Pusat Pemindahan');
  console.log('─────────────────────────────────');

  const results = {};

  const jkm = await fetchData(
    'Info Bencana JKM',
    'https://infobencanajkmv2.jkm.gov.my/api/disaster-api.php?a=0&b=0&c=0&d=0'
  );
  if (jkm) results.disaster = jkm;

  const shelters = await fetchData(
    'Pusat Pemindahan Aktif',
    'https://infobencanajkmv2.jkm.gov.my/api/disaster-api.php?a=1&b=0&c=0&d=0'
  );
  if (shelters) results.shelters = shelters;

  if (Object.keys(results).length > 0) {
    save('jkm_disaster_data.json', results);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function run() {
  console.log('🌐 Public API Client - NADMA Data');
  console.log('====================================\n');

  const allResults = {};

  allResults.jps = await fetchJPS();
  allResults.metmalaysia = await fetchMetMalaysia();
  allResults.datagovmy = await fetchDataGovMy();
  allResults.apims = await fetchAPIMSDOE();
  allResults.jkm = await fetchJKM();

  // Save combined
  save('public_api_combined.json', {
    timestamp: new Date().toISOString(),
    sources: Object.keys(allResults),
    data: allResults,
  });

  // Summary
  console.log('\n====================================');
  console.log('📊 Summary:');
  for (const [src, data] of Object.entries(allResults)) {
    const count = data ? Object.keys(data).length : 0;
    console.log(`   ${count > 0 ? '✅' : '❌'} ${src}: ${count} datasets`);
  }
  console.log('====================================\n');

  return allResults;
}

run().catch(console.error);
