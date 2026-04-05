---
name: currency-converter
description: >
  Exchange rate lookup for Taiwan travelers. Use when the user asks about
  Mastercard or JCB exchange rates, currency conversion, or wants to know how
  much something costs in another currency. Triggers: 匯率、換算、多少日幣、
  多少港幣、多少台幣、TWD、JPY、HKD、USD、幾錢、折合、兌換、今天匯率、現在匯率、
  JCB、Mastercard、MC. Also use when the user mentions a price and wants to
  convert it (e.g. "3000 円換台幣多少", "500 HKD 是多少台幣").
---

# Currency Converter Skill

Two modes: **Mastercard** (default) and **JCB**.

---

## Mode 1: Mastercard rates (open.er-api + correction)

Fetch:
```bash
curl -s "https://open.er-api.com/v6/latest/TWD"
```

Returns `rates` as `1 TWD = X foreign`. Apply MC correction before showing:

```python
MC_CORRECTION = 1.00305  # MC charges ~0.305% above ECB (verified 2026-04-04)

# TWD → foreign
foreign = twd_amount * rates[FOREIGN] / MC_CORRECTION

# Foreign → TWD
twd = foreign_amount / rates[FOREIGN] * MC_CORRECTION
```

Output:
```
💱 匯率（2026-04-04，Mastercard 估算）

1 TWD ≈ 4.97 JPY

1,000 TWD ≈ 4,974 JPY
（已套用 Mastercard +0.305% 修正）
```

---

## Mode 2: JCB rates (official PDF)

```python
import re, urllib.request, fitz

req = urllib.request.Request(
    'https://www.specialoffers.jcb/zh-tw/services/other/rate/',
    headers={'User-Agent': 'Mozilla/5.0'}
)
html = urllib.request.urlopen(req).read().decode('utf-8')
pdfs = re.findall(r'href="(/zh-tw/services/[a-f0-9_]+\.pdf)"', html)
pdf_url = 'https://www.specialoffers.jcb' + pdfs[0]

pdf_data = urllib.request.urlopen(
    urllib.request.Request(pdf_url, headers={'User-Agent': 'Mozilla/5.0'})
).read()
doc = fitz.open(stream=pdf_data, filetype='pdf')
text = ''.join(page.get_text() for page in doc)
lines = [l.strip() for l in text.strip().split('\n') if l.strip()]

# Read currency order from header
header_start = next(i for i, l in enumerate(lines) if l == 'JCB Exchange Rate')
currencies, j = [], header_start + 1
while j < len(lines) and re.match(r'^[A-Z]{3}$', lines[j]):
    currencies.append(lines[j]); j += 1

# Find latest day with a full set of rates
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

rates = dict(zip(currencies, latest_rates))
# rates['JPY'] = X means: 1 JPY = X TWD (opposite of open.er-api)
```

Requires `pymupdf` (`pip install pymupdf`).

---

## Trigger mapping

| User says | Action |
|-----------|--------|
| "今天匯率" / 一般換算 | Mode 1 (Mastercard) |
| "JCB 匯率" / "JCB 多少" | Mode 2 (JCB PDF) |
| "JCB 還是 MC 划算" | Both modes, compare |
