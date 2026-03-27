#!/usr/bin/env node
// tabelog_search.js - Tabelog restaurant search script (no browser required)
//
// Usage:
//   Mode 1 - Get autocomplete suggestions:
//     node tabelog_search.js --mode suggest --area "大阪" [--keyword "焼肉"]
//
//   Mode 2 - Full search (requires exact strings from Mode 1):
//     node tabelog_search.js --mode search --area "大阪市" [--keyword "焼肉・ホルモン"] [--n 5] [--sort rt]

const { URL } = require('url');
const { execFileSync, execFile } = require('child_process');

// --- Argument parsing ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const mode       = get('--mode') || 'suggest';
const area       = get('--area');
const keyword    = get('--keyword') || '';
const n          = parseInt(get('--n') || '5', 10);
const sort       = get('--sort') || 'rt';
const vegetarian = args.includes('--vegetarian');

if (!area) { console.error('Error: --area is required'); process.exit(1); }

// --- curl helpers ---
const CURL_HEADERS = [
  '-H', 'Referer: https://tabelog.com/',
  '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Fetch JSON array from Tabelog internal API (sync)
// Returns [] on empty/non-array responses (e.g. {"suggest_empty":true})
function apiGet(urlStr) {
  const result = execFileSync('curl', [
    '-s', '--fail',
    ...CURL_HEADERS,
    '-H', 'Accept: application/json, text/javascript, */*',
    urlStr,
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(result);
  return Array.isArray(parsed) ? parsed : [];
}

// Follow redirect and return final URL (sync)
function curlRedirectUrl(urlStr) {
  return execFileSync('curl', [
    '-s', '-L', '-o', '/dev/null', '-w', '%{url_effective}',
    ...CURL_HEADERS,
    urlStr,
  ], { encoding: 'utf8' }).trim();
}

// Fetch HTML page (sync)
function curlGet(urlStr) {
  return execFileSync('curl', ['-s', ...CURL_HEADERS, urlStr], { encoding: 'utf8' });
}

// Fetch HTML page (async, for parallel requests)
function curlGetAsync(urlStr) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-s', ...CURL_HEADERS, urlStr], { encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// Strip HTML tags, decode common entities, normalize whitespace
function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// --- Mode 1: suggest ---
async function modeSuggest() {
  const BASE = 'https://tabelog.com/internal_api/suggest_form_words';

  // Area suggest — use first token only (same as Mode 2) to avoid empty results
  // e.g. "腰越(神奈川県 鎌倉市)" → query "腰越(神奈川県" → returns correct matches
  const areaQuery = area.split(/\s/)[0];
  const areaData = apiGet(`${BASE}?sa=${encodeURIComponent(areaQuery)}`);
  const areaSuggestions = areaData.map(item => item.name);

  // Keyword suggest — pass first area result's datatype/id for scoped suggestions
  let keywordSuggestions = [];
  if (keyword) {
    const firstArea = areaData[0] || {};
    const params = new URLSearchParams({ sk: keyword });
    if (firstArea.datatype)       params.set('area_datatype', firstArea.datatype);
    if (firstArea.id_in_datatype) params.set('area_id', String(firstArea.id_in_datatype));
    const kwData = apiGet(`${BASE}?${params}`);
    keywordSuggestions = kwData.map(item => item.name);
  }

  console.log(JSON.stringify({ area_suggestions: areaSuggestions, keyword_suggestions: keywordSuggestions }, null, 2));
}

// --- Mode 2: search ---
async function modeSearch() {
  const BASE = 'https://tabelog.com/internal_api/suggest_form_words';

  const SKIP_KEYS    = new Set(['初投稿者', '最近の編集者']);
  const ADDR_NOISE   = /[ \t]*(大きな地図を見る|周辺のお店を探す|このお店は「.*?」から移転.*)/g;
  const BUDGET_NOISE = /[ \t]*利用金額分布を見る/g;
  const REVIEW_NOISE = /\s*\.\.\.?\s*詳細を見る\s*$/;

  // Step 1: Resolve area name → datatype + id_in_datatype
  const areaQuery = area.split(/\s/)[0]; // split on space to avoid empty autocomplete results
  const areaData = apiGet(`${BASE}?sa=${encodeURIComponent(areaQuery)}`);
  const areaItem = areaData.find(item => item.name === area);
  if (!areaItem) {
    console.error(JSON.stringify({
      error: `No exact area match for "${area}"`,
      area_suggestions: areaData.map(item => item.name),
    }));
    process.exit(1);
  }

  // Step 2: Resolve keyword name → datatype + id_in_datatype (optional)
  let keyItem = null;
  if (keyword) {
    const kwParams = new URLSearchParams({ sk: keyword });
    kwParams.set('area_datatype', areaItem.datatype);
    kwParams.set('area_id', String(areaItem.id_in_datatype));
    const kwData = apiGet(`${BASE}?${kwParams}`);
    keyItem = kwData.find(item => item.name === keyword) || null;
    // if no exact match, keyword is sent as free-text (sk only, no key_id)
  }

  // Step 3: Get search results URL via rstsearch 302 redirect
  const searchParams = new URLSearchParams({
    LstKind: '1',
    sa: area,
    sk: keyword,
    area_datatype: areaItem.datatype,
    area_id: String(areaItem.id_in_datatype),
    key_datatype: keyItem ? keyItem.datatype : '',
    key_id: keyItem ? String(keyItem.id_in_datatype) : '',
    form_submit: '',
    hfc: '1',
  });
  const redirectedUrl = curlRedirectUrl(`https://tabelog.com/rst/rstsearch/?${searchParams}`);

  // Append sort and optional vegetarian filter
  const sortParam = sort === 'rt' ? 'SrtT=rt&sort_mode=1' : `SrtT=${sort}`;
  const vegParam  = vegetarian ? '&ChkVegetarianMenu=1' : '';
  const separator = redirectedUrl.includes('?') ? '&' : '?';
  const finalUrl  = `${redirectedUrl}${separator}${sortParam}${vegParam}`;

  // Step 4: Fetch and parse search results HTML
  const listHtml = curlGet(finalUrl);

  const restaurants = [];
  const cardBlocks = listHtml.split('list-rst__wrap');
  for (let i = 1; i <= Math.min(n, cardBlocks.length - 1); i++) {
    const card = cardBlocks[i];
    const nameM   = card.match(/list-rst__rst-name-target[^>]+href="([^"]+)"[^>]*>([^<]+)</);
    const scoreM  = card.match(/c-rating__val[^>]*>([\d.]+)</);
    const reviewM = card.match(/list-rst__rvw-count-num[^>]*>(\d+)</);
    if (!nameM) continue;
    restaurants.push({
      rank: i,
      name: nameM[2].trim(),
      url: nameM[1],
      score: scoreM   ? scoreM[1]          : null,
      reviews: reviewM ? reviewM[1] + '件' : null,
    });
  }

  // Step 5: Fetch detail pages in parallel
  const details = await Promise.all(
    restaurants.map(async (r) => {
      if (!r.url) return { ...r, detail: null };
      try {
        const html = await curlGetAsync(r.url);

        // 店舗基本情報 (c-table rows)
        const info = {};
        for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
          const row = rowM[1];
          const th  = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
          const td  = row.match(/<td[^>]*>([\s\S]*?)<\/td>/);
          if (!th || !td) continue;
          const key = stripHtml(th[1]).replace(/\s+/g, '');
          const val = stripHtml(td[1]).replace(ADDR_NOISE, '').replace(BUDGET_NOISE, '').trim();
          if (key && val && !SKIP_KEYS.has(key)) info[key] = val;
        }

        // 受賞歴
        const awardsRaw = [...html.matchAll(/rstinfo-table-badge-award__tooltip[^>]*>([\s\S]*?)<\/div>/g)]
          .map(m => stripHtml(m[1])).filter(Boolean);
        const formatAward = (s) => {
          const a = s.match(/The Tabelog Award (\d{4}) (Gold|Silver|Bronze)/);
          if (a) return `${a[1]} ${a[2]}`;
          const h = s.match(/百名店 (\d{4})/);
          if (h) return `${h[1]} 百名店`;
          return s;
        };
        const awards = awardsRaw.length ? awardsRaw.map(formatAward) : null;

        // 店舗PR
        const prTitleM = html.match(/class="pr-comment-title"[^>]*>([\s\S]*?)<\/[a-z]+>/);
        const prBodyM  = html.match(/class="pr-comment"[^>]*>([\s\S]*?)<\/[a-z]+>/);
        const prTitle  = prTitleM ? stripHtml(prTitleM[1]) : null;
        const prBody   = prBodyM  ? stripHtml(prBodyM[1])  : null;
        const intro    = prTitle || prBody ? { title: prTitle, body: prBody } : null;

        // 口コミ — collect up to 3 review URLs + snippet titles from list page
        const rvwSection = html.match(/rstdtl-top-rvwlst__list([\s\S]*?)(?=<\/ul>)/);
        const rvwCandidates = [];
        if (rvwSection) {
          for (const liM of rvwSection[1].matchAll(/<li[\s\S]*?<\/li>/g)) {
            if (rvwCandidates.length >= 3) break;
            const li     = liM[0];
            const titleM = li.match(/<h4[^>]*>([\s\S]*?)<\/h4>/);
            const title  = titleM ? stripHtml(titleM[1]) : null;
            // Clean review URL: /pref/A.../dtlrvwlst/BXXXXXXXX/
            const urlM   = li.match(/href="(\/[^"]+\/dtlrvwlst\/[^"/?]+)\//);
            const rvwUrl = urlM ? `https://tabelog.com${urlM[1]}/` : null;
            if (title || rvwUrl) rvwCandidates.push({ title, rvwUrl });
          }
        }
        // Fetch full review text in parallel
        const rvwItems = await Promise.all(rvwCandidates.map(async ({ title, rvwUrl }) => {
          if (!rvwUrl) return { title, text: null };
          try {
            const rvwHtml = await curlGetAsync(rvwUrl);
            const bodyM = rvwHtml.match(/rvw-item__rvw-comment[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/);
            if (bodyM) {
              const text = bodyM[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
                .trim();
              return { title, text };
            }
          } catch (e) { /* fall through */ }
          return { title, text: null };
        }));

        return { ...r, detail: { awards, intro, 店舗情報: info, 口コミ: rvwItems } };
      } catch (e) {
        return { ...r, detail: { error: e.message } };
      }
    })
  );

  console.log(JSON.stringify(details, null, 2));
}

// --- Main ---
if (mode === 'suggest') {
  modeSuggest().catch(err => { console.error(err); process.exit(1); });
} else if (mode === 'search') {
  modeSearch().catch(err => { console.error(err); process.exit(1); });
} else {
  console.error(`Unknown mode: ${mode}. Use --mode suggest or --mode search`);
  process.exit(1);
}
