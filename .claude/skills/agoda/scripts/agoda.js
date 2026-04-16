#!/usr/bin/env node
// agoda.js — Agoda hotel search and room price lookup
//
// Usage:
//   # Suggest (hotel name lookup)
//   node agoda.js --name "JR九州Blossom新宿"
//
//   # Price — fetches all partners in parallel, outputs 4 best-price slots per room:
//   #   noMeal_nonCancellable / noMeal_cancellable / withMeal_nonCancellable / withMeal_cancellable
//   node agoda.js --id 621491 --checkin 2026-06-01 --checkout 2026-06-02 \
//     --adults 2 [--children 0] [--rooms 1] [--currency TWD]
//
//   # Price (all offers) — shows every offer grouped by benefits, with per-partner prices
//   node agoda.js --id 621491 --checkin 2026-06-01 --checkout 2026-06-02 \
//     --adults 2 [--children 0] [--rooms 1] [--currency TWD] --all_offers
//
// Mode is auto-detected: --name → suggest, --id + --checkin + --checkout → price

'use strict';

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { chromium }    = require('playwright');
const crypto = require('crypto');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// — Key cache config —
const KEY_CACHE_PATH      = path.join(os.tmpdir(), 'agoda_apikey.json');
const KEY_TTL_MS          = 6 * 60 * 60 * 1000;  // 6 hours

