#!/usr/bin/env node
// agoda_search.js - Agoda hotel search (no browser required)
//
// Usage:
//   Mode 1 - Get hotel candidates by name:
//     node agoda_search.js --mode suggest --name "JR九州Blossom新宿"
//
//   Mode 2 - Get room prices by propertyId:
//     node agoda_search.js --mode price   \
//       --id 621491   \
//       --checkin 2026-06-01   \
//       --checkout 2026-06-02   \
//       --adults 2   \
//       [--rooms 1]   \
//       [--currency TWD]

'use strict';

const { execFileSync } = require('child_process');

// — Argument parsing —
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const mode     = get('--mode') || 'suggest';
const nameArg  = get('--name') || '';
const idArg    = get('--id') || '';
const checkin  = get('--checkin') || '';
const checkout = get('--checkout') || '';
const adults   = parseInt(get('--adults') || '2', 10);
const rooms    = parseInt(get('--rooms') || '1', 10);
const currency = (get('--currency') || 'TWD').toUpperCase();

// Agoda internal currency ID mapping
const CURRENCY_IDS = {
  TWD: 28, USD: 7, JPY: 2, HKD: 3, EUR: 5, SGD: 10, KRW: 16, AUD: 8, GBP: 6,
};

// — curl helper —
const HEADERS = [
  '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  '-H', 'Accept: */*',
  '-H', 'Origin: https://www.agoda.com',
  '-H', 'ag-initiator-api-key: b3949fd5-9553-4b4e-b221-48be2a1b84a8',
  '-H', 'ag-initiator-version: 6_0',
  '-H', 'ag-language-locale: en-us',
  '-H', 'ag-request-attempt: 1',
  '-H', 'ag-retry-attempt: 0',
  '-H', 'ag-cid: -1',
];

function curlGet(url) {
  const raw = execFileSync('curl', [
    '-s', '--fail', '--compressed',
    '-H', 'Referer: https://www.agoda.com/',
    ...HEADERS, url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(raw);
}

function curlPost(url, body, referer) {
  const raw = execFileSync('curl', [
    '-s', '--fail', '--compressed', '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-H', `Referer: ${referer}`,
    ...HEADERS,
    '--data', JSON.stringify(body),
    url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(raw);
}

// — Mode 1: suggest —
function modeSuggest() {
  if (!nameArg) { console.error('Error: --name is required'); process.exit(1); }

  const url = `https://www.agoda.com/api/cronos/search/GetUnifiedSuggestResult/3/20/20/0/en-us/?searchText=${encodeURIComponent(nameArg)}&isHotelSearch=true`;

  let data;
  try {
    data = curlGet(url);
  } catch (e) {
    console.error('Error fetching suggestions:', e.message);
    process.exit(1);
  }

  // ViewModelList: each entry is one suggestion; ObjectTypeId 1 = hotel property
  const candidates = [];
  for (const item of (data?.ViewModelList || [])) {
    if (!item.ObjectId) continue;
    if (item.ObjectTypeId === 1 || item.IsHotel) {
      candidates.push({
        propertyId: item.ObjectId,
        name: item.Name || item.Header || '',
        city: item.CityName || '',
        country: item.ResultAddress || '',
      });
    }
  }

  if (candidates.length === 0) {
    console.error('No hotel candidates found for:', nameArg);
    process.exit(1);
  }

  console.log(JSON.stringify({ candidates }, null, 2));
}

// — Mode 2: price —
function modePrice() {
  if (!idArg)    { console.error('Error: --id is required');      process.exit(1); }
  if (!checkin)  { console.error('Error: --checkin is required'); process.exit(1); }
  if (!checkout) { console.error('Error: --checkout is required'); process.exit(1); }

  const currencyId = CURRENCY_IDS[currency] || 28;

  const body = {
    pageSessionId: '',
    clientApplicationName: 'capybara',
    pricingRequest: {},
    userContext: {
      priceStrategy: 101,
      firstDownloadVersion: '6_0',
      currencyId,
      currencyDisplayType: 3,
      cmsMode: 0,
      mseHotelIds: [],
      pointsMaxId: 0,
    },
    userState: {
      currentFunnel: 'regular',
      loyalty: { pastBookingsLevel: -1 },
    },
    propertyId: String(idArg),
    fields: [
      'rateCategory', 'paymentInfo', 'cancellationPolicy',
      'Features', 'sizeInfo', 'deals', 'benefits', 'policies',
    ],
    searchCriteria: {
      checkIn: checkin,
      checkOut: checkout,
      rooms,
      adults,
      children: 0,
    },
  };

  const referer = `https://www.agoda.com/hotel/tokyo-jp.html?adults=${adults}&rooms=${rooms}&checkIn=${checkin}&checkOut=${checkout}&currency=${currency}`;

  let data;
  try {
    data = curlPost('https://www.agoda.com/api/v1/property/room-grid', body, referer);
  } catch (e) {
    console.error('Error fetching room prices:', e.message);
    process.exit(1);
  }

  const result = {
    propertyId: data.propertyId,
    hotelName: data.propertyName,
    searchCriteria: data.searchCriteriaDescription,
    isSoldOut: data.isSoldOut,
    currency,
    rooms: [],
  };

  for (const room of (data.rooms || [])) {
    const roomEntry = {
      name: room.name,
      isSoldOut: room.isSoldOut || false,
      size: room.roomSize?.displayText || null,
      offers: [],
    };

    for (const offer of (room.offers || []).slice(0, 3)) {
      // hotel_price_per_book in analyticsContext is the inclusive (after taxes) price per night
      const inclAmount = offer.analyticsContext?.hotel_price_per_book;
      const exclAmount = offer.price?.final?.amountNumber;
      const offerCurrency = offer.price?.final?.currency || '';

      // Format inclusive price display string (same currency symbol as exclusive)
      const inclDisplay = inclAmount
        ? `${offerCurrency}\u00a0${Math.round(inclAmount).toLocaleString()}`
        : null;

      roomEntry.offers.push({
        name: offer.name || offer.title || null,
        price: inclDisplay ? {
          amount: Math.round(inclAmount),
          display: inclDisplay,
          amountExclTax: exclAmount,
        } : null,
        benefits: (offer.benefits || []).map(b => b.name || b.text).filter(Boolean),
        policies: (offer.policies || [])
          .map(p => ({ type: p.type, title: p.title }))
          .filter(p => p.title),
      });
    }

    result.rooms.push(roomEntry);
  }

  console.log(JSON.stringify(result, null, 2));
}

// — Main —
switch (mode) {
  case 'suggest': modeSuggest(); break;
  case 'price':   modePrice();   break;
  default:
    console.error(`Unknown mode: ${mode}. Use: suggest | price`);
    process.exit(1);
}
