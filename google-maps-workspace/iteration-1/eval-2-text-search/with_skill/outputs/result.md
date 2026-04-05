# 東京新宿車站附近拉麵店推薦

## API 呼叫

使用 Google Maps Places Text Search API：

```bash
curl -s -X POST "https://places.googleapis.com/v1/places:searchText" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY" \
  -H "X-Goog-FieldMask: places.displayName,places.formattedAddress,places.rating,places.location" \
  -H "Content-Type: application/json" \
  -d '{
    "textQuery": "新宿駅 ラーメン おすすめ",
    "maxResultCount": 5,
    "locationBias": {
      "circle": {
        "center": {"latitude": 35.6896, "longitude": 139.7006},
        "radius": 1000
      }
    }
  }'
```

## 結果

| 店名 | 評分 | 地址 |
|------|------|------|
| Ramen Hayashida Shinjuku Shop | ⭐ 4.3 | Pegasus Kan, 3-chōme-31-5 Shinjuku, Shinjuku City, Tokyo 160-0022 |
| Dame Na Rinjin Shinjuku Tokyo | ⭐ 4.3 | 1-chōme-27-2 Kabukichō, Shinjuku City, Tokyo 160-0021 |
| Fūunji Shinjuku | ⭐ 4.3 | 〒151-0053 Tokyo, Shibuya, Yoyogi, 2-chōme−14−３ 北斗第一ビル１F |
| Menya Kaijin Shinjuku Ten | ⭐ 4.1 | 〒160-0022 Tokyo, Shinjuku City, Shinjuku, 3-chōme−35−７ さんらくビル 2F |
| Ramen Tatsunoya Shinjuku Otakibashidōri | ⭐ 4.4 | 〒160-0023 Tokyo, Shinjuku City, Nishishinjuku, 7-chōme−4−５ 冨士野ビル 1F |

## 摘要

新宿車站附近推薦 5 間拉麵店，評分皆在 4.1 以上，其中 Ramen Tatsunoya 評分最高（4.4★）。
