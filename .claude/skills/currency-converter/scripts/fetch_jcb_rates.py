import re
import urllib.request
import fitz  # pip install pymupdf


def fetch_jcb_rates() -> dict[str, float]:
    """Fetch latest JCB exchange rates from the official PDF.

    Returns a dict where rates[currency] = TWD amount per 1 unit of foreign currency.
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

    return dict(zip(currencies, latest_rates))


if __name__ == '__main__':
    rates = fetch_jcb_rates()
    for currency, rate in rates.items():
        print(f'1 {currency} = {rate} TWD')
