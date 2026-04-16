---
name: agoda
description: Search for hotels on Agoda. Use this skill whenever the user wants to find hotels, check room availability, or compare room prices on Agoda — searching by hotel name, check-in/out dates, number of guests, or currency. Covers tasks like "幫我查 JR九州Blossom新宿的房價", "搜尋台北的飯店", "查 2026-06-01 入住兩晚的費用", "Agoda 上有哪些房型".
allowed-tools: Bash
---

# Agoda Hotel Search Skill

A single script `agoda.js` handles both hotel lookup and room prices. Mode is auto-detected from arguments.

## Step 0 — Install Dependencies (first run only)

Use the **find-skill-script** skill to resolve the absolute path of `install-agoda.sh` under the `scripts/` subdirectory.

Then check if `node_modules` already exists in the skill root (one level above `scripts/`). If not, run the install script:

```bash
bash <install-agoda.sh path>
```

This installs the `playwright` Node.js API package locally under the skill directory. It is safe to skip if `node_modules` is already present.

---

## Step 1 — Locate the Script

Use the **find-skill-script** skill to resolve the absolute path of `agoda.js` under the `scripts/` subdirectory.

Use the returned absolute path in all subsequent `node` commands.

---

## Step 2 — Find the Hotel

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

## Step 3 — Prerequisite: `playwright` npm package (headed browser)

The price lookup uses the **playwright** Node.js API and launches Chrome in headed mode (`headless: false`). Agoda actively blocks headless browsers.

If `playwright` is not installed, run:

```bash
npm install -g playwright
```

The script reads `HTTP_PROXY` / `http_proxy` from the environment for proxy settings and sets `chromiumSandbox: false` automatically.

### No X Server (headless Linux environments)

On **Linux/macOS**, the script requires `$DISPLAY` to be set. On environments without a display server, use `xvfb-run` to provide a virtual display:

```bash
xvfb-run -a node <agoda.js path> --id 621491 --checkin 2026-06-01 --checkout 2026-06-02
```

To check whether you need this:

```bash
[ -z "$DISPLAY" ] && echo "no X Server — use xvfb-run -a" || echo "X Server present"
```

On **Windows**, `$DISPLAY` is not required — Playwright uses native rendering directly.

---

## Step 4 — Get Room Prices

The script fetches prices from all configured partners in parallel and returns JSON with this structure:

```bash
node <agoda.js path> \
  --id 621491 \
  --checkin 2026-06-01 \
  --checkout 2026-06-02 \
  [--adults 2] \
  [--children 0] \
  [--rooms 1] \
  [--currency TWD] \
  [--all_offers]
```

```json
{
  "propertyId": "621491",
  "hotelName": "新宿JR九州飯店 (JR Kyushu Hotel Blossom Shinjuku)",
  "searchCriteria": "2026-06-01 - 2026-06-02, 2人",
  "currency": "TWD",
  "bookingUrls": {
    "Regular": "https://www.agoda.com/zh-tw/...&cid=-1",
    "JCB": "https://www.agoda.com/zh-tw/...&cid=1926014",
    "台新Mastercard": "https://www.agoda.com/zh-tw/...&cid=1897427",
    "Google Maps": "https://www.agoda.com/zh-tw/...&cid=1917614"
  },
  "rooms": [
    {
      "name": "大床標準雙人間- 禁煙 (Standard Double Room with Queen Bed - Non-Smoking)",
      "size": "19平方公尺/205平方英尺",
      "beds": ["1張大床"],
      "offers": [
        {
          "benefits": ["免費Wi-Fi", "2026年5月21日 星期四前可免費取消", "可延至2026年5月19日 星期二扣款"],
          "prices": { "JCB": 6811 }
        },
        {
          "benefits": ["早餐", "免費Wi-Fi"],
          "prices": { "JCB": 8792 }
        }
      ]
    }
  ]
}
```

- `bookingUrls` — one booking URL per partner; use the partner key to look up the URL when presenting links to the user
- `rooms` — sorted by size ascending; rooms with unknown size appear last
- `size` — room size string (may be `null` if unavailable)
- `beds` — bed configuration(s) (e.g. `["1張大床"]`, `["2張單人床"]`); empty array if unavailable
- `offers` — each entry has `benefits` (amenities, cancellation deadline, pay-later info) and `prices` (partner → price)

### Parameters

| Flag | Default | Description |
|---|---|---|
| `--id` | (required) | `propertyId` from suggest result |
| `--checkin` | (required) | Check-in date `YYYY-MM-DD` |
| `--checkout` | (required) | Check-out date `YYYY-MM-DD` |
| `--adults` | `2` | Number of adults |
| `--children` | `0` | Number of children |
| `--rooms` | `1` | Number of rooms |
| `--currency` | `TWD` | Currency code (see table below) |
| `--all_offers` | off | Show every distinct offer with prices for all partners that carry it |

### Supported currencies

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

**Common fields (both modes):**
- `bookingUrls` — one booking URL per partner; use the partner key to look up the URL when presenting links to the user
- `rooms` — sorted by size ascending; rooms with unknown size appear last
- `size` — room size string (may be `null` if unavailable)
- `beds` — bed configuration(s) (e.g. `["1張大床"]`, `["2張單人床"]`); empty array if unavailable
- `benefits` — amenities, free cancellation deadline (if applicable), and pay-later info

---

## Presenting Results

### Step 1 — Header
Show hotel name, currency, and search criteria (dates, guests, rooms).

### Step 2 — Booking Links

Render a table with one row per partner. Only include partners present in `bookingUrls`.

| 通路 | 連結 |
|---|---|
| Regular | [Regular](<bookingUrls.Regular>) |
| JCB | [JCB](<bookingUrls.JCB>) |
| 台新Mastercard | [台新Mastercard](<bookingUrls.台新Mastercard>) |
| Google Maps | [Google Maps](<bookingUrls.Google Maps>) |

### Step 3 — Detailed breakdown

List full offer details for every room. Booking links are already in Step 2 — use plain partner names only throughout.

1. **List every room in the `rooms` array — do not omit any.**
2. For each room, render a heading and a table of all offers.
3. For each offer, emit one row **per partner key present in `prices`**. If a partner key is absent, omit it — do not show a dash or placeholder.
4. Format prices with thousands separator (e.g. `6,811`); omit currency symbol (shown in header).
5. The 方案 column is the offer's `benefits` joined with `、`.

#### {房型名稱}（{大小 or —} / {beds joined, or —}）

| 價格 | 通路 | 方案 |
|---|---|---|
| 6,811 | JCB | 免費Wi-Fi、2026年5月21日前可免費取消 |
| 8,792 | JCB | 早餐、免費Wi-Fi |

---

## Critical Rules

> **Never fabricate hotel URLs, propertyIds, or prices.**
>
> All data must come directly from the script output. Do not guess or reconstruct URLs or property IDs from memory. The URLs in `bookingUrls` are constructed by the script from real API data — always use them as-is, never modify them.

> **If the hotel is not found in suggest results, say so clearly.**
>
> Do not attempt to pass an unverified ID to the price script. Always confirm the property via suggest first.
