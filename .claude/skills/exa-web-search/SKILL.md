---
name: exa-web-search
description: >
  Web search using Exa API. Use for ANY web search task. Triggers:
  搜尋、查詢、找資料、推薦、有什麼活動、哪裡好吃、最新消息、
  search, look up, find information.
---

# Exa Web Search

## Strategy

Always start with Stage 1. It casts a wide net — 15 results with short
highlights — so the agent builds a broad picture of what's available on
the web. From that picture, the agent decides which pages are most likely
to contain the actual answer, then fetches those in Stage 2.

If Stage 1 results are irrelevant, rephrase the query and repeat.
If Stage 2 still cannot answer the question, either rephrase the summary
query and retry Stage 2, or go back to Stage 1 with a different query.
Repeat until the question is answered.

## Script

Use the find-skill-script skill to locate `scripts/exa.sh` before running.

**Stage 1 — Breadth**

```bash
bash /path/to/exa.sh search "query" [--results N] [--chars N] [--fresh]
```

- `--results`: number of results (default 15)
- `--chars`: highlight max characters (default 300)
- `--fresh`: force livecrawl for recency-critical queries

**Stage 2 — Depth**

Each call takes a question and one or more URLs. Multiple calls with
different questions and URLs are supported.

```bash
bash /path/to/exa.sh contents "question" "url1" "url2" ...
```

## Output

Always cite the source URL for each piece of information.