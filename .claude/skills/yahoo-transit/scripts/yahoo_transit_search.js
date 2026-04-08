#!/usr/bin/env node
// yahoo_transit_search.js - Yahoo Transit route search script (no browser required)
//
// Usage:
//   Mode 1 - Get station suggestions:
//     node yahoo_transit_search.js --mode suggest --station "新宿"
//
//   Mode 2 - Search routes (summary + flow):
//     node yahoo_transit_search.js --mode search \
//       --from "新宿" --to "渋谷" \
//       [--from-code 22741] [--to-code 22715] \
//       [--date YYYY-MM-DD] [--time HH:MM] \
//       [--type dep|arr|first|last] \
//       [--n 3]
//     → Outputs route summaries + uniqueId. Full route data (with stops) is saved to
//       /tmp/yahoo_transit_{uniqueId}.json for use by detail mode.
//
//   Mode 3 - Route detail (full stops for one route):
//     node yahoo_transit_search.js --mode detail \
//       --id {uniqueId} \
//       --route 1
//     → Reads cached data from search. No HTTP request is made.

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const CACHE_DIR = '/tmp';

// --- Argument parsing ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const mode      = get('--mode') || 'suggest';
const station   = get('--station') || '';
const from      = get('--from') || '';
const to        = get('--to') || '';
const fromCode  = get('--from-code') || '';
const toCode    = get('--to-code') || '';
const dateStr   = get('--date') || '';
const timeStr   = get('--time') || '';
const typeArg   = get('--type') || 'dep';
const n         = parseInt(get('--n') || '3', 10);
const routeNum  = parseInt(get('--route') || '1', 10);
const idArg     = get('--id') || '';

// --- curl helper ---
const CURL_HEADERS = [
  '-H', 'Referer: https://transit.yahoo.co.jp/',
  '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function curlGet(urlStr) {
  return execFileSync('curl', ['-s', '--fail', ...CURL_HEADERS, urlStr], { encoding: 'utf8' });
}

