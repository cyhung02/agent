#!/usr/bin/env node
// agoda_get_apikey.js - Fetch the current ag-initiator-api-key from Agoda's JS bundles
//
// Usage:
//   node agoda_get_apikey.js
//   → prints the current API key to stdout
//
// How it works:
//   1. Fetch hotel page HTML → find property-{hash}.js bundle URL
//   2. Fetch property-{hash}.js → parse webpack chunk map
//   3. curl --parallel all chunks → find apiKey in known context

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const HOTEL_PAGE = 'https://www.agoda.com/hotel-gracery-shinjuku/hotel/tokyo-jp.html';
const CDN_BASE   = 'https://cdn6.agoda.net/cdn-accom-web/js/assets/browser-bundle/';
const UA         = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// Use surrounding context to avoid false positives (e.g. Firebase apiKey)
const KEY_RE     = /appVersion:"[^"]+",isWebviewEnabled[^,]+,apiKey:"([^"]+)"/;

function curlGet(url) {
  return execFileSync('curl', [
    '-s', '--fail', '--compressed', '-H', `User-Agent: ${UA}`, url,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

// Step 1: get property bundle filename from hotel page
const html = curlGet(HOTEL_PAGE);
const propMatch = html.match(/(property-[a-f0-9]+\.js)/);
if (!propMatch) throw new Error('property-*.js bundle not found in HTML');

// Step 2: parse webpack chunk map from property bundle
const propJs = curlGet(CDN_BASE + propMatch[1]);
const pairs = [...propJs.matchAll(/([0-9]+):"([a-f0-9]{4,})"/g)];
if (!pairs.length) throw new Error('chunk map not found in property bundle');

const chunkUrls = pairs.map(([, id, hash]) => `${CDN_BASE}${id}-${hash}.js`);

// Step 3: download all chunks in parallel, search for apiKey
const configPath = `/tmp/agoda_chunks_${Date.now()}.txt`;
fs.writeFileSync(configPath, chunkUrls.map(u => `url = "${u}"`).join('\nnext\n'));

let apiKey = null;
try {
  const output = execFileSync('curl', [
    '--parallel', '--parallel-max', '50',
    '--silent', '--compressed',
    '-H', `User-Agent: ${UA}`,
    '-K', configPath,
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

  const m = output.match(KEY_RE);
  if (m) apiKey = m[1];
} finally {
  fs.unlinkSync(configPath);
}

if (!apiKey) {
  console.error('Error: apiKey not found');
  process.exit(1);
}

console.log(apiKey);
