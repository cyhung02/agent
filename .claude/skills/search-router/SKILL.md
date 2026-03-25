---
name: search-router
description: >
  Routes any external information lookup to the right search strategy using
  Exa REST API (POST https://api.exa.ai/search and /contents) or Claude's
  built-in web_search/web_fetch. Covers endpoint selection, parameter tuning,
  and category filter restrictions that prevent 400 errors. Use this skill
  EVERY TIME you need to search the web, fetch a page, look up a company or
  person, find code/API docs, check news, or read a URL — even if you think
  you already know which approach to use, because this skill contains critical
  parameter constraints and pitfalls you need to check first.
---

# Search Router Skill

This skill guides agents to select the right search approach and call it
correctly, avoiding stale results, wasted tokens, and 400 errors.

---

## API Key

Resolve the key with this priority (stop at first match):

```python
import os
api_key = os.environ.get("EXA_API_KEY")
```

If not set in env, check user preferences / system prompt for `EXA_API_KEY`.
The key is passed as the `x-api-key` header on every Exa request.

---

## Available Approaches

### 1. Exa Search API — `POST https://api.exa.ai/search`

Primary tool for most web searches. Returns ranked results with optional
inline content (highlights, text, summary).

### 2. Exa Contents API — `POST https://api.exa.ai/contents`

Fetch content from known URLs. Use after search to get full text from a
specific page, or directly when the URL is already known.

### 3. Claude built-in `web_search`

Fast path for English institutional data (earnings, official specs, major orgs)
where a single top result is usually enough.

### 4. Claude built-in `web_fetch`

Full page from a known URL when the page is simple static HTML and there is
no need for JS rendering or PDF extraction.

---

## Decision Flow

```
Incoming query
   │
   ├─ Known URL, need full page content?
   │     ├─ Static HTML, no JS needed → web_fetch
   │     └─ JS-rendered / PDF / complex layout
   │           → Exa Contents API  (maxAgeHours omitted = livecrawl fallback)
   │
   ├─ English + major institution, single quick fact?
   │     └─ YES → web_search  (supplement with web_fetch if snippet too thin)
   │
   ├─ Need date / domain / text filters OR specific category?
   │     └─ YES → Exa Search API with appropriate filters
   │              See "Category Filter Restrictions" before adding filters!
   │
   ├─ Classify query type (no special filters needed)
   │     ├─ Traditional Chinese / Japanese + local topic
   │     │   (travel, restaurants, Taiwan news, Japan events)
   │     │     → Exa Search API, contents.maxAgeHours: 0
   │     │
   │     ├─ Recency required ("2025/2026", "just released", "latest version")
   │     │     → Exa Search API, contents.maxAgeHours: 0
   │     │
   │     ├─ Code / API / SDK docs
   │     │     → Exa Search API, category: "github" or includeDomains to
   │     │       target official docs, contents.text.maxCharacters: 8000
   │     │
   │     ├─ Academic papers
   │     │     → Exa Search API, category: "research paper"
   │     │
   │     ├─ Complex multi-source synthesis
   │     │     → Exa Search API, type: "deep" or "deep-reasoning"
   │     │       with outputSchema for structured extraction
   │     │
   │     └─ General query, speed matters
   │           → Exa Search API, type: "fast"
   │
   └─ Are results sufficient?
         ├─ Snippet too short / missing key numbers
         │     → Exa Contents API on the most relevant URL,
         │       use highlights or text as needed
         ├─ Multiple sources contradict each other
         │     → Re-search with contents.maxAgeHours: 0; trust more recent date
         └─ Need deeper synthesis across results
               → Re-run with type: "deep" and systemPrompt for focus
```

---

## Exa Search API — How to Call

**Endpoint:** `POST https://api.exa.ai/search`

```bash
curl -X POST "https://api.exa.ai/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $EXA_API_KEY" \
  -d '{
    "query": "your query here",
    "type": "auto",
    "numResults": 5,
    "contents": {
      "highlights": { "maxCharacters": 4000 }
    }
  }'
```

### Search Request Parameters

| Parameter            | Type      | Default  | Notes                                                              |
|----------------------|-----------|----------|--------------------------------------------------------------------|
| `query`              | string    | required | Natural language; supports long semantic descriptions              |
| `type`               | string    | `"auto"` | `auto`, `fast`, `instant`, `deep`, `deep-reasoning`               |
| `numResults`         | integer   | 10       | 1–100                                                              |
| `category`           | string    | —        | See Category Filters table below                                   |
| `includeDomains`     | string[]  | —        | Max 1200 domains                                                   |
| `excludeDomains`     | string[]  | —        | Max 1200 domains; NOT supported by `company` or `people` category  |
| `startPublishedDate` | string    | —        | ISO 8601 (YYYY-MM-DD); NOT supported by `company` or `people`      |
| `endPublishedDate`   | string    | —        | ISO 8601; NOT supported by `company` or `people`                   |
| `startCrawlDate`     | string    | —        | ISO 8601; NOT supported by `company` or `people`                   |
| `endCrawlDate`       | string    | —        | ISO 8601; NOT supported by `company` or `people`                   |
| `includeText`        | string[]  | —        | Single-item array only, max 5 words; NOT supported by `company`/`people` |
| `excludeText`        | string[]  | —        | Single-item array only, max 5 words; NOT supported by `company`/`people`/`tweet` |
| `systemPrompt`       | string    | —        | `deep` / `deep-reasoning` only                                     |
| `outputSchema`       | object    | —        | `deep` / `deep-reasoning` only; max nesting depth 2, max 10 props  |

### Contents Sub-Parameters (nested under `contents`)

| Parameter                 | Type            | Default | Notes                                                           |
|---------------------------|-----------------|---------|-----------------------------------------------------------------|
| `contents.text`           | bool or object  | —       | Full markdown text; use `{maxCharacters}` to cap size           |
| `contents.highlights`     | bool or object  | —       | Key excerpts; **10× more token-efficient than text**            |
| `contents.summary`        | bool or object  | —       | LLM-generated summary; supports `{query, schema}`               |
| `contents.maxAgeHours`    | integer         | omit    | `0` = always livecrawl; `-1` = cache only; omit = smart default |
| `contents.livecrawlTimeout` | integer       | 10000   | ms; set 12000–15000 for slow sites when using maxAgeHours       |
| `contents.subpages`       | integer         | 0       | Number of subpages to crawl per result                          |
| `contents.subpageTarget`  | string or string[] | —    | Keywords to prioritize when selecting subpages                  |

---

## Exa Contents API — How to Call

**Endpoint:** `POST https://api.exa.ai/contents`

```bash
curl -X POST "https://api.exa.ai/contents" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $EXA_API_KEY" \
  -d '{
    "urls": ["https://example.com/page"],
    "highlights": { "query": "key findings", "maxCharacters": 2000 }
  }'
```

### Contents Request Parameters

| Parameter           | Type            | Default | Notes                                                           |
|---------------------|-----------------|---------|-----------------------------------------------------------------|
| `urls`              | string[]        | required | Array of URLs (also accepts `ids`)                             |
| `text`              | bool or object  | —       | Top-level (NOT nested in `contents`); `{maxCharacters}`        |
| `highlights`        | bool or object  | —       | Top-level; `{query, maxCharacters}`                            |
| `summary`           | bool or object  | —       | Top-level; `{query, schema}`                                   |
| `maxAgeHours`       | integer         | omit    | Same semantics as search API                                   |
| `livecrawlTimeout`  | integer         | 10000   | ms                                                              |
| `subpages`          | integer         | 0       | —                                                              |
| `subpageTarget`     | string or string[] | —    | —                                                              |

> ⚠️ **Critical difference from Search API:**  
> On `/contents`, `text`/`highlights`/`summary` are **top-level**.  
> On `/search`, they must be nested inside `contents: { ... }`.

---

## ⚠️ Category Filter Restrictions

Using unsupported filters with certain categories returns **HTTP 400**.

| Category           | Unsupported Parameters                                                                                          |
|--------------------|-----------------------------------------------------------------------------------------------------------------|
| `company`          | `excludeDomains`, `startPublishedDate`, `endPublishedDate`, `startCrawlDate`, `endCrawlDate`, `includeText`, `excludeText` |
| `people`           | Same as `company`; `includeDomains` only accepts LinkedIn domains                                               |
| `tweet`            | `excludeText`                                                                                                   |
| `financial report` | — (all filters supported except `excludeText`)                                                                  |
| All others         | All filters supported                                                                                           |

**Global restriction:** `includeText` and `excludeText` accept only **single-item arrays**.  
Multi-item arrays cause 400 errors. Put multiple terms in the `query` string instead.

---

## Search Types

| Type             | Latency  | Best For                                                     |
|------------------|----------|--------------------------------------------------------------|
| `auto`           | balanced | Safe default for almost everything                           |
| `fast`           | ~350ms   | Simple facts, speed-critical queries                         |
| `instant`        | lowest   | Real-time apps (chat, voice)                                 |
| `deep`           | 4–12s    | Multi-step synthesis, structured extraction                  |
| `deep-reasoning` | 12–50s   | Maximum reasoning for complex questions                      |

---

## Recommended Parameters by Query Type

| Query Type                         | Endpoint  | Key Parameters                                                                  |
|------------------------------------|-----------|---------------------------------------------------------------------------------|
| Taiwan / Japan local info          | Search    | type: "auto", contents.maxAgeHours: 0, contents.highlights.maxCharacters: 4000 |
| Stock earnings / official EN data  | web_search | —                                                                              |
| Code / SDK docs                    | Search    | category: "github" or includeDomains, contents.text.maxCharacters: 8000        |
| Academic papers                    | Search    | category: "research paper", date filters OK                                     |
| Company overview                   | Search    | category: "company" (no date/text/excludeDomain filters!)                       |
| Company news                       | Search    | category: "news", startPublishedDate                                            |
| SEC filings                        | Search    | category: "financial report"                                                    |
| Twitter/X sentiment                | Search    | category: "tweet" (no excludeText!)                                             |
| People / LinkedIn                  | Search    | category: "people" (no date/text/excludeDomain filters!)                        |
| Personal blogs / indie analysis    | Search    | category: "personal site"                                                       |
| Complex multi-source synthesis     | Search    | type: "deep", systemPrompt for focus                                            |
| Structured data extraction         | Search    | type: "deep", outputSchema                                                      |
| Full content from known URL        | Contents  | highlights for efficiency, or text with maxCharacters                           |
| JS-rendered / PDF page             | Contents  | text: {maxCharacters: 8000}, maxAgeHours: 0                                    |
| Simple fact, speed matters         | Search    | type: "fast"                                                                    |

---

## Content Mode Selection

| Mode         | Token Cost | Best For                                          |
|--------------|------------|---------------------------------------------------|
| `highlights` | Low ✅     | Agent workflows, factual lookups, multi-step tasks |
| `summary`    | Low ✅     | Quick overviews, structured extraction             |
| `text`       | High ⚠️    | Deep analysis, when full context is needed         |

**Default to `highlights` for agent workflows.** Use `text` only when you
genuinely need the full document.

---

## Token Efficiency Rules

1. **Search first, then fetch:** Use search to find the most relevant URL,
   then call Contents API only on that one page if the snippet is insufficient.

2. **Highlights over text:** `highlights` return 10× fewer tokens with the
   most relevant excerpts. Only request `text` when full document context is needed.

3. **Don't double-search:** Pick one approach; supplement only if insufficient.

4. **Match type to need:** `type: "fast"` for simple facts; `type: "auto"` as
   safe default; `type: "deep"` only for multi-step synthesis.

5. **Stable facts skip livecrawl:** Historical events, foundational concepts —
   omit `maxAgeHours` (smart default). Only use `maxAgeHours: 0` for recency-critical queries.

6. **Set maxCharacters explicitly:** Without it, `highlights` returns a large
   default. Use 2000–4000 for agent workflows.

7. **Deep search for synthesis, not simple facts:** `type: "deep"` costs 4–50s.
   Use when needing multi-angle answers or structured extraction.

---

## Common Mistakes (LLM-Generated Errors)

| Wrong                              | Correct                                                                    |
|------------------------------------|----------------------------------------------------------------------------|
| `useAutoprompt: true`              | Remove it — deprecated, does nothing                                       |
| `livecrawl: "always"`              | Use `contents.maxAgeHours: 0` instead — `livecrawl` param is deprecated   |
| `tokensNum`                        | Does not exist — use `contents.text.maxCharacters`                         |
| `numSentences`                     | Deprecated — use `maxCharacters`                                           |
| `highlightsPerUrl`                 | Deprecated — use `maxCharacters`                                           |
| `includeUrls` / `excludeUrls`      | Use `includeDomains` / `excludeDomains` (domain-level only)                |
| `stream: true`                     | Neither endpoint supports streaming                                        |
| `text: true` at top-level on search | Must be `contents: { text: true }` on `/search`                          |
| `contents: { text: true }` on /contents | On `/contents`, `text` is top-level (NOT nested in `contents`)       |
| `includeText: ["a", "b"]`          | Single-item only — `["a"]`; put multiple terms in `query` string          |
| `excludeDomains` with `category: "company"` | 400 error — remove `excludeDomains` when using company/people category |
| `outputSchema` with `type: "auto"` | `outputSchema` only works with `type: "deep"` or `"deep-reasoning"`       |

---

## Pitfalls to Avoid

- **Query language matching:** Write queries in the target language. Search for
  Japan restaurants in Japanese; Taiwan events in Traditional Chinese. Translated
  queries reduce retrieval accuracy for localized content.

- **Contradicting sources:** If results show conflicting figures, prefer the
  result with the more recent `publishedDate` and note the date in your response.

- **Always check `statuses` on Contents API:** The endpoint returns HTTP 200 even
  when individual URLs fail. Check `statuses[].status` for `"error"` to detect failures.

- **Ambiguous time references:** "Q4 2025" could be fiscal or calendar quarter.
  Use explicit ISO dates for precision.

- **`outputSchema` limits on deep search:** Max nesting depth 2; max 10 total
  properties. Array items must be flat objects — no nested objects inside array items.
  Missing `"type": "object"` at root will silently fail.

---

## Complete Examples

### Basic search with highlights

```json
{
  "query": "recent breakthroughs in quantum computing",
  "type": "auto",
  "numResults": 5,
  "contents": {
    "highlights": { "maxCharacters": 4000 }
  }
}
```

### Taiwan / Japan local info (livecrawl)

```json
{
  "query": "東京中目黒桜祭り2026",
  "type": "auto",
  "numResults": 5,
  "contents": {
    "highlights": { "maxCharacters": 3000 },
    "maxAgeHours": 0
  }
}
```

### News with date filter

```json
{
  "query": "AI regulation policy updates",
  "category": "news",
  "numResults": 10,
  "startPublishedDate": "2025-01-01",
  "contents": {
    "highlights": { "maxCharacters": 2000 }
  }
}
```

### Deep search with structured output

```json
{
  "query": "compare latest frontier AI model releases",
  "type": "deep",
  "systemPrompt": "Prefer official sources and avoid duplicate results",
  "outputSchema": {
    "type": "object",
    "required": ["models"],
    "properties": {
      "models": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "notable_claims"],
          "properties": {
            "name": { "type": "string" },
            "notable_claims": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    }
  }
}
```

### Fetch known URL (Contents API)

```json
{
  "urls": ["https://example.com/research-paper"],
  "highlights": {
    "query": "methodology and results",
    "maxCharacters": 2000
  }
}
```

### Crawl JS-rendered page

```json
{
  "urls": ["https://some-spa.com/page"],
  "text": { "maxCharacters": 8000 },
  "maxAgeHours": 0,
  "livecrawlTimeout": 15000
}
```

### Company research (no date/text filters!)

```json
{
  "query": "agtech companies in the US that raised series A",
  "category": "company",
  "numResults": 10,
  "contents": {
    "highlights": { "maxCharacters": 4000 }
  }
}
```

---

## How to Call from bash_tool

> ⚠️ **Do NOT pipe to `jq`** — it may not be installed. Read the raw JSON output directly; Claude can parse JSON natively.

```bash
# Search
curl -s -X POST "https://api.exa.ai/search" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $EXA_API_KEY" \
  -d '{
    "query": "YOUR QUERY",
    "type": "auto",
    "numResults": 5,
    "contents": { "highlights": { "maxCharacters": 4000 } }
  }'

# Fetch known URL
curl -s -X POST "https://api.exa.ai/contents" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $EXA_API_KEY" \
  -d '{
    "urls": ["https://example.com"],
    "highlights": { "maxCharacters": 3000 }
  }'
```

Read the raw JSON output directly. Key fields:
- `results[].url` — the source URL
- `results[].highlights[]` — key excerpts (if requested)
- `results[].text` — full text (if requested)
- `results[].publishedDate` — for recency sorting
- `output.content` — synthesized answer (deep search only)
- `statuses[].status` — check for `"error"` on Contents API
