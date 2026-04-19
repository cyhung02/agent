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
const ROUTE_BASE_FIELDMASK         = 'routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters';
const ROUTE_STEPS_FIELDMASK        = ROUTE_BASE_FIELDMASK + ',routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction';
const ROUTE_TRANSIT_FIELDMASK      = ROUTE_BASE_FIELDMASK + ',routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.transitDetails';
const ROUTE_TRANSIT_FULL_FIELDMASK = ROUTE_TRANSIT_FIELDMASK + ',routes.legs.steps.navigationInstruction';
const MATRIX_FIELDMASK       = 'originIndex,destinationIndex,duration,distanceMeters,status,condition';

const COOKIE_PATH = path.join(os.homedir(), '.gmaps-cookie.json');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// --- HTTP helpers (curl for proxy compatibility) ---

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function curlRaw(args) {
  while (true) {
    const { stdout } = await execFileAsync('curl', args, { encoding: 'utf8' });
    if (stdout.includes('DNS cache overflow')) { await sleep(5000); continue; }
    return stdout;
  }
}

async function curlGet(url, fieldMask) {
  const flags = ['-s', '--fail'];
  if (fieldMask) flags.push('-H', `X-Goog-FieldMask: ${fieldMask}`);
  return curlRaw([...flags, url]);
}