// Strip HTML tags and decode common entities, collapse whitespace
function stripHtml(str) {
  return str
    .replace(/<!--.*?-->/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// --- Mode 1: suggest ---
function modeSuggest() {
  if (!station) { console.error('Error: --station is required for suggest mode'); process.exit(1); }

  const url = `https://transit.yahoo.co.jp/api/suggest?value=${encodeURIComponent(station)}`;
  let raw;
  try { raw = curlGet(url); } catch (e) {
    console.error('Error fetching suggest API:', e.message); process.exit(1);
  }

  const data = JSON.parse(raw);
  const results = (data.Result || []).slice(0, 10).map(r => ({
    name:    r.Suggest,
    yomi:    r.Yomi,
    code:    r.Code,
    address: r.Address,
  }));
  console.log(JSON.stringify(results, null, 2));
}

// --- Parse a routeDetail HTML block → array of stops with segment info ---
//
// Fare structure on Yahoo Transit:
//   <div class="fareSection">               ← outer: holds base 乗車券 fare at its closing </div>
//     <div class="fareSection express">     ← inner: holds express supplement (指定席 etc.)
//       <div class="access">...</div>
//       <p class="fare">指定席：4,080円</p>
//     </div>
//     <div class="station">...</div>        ← transfer station INSIDE fareSection
//     <div class="fareSection express">     ← another inner express segment
//       <div class="access">...</div>
//       <p class="fare"></p>               ← may be empty
//     </div>
//     <p class="fare">3,410円</p>          ← outer base 乗車券 (covers entire fareSection span)
//   </div>
//
// Key: when an outer fareSection spans multiple station splits, the base fare lands in a
// later stationBlock and must be attributed back to the station that OPENED the fareSection.
//
// Fields produced:
//   segmentFare  — base 乗車券 for this segment (e.g. "820円", "3,410円")
//   expressFare  — express supplement only when present (e.g. "指定席：4,080円")
//   expressFareTo — last station covered by expressFare (when it spans multiple stops)
//   walkDuration — walk time for walk segments (e.g. "徒歩10分")
function parseRouteDetail(detailHtml) {
  const stationBlocks = detailHtml.split('<div class="station">');
  const stops = [];
  // Index into stops[] of the station that opened the current outer fareSection.
  // Used to attribute the closing base fare back to that station when the fareSection
  // spans multiple stationBlocks.
  let pendingBaseFareIdx = null;
  // Index into stops[] of the station that opened the current inner fareSection express.
  // Used to attribute the closing express fare back to that opening station when the
  // inner fareSection express spans multiple stationBlocks.
  let pendingExpressFareIdx = null;
  // Index into stops[] of the stop that needs expressFareTo set to the NEXT station name.
  // When an outer fareSection closes (base fare found in a later block), the express
  // supplement covers through to the station AFTER that closing block — so we defer
  // setting expressFareTo until the next iteration when we know that station name.
  let pendingExpressFareToIdx = null;

  for (let i = 1; i < stationBlocks.length; i++) {
    const sb = stationBlocks[i];

    // --- Station name (extracted early for deferred expressFareTo) ---
    const stNameM = sb.match(/href="\/station\/(\d+)"[^>]*>([^<]+)<\/a>/);
    const stNameEarly = stNameM ? stNameM[2].trim() : '';

    // Deferred: set expressFareTo for an earlier stop to THIS station's name.
    // This fires in the iteration AFTER the outer fareSection closed with a base fare.
    if (pendingExpressFareToIdx !== null && stNameEarly) {
      stops[pendingExpressFareToIdx].expressFareTo = stNameEarly;
      pendingExpressFareToIdx = null;
    }

    // When an outer fareSection (non-express) opens in this block, the current stop
    // (stops.length, before push) will own the base fare.
    if (/<div class="fareSection"(?! express)/.test(sb)) {
      pendingBaseFareIdx = stops.length;
    }
    // When an inner fareSection express opens in this block, the current stop
    // (stops.length, before push) will own the express supplement fare.
    if (/<div class="fareSection express"/.test(sb)) {
      pendingExpressFareIdx = stops.length;
    }

    // --- Times ---
    // First station: <li>16:56</li>
    // Transfer station: <li>16:57<!-- -->着</li><li>17:00<!-- -->発</li>
    // Last station: <li>17:00</li> (with icnStaArr icon)
    const timesRaw = [...sb.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map(m => stripHtml(m[1]))
      .filter(t => /\d+:\d+/.test(t))
      .slice(0, 2); // at most arrival + departure

    let arrivalTime = null, departureTime = null;
    for (const t of timesRaw) {
      if (/着/.test(t))       arrivalTime   = t.replace(/着/g, '').trim();
      else if (/発/.test(t))  departureTime = t.replace(/発/g, '').trim();
      else {
        // No label: first station → departure, last station → set as arrival tentatively
        departureTime = t;
      }
    }

    // --- Station label (発/着/transfer) ---
    const iconM = sb.match(/class="(icnStaDep|icnStaArr|icnStaTrain)">/);
    const iconType = iconM ? iconM[1] : '';
    if (iconType === 'icnStaDep') {
      // First station: the single time is departure
      arrivalTime = null;
    } else if (iconType === 'icnStaArr') {
      // Last station: the single time is arrival
      arrivalTime = departureTime;
      departureTime = null;
    }

    // --- Station name and ID (stNameEarly already extracted above) ---
    const stName = stNameEarly;
    const stId   = stNameM ? stNameM[1] : '';

    const stop = {
      arrival:     arrivalTime,
      departure:   departureTime,
      station:     stName,
      stationId:   stId,
    };

    // --- Segment info after this station (walk or train line) ---
    // Look for any <li class="transport"> in this block (walk or rail)
    const transportM = sb.match(/<li class="transport">([\s\S]*?)<\/li>/);
    if (transportM) {
      const t = transportM[1];
      const isWalk = /icnWalk/.test(t);
      if (isWalk) {
        stop.segmentType = 'walk';
        // Walk duration: text immediately after icnWalk></span>, before next tag
        // Only set if it contains an actual time (e.g. "徒歩10分"), not bare "徒歩"
        const walkDurM = t.match(/icnWalk"><\/span>([^<]+)/);
        if (walkDurM) {
          const dur = walkDurM[1].trim();
          if (/\d+分/.test(dur)) stop.walkDuration = dur;
        }
      } else {
        stop.segmentType = 'train';
        // Line name (text after icons, before <span class="destination">)
        const lineDiv = t.match(/<div>([\s\S]*?)<\/div>/);
        if (lineDiv) {
          // Greedy match removes the entire destination span including nested spans (e.g. icnFirstTrain)
          const lineText = stripHtml(lineDiv[1].replace(/<span class="destination">[\s\S]*<\/span>/, ''));
          stop.line = lineText;
          // Anchor to </span></div> so nested spans (e.g. <span class="icnFirstTrain">) don't cut short
          const destM = t.match(/class="destination">([\s\S]*?)<\/span>\s*<\/div>/);
          if (destM) stop.direction = stripHtml(destM[1]);
        }
        // Platform
        const platM = sb.match(/<li class="platform">([\s\S]*?)<\/li>/);
        if (platM) stop.platform = stripHtml(platM[1]);
        // Riding position (乗車位置)
        const rideM = sb.match(/<li class="ridingPos">([\s\S]*?)<\/li>/);
        if (rideM) {
          const rideText = stripHtml(rideM[1]);
          if (rideText) stop.ridingPosition = rideText;
        }
        // Intermediate stops (経由駅)
        const stopNums = sb.match(/<span class="btnStopNum">([\s\S]*?)<\/span>/);
        if (stopNums) {
          const viaStops = [...sb.matchAll(/<dd><span class="icnStopPoint[^"]*"><\/span>([\s\S]*?)<\/dd>/g)]
            .map(m => stripHtml(m[1]));
          if (viaStops.length) stop.viaStops = viaStops;
        }
      }
    }

    // --- Fare classification ---
    // Collect all non-empty fare values from <p class="fare"><span>X</span></p> in this block.
    // Classify by content:
    //   - Contains 指定席/自由席/グリーン → express supplement
    //     If pendingExpressFareIdx points to an earlier stop, attribute to that stop (inner
    //     fareSection express spanned multiple stationBlocks). Otherwise attribute to current stop.
    //   - Otherwise → base 乗車券
    //     If pendingBaseFareIdx points to an earlier stop, attribute to that stop (outer
    //     fareSection spanned multiple stationBlocks). Otherwise attribute to current stop.
    const allFares = [...sb.matchAll(/<p class="fare"><span>([\s\S]*?)<\/span>/g)]
      .map(m => stripHtml(m[1]))
      .filter(f => f);

    for (const fareText of allFares) {
      if (/指定席|自由席|グリーン/.test(fareText)) {
        if (pendingExpressFareIdx !== null && pendingExpressFareIdx < stops.length) {
          stops[pendingExpressFareIdx].expressFare = fareText;
        } else {
          stop.expressFare = fareText;
        }
        pendingExpressFareIdx = null;
      } else {
        if (pendingBaseFareIdx !== null && pendingBaseFareIdx < stops.length) {
          stops[pendingBaseFareIdx].segmentFare = fareText;
          // The outer fareSection closes in this block; the express supplement covers
          // through to the NEXT station (not this one), so defer expressFareTo to the
          // next iteration where we'll know that station's name.
          if (stops[pendingBaseFareIdx].expressFare) {
            pendingExpressFareToIdx = pendingBaseFareIdx;
          }
        } else {
          stop.segmentFare = fareText;
        }
        pendingBaseFareIdx = null;
      }
    }

    stops.push(stop);
  }

  // Post-process: fill walkDuration for walk stops that don't have it (compute from time diff)
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (stop.segmentType === 'walk' && !stop.walkDuration) {
      const next = stops[i + 1];
      const depStr = stop.departure ? stop.departure.split(' ')[0] : null;
      const arrStr = next && next.arrival ? next.arrival.split(' ')[0] : null;
      if (depStr && arrStr && /^\d+:\d+$/.test(depStr) && /^\d+:\d+$/.test(arrStr)) {
        const [dh, dm] = depStr.split(':').map(Number);
        const [ah, am] = arrStr.split(':').map(Number);
        const diff = (ah * 60 + am) - (dh * 60 + dm);
        if (diff > 0) stop.walkDuration = `徒歩${diff}分`;
      }
    }
  }

  return stops;
}

// --- Convert stops array to compact flow array for search summaries ---
// Flow alternates: station → (walkDuration | line) → station → ...
// Example: ["宇田川歯科医院", "徒歩10分", "小岩", "JR総武線", "錦糸町", ..., "伝法"]
function stopsToFlow(stops) {
  const flow = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (stop.station) flow.push(stop.station);
    if (stop.segmentType === 'walk') {
      flow.push(stop.walkDuration || '徒歩');
    } else if (stop.segmentType === 'train' && stop.line) {
      flow.push(stop.line);
    }
  }
  return flow.filter(Boolean);
}

// --- Build search URL from current args ---
function buildSearchUrl() {
  const now = new Date();
  // Use Asia/Tokyo timezone (JST = UTC+9) to match Yahoo Transit's locale.
  // This ensures "now" reflects Japan local time even when the host is UTC.
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  let y = Number(parts.year), mo = Number(parts.month), d = Number(parts.day);
  let hh = Number(parts.hour), mm = Number(parts.minute);

  if (dateStr) {
    const [dy, dm, dd] = dateStr.split('-').map(Number);
    y = dy; mo = dm; d = dd;
  }
  if (timeStr) {
    const [th, tm] = timeStr.split(':').map(Number);
    hh = th; mm = tm;
  }

  const typeMap = { dep: 1, arr: 4, first: 8, last: 16 };
  const typeNum = typeMap[typeArg] || 1;

  const flatlon = fromCode ? `,,${fromCode}` : '';
  const tlatlon = toCode   ? `,,${toCode}`   : '';

  const params = new URLSearchParams({
    from, to,
    fromgid: '', togid: '',
    flatlon, tlatlon,
    via: '', viacode: '',
    y: String(y),
    m: String(mo).padStart(2, '0'),
    d: String(d).padStart(2, '0'),
    hh: String(hh).padStart(2, '0'),
    m1: String(Math.floor(mm / 10)),
    m2: String(mm % 10),
    type: String(typeNum),
    ticket: 'ic',
    expkind: '1',
    userpass: '1',
    ws: '3',
    s: '0',
    al: '1',
    shin: '1',
    ex: '1',
    hb: '1',
    lb: '1',
    sr: '1',
  });

  return `https://transit.yahoo.co.jp/search/result?${params}`;
}

// --- Fetch HTML ---
function fetchHtml() {
  if (!from || !to) { console.error('Error: --from and --to are required'); process.exit(1); }
  const url = buildSearchUrl();
  try { return curlGet(url); } catch (e) {
    console.error('Error fetching search results:', e.message); process.exit(1);
  }
}

// --- Parse route summary fields from a route block ---
function parseRouteSummary(block, idx) {
  const numM = block.match(/<h2 class="title">ルート([\s\S]*?)<\/h2>/);
  const num = numM ? stripHtml(numM[1]) : String(idx);

  const priorities = [...block.matchAll(/class="icnPri[^"]*">([^<]+)</g)].map(m => m[1]);

  let depTime = '', arrTime = '', duration = '', transfers = '', fare = '', distance = '';
  const summaryM = block.match(/class="summary">([\s\S]*?)<\/ul>/);
  if (summaryM) {
    const s = summaryM[1];
    const timeM = s.match(/class="time">([\s\S]*?)<\/li>/);
    if (timeM) {
      const t = stripHtml(timeM[1]);
      const dtm = t.match(/(\d+:\d+)\s*発.*?(\d+:\d+)\s*着.*?(\d+時間\d+分|\d+分)/);
      if (dtm) { depTime = dtm[1]; arrTime = dtm[2]; duration = dtm[3]; }
      else {
        const times = t.match(/(\d+:\d+)/g);
        if (times && times.length >= 2) { depTime = times[0]; arrTime = times[1]; }
        const durM = t.match(/(\d+分)/);
        if (durM) duration = durM[1];
      }
    }
    const transM = s.match(/class="transfer">([\s\S]*?)<\/li>/);
    if (transM) transfers = stripHtml(transM[1]);
    const fareM = s.match(/class="fare">([\s\S]*?)<\/li>/);
    if (fareM) fare = stripHtml(fareM[1]);
    const distM = s.match(/class="distance">([\s\S]*?)<\/li>/);
    if (distM) distance = stripHtml(distM[1]);
  }

  return { route: num, priority: priorities, departure: depTime, arrival: arrTime, duration, transfers, fare, distance };
}

// --- Mode 2: search — returns route summaries with flow, saves full data to cache ---
function modeSearch() {
  const html = fetchHtml();
  const routeBlocks = html.split(/<div id="route\d+">/);

  // Parse ALL available routes with full stops for cache
  const allRoutes = [];
  for (let i = 1; i < routeBlocks.length; i++) {
    const block = routeBlocks[i];
    const summary = parseRouteSummary(block, i);
    const detailM = block.match(/<div class="routeDetail">([\s\S]*?)<\/div><\/div><\/div>/);
    const stops = detailM ? parseRouteDetail(detailM[1]) : [];
    summary.flow = stopsToFlow(stops);
    summary.stops = stops;
    allRoutes.push(summary);
  }

  // Save full data to cache file
  const uniqueId = crypto.randomBytes(3).toString('hex');
  const cacheFile = `${CACHE_DIR}/yahoo_transit_${uniqueId}.json`;
  fs.writeFileSync(cacheFile, JSON.stringify({ uniqueId, from, fromCode, to, toCode, routes: allRoutes }, null, 2));

  // Output summaries (without stops) for the requested n routes, plus uniqueId
  const summaries = allRoutes.slice(0, n).map(({ stops: _, ...r }) => r);
  console.log(JSON.stringify({ uniqueId, routes: summaries }, null, 2));
}

// --- Mode 3: detail — reads full stops from cache file saved by search mode ---
function modeDetail() {
  if (!idArg) {
    console.error('Error: --id is required for detail mode. Run search first to get a uniqueId.');
    process.exit(1);
  }

  const cacheFile = `${CACHE_DIR}/yahoo_transit_${idArg}.json`;
  let cached;
  try {
    cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch (e) {
    console.error(`Error: no cache found for id "${idArg}". Run search first.`);
    process.exit(1);
  }

  const route = cached.routes.find(r => r.route === String(routeNum));
  if (!route) {
    const available = cached.routes.map(r => r.route).join(', ');
    console.error(`Error: route ${routeNum} not found in cache (available: ${available})`);
    process.exit(1);
  }

  console.log(JSON.stringify(route, null, 2));
}

// --- Main ---
if (mode === 'suggest') {
  modeSuggest();
} else if (mode === 'search') {
  modeSearch();
} else if (mode === 'detail') {
  modeDetail();
} else {
  console.error(`Unknown mode: ${mode}. Use --mode suggest, --mode search, or --mode detail`);
  process.exit(1);
}
