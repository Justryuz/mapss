/**
 * NADMA API - Playwright Intercept
 * Login ke MyDIMS dan intercept API calls secara automatik
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const CONFIG = {
  email: 'kiraduet20@gmail.com',
  password: 'kiraduet20@gmail.com',
  baseUrl: 'https://mydims.nadma.gov.my',
  outputDir: './output',
  headless: true, // tukar ke false untuk tengok browser
};

const ENDPOINTS = [
  { name: 'profile',        url: '/api/profile',        method: 'POST', body: {} },
  { name: 'disasters',      url: '/api/disasters',       method: 'POST', body: {} },
  { name: 'warning-portal', url: '/api/warning-portal',  method: 'POST', body: {} },
];

// Pages untuk navigate - trigger lazy load data
const PAGES_TO_VISIT = [
  '/dashboard',
  '/pengurusan-amaran',
  '/disaster',
  '/shelter',
  '/readiness',
];

async function run() {
  console.log('🚀 Playwright NADMA Intercept');
  console.log('================================\n');

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });

  const interceptedData = {};
  const interceptedRequests = [];

  // ── Intercept semua network requests ──────────────────────────────────────
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    // Log API calls
    if (url.includes('/api/')) {
      console.log(`📡 [${method}] ${url}`);
    }

    await route.continue();
  });

  // ── Listen pada responses ──────────────────────────────────────────────────
  context.on('response', async (response) => {
    const url = response.url();
    const status = response.status();

    if (url.includes('/api/') && status === 200) {
      try {
        const body = await response.json();
        const key = url.split('/api/')[1]?.split('?')[0] || url;
        interceptedData[key] = body;
        interceptedRequests.push({ url, status, data: body });
        console.log(`✅ Got data from: ${url} (${JSON.stringify(body).length} chars)`);
      } catch (_) {
        // bukan JSON, skip
      }
    }
  });

  const page = await context.newPage();

  // ── Step 1: CSRF Cookie ────────────────────────────────────────────────────
  console.log('1️⃣  Getting CSRF cookie...');
  // sanctum/csrf-cookie returns 204 (no content) - use domcontentloaded to avoid timeout
  await page.goto(`${CONFIG.baseUrl}/sanctum/csrf-cookie`, { waitUntil: 'commit' }).catch(() => {});

  // ── Step 2: Login ──────────────────────────────────────────────────────────
  console.log('2️⃣  Logging in...');
  await page.goto(`${CONFIG.baseUrl}/login`, { waitUntil: 'networkidle' });

  // Inject credentials terus via Inertia form (lebih reliable dari selector)
  const loginResult = await page.evaluate(async ({ email, password, baseUrl }) => {
    // Dapatkan XSRF token dari cookie
    const xsrf = decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || '');

    // Dapatkan Inertia version
    const pageData = JSON.parse(document.getElementById('app')?.dataset?.page || '{}');
    const version = pageData.version || '';

    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-XSRF-TOKEN': xsrf,
        'X-Inertia': 'true',
        'X-Inertia-Version': version,
      },
      body: JSON.stringify({ email, password, remember: false }),
      credentials: 'include',
      redirect: 'manual',
    });
    return { status: res.status, ok: res.ok || res.status === 302 };
  }, { email: CONFIG.email, password: CONFIG.password, baseUrl: CONFIG.baseUrl });

  if (loginResult.status === 302 || loginResult.status === 200) {
    console.log('✅ Login berjaya!');
    // Navigate ke dashboard untuk activate session
    await page.goto(`${CONFIG.baseUrl}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
  } else {
    console.log(`⚠️  Login status: ${loginResult.status}`);
  }

  // ── Step 3: Ambil cookies + token ─────────────────────────────────────────
  console.log('3️⃣  Extracting session cookies...');
  const cookies = await context.cookies();
  const xsrfCookie = cookies.find(c => c.name === 'XSRF-TOKEN');
  const sessionCookie = cookies.find(c => c.name === 'mydims_30_session');

  const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : '';
  console.log(`   XSRF token length: ${xsrfToken.length}`);
  console.log(`   Session cookie: ${sessionCookie ? '✅ found' : '❌ missing'}`);

  // ── Step 4: Call API endpoints secara direct via page.evaluate ─────────────
  console.log('\n4️⃣  Calling API endpoints...\n');

  for (const ep of ENDPOINTS) {
    console.log(`📤 Calling ${ep.method} ${ep.url}...`);
    try {
      const result = await page.evaluate(async ({ url, method, body, baseUrl }) => {
        const xsrf = decodeURIComponent(
          document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || ''
        );
        const res = await fetch(baseUrl + url, {
          method,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-XSRF-TOKEN': xsrf,
          },
          body: JSON.stringify(body),
          credentials: 'include',
        });
        const text = await res.text();
        return { status: res.status, body: text };
      }, { url: ep.url, method: ep.method, body: ep.body, baseUrl: CONFIG.baseUrl });

      if (result.status === 200) {
        const data = JSON.parse(result.body);
        interceptedData[ep.name] = data;
        console.log(`   ✅ ${ep.name}: ${result.status} (${result.body.length} chars)`);
        // Preview data
        const preview = JSON.stringify(data).substring(0, 150);
        console.log(`   Preview: ${preview}...`);
      } else {
        console.log(`   ❌ ${ep.name}: ${result.status} → ${result.body.substring(0, 100)}`);
      }
    } catch (err) {
      console.log(`   ❌ ${ep.name}: Error - ${err.message}`);
    }
  }

  // ── Step 5: Navigate pages untuk trigger lazy-loaded data ──────────────────
  console.log('\n5️⃣  Navigating pages untuk capture lazy-loaded data...\n');

  for (const pagePath of PAGES_TO_VISIT) {
    console.log(`🔍 Visiting ${pagePath}...`);
    try {
      await page.goto(`${CONFIG.baseUrl}${pagePath}`, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      await page.waitForTimeout(2000); // bagi masa JS execute

      // Extract Inertia page props
      const props = await page.evaluate(() => {
        const app = document.getElementById('app');
        if (!app?.dataset?.page) return null;
        try {
          return JSON.parse(app.dataset.page);
        } catch (_) { return null; }
      });

      if (props?.props && Object.keys(props.props).length > 2) {
        const key = pagePath.replace('/', '').replace('/', '_');
        interceptedData[`page_${key}`] = props.props;
        console.log(`   ✅ Got page props: ${Object.keys(props.props).join(', ')}`);
      } else {
        console.log(`   ⚠️  No useful props (403/no data)`);
      }
    } catch (err) {
      console.log(`   ❌ ${pagePath}: ${err.message.split('\n')[0]}`);
    }
  }

  // ── Step 6: Simpan semua data ──────────────────────────────────────────────
  console.log('\n6️⃣  Saving data...\n');

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  // Simpan setiap endpoint
  for (const [key, data] of Object.entries(interceptedData)) {
    const filename = path.join(CONFIG.outputDir, `${key.replace(/\//g, '_')}.json`);
    fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
    console.log(`   💾 Saved: ${filename}`);
  }

  // Summary
  const summaryPath = path.join(CONFIG.outputDir, 'playwright-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalEndpoints: Object.keys(interceptedData).length,
    endpoints: Object.keys(interceptedData),
    cookies: {
      xsrf: xsrfToken.substring(0, 50) + '...',
      session: sessionCookie ? 'found' : 'missing',
    },
  }, null, 2));

  console.log('\n================================');
  console.log(`✅ Done! ${Object.keys(interceptedData).length} datasets saved to ./output/`);
  console.log('================================\n');

  await browser.close();
  return interceptedData;
}

run().catch(console.error);
