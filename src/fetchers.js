/**
 * Data Fetchers - Scrape & normalize data bencana live
 * Sumber: JKM InfoBencana, MetMalaysia, Portal Bencana NADMA
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'ms-MY,ms;q=0.9,en;q=0.8',
  },
});

const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

// ══════════════════════════════════════════════════════════════════════════
// 1. JKM - Disaster summary & active shelters (PPS)
//    Source: infobencanajkmv2.jkm.gov.my/landing/
// ══════════════════════════════════════════════════════════════════════════
export async function fetchDisasters() {
  const { data: html } = await http.get('https://infobencanajkmv2.jkm.gov.my/landing/', {
    headers: { Accept: 'text/html' },
  });
  const $ = cheerio.load(html);

  const disasters = [];
  let totals = null;

  // Table ringkasan bencana (summary table) - first table
  const summaryTable = $('table.table-dashboard').first();
  const headers = [];
  summaryTable.find('thead th, tr').first().find('th').each((_, th) => {
    headers.push(clean($(th).text()));
  });

  // Scan SEMUA rows (termasuk tfoot/JUMLAH yang mungkin di luar tbody)
  summaryTable.find('tr').each((_, row) => {
    const cells = $(row).find('td').map((_, c) => clean($(c).text())).get();
    if (cells.length < 4) return;

    const label = cells[0]?.toUpperCase() || '';
    // Baris JUMLAH = totals. Guna colspan=3 jadi: [JUMLAH, pps, keluarga, mangsa, (kosong)]
    if (label.includes('JUMLAH')) {
      // Ambil 3 nombor pertama selepas label
      const nums = cells.slice(1).map(toNum).filter(n => n !== null);
      totals = {
        pps: nums[0] ?? null,
        keluarga: nums[1] ?? null,
        mangsa: nums[2] ?? null,
      };
      return;
    }

    if (cells[0] && cells[0].length > 1 && !label.includes('BENCANA')) {
      disasters.push({
        jenis_bencana: cells[0],
        negeri: cells[1] || null,
        daerah: cells[2] || null,
        bilangan_pps: toNum(cells[3]),
        bilangan_keluarga: toNum(cells[4]),
        bilangan_mangsa: toNum(cells[5]),
        kapasiti: cells[6] || null,
      });
    }
  });

  return {
    source: 'JKM InfoBencana',
    source_url: 'https://infobencanajkmv2.jkm.gov.my/landing/',
    fetched_at: new Date().toISOString(),
    total_kejadian: disasters.length,
    ringkasan: totals,
    bencana: disasters,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 2. MetMalaysia - Warning images (amaran cuaca)
// ══════════════════════════════════════════════════════════════════════════
export async function fetchWarnings() {
  const warningImages = [
    { jenis: 'Ribut Petir',             url: 'https://www.met.gov.my/data/AmaranRibutPetir.jpg' },
    { jenis: 'Hujan Lebat',             url: 'https://www.met.gov.my/data/AmaranHujanLebat.jpg' },
    { jenis: 'Angin Kencang & Laut Bergelora', url: 'https://www.met.gov.my/data/AmaranAnginKencangLaut.jpg' },
  ];

  const warnings = [];
  for (const w of warningImages) {
    try {
      const res = await http.head(w.url);
      warnings.push({
        jenis_amaran: w.jenis,
        imej_url: w.url,
        dikemaskini: res.headers['last-modified'] || null,
        saiz_bytes: res.headers['content-length'] ? toNum(res.headers['content-length']) : null,
      });
    } catch (_) {
      warnings.push({ jenis_amaran: w.jenis, imej_url: w.url, dikemaskini: null, status: 'tidak tersedia' });
    }
  }

  return {
    source: 'MetMalaysia',
    source_url: 'https://www.met.gov.my',
    fetched_at: new Date().toISOString(),
    total: warnings.length,
    amaran: warnings,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Portal Bencana NADMA - Pengumuman & siaran media
// ══════════════════════════════════════════════════════════════════════════
export async function fetchAnnouncements() {
  const BASE = 'https://portalbencana.nadma.gov.my';
  const { data: html } = await http.get(`${BASE}/ms`, { headers: { Accept: 'text/html' } });
  const $ = cheerio.load(html);

  // CSRF token untuk AJAX
  const csrfScript = $('script.joomla-script-options').text();
  const csrfToken = csrfScript.match(/"csrf\.token":"([^"]+)"/)?.[1] || '';

  const announcements = [];

  // Initial articles dalam page
  $('.ajax-post, article.post').each((_, el) => {
    const title = clean($(el).find('h3, h4, .aga_heading, a').first().text())
      .split('Posted in:')[0].replace(/\d+Rating:.*$/, '').trim();
    const link = $(el).find('a').first().attr('href');
    if (title && title.length > 5) {
      announcements.push({
        tajuk: title,
        pautan: link ? `${BASE}${link}` : null,
        kategori: 'Siaran Media',
      });
    }
  });

  // Load more via AJAX
  if (csrfToken) {
    try {
      const { data: ajaxHtml } = await http.get(`${BASE}/index.php`, {
        params: {
          option: 'com_ajax', module: 'ajax_intro_articles', cmd: 'load',
          format: 'raw', start: 0, limit: 20, moduleID: 157, Itemid: 101, [csrfToken]: 1,
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (ajaxHtml && !String(ajaxHtml).includes('Notis Gangguan')) {
        const $a = cheerio.load(ajaxHtml);
        $a('article, .ajax-post').each((_, el) => {
          const title = clean($a(el).find('a, h3, h4, .aga_heading').first().text())
            .split('Posted in:')[0].replace(/\d+Rating:.*$/, '').trim();
          const link = $a(el).find('a').first().attr('href');
          if (title && title.length > 5) {
            announcements.push({ tajuk: title, pautan: link ? `${BASE}${link}` : null, kategori: 'Siaran Media' });
          }
        });
      }
    } catch (_) {}
  }

  // Dedupe by tajuk
  const unique = [...new Map(announcements.map(a => [a.tajuk, a])).values()];

  return {
    source: 'Portal Bencana NADMA',
    source_url: BASE,
    fetched_at: new Date().toISOString(),
    total: unique.length,
    pengumuman: unique,
  };
}

// ── Helper ──────────────────────────────────────────────────────────────
function toNum(v) {
  if (v == null) return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}
