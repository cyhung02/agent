import json
import urllib.request


MC_CORRECTION = 1.00305  # MC charges ~0.305% above ECB


def fetch_mc_rates() -> dict:
    """Fetch Mastercard exchange rates from open.er-api.com with MC correction applied.

    Returns a dict with:
      - 'date': rate date string (e.g. '2026-04-04')
      - 'rates': dict where rates[currency] = units of foreign per 1 TWD (MC-corrected)

    E.g. rates['JPY'] = 4.97 means 1 TWD ≈ 4.97 JPY after MC correction.

    Conversion formulas:
      TWD → foreign: foreign = twd_amount * rates[currency]
      Foreign → TWD: twd = foreign_amount / rates[currency]
    """
    req = urllib.request.Request(
        'https://open.er-api.com/v6/latest/TWD',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    data = json.loads(urllib.request.urlopen(req).read())
    raw_rates = data['rates']
    date_str = data.get('time_last_update_utc', '')[:10]

    corrected = {
        currency: rate / MC_CORRECTION
        for currency, rate in raw_rates.items()
    }

    return {'date': date_str, 'rates': corrected}


if __name__ == '__main__':
    result = fetch_mc_rates()
    print(f"Date: {result['date']}")
    for currency, rate in sorted(result['rates'].items()):
        print(f'1 TWD = {rate:.4f} {currency}')
