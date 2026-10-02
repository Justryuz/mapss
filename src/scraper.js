/**
 * NADMA Data - Web Scraper (Fixed)
 * Scrape data dari portalbencana.nadma.gov.my dan sumber berkaitan
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './output';

const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ms-MY,ms;q=0.9,en;q=0.8',
  },
});

function save(filename, data) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`   💾 Saved: ${filepath}`);
}

// Bersihkan whitespace & newlines dalam text
function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// Detect jika response adalah maintenance page
function isMaintenance(data) {
  return typeof data === 'string' && (
    data.includes('Notis Gangguan') ||
    data.includes('maintenance') ||
    data.includes('<!DOCTYPE html>')
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 1. portalbencana.nadma.gov.my
// ══════════════════════════════════════════════════════════════════════════
async function scrapePortalBencana() {
  console.log('\n🔍 Scraping portalbencana.nadma.gov.my');
  console.log('─────────────────────────────────────────');

  const results = { announcements: [], mediaRelease: [], warnings: [] };

  try {
    const { data: html } = await http.get('https://portalbencana.nadma.gov.my/ms');
    const $ = cheerio.load(html);

    // CSRF token
    const csrfScript = $('script.joomla-script-options').text();
    const csrfMatch = csrfScript.match(/"csrf\.token":"([^"]+)"/);
    const csrfToken = csrfMatch?.[1] || '';
    console.log(`   CSRF Token: ${csrfToken ? '✅ ' + csrfToken : '❌ not found'}`);

    // Scrape articles - clean title
    $('.ajax-post, article.post').each((i, el) => {
      const rawTitle = $(el).find('h3, h4, .aga_heading, a').first().text();
      const title = clean(rawTitle).split('\n')[0].split('Posted in:')[0].trim();
      const link = $(el).find('a').first().attr('href');
      const date = clean($(el).find('.article-date, time, .post-date, .item-footer').text());
      const content = clean($(el).find('p, .article-intro, .item-intro').first().text());

      if (title && title.length > 5) {
        results.announcements.push({
          title,
          link: link ? `https://portalbencana.nadma.gov.my${link}` : null,
          date,
          content: content.substring(0, 200),
        });
      }
    });

    console.log(`   ✅ Announcements: ${results.announcements.length} items`);

    // AJAX load more articles
    if (csrfToken) {
      try {
        const ajaxRes = await http.get('https://portalbencana.nadma.gov.my/index.php', {
          params: {
            option: 'com_ajax',
            module: 'ajax_intro_articles',
            cmd: 'load',
            format: 'raw',
            start: 0,
            limit: 20,
            moduleID: 157,
            Itemid: 101,
            [csrfToken]: 1,
          },
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });

        if (ajaxRes.data && !isMaintenance(ajaxRes.data)) {
          const $ajax = cheerio.load(ajaxRes.data);
          $ajax('article, .ajax-post').each((i, el) => {
            const rawTitle = $ajax(el).find('a, h3, h4, .aga_heading').first().text();
            const title = clean(rawTitle).split('Posted in:')[0].trim();
            const link = $ajax(el).find('a').first().attr('href');
            const date = clean($ajax(el).find('.item-footer, time').text());
            if (title && title.length > 5) {
              results.mediaRelease.push({
                title,
                link: link ? `https://portalbencana.nadma.gov.my${link}` : null,
                date,
              });
            }
          });
          console.log(`   ✅ Media releases (AJAX): ${results.mediaRelease.length} items`);
        }
      } catch (e) {
        console.log(`   ⚠️  AJAX: ${e.message.split('\n')[0]}`);
      }
    }

    // Scrape warning/amaran section
    $('[class*="amaran"], [class*="warning"], [id*="warning"], [id*="amaran"]').each((i, el) => {
      const text = clean($(el).text());
      if (text.length > 10 && text.length < 500) results.warnings.push(text);
    });

    // Scrape semua links ke artikel lain
    const articleLinks = [];
    $('a[href*="/article/"], a[href*="/component/content/"]').each((i, el) => {
      const href = $(el).attr('href');
      const title = clean($(el).text());
      if (href && title.length > 5) {
        articleLinks.push({ title, url: `https://portalbencana.nadma.gov.my${href}` });
      }
    });
    results.articleLinks = [...new Map(articleLinks.map(a => [a.url, a])).values()];
    console.log(`   ✅ Article links: ${results.articleLinks.length} items`);

  } catch (err) {
    console.log(`   ❌ Error: ${err.message.split('\n')[0]}`);
  }

  save('scraper_portalbencana.json', results);
  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 2. MetMalaysia - Warning images + scrape warning page
// ══════════════════════════════════════════════════════════════════════════
async function scrapeMetWarnings() {
  console.log('\n🔍 Scraping MetMalaysia Warnings');
  console.log('─────────────────────────────────────────');

  const results = { images: [], currentWarnings: [], advisories: [] };

  // Warning images (public, no auth)
  const warningImages = [
    { name: 'Amaran Ribut Petir',        url: 'https://www.met.gov.my/data/AmaranRibutPetir.jpg' },
    { name: 'Amaran Hujan Lebat',         url: 'https://www.met.gov.my/data/AmaranHujanLebat.jpg' },
    { name: 'Amaran Angin Kencang & Laut', url: 'https://www.met.gov.my/data/AmaranAnginKencangLaut.jpg' },
    { name: 'Tropical Cyclone',           url: 'https://www.met.gov.my/data/IWR30003.html' },
  ];

  for (const w of warningImages) {
    try {
      const res = await http.head(w.url);
      results.images.push({
        name: w.name,
        url: w.url,
        lastModified: res.headers['last-modified'],
        contentLength: res.headers['content-length'],
        contentType: res.headers['content-type'],
      });
      console.log(`   ✅ ${w.name}: updated ${res.headers['last-modified'] || 'available'}`);
    } catch (_) {
      console.log(`   ❌ ${w.name}`);
    }
  }

  // Scrape MetMalaysia warning page
  try {
    const { data: html } = await http.get('https://www.met.gov.my/en/iklim/iklim-negeri');
    const $ = cheerio.load(html);
    $('table tr').each((i, row) => {
      const cells = $(row).find('td').map((_, c) => clean($(c).text())).get().filter(c => c);
      if (cells.length >= 2) results.advisories.push(cells);
    });
    console.log(`   ✅ MetMalaysia advisories: ${results.advisories.length} rows`);
  } catch (err) {
    console.log(`   ⚠️  Advisory page: ${err.message.split('\n')[0]}`);
  }

  save('scraper_met_warnings.json', results);
  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. JKM - Info Bencana & Pusat Pemindahan (parse betul)
// ══════════════════════════════════════════════════════════════════════════
async function scrapeJKM() {
  console.log('\n🔍 Scraping JKM Info Bencana');
  console.log('─────────────────────────────────────────');

  const results = { disasters: [], shelters: [], rawTable: [] };

  try {
    const { data: html } = await http.get('https://infobencanajkmv2.jkm.gov.my/landing/');
    const $ = cheerio.load(html);

    // Parse disaster summary table
    $('table').each((ti, table) => {
      const headers = [];
      $(table).find('thead th, tr:first-child th').each((_, th) => {
        headers.push(clean($(th).text()));
      });

      $(table).find('tbody tr, tr:not(:first-child)').each((_, row) => {
        const cells = $(row).find('td').map((_, c) => clean($(c).text())).get();
        if (cells.length > 0 && cells.some(c => c.length > 0)) {
          if (headers.length > 0) {
            const obj = {};
            headers.forEach((h, i) => { if (h) obj[h] = cells[i] || ''; });
            results.disasters.push(obj);
          } else {
            results.rawTable.push(cells);
          }
        }
      });
    });

    console.log(`   ✅ Disasters table: ${results.disasters.length} rows`);
    console.log(`   ✅ Raw table: ${results.rawTable.length} rows`);

    // Parse dari teks yang ada dalam page
    const bodyText = clean($('body').text());
    const bencanaMatch = bodyText.match(/BENCANA[\s\S]{0,2000}/);
    if (bencanaMatch) {
      // Parse structured bencana data
      const lines = bencanaMatch[0].split(/(?=[A-Z][a-z])|\n/).map(l => clean(l)).filter(l => l.length > 3);
      results.parsedText = lines.slice(0, 30);
    }

  } catch (err) {
    console.log(`   ❌ JKM page: ${err.message.split('\n')[0]}`);
  }

  // Try alternative JKM API endpoints
  const jkmApis = [
    'https://infobencanajkmv2.jkm.gov.my/api/data',
    'https://infobencanajkmv2.jkm.gov.my/api/bencana',
    'https://infobencanajkmv2.jkm.gov.my/api/shelter',
  ];

  for (const ep of jkmApis) {
    try {
      const res = await http.get(ep, { headers: { Accept: 'application/json' } });
      if (!isMaintenance(res.data)) {
        results.shelters.push({ endpoint: ep, data: res.data });
        console.log(`   ✅ JKM API: ${ep.split('/').pop()}`);
      }
    } catch (_) {}
  }

  save('scraper_jkm.json', results);
  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// 4. JPS Flood - Check maintenance & fallback
// ══════════════════════════════════════════════════════════════════════════
async function scrapeJPSFlood() {
  console.log('\n🔍 JPS Flood Portal');
  console.log('─────────────────────────────────────────');

  const results = { status: '', data: {} };

  // Check if in maintenance
  try {
    const res = await http.get('https://publicinfobanjir.water.gov.my/main', {
      headers: { Accept: 'text/html' },
    });
    if (isMaintenance(res.data)) {
      results.status = 'maintenance';
      console.log('   ⚠️  JPS sedang maintenance. Cuba URL alternatif...');
    } else {
      results.status = 'online';
    }
  } catch (_) {}

  // API endpoints JPS
  const endpoints = [
    { key: 'stations',    url: 'https://publicinfobanjir.water.gov.my/station/getStationList?district=&state=&lang=ms' },
    { key: 'floodEvents', url: 'https://publicinfobanjir.water.gov.my/flood/getFloodEventList?lang=ms' },
    { key: 'active',      url: 'https://publicinfobanjir.water.gov.my/flood/getActiveFloodList?lang=ms' },
    { key: 'waterLevel',  url: 'https://publicinfobanjir.water.gov.my/waterlevel/getWaterLevelList?lang=ms' },
    { key: 'alert',       url: 'https://publicinfobanjir.water.gov.my/flood/getFloodAlertList?lang=ms' },
  ];

  for (const ep of endpoints) {
    try {
      const res = await http.get(ep.url, {
        headers: { Accept: 'application/json', Referer: 'https://publicinfobanjir.water.gov.my/' },
      });
      if (isMaintenance(res.data)) {
        console.log(`   ⚠️  ${ep.key}: maintenance`);
      } else {
        results.data[ep.key] = res.data;
        const count = Array.isArray(res.data) ? res.data.length : (res.data?.data?.length ?? JSON.stringify(res.data).length + 'c');
        console.log(`   ✅ ${ep.key}: ${count} records`);
      }
    } catch (err) {
      console.log(`   ❌ ${ep.key}: ${err.response?.status || err.message.split('\n')[0]}`);
    }
  }

  save('scraper_jps_flood.json', results);
  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function run() {
  console.log('🕷️  Web Scraper - NADMA Data (Fixed)');
  console.log('========================================\n');

  const allResults = {};

  allResults.portalBencana = await scrapePortalBencana();
  allResults.metWarnings   = await scrapeMetWarnings();
  allResults.jkm           = await scrapeJKM();
  allResults.jpsFlood      = await scrapeJPSFlood();

  save('scraper_combined.json', {
    timestamp: new Date().toISOString(),
    sources: Object.keys(allResults),
    data: allResults,
  });

  console.log('\n========================================');
  console.log('📊 Scraper Summary:');
  for (const [src, data] of Object.entries(allResults)) {
    const keys = data ? Object.keys(data) : [];
    const hasData = keys.some(k => {
      const v = data[k];
      return Array.isArray(v) ? v.length > 0 : (v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);
    });
    console.log(`   ${hasData ? '✅' : '⚠️ '} ${src}: ${keys.join(', ')}`);
  }
  console.log('========================================\n');
}

run().catch(console.error);
