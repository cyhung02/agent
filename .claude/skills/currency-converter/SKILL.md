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

Use the **find-skill-script** skill to resolve the absolute paths of both
`fetch_mc_rates.py` and `fetch_jcb_rates.py` under the `scripts/` subdirectory.

Run both scripts with `<amount> <from_currency> <to_currency>`:

```bash
python /path/to/fetch_mc_rates.py <amount> <from> <to>
python /path/to/fetch_jcb_rates.py <amount> <from> <to>
```

Each script outputs only the result, e.g. `247 TWD`.

Present both results to the user in this format (plain text, no markdown):

```
💱 1,230 JPY → TWD

Mastercard   247 TWD
JCB          246 TWD
```

Note: `fetch_jcb_rates.py` requires `pymupdf` (`pip install pymupdf`).
