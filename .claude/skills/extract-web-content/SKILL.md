---
name: extract-web-content
description: Extract the main article/readable content from a web page URL. Use this skill whenever the user wants to read, fetch, extract, or summarize the content of a web page — especially JavaScript-heavy or SPA pages that a plain HTTP fetch cannot render. Covers tasks like "讀取這篇文章的內容", "幫我抓取這個網頁的主要內容", "extract content from <url>", "summarize this article", "fetch the readable text from this URL".
allowed-tools: Bash
---

# Extract Web Content Skill

Renders a URL in a headless Chromium browser (via Playwright) and extracts the main article content using Mozilla Readability. Handles JavaScript-heavy and SPA pages that a plain HTTP fetch would miss.

## Step 0 — Install Dependencies (first run only)

Use the **find-skill-script** skill to resolve the absolute path of `install-extract-web-content.sh` under the `scripts/` subdirectory.

Check whether `node_modules` already exists in the skill root (one level above `scripts/`). If not, run:

```bash
bash <install-extract-web-content.sh path>
```

This installs `playwright`, `@mozilla/readability`, and `jsdom` locally under the skill directory. Safe to skip if `node_modules` is already present.

---

## Step 1 — Locate the Script

Use the **find-skill-script** skill to resolve the absolute path of `extract-content.js` under the `scripts/` subdirectory.

Use the returned absolute path in all subsequent `node` commands.

---

## Step 2 — Extract Content

```bash
node <extract-content.js path> <url> [--max-chars N] [--timeout MS]
```

### Parameters

| Flag | Default | Description |
|---|---|---|
| `<url>` | (required) | The page URL to extract content from |
| `--max-chars` | `8000` | Maximum number of characters of body text to output; content is truncated past this with a `...[truncated]` marker |
| `--timeout` | `20000` | Navigation timeout in milliseconds |

### Environment

- `HTTPS_PROXY` / `HTTP_PROXY` — optional proxy URL. Basic auth embedded in the URL (`http://user:pass@host:port`) is supported.

### Output

Plain text written to stdout in this format:

```
Title: <article title>
Author: <byline, if detected>
Excerpt: <short summary, if detected>

<body text, up to --max-chars characters>
...[truncated]
```

`Author` and `Excerpt` lines are omitted when Readability cannot detect them. On failure, the script prints an error line to stderr prefixed with `[extract-content error]` and exits with code `1`.

### Examples

```bash
# Basic usage
node <path>/extract-content.js https://example.com/article

# Longer output, longer timeout
node <path>/extract-content.js https://example.com/article --max-chars 20000 --timeout 30000

# Through a proxy
HTTPS_PROXY=http://user:pass@proxy.example.com:8080 \
  node <path>/extract-content.js https://example.com/article
```

---

## How It Works

1. Launches headless Chromium (via Playwright) with image/media/font requests blocked for speed.
2. Navigates to the URL with `domcontentloaded`, then best-effort waits up to 5s for `networkidle` so SPA content has a chance to render.
3. Calls `page.content()` to get the fully rendered HTML.
4. Parses that HTML in Node with `jsdom` + `@mozilla/readability` (no in-browser script injection).
5. Emits title, byline, excerpt, and truncated body text.

---

## Notes for Presenting Results

- The script output is already formatted for direct consumption. When summarising for the user, quote the `Title` verbatim and do not invent authorship.
- If the body ends with `...[truncated]`, tell the user the content was cut off and offer to re-run with a larger `--max-chars`.
- If Readability fails to parse (e.g. paywall, CAPTCHA, JS-gated content), surface the stderr message to the user instead of guessing the content.
