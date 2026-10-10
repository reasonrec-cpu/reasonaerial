# 地圖搜尋與介面更新

本次保留 Leaflet、靜態 GitHub Pages 與現有每日同步流程，不需要安裝套件或新增建置流程。

## 使用方式

- 搜尋地點、地址，停頓後顯示候選名稱與地址；也可按 Enter 或「搜尋」。選擇候選後才定位。
- 使用上下鍵選擇、Enter 確認、Escape 關閉。中文輸入組字期間不送出搜尋。
- 支援十進位座標、台灣經緯度對調、全形標點、完整 Plus Code，以及短 Plus Code 加上地名的候選確認。
- 可貼上含目的地或視角座標的 Google Maps 完整網址。短網址不會自動展開，介面會提示改貼座標。
- 最近八個已選地點儲存在本機，可在搜尋欄清空後刪除紀錄。
- 工具、圖層、暫存採切換面板。手機一次顯示一個面板；搜尋列保持可用。
- 左上僅保留 Logo；官網作品及延伸參考為次要文字連結，無宣傳彈窗。

## 免費搜尋的範圍與限制

使用 Photon 公共服務的 OpenStreetMap 資料，並非 Google 地點資料，店家與門牌涵蓋率不同。輸入字詞會送至 Photon，搜尋紀錄只存於裝置；查詢不附加目前 GPS／地圖位置，而採固定台灣偏好。

Photon 公共服務沒有可用性保證；合理少量使用可用，流量大時應改為自架或專用服務。已加入 650ms 輸入等待、每個瀏覽器至少 1200ms 的請求間隔、取消舊請求、9 秒逾時與本頁快取。這不是全站總量限制，流量成長後仍須監測與換用合適服務。

`public/search-config.json` 可設定相容 Photon API 的 HTTPS `endpoint`、`autocomplete` 及 `minInterval`。設定檔讀取逾時後使用預設值。若需暫停即時建議，將 `autocomplete` 設為 false；使用者仍可按 Enter 搜尋。

Nominatim 公共服務禁止自動完成，已移除原先多次自動重試的搜尋呼叫。不要將此 autocomplete endpoint 換成 Nominatim。真正的 Google Places 整合需另行處理 Google Maps 顯示、金鑰、費用與相關條款。

參考：
- https://github.com/komoot/photon#demo-server
- https://operations.osmfoundation.org/policies/nominatim/
- https://developers.google.com/maps/documentation/places/web-service/policies

## 空域狀態

- 行政區只用來顯示所在地與既有跨縣市計算，不再增加管制命中數。
- 空域限制與國家公園／商港等管理範圍分別摘要。圖層隱藏僅影響顯示，不改變查詢結果。
- 完整性檢查包含必要圖層、GeoJSON 結構與筆數。載入中、缺漏、範例或超過 48 小時資料不會顯示無限制結論，亦暫停空域報表輸出。
- 顯示更新時間並提供重試。長時間開啟或裝置恢復後重新判斷資料時效。
- 繪製範圍仍可保存，但無法確認時顯示「空域數待確認」，而非零。
- 同名不同來源圖層仍保留；命中數是資料筆數，並不代表申請件數。日期與高度仍須閱讀原始說明。

本次未修改既有幾何簡化、範圍交集近似算法或申請規則；也未新增案件雲端同步、日期篩選或 Google 商家資料。

## 官網導流

連結使用 `utm_source=map_tool`、`utm_medium=referral`、`utm_campaign=airspace_map`，並以 `utm_content` 區分位置與內容。`map_website_click` 事件只傳 `placement`／`service`，不傳搜尋文字、座標、地號或案件內容。

## 驗證與部署

```sh
node --test tests/*.test.cjs
node tests/validate-page.cjs
python3 -m http.server 8765 --directory public
```

儲存庫的 `public/data` 是既有範例資料，本機預覽會正確顯示「資料不完整」。正式部署仍由既有 `update.yml` 同步民航局資料後發布。應先完成 PR 審閱，再合併 main；合併會觸發現有網站發布流程。

手機與桌面需檢查：候選清單／鍵盤選取、台北 101 座標結果、搜尋輔助測距、匯入與報表、圖層切換、資料缺漏提示、Logo 與低調導流入口。
