#!/usr/bin/env node
// extract-content.js — extract main article content from a URL.
//
// Playwright (headless Chromium) renders the page, then Mozilla Readability
// parses the resulting HTML via jsdom in Node (no in-page injection).
//
// Usage:
//   node extract-content.js <url> [--max-chars N] [--timeout MS]
//
// Env:
//   HTTPS_PROXY / HTTP_PROXY — optional; supports basic auth in the URL
//
// Exit codes:
//   0 on success, 1 on failure (bad args, navigation error, parse error).

'use strict';

const { chromium }    = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM }       = require('jsdom');

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_TIMEOUT   = 20000;
const NETWORK_IDLE_WAIT = 5000;
const BLOCKED_RESOURCES = new Set(['image', 'media', 'font']);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function usage() {
  return 'Usage: node extract-content.js <url> [--max-chars N] [--timeout MS]';
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args[0].startsWith('--')) return null;

  const out = { url: args[0], maxChars: DEFAULT_MAX_CHARS, timeout: DEFAULT_TIMEOUT };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    const val  = args[i + 1];
    if (flag === '--max-chars' && val !== undefined) {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--max-chars must be a positive integer, got: ${val}`);
      }
      out.maxChars = n;
      i++;
    } else if (flag === '--timeout' && val !== undefined) {
      const n = parseInt(val, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--timeout must be a positive integer, got: ${val}`);
      }
      out.timeout = n;
      i++;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  try {
    new URL(out.url);
  } catch {
    throw new Error(`invalid URL: ${out.url}`);
  }
  return out;
}

function buildLaunchOptions() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
                || process.env.https_proxy || process.env.http_proxy || '';
  let proxy;
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    proxy = {
      server:   `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`,
      username: u.username ? decodeURIComponent(u.username) : '',
      password: u.password ? decodeURIComponent(u.password) : '',
    };
  }
  return { headless: true, chromiumSandbox: false, proxy };
}

async function fetchRenderedHtml(url, timeout) {
  const browser = await chromium.launch(buildLaunchOptions());
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: USER_AGENT,
      locale: 'zh-TW',
    });
    try {
      await context.route('**/*', route => {
        if (BLOCKED_RESOURCES.has(route.request().resourceType())) {
          route.abort().catch(() => {});
        } else {
          route.continue().catch(() => {});
        }
      });

      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()} for ${url}`);
      }
      // Best-effort wait for late-loaded SPA content; ignore if the page never idles.
      try {
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_WAIT });
      } catch { /* continue with whatever has rendered so far */ }

      return await page.content();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

function parseArticle(html, url) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article) throw new Error(`Readability could not extract content from ${url}`);
  return article;
}

function formatOutput(article, maxChars) {
  const lines = [];
  if (article.title)   lines.push(`Title: ${article.title}`);
  if (article.byline)  lines.push(`Author: ${article.byline}`);
  if (article.excerpt) lines.push(`Excerpt: ${article.excerpt}`);
  lines.push('');

  const body = (article.textContent || '').trim().replace(/\n{3,}/g, '\n\n');
  if (body.length > maxChars) {
    lines.push(body.slice(0, maxChars));
    lines.push('...[truncated]');
  } else {
    lines.push(body);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`[extract-content] ${err.message}\n${usage()}\n`);
    process.exit(1);
  }
  if (!opts) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }

  const html    = await fetchRenderedHtml(opts.url, opts.timeout);
  const article = parseArticle(html, opts.url);
  process.stdout.write(formatOutput(article, opts.maxChars));
}

main().catch(err => {
  process.stderr.write(`[extract-content error] ${err.message}\n`);
  process.exit(1);
});
