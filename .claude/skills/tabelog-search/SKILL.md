---
name: tabelog-search
description: Search for restaurants on tabelog.com (食べログ), Japan's largest restaurant review platform. Use this skill whenever the user wants to find restaurants in Japan — searching by area, station, cuisine type, ranking, or any combination. Covers tasks like "find top ramen near Shinsaibashi", "show me the best sushi in Ginza", "search tabelog for izakaya in Kyoto". Also handles sending results via LINE or other channels after searching.
allowed-tools: Bash(playwright-cli:*), Agent
---

# Tabelog Restaurant Search Skill

Workflow for searching restaurants on **tabelog.com** using `playwright-cli`.
Bundled scripts are in the `scripts/` directory — use them instead of writing extraction code from scratch.

## Step 1 — Open Tabelog

The proxy is configured automatically at session start, so just open the browser:

```bash
playwright-cli open https://tabelog.com 2>&1 | tail -5
```

## Step 2 — Dismiss language popup

Read the snapshot and find the 「日本語」 element ref, then click it:

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "日本語" "$SNAP"
# Click the ref shown (e.g. e1618):
playwright-cli click e<REF>
```

## Step 3 — Fill area via autocomplete (important)

Tabelog uses autocomplete to resolve area/station names into internal location IDs. Filling the field via JavaScript bypasses this and produces nationwide results or CAPTCHAs, so always use the UI flow below:

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "エリア" "$SNAP"
playwright-cli click e<AREA_REF>
playwright-cli type "<location in Japanese, e.g. 心斎橋>"
sleep 1

SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "<location>" "$SNAP"
# Click the matching station/area suggestion:
playwright-cli click e<SUGGESTION_REF>
```

## Step 4 — Fill keyword and search

After filling the keyword, sleep briefly and check for autocomplete suggestions — if any appear, click the most relevant one (same reason as Step 3: autocomplete resolves to internal IDs). If no suggestions appear, proceed directly to clicking the search button.

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "キーワード" "$SNAP"
playwright-cli fill e<KEYWORD_REF> "<cuisine, e.g. ラーメン>"
sleep 1

SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
# Check if autocomplete dropdown appeared:
grep "<cuisine>" "$SNAP"
# If a suggestion matches, click it. Otherwise:
grep "検索" "$SNAP"
playwright-cli click e<SEARCH_BTN_REF>
```

## Step 5 — Sort order

**Default: ランキング順（score-based）**

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "ランキング" "$SNAP"
playwright-cli click e<RANKING_REF>
```

**If the user requests review-count ranking:** look for 「口コミが多い順」 instead.

```bash
grep "口コミが多い順" "$SNAP"
playwright-cli click e<REVIEW_COUNT_REF>
```

## Step 6 — Extract restaurant list

Use the bundled script. Pass `N` as the number of results the user requested (default 5 if unspecified):

```bash
playwright-cli run-code "const TOP_N = <N>; $(cat .claude/skills/tabelog-search/scripts/extract_list.js)"
```

This returns a JSON array with: `rank`, `name`, `score`, `reviews`, `badge` (百名店 or null), `url`.

## Step 7 — Fetch detail pages in parallel with subagents

Since each restaurant page is independent, launch one subagent per restaurant simultaneously — this is 4–5x faster than sequential fetching.

Each subagent must use its own named session (`-s=detail-<rank>`) so they don't interfere with the main browser or each other. Close the session after extraction.

The detail script reads all rows from the **店舗基本情報** table and returns them as a flat key→value object — you'll get whatever fields that page has (address, phone, hours, closed days, budget, etc.).

For each restaurant (e.g. rank 1), spawn an Agent with this prompt:

```
Extract details from a Tabelog restaurant page using a dedicated browser session.

1. Open a new session and navigate:
   playwright-cli -s=detail-1 open "https://tabelog.com/osaka/A2701/A270101/27011099/"

2. Run the extraction script (save to /tmp/extract_detail.js first):
   Content of /tmp/extract_detail.js:
   async page => {
     const rows = Array.from(await page.$$('.rstinfo-table .rstinfo-table__item'));
     const info = {};
     for (const row of rows) {
       const th = await row.$eval('.rstinfo-table__item-title', e => e.textContent.trim()).catch(() => null);
       const td = await row.$eval('.rstinfo-table__item-value', e => e.innerText.trim()).catch(() => null);
       if (th && td) info[th] = td;
     }
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

   Then run: playwright-cli -s=detail-1 run-code "$(cat /tmp/extract_detail.js)"

3. Close the session: playwright-cli -s=detail-1 close

4. Return the raw JSON result.
```

Adjust the session name (`detail-1`, `detail-2`, …) and URL per restaurant. Collect all results and merge with the list data from Step 6.

## CSS Selectors Reference

**List page (Step 6)**

| Field | Selector |
|-------|----------|
| Restaurant card | `.list-rst__wrap` |
| Name | `.list-rst__rst-name` |
| Score | `.c-rating__val` |
| Review count | `.list-rst__rvw-count` |
| 百名店 badge | `.c-shop-top-badge` |
| Detail page link | `a.list-rst__rst-name-target` |

**Detail page (Step 7)**

The `extract_detail.js` script reads the entire **店舗基本情報** table and returns all rows as key→value pairs. Primary selector: `.rstinfo-table .rstinfo-table__item` (th: `.rstinfo-table__item-title`, td: `.rstinfo-table__item-value`). Falls back to `.c-table tr` if the primary selector yields nothing.

## Score Reference

| Score | Quality |
|-------|---------|
| 3.8+ | 優秀 |
| 3.5–3.8 | 良好 |
| 3.5 以下 | 普通 |

## Output Format

Present results in Traditional Chinese (繁體中文) with rank, name, score, review count, 百名店 badge, address, phone, reservation status, intro, and Tabelog URL for each restaurant.
