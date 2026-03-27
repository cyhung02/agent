---
name: yahoo-transit-search
description: Search train/bus routes on Yahoo Transit (transit.yahoo.co.jp). Use this skill whenever the user wants to find transit routes in Japan — searching by departure/arrival station, date/time, or direction type. Covers tasks like "新宿から渋谷まで行きたい", "東京から大阪 新幹線", "明日の朝9時に渋谷着くには", "終電を調べて", "乗換案内". Also handles station disambiguation and specifying arrival time vs departure time.
allowed-tools: Bash
---

# Yahoo 乗換案内 Skill

Search transit routes using `scripts/yahoo_transit_search.js`. The script handles all HTTP requests internally — no browser needed.

## Overview: Two-Mode Design

- **Mode 1 (suggest)**: Fetches station name candidates with station codes.
- **Mode 2 (search)**: Searches routes and returns structured results.

The script is `scripts/yahoo_transit_search.js`

---

## Step 1 — Run Mode 1: Get Suggestions (always)

Always run suggest first for both `--from` and `--to` inputs, regardless of whether the input is a station name, landmark, or address.

```bash
node scripts/yahoo_transit_search.js \
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
- **Non-empty results** → pick the best match. If it has a `code`, use `--from-code` / `--to-code` in the search to avoid disambiguation. If `code` is `""` (POI/landmark), use the `name` directly as `--from` / `--to`.
- **Empty array `[]`** → suggest does not recognise the input (e.g. a full address). Skip to Step 2 and pass the original input directly as `--from` / `--to`.

---

## Step 2 — Run Mode 2: Search Routes

```bash
node scripts/yahoo_transit_search.js \
  --mode search \
  --from "新宿" \
  --to "渋谷" \
  [--from-code 22741]     # optional: use station code to avoid disambiguation
  [--to-code 22715]       # optional
  [--date YYYY-MM-DD]     # default: today
  [--time HH:MM]          # default: now
  [--type dep|arr|first|last]  # dep=出発(default), arr=到着, first=始発, last=終電
  [--n 3]                 # number of routes to return (default: 3)
```

Returns JSON:
```json
{
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
          "segmentFare": "199円",
          "expressFare": "指定席：4,080円",  // optional: only when express surcharge applies
          "expressFareTo": "大阪"             // optional: only when expressFare spans multiple stops
        },
        {
          "arrival": "17:00",
          "departure": null,
          "station": "渋谷",
          "stationId": "22715"
        }
      ]
    }
  ],
  "disambiguation": {            // present only when multiple stations matched
    "from": [
      { "code": "22741", "name": "新宿", "label": "新宿駅" },
      ...
    ]
  }
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
- `segmentFare`: base 乗車券 fare starting from this stop e.g. `"3,410円"`. Covers from this stop up to (and including) the next stop that has a `segmentFare`, or the final destination if none follows.
- `expressFare`: express supplement (指定席/自由席/グリーン) starting from this stop e.g. `"指定席：4,080円"`. Only present when an express surcharge applies.
- `expressFareTo`: the last station covered by `expressFare` e.g. `"大阪"`. Present only when `expressFare` spans multiple stops (i.e. the express section closes at a later station than it opened).

---

## Handling Disambiguation

If the search output contains a `"disambiguation"` key despite following the suggest-first workflow, inform the user of the candidates and ask which to use. Then re-run with the chosen `--from-code` / `--to-code`.

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
