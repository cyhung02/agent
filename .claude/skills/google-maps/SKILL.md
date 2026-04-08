---
name: google-maps
description: Google Maps Platform skill for routing, geocoding, place search, place details, and photos. Use when the user asks about walking distance, travel time, directions between two places, how long to walk/drive, address to coordinates, place details, searching for restaurants or facilities nearby, finding places by text, or showing place photos. Make sure to use this skill whenever the user asks anything related to maps, routes, places, or location-based queries even if they don’t explicitly mention “Google Maps”. Triggers 步行距離、步行時間、走路幾分鐘、開車幾分鐘、從A到B怎麼走、地址座標、附近多遠、路線規劃、附近餐廳、附近便利商店、周邊設施、地點搜尋、地點照片、walking distance, travel time, directions, route, nearby, search places, place photo.
---

# Google Maps Skill

Direct curl calls to Google Maps Platform APIs.

## API Key

Read from env or user preferences: `GMAPS_API_KEY`

## Getting the User's Current Location

When the user's current location is needed (e.g. "附近", "我現在在哪", "從我這裡出發"), call `user_location_v0` with `accuracy` set to `precise`:

```json
{"accuracy": "precise"}
```

Use the returned `latitude` and `longitude` as the origin or search center for subsequent API calls.

-----

## Decision Guide

Pick the right API before making any call:

|Scenario           |Use                         |
|-------------------|----------------------------|
|「從A走到B要多久」         |Directions API              |
|「這個地址的座標是什麼」       |Geocoding API               |
|「新宿駅、東京鐵塔的座標」（一般地名）|Text Search（比 Geocoding 省配額）|
|「新宿附近好吃的拉麵」        |Text Search                 |
|「飯店300m內的便利商店」     |Nearby Search               |
|「這幾個景點怎麼排最省時間」     |Distance Matrix             |
|「這個地點的電話/營業時間」     |Place Details               |
|「這個地點的照片」          |Place Photos                |

-----

## 1. Directions API — Route + travel time

```bash
curl -s "https://maps.googleapis.com/maps/api/directions/json?origin=<lat>,<lng>&destination=<lat>,<lng>&mode=<mode>&language=zh-TW&key=$GMAPS_API_KEY"
```

- `mode`: `walking` | `driving` | `transit` | `bicycling`
- Key fields: `routes[0].legs[0].distance.value` (meters), `routes[0].legs[0].duration.value` (seconds)

-----

## 2. Geocoding API — Address ↔ lat/lng

Use for precise street addresses or reverse geocoding. For general place names (新宿駅, 東京鐵塔), prefer Text Search to save quota.

**Forward (address → lat/lng):**

```bash
curl -s --get "https://maps.googleapis.com/maps/api/geocode/json" \
  --data-urlencode "address=<address>" \
  --data-urlencode "language=zh-TW" \
  --data-urlencode "key=$GMAPS_API_KEY"
```

**Reverse (lat/lng → address):**

```bash
curl -s "https://maps.googleapis.com/maps/api/geocode/json?latlng=<lat>,<lng>&language=zh-TW&key=$GMAPS_API_KEY"
```

- Key fields: `results[0].formatted_address`, `results[0].geometry.location.lat/lng`, `results[0].place_id`

-----

## 3. Places Text Search — Open-ended search by text

Use for open exploration, restaurant recommendations (“新宿附近拉麵推薦”).
`locationBias` = soft preference, results may extend beyond the specified area.

```bash
curl -s -X POST "https://places.googleapis.com/v1/places:searchText" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY" \
  -H "X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location" \
  -H "Content-Type: application/json" \
  -d '{"textQuery": "<query>", "maxResultCount": 5, "locationBias": {"circle": {"center": {"latitude": <lat>, "longitude": <lng>}, "radius": <meters>}}}'
```

- `locationBias` is optional — omit if you don’t have a center point
- Optional request filters:
  - `"minRating": 4.0` — minimum rating threshold (0.0–5.0, steps of 0.5)
  - `"priceLevels": ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]` — filter by price level
  - `"includePureServiceAreaBusinesses": true` — include delivery-only businesses (no physical address)

-----

## 4. Places Nearby Search — Strict radius search by type

Use when the user wants a specific facility type within an exact radius (“飯店300m內的便利商店”).
`locationRestriction` = hard limit, results never exceed the specified radius.

```bash
curl -s -X POST "https://places.googleapis.com/v1/places:searchNearby" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY" \
  -H "X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location" \
  -H "Content-Type: application/json" \
  -d '{"includedTypes": ["<type>"], "maxResultCount": 5, "locationRestriction": {"circle": {"center": {"latitude": <lat>, "longitude": <lng>}, "radius": <meters>}}}'
```

