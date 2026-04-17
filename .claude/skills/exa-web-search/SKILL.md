---
name: exa-web-search
description: >
  Web search using Exa API. Use for ANY web search task. Triggers:
  搜尋、查詢、找資料、推薦、有什麼活動、哪裡好吃、最新消息、
  search, look up, find information.
---

# Exa Web Search

Use the find-skill-script skill to locate `scripts/exa.sh` before running.

## Stage 1 — Breadth (always start here)

Returns titles, highlights, and URLs — surveys what web information is available on the topic.

```bash
bash /path/to/exa.sh search "query" [--fresh]
```

- `--fresh`: force livecrawl for recency-critical queries

If results are irrelevant, rephrase and repeat.

## Stage 2a — Depth: prose content

Generates a query-tailored summary from each page's text (via Gemini Flash). Use for standard web articles and documentation.

```bash
bash /path/to/exa.sh contents "question" "url1" "url2" ...
```

If Stage 2a cannot answer, rephrase and retry, or move to Stage 2b.

## Stage 2b — Depth: structured / JS-rendered pages

Use the playwright-cli skill to extract DOM directly.
Use when the target page is a SPA, table, or dynamically rendered.

---

**Shortcuts:**
- URL already known → skip Stage 1, go directly to Stage 2a or 2b
- Stage 1 highlights suggest SPA/table → go directly to Stage 2b

## Output

Always cite the source URL for each piece of information.
