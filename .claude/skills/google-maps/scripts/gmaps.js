#!/usr/bin/env node
// Google Maps Platform script — all APIs via Cloudflare Worker proxy
// Usage: node gmaps.js <command> [options]
// Commands: route, matrix, geocode, reverse, search, nearby, place, photos

const { execFileSync } = require('child_process');

const BASE = 'https://routes.cyhung02.workers.dev';

const PLACES_FIELDMASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.googleMapsUri';
const PLACE_DETAIL_FIELDMASK = 'id,displayName,formattedAddress,location,types,primaryType,googleMapsUri,addressComponents';
const ROUTE_FIELDMASK = 'routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters';
const ROUTE_TRANSIT_FIELDMASK = ROUTE_FIELDMASK + ',routes.legs.steps.transitDetails,routes.legs.steps.navigationInstruction';
const MATRIX_FIELDMASK = 'originIndex,destinationIndex,duration,distanceMeters,status,condition';

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

function normalizePlaces(data) {
  return (data.places || []).map(p => ({
    id: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    types: p.types ?? [],
    primaryType: p.primaryType ?? null,
    mapsUri: p.googleMapsUri ?? null,
  }));
}

// --- Main ---

const [,, command, ...rest] = process.argv;
if (!command) die('Usage: node gmaps.js <command> [options]\nCommands: route, matrix, geocode, reverse, search, nearby, place, photos');

const { args, positional } = parseArgs(rest);

switch (command) {

  case 'route': {
    const fromLat = args['from-lat'] ?? die('--from-lat required');
    const fromLng = args['from-lng'] ?? die('--from-lng required');
    const toLat   = args['to-lat']   ?? die('--to-lat required');
    const toLng   = args['to-lng']   ?? die('--to-lng required');
    const mode = (args.mode ?? 'WALK').toUpperCase();
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
      duration: r.duration,
      distanceMeters: r.distanceMeters,
      legs: (r.legs ?? []).map(l => ({
        duration: l.duration,
        distanceMeters: l.distanceMeters,
        steps: (l.steps ?? []).map(s => ({
          transitDetails: s.transitDetails ?? null,
          instruction: s.navigationInstruction?.instructions ?? null,
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
      origins: origins.map(toWaypoint),
      destinations: destinations.map(toWaypoint),
      travelMode: mode,
      languageCode: 'zh-TW',
    };

    const raw = JSON.parse(curlPost(`${BASE}/computeRouteMatrix`, MATRIX_FIELDMASK, body));
    const result = (Array.isArray(raw) ? raw : []).map(e => ({
      originIndex: e.originIndex,
      destinationIndex: e.destinationIndex,
      duration: e.duration,
      distanceMeters: e.distanceMeters,
      condition: e.condition,
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
    const n = parseInt(args.n ?? '5');
    const body = { textQuery: query, maxResultCount: n, languageCode: 'zh-TW' };
    if (args.lat && args.lng) {
      body.locationBias = {
        circle: {
          center: { latitude: +args.lat, longitude: +args.lng },
          radius: +(args.radius ?? 500),
        },
      };
    }
    const raw = JSON.parse(curlPost(`${BASE}/v1/places:searchText`, PLACES_FIELDMASK, body));
    console.log(JSON.stringify(normalizePlaces(raw)));
    break;
  }

  case 'nearby': {
    const lat    = args.lat    ?? die('--lat required');
    const lng    = args.lng    ?? die('--lng required');
    const radius = args.radius ?? die('--radius required');
    const type   = args.type   ?? die('--type required');
    const n = parseInt(args.n ?? '5');
    const body = {
      includedTypes: [type],
      maxResultCount: n,
      locationRestriction: {
        circle: {
          center: { latitude: +lat, longitude: +lng },
          radius: +radius,
        },
      },
    };
    const raw = JSON.parse(curlPost(`${BASE}/v1/places:searchNearby`, PLACES_FIELDMASK, body));
    console.log(JSON.stringify(normalizePlaces(raw)));
    break;
  }

  case 'place': {
    const id = positional[0] ?? die('place_id required');
    const raw = JSON.parse(curlGet(`${BASE}/v1/places/${id}`, PLACE_DETAIL_FIELDMASK));
    console.log(JSON.stringify({
      id:                raw.id,
      name:              raw.displayName?.text ?? '',
      address:           raw.formattedAddress ?? '',
      location:          raw.location ? { lat: raw.location.latitude, lng: raw.location.longitude } : null,
      types:             raw.types ?? [],
      primaryType:       raw.primaryType ?? null,
      mapsUri:           raw.googleMapsUri ?? null,
      addressComponents: raw.addressComponents ?? [],
    }));
    break;
  }

  case 'photos': {
    const id        = positional[0] ?? die('place_id required');
    const maxHeight = args['max-height'] ?? '800';
    const n         = parseInt(args.n ?? '3');

    const detail = JSON.parse(curlGet(`${BASE}/v1/places/${id}`, 'displayName,photos'));
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
