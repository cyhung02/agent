---
name: agoda
description: Search for hotels on Agoda. Use this skill whenever the user wants to find hotels, check room availability, or compare room prices on Agoda — searching by hotel name, check-in/out dates, number of guests, or currency. Covers tasks like "幫我查 JR九州Blossom新宿的房價", "搜尋台北的飯店", "查 2026-06-01 入住兩晚的費用", "Agoda 上有哪些房型".
allowed-tools: Bash
---

# Agoda Hotel Search Skill

Search Agoda using the bundled `agoda_search.js` script. The script handles all HTTP requests internally — no browser needed.

## Step 0 — Locate the Script

Before running any commands, use the **find-skill-script** skill to resolve the absolute path of `agoda_search.js` under the `scripts/` subdirectory.

Use the returned absolute path in all subsequent `node <agoda_search.js path>` commands instead of the relative `scripts/agoda_search.js`.

---

## Overview: Two-Mode Design

- **Mode 1 (suggest)**: Searches hotel candidates by name and returns `propertyId` values needed for price queries.
- **Mode 2 (price)**: Fetches room prices for a specific property given check-in/out dates and guest count.

---

## Step 1 — Run Mode 1: Get Hotel Candidates

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

---

## Step 2 — Choose the Correct Property

Examine the `candidates` list and pick the entry that best matches the user's intent. Note the `propertyId` — it is required for the price query.

If multiple candidates are returned, prefer the one whose `name` and `city` best match what the user described. If genuinely ambiguous, present the top candidates and ask the user to confirm.

---

## Step 3 — Run Mode 2: Get Room Prices

```bash
node <agoda_search.js path> \
  --mode price \
  --id 621491 \
  --checkin 2026-06-01 \
  --checkout 2026-06-02 \
  --adults 2 \
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

All offers for each room type are returned (no limit).

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
  "hotelName": "JR Kyushu Blossom Shinjuku",
  "searchCriteria": "6月1日 - 6月2日, 2人",
  "isSoldOut": false,
  "currency": "TWD",
  "bookingUrl": "https://www.agoda.com/zh-tw/jr-kyushu-hotel-blossom-shinjuku/hotel/tokyo-jp.html?checkIn=2026-06-01&los=1&adults=2&children=0&rooms=1&currencyCode=TWD",
  "rooms": [
    {
      "name": "Standard Double Room",
      "isSoldOut": false,
      "size": "22平方公尺/237平方英尺",
      "beds": ["1張大床"],
      "offers": [
        {
          "price": {
            "amount": 4500
          },
          "benefits": ["2026年5月25日前可免費取消", "附早餐"]
        }
      ]
    }
  ]
}
```

**Room fields:**
- `size` — room size string from Agoda (may be `null` if unavailable)
- `beds` — bed type(s) from Agoda (e.g. `["1張大床"]`, `["2張單人床"]`); empty array if unavailable

**Price fields:**
- `price.amount` — inclusive price (taxes included) per night, rounded; currency is indicated by the top-level `currency` field

---

## Presenting Results

When presenting room prices to the user:

1. Show hotel name, search criteria (dates, guests, rooms).
2. For each room type, show: room name, bed type (`beds`), size (if available), and all offers.
3. For each offer, show: inclusive price (`price.amount` + top-level `currency`), and key benefits.
4. If `isSoldOut` is `true` at the hotel level, inform the user the property is fully booked.
5. If a specific room `isSoldOut` is `true`, note it is unavailable.
6. Always show the `bookingUrl` as a clickable link so the user can proceed to book on Agoda.

---

## Critical Rules

> **Never fabricate hotel URLs, propertyIds, or prices.**
>
> All data must come directly from the script output. Do not guess or reconstruct URLs or property IDs from memory. The `bookingUrl` in the price result is constructed by the script from real API data — always use it as-is, never modify it.

> **If the hotel is not found in suggest results, say so clearly.**
>
> Do not attempt to pass an unverified ID to the price mode. Always confirm the property via suggest first.
