#!/usr/bin/env node
// agoda.js — Agoda hotel search and room price lookup
//
// Usage:
//   # Suggest (hotel name lookup)
//   node agoda.js --name "JR九州Blossom新宿"
//
//   # Price — fetches regular + partners in parallel automatically
//   node agoda.js --id 621491 --checkin 2026-06-01 --checkout 2026-06-02 \
//     --adults 2 [--children 0] [--rooms 1] [--currency TWD]
//
// Mode is auto-detected: --name → suggest, --id + --checkin + --checkout → price

'use strict';

const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
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
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const nameArg  = get('--name')     || '';
const idArg    = get('--id')       || '';
const checkin  = get('--checkin')  || '';
const checkout = get('--checkout') || '';
const adults   = parseInt(get('--adults')   || '2', 10);
const children = parseInt(get('--children') || '0', 10);
const rooms    = parseInt(get('--rooms')    || '1', 10);
const currency = (get('--currency') || 'TWD').toUpperCase();

// — Partners: add entries here to include more partner price comparisons —
const PARTNERS = [
  { key: 'regular',          url: 'https://www.agoda.com/zh-tw' },
  { key: 'jcb',              url: 'https://www.agoda.com/zh-tw/jcbtw' },
  { key: 'mctaishinbusiness', url: 'https://www.agoda.com/zh-tw/mctaishinbusiness' },
];

