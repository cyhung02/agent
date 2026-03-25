// Extract 店舗基本情報 table and 口コミ on a Tabelog restaurant detail page,
// Usage: playwright-cli run-code "$(cat scripts/extract_detail.js)"
// Must be run after navigating to the restaurant's detail page.
//
// Returns an object with:
//   - 店舗情報: flat key→value from the info table
//   - 口コミ: array of { title, text } from reviews shown on the page
async page => {
  // --- 店舗基本情報 ---
  const info = {};
  const rows = Array.from(await page.$$('.rstinfo-table .rstinfo-table__item'));
  for (const row of rows) {
    const th = await row.$eval('.rstinfo-table__item-title', e => e.textContent.trim()).catch(() => null);
    const td = await row.$eval('.rstinfo-table__item-value', e => e.innerText.trim()).catch(() => null);
    if (th && td) info[th] = td;
  }
  // Fallback: generic c-table rows (some pages use a different structure)
  if (Object.keys(info).length === 0) {
    const fallback = Array.from(await page.$$('.c-table tr'));
    for (const row of fallback) {
      const th = await row.$eval('th', e => e.textContent.trim()).catch(() => null);
      const td = await row.$eval('td', e => e.innerText.trim()).catch(() => null);
      if (th && td) info[th] = td;
    }
  }

  // --- 口コミ ---
  const reviews = [];
  const score = await page.$eval('.rdheader-rating__score-val', e => e.innerText.trim()).catch(() => null);
  const reviewItems = Array.from(await page.$$('.rstdtl-top-rvwlst__list > li'));
  for (const item of reviewItems) {
    const title = await item.$eval('h4', e => e.innerText.trim()).catch(() => null);
    const text  = await item.$$eval('p', els => {
      const p = els.find(e => e.innerText.trim().length > 20 && !/ピックアップ/.test(e.innerText));
      return p ? p.innerText.trim() : null;
    }).catch(() => null);
    if (title || text) reviews.push({ title, text });
  }

  return JSON.stringify({ score, 店舗情報: info, 口コミ: reviews }, null, 2);
}
