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
playwright-cli type "大阪駅"   # type the actual location name in Japanese
sleep 1

# Re-read snapshot after sleep — autocomplete suggestions load asynchronously
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "大阪駅" "$SNAP"   # grep for the text you just typed to find suggestions
# Click the matching station/area suggestion:
playwright-cli click e<SUGGESTION_REF>
```

## Step 4 — Fill keyword and search

**If the user specified a cuisine or keyword**, fill the field, sleep, and check for autocomplete. If suggestions appear, click the best match (autocomplete resolves to internal IDs, same reason as Step 3). If not, click search directly.

**If no keyword was specified** (user wants all genres), skip filling the keyword field and go straight to the search button.

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "キーワード" "$SNAP"
playwright-cli fill e<KEYWORD_REF> "焼肉"   # omit this line if no keyword
sleep 1

SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
# Check if autocomplete dropdown appeared (only relevant when keyword was filled):
grep "焼肉" "$SNAP"
# If a suggestion matches, click it. Otherwise find and click the search button:
grep "検索" "$SNAP"
playwright-cli click e<SEARCH_BTN_REF>
```

## Step 5 — Sort order and filters (URL parameters)

After the search results page loads, build the final URL by appending the required parameters and navigate directly — no UI interaction needed.

**Sort order parameters (`SrtT`):**

| User request | `SrtT` value |
|---|---|
| 評分排序（default） | `rt` |
| 評論數排序 | `rvcn` |

**Filter parameters (optional):**

| Filter | URL Parameter |
|---|---|
| Vegetarian menu available | `ChkVegetarianMenu=1` |

```bash
# Get the current URL after Step 4, then append the needed parameters:
CURRENT_URL=$(playwright-cli eval "window.location.href" | grep "^\"" | tr -d '"')

# Example: score ranking + vegetarian filter
playwright-cli goto "${CURRENT_URL}&SrtT=rt&sort_mode=1&ChkVegetarianMenu=1"

# Example: review-count ranking only
playwright-cli goto "${CURRENT_URL}&SrtT=rvcn"
```

Verify by checking the page title — it should reflect the sort order and any active filters.

## Step 6 — Extract restaurant list

`playwright-cli run-code` expects a single expression (an arrow function), so you can't prepend `const` statements inline. Write to a temp file first, then run:

```bash
# Replace the default N=5 with the actual requested count:
sed 's/const N = typeof TOP_N.*/const N = 5;/' \
  .claude/skills/tabelog-search/scripts/extract_list.js > /tmp/tbl_list.js
playwright-cli run-code "$(cat /tmp/tbl_list.js)"
```

If the result is `[]`, the page may not have fully loaded (DNS cache overflow error is a known cause). Run `playwright-cli reload` and retry.

This returns a JSON array with: `rank`, `name`, `score`, `reviews`, `badge` (百名店 or null), `url`.

Note: the `name` field may have the rank number prepended (e.g. `"1北新地やまがた屋"`). Strip the leading digit when displaying.

## Step 7 — Fetch detail pages in parallel with subagents

Since each restaurant page is independent, launch one subagent per restaurant simultaneously — this is 4–5x faster than sequential fetching.

Each subagent must use its own named session (`-s=detail-<rank>`) so they don't interfere with the main browser or each other. Close the session after extraction.

The detail script reads all rows from the **店舗基本情報** table and returns them as a flat key→value object — you'll get whatever fields that page has (address, phone, hours, closed days, budget, etc.).

For each restaurant, spawn an Agent with this prompt (replace `<RANK>` and `<URL>` with actual values):

```
Extract details from a Tabelog restaurant page using a dedicated browser session.

1. Open a new session and navigate:
   playwright-cli -s=detail-<RANK> open "<URL>"

2. Run the bundled extraction script:
   playwright-cli -s=detail-<RANK> run-code "$(cat .claude/skills/tabelog-search/scripts/extract_detail.js)"

3. Close the session: playwright-cli -s=detail-<RANK> close

4. Return the raw JSON result.
```

Collect all results and merge with the list data from Step 6.

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

The `extract_detail.js` script reads the entire **店舗基本情報** table and returns all rows as key→value pairs. In practice, `.c-table tr` (with `th`/`td`) is what works on most pages. The `.rstinfo-table__item-title/.value` selectors are attempted first but often yield nothing.

## Score Reference

| Score | Quality |
|-------|---------|
| 3.8+ | 優秀 |
| 3.5–3.8 | 良好 |
| 3.5 以下 | 普通 |

## Output Format

Present results in Traditional Chinese (繁體中文) with rank, name, score, review count, 百名店 badge, address, phone, reservation status, intro, and Tabelog URL for each restaurant.
