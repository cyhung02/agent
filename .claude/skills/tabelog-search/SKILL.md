# Tabelog Restaurant Search Skill

Automated browser workflow for searching restaurants on **tabelog.com**.
Use **playwright-cli** for all browser interactions (NOT `agent-browser` — it does not exist).

## Key Parameters

- **Location** (Japanese area/station name) — mandatory
- **Cuisine type** — optional keyword
- **Top N** — how many restaurants to return (default 5)

---

## Step 1 — Run proxy update & open Tabelog

Always run this first to ensure the proxy is configured:

```bash
bash scripts/update-playwright-proxy.sh
playwright-cli open https://tabelog.com 2>&1 | tail -5
```

---

## Step 2 — Dismiss language popup

Take a snapshot and find the 「日本語」 ref:

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep -i "日本語" "$SNAP" | head -5
# Note the ref (e.g. e1618), then click it:
playwright-cli click e<REF>
```

---

## Step 3 — Fill area field via UI (CRITICAL)

> **Never** use JavaScript to set the area value — it bypasses autocomplete and breaks geolocation filtering.

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep -i "エリア\|area-input\|textbox" "$SNAP" | head -5
# Note the area textbox ref (e.g. e62), then:
playwright-cli click e<AREA_REF>
playwright-cli type "<location in Japanese e.g. 心斎橋>"
sleep 1

# Read snapshot to find autocomplete suggestion
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep -i "<location>" "$SNAP" | head -10
# Click the station/area suggestion (e.g. 心斎橋駅):
playwright-cli click e<SUGGESTION_REF>
```

---

## Step 4 — Fill keyword and search

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep -i "キーワード\|textbox" "$SNAP" | head -5
# Note keyword textbox ref (e.g. e64):
playwright-cli fill e<KEYWORD_REF> "<cuisine e.g. ラーメン>"

# Find and click 検索 button:
grep -i "検索\|button" "$SNAP" | head -5
playwright-cli click e<SEARCH_BTN_REF>
```

---

## Step 5 — Switch to score-based ranking

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep -i "ランキング" "$SNAP" | head -5
# Click the ランキング link:
playwright-cli click e<RANKING_REF>
```

---

## Step 6 — Extract restaurant list

Write the extraction script to a temp file to avoid shell escaping issues:

```bash
cat > /tmp/tbl_list.js << 'EOF'
async page => {
  const cards = await page.$$('.list-rst__wrap');
  const results = [];
  for (let i = 0; i < Math.min(N, cards.length); i++) {
    const c = cards[i];
    const name    = await c.$eval('.list-rst__rst-name', e => e.textContent.trim()).catch(() => null);
    const score   = await c.$eval('.c-rating__val', e => e.textContent.trim()).catch(() => null);
    const reviews = await c.$eval('.list-rst__rvw-count', e => e.textContent.trim()).catch(() => null);
    const badge   = await c.$('.c-shop-top-badge').catch(() => null);
    const url     = await c.$eval('a.list-rst__rst-name-target', e => e.href).catch(() => null);
    results.push({ name, score, reviews, badge: badge ? '百名店' : null, url });
  }
  return JSON.stringify(results);
}
EOF
# Replace N with actual number (e.g. 5):
sed -i 's/Math.min(N,/Math.min(5,/' /tmp/tbl_list.js
playwright-cli run-code "$(cat /tmp/tbl_list.js)"
```

---

## Step 7 — Fetch detail pages in PARALLEL with subagents

Each restaurant detail page is **independent** — launch one Explore subagent per restaurant concurrently to protect the main context and save time.

For each restaurant URL, spawn an Agent with subagent_type=`Explore` and this prompt:

```
Open this Tabelog restaurant page with playwright-cli and extract details.

URL: <restaurant_url>

Run:
  playwright-cli goto "<restaurant_url>"

Then run this script saved as /tmp/tbl_detail.js:

async page => {
  const rows = Array.from(await page.$$('.c-table tr, .rstinfo-table tr'));
  let address = null, phone = null, reserve = null;
  for (const row of rows) {
    const th = await row.$eval('th', e => e.textContent.trim()).catch(() => '');
    const td = await row.$eval('td', e => e.textContent.trim()).catch(() => '');
    if (th.includes('住所'))                         address = td.split('\n')[0].trim();
    if (th.includes('お問い合わせ') || th.includes('電話')) phone   = td.split('\n')[0].trim();
    if (th.includes('予約') && !th.includes('ネット予約')) reserve = td.split('\n')[0].trim();
  }
  if (!phone) {
    phone = await page.$eval('.rstdtl-side-yoyaku__tel strong', e => e.textContent.trim()).catch(() => null);
  }
  const intro = await page.$eval(
    '.rstdtl-top__rst-intro, .pr-comment__text',
    e => e.textContent.trim()
  ).catch(() => null);
  return JSON.stringify({ address, phone, reserve, intro });
}

Execute with:
  playwright-cli run-code "$(cat /tmp/tbl_detail.js)"

Return the raw JSON result only.
```

Collect all subagent results and merge with the list data from Step 6.

---

## CSS Selectors Reference

| Field | Selector |
|-------|----------|
| Restaurant card | `.list-rst__wrap` |
| Name | `.list-rst__rst-name` |
| Score | `.c-rating__val` |
| Review count | `.list-rst__rvw-count` |
| 百名店 badge | `.c-shop-top-badge` |
| Detail page link | `a.list-rst__rst-name-target` |
| Table rows (detail) | `.c-table tr` |
| Phone (th label) | `お問い合わせ` |
| Address (th label) | `住所` |
| Reservation (th label) | `予約` (exclude `ネット予約`) |
| Intro/description | `.rstdtl-top__rst-intro`, `.pr-comment__text` |

---

## Score Reference

| Score | Quality |
|-------|---------|
| 3.8+ | 優秀（excellent） |
| 3.5–3.8 | 良好（good） |
| 3.5 以下 | 普通 |

---

## Output Format

Present findings in Traditional Chinese (繁體中文) with:
- Rank, name, score, review count, 百名店 badge if present
- Address, phone, reservation availability, intro
- Tabelog URL for each restaurant
