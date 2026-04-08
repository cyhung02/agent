import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pymupdf  # pip install pymupdf

MC_CORRECTION = 1.00305  # MC charges ~0.305% above ECB


def fmt(value):
    return f"{value:,.0f}" if value >= 10 else f"{value:,.2f}"


def fetch_mc(amount, from_cur, to_cur):
    req = urllib.request.Request(
        'https://open.er-api.com/v6/latest/TWD',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    data = json.loads(urllib.request.urlopen(req).read())
    rates = {c: r / MC_CORRECTION for c, r in data['rates'].items()}

    try:
        if from_cur == 'TWD':
            result = amount * rates[to_cur]
        elif to_cur == 'TWD':
            result = amount / rates[from_cur]
        else:
            result = amount / rates[from_cur] * rates[to_cur]
    except KeyError:
        return None

    return fmt(result)


def fetch_jcb(amount, from_cur, to_cur):
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
    doc = pymupdf.open(stream=pdf_data, filetype='pdf')
    text = ''.join(page.get_text() for page in doc)
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]

    header_start = next(i for i, l in enumerate(lines) if l == 'JCB Exchange Rate')
    currencies, j = [], header_start + 1
    while j < len(lines) and re.match(r'^[A-Z]{3}$', lines[j]):
        currencies.append(lines[j])
        j += 1

    latest_day, latest_rates = None, None
    for i, line in enumerate(lines):
        m = re.match(r'^(\d+)日$', line)
        if m:
            values, k = [], i + 1
            while len(values) < len(currencies) and k < len(lines):
                try:
                    values.append(float(lines[k]))
                except ValueError:
                    break
                k += 1
            if len(values) == len(currencies):
                latest_day, latest_rates = int(m.group(1)), values

    rates = dict(zip(currencies, latest_rates))

    try:
        if from_cur == 'TWD':
            result = amount / rates[to_cur]
        elif to_cur == 'TWD':
            result = amount * rates[from_cur]
        else:
            result = amount * rates[from_cur] / rates[to_cur]
    except KeyError:
        return None

    return fmt(result)


def main():
    if len(sys.argv) != 4:
        print("Usage: currency_convert.py <amount> <from_currency> <to_currency>")
        print("Example: currency_convert.py 523 JPY TWD")
        sys.exit(1)

    amount = float(sys.argv[1])
    from_cur = sys.argv[2].upper()
    to_cur = sys.argv[3].upper()

    with ThreadPoolExecutor(max_workers=2) as executor:
        mc_future = executor.submit(fetch_mc, amount, from_cur, to_cur)
        jcb_future = executor.submit(fetch_jcb, amount, from_cur, to_cur)
        mc_result = mc_future.result()
        jcb_result = jcb_future.result()

    rows = []
    if mc_result is not None:
        rows.append((f"{mc_result} {to_cur}", "Mastercard"))
    if jcb_result is not None:
        rows.append((f"{jcb_result} {to_cur}", "JCB"))

    if not rows:
        print(f"不支援的幣別：{from_cur} 或 {to_cur}")
        sys.exit(1)

    width = max(len(r[0]) for r in rows)
    print(f"💱 {fmt(amount)} {from_cur} → {to_cur}")
    print()
    for amount_str, org in rows:
        print(f"{amount_str:<{width}}|{org}")


if __name__ == '__main__':
    main()
