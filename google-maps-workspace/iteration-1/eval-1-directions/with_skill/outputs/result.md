# 台北101 至 象山捷運站 步行路線查詢

## API 呼叫

使用 Google Maps Directions API（walking mode）：

```bash
curl -s "https://maps.googleapis.com/maps/api/directions/json?origin=25.033976,121.5645389&destination=25.0328146,121.5700821&mode=walking&language=zh-TW&key=$GMAPS_API_KEY"
```

- 出發地（台北101）：25.033976, 121.5645389
- 目的地（象山捷運站）：25.0328146, 121.5700821

## 結果

| 項目 | 數值 |
|------|------|
| **狀態** | OK |
| **步行距離** | **0.8 公里（847 公尺）** |
| **步行時間** | **約 12 分鐘（727 秒）** |

## 摘要

從台北101步行至象山捷運站：
- 距離：**847 公尺**
- 時間：**約 12 分鐘**
