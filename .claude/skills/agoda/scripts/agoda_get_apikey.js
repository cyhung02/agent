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
//   3. curl --parallel all chunks, stream stdout → kill as soon as apiKey found

'use strict';

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');

const HOTEL_PAGE = 'https://www.agoda.com/hotel-gracery-shinjuku/hotel/tokyo-jp.html';
const CDN_BASE   = 'https://cdn6.agoda.net/cdn-accom-web/js/assets/browser-bundle/';
const UA         = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
// Use surrounding context to avoid false positives (e.g. Firebase apiKey)
const KEY_RE     = /appVersion:"[^"]+",isWebviewEnabled[^,]+,apiKey:"([^"]+)"/;
// Keep a rolling tail to handle matches that span two data events.
// The pattern is ~60 chars; 512 is a safe margin.
const TAIL_SIZE  = 512;

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

// Step 3: stream curl --parallel output, kill as soon as apiKey is found
const configPath = `/tmp/agoda_chunks_${Date.now()}.txt`;
fs.writeFileSync(configPath, chunkUrls.map(u => `url = "${u}"`).join('\nnext\n'));

function findKeyStreaming() {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '--parallel', '--parallel-max', '50',
      '--silent', '--compressed',
      '-H', `User-Agent: ${UA}`,
      '-K', configPath,
    ]);

    let tail = '';
    let found = false;

    child.stdout.on('data', (buf) => {
      if (found) return;

      // Append new data to tail, then search
      tail += buf.toString('latin1');
      const m = tail.match(KEY_RE);
      if (m) {
        found = true;
        child.kill('SIGTERM');
        resolve(m[1]);
        return;
      }
      // Keep only the last TAIL_SIZE chars to catch cross-boundary matches
      if (tail.length > TAIL_SIZE) {
        tail = tail.slice(-TAIL_SIZE);
      }
    });

    child.on('error', reject);

    child.on('close', (code) => {
      fs.unlinkSync(configPath);
      if (!found) reject(new Error('apiKey not found in any chunk'));
    });
  });
}

findKeyStreaming()
  .then((key) => {
    console.log(key);
  })
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
