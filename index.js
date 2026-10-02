/**
 * NADMA Data Fetcher - Main Entry Point
 * Jalankan semua 3 method sekaligus atau pilih satu
 *
 * Usage:
 *   node index.js              → run semua
 *   node index.js playwright   → Playwright intercept sahaja
 *   node index.js public       → Public API sahaja
 *   node index.js scraper      → Scraper sahaja
 */

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const mode = args[0] || 'all';

const MODES = {
  playwright: { file: 'src/playwright-intercept.js', label: '🎭 Playwright Intercept' },
  public:     { file: 'src/public-api.js',           label: '🌐 Public API' },
  scraper:    { file: 'src/scraper.js',              label: '🕷️  Web Scraper' },
};

async function runScript(file) {
  const { createRequire } = await import('module');
  return import(`./${file}`);
}

console.log('╔════════════════════════════════════╗');
console.log('║   NADMA Data Fetcher v1.0          ║');
console.log('╚════════════════════════════════════╝\n');

if (mode === 'all') {
  console.log('▶ Running ALL methods...\n');
  for (const [key, m] of Object.entries(MODES)) {
    console.log(`\n${'═'.repeat(40)}`);
    console.log(`Running: ${m.label}`);
    console.log('═'.repeat(40));
    try {
      execSync(`node ${m.file}`, { stdio: 'inherit', cwd: process.cwd() });
    } catch (e) {
      console.error(`Failed: ${key}`);
    }
  }
} else if (MODES[mode]) {
  const m = MODES[mode];
  console.log(`▶ Running: ${m.label}\n`);
  try {
    execSync(`node ${m.file}`, { stdio: 'inherit', cwd: process.cwd() });
  } catch (e) {
    process.exit(1);
  }
} else {
  console.log('Usage: node index.js [playwright|public|scraper|all]');
  process.exit(1);
}