// — Key fetch constants —
const HOTEL_PAGE = 'https://www.agoda.com/hotel-gracery-shinjuku/hotel/tokyo-jp.html';
const CDN_BASE   = 'https://cdn6.agoda.net/cdn-accom-web/js/assets/browser-bundle/';
const FETCH_UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const KEY_RE     = /appVersion:"[^"]+",isWebviewEnabled[^,]+,apiKey:"([^"]+)"/;
const TAIL_SIZE  = 512;

// — Argument parsing —
const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const nameArg  = getArg('--name')     || '';
const idArg    = getArg('--id')       || '';
const checkin  = getArg('--checkin')  || '';
const checkout = getArg('--checkout') || '';
const adults   = parseInt(getArg('--adults')   || '2', 10);
const children = parseInt(getArg('--children') || '0', 10);
const rooms    = parseInt(getArg('--rooms')    || '1', 10);
const currency   = (getArg('--currency') || 'TWD').toUpperCase();
const allOffers  = args.includes('--all_offers');

// — Currency ID map: agoda.version.03 cookie uses numeric IDs, not currency codes —
// Discovered by scanning CuCur values 1-35 against the property page.
// The URL param currencyCode= is ignored by the page; only CuCur in the cookie counts.
const CURRENCY_ID = {
  EUR: 1,  GBP: 2,  HKD: 3,  MYR: 4,  SGD: 5,
  THB: 6,  USD: 7,  NZD: 8,  AUD: 9,  JPY: 11,
  CAD: 13, KRW: 26, INR: 27, TWD: 28,
};

// — Partners: add entries here to include more partner price comparisons —
// url-based: cid fetched from partner landing page
// cidFetcher-based: cid fetched dynamically (receives hotelName, checkin, checkout)
const PARTNERS = [
  { key: 'regular',           url: 'https://www.agoda.com/zh-tw' },
  { key: 'jcb',               url: 'https://www.agoda.com/zh-tw/jcbtw' },
  { key: 'mctaishinbusiness', url: 'https://www.agoda.com/zh-tw/mctaishinbusiness' },
  { key: 'google',            cidFetcher: fetchCidFromGoogleMaps },
];

// — API key: fetch from Agoda JS bundles —
async function curlGetRaw(url) {
  const { stdout } = await execFileAsync('curl', [
    '-s', '--fail', '--compressed', '-H', `User-Agent: ${FETCH_UA}`, url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function fetchApiKey() {
  const html      = await curlGetRaw(HOTEL_PAGE);
  const propMatch = html.match(/(property-[a-f0-9]+\.js)/);
  if (!propMatch) throw new Error('property-*.js bundle not found in HTML');

  const propJs = await curlGetRaw(CDN_BASE + propMatch[1]);
  const pairs  = [...propJs.matchAll(/([0-9]+):"([a-f0-9]{4,})"/g)];
  if (!pairs.length) throw new Error('chunk map not found in property bundle');

  const chunkUrls  = pairs.map(([, id, hash]) => `${CDN_BASE}${id}-${hash}.js`);
  const configPath = path.join(os.tmpdir(), `agoda_chunks_${process.pid}_${Date.now()}.txt`);
  fs.writeFileSync(configPath, chunkUrls.map(u => `url = "${u}"`).join('\nnext\n'));

  function cleanup() { try { fs.unlinkSync(configPath); } catch {} }

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
    child.on('error', (err) => { cleanup(); reject(err); });
    child.on('close', () => {
      cleanup();
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
  const key = await fetchApiKey();
  fs.writeFileSync(KEY_CACHE_PATH, JSON.stringify({ key, fetchedAt: Date.now() }));
  return key;
}

// — CID: fetch from partner landing page —
async function fetchCidFromUrl(url) {
  const html = await curlGetRaw(url);
  const m = html.match(/"cid":(-?\d+)/);
  if (!m) throw new Error(`cid not found in page: ${url}`);
  return parseInt(m[1], 10);
}

// — CID: fetch from Google Maps by hotel name + dates —
function hotelNameFromSlug(slug) {
  // '/grand-hyatt-taipei/hotel/taipei-tw.html' → 'grand hyatt taipei'
  const m = slug.match(/^\/([^/]+)\//);
  return m ? m[1].replace(/-/g, ' ') : '';
}

async function fetchCidFromGoogleMaps(hotelName, checkin, _checkout) {
  // Step 1: search Google Maps to get hex place ID
  const { stdout: searchHtml } = await execFileAsync('curl', [
    '-s', '--fail', '--compressed',
    '-H', `User-Agent: ${FETCH_UA}`,
    '-H', 'Accept-Language: zh-TW,zh;q=0.9,en;q=0.8',
    `https://www.google.com/search?tbm=map&hl=zh-TW&gl=tw&q=${encodeURIComponent(hotelName)}`,
  ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });

  // Skip 0x0:0x... noise entries; take first with a real (non-zero) first part
  const hexRe = /0x[0-9a-f]+:0x[0-9a-f]+/g;
  let hexId = null;
  let m;
  while ((m = hexRe.exec(searchHtml)) !== null) {
    if (!m[0].startsWith('0x0:')) { hexId = m[0]; break; }
  }
  if (!hexId) throw new Error(`no hex place ID found on Google Maps for: ${hotelName}`);

  // Step 2: call placeupdate API with 4 checkin offsets in parallel.
  // Each attempt uses a 1-night stay (checkout = checkin + 1 day).
  // Return the first attempt that yields an Agoda cid.
  const [ciY, ciM, ciD] = checkin.split('-').map(Number);
  const ciBase = new Date(Date.UTC(ciY, ciM - 1, ciD));

  const GOOGLE_FALLBACK_CID = 1917614;  // fixed Google partner CID for Agoda

  const results = await Promise.allSettled([0, 30].map(async (offset) => {
    const ci = new Date(ciBase);
    ci.setUTCDate(ci.getUTCDate() + offset);
    const co = new Date(ci);
    co.setUTCDate(co.getUTCDate() + 1);
    const pb = [
      `!17m9!1m3!1i${ci.getUTCFullYear()}!2i${ci.getUTCMonth() + 1}!3i${ci.getUTCDate()}`,
      `!2m3!1i${co.getUTCFullYear()}!2i${co.getUTCMonth() + 1}!3i${co.getUTCDate()}`,
      `!5b1!5m1!1s${encodeURIComponent(hexId)}`,
    ].join('');
    const { stdout: placeHtml } = await execFileAsync('curl', [
      '-s', '--fail', '--compressed',
      '-H', `User-Agent: ${FETCH_UA}`,
      '-H', 'Accept-Language: zh-TW,zh;q=0.9,en;q=0.8',
      `https://www.google.com/maps/preview/placeupdate?hl=zh-TW&gl=tw&pb=${pb}`,
    ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    const cidMatch = placeHtml.match(/site_id(?:=|%3D)(\d+)/i);
    if (!cidMatch) throw new Error(`Agoda not listed on Google Maps (offset +${offset})`);
    return parseInt(cidMatch[1], 10);
  }));

  for (const r of results) {
    if (r.status === 'fulfilled') return r.value;
  }
  process.stderr.write(`[agoda] google CID not found, using fallback CID ${GOOGLE_FALLBACK_CID}\n`);
  return GOOGLE_FALLBACK_CID;
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

async function curlGet(url, apiKey) {
  const { stdout } = await execFileAsync('curl', [
    '-s', '--fail', '--compressed',
    '-H', 'Referer: https://www.agoda.com/',
    ...buildHeaders(apiKey), url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function curlPost(url, body, referer, apiKey, extraHeaders = []) {
  const { stdout } = await execFileAsync('curl', [
    '-s', '--fail', '--compressed', '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-H', `Referer: ${referer}`,
    ...buildHeaders(apiKey),
    ...extraHeaders,
    '--data', JSON.stringify(body),
    url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

// — Suggest mode —
async function modeSuggest(apiKey) {
  const url = `https://www.agoda.com/api/cronos/search/GetUnifiedSuggestResult/3/20/20/0/zh-tw/?searchText=${encodeURIComponent(nameArg)}&isHotelSearch=true`;

  let data;
  try {
    data = await curlGet(url, apiKey);
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

// — API Payload builders —

function buildRoomGridBody({ propertyId, checkin, checkout, rooms, adults, children }) {
  return {
    pageSessionId: '',
    clientApplicationName: 'capybara',
    pricingRequest: {},
    userContext: {
      priceStrategy: 101,
      firstDownloadVersion: '6_0',
      currencyId: CURRENCY_ID[currency] ?? 28,
      currencyDisplayType: 3,
      cmsMode: 0,
      mseHotelIds: [],
      pointsMaxId: 0,
    },
    userState: { currentFunnel: 'regular', loyalty: { pastBookingsLevel: -1 } },
    propertyId: String(propertyId),
    fields: ['rateCategory'],
    searchCriteria: { checkIn: checkin, checkOut: checkout, rooms, adults, children },
  };
}

function buildCitySearchBody({ cityId, checkin, checkout, rooms, adults, children, currency, propertyId }) {
  const userId      = crypto.randomUUID();
  const checkInIso  = `${checkin}T00:00:00.000Z`;
  return {
    operationName: 'citySearch',
    variables: {
      CitySearchRequest: { cityId, searchRequest: {
        searchCriteria: {
          isAllowBookOnRequest: false,
          bookingDate: new Date().toISOString(),
          checkInDate: checkInIso,
          localCheckInDate: checkin,
          los: 1,
          rooms, adults, children,
          childAges: [], ratePlans: [],
          featureFlagRequest: {
            fetchNamesForTealium: false, fiveStarDealOfTheDay: false,
            isAllowBookOnRequest: false, showUnAvailable: false,
            showRemainingProperties: false, isMultiHotelSearch: false,
            enableAgencySupplyForPackages: false, flags: [],
            enablePageToken: false, enableDealsOfTheDayFilter: false,
            isEnableSupplierFinancialInfo: false, citySearchIgnoreRoomsCountForNha: false,
            isFlexibleMultiRoomSearch: false, enableLuxuryHotelTSP: false,
          },
          isUserLoggedIn: false,
          currency,
          travellerType: adults === 1 ? 'Solo' : 'Couple',
          isAPSPeek: false,
          enableOpaqueChannel: false,
          isEnabledPartnerChannelSelection: null,
          sorting: { sortField: 'Ranking', sortOrder: 'Desc', sortParams: null },
          requiredBasis: 'PRPN',
          requiredPrice: 'Exclusive',
          suggestionLimit: 0,
          synchronous: false,
          supplierPullMetadataRequest: null,
          isRoomSuggestionRequested: false,
          isAPORequest: false,
          hasAPOFilter: false,
        },
        searchContext: {
          userId, memberId: 0, locale: 'zh-tw', cid: -1, origin: 'TW',
          platform: 1, deviceTypeId: 1,
          experiments: { forceByVariant: null, forceByExperiment: [] },
          isRetry: false, showCMS: false, storeFrontId: 3, pageTypeId: 103,
          whiteLabelKey: null, ipAddress: '', endpointSearchType: 'CitySearch',
          trackSteps: null, searchId: crypto.randomUUID(),
        },
        matrix: null, matrixGroup: [],
        filterRequest: { idsFilters: [], rangeFilters: [], textFilters: [] },
        page: { pageSize: 1, pageNumber: 1, pageToken: '' },
        apoRequest: { apoPageSize: 0 },
        extraHotels: { extraHotelIds: [parseInt(propertyId, 10)], enableFiltersForExtraHotels: false },
        rankingRequest: { isNhaKeywordSearch: false },
      }},
      ContentSummaryRequest: {
        context: {
          rawUserId: userId, memberId: 0, userOrigin: 'TW', locale: 'zh-tw',
          forceExperimentsByIdNew: [], apo: false,
          searchCriteria: { cityId },
          platform: { id: 1 }, storeFrontId: 3, cid: '-1',
          occupancy: { numberOfAdults: adults, numberOfChildren: children, travelerType: 0, checkIn: checkInIso },
          deviceTypeId: 1, whiteLabelKey: '', correlationId: '',
        },
        summary: { highlightedFeaturesOrderPriority: null, includeHotelCharacter: false },
        reviews: {
          commentary: null,
          demographics: { providerIds: null, filter: { defaultProviderOnly: true } },
          summaries: { providerIds: null, apo: false, limit: 0, travellerType: 0 },
          cumulative: { providerIds: null },
          filters: null,
        },
        images: { page: null, maxWidth: 0, maxHeight: 0, imageSizes: null, indexOffset: null },
        rooms: {
          images: null, featureLimit: 0, filterCriteria: null,
          includeMissing: false, includeSoldOut: false, includeDmcRoomId: false,
          soldOutRoomCriteria: null, showRoomSize: false, showRoomFacilities: false, showRoomName: false,
        },
        nonHotelAccommodation: false,
        engagement: false,
        highlights: { maxNumberOfItems: 0, images: { imageSizes: [] } },
        personalizedInformation: false,
        localInformation: { images: null },
        features: null,
        rateCategories: false,
        contentRateCategories: { escapeRateCategories: {} },
        synopsis: false,
      },
    },
    query: `query citySearch($CitySearchRequest: CitySearchRequest!, $ContentSummaryRequest: ContentSummaryRequest!) { citySearch(CitySearchRequest: $CitySearchRequest) { properties(ContentSummaryRequest: $ContentSummaryRequest) { propertyId content { informationSummary { propertyLinks { propertyPage } } } } } }`,
  };
}

// — Price mode —

async function getCityId(apiKey) {
  const body = buildRoomGridBody({ propertyId: idArg, checkin, checkout, rooms, adults, children });
  try {
    const data = await curlPost('https://www.agoda.com/api/v1/property/room-grid', body, 'https://www.agoda.com/hotel/tokyo-jp.html', apiKey);
    return data.cityId || 0;
  } catch {
    return 0;
  }
}

async function getPropertySlug(cityId, apiKey) {
  const body = buildCitySearchBody({ cityId, checkin, checkout, rooms, adults, children, currency, propertyId: idArg });
  try {
    const data = await curlPost(
      'https://www.agoda.com/graphql/search',
      body, 'https://www.agoda.com/', apiKey,
      ['-H', 'ag-page-type-id: 103'],
    );
    const props = data?.data?.citySearch?.properties || [];
    const prop  = props.find(p => String(p.propertyId) === String(idArg));
    return prop?.content?.informationSummary?.propertyLinks?.propertyPage || null;
  } catch {
    return null;
  }
}

// — Browser price extraction —

function buildLaunchOptions() {
  if (process.platform !== 'win32' && !process.env.DISPLAY) {
    console.error(
      'Error: no X Server detected ($DISPLAY not set).\n' +
      'Run with: xvfb-run -a node agoda.js ...'
    );
    process.exit(1);
  }
  const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || '';
  let proxy;
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    proxy = {
      server:   `${u.protocol}//${u.hostname}:${u.port}`,
      username: u.username || '',
      password: u.password || '',
    };
  }
  return { channel: 'chrome', headless: false, chromiumSandbox: false, proxy };
}

function extractRoomData() {
  const p = window.propertyPageParams;
  if (!p || !p.roomGridData) return null;
  return {
    propertyId: p.hotelInfo?.hotelId,
    hotelName:  p.hotelInfo?.name,
    isSoldOut:  !(p.roomGridData.masterRooms?.length),
    rooms: (p.roomGridData.masterRooms || []).map(r => {
      const sizeFeature = (r.features || []).find(f => f.symbol === 'ficon-sqm');
      const size = sizeFeature ? sizeFeature.title.replace(/^客房面積：/, '') : null;
      const beds = (r.bedroomLayouts || []).flatMap(layout =>
        (layout.bedrooms || []).flatMap(bedroom =>
          (bedroom.beds || []).filter(bed => bed.name).map(bed => bed.name)
        )
      );
      const offers = (r.rooms || [])
        .filter(o => o.isFit !== false)
        .map(o => {
          const bens = (o.benefits || [])
            .filter(b => b.isAvailable && b.title)
            .map(b => b.title);
          if (o.isFreeCancellation && o.cancellation?.title) bens.push(o.cancellation.title);
          if (o.payLater?.isAvailable)
            bens.push((o.payLater.hasDescription && o.payLater.description) || o.payLater.title);
          const ds      = o.pricing?.displaySummary?.perNight;
          const afterCb = ds?.displayAfterCashback;
          const apsVal  = o.apsPeekViewModel?.apsPriceValue;
          let priceAmt;
          if (apsVal && afterCb?.exclusive) {
            priceAmt = apsVal * (afterCb.allInclusive / afterCb.exclusive);
          } else {
            priceAmt = afterCb?.allInclusive
              ?? ds?.chargeTotal?.allInclusive
              ?? o.pricing?.displayPrice;
          }
          return { price: { amount: Math.round(priceAmt) }, benefits: bens };
        })
        .filter(o => o.price.amount > 0);
      return { name: r.name, isSoldOut: offers.length === 0, size, beds, offers };
    }).filter(r => r.offers.length > 0),
  };
}

async function fetchPricesInContext(browser, pageUrl) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    // Currency is controlled by cookie, not the currencyCode= URL param (which Agoda ignores).
    await context.addCookies([{
      name:   'agoda.version.03',
      value:  `CookieId=${crypto.randomUUID()}&DLang=zh-tw&CurLabel=${currency}&CuCur=${CURRENCY_ID[currency] ?? 28}`,
      domain: '.agoda.com',
      path:   '/',
    }]);
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.propertyPageParams?.roomGridData?.masterRooms,
      { timeout: 15000 }
    );
    return await page.evaluate(extractRoomData);
  } finally {
    await context.close();
  }
}

// — Helpers for benefit normalization, size parsing, and price metadata —

// Normalize a benefit string so that semantically identical phrases from different
// partners produce the same grouping key, e.g.:
//   "2026年5月19日 星期二前無須付款"  (regular / JCB)
//   "可延至2026年5月19日 星期二扣款"  (mctaishinbusiness)
// are treated as the same benefit.
function normalizeBenefit(b) {
  b = b.replace(/。$/, '');                            // strip trailing 。
  b = b.replace(/^可延至(.+?)扣款$/, '$1前無須付款'); // normalize pay-later phrasing
  return b;
}

function parseSizeM2(size) {
  if (!size) return Infinity;
  const m = size.match(/(\d+)平方公尺/);
  return m ? parseInt(m[1], 10) : Infinity;
}

function isCancellable(offer) {
  return offer.benefits.some(b => b.includes('可免費取消'));
}

function hasDinner(offer) {
  return offer.benefits.some(b => /晚餐|一泊二食/.test(b));
}

function hasBreakfast(offer) {
  return offer.benefits.some(b => /早餐/.test(b));
}

function getMealCategory(offer) {
  if (hasDinner(offer)) return 'withDinner';
  if (hasBreakfast(offer)) return 'withBreakfast';
  return 'noMeal';
}

const MEAL_CATEGORIES = ['noMeal', 'withBreakfast', 'withDinner'];

// — Consolidate results from all partners —
function consolidate(entries, partnerResults) {
  // bookingUrls: one per partner
  const bookingUrls = Object.fromEntries(entries.map(e => [e.key, e.url]));

  // Collect room names in order of first appearance across all partners
  const roomOrder = [];
  const roomSeen  = new Set();
  partnerResults.forEach(partnerData => {
    (partnerData.rooms || []).forEach(r => {
      if (!roomSeen.has(r.name)) { roomSeen.add(r.name); roomOrder.push(r.name); }
    });
  });

  const rooms = roomOrder.map(roomName => {
    // Room metadata from first partner that has it
    let meta = null;
    for (const partnerData of partnerResults) {
      const r = (partnerData.rooms || []).find(room => room.name === roomName);
      if (r) { meta = r; break; }
    }

    if (allOffers) {
      // All-offers mode: group by normalized benefit key, keep lowest price per partner
      const offerMap = new Map();
      entries.forEach((partner, idx) => {
        const room = (partnerResults[idx].rooms || []).find(r => r.name === roomName);
        if (!room) return;
        (room.offers || []).forEach(offer => {
          const normalizedKey = JSON.stringify([...offer.benefits].map(normalizeBenefit).sort());
          if (!offerMap.has(normalizedKey)) offerMap.set(normalizedKey, { benefits: offer.benefits, prices: {} });
          const slot = offerMap.get(normalizedKey);
          if (!(partner.key in slot.prices) || offer.price.amount < slot.prices[partner.key])
            slot.prices[partner.key] = offer.price.amount;
        });
      });

      return { name: meta.name, size: meta.size, beds: meta.beds, offers: [...offerMap.values()] };
    }

    // Default mode: for each meal category (noMeal / withBreakfast / withDinner),
    // emit the cheapest offer; if it is non-cancellable, also emit the cheapest
    // cancellable offer in that category.
    const cheapestByCategory  = {};
    const cheapestCancellable = {};

    entries.forEach((partner, idx) => {
      const room = (partnerResults[idx].rooms || []).find(r => r.name === roomName);
      if (!room) return;
      (room.offers || []).forEach(offer => {
        const cat       = getMealCategory(offer);
        const price     = offer.price.amount;
        const cancellable = isCancellable(offer);

        if (!cheapestByCategory[cat] || price < cheapestByCategory[cat].price)
          cheapestByCategory[cat] = { price, partner: partner.key, benefits: offer.benefits, cancellable };

        if (cancellable && (!cheapestCancellable[cat] || price < cheapestCancellable[cat].price))
          cheapestCancellable[cat] = { price, partner: partner.key, benefits: offer.benefits };
      });
    });

    const offers = [];
    for (const cat of MEAL_CATEGORIES) {
      const best = cheapestByCategory[cat];
      if (!best) continue;
      offers.push({ benefits: best.benefits, prices: { [best.partner]: best.price } });
      if (!best.cancellable && cheapestCancellable[cat])
        offers.push({ benefits: cheapestCancellable[cat].benefits, prices: { [cheapestCancellable[cat].partner]: cheapestCancellable[cat].price } });
    }

    return { name: meta.name, size: meta.size, beds: meta.beds, offers };
  }).filter(r => r.offers.length > 0);

  // Sort rooms by size ascending; rooms with unknown size go last
  rooms.sort((a, b) => parseSizeM2(a.size) - parseSizeM2(b.size));

  return { bookingUrls, rooms };
}

async function modePrice(apiKey) {
  process.stderr.write('[agoda] fetching hotel page url and partner cids...\n');

  const urlPartners = PARTNERS.filter(p => p.url);
  const dynPartners = PARTNERS.filter(p => p.cidFetcher);

  // Fire URL CID fetches immediately — independent of the cityId/slug chain
  const urlCidsPromise = Promise.all(urlPartners.map(p => fetchCidFromUrl(p.url)));

  // Sequential chain: cityId → slug (now truly async, runs in parallel with urlCidsPromise)
  const cityId = await getCityId(apiKey);
  if (!cityId) { console.error('Error: could not resolve cityId for property', idArg); process.exit(1); }

  const slug = await getPropertySlug(cityId, apiKey);
  if (!slug) { console.error('Error: could not resolve page slug for property', idArg); process.exit(1); }

  const los     = Math.round((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24));
  const baseUrl = `https://www.agoda.com/zh-tw${slug}?checkIn=${checkin}&los=${los}&adults=${adults}&children=${children}&rooms=${rooms}&currencyCode=${currency}`;

  const hotelName = hotelNameFromSlug(slug);

  // Fetch dynamic CIDs (google) and wait for URL CIDs in parallel
  const [dynCidResults, urlCids] = await Promise.all([
    Promise.allSettled(dynPartners.map(p => p.cidFetcher(hotelName, checkin, checkout))),
    urlCidsPromise,
  ]);

  const cidByKey = {};
  urlPartners.forEach((p, i) => { cidByKey[p.key] = urlCids[i]; });
  dynPartners.forEach((p, i) => {
    const r = dynCidResults[i];
    if (r.status === 'fulfilled') cidByKey[p.key] = r.value;
    else process.stderr.write(`[agoda] warning: skipping ${p.key} — ${r.reason?.message}\n`);
  });

  // Build entries in PARTNERS order, excluding any that failed
  const entries = PARTNERS
    .filter(p => p.key in cidByKey)
    .map(p => ({ key: p.key, url: `${baseUrl}&cid=${cidByKey[p.key]}` }));

  const cidLog = entries.map(e => `${e.key}=${cidByKey[e.key]}`).join(', ');
  process.stderr.write(`[agoda] launching browsers in parallel (${cidLog})...\n`);

  const browser = await chromium.launch(buildLaunchOptions());
  const settled = await Promise.allSettled(
    entries.map(e => fetchPricesInContext(browser, e.url))
  ).finally(() => browser.close());
  const failures = settled
    .map((r, i) => ({ ...r, key: entries[i].key }))
    .filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    for (const f of failures) console.error(`Error (${f.key}): ${f.reason?.message || f.reason}`);
    process.exit(1);
  }
  const partnerResults = settled.map(r => r.value);

  const first      = partnerResults[0];
  const { bookingUrls, rooms: consolidatedRooms } = consolidate(entries, partnerResults);

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
    await modeSuggest(apiKey);
  } else if (idArg && checkin && checkout) {
    const apiKey = await getApiKey();
    await modePrice(apiKey);
  } else {
    console.error(
      'Usage:\n' +
      '  node agoda.js --name "hotel name"                                     # suggest\n' +
      '  node agoda.js --id ID --checkin YYYY-MM-DD --checkout YYYY-MM-DD \\   # price (4 best-price slots per room)\n' +
      '    [--adults 2] [--children 0] [--rooms 1] [--currency TWD]\n' +
      '  node agoda.js --id ID --checkin YYYY-MM-DD --checkout YYYY-MM-DD \\   # price (all offers, per-partner prices)\n' +
      '    [--adults 2] [--children 0] [--rooms 1] [--currency TWD] --all_offers'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
