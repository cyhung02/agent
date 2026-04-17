#!/bin/bash
# Usage:
#   exa.sh search "query" [--results N] [--chars N] [--fresh]
#   exa.sh contents "question" "url1" "url2" ...

if [ -z "$EXA_API_KEY" ]; then
  echo "EXA_API_KEY is not set. Please export EXA_API_KEY=your_key and retry." >&2
  exit 1
fi

MODE="$1"
shift

call_api() {
  local URL="$1"
  local PAYLOAD="$2"
  while true; do
    RESULT=$(curl -s -X POST "$URL" \
      -H "x-api-key: $EXA_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD")
    if echo "$RESULT" | grep -q "DNS cache overflow"; then
      sleep 5
      continue
    fi
    # warn on per-URL errors in contents response
    echo "$RESULT" | python3 -c "
import sys, json
data = sys.stdin.buffer.read()
try:
    j = json.loads(data)
    for s in j.get('statuses', []):
        if s.get('status') == 'error':
            print(f\"[warn] {s.get('id')}: {s.get('error', {}).get('tag')}\", flush=True)
except: pass
sys.stdout.buffer.write(data)
"
    return
  done
}

case "$MODE" in
  search)
    QUERY="$1"; shift
    NUM_RESULTS=15
    MAX_CHARS=300
    FRESH=false

    while [ $# -gt 0 ]; do
      case "$1" in
        --results) NUM_RESULTS="$2"; shift 2 ;;
        --chars)   MAX_CHARS="$2";   shift 2 ;;
        --fresh)   FRESH=true;       shift   ;;
        *) shift ;;
      esac
    done

    FRESH_BLOCK=""
    if [ "$FRESH" = true ]; then
      FRESH_BLOCK=',"maxAgeHours":0'
    fi

    PAYLOAD=$(printf '{
      "query": %s,
      "type": "auto",
      "numResults": %d,
      "contents": {
        "highlights": {"maxCharacters": %d}
        %s
      }
    }' "$(echo "$QUERY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')" \
       "$NUM_RESULTS" "$MAX_CHARS" "$FRESH_BLOCK")

    call_api "https://api.exa.ai/search" "$PAYLOAD"
    ;;

  contents)
    QUESTION="$1"; shift
    URLS_JSON=$(python3 -c "
import json, sys
urls = sys.argv[1:]
print(json.dumps(urls))
" "$@")

    PAYLOAD=$(printf '{
      "urls": %s,
      "summary": {"query": %s}
    }' "$URLS_JSON" \
       "$(echo "$QUESTION" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')")

    call_api "https://api.exa.ai/contents" "$PAYLOAD"
    ;;

  *)
    echo "Usage:" >&2
    echo "  exa.sh search \"query\" [--results N] [--chars N] [--fresh]" >&2
    echo "  exa.sh contents \"question\" \"url1\" \"url2\" ..." >&2
    exit 1
    ;;
esac