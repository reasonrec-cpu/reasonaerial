# 台灣無人機空域圖資（自動每日更新 + WordPress 嵌入）

一套會**每天自動**從交通部民航局同步「禁限航區 / 臨時空域 / 國家公園 / 商港 / 行政區」圖資，
輸出 **GeoJSON + KML**，並用 **GitHub Pages** 發布一個永遠最新的互動地圖，
可直接 **嵌進 WordPress** 使用。

```
GitHub Actions（每天台北 00:15 自動跑）
   → 抓民航局 ArcGIS 端點 → 產生 GeoJSON + KML
   → 發布到 GitHub Pages（固定網址，每天最新）
WordPress：貼一段 iframe → 永遠顯示最新地圖，零維護
```

> 為什麼一定要放 GitHub？因為需要一台「24 小時有網路、抓得到民航局」的機器來定時更新，
> GitHub Actions 免費且穩定。你自己的電腦或雲端排程若連得到民航局也可以，但 GitHub 最省事。

---

## 一次性設定（約 10 分鐘）

### 1. 建立 GitHub repo
- 到 <https://github.com> 登入（沒帳號先免費註冊）。
- 右上「+」→ **New repository** → 取個名字，例如 `drone-airspace` → 建立。

### 2. 上傳這個資料夾的內容
把本資料夾所有檔案（`scripts/`、`.github/`、`public/`、`README.md` …）上傳到該 repo。
- 網頁操作：repo 頁面 → **Add file → Upload files** → 把檔案拖進去 → Commit。
- 或用 Git：
  ```bash
  git init && git add . && git commit -m "init"
  git branch -M main
  git remote add origin https://github.com/<你的帳號>/<repo名稱>.git
  git push -u origin main
  ```

### 3. 開啟 GitHub Pages
- repo → **Settings → Pages** → **Source** 選 **GitHub Actions**（不是 branch）。

### 4. 跑第一次更新
- repo → **Actions** 分頁 → 若提示啟用 workflow 請按啟用 →
  左側點「更新無人機空域圖資」→ 右邊 **Run workflow** → 等它跑完（約 1–3 分鐘）。
- 跑完後你的地圖網址就是：
  ```
  https://<你的帳號>.github.io/<repo名稱>/
  ```
  之後**每天台北時間 00:15 會自動更新**，你什麼都不用做。

### 5. 嵌進 WordPress
編輯頁面 → 新增「自訂 HTML」區塊 → 貼上（見 `WordPress嵌入碼.html`）：
```html
<iframe src="https://<你的帳號>.github.io/<repo名稱>/"
        style="width:100%;height:640px;border:0;border-radius:12px" loading="lazy"
        title="台灣無人機空域圖"></iframe>
```

---

## 資料下載網址（發布後可直接連）

| 內容 | 網址 |
|---|---|
| 禁限航區 GeoJSON | `https://<你的帳號>.github.io/<repo名稱>/data/uav_restricted_airspace.geojson` |
| 禁限航區 KML | `https://<你的帳號>.github.io/<repo名稱>/data/uav_restricted_airspace.kml` |
| 臨時空域 / 國家公園 / 商港 / 行政區 | 同上，把檔名換成 `temporary_area` / `national_park` / `commercial_port` / `county` |
| 更新資訊總表 | `https://<你的帳號>.github.io/<repo名稱>/data/manifest.json` |

- **GeoJSON**：網頁地圖、QGIS、程式處理。
- **KML**：Google Earth、Google My Maps、DJI Fly / Litchi 等空拍 App 匯入。

---

## 本機執行（選用）

若你想在自己電腦上手動產生資料（電腦需連得到民航局）：
```bash
python3 scripts/sync_airspace.py --output-dir ./public/data      # 全部圖層
python3 scripts/sync_airspace.py --layer uav_restricted_airspace # 只抓禁限航區
```
零外部依賴，只需 Python 3.10+。

---

## 收錄圖層與資料端點

| slug | 名稱 | ArcGIS 服務 | 近期筆數 |
|---|---|---|---|
| `uav_restricted_airspace` | 禁限航區（主空域） | `Hosted/UAV_fs/FeatureServer/3` | ~4,700 |
| `temporary_area` | 臨時空域 | `Hosted/Temporary_Area/FeatureServer/19` | ~5 |
| `national_park` | 國家公園 | `Hosted/National_Park_fs/FeatureServer/0` | ~65 |
| `commercial_port` | 商港區 | `Hosted/Commercial_Port_fs/FeatureServer/4` | ~30 |
| `county` | 行政區界 | `Hosted/County_fs/FeatureServer/0` | ~22 |

Base：`https://dronegis.caa.gov.tw/server/rest/services`

> `public/data/` 內附的是**範例資料**，只是讓地圖第一天就能顯示；
> 首次跑過 Actions 後會被真實資料覆蓋。

---

## 免責聲明
- 本專案整理的是民航局公開可查詢的 ArcGIS REST 端點，非官方正式文件化 API，端點與欄位未來可能調整。
- 圖資僅供參考，實際飛行仍應以主管機關最新公告為準。
- 資料著作權屬原提供機關；請遵守政府資料開放相關規範並標示來源。
