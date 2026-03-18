// Extract all rows from the 店舗基本情報 table on a Tabelog restaurant detail page.
// Usage: playwright-cli run-code "$(cat scripts/extract_detail.js)"
// Must be run after navigating to the restaurant's detail page.
//
// Returns a flat object where keys are the th labels and values are the td text,
// e.g. { "住所": "...", "お問い合わせ": "...", "営業時間": "...", "定休日": "..." }
async page => {
  const rows = Array.from(await page.$$('.rstinfo-table .rstinfo-table__item'));
  const info = {};
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
  return JSON.stringify(info, null, 2);
}
