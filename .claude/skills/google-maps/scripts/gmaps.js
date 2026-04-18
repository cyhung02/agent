#!/usr/bin/env node
// Google Maps Platform script — all APIs via Cloudflare Worker proxy
// Usage: node gmaps.js <command> [options]
// Commands: route, matrix, geocode, reverse, search, nearby, place, photos

const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const BASE = 'https://routes.cyhung02.workers.dev';

const PLACES_FIELDMASK       = 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus,places.primaryTypeDisplayName';
const PLACE_DETAIL_FIELDMASK = 'id,displayName,formattedAddress,location,googleMapsUri,businessStatus,primaryTypeDisplayName';
const ROUTE_FIELDMASK        = 'routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters';
const ROUTE_TRANSIT_FIELDMASK = ROUTE_FIELDMASK + ',routes.legs.steps.transitDetails,routes.legs.steps.navigationInstruction';
const MATRIX_FIELDMASK       = 'originIndex,destinationIndex,duration,distanceMeters,status,condition';

const RATING_CACHE_PATH = path.join(os.homedir(), '.gmaps-rating-cache.json');

// Used to validate the cache before each use and to capture the pb zoom value
const KNOWN_PLACE = {
  id:             'ChIJtxODuv6LGGAR7KPIhM48Zz0',
  name:           '星巴克 JR東海 東京車站新幹線南月台內店',
  lat:            35.680488,
  lng:            139.7675915,
  expectedRating: 3.7,
};

// --- HTTP helpers (curl for proxy compatibility) ---

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function curlRaw(args) {
  while (true) {
    const result = execFileSync('curl', args, { encoding: 'utf8' });
    if (result.includes('DNS cache overflow')) { sleep(5000); continue; }
    return result;
  }
}

function curlGet(url, fieldMask) {
  const flags = ['-s', '--fail'];
  if (fieldMask) flags.push('-H', `X-Goog-FieldMask: ${fieldMask}`);
  return curlRaw([...flags, url]);
}

function curlPost(url, fieldMask, body) {
  return curlRaw([
    '-s', '--fail',
    '-X', 'POST',
    '-H', `X-Goog-FieldMask: ${fieldMask}`,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify(body),
    url,
  ]);
}

// --- Argument parser ---

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = key in args ? [].concat(args[key], val) : val;
    } else {
      positional.push(argv[i]);
    }
  }
  return { args, positional };
}

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

// --- Output normalizers ---

function stripMapsUri(uri) {
  if (!uri) return null;
  const u = new URL(uri);
  u.searchParams.delete('g_mp');
  return u.toString();
}

function normalizePlaces(data) {
  return (data.places || []).map(p => ({
    id:              p.id,
    name:            p.displayName?.text ?? '',
    address:         p.formattedAddress ?? '',
    location:        p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    mapsUri:         stripMapsUri(p.googleMapsUri),
    businessStatus:  p.businessStatus ?? null,
    typeDisplayName: p.primaryTypeDisplayName?.text ?? null,
  }));
}

// --- Rating helpers ---

// Converts a ChIJ-prefixed place ID to the 0xHIGH:0xLOW hex format used in Maps pb params.
// The base64url payload (after skipping the 4-char 'ChIJ' prefix) is a 17-byte protobuf:
//   bytes 0-7  = high uint64 (little-endian)
//   byte  8    = 0x11 field tag (field 2, wire type 1)
//   bytes 9-16 = low uint64 (little-endian)
function chijToHex(id) {
  const buf = Buffer.from(id.slice(4), 'base64url');
  const high = buf.readBigUInt64LE(0);
  const low  = buf.readBigUInt64LE(9);
  return `0x${high.toString(16)}:0x${low.toString(16)}`;
}

// Builds the pb parameter for maps/preview/place using the zoom value captured from a real
// browser request. The 14-token message format was verified against live Google Maps traffic.
function buildPb(zoom, hexId, name, lat, lng) {
  const encodedName = Buffer.from(name).toString('base64url');
  return `!1m14!1s${hexId}!2z${encodedName}!3m8!1m3!1d${zoom}!2d${lng}!3d${lat}!3m2!1i1024!2i768!4f13.1!4m2!3d${lat}!4d${lng}`;
}

