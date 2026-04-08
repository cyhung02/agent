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

Use the **find-skill-script** skill to resolve the absolute path of
`currency_convert.py` under the `scripts/` subdirectory.

Run:
```bash
python <currency_convert.py path> <amount> <from_currency> <to_currency>
```

Display the script output as-is. Example output:
```
💱 523 JPY → TWD

105 TWD   Mastercard
105 TWD   JCB
```

Requires `pymupdf` (`pip install pymupdf`).
