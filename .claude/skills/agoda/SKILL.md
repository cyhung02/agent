---
name: agoda
description: Search for hotels on Agoda. Use this skill whenever the user wants to find hotels, check room availability, or compare room prices on Agoda — searching by hotel name, check-in/out dates, number of guests, or currency. Covers tasks like "幫我查 JR九州Blossom新宿的房價", "搜尋台北的飯店", "查 2026-06-01 入住兩晚的費用", "Agoda 上有哪些房型".
allowed-tools: Bash
---

# Agoda Hotel Search Skill

Two scripts work together: `agoda_search.js` (hotel lookup) and `agoda_price.js` (room prices via headed browser).

## Step 0 — Locate the Scripts

Before running any commands, use the **find-skill-script** skill to resolve the absolute paths of both scripts under the `scripts/` subdirectory:

- `agoda_search.js`
- `agoda_price.js`

Use the returned absolute paths in all subsequent `node` commands.

---

## Step 1 — Find the Hotel: `agoda_search.js`

```bash
node <agoda_search.js path> \
  --mode suggest \
  --name "JR九州Blossom新宿"
```

Returns JSON:
```json
{
  "candidates": [
    {
      "propertyId": 621491,
      "name": "JR Kyushu Blossom Shinjuku",
      "city": "Tokyo",
      "country": "Japan"
    }
  ]
}
```

Pick the candidate whose `name` and `city` best match the user's intent. Note the `propertyId`.

If genuinely ambiguous, present the top candidates and ask the user to confirm.

---

## Step 2 — Prerequisite: `playwright-cli` (headed browser)

`agoda_price.js` requires `playwright-cli` and launches the browser in **headed mode** (passes `--headed` to `playwright-cli open`). Agoda actively blocks headless browsers.

If `playwright-cli` is not installed or not working, follow the **playwright-cli** skill to set it up. The script will also exit with a clear error if `playwright-cli` is missing.

---

## Step 3 — Get Room Prices: `agoda_price.js`

```bash
node <agoda_price.js path> \
  --id 621491 \
  --checkin 2026-06-01 \
  --checkout 2026-06-02 \
  --adults 2 \
  [--children 0] \
  [--rooms 1] \
  [--currency TWD]
```

**Parameters:**

| Flag | Default | Description |
|---|---|---|
| `--id` | (required) | `propertyId` from suggest result |
| `--checkin` | (required) | Check-in date `YYYY-MM-DD` |
| `--checkout` | (required) | Check-out date `YYYY-MM-DD` |
| `--adults` | `2` | Number of adults |
| `--children` | `0` | Number of children |
| `--rooms` | `1` | Number of rooms |
| `--currency` | `TWD` | Currency code (see table below) |

**Supported currencies:**

| Code | Currency |
|---|---|
| `TWD` | 新台幣 (default) |
| `USD` | 美元 |
| `JPY` | 日圓 |
| `HKD` | 港幣 |
| `EUR` | 歐元 |
| `SGD` | 新加坡幣 |
| `KRW` | 韓圓 |
| `AUD` | 澳幣 |
| `GBP` | 英鎊 |

Returns JSON:
```json
{
  "propertyId": "621491",
  "hotelName": "新宿JR九州飯店 (JR Kyushu Hotel Blossom Shinjuku)",
  "searchCriteria": "2026-06-01 - 2026-06-02, 2人",
  "isSoldOut": false,
  "currency": "TWD",
  "bookingUrl": "https://www.agoda.com/zh-tw/jr-kyushu-hotel-blossom-shinjuku/hotel/tokyo-jp.html?checkIn=2026-06-01&los=1&adults=2&children=0&rooms=1&currencyCode=TWD",
  "rooms": [
    {
      "name": "大床標準雙人間- 禁煙 (Standard Double Room with Queen Bed - Non-Smoking)",
      "isSoldOut": false,
      "size": "19平方公尺/205平方英尺",
      "beds": ["1張大床"],
      "offers": [
        {
          "price": { "amount": 5955 },
          "benefits": ["免費Wi-Fi", "2026年5月27日 星期三前可免費取消。", "2026年5月25日 星期一前無須付款"]
        }
      ]
    }
  ]
}
```

**Room fields:**
- `size` — room size string (may be `null` if unavailable)
- `beds` — bed configuration(s) (e.g. `["1張大床"]`, `["2張單人床"]`); empty array if unavailable

**Offer fields:**
- `price.amount` — display price per night, rounded; currency indicated by top-level `currency` field
- `benefits` — available amenities, free cancellation deadline (if applicable), and pay-later info

---

## Presenting Results

When presenting room prices to the user:

1. Show hotel name, search criteria (dates, guests, rooms).
2. For each room type, show: room name, bed type (`beds`), size (if available), and all offers.
3. For each offer, show: price (`price.amount` + top-level `currency`), and key benefits.
4. If `isSoldOut` is `true` at the hotel level, inform the user the property is fully booked.
5. If a specific room `isSoldOut` is `true`, note it is unavailable.
6. If `bookingUrl` is present (non-null), show it as a clickable link so the user can proceed to book on Agoda.

---

## Critical Rules

> **Never fabricate hotel URLs, propertyIds, or prices.**
>
> All data must come directly from the script output. Do not guess or reconstruct URLs or property IDs from memory. The `bookingUrl` in the price result is constructed by the script from real API data — always use it as-is, never modify it.

> **If the hotel is not found in suggest results, say so clearly.**
>
> Do not attempt to pass an unverified ID to the price script. Always confirm the property via `agoda_search.js` suggest first.