async function curlPost(url, fieldMask, body, extraHeaders = []) {
  const headerFlags = extraHeaders.flatMap(h => ['-H', h]);
  return curlRaw([
    '-s', '--fail',
    '-X', 'POST',
    '-H', `X-Goog-FieldMask: ${fieldMask}`,
    '-H', 'Content-Type: application/json',
    ...headerFlags,
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

const ALLOWED_MODES = new Set(['WALK', 'DRIVE', 'BICYCLE', 'TRANSIT']);

function checkMode(mode) {
  if (!ALLOWED_MODES.has(mode)) die(`unsupported mode: ${mode}`);
  return mode;
}

function parsePoint(str, flag) {
  if (typeof str !== 'string') die(`${flag} required (format: "lat,lng")`);
  const [lat, lng] = str.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) die(`${flag} must be "lat,lng"`);
  return { lat, lng };
}

function parsePoints(str, flag) {
  if (typeof str !== 'string') die(`${flag} required (format: "lat,lng;lat,lng;...")`);
  return str.split(';').map(s => parsePoint(s.trim(), flag));
}

// --- Formatters ---

function formatDuration(secStr) {
  const total = parseInt(secStr, 10);
  if (!Number.isFinite(total)) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(h + 'h');
  if (m || (h && s)) parts.push(m + 'm');
  if (s || (!h && !m)) parts.push(s + 's');
  return parts.join('');
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return null;
  return meters >= 1000 ? (meters / 1000).toFixed(1) + 'km' : meters + 'm';
}

function normalizeTransit(t) {
  if (!t) return null;
  const line    = t.transitLine ?? {};
  const vehicle = line.vehicle ?? {};
  const stops   = t.stopDetails ?? {};
  const loc = p => p?.location?.latLng
    ? { lat: p.location.latLng.latitude, lng: p.location.latLng.longitude }
    : null;
  const isBus = vehicle.type === 'BUS';
  const lineName = isBus && line.nameShort && line.nameShort !== line.name
    ? `${line.nameShort} ${line.name}`
    : (line.name ?? null);
  return {
    line:        lineName,
    headsign:    t.headsign ?? null,
    vehicleType: vehicle.type ?? null,
    from: { name: stops.departureStop?.name ?? null, location: loc(stops.departureStop), time: stops.departureTime ?? null },
    to:   { name: stops.arrivalStop?.name   ?? null, location: loc(stops.arrivalStop),   time: stops.arrivalTime   ?? null },
    stopCount:   t.stopCount ?? null,
  };
}

// Merge adjacent walking steps (no transit field) by summing seconds + metres.
function mergeWalkSteps(steps) {
  const out = [];
  let walkSec = 0, walkM = 0;
  const flush = () => {
    if (walkSec || walkM) {
      out.push({ duration: formatDuration(walkSec + 's'), distance: formatDistance(walkM) });
      walkSec = 0; walkM = 0;
    }
  };
  for (const s of steps) {
    if (s.transit) {
      flush();
      out.push(s);
    } else {
      walkSec += s._sec ?? 0;
      walkM   += s._m   ?? 0;
    }
  }
  flush();
  return out;
}

// --- Output normalizers ---

function stripMapsUri(uri) {
  if (!uri) return null;
  const u = new URL(uri);
  u.searchParams.delete('g_mp');
  return u.toString();
}

function normalizePlace(p) {
  return {
    id:              p.id,
    name:            p.displayName?.text ?? '',
    address:         p.formattedAddress ?? '',
    location:        p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    mapsUri:         stripMapsUri(p.googleMapsUri),
    businessStatus:  p.businessStatus ?? null,
    typeDisplayName: p.primaryTypeDisplayName?.text ?? null,
  };
}

function normalizePlaces(data) {
  return (data.places || []).map(normalizePlace);
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

// Minimal pb: only hexId and location are required (ablation-tested).
function buildPb(hexId, lat, lng) {
  return `!1m7!1s${hexId}!3m5!1m3!1d0!2d${lng}!3d${lat}!4f13.1`;
}

async function fetchSinglePlaceInfo(cache, id, name, lat, lng, lang = 'zh-TW') {
  const hexId = chijToHex(id);
  const pb    = buildPb(hexId, lat, lng);
  const cookieHeader = cache.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const url = `https://www.google.com/maps/preview/place?authuser=0&hl=${lang}&q=${encodeURIComponent(name)}&pb=${encodeURIComponent(pb)}`;
  const { stdout } = await execFileAsync('curl', [
    '-s', '--fail', '--compressed',
    '-H', `Accept-Language: ${lang};q=1.0`,
    '-H', `Cookie: ${cookieHeader}`,
    url,
  ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  const ratingMatch  = stdout.match(/(?:,null){2,4},([\d.]+),(\d{2,6})[,\]]/);
  const phoneMatch   = stdout.match(/call_googblue_24dp\.png","(\+[\d\s\-]+\d)"/);
  const websiteMatch = stdout.match(/\/url\?q\\u003d(https?:\/\/[^\\]+)\\u0026/);
  const statusMatch  = stdout.match(/schedule_googblue_24dp\.png","([^"]+)"/);
  return {
    rating:          ratingMatch  ? parseFloat(ratingMatch[1])       : null,
    userRatingCount: ratingMatch  ? parseInt(ratingMatch[2], 10)     : null,
    phone:           phoneMatch   ? phoneMatch[1]                    : null,
    website:         websiteMatch ? websiteMatch[1]                  : null,
    openingStatus:   statusMatch  ? statusMatch[1].replace(/\u202f/g, ' ') : null,
  };
}

async function refreshCookies() {
  const { chromium } = require('playwright');
  process.stderr.write('[gmaps] refreshing cookies via Playwright...\n');

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
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const cookies = await context.cookies(['https://www.google.com']);

    const cache = { cookies, savedAt: Date.now() };
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(cache));
    // Google needs a moment after cookie issuance before preview/place returns full data.
    await sleep(2000);
    await fetchSinglePlaceInfo(cache, 'ChIJtxODuv6LGGAR7KPIhM48Zz0', '', 35.680488, 139.7675915).catch(() => {});
    return cache;
  } finally {
    await browser.close();
  }
}

let cookieCache = null;

async function getCookies() {
  if (cookieCache && (Date.now() - cookieCache.savedAt) < CACHE_TTL_MS) return cookieCache;
  try { cookieCache = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8')); } catch {}
  if (cookieCache && (Date.now() - cookieCache.savedAt) < CACHE_TTL_MS) return cookieCache;
  cookieCache = await refreshCookies();
  return cookieCache;
}

async function fetchPlaceInfo(places, lang = 'zh-TW') {
  const cache   = await getCookies();
  const results = await Promise.all(
    places.map(p => {
      if (!p.id || !p.location) return Promise.resolve({ rating: null, userRatingCount: null });
      return fetchSinglePlaceInfo(cache, p.id, p.name, p.location.lat, p.location.lng, lang)
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
      const from = parsePoint(args.from, '--from');
      const to   = parsePoint(args.to,   '--to');
      const mode = checkMode((args.mode ?? 'WALK').toUpperCase());
      const isTransit = mode === 'TRANSIT';
      const wantSteps = !!args.steps;

      const body = {
        origin:      { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat,   longitude: to.lng   } } },
        travelMode: mode,
        computeAlternativeRoutes: isTransit,
        languageCode: 'zh-TW',
      };

      if (args.via) {
        const points = parsePoints(args.via, '--via');
        if (points.length > 25) die('--via supports at most 25 points');
        body.intermediates = points.map(p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } }));
      }

      if (args['optimize-waypoints']) body.optimizeWaypointOrder = true;

      if (args.traffic) {
        if (mode !== 'DRIVE') die('--traffic requires --mode DRIVE');
        body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      }

      let fieldMask = isTransit
        ? (wantSteps ? ROUTE_TRANSIT_FULL_FIELDMASK : ROUTE_TRANSIT_FIELDMASK)
        : (wantSteps ? ROUTE_STEPS_FIELDMASK        : ROUTE_BASE_FIELDMASK);
      const extraHeaders = [];
      if (body.optimizeWaypointOrder) {
        fieldMask += ',routes.optimizedIntermediateWaypointIndex';
        extraHeaders.push('X-Server-Timeout: 10');
      }

      const raw = JSON.parse(await curlPost(`${BASE}/computeRoutes`, fieldMask, body, extraHeaders));

      const buildStep = s => {
        const sec = parseInt(s.staticDuration, 10);
        const m   = s.distanceMeters ?? 0;
        const out = {
          duration: formatDuration(s.staticDuration),
          distance: formatDistance(m),
          _sec: Number.isFinite(sec) ? sec : 0,
          _m:   m,
        };
        const transit = normalizeTransit(s.transitDetails);
        if (transit) out.transit = transit;
        if (wantSteps && s.navigationInstruction?.instructions) {
          out.instruction = s.navigationInstruction.instructions;
        }
        return out;
      };

      const stripPrivate = ({ _sec, _m, ...rest }) => rest;

      const buildLeg = l => {
        let steps = (l.steps ?? []).map(buildStep);
        if (isTransit && !wantSteps) steps = mergeWalkSteps(steps);
        const leg = {
          duration: formatDuration(l.duration),
          distance: formatDistance(l.distanceMeters),
        };
        if (isTransit || wantSteps) leg.steps = steps.map(stripPrivate);
        return leg;
      };

      const routes = (raw.routes ?? []).map(r => {
        const legs = (r.legs ?? []).map(buildLeg);
        const routeOut = {
          duration: formatDuration(r.duration),
          distance: formatDistance(r.distanceMeters),
        };
        if (r.optimizedIntermediateWaypointIndex) {
          routeOut.optimizedOrder = r.optimizedIntermediateWaypointIndex;
        }
        if (legs.length === 1) {
          if (legs[0].steps) routeOut.steps = legs[0].steps;
        } else if (legs.length > 1) {
          routeOut.legs = legs;
        }
        return routeOut;
      });

      console.log(JSON.stringify(isTransit ? routes : (routes[0] ?? null)));
      break;
    }

    case 'matrix': {
      const origins      = parsePoints(args.origins,      '--origins');
      const destinations = parsePoints(args.destinations, '--destinations');
      const mode = checkMode((args.mode ?? 'DRIVE').toUpperCase());

      const toWaypoint = p => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

      const body = {
        origins:      origins.map(toWaypoint),
        destinations: destinations.map(toWaypoint),
        travelMode: mode,
        languageCode: 'zh-TW',
      };

      if (args.traffic) {
        if (mode !== 'DRIVE') die('--traffic requires --mode DRIVE');
        body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      }

      const raw    = JSON.parse(await curlPost(`${BASE}/computeRouteMatrix`, MATRIX_FIELDMASK, body));
      const result = (Array.isArray(raw) ? raw : []).map(e => ({
        originIndex:      e.originIndex,
        destinationIndex: e.destinationIndex,
        duration:         formatDuration(e.duration),
        distance:         formatDistance(e.distanceMeters),
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
      const raw = JSON.parse(await curlGet(url.toString()));
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
      const raw = JSON.parse(await curlGet(url.toString()));
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
      const n     = parseInt(args.n ?? '5', 10);
      const body  = { textQuery: query, maxResultCount: n, languageCode: args.language ?? 'zh-TW' };
      if (args['min-rating']) body.minRating = parseFloat(args['min-rating']);
      if (args.at) {
        const at = parsePoint(args.at, '--at');
        body.locationBias = {
          circle: {
            center: { latitude: at.lat, longitude: at.lng },
            radius: +(args.radius ?? 500),
          },
        };
      }
      const raw = JSON.parse(await curlPost(`${BASE}/v1/places:searchText`, PLACES_FIELDMASK, body));
      if (raw.error) die(`Places API error: ${JSON.stringify(raw.error)}`);
      const places = normalizePlaces(raw);
      console.log(JSON.stringify(await fetchPlaceInfo(places, args.language ?? 'zh-TW')));
      break;
    }

    case 'nearby': {
      const at     = parsePoint(args.at, '--at');
      const radius = args.radius ?? die('--radius required');
      const types  = (args.types ?? die('--types required')).split(',').map(t => t.trim());
      const n      = parseInt(args.n ?? '5', 10);
      const body   = {
        includedTypes: types,
        maxResultCount: n,
        languageCode: args.language ?? 'zh-TW',
        locationRestriction: {
          circle: {
            center: { latitude: at.lat, longitude: at.lng },
            radius: +radius,
          },
        },
      };
      const raw = JSON.parse(await curlPost(`${BASE}/v1/places:searchNearby`, PLACES_FIELDMASK, body));
      if (raw.error) die(`Places API error: ${JSON.stringify(raw.error)}`);
      const places = normalizePlaces(raw);
      console.log(JSON.stringify(await fetchPlaceInfo(places, args.language ?? 'zh-TW')));
      break;
    }

    case 'place': {
      const id   = positional[0] ?? die('place_id required');
      const lang = args.language ?? 'zh-TW';
      const raw  = JSON.parse(await curlGet(`${BASE}/v1/places/${id}?languageCode=${lang}`, PLACE_DETAIL_FIELDMASK));
      if (raw.error) die(`Places API error: ${JSON.stringify(raw.error)}`);
      const placeData = normalizePlace(raw);
      if (placeData.id && placeData.location) {
        const rated = await fetchPlaceInfo([placeData], lang);
        console.log(JSON.stringify(rated[0]));
      } else {
        console.log(JSON.stringify(placeData));
      }
      break;
    }

    case 'photos': {
      const id        = positional[0] ?? die('place_id required');
      const maxHeight = args['max-height'] ?? '800';
      const n         = parseInt(args.n ?? '3', 10);

      const detail     = JSON.parse(await curlGet(`${BASE}/v1/places/${id}`, 'displayName,photos'));
      const photoNames = (detail.photos ?? []).slice(0, n).map(p => p.name);
      if (photoNames.length === 0) { console.log(JSON.stringify([])); break; }

      const uris = (await Promise.all(
        photoNames.map(async name => {
          const url = `${BASE}/v1/${name}/media?maxHeightPx=${maxHeight}&skipHttpRedirect=true`;
          const res = JSON.parse(await curlGet(url));
          return res.photoUri ?? null;
        }),
      )).filter(Boolean);

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
