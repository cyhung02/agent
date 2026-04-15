---
name: agoda
description: Search for hotels on Agoda. Use this skill whenever the user wants to find hotels, check room availability, or compare room prices on Agoda — searching by hotel name, check-in/out dates, number of guests, or currency. Covers tasks like "幫我查 JR九州Blossom新宿的房價", "搜尋台北的飯店", "查 2026-06-01 入住兩晚的費用", "Agoda 上有哪些房型".
allowed-tools: Bash
---

# Agoda Hotel Search Skill

A single script `agoda.js` handles both hotel lookup and room prices. Mode is auto-detected from arguments.

## Step 0 — Locate the Script

Before running any commands, use the **find-skill-script** skill to resolve the absolute path of `agoda.js` under the `scripts/` subdirectory.

Use the returned absolute path in all subsequent `node` commands.

---

## Step 1 — Find the Hotel

```bash
node <agoda.js path> --name "JR九州Blossom新宿"
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

## Step 2 — Prerequisite: `playwright` npm package (headed browser)

The price lookup uses the **playwright** Node.js API and launches Chrome in headed mode (`headless: false`). Agoda actively blocks headless browsers.

If `playwright` is not installed, run:

```bash
npm install -g playwright
```

The script reads `HTTP_PROXY` / `http_proxy` from the environment for proxy settings and sets `chromiumSandbox: false` automatically.

---

## Step 3 — Get Room Prices

```bash
node <agoda.js path> \
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

The script automatically fetches prices from all configured partners (defined in the `PARTNERS` array in the script) in parallel and consolidates the results.

Returns JSON:
```json
{
  "propertyId": "621491",
  "hotelName": "新宿JR九州飯店 (JR Kyushu Hotel Blossom Shinjuku)",
  "searchCriteria": "2026-06-01 - 2026-06-02, 2人",
  "currency": "TWD",
  "bookingUrls": {
    "regular": "https://www.agoda.com/zh-tw/...&cid=-1",
    "jcb": "https://www.agoda.com/zh-tw/...&cid=1926014",
    "mctaishinbusiness": "https://www.agoda.com/zh-tw/...&cid=1897427"
  },
  "rooms": [
    {
      "name": "大床標準雙人間- 禁煙 (Standard Double Room with Queen Bed - Non-Smoking)",
      "size": "19平方公尺/205平方英尺",
      "beds": ["1張大床"],
      "offers": [
        {
          "benefits": ["免費Wi-Fi", "2026年5月27日 星期三前可免費取消。", "2026年5月25日 星期一前無須付款"],
          "prices": {
            "regular": 7829,
            "jcb": 7483,
            "mctaishinbusiness": 7672
          }
        }
      ]
    }
  ]
}
```

**Top-level fields:**
- `bookingUrls` — one booking URL per partner; use the partner key to look up the URL when presenting links to the user
- `rooms` — consolidated list of room types across all partners

**Room fields:**
- `size` — room size string (may be `null` if unavailable)
- `beds` — bed configuration(s) (e.g. `["1張大床"]`, `["2張單人床"]`); empty array if unavailable

**Offer fields:**
- `benefits` — amenities, free cancellation deadline (if applicable), and pay-later info
- `prices` — price per night (rounded, in `currency`) for each partner that has this offer; a partner key is absent if that partner does not offer this benefit combination

---

## Presenting Results

When presenting room prices to the user:

1. Show hotel name, search criteria (dates, guests, rooms).
2. For each room type, show: room name, bed type (`beds`), size (if available), and all offers.
3. For each offer, show: the benefits, then the price for each partner side by side.
4. For each partner, link its name to the corresponding URL in `bookingUrls` so the user can proceed to book.

---

## Critical Rules

> **Never fabricate hotel URLs, propertyIds, or prices.**
>
> All data must come directly from the script output. Do not guess or reconstruct URLs or property IDs from memory. The URLs in `bookingUrls` are constructed by the script from real API data — always use them as-is, never modify them.

> **If the hotel is not found in suggest results, say so clearly.**
>
> Do not attempt to pass an unverified ID to the price script. Always confirm the property via suggest first.
