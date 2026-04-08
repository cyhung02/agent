import json
import sys
import urllib.request


MC_CORRECTION = 1.00305  # MC charges ~0.305% above ECB


def fmt(value):
    return f"{value:,.0f}" if value >= 10 else f"{value:,.2f}"


def main():
    if len(sys.argv) != 4:
        print("Usage: fetch_mc_rates.py <amount> <from_currency> <to_currency>")
        print("Example: fetch_mc_rates.py 1000 TWD JPY")
        sys.exit(1)

    amount = float(sys.argv[1])
    from_cur = sys.argv[2].upper()
    to_cur = sys.argv[3].upper()

    req = urllib.request.Request(
        'https://open.er-api.com/v6/latest/TWD',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    data = json.loads(urllib.request.urlopen(req).read())
    raw = data['rates']
    date = data.get('time_last_update_utc', '')[:10]

    # rates[currency] = units of foreign per 1 TWD (MC-corrected)
    rates = {c: r / MC_CORRECTION for c, r in raw.items()}

    if from_cur == 'TWD':
        result = amount * rates[to_cur]
        rate_str = f"1 TWD ≈ {fmt(rates[to_cur])} {to_cur}"
    elif to_cur == 'TWD':
        result = amount / rates[from_cur]
        rate_str = f"1 {from_cur} ≈ {fmt(1 / rates[from_cur])} TWD"
    else:
        # cross rate via TWD
        result = amount / rates[from_cur] * rates[to_cur]
        cross = rates[to_cur] / rates[from_cur]
        rate_str = f"1 {from_cur} ≈ {fmt(cross)} {to_cur}"

    print(f"💱 匯率（{date}，Mastercard 估算）")
    print()
    print(rate_str)
    print()
    print(f"{fmt(amount)} {from_cur} ≈ {fmt(result)} {to_cur}")
    print("（已套用 Mastercard +0.305% 修正）")


if __name__ == '__main__':
    main()
