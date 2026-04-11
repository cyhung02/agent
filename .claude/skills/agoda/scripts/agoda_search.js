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
//
// API key is fetched automatically from Agoda's JS bundles and cached
// at KEY_CACHE_PATH with a TTL of KEY_TTL_MS. On cache miss or expiry
// the key is re-fetched and the cache file is overwritten.

'use strict';

const { execFileSync, spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// — Key cache config —
const KEY_CACHE_PATH = path.join(os.tmpdir(), 'agoda_apikey.json');
const KEY_TTL_MS     = 6 * 60 * 60 * 1000; // 6 hours

// — Key fetch constants —
const HOTEL_PAGE = 'https://www.agoda.com/hotel-gracery-shinjuku/hotel/tokyo-jp.html';
const CDN_BASE   = 'https://cdn6.agoda.net/cdn-accom-web/js/assets/browser-bundle/';
const FETCH_UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const KEY_RE     = /appVersion:"[^"]+",isWebviewEnabled[^,]+,apiKey:"([^"]+)"/;
const TAIL_SIZE  = 512;

// — Argument parsing —
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const mode     = get('--mode') || 'suggest';
const nameArg  = get('--name') || '';
const idArg    = get('--id') || '';
const checkin  = get('--checkin') || '';
const checkout = get('--checkout') || '';
const adults   = parseInt(get('--adults') || '2', 10);
const children = parseInt(get('--children') || '0', 10);
const rooms    = parseInt(get('--rooms') || '1', 10);
const currency = (get('--currency') || 'TWD').toUpperCase();

// Agoda internal currency ID mapping
const CURRENCY_IDS = {
  TWD: 28, USD: 7, JPY: 2, HKD: 3, EUR: 5, SGD: 10, KRW: 16, AUD: 8, GBP: 6,
};

// — API key: fetch from Agoda JS bundles —
function _curlGetRaw(url) {
  return execFileSync('curl', [
    '-s', '--fail', '--compressed', '-H', `User-Agent: ${FETCH_UA}`, url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function _fetchApiKey() {
  // Step 1: hotel page → property bundle filename
  const html = _curlGetRaw(HOTEL_PAGE);
  const propMatch = html.match(/(property-[a-f0-9]+\.js)/);
  if (!propMatch) throw new Error('property-*.js bundle not found in HTML');

  // Step 2: property bundle → webpack chunk map
  const propJs = _curlGetRaw(CDN_BASE + propMatch[1]);
  const pairs  = [...propJs.matchAll(/([0-9]+):"([a-f0-9]{4,})"/g)];
  if (!pairs.length) throw new Error('chunk map not found in property bundle');

  const chunkUrls  = pairs.map(([, id, hash]) => `${CDN_BASE}${id}-${hash}.js`);
  const configPath = path.join(os.tmpdir(), `agoda_chunks_${Date.now()}.txt`);
  fs.writeFileSync(configPath, chunkUrls.map(u => `url = "${u}"`).join('\nnext\n'));

  // Step 3: stream all chunks in parallel, kill as soon as apiKey is found
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '--parallel', '--parallel-max', '50',
      '--silent', '--compressed',
      '-H', `User-Agent: ${FETCH_UA}`,
      '-K', configPath,
    ]);

    let tail  = '';
    let found = false;

    child.stdout.on('data', (buf) => {
      if (found) return;
      tail += buf.toString('latin1');
      const m = tail.match(KEY_RE);
      if (m) {
        found = true;
        child.kill('SIGTERM');
        resolve(m[1]);
        return;
      }
      if (tail.length > TAIL_SIZE) tail = tail.slice(-TAIL_SIZE);
    });

    child.on('error', reject);
    child.on('close', () => {
      try { fs.unlinkSync(configPath); } catch {}
      if (!found) reject(new Error('apiKey not found in any chunk'));
    });
  });
}

async function getApiKey() {
  // Return cached key if still within TTL
  try {
    const cache = JSON.parse(fs.readFileSync(KEY_CACHE_PATH, 'utf8'));
    if (cache.key && Date.now() - cache.fetchedAt < KEY_TTL_MS) {
      return cache.key;
    }
  } catch {
    // Cache miss or invalid JSON — fall through to fetch
  }

  // Fetch fresh key and persist to cache
  process.stderr.write('[agoda] fetching api key...\n');
  const key = await _fetchApiKey();
  fs.writeFileSync(KEY_CACHE_PATH, JSON.stringify({ key, fetchedAt: Date.now() }));
  return key;
}

// — curl helpers (require apiKey) —
function buildHeaders(apiKey) {
  return [
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    '-H', 'Accept: */*',
    '-H', 'Origin: https://www.agoda.com',
    '-H', `ag-initiator-api-key: ${apiKey}`,
    '-H', 'ag-initiator-version: 6_0',
    '-H', 'ag-language-locale: zh-tw',
    '-H', 'ag-request-attempt: 1',
    '-H', 'ag-retry-attempt: 0',
    '-H', 'ag-cid: -1',
  ];
}

function curlGet(url, apiKey) {
  const raw = execFileSync('curl', [
    '-s', '--fail', '--compressed',
    '-H', 'Referer: https://www.agoda.com/',
    ...buildHeaders(apiKey), url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(raw);
}

function curlPost(url, body, referer, apiKey) {
  const raw = execFileSync('curl', [
    '-s', '--fail', '--compressed', '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-H', `Referer: ${referer}`,
    ...buildHeaders(apiKey),
    '--data', JSON.stringify(body),
    url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(raw);
}

// — Mode 1: suggest —
function modeSuggest(apiKey) {
  if (!nameArg) { console.error('Error: --name is required'); process.exit(1); }

  const url = `https://www.agoda.com/api/cronos/search/GetUnifiedSuggestResult/3/20/20/0/zh-tw/?searchText=${encodeURIComponent(nameArg)}&isHotelSearch=true`;

  let data;
  try {
    data = curlGet(url, apiKey);
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
function modePrice(apiKey) {
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
      children,
    },
  };

  const referer = `https://www.agoda.com/hotel/tokyo-jp.html?adults=${adults}&rooms=${rooms}&checkIn=${checkin}&checkOut=${checkout}&currency=${currency}`;

  let data;
  try {
    data = curlPost('https://www.agoda.com/api/v1/property/room-grid', body, referer, apiKey);
  } catch (e) {
    console.error('Error fetching room prices:', e.message);
    process.exit(1);
  }

  const result = {
    propertyId: data.propertyId,
    hotelName: data.propertyName,
    searchCriteria: rooms > 1
      ? `${data.searchCriteriaDescription}，${rooms}間客房`
      : data.searchCriteriaDescription,
    isSoldOut: data.isSoldOut,
    currency,
    rooms: [],
  };

  for (const room of (data.rooms || [])) {
    const roomEntry = {
      name: room.name,
      isSoldOut: room.isSoldOut || false,
      size: room.roomSize || null,
      beds: (room.features || [])
        .filter(f => f.type === 'BEDROOM_LAYOUT')
        .map(f => f.text)
        .filter(Boolean),
      offers: [],
    };

    for (const offer of (room.offers || [])) {
      // Skip offers that Agoda flags as exceeding occupancy for the requested room count
      const roomTag = `${rooms}間客房`;
      const hasOccupancyError = (offer.occupancyItems || []).some(
        item => item.type === 'AMENITIES_ERROR' && (item.occupancyTags || []).includes(roomTag)
      );
      if (hasOccupancyError) continue;

      // hotel_price_per_book in analyticsContext is the inclusive (after taxes) price per night,
      // in the same currency as the request (confirmed: equals price.final * 1.10 for Japan 10% tax)
      const inclAmount = offer.analyticsContext?.hotel_price_per_book;

      roomEntry.offers.push({
        price: inclAmount ? {
          amount: Math.round(inclAmount),
        } : null,
        benefits: (offer.benefits || []).map(b => b.name || b.text).filter(Boolean),
      });
    }

    if (roomEntry.offers.length > 0) result.rooms.push(roomEntry);
  }

  console.log(JSON.stringify(result, null, 2));
}

// — Main —
async function main() {
  const apiKey = await getApiKey();

  switch (mode) {
    case 'suggest': modeSuggest(apiKey); break;
    case 'price':   modePrice(apiKey);   break;
    default:
      console.error(`Unknown mode: ${mode}. Use: suggest | price`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
