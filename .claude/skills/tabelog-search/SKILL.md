# Tabelog Restaurant Search Skill

This is an automated browser-based workflow for searching restaurants on **tabelog.com**, Japan's largest restaurant review platform.

## Key Parameters

The skill requires:
- **Location** (Japanese area/station name) — mandatory
- **Cuisine type** — optional
- **Sort method** — defaults to ranking by score
- **Detail depth** — how many restaurants to open fully

## Critical Steps

1. **Open tabelog.com** and dismiss the language popup by clicking 「日本語」
2. **Fill the area field** via UI interaction (click → type → select autocomplete suggestion) — never use JavaScript for this, as it bypasses validation
3. **Verify the search results page title** starts with the station name
4. **Switch to the appropriate sort tab** — "ランキング" for score-based ranking
5. **Extract restaurant data** using JavaScript selectors for cards, scores, and review counts
6. **Open detail pages** to retrieve introductions and info tables (operating hours, budget, etc.)

## Important Constraints

"Do NOT fill the area field by setting its value via JavaScript, and do NOT submit the form via JavaScript" — both trigger nationwide results or CAPTCHAs. The autocomplete suggestion click is essential for proper geolocation filtering.

## Output Format

Present findings in Traditional Chinese with rankings, scores (3.5+ is good; 3.8+ is excellent), review counts, and highlight any 百名店 (Top 100) badges.
