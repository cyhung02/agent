// Extract restaurant list from Tabelog ranking page.
// Usage: playwright-cli run-code "$(cat scripts/extract_list.js)"
// Set TOP_N environment variable or edit the number below.
async page => {
  const N = typeof TOP_N !== 'undefined' ? TOP_N : 5;
  const cards = await page.$$('.list-rst__wrap');
  const results = [];
  for (let i = 0; i < Math.min(N, cards.length); i++) {
    const c = cards[i];
    const name    = await c.$eval('.list-rst__rst-name', e => e.textContent.trim()).catch(() => null);
    const score   = await c.$eval('.c-rating__val', e => e.textContent.trim()).catch(() => null);
    const reviews = await c.$eval('.list-rst__rvw-count', e => e.textContent.trim()).catch(() => null);
    const badge   = await c.$('.c-shop-top-badge').catch(() => null);
    const url     = await c.$eval('a.list-rst__rst-name-target', e => e.href).catch(() => null);
    results.push({ rank: i + 1, name, score, reviews, badge: badge ? '百名店' : null, url });
  }
  return JSON.stringify(results, null, 2);
}
