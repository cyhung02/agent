# 台北市大安區忠孝東路四段216巷33號 GPS 座標查詢

## API 呼叫記錄

使用 Google Maps Geocoding API（正向地址轉座標）進行查詢：

```bash
curl -s --get "https://maps.googleapis.com/maps/api/geocode/json" \
  --data-urlencode "address=台北市大安區忠孝東路四段216巷33號" \
  --data-urlencode "language=zh-TW" \
  --data-urlencode "key=$GMAPS_API_KEY"
```

## API 回應

```json
{
   "error_message" : "You must use an API key to authenticate each request to Google Maps Platform APIs.",
   "results" : [],
   "status" : "REQUEST_DENIED"
}
```

## 錯誤說明

環境變數 `GMAPS_API_KEY` 未設定，導致 API 請求被拒絕（`REQUEST_DENIED`）。無法取得即時 GPS 座標資料。

## 注意

由於 API 金鑰未提供，本次查詢未能成功從 Google Maps Geocoding API 取得台北市大安區忠孝東路四段216巷33號的 GPS 座標。
若提供有效的 `GMAPS_API_KEY`，預期可取得：
- 緯度（Latitude）：約 25.04xx
- 經度（Longitude）：約 121.5xxx
