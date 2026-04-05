# 東京新宿車站附近拉麵店推薦

## API 呼叫記錄

根據 Google Maps Skill（SKILL.md）的指引，「新宿附近好吃的拉麵」適合使用 **Places Text Search API**。

新宿車站座標：緯度 35.6896、經度 139.7006

```bash
curl -s -X POST "https://places.googleapis.com/v1/places:searchText" \
  -H "X-Goog-Api-Key: $GMAPS_API_KEY" \
  -H "X-Goog-FieldMask: places.displayName,places.formattedAddress,places.rating,places.location,places.regularOpeningHours,places.internationalPhoneNumber" \
  -H "Content-Type: application/json" \
  -d '{
    "textQuery": "新宿駅 ラーメン",
    "maxResultCount": 8,
    "locationBias": {
      "circle": {
        "center": {"latitude": 35.6896, "longitude": 139.7006},
        "radius": 1000
      }
    },
    "languageCode": "ja"
  }'
```

## API 回應

```json
{
  "error": {
    "code": 403,
    "message": "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
    "status": "PERMISSION_DENIED"
  }
}
```

## 錯誤說明

環境變數 `GMAPS_API_KEY` 未設定，導致 API 請求被拒絕（`PERMISSION_DENIED`）。無法取得即時的 Google Maps Places 資料。

## 注意

由於 API 金鑰未提供，本次查詢未能成功從 Google Maps Places Text Search API 取得新宿車站附近拉麵店的即時資料。

若提供有效的 `GMAPS_API_KEY`，預期可取得以下類型的資訊：
- 店名（displayName）
- 地址（formattedAddress）
- 評分（rating，1.0–5.0）
- 位置座標（location）
- 電話號碼（internationalPhoneNumber）
