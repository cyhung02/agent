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

const mode       = get('--mode') || 'suggest';
const area       = get('--area');
const keyword    = get('--keyword') || '';
const n          = parseInt(get('--n') || '5', 10);
const sort       = get('--sort') || 'rt';
const vegetarian = args.includes('--vegetarian');

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
  let alreadyOnResults = false;
  if (keyword) {
    const kwSuggestions = await getSuggestions(page, '#sk', keyword);
    const kwMatch = kwSuggestions.find(s => s === keyword);
    if (kwMatch) {
      await page.locator('li.js-header-search-suggest-items', { hasText: kwMatch }).first().click();
    } else {
      // No exact match - press Enter; this navigates directly to results
      await page.keyboard.press('Enter');
      await page.waitForURL('**/rstLst/**', { timeout: 30000 }).catch(() => {});
      alreadyOnResults = page.url().includes('/rstLst/');
    }
    await page.waitForTimeout(300);
  }

  // Click search button only if not already on results page
  if (!alreadyOnResults) {
    await page.click('#js-global-search-btn');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }

  // Apply sort order via URL
  const currentUrl = page.url();
  const separator = currentUrl.includes('?') ? '&' : '?';
  const sortParam = sort === 'rt' ? `SrtT=rt&sort_mode=1` : `SrtT=${sort}`;
  const vegParam  = vegetarian ? `&ChkVegetarianMenu=1` : '';
  await page.goto(`${currentUrl}${separator}${sortParam}${vegParam}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Helpers for cleaning extracted text
  const stripNoise = (text, patterns) => {
    if (!text) return text;
    let t = text;
    for (const p of patterns) t = t.replace(p, '').trim();
    return t || null;
  };
  const normalizeKey = (key) => key ? key.replace(/\s+/g, '') : key;
  const SKIP_KEYS = new Set(['初投稿者', '最近の編集者']);
  const ADDR_NOISE = /\n+\s*(大きな地図を見る|周辺のお店を探す|このお店は「.*?」から移転.*)/gs;
  const BUDGET_NOISE = /\n+\s*利用金額分布を見る/g;
  const REVIEW_NOISE = /\s*\.\.\.?\s*詳細を見る\s*$/;

  // Extract restaurant list from search results page
  const cards = await page.$$('.list-rst__wrap');
  const restaurants = [];
  for (let i = 0; i < Math.min(n, cards.length); i++) {
    const c = cards[i];
    const rawName = await c.$eval('.list-rst__rst-name', e => e.textContent.trim()).catch(() => null);
    const name    = rawName ? rawName.replace(/^\d+/, '').trim() : null; // strip leading rank digit
    const score   = await c.$eval('.c-rating__val', e => e.textContent.trim()).catch(() => null);
    const reviews = await c.$eval('.list-rst__rvw-count', e => e.textContent.trim()).catch(() => null);
    const url     = await c.$eval('a.list-rst__rst-name-target', e => e.href).catch(() => null);
    restaurants.push({ rank: i + 1, name, score, reviews, url });
  }

  // Extract details in parallel
  const details = await Promise.all(
    restaurants.map(async (r) => {
      if (!r.url) return { ...r, detail: null };
      const detailPage = await context.newPage();
      try {
        await detailPage.goto(r.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 店舗基本情報
        const info = {};
        const rows = await detailPage.$$('.rstinfo-table .rstinfo-table__item');
        for (const row of rows) {
          const th = await row.$eval('.rstinfo-table__item-title', e => e.textContent.trim()).catch(() => null);
          const td = await row.$eval('.rstinfo-table__item-value', e => e.innerText.trim()).catch(() => null);
          const key = normalizeKey(th);
          if (key && td && !SKIP_KEYS.has(key)) {
            info[key] = stripNoise(td, [ADDR_NOISE, BUDGET_NOISE]);
          }
        }
        if (Object.keys(info).length === 0) {
          const fallback = await detailPage.$$('.c-table tr');
          for (const row of fallback) {
            const th = await row.$eval('th', e => e.textContent.trim()).catch(() => null);
            const td = await row.$eval('td', e => e.innerText.trim()).catch(() => null);
            const key = normalizeKey(th);
            if (key && td && !SKIP_KEYS.has(key)) {
              info[key] = stripNoise(td, [ADDR_NOISE, BUDGET_NOISE]);
            }
          }
        }

        // 受賞歴（完全リスト）
        const awardsRaw = await detailPage.$$eval('.rstinfo-table-badge-award__tooltip', els => els.map(e => e.innerText.trim())).catch(() => []);
        const formatAward = (s) => {
          const award = s.match(/The Tabelog Award (\d{4}) (Gold|Silver|Bronze)/);
          if (award) return `${award[1]} ${award[2]}`;
          const hyaku = s.match(/百名店 (\d{4})/);
          if (hyaku) return `${hyaku[1]} 百名店`;
          return s; // fallback: return raw string so nothing is lost
        };
        const awards = awardsRaw.length ? awardsRaw.map(formatAward) : null;

        // 店舗PR・口コミ
        const prTitle = await detailPage.$eval('.pr-comment-title', e => e.innerText.trim()).catch(() => null);
        const prBody  = await detailPage.$eval('.pr-comment', e => e.innerText.trim()).catch(() => null);
        const intro = prTitle || prBody ? { title: prTitle, body: prBody } : null;

        const reviewItems = await detailPage.$$('.rstdtl-top-rvwlst__list > li');
        const reviews = [];
        for (const item of reviewItems) {
          const title = await item.$eval('h4', e => e.innerText.trim()).catch(() => null);
          const text  = await item.$$eval('p', els => {
            const p = els.find(e => e.innerText.trim().length > 20 && !/ピックアップ/.test(e.innerText));
            return p ? p.innerText.trim() : null;
          }).catch(() => null);
          const cleanText = text ? text.replace(/\s*\.\.\.?\s*詳細を見る\s*$/, '').trim() : null;
          if (title || cleanText) reviews.push({ title, text: cleanText });
        }

        return { ...r, detail: { awards, intro, 店舗情報: info, 口コミ: reviews } };
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
