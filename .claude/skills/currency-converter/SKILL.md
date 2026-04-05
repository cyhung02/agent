---
name: currency-converter
description: >
  Real-time exchange rate lookup and conversion tool for Taiwan travelers. Use
  this skill whenever the user asks about exchange rates, currency conversion,
  or wants to know how much something costs in another currency. Triggers
  include: 匯率、換算、多少日幣、多少港幣、多少台幣、TWD、JPY、HKD、USD、幾錢、
  折合、兌換、今天匯率、現在匯率. Also use when the user mentions a price and
  wants to convert it (e.g. "3000 円換台幣多少", "500 HKD 是多少台幣").
---

# Currency Converter Skill

Real-time exchange rate conversion. Primary source: open.er-api.com (daily
updates, free, TWD supported). Secondary source: JCB official daily PDF.

---

## Supported Currencies

|Code|Name            |
|----|----------------|
|TWD |Taiwan Dollar   |
|JPY |Japanese Yen    |
|HKD |Hong Kong Dollar|
|USD |US Dollar       |
|EUR |Euro            |
|KRW |Korean Won      |
|CNY |Chinese Yuan    |
|GBP |British Pound   |
|SGD |Singapore Dollar|
|THB |Thai Baht       |

---

## Data Sources

|Source         |Usage                                |Currencies                         |
|---------------|-------------------------------------|-----------------------------------|
|open.er-api.com|Default (ECB + Mastercard correction)|All major currencies               |
|JCB PDF        |JCB official daily rates             |JPY/KRW/USD/CNY/THB/VND/HKD/EUR/PHP|

---

## Fetching Rates

### Source A: open.er-api (default, with Mastercard correction)

```bash
curl -s "https://open.er-api.com/v6/latest/{FROM_CURRENCY}"
```

Response format:

```json
{
  "result": "success",
  "base_code": "TWD",
  "time_last_update_utc": "...",
  "rates": {
    "JPY": 4.989628,
    "HKD": 0.245069,
    "USD": 0.031212
  }
}
```

### Source B: JCB official rates (parsed from PDF)

```python
import re, urllib.request, fitz

# Step 1: Fetch the rate page and extract the latest PDF URL
req = urllib.request.Request(
    'https://www.specialoffers.jcb/zh-tw/services/other/rate/',
    headers={'User-Agent': 'Mozilla/5.0'}
)
html = urllib.request.urlopen(req).read().decode('utf-8')
pdfs = re.findall(r'href="(/zh-tw/services/[a-f0-9_]+\.pdf)"', html)
pdf_url = 'https://www.specialoffers.jcb' + pdfs[0]  # first = latest month

# Step 2: Download PDF and extract text
pdf_data = urllib.request.urlopen(
    urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
).read()
doc = fitz.open(stream=pdf_data, filetype='pdf')
text = ''.join(page.get_text() for page in doc)
lines = [l.strip() for l in text.strip().split('\n') if l.strip()]

# Step 3: Dynamically read currency order from the header row
# After 'JCB Exchange Rate', consecutive 3-letter uppercase codes are currency codes
header_start = next(i for i, l in enumerate(lines) if l == 'JCB Exchange Rate')
currencies = []
j = header_start + 1
while j < len(lines) and re.match(r'^[A-Z]{3}$', lines[j]):
    currencies.append(lines[j])
    j += 1

# Step 4: Find the latest day that has a full set of rate values
latest_day, latest_rates = None, None
for i, line in enumerate(lines):
    m = re.match(r'^(\d+)日$', line)
    if m:
        values, k = [], i + 1
        while len(values) < len(currencies) and k < len(lines):
            try: values.append(float(lines[k]))
            except: break
            k += 1
        if len(values) == len(currencies):
            latest_day, latest_rates = int(m.group(1)), values

# Build rates dict — e.g. rates['JPY'] = 0.2007399
rates = dict(zip(currencies, latest_rates))
```

**Important — JCB rate direction**: JCB PDF expresses rates as `1 foreign = X TWD`,
which is the **opposite** of open.er-api (`1 TWD = X foreign`). Apply conversions accordingly.

---

## Conversion Logic

```python
# Mastercard correction factor
# MC charges ~0.305% above ECB rates (verified 2026-04-04:
# MC: 1 JPY = 0.2010296 TWD vs ECB: 0.2004157 TWD → +0.305%)
MC_CORRECTION = 1.00305

# TWD → foreign (e.g. how many JPY can 1000 TWD buy with MC?)
foreign = twd_amount * ecb_rate_per_twd / MC_CORRECTION

# Foreign → TWD (e.g. how much TWD does 3000 JPY cost on MC?)
twd = foreign_amount / ecb_rate_per_twd * MC_CORRECTION

# JCB: rates are already 1 foreign = X TWD, no correction needed
twd = foreign_amount * jcb_rates['JPY']
```

---

## Output Formats

### Single conversion

```
💱 Exchange Rate (updated 2026-04-04, Mastercard estimate)

1 TWD ≈ 4.97 JPY

1,000 TWD ≈ 4,974 JPY
(Mastercard +0.305% correction applied)
```

### Travel rate overview (when user asks for "today's rates")

```
💱 Today's Rates (base: TWD, updated 2026-04-04)
📌 Mastercard estimate (ECB + 0.305% correction)

🇯🇵 1 TWD ≈ 4.97 JPY
🇭🇰 1 TWD ≈ 0.244 HKD
🇺🇸 1 TWD ≈ 0.0311 USD
🇪🇺 1 TWD ≈ 0.0270 EUR

📌 Common conversions:
  1,000 TWD ≈ 4,974 JPY
  5,000 TWD ≈ 24,869 JPY
  10,000 TWD ≈ 49,738 JPY
```

## Common Query Patterns

|User input            |Action                                        |
|----------------------|----------------------------------------------|
|"1000 台幣換多少日幣"        |open.er-api + MC correction, TWD → JPY        |
|"3000 円是多少台幣"         |open.er-api + MC correction, JPY → TWD        |
|"今天匯率"                |open.er-api, show travel rate overview        |
|"500 HKD 多少台幣"        |open.er-api + MC correction, HKD → TWD        |
|"JCB 匯率" / "今天 JCB 多少"|Parse JCB PDF, show latest day rates          |
|"JCB 還是 MC 比較划算"      |Fetch both sources, compare JPY rate for today|

---

## Notes

- Rates update once daily (not real-time); suitable for travel reference
- Always display the update date so users know data freshness
- Number formatting: thousands separator, JPY rounded to integer, others to 2–4 decimal places
- **Mastercard correction factor 0.305%**: verified on 2026-04-04 (MC: 0.2010296 vs ECB: 0.2004157). May drift slightly over time but typically stable within 0.2–0.4%
- JCB rates require `pymupdf` (`pip install pymupdf`)
