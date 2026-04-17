---
name: exa-web-search
description: >
  Web search using Exa API. Use for ANY web search task. Triggers:
  搜尋、查詢、找資料、推薦、有什麼活動、哪裡好吃、最新消息、
  search, look up, find information.
---

# Exa Web Search

## Strategy

**Stage 1 → Stage 2a or 2b → done.**

If Stage 1 results are irrelevant, rephrase and repeat.
If Stage 2 cannot answer, rephrase the query and retry Stage 2, or switch to playwright-cli.

## Script

Use the find-skill-script skill to locate `scripts/exa.sh` before running.

**Stage 1 — Breadth (always start here)**

Returns titles, highlights, and URLs. Use to survey what web information is available on the topic.

```bash
bash /path/to/exa.sh search "query" [--fresh]
```

- `--fresh`: force livecrawl for recency-critical queries

**Stage 2a — Depth (prose content)**

Summarizes one or more pages to extract answers.

```bash
bash /path/to/exa.sh contents "question" "url1" "url2" ...
```

**Stage 2b — Depth (structured / JS-rendered pages)**

Use the playwright-cli skill to extract DOM directly.
Skip Stage 2a and go straight here if the target page is a SPA, table, or dynamically rendered.

---

## Decision rules

| Situation | Action |
|---|---|
| Default | Stage 1 → Stage 2a |
| Target is SPA / table / dynamic | Stage 1 → Stage 2b (playwright-cli) |
| URL already known | Skip Stage 1, go directly to Stage 2a or 2b |
| Stage 2a has no answer | Rephrase keywords → retry Stage 2a, or switch to playwright-cli |

## Output

Always cite the source URL for each piece of information.
