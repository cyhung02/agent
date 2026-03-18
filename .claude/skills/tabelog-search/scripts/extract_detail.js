// Extract detail info from a single Tabelog restaurant page.
// Usage: playwright-cli run-code "$(cat scripts/extract_detail.js)"
// Must be run after navigating to the restaurant's detail page.
async page => {
  const rows = Array.from(await page.$$('.c-table tr, .rstinfo-table tr'));
  let address = null, phone = null, reserve = null;
  for (const row of rows) {
    const th = await row.$eval('th', e => e.textContent.trim()).catch(() => '');
    const td = await row.$eval('td', e => e.textContent.trim()).catch(() => '');
    // Phone label is "お問い合わせ", not "電話"
    if (th.includes('住所'))                              address = td.split('\n')[0].trim();
    if (th.includes('お問い合わせ') || th.includes('電話')) phone   = td.split('\n')[0].trim();
    if (th.includes('予約') && !th.includes('ネット予約')) reserve = td.split('\n')[0].trim();
  }
  // Fallback for phone if not found in table
  if (!phone) {
    phone = await page.$eval(
      '.rstdtl-side-yoyaku__tel strong',
      e => e.textContent.trim()
    ).catch(() => null);
  }
  const intro = await page.$eval(
    '.rstdtl-top__rst-intro, .pr-comment__text',
    e => e.textContent.trim()
  ).catch(() => null);
  return JSON.stringify({ address, phone, reserve, intro }, null, 2);
}