// — API key: fetch from Agoda JS bundles —
function _curlGetRaw(url) {
  return execFileSync('curl', [
    '-s', '--fail', '--compressed', '-H', `User-Agent: ${FETCH_UA}`, url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function _fetchApiKey() {
  const html      = _curlGetRaw(HOTEL_PAGE);
  const propMatch = html.match(/(property-[a-f0-9]+\.js)/);
  if (!propMatch) throw new Error('property-*.js bundle not found in HTML');

  const propJs = _curlGetRaw(CDN_BASE + propMatch[1]);
  const pairs  = [...propJs.matchAll(/([0-9]+):"([a-f0-9]{4,})"/g)];
  if (!pairs.length) throw new Error('chunk map not found in property bundle');

  const chunkUrls  = pairs.map(([, id, hash]) => `${CDN_BASE}${id}-${hash}.js`);
  const configPath = path.join(os.tmpdir(), `agoda_chunks_${Date.now()}.txt`);
  fs.writeFileSync(configPath, chunkUrls.map(u => `url = "${u}"`).join('\nnext\n'));

  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '--parallel', '--parallel-max', '50', '--silent', '--compressed',
      '-H', `User-Agent: ${FETCH_UA}`, '-K', configPath,
    ]);
    let tail = '', found = false;
    child.stdout.on('data', (buf) => {
      if (found) return;
      tail += buf.toString('latin1');
      const m = tail.match(KEY_RE);
      if (m) { found = true; child.kill('SIGTERM'); resolve(m[1]); return; }
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
  try {
    const cache = JSON.parse(fs.readFileSync(KEY_CACHE_PATH, 'utf8'));
    if (cache.key && Date.now() - cache.fetchedAt < KEY_TTL_MS) return cache.key;
  } catch {}
  process.stderr.write('[agoda] fetching api key...\n');
  const key = await _fetchApiKey();
  fs.writeFileSync(KEY_CACHE_PATH, JSON.stringify({ key, fetchedAt: Date.now() }));
  return key;
}

// — CID: fetch from partner landing page —
function fetchCidFromUrl(url) {
  const html = _curlGetRaw(url);
  const m = html.match(/"cid":(-?\d+)/);
  if (!m) throw new Error(`cid not found in page: ${url}`);
  return parseInt(m[1], 10);
}

// — curl helpers —
function buildHeaders(apiKey) {
  return [
    '-H', `User-Agent: ${FETCH_UA}`,
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

// — Suggest mode —
function modeSuggest(apiKey) {
  const url = `https://www.agoda.com/api/cronos/search/GetUnifiedSuggestResult/3/20/20/0/zh-tw/?searchText=${encodeURIComponent(nameArg)}&isHotelSearch=true`;

  let data;
  try {
    data = curlGet(url, apiKey);
  } catch (e) {
    console.error('Error fetching suggestions:', e.message);
    process.exit(1);
  }

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

// — Price mode —
function getCityId(apiKey) {
  const body = {
    pageSessionId: '', clientApplicationName: 'capybara', pricingRequest: {},
    userContext: { priceStrategy: 101, firstDownloadVersion: '6_0', currencyId: 28, currencyDisplayType: 3, cmsMode: 0, mseHotelIds: [], pointsMaxId: 0 },
    userState: { currentFunnel: 'regular', loyalty: { pastBookingsLevel: -1 } },
    propertyId: String(idArg),
    fields: ['rateCategory'],
    searchCriteria: { checkIn: checkin, checkOut: checkout, rooms, adults, children },
  };
  try {
    const data = curlPost('https://www.agoda.com/api/v1/property/room-grid', body, 'https://www.agoda.com/hotel/tokyo-jp.html', apiKey);
    return data.cityId || 0;
  } catch {
    return 0;
  }
}

function getPropertySlug(cityId, apiKey) {
  const userId = crypto.randomUUID();
  const body = {
    operationName: 'citySearch',
    variables: {
      CitySearchRequest: { cityId, searchRequest: {
        searchCriteria: { isAllowBookOnRequest: false, bookingDate: new Date().toISOString(), checkInDate: `${checkin}T00:00:00.000Z`, localCheckInDate: checkin, los: 1, rooms, adults, children, childAges: [], ratePlans: [], featureFlagRequest: { fetchNamesForTealium: false, fiveStarDealOfTheDay: false, isAllowBookOnRequest: false, showUnAvailable: false, showRemainingProperties: false, isMultiHotelSearch: false, enableAgencySupplyForPackages: false, flags: [], enablePageToken: false, enableDealsOfTheDayFilter: false, isEnableSupplierFinancialInfo: false, citySearchIgnoreRoomsCountForNha: false, isFlexibleMultiRoomSearch: false, enableLuxuryHotelTSP: false }, isUserLoggedIn: false, currency, travellerType: adults === 1 ? 'Solo' : 'Couple', isAPSPeek: false, enableOpaqueChannel: false, isEnabledPartnerChannelSelection: null, sorting: { sortField: 'Ranking', sortOrder: 'Desc', sortParams: null }, requiredBasis: 'PRPN', requiredPrice: 'Exclusive', suggestionLimit: 0, synchronous: false, supplierPullMetadataRequest: null, isRoomSuggestionRequested: false, isAPORequest: false, hasAPOFilter: false },
        searchContext: { userId, memberId: 0, locale: 'zh-tw', cid: -1, origin: 'TW', platform: 1, deviceTypeId: 1, experiments: { forceByVariant: null, forceByExperiment: [] }, isRetry: false, showCMS: false, storeFrontId: 3, pageTypeId: 103, whiteLabelKey: null, ipAddress: '', endpointSearchType: 'CitySearch', trackSteps: null, searchId: crypto.randomUUID() },
        matrix: null, matrixGroup: [], filterRequest: { idsFilters: [], rangeFilters: [], textFilters: [] }, page: { pageSize: 1, pageNumber: 1, pageToken: '' }, apoRequest: { apoPageSize: 0 }, extraHotels: { extraHotelIds: [parseInt(idArg, 10)], enableFiltersForExtraHotels: false }, rankingRequest: { isNhaKeywordSearch: false },
      }},
      ContentSummaryRequest: { context: { rawUserId: userId, memberId: 0, userOrigin: 'TW', locale: 'zh-tw', forceExperimentsByIdNew: [], apo: false, searchCriteria: { cityId }, platform: { id: 1 }, storeFrontId: 3, cid: '-1', occupancy: { numberOfAdults: adults, numberOfChildren: children, travelerType: 0, checkIn: `${checkin}T00:00:00.000Z` }, deviceTypeId: 1, whiteLabelKey: '', correlationId: '' }, summary: { highlightedFeaturesOrderPriority: null, includeHotelCharacter: false }, reviews: { commentary: null, demographics: { providerIds: null, filter: { defaultProviderOnly: true } }, summaries: { providerIds: null, apo: false, limit: 0, travellerType: 0 }, cumulative: { providerIds: null }, filters: null }, images: { page: null, maxWidth: 0, maxHeight: 0, imageSizes: null, indexOffset: null }, rooms: { images: null, featureLimit: 0, filterCriteria: null, includeMissing: false, includeSoldOut: false, includeDmcRoomId: false, soldOutRoomCriteria: null, showRoomSize: false, showRoomFacilities: false, showRoomName: false }, nonHotelAccommodation: false, engagement: false, highlights: { maxNumberOfItems: 0, images: { imageSizes: [] } }, personalizedInformation: false, localInformation: { images: null }, features: null, rateCategories: false, contentRateCategories: { escapeRateCategories: {} }, synopsis: false },
    },
    query: `query citySearch($CitySearchRequest: CitySearchRequest!, $ContentSummaryRequest: ContentSummaryRequest!) { citySearch(CitySearchRequest: $CitySearchRequest) { properties(ContentSummaryRequest: $ContentSummaryRequest) { propertyId content { informationSummary { propertyLinks { propertyPage } } } } } }`,
  };

  try {
    const raw = execFileSync('curl', [
      '-s', '--fail', '--compressed', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', 'Referer: https://www.agoda.com/',
      '-H', 'ag-page-type-id: 103',
      ...buildHeaders(apiKey),
      '--data', JSON.stringify(body),
      'https://www.agoda.com/graphql/search',
    ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    const data  = JSON.parse(raw);
    const props = data?.data?.citySearch?.properties || [];
    const prop  = props.find(p => String(p.propertyId) === String(idArg));
    return prop?.content?.informationSummary?.propertyLinks?.propertyPage || null;
  } catch {
    return null;
  }
}

// — Browser price extraction —
function pwAsync(session, ...pwArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('playwright-cli', ['-s', session, ...pwArgs]);
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', code =>
      code === 0 ? resolve(out) : reject(new Error(`[${session}] playwright-cli exit ${code}: ${err.slice(0, 200)}`))
    );
  });
}

const WAIT_SCRIPT = `(function() {
  var deadline = Date.now() + 10000;
  function check() {
    var p = window.propertyPageParams;
    if (p && p.roomGridData && p.roomGridData.masterRooms) return;
    if (Date.now() < deadline) setTimeout(check, 200);
  }
  check();
})()`;

const EVAL_SCRIPT = `(function() {
  var p = window.propertyPageParams;
  if (!p || !p.roomGridData) return JSON.stringify(null);
  return JSON.stringify({
    propertyId: p.hotelInfo && p.hotelInfo.hotelId,
    hotelName: p.hotelInfo && p.hotelInfo.name,
    isSoldOut: !(p.roomGridData.masterRooms && p.roomGridData.masterRooms.length),
    rooms: (p.roomGridData.masterRooms || []).map(function(r) {
      var sizeFeature = (r.features || []).find(function(f) { return f.symbol === 'ficon-sqm'; });
      var size = sizeFeature ? sizeFeature.title.replace(/^客房面積：/, '') : null;
      var beds = [];
      (r.bedroomLayouts || []).forEach(function(layout) {
        (layout.bedrooms || []).forEach(function(bedroom) {
          (bedroom.beds || []).forEach(function(bed) {
            if (bed.name) beds.push(bed.name);
          });
        });
      });
      var offers = (r.rooms || []).filter(function(o) {
        return o.isFit !== false;
      }).map(function(o) {
        var bens = (o.benefits || [])
          .filter(function(b) { return b.isAvailable && b.title; })
          .map(function(b) { return b.title; });
        if (o.isFreeCancellation && o.cancellation && o.cancellation.title)
          bens.push(o.cancellation.title);
        if (o.payLater && o.payLater.isAvailable)
          bens.push((o.payLater.hasDescription && o.payLater.description) || o.payLater.title);
        var ds = o.pricing && o.pricing.displaySummary && o.pricing.displaySummary.perNight;
        var afterCb = ds && ds.displayAfterCashback;
        var apsVal = o.apsPeekViewModel && o.apsPeekViewModel.apsPriceValue;
        var priceAmt = (apsVal && afterCb && afterCb.exclusive)
          ? apsVal * (afterCb.allInclusive / afterCb.exclusive)
          : (afterCb && afterCb.allInclusive)
            || (ds && ds.chargeTotal && ds.chargeTotal.allInclusive)
            || (o.pricing && o.pricing.displayPrice);
        return { price: { amount: Math.round(priceAmt) }, benefits: bens };
      }).filter(function(o) { return o.price.amount > 0; });
      return { name: r.name, isSoldOut: offers.length === 0, size: size, beds: beds, offers: offers };
    }).filter(function(r) { return r.offers.length > 0; })
  });
})()`;

async function getPricesViaBrowser(session, pageUrl) {
  try { await pwAsync(session, 'close'); } catch {}
  try {
    await pwAsync(session, 'open', '--headed', pageUrl);
    await pwAsync(session, 'eval', WAIT_SCRIPT);
    const raw   = await pwAsync(session, 'eval', EVAL_SCRIPT);
    const match = raw.match(/### Result\s*\n"([\s\S]*?)"\n/);
    if (!match) throw new Error(`[${session}] unexpected eval output: ` + raw.slice(0, 200));
    return JSON.parse(JSON.parse('"' + match[1] + '"'));
  } finally {
    try { await pwAsync(session, 'close'); } catch {}
  }
}

// — Consolidate results from all partners —
function consolidate(entries, dataArr) {
  // bookingUrls: one per partner
  const bookingUrls = {};
  entries.forEach((e, i) => { bookingUrls[e.key] = e.url; });

  // Collect room names in order of first appearance across all partners
  const roomOrder = [];
  const roomSeen  = new Set();
  dataArr.forEach(d => {
    (d.rooms || []).forEach(r => {
      if (!roomSeen.has(r.name)) { roomSeen.add(r.name); roomOrder.push(r.name); }
    });
  });

  const rooms = roomOrder.map(roomName => {
    // Room metadata from first partner that has it
    let meta = null;
    for (const d of dataArr) {
      const r = (d.rooms || []).find(r => r.name === roomName);
      if (r) { meta = r; break; }
    }

    // Group offers by sorted benefits key; keep lowest price per partner
    const offerMap = new Map();
    entries.forEach((e, i) => {
      const room = (dataArr[i].rooms || []).find(r => r.name === roomName);
      if (!room) return;
      (room.offers || []).forEach(offer => {
        const key = JSON.stringify([...offer.benefits].sort());
        if (!offerMap.has(key)) offerMap.set(key, { benefits: offer.benefits, prices: {} });
        const slot = offerMap.get(key);
        if (!(e.key in slot.prices) || offer.price.amount < slot.prices[e.key])
          slot.prices[e.key] = offer.price.amount;
      });
    });

    return {
      name: meta.name,
      size: meta.size,
      beds: meta.beds,
      offers: [...offerMap.values()],
    };
  }).filter(r => r.offers.length > 0);

  return { bookingUrls, rooms };
}

async function modePrice(apiKey) {
  // Check playwright-cli is available (required for headed browser; Agoda blocks headless)
  try {
    execFileSync('playwright-cli', ['--version'], { stdio: 'ignore' });
  } catch {
    console.error(
      'Error: playwright-cli not found.\n' +
      'This script requires a headed browser — Agoda blocks headless mode.\n' +
      'Install playwright-cli via the playwright-cli skill install script.'
    );
    process.exit(1);
  }

  process.stderr.write('[agoda] fetching hotel page url and partner cids...\n');
  const [cityId, ...partnerCids] = await Promise.all([
    Promise.resolve(getCityId(apiKey)),
    ...PARTNERS.map(p => Promise.resolve(fetchCidFromUrl(p.url))),
  ]);
  if (!cityId) { console.error('Error: could not resolve cityId for property', idArg); process.exit(1); }

  const slug = getPropertySlug(cityId, apiKey);
  if (!slug) { console.error('Error: could not resolve page slug for property', idArg); process.exit(1); }

  const los      = Math.round((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24));
  const baseUrl  = `https://www.agoda.com/zh-tw${slug}?checkIn=${checkin}&los=${los}&adults=${adults}&children=${children}&rooms=${rooms}&currencyCode=${currency}`;
  const entries  = PARTNERS.map((p, i) => ({ key: p.key, url: `${baseUrl}&cid=${partnerCids[i]}` }));

  const cidLog = PARTNERS.map((p, i) => `${p.key}=${partnerCids[i]}`).join(', ');
  process.stderr.write(`[agoda] launching browsers in parallel (${cidLog})...\n`);

  const dataArr = await Promise.all(
    entries.map(e => getPricesViaBrowser(`agoda-${e.key}`, e.url))
  );

  dataArr.forEach((d, i) => {
    if (!d) { console.error(`Error: propertyPageParams not found (${PARTNERS[i].key})`); process.exit(1); }
  });

  const first      = dataArr[0];
  const { bookingUrls, rooms: consolidatedRooms } = consolidate(entries, dataArr);

  const result = {
    propertyId:     first.propertyId || idArg,
    hotelName:      first.hotelName,
    searchCriteria: rooms > 1
      ? `${checkin} - ${checkout}, ${adults}人, ${rooms}間客房`
      : `${checkin} - ${checkout}, ${adults}人`,
    currency,
    bookingUrls,
    rooms: consolidatedRooms,
  };

  console.log(JSON.stringify(result, null, 2));
}

// — Main —
async function main() {
  if (nameArg) {
    const apiKey = await getApiKey();
    modeSuggest(apiKey);
  } else if (idArg && checkin && checkout) {
    const apiKey = await getApiKey();
    await modePrice(apiKey);
  } else {
    console.error(
      'Usage:\n' +
      '  node agoda.js --name "hotel name"                                    # suggest\n' +
      '  node agoda.js --id ID --checkin YYYY-MM-DD --checkout YYYY-MM-DD \\  # price\n' +
      '    [--adults N] [--currency TWD]'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
