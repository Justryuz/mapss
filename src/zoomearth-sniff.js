/**
 * Zoom Earth Focused Sniffer
 * Buka setiap mod (satellite, radar, + overlay) dan tangkap URL tile sebenar.
 * Guna URL route zoom.earth yang set layer terus (tanpa klik UI).
 */

import { chromium } from 'playwright';
import fs from 'fs';

const MODES = [
  { name: 'satellite',  url: 'https://zoom.earth/maps/satellite/#view=4,109,5z' },
  { name: 'radar',      url: 'https://zoom.earth/maps/precipitation/#view=4,109,5z/model=icon' },
  { name: 'wind',       url: 'https://zoom.earth/maps/wind-speed/#view=4,109,5z/model=icon' },
  { name: 'temperature',url: 'https://zoom.earth/maps/temperature/#view=4,109,5z/model=icon' },
  { name: 'humidity',   url: 'https://zoom.earth/maps/humidity/#view=4,109,5z/model=icon' },
  { name: 'pressure',   url: 'https://zoom.earth/maps/pressure/#view=4,109,5z/model=icon' },
];

async function run() {
  console.log('🛰️  Zoom Earth Focused Sniffer\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1200, height: 800 },
  });

  const captured = {};  // mode -> Set of tile template URLs

  context.on('request', (req) => {
    const url = req.url();
    if (!/tiles\.zoom\.earth|api\.zoom\.earth/.test(url)) return;
    if (!/\.(webp|jpg|png)/.test(url)) return;
    const tmpl = url
      .replace(/\/\d+\/\d+\/\d+(\.\w+)/, '/{z}/{y}/{x}$1');
    const mode = context._currentMode || 'unknown';
    (captured[mode] = captured[mode] || new Set()).add(tmpl);
  });

  const page = await context.newPage();

  for (const m of MODES) {
    context._currentMode = m.name;
    console.log(`📍 ${m.name} ...`);
    try {
      await page.goto(m.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(6000); // bagi tiles load
    } catch (e) {
      console.log(`   ⚠️ ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();

  const result = { sniffed_at: new Date().toISOString() };
  for (const [mode, set] of Object.entries(captured)) {
    result[mode] = [...set].sort();
  }

  fs.mkdirSync('./output', { recursive: true });
  fs.writeFileSync('./output/zoomearth-layers.json', JSON.stringify(result, null, 2));

  console.log('\n=== Captured tile templates ===');
  for (const [mode, urls] of Object.entries(result)) {
    if (mode === 'sniffed_at') continue;
    console.log(`\n[${mode}]`);
    urls.forEach(u => console.log('  ' + u));
  }
  console.log('\n💾 Saved: ./output/zoomearth-layers.json');
}

run().catch(console.error);
