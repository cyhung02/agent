---
name: tabelog-search
description: Search for restaurants on tabelog.com (食べログ), Japan's largest restaurant review platform. Use this skill whenever the user wants to find restaurants in Japan — searching by area, station, cuisine type, ranking, or any combination. Covers tasks like "find top ramen near Shinsaibashi", "show me the best sushi in Ginza", "search tabelog for izakaya in Kyoto". Also handles filtering by vegetarian menu, sorting by score or review count, and sending results via LINE or other channels after searching.
allowed-tools: Bash
---

# Tabelog Restaurant Search Skill

Search tabelog.com using the bundled `tabelog_search.js` script. The script handles all browser automation internally — no manual playwright steps needed.

## Overview: Two-Mode Design

Tabelog uses autocomplete to resolve area and keyword input into internal IDs. You cannot construct URLs manually or type free text and get reliable results. To handle this correctly, the workflow is split into two modes:

- **Mode 1 (suggest)**: Fetches autocomplete suggestions for area and keyword. You examine the results and decide which values to use.
- **Mode 2 (search)**: Executes the full search with your chosen values and returns restaurant details.

The script path is:
```
.claude/skills/tabelog-search/scripts/tabelog_search.js
```

---

## Step 1 — Run Mode 1: Get Suggestions

```bash
node .claude/skills/tabelog-search/scripts/tabelog_search.js \
  --mode suggest \
  --area "大阪" \
  --keyword "焼肉"   # omit if user didn't specify a cuisine/keyword
```

Returns JSON:
```json
{
  "area_suggestions": ["大阪市", "大阪駅", "西区(大阪市)", ...],
  "keyword_suggestions": ["焼肉・ホルモン", "焼肉", "焼肉 やまと", ...]
}
```

`keyword_suggestions` may be empty for genre-level terms like "ラーメン" — this is normal. Tabelog only autocompletes specific restaurant names, not all genre categories.

---

## Step 2 — Choose Area and Keyword

**Area (required):** Pick the entry that best matches the user's intent. Mode 2 requires an exact string from `area_suggestions` — do not modify it.

**Keyword (optional):** Apply this logic:
- If `keyword_suggestions` contains a **genre category** that matches the user's intent (e.g. `"焼肉・ホルモン"`, `"カフェ・喫茶店"`), use it as an exact match.
- If suggestions only contain **restaurant names**, skip the exact match and pass the user's raw keyword instead (Mode 2 will press Enter and search as free text).
- If `keyword_suggestions` is empty, pass the user's raw keyword as free text.
- If the user didn't specify a keyword, omit `--keyword` entirely.

---

## Step 3 — Run Mode 2: Full Search

```bash
node .claude/skills/tabelog-search/scripts/tabelog_search.js \
  --mode search \
  --area "大阪市" \
  --keyword "焼肉・ホルモン" \   # omit if no keyword
  --n 5 \                        # number of results (default: 5)
  --sort rt \                    # rt = score (default), rvcn = review count
  --vegetarian                   # add only if user requested vegetarian filter
```

**Sort values:**

| User request | `--sort` value |
|---|---|
| 評分排序（default） | `rt` |
| 評論數排序 | `rvcn` |

The script returns a JSON array. Each entry contains:
- `rank`, `name`, `score`, `reviews`, `url`
- `detail.awards` — full award history (e.g. `"2024 Gold"`, `"2023 百名店"`)
- `detail.intro` — restaurant PR text `{ title, body }` (null if none)
- `detail.店舗情報` — info table: address, phone, hours, budget, etc.
- `detail.口コミ` — top reviews `[{ title, text }]`

---

## Critical Rules

> **🚫 Never fabricate restaurant URLs or recommend restaurants not in the search results.**
>
> All URLs must come directly from the script output. Tabelog URLs use opaque numeric IDs that cannot be reconstructed from memory and may point to a different or closed business. If results don't include an obvious match for the user's request, report what was actually found and say so clearly.