async function fetchSingleRating(cache, id, name, lat, lng) {
  const hexId = chijToHex(id);
  const pb    = buildPb(cache.zoom, hexId, name, lat, lng);
  const cookieHeader = cache.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const url = `https://www.google.com/maps/preview/place?authuser=0&hl=en&gl=us&q=${encodeURIComponent(name)}&pb=${encodeURIComponent(pb)}`;
  const { stdout } = await execFileAsync('curl', [
    '-s', '--fail', '--compressed',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-H', `Cookie: ${cookieHeader}`,
    url,
  ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  const m = stdout.match(/(?:,null){2,4},([\d.]+),(\d{2,6})[,\]]/);
  if (!m) return { rating: null, userRatingCount: null };
  return { rating: parseFloat(m[1]), userRatingCount: parseInt(m[2], 10) };
}

async function validateCache(cache) {
  try {
    const r = await fetchSingleRating(
      cache, KNOWN_PLACE.id, KNOWN_PLACE.name, KNOWN_PLACE.lat, KNOWN_PLACE.lng,
    );
    return r.rating !== null && Math.abs(r.rating - KNOWN_PLACE.expectedRating) < 0.5;
  } catch {
    return false;
  }
}

// Launches a headless browser, navigates to the known place on Google Maps, intercepts
// the internal maps/preview/place request to extract the real zoom value, and saves cookies.
async function refreshRatingCache() {
  const { chromium } = require('playwright');
  process.stderr.write('[gmaps] refreshing rating cache via Playwright...\n');

  const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || '';
  let proxy;
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    proxy = { server: `${u.protocol}//${u.hostname}:${u.port}`, username: u.username || '', password: u.password || '' };
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: false, proxy });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const reqPromise = page.waitForRequest(
      req => req.url().includes('/maps/preview/place'),
      { timeout: 30000 },
    );
    // place_id: URL reliably loads the place detail panel and triggers maps/preview/place
    await page.goto(
      `https://www.google.com/maps?q=place_id:${KNOWN_PLACE.id}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 },
    );
    const intercepted  = await reqPromise;
    const capturedPb   = new URL(intercepted.url()).searchParams.get('pb');
    if (!capturedPb) throw new Error('pb parameter not found in intercepted request');

    // Extract only the zoom value; everything else is reconstructed from the formula
    const zoomMatch = capturedPb.match(/!3m8!1m3!1d([0-9.]+)/);
    const zoom      = zoomMatch ? zoomMatch[1] : '1000';

    const cookies = await context.cookies(['https://www.google.com']);
    await browser.close();

    const cache = { cookies, zoom, savedAt: Date.now() };
    fs.writeFileSync(RATING_CACHE_PATH, JSON.stringify(cache));
    return cache;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function getCache() {
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(RATING_CACHE_PATH, 'utf8')); } catch {}
  if (cache && await validateCache(cache)) return cache;
  cache = await refreshRatingCache();
  // Skip post-refresh validation to avoid immediate re-validation hitting rate limits.
  // The next call will validate naturally; if cookies are broken, refresh will re-run.
  return cache;
}

async function fetchRatings(places) {
  const cache   = await getCache();
  const results = await Promise.all(
    places.map(p => {
      if (!p.id || !p.location) return Promise.resolve({ rating: null, userRatingCount: null });
      return fetchSingleRating(cache, p.id, p.name, p.location.lat, p.location.lng)
        .catch(() => ({ rating: null, userRatingCount: null }));
    }),
  );
  return places.map((p, i) => ({ ...p, ...results[i] }));
}

// --- Main ---

const [,, command, ...rest] = process.argv;
if (!command) die('Usage: node gmaps.js <command> [options]\nCommands: route, matrix, geocode, reverse, search, nearby, place, photos');

const { args, positional } = parseArgs(rest);

(async () => {
  switch (command) {

    case 'route': {
      const fromLat = args['from-lat'] ?? die('--from-lat required');
      const fromLng = args['from-lng'] ?? die('--from-lng required');
      const toLat   = args['to-lat']   ?? die('--to-lat required');
      const toLng   = args['to-lng']   ?? die('--to-lng required');
      const mode      = (args.mode ?? 'WALK').toUpperCase();
      const isTransit = mode === 'TRANSIT';

      const body = {
        origin:      { location: { latLng: { latitude: +fromLat, longitude: +fromLng } } },
        destination: { location: { latLng: { latitude: +toLat,   longitude: +toLng   } } },
        travelMode: mode,
        computeAlternativeRoutes: isTransit || !!args.alternatives,
        languageCode: 'zh-TW',
      };

      const fieldMask = isTransit ? ROUTE_TRANSIT_FIELDMASK : ROUTE_FIELDMASK;
      const raw = JSON.parse(curlPost(`${BASE}/computeRoutes`, fieldMask, body));
      const routes = (raw.routes ?? []).map(r => ({
        duration:      r.duration,
        distanceMeters: r.distanceMeters,
        legs: (r.legs ?? []).map(l => ({
          duration:      l.duration,
          distanceMeters: l.distanceMeters,
          steps: (l.steps ?? []).map(s => ({
            transitDetails: s.transitDetails ?? null,
            instruction:    s.navigationInstruction?.instructions ?? null,
          })).filter(s => s.transitDetails || s.instruction),
        })),
      }));

      console.log(JSON.stringify(isTransit ? routes : (routes[0] ?? null)));
      break;
    }

    case 'matrix': {
      const origins      = [].concat(args.origins      ?? die('--origins required'));
      const destinations = [].concat(args.destinations ?? die('--destinations required'));
      const mode = (args.mode ?? 'DRIVE').toUpperCase();

      const toWaypoint = coord => {
        const [lat, lng] = coord.split(',').map(Number);
        return { waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } };
      };

      const body = {
        origins:      origins.map(toWaypoint),
        destinations: destinations.map(toWaypoint),
        travelMode: mode,
        languageCode: 'zh-TW',
      };

      const raw    = JSON.parse(curlPost(`${BASE}/computeRouteMatrix`, MATRIX_FIELDMASK, body));
      const result = (Array.isArray(raw) ? raw : []).map(e => ({
        originIndex:      e.originIndex,
        destinationIndex: e.destinationIndex,
        duration:         e.duration,
        distanceMeters:   e.distanceMeters,
        condition:        e.condition,
      }));
      console.log(JSON.stringify(result));
      break;
    }

    case 'geocode': {
      const address = positional[0] ?? die('address required');
      const url = new URL(`${BASE}/maps/api/geocode/json`);
      url.searchParams.set('address', address);
      url.searchParams.set('language', 'zh-TW');
      const raw = JSON.parse(curlGet(url.toString()));
      if (raw.status !== 'OK') die(`Geocoding failed: ${raw.status}`);
      const r = raw.results[0];
      console.log(JSON.stringify({
        address:  r.formatted_address,
        location: { lat: r.geometry.location.lat, lng: r.geometry.location.lng },
        placeId:  r.place_id,
      }));
      break;
    }

    case 'reverse': {
      const lat = positional[0] ?? die('lat required');
      const lng = positional[1] ?? die('lng required');
      const url = new URL(`${BASE}/maps/api/geocode/json`);
      url.searchParams.set('latlng', `${lat},${lng}`);
      url.searchParams.set('language', 'zh-TW');
      const raw = JSON.parse(curlGet(url.toString()));
      if (raw.status !== 'OK') die(`Reverse geocoding failed: ${raw.status}`);
      const r = raw.results[0];
      console.log(JSON.stringify({
        address:  r.formatted_address,
        location: { lat: r.geometry.location.lat, lng: r.geometry.location.lng },
        placeId:  r.place_id,
      }));
      break;
    }

    case 'search': {
      const query = positional[0] ?? die('query required');
      const n     = parseInt(args.n ?? '5');
      const body  = { textQuery: query, maxResultCount: n, languageCode: args.language ?? 'zh-TW' };
      if (args['min-rating']) body.minRating = parseFloat(args['min-rating']);
      if (args.lat && args.lng) {
        body.locationBias = {
          circle: {
            center: { latitude: +args.lat, longitude: +args.lng },
            radius: +(args.radius ?? 500),
          },
        };
      }
      const raw = JSON.parse(curlPost(`${BASE}/v1/places:searchText`, PLACES_FIELDMASK, body));
      if (raw.error) die(`Places API error: ${JSON.stringify(raw.error)}`);
      const places = normalizePlaces(raw);
      console.log(JSON.stringify(args['no-rating'] ? places : await fetchRatings(places)));
      break;
    }

    case 'nearby': {
      const lat    = args.lat    ?? die('--lat required');
      const lng    = args.lng    ?? die('--lng required');
      const radius = args.radius ?? die('--radius required');
      const types  = (args.types ?? die('--types required')).split(',').map(t => t.trim());
      const n      = parseInt(args.n ?? '5');
      const body   = {
        includedTypes: types,
        maxResultCount: n,
        languageCode: args.language ?? 'zh-TW',
        locationRestriction: {
          circle: {
            center: { latitude: +lat, longitude: +lng },
            radius: +radius,
          },
        },
      };
      const raw = JSON.parse(curlPost(`${BASE}/v1/places:searchNearby`, PLACES_FIELDMASK, body));
      if (raw.error) die(`Places API error: ${JSON.stringify(raw.error)}`);
      const places = normalizePlaces(raw);
      console.log(JSON.stringify(args['no-rating'] ? places : await fetchRatings(places)));
      break;
    }

    case 'place': {
      const id   = positional[0] ?? die('place_id required');
      const lang = args.language ?? 'zh-TW';
      const raw  = JSON.parse(curlGet(`${BASE}/v1/places/${id}?languageCode=${lang}`, PLACE_DETAIL_FIELDMASK));
      if (raw.error) die(`Places API error: ${JSON.stringify(raw.error)}`);
      const placeData = {
        id:              raw.id,
        name:            raw.displayName?.text ?? '',
        address:         raw.formattedAddress ?? '',
        location:        raw.location ? { lat: raw.location.latitude, lng: raw.location.longitude } : null,
        mapsUri:         stripMapsUri(raw.googleMapsUri),
        businessStatus:  raw.businessStatus ?? null,
        typeDisplayName: raw.primaryTypeDisplayName?.text ?? null,
      };
      if (!args['no-rating'] && placeData.id && placeData.location) {
        const rated = await fetchRatings([placeData]);
        console.log(JSON.stringify(rated[0]));
      } else {
        console.log(JSON.stringify(placeData));
      }
      break;
    }

    case 'photos': {
      const id        = positional[0] ?? die('place_id required');
      const maxHeight = args['max-height'] ?? '800';
      const n         = parseInt(args.n ?? '3');

      const detail     = JSON.parse(curlGet(`${BASE}/v1/places/${id}`, 'displayName,photos'));
      const photoNames = (detail.photos ?? []).slice(0, n).map(p => p.name);
      if (photoNames.length === 0) { console.log(JSON.stringify([])); break; }

      const uris = photoNames.map(name => {
        const url = `${BASE}/v1/${name}/media?maxHeightPx=${maxHeight}&skipHttpRedirect=true`;
        const res = JSON.parse(curlGet(url));
        return res.photoUri ?? null;
      }).filter(Boolean);

      console.log(JSON.stringify(uris));
      break;
    }

    default:
      die(`Unknown command: ${command}\nCommands: route, matrix, geocode, reverse, search, nearby, place, photos`);
  }
})().catch(err => {
  process.stderr.write((err.message ?? String(err)) + '\n');
  process.exit(1);
});
