#!/usr/bin/env node
// tabelog_search.js - Tabelog restaurant search script
//
// Usage:
//   Mode 1 - Get autocomplete suggestions:
//     node tabelog_search.js --mode suggest --area "大阪" [--keyword "焼肉"]
//
//   Mode 2 - Full search (requires exact strings from Mode 1):
//     node tabelog_search.js --mode search --area "大阪市" [--keyword "焼肉・ホルモン"] [--n 5] [--sort rt]

const { chromium } = require('playwright');
const { URL } = require('url');

// --- Argument parsing ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const mode    = get('--mode') || 'suggest';
const area    = get('--area');
const keyword = get('--keyword') || '';
const n       = parseInt(get('--n') || '5', 10);
const sort    = get('--sort') || 'rt';

if (!area) { console.error('Error: --area is required'); process.exit(1); }

// --- Browser launch helper ---
async function launchBrowser() {
  const proxyUrl = process.env.HTTP_PROXY || '';
  let proxyConfig;
  if (proxyUrl) {
    const parsed = new URL(proxyUrl);
    proxyConfig = {
      server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
      username: parsed.username || '',
      password: parsed.password || '',
    };
  }
  return chromium.launch({
    channel: 'chrome',
    headless: true,
    chromiumSandbox: false,
    proxy: proxyConfig,
  });
}

// --- Shared: open tabelog and remove overlay ---
async function openTabelog(page) {
  await page.goto('https://tabelog.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    const overlay = document.querySelector('.c-overlay.js-lang-change-section-overlay');
    if (overlay) overlay.style.display = 'none';
  });
}

// --- Shared: get autocomplete suggestions for a field ---
async function getSuggestions(page, inputSelector, text) {
  await page.click(inputSelector);
  await page.type(inputSelector, text, { delay: 80 });
  try {
    await page.waitForSelector('li.js-header-search-suggest-items', { timeout: 5000 });
    await page.waitForTimeout(300); // let full list render
    return await page.$$eval(
      'li.js-header-search-suggest-items',
      els => els.map(el => el.innerText.trim())
    );
  } catch {
    return []; // no suggestions appeared
  }
}

// --- Mode 1: suggest ---
async function modeSuggest() {
  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await openTabelog(page);

  const areaSuggestions = await getSuggestions(page, '#sa', area);

  // Dismiss area autocomplete before typing keyword
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  let keywordSuggestions = [];
  if (keyword) {
    keywordSuggestions = await getSuggestions(page, '#sk', keyword);
  }

  await browser.close();

  console.log(JSON.stringify({ area_suggestions: areaSuggestions, keyword_suggestions: keywordSuggestions }, null, 2));
}

// --- Mode 2: search ---
async function modeSearch() {
  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await openTabelog(page);

  // Fill area - find and click the exact match in autocomplete
  const areaSuggestions = await getSuggestions(page, '#sa', area);
  const areaMatch = areaSuggestions.find(s => s === area);
  if (areaMatch) {
    await page.locator('li.js-header-search-suggest-items', { hasText: areaMatch }).first().click();
  } else {
    // No exact match - press Enter and hope for the best
    console.warn(`Warning: no exact area match found for "${area}", suggestions were: ${areaSuggestions.join(', ')}`);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);

  // Fill keyword
  if (keyword) {
    const kwSuggestions = await getSuggestions(page, '#sk', keyword);
    const kwMatch = kwSuggestions.find(s => s === keyword);
    if (kwMatch) {
      await page.locator('li.js-header-search-suggest-items', { hasText: kwMatch }).first().click();
    } else {
      // No exact match - just press Enter to search with raw keyword
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(500);
  }

  // Click search button
  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  // Apply sort order via URL
  const currentUrl = page.url();
  const separator = currentUrl.includes('?') ? '&' : '?';
  const sortParam = sort === 'rt' ? `SrtT=rt&sort_mode=1` : `SrtT=${sort}`;
  await page.goto(`${currentUrl}${separator}${sortParam}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Extract restaurant list
  const listScript = require('fs').readFileSync(
    require('path').join(__dirname, 'extract_list.js'), 'utf8'
  );
  // Inject N value
  const patchedScript = listScript.replace(
    /const N = typeof TOP_N.*/,
    `const N = ${n};`
  );
  const listJson = await page.evaluate(eval(`(${patchedScript})`));
  const restaurants = JSON.parse(listJson);

  // Extract details in parallel
  const detailScript = require('fs').readFileSync(
    require('path').join(__dirname, 'extract_detail.js'), 'utf8'
  );
  const detailFn = eval(`(${detailScript})`);

  const details = await Promise.all(
    restaurants.map(async (r) => {
      if (!r.url) return { ...r, detail: null };
      const detailPage = await context.newPage();
      try {
        await detailPage.goto(r.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const raw = await detailPage.evaluate(detailFn);
        return { ...r, detail: JSON.parse(raw) };
      } catch (e) {
        return { ...r, detail: { error: e.message } };
      } finally {
        await detailPage.close();
      }
    })
  );

  await browser.close();
  console.log(JSON.stringify(details, null, 2));
}

// --- Main ---
if (mode === 'suggest') {
  modeSuggest().catch(err => { console.error(err); process.exit(1); });
} else if (mode === 'search') {
  modeSearch().catch(err => { console.error(err); process.exit(1); });
} else {
  console.error(`Unknown mode: ${mode}. Use --mode suggest or --mode search`);
  process.exit(1);
}
