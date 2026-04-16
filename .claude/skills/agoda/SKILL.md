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

The script fetches prices from all configured partners in parallel and consolidates the results. Two output modes are available:

### Default mode — 4 best-price slots per room

```bash
node <agoda.js path> \
  --id 621491 \
  --checkin 2026-06-01 \
  --checkout 2026-06-02 \
  [--adults 2] \
  [--children 0] \
  [--rooms 1] \
  [--currency TWD]
```

Each room's `bestOffers` contains the cheapest offer across all partners for each of the 4 categories:

| Key | 說明 |
|---|---|
| `noMeal_nonCancellable` | 不含餐，不可取消 |
| `noMeal_cancellable` | 不含餐，可取消 |
| `withMeal_nonCancellable` | 含餐，不可取消 |
| `withMeal_cancellable` | 含餐，可取消 |

A slot is `null` when no matching offer exists for that room.

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
    "mctaishinbusiness": "https://www.agoda.com/zh-tw/...&cid=1897427",
    "google": "https://www.agoda.com/zh-tw/...&cid=1917614"
  },
  "rooms": [
    {
      "name": "大床標準雙人間- 禁煙 (Standard Double Room with Queen Bed - Non-Smoking)",
      "size": "19平方公尺/205平方英尺",
      "beds": ["1張大床"],
      "bestOffers": {
        "noMeal_nonCancellable":   { "price": 7499, "partner": "jcb", "benefits": ["免費Wi-Fi"] },
        "noMeal_cancellable":      { "price": 6811, "partner": "jcb", "benefits": ["免費Wi-Fi", "2026年5月21日 星期四前可免費取消", "可延至2026年5月19日 星期二扣款"] },
        "withMeal_nonCancellable": { "price": 8792, "partner": "jcb", "benefits": ["早餐", "免費Wi-Fi"] },
        "withMeal_cancellable":    { "price": 8328, "partner": "jcb", "benefits": ["早餐", "免費Wi-Fi", "2026年5月21日 星期四前可免費取消", "可延至2026年5月19日 星期二扣款"] }
      }
    }
  ]
}
```

### `--all_offers` mode — all offers with per-partner prices

```bash
node <agoda.js path> \
  --id 621491 \
  --checkin 2026-06-01 \
  --checkout 2026-06-02 \
  [--adults 2] \
  [--children 0] \
  [--rooms 1] \
  [--currency TWD] \
  --all_offers
```

Each room's `offers` lists every distinct benefit combination, with prices for every partner that carries it. Semantically identical benefits phrased differently across partners are merged into the same offer row.

Returns JSON:
```json
{
  "propertyId": "621491",
  "hotelName": "新宿JR九州飯店 (JR Kyushu Hotel Blossom Shinjuku)",
  "searchCriteria": "2026-06-01 - 2026-06-02, 2人",
  "currency": "TWD",
  "bookingUrls": { ... },
  "rooms": [
    {
      "name": "大床標準雙人間- 禁煙 (Standard Double Room with Queen Bed - Non-Smoking)",
      "size": "19平方公尺/205平方英尺",
      "beds": ["1張大床"],
      "offers": [
        {
          "benefits": ["免費Wi-Fi", "2026年5月21日 星期四前可免費取消。", "2026年5月19日 星期二前無須付款"],
          "prices": { "regular": 7235, "jcb": 6811, "mctaishinbusiness": 6936, "google": 7413 }
        },
        {
          "benefits": ["免費Wi-Fi"],
          "prices": { "regular": 7880, "jcb": 7499, "mctaishinbusiness": 7637 }
        }
      ]
    }
  ]
}
```

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
| `--all_offers` | off | Show all offers with per-partner prices instead of 4 best-price slots |

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
Show hotel name and search criteria (dates, guests, rooms).

### Step 2 — Booking Links (one-time reference)

List each partner and its booking URL **once**, as a short reference block. All subsequent sections use plain partner names only — never repeat the URLs.

```
regular: <bookingUrls.regular>
jcb: <bookingUrls.jcb>
mctaishinbusiness: <bookingUrls.mctaishinbusiness>
google: <bookingUrls.google>
```

Only include partners present in `bookingUrls`.

### Step 3 — Summary table (default mode)

Render a one-row-per-room overview. Rooms are already sorted by size ascending in the JSON.

| 房型 | 大小 | 床型 | 不含餐不可取消 | 不含餐可取消 | 含餐不可取消 | 含餐可取消 |
|---|---|---|---|---|---|---|
| {name} | {size or —} | {beds joined, or —} | {slot or —} | {slot or —} | {slot or —} | {slot or —} |

**Slot cell rules:**
- If the slot is `null`, show `—`
- Otherwise: `partner TWD X,XXX` followed by the key benefit strings (cancellation deadline, pay-later deadline) from `benefits`, each on its own line
- Use plain partner names — booking links are already listed in Step 2

### Step 3 — Summary table (`--all_offers` mode)

Render a one-row-per-room overview showing the cheapest offer across all partners and all offers.

| 房型 | 大小 | 床型 | 最低價 (partner) |
|---|---|---|---|
| {name} | {size or —} | {beds joined, or —} | cheapest price among all offers and partners, with plain partner name |

### Step 4 — Detailed breakdown

After the summary, list full offer details for every room. Use plain partner names throughout — booking links are already in Step 2.

**Default mode:**
For each room, show each non-null slot in `bestOffers` with its price, plain partner name, and `benefits`.

**`--all_offers` mode:**
1. **List every room in the `rooms` array — do not omit any.**
2. For each room, **list every offer in its `offers` array** — do not skip.
3. For each offer, show the `benefits` and the price for **every partner key present in `prices`**. Use plain partner names. If a partner key is absent from `prices`, omit it — do not show a dash or placeholder.

---

## Critical Rules

> **Never fabricate hotel URLs, propertyIds, or prices.**
>
> All data must come directly from the script output. Do not guess or reconstruct URLs or property IDs from memory. The URLs in `bookingUrls` are constructed by the script from real API data — always use them as-is, never modify them.

> **If the hotel is not found in suggest results, say so clearly.**
>
> Do not attempt to pass an unverified ID to the price script. Always confirm the property via suggest first.
