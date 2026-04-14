#!/usr/bin/env node
// agoda_search.js - Agoda hotel search (no browser required)
//
// Usage:
//   node agoda_search.js --mode suggest --name "JR九州Blossom新宿"
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

const nameArg = get('--name') || '';

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

// — curl helpers —
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

// — Suggest —
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

// — Main —
async function main() {
  const apiKey = await getApiKey();
  modeSuggest(apiKey);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
