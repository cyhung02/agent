---
name: yahoo-transit-search
description: Search train/bus routes on Yahoo Transit (transit.yahoo.co.jp). Use this skill whenever the user wants to find transit routes in Japan — searching by departure/arrival station, date/time, or direction type. Covers tasks like "新宿から渋谷まで行きたい", "東京から大阪 新幹線", "明日の朝9時に渋谷着くには", "終電を調べて", "乗換案内", "京都駅から金閣寺までバスで行きたい", "バスの乗り換え調べて". Also handles station disambiguation, bus stops, landmarks as destinations, and specifying arrival time vs departure time.
allowed-tools: Bash
---

# Yahoo 乗換案内 Skill

Search transit routes using `scripts/yahoo_transit_search.js`. The script handles all HTTP requests internally — no browser needed.

## Step 0 — Locate the Script

Before running any commands, use the **find-skill-script** skill to resolve the absolute path of `yahoo_transit_search.js` under the `scripts/` subdirectory.

Use the returned absolute path in all subsequent `node <yahoo_transit_search.js path>` commands instead of the relative `scripts/yahoo_transit_search.js`.

---

## Overview: Three-Mode Design

- **Mode 1 (suggest)**: Station/landmark autocomplete with codes.
- **Mode 2 (search)**: Route list — summaries with compact flow overview.
- **Mode 3 (detail)**: Full stop-by-stop detail for one specific route.

---

## Step 1 — Run Mode 1: Get Suggestions (always)

Always run suggest first for both `--from` and `--to` inputs, regardless of whether the input is a station name, landmark, or address.

```bash
node <yahoo_transit_search.js path> \
  --mode suggest \
  --station "新宿"
```

Returns JSON array:
```json
[
  { "name": "新宿", "yomi": "シンジュク", "code": "22741", "address": "東京" },
  { "name": "新宿(東京メトロ)", "yomi": "シンジュク", "code": "29342", "address": "東京" },
  ...
]
```

**Decision rules:**
- **Non-empty results** → pick the best match. Always use the `name` from the suggest result as `--from` / `--to` (not the original user input). If it has a `code`, also pass `--from-code` / `--to-code` to avoid disambiguation.
- **Empty array `[]`** → suggest does not recognise the input (e.g. a full address). Skip to Step 2 and pass the original input directly as `--from` / `--to`.

> Suggest results include both transit stops (with a numeric `code`) and landmarks/POI (with `code: ""`). Transit stops can be used with `--from-code` / `--to-code` for precise disambiguation. Landmarks with no code can be passed directly as `--from` / `--to` — Yahoo Transit will geocode them automatically.

---

## Step 2 — Run Mode 2: Search Routes

```bash
node <yahoo_transit_search.js path> \
  --mode search \
  --from "新宿" \
  --to "渋谷" \
  [--from-code 22741]          # optional: station code from suggest
  [--to-code 22715]            # optional
  [--date YYYY-MM-DD]          # default: today (Japan time, JST = UTC+9)
  [--time HH:MM]               # default: now (Japan time, JST = UTC+9)
  [--type dep|arr|first|last]  # dep=出発(default), arr=到着, first=始発, last=終電
  [--n 3]                      # number of routes to return (default: 3)
```

Returns a `uniqueId` plus a list of route summaries, each with a compact `flow`:
```json
{
  "uniqueId": "a3f9c2",
  "routes": [
    {
      "route": "1",
      "priority": ["早", "楽"],
      "departure": "16:56",
      "arrival": "17:00",
      "duration": "4分",
      "transfers": "乗換： 0回",
      "fare": "IC優先： 199円",
      "distance": "3.4km",
      "flow": ["新宿", "ＪＲ埼京線", "渋谷"]
    }
  ]
}
```

The full route data (with all stops) is automatically saved to `/tmp/yahoo_transit_{uniqueId}.json`.

**`flow` field:** Compact alternating array of station names and segment labels (walk duration or line name). Example for a multi-leg journey:
```json
["徒歩10分", "小岩", "ＪＲ総武線", "東京", "ＪＲ新幹線のぞみ", "新大阪", "阪神なんば線", "伝法"]
```

Present the route summaries to the user and ask which route they want details for. **Always retain the `uniqueId` from the search result — it is required for the detail step.**

---

## Step 3 — Run Mode 3: Route Detail

After the user selects a route, read the full stop-by-stop detail from the cached file. **No HTTP request is made.**

```bash
node <yahoo_transit_search.js path> \
  --mode detail \
  --id a3f9c2 \               # required: uniqueId from search result
  --route 1                   # required: route number from search results
```

Returns the summary fields plus full `stops` array:
```json
{
  "route": "1",
  "priority": ["早"],
  "departure": "16:56",
  "arrival": "17:00",
  "duration": "4分",
  "transfers": "乗換： 0回",
  "fare": "IC優先： 199円",
  "distance": "3.4km",
  "stops": [
    {
      "arrival": null,
      "departure": "16:56",
      "station": "新宿",
      "stationId": "22741",
      "segmentType": "train",
      "line": "ＪＲ埼京線",
      "direction": "新木場行",
      "platform": "[発] 1番線 → [着] 4番線",
      "segmentFare": "199円"
    },
    {
      "arrival": "17:00",
      "departure": null,
      "station": "渋谷",
      "stationId": "22715"
    }
  ]
}
```

**`stops` fields:**
- `arrival` / `departure`: times at this stop (null if not applicable)
- `segmentType`: `"train"` | `"walk"` | absent (last stop)
- `line`: train/subway line name (train only)
- `direction`: bound direction e.g. `"新木場行"` (train only)
- `platform`: `"[発] 1番線 → [着] 4番線"` (train only)
- `ridingPosition`: car position hint e.g. `"乗車位置：[6両] 前"` (if provided)
- `viaStops`: intermediate stops skipped e.g. `["明治神宮前"]` (if any)
- `walkDuration`: walk time e.g. `"徒歩10分"` (walk only)
- `segmentFare`: base 乗車券 fare starting from this stop e.g. `"3,410円"`. Covers from this stop up to (and including) the next stop that has a `segmentFare`, or the final destination if none follows.
- `expressFare`: express supplement (指定席/自由席/グリーン) starting from this stop e.g. `"指定席：4,080円"`. Only present when an express surcharge applies.
- `expressFareTo`: the last station covered by `expressFare` e.g. `"大阪"`. Present only when `expressFare` spans multiple stops.

---

## Type Values

| User intent              | `--type` |
|--------------------------|----------|
| 出発時刻指定（default）      | `dep`    |
| 到着時刻指定               | `arr`    |
| 始発                      | `first`  |
| 終電                      | `last`   |

---

## Critical Rules

> **All `--from` and `--to` values must be in Japanese.**
>
> The API only recognises Japanese station names. Always convert to Japanese before passing (e.g. `"渋谷"` not `"Shibuya"`).

> **Never fabricate route details or station codes.**
>
> All output must come directly from the script. Station codes are opaque numeric IDs.
