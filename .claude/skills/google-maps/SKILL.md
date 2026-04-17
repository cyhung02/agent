---
name: google-maps
description: Google Maps Platform skill for routing, geocoding, place search, place details, and photos. Use when the user asks about walking distance, travel time, directions between two places, how long to walk/drive, address to coordinates, place details, searching for restaurants or facilities nearby, finding places by text, or showing place photos. Make sure to use this skill whenever the user asks anything related to maps, routes, places, or location-based queries even if they don't explicitly mention "Google Maps". Triggers 步行距離、步行時間、走路幾分鐘、開車幾分鐘、從A到B怎麼走、地址座標、附近多遠、路線規劃、附近餐廳、附近便利商店、周邊設施、地點搜尋、地點照片、walking distance, travel time, directions, route, nearby, search places, place photo.
---

# Google Maps Skill

All API calls go through `gmaps.js`, which proxies to `routes.cyhung02.workers.dev`.

## Step 0 — Locate the Script

Use the **find-skill-script** skill to resolve the absolute path of `gmaps.js` under the `scripts/` subdirectory. Use the returned path in all subsequent `node <gmaps.js path>` commands.

## Getting the User's Current Location

When the user's current location is needed (e.g. "附近", "我現在在哪", "從我這裡出發"), call `user_location_v0` with `accuracy` set to `precise`:

```
user_location_v0(accuracy="precise")
```

Use the returned `latitude` and `longitude` as the origin or search center for subsequent API calls.

-----

## Decision Guide

| Scenario | Command |
|---|---|
| 「從A走到B要多久」 | `route` |
| 「這個地址的座標是什麼」 | `geocode` |
| 「新宿駅、東京鐵塔的座標」（一般地名）| `search` |
| 「新宿附近好吃的拉麵」 | `search` |
| 「飯店300m內的便利商店或ATM」 | `nearby` |
| 「這幾個景點怎麼排最省時間」 | `matrix` |
| 「這個地點的電話/營業時間」 | `place` |
| 「這個地點的照片」 | `photos` |

-----

## 1. `route` — Route + travel time

```bash
node <gmaps.js> route \
  --from-lat <lat> --from-lng <lng> \
  --to-lat <lat>   --to-lng <lng> \
  --mode WALK|DRIVE|TRANSIT|BICYCLE
```

- **TRANSIT may return empty results in Japan** — if result is `null` or `[]`, fall back to the **yahoo-transit** skill
- **TRANSIT** automatically sets `computeAlternativeRoutes: true` and returns an array of routes; present all options to the user
- `--alternatives` flag forces multiple routes for non-TRANSIT modes

Output (non-TRANSIT): `{ duration, distanceMeters, legs[] }`
Output (TRANSIT): array of routes, each with `legs[].steps[].transitDetails`

-----

## 2. `matrix` — Multi-point distance table

```bash
node <gmaps.js> matrix \
  --origins "lat1,lng1" --origins "lat2,lng2" \
  --destinations "lat1,lng1" --destinations "lat2,lng2" \
  --mode DRIVE|WALK
```

Output: flat array `[{ originIndex, destinationIndex, durationSeconds, distanceMeters, condition }]`
- Check `condition === "ROUTE_EXISTS"` before reading distance/duration
- Billed per element (origins × destinations)

-----

## 3. `geocode` — Address → lat/lng

```bash
node <gmaps.js> geocode "東京都新宿区西新宿2-8-1"
```

Output: `{ address, location: { lat, lng }, placeId }`

Use for precise street addresses. For general place names (新宿駅, 東京鐵塔), prefer `search`.

-----

## 4. `reverse` — lat/lng → address

```bash
node <gmaps.js> reverse 35.6896 139.7006
```

Output: `{ address, location: { lat, lng }, placeId }`

-----

## 5. `search` — Places Text Search

```bash
node <gmaps.js> search "新宿附近拉麵" [--lat <lat> --lng <lng> --radius <m>] [--min-rating 4.0] [--n 5]
```

- `--lat/--lng/--radius`: optional location bias (soft preference)
- `--min-rating`: minimum rating threshold (0.0–5.0, steps of 0.5)
- `--n`: number of results (default 5)

Output: `[{ id, name, address, location, types, primaryType, mapsUri }]`

-----

## 6. `nearby` — Places Nearby Search

```bash
node <gmaps.js> nearby --lat <lat> --lng <lng> --radius <m> --types <type1,type2,...> [--n 5]
```

- `--radius`: hard limit in metres
- `--types`: comma-separated, OR logic, max 50 (e.g. `--types convenience_store,atm`)
- Common types: `restaurant` `cafe` `bar` `convenience_store` `supermarket` `pharmacy` `hospital` `atm` `bank` `gas_station` `electric_vehicle_charging_station` `parking` `subway_station` `bus_stop` `train_station` `hotel` `tourist_attraction` `museum` `park` `gym` `spa`
- Full list: [references/place-types.md](references/place-types.md)

Output: same as `search`

-----

## 7. `place` — Place Details

```bash
node <gmaps.js> place <place_id>
```

Output: `{ id, name, address, location, types, primaryType, mapsUri, addressComponents }`

-----

## 8. `photos` — Place Photos

```bash
node <gmaps.js> photos <place_id> [--max-height 800] [--n 3]
```

Output: array of photo URLs `["https://lh3.googleusercontent.com/..."]`

Download and display:
```bash
curl -sL "<photoUri>" -o /mnt/user-data/outputs/place_photo.jpg
# Then use present_files tool to display
```

-----

## Displaying results on a map

When calling `places_map_display_v0`, always prepend the search center as the first marker:

```json
{ "latitude": <lat>, "longitude": <lng>, "name": "📍 <location name>", "notes": "Search center" }
```

Always pass `place_id` to `places_map_display_v0` — it fetches Enterprise-tier data (rating, opening hours, phone, photos) at no cost.

-----

## Important Notes

- `matrix`: check `condition === "ROUTE_EXISTS"` before reading distance/duration — script returns all elements including unreachable pairs
- Photo URLs expire — always fetch from a fresh `photos` call, do not cache
