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

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "キーワード" "$SNAP"
playwright-cli fill e<KEYWORD_REF> "<cuisine, e.g. ラーメン>"

grep "検索" "$SNAP"
playwright-cli click e<SEARCH_BTN_REF>
```

## Step 5 — Switch to score-based ranking

```bash
SNAP=$(ls -t .playwright-cli/page-*.yml | head -1)
grep "ランキング" "$SNAP"
playwright-cli click e<RANKING_REF>
```

## Step 6 — Extract restaurant list

Use the bundled script (edit the `5` inside to change how many results to extract):

```bash
playwright-cli run-code "$(cat .claude/skills/tabelog-search/scripts/extract_list.js)"
```

This returns a JSON array with: `rank`, `name`, `score`, `reviews`, `badge` (百名店 or null), `url`.

## Step 7 — Fetch detail pages in parallel with subagents

Since each restaurant page is independent, launch one `Explore` subagent per restaurant simultaneously — this is 4–5x faster than sequential fetching and keeps the main context clean.

For each restaurant, spawn an Agent with this prompt:

```
Navigate to this Tabelog restaurant page and extract its details.

1. Run: playwright-cli goto "<restaurant_url>"
2. Run: playwright-cli run-code "$(cat .claude/skills/tabelog-search/scripts/extract_detail.js)"
3. Return the raw JSON result.
```

Collect all results and merge with the list data from Step 6.

## CSS Selectors Reference

| Field | Selector / th label |
|-------|---------------------|
| Restaurant card | `.list-rst__wrap` |
| Name | `.list-rst__rst-name` |
| Score | `.c-rating__val` |
| Review count | `.list-rst__rvw-count` |
| 百名店 badge | `.c-shop-top-badge` |
| Detail page link | `a.list-rst__rst-name-target` |
| Table rows (detail) | `.c-table tr` |
| Phone th label | `お問い合わせ`（not `電話`） |
| Address th label | `住所` |
| Reservation th label | `予約`（exclude `ネット予約`） |
| Intro/description | `.rstdtl-top__rst-intro`, `.pr-comment__text` |

## Score Reference

| Score | Quality |
|-------|---------|
| 3.8+ | 優秀 |
| 3.5–3.8 | 良好 |
| 3.5 以下 | 普通 |

## Output Format

Present results in Traditional Chinese (繁體中文) with rank, name, score, review count, 百名店 badge, address, phone, reservation status, intro, and Tabelog URL for each restaurant.
