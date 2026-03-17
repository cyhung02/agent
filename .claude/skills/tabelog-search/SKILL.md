# Tabelog Restaurant Search Skill

This is an automated browser-based workflow for searching restaurants on **tabelog.com**, Japan's largest restaurant review platform. Use **agent-browser** for all browser interactions.

## Key Parameters

The skill requires:
- **Location** (Japanese area/station name) — mandatory
- **Cuisine type** — optional
- **Sort method** — defaults to ranking by score
- **Detail depth** — how many restaurants to open fully

## Critical Steps

### 1. Open tabelog.com and dismiss language popup

```bash
agent-browser open https://tabelog.com && agent-browser wait --load networkidle
agent-browser snapshot -i
# Find and click 「日本語」 button to dismiss the language popup
agent-browser find text "日本語" click
agent-browser wait --load networkidle
```

### 2. Fill the area field via UI interaction

```bash
agent-browser snapshot -i
# Find the area/station input field, click it, then type the location
agent-browser click @e<area-input>
agent-browser fill @e<area-input> "<location>"
agent-browser wait 500
agent-browser snapshot -i
# Select the autocomplete suggestion that matches the location
agent-browser click @e<autocomplete-suggestion>
```

> **Critical**: Do NOT fill the area field by setting its value via JavaScript (`eval`), and do NOT submit the form via JavaScript. Both bypass autocomplete validation and trigger nationwide results or CAPTCHAs. The autocomplete suggestion click is essential for proper geolocation filtering.

### 3. Submit search and verify results page

```bash
agent-browser find role button click --name "検索"
agent-browser wait --load networkidle
# Verify the page title starts with the station/area name
agent-browser get title
```

### 4. Switch to score-based ranking tab

```bash
agent-browser snapshot -i
# Click the "ランキング" (ranking) tab for score-based sort
agent-browser find text "ランキング" click
agent-browser wait --load networkidle
```

### 5. Extract restaurant list data

```bash
agent-browser snapshot -i
# Use eval with --stdin for complex extraction to avoid shell escaping issues
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll(".list-rst__wrap")).map(card => ({
    name: card.querySelector(".list-rst__rst-name")?.textContent?.trim(),
    score: card.querySelector(".c-rating__val")?.textContent?.trim(),
    reviews: card.querySelector(".list-rst__rvw-count")?.textContent?.trim(),
    badge: card.querySelector(".c-shop-top-badge") ? "百名店" : null,
    url: card.querySelector("a.list-rst__rst-name-target")?.href
  }))
)
EVALEOF
```

### 6. Open detail pages for in-depth info

```bash
# For each restaurant to expand, open in a new tab
agent-browser open <restaurant-url> && agent-browser wait --load networkidle
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify({
  intro: document.querySelector(".rstdtl-top__rst-intro")?.textContent?.trim(),
  hours: document.querySelector(".rstdtl-top__info-table")?.innerText?.trim()
})
EVALEOF
agent-browser back
agent-browser wait --load networkidle
```

## Output Format

Present findings in Traditional Chinese with:
- Rankings and scores (3.5+ is good; 3.8+ is excellent)
- Review counts
- Highlight any 百名店 (Top 100) badges
- Operating hours and budget range from detail pages
