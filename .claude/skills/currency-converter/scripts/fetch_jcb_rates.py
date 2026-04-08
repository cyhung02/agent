import re
import sys
import urllib.request
import fitz  # pip install pymupdf


def fmt(value):
    return f"{value:,.0f}" if value >= 10 else f"{value:,.2f}"


def fetch_jcb_rates() -> tuple[str, dict[str, float]]:
    """Fetch latest JCB exchange rates from the official PDF.

    Returns (date_str, rates) where rates[currency] = TWD per 1 unit of foreign.
    e.g. rates['JPY'] = 0.2007 means 1 JPY = 0.2007 TWD
    """
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
        currencies.append(lines[j])
        j += 1

    # Find latest day with a full set of rates
    # Also extract the month/year from the PDF title for date construction
    date_str = ''
    month_match = re.search(r'(\d{4})年(\d{1,2})月', text)

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

    if month_match and latest_day:
        date_str = f"{month_match.group(1)}-{int(month_match.group(2)):02d}-{latest_day:02d}"

    return date_str, dict(zip(currencies, latest_rates))


def main():
    if len(sys.argv) != 4:
        print("Usage: fetch_jcb_rates.py <amount> <from_currency> <to_currency>")
        print("Example: fetch_jcb_rates.py 3000 JPY TWD")
        sys.exit(1)

    amount = float(sys.argv[1])
    from_cur = sys.argv[2].upper()
    to_cur = sys.argv[3].upper()

    date, rates = fetch_jcb_rates()

    if from_cur == 'TWD':
        result = amount / rates[to_cur]
    elif to_cur == 'TWD':
        result = amount * rates[from_cur]
    else:
        result = amount * rates[from_cur] / rates[to_cur]

    print(f"{fmt(result)} {to_cur}")


if __name__ == '__main__':
    main()