- Common `includedTypes`: `convenience_store`, `restaurant`, `atm`, `pharmacy`, `subway_station`, `bus_stop`, `electric_vehicle_charging_station`
- Use `excludedTypes` to exclude specific types (up to 50 each)
- Use `includedPrimaryTypes` / `excludedPrimaryTypes` to filter by a place’s primary type only

-----

## 5. Distance Matrix API — Multi-point distance table

Use when the user needs distances/times between multiple points at once (“這幾個景點怎麼排最省時間？”).

```bash
curl -s "https://maps.googleapis.com/maps/api/distancematrix/json?origins=<lat1>,<lng1>|<lat2>,<lng2>&destinations=<lat1>,<lng1>|<lat2>,<lng2>&mode=<mode>&language=zh-TW&key=$GMAPS_API_KEY"
```

- Separate multiple origins/destinations with `|`
- Returns N×M matrix: every origin to every destination
- Key fields: `rows[i].elements[j].distance.value` (meters), `rows[i].elements[j].duration.value` (seconds)
- Billed per element (origins × destinations), not per request

-----

## 6. Place Details — Details by place_id

```bash
curl -s "https://places.googleapis.com/v1/places/<place_id>" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY" \
  -H "X-Goog-FieldMask: id,displayName,formattedAddress,location"
```

Additional FieldMask options (Pro SKU, free 5,000/month):

- `accessibilityOptions` — wheelchair ramp, accessible parking, etc.
- `googleMapsLinks` — direct Google Maps link for this place

-----

## 7. Place Photos — Fetch and display place photos

**Step 1 — Get photo names** (skip if you already fetched Place Details with `photos` in FieldMask):

```bash
curl -s "https://places.googleapis.com/v1/places/<place_id>" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY" \
  -H "X-Goog-FieldMask: displayName,photos"
# Returns photos[].name → path like "places/<id>/photos/<ref>"
```

**Step 2 — Fetch photo URL:**

```bash
curl -s "https://places.googleapis.com/v1/<photo_name>/media?maxHeightPx=800&skipHttpRedirect=true" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY"
# Returns { "photoUri": "https://lh3.googleusercontent.com/..." }
```

**Step 3 — Download and display:**

```bash
curl -sL "<photoUri>" -o /mnt/user-data/outputs/place_photo.jpg
# Then use present_files tool to display the image
```

- `skipHttpRedirect=true` → returns JSON with `photoUri` instead of redirecting to the image
- Size control: `maxHeightPx` / `maxWidthPx` (up to 4800px)
- Photo names may expire — always fetch from a fresh search/details response, do not cache

-----

## Displaying results on a map

When calling `places_map_display_v0`, always prepend the search center as the first
marker in the `locations` array, regardless of whether it is the user’s current location
or a named place:

```json
{"latitude": <lat>, "longitude": <lng>, "name": "📍 <location name>", "notes": "Search center"}
```

This makes the reference point explicit on the map for any search.

Always pass `place_id` to `places_map_display_v0` — it automatically fetches Enterprise-tier
data (rating, opening hours, phone number, photos) at no cost to your API key.

-----

## Cost Optimization

SKU tiers and free monthly quota per SKU (as of March 2025):

|SKU                    |Free/month|Fields                                                                                                                  |
|-----------------------|----------|------------------------------------------------------------------------------------------------------------------------|
|Essentials             |10,000    |`id`, `formattedAddress`, `location`, `types`                                                                           |
|Pro                    |5,000     |`displayName`, `googleMapsLinks`, `accessibilityOptions`                                                                |
|Enterprise             |1,000     |`rating`, `userRatingCount`, `regularOpeningHours`, `internationalPhoneNumber`, `priceLevel`, `websiteUri`              |
|Enterprise + Atmosphere|1,000     |`reviews`, `parkingOptions`, `paymentOptions`, `evChargeOptions`, `fuelOptions`, `generativeSummary`, `editorialSummary`|

**Rules:**

- Keep all FieldMask requests to **Pro SKU or below** (`id`, `displayName`, `formattedAddress`, `location`, `types`).
- Never include Enterprise or Enterprise + Atmosphere fields in your own API calls.
- Always pass `place_id` to `places_map_display_v0` to get Enterprise data for free.
- Billing is determined by the **highest SKU field** in the FieldMask — one expensive field upgrades the entire request.

-----

## Important Notes

- Check `status === "OK"` for Directions / Geocoding / Distance Matrix responses
- Places API (v1) returns HTTP 200 even on errors — always check for an `error` field
- Place Photos: download to `/mnt/user-data/outputs/` then use `present_files` to display