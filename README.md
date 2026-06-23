# 化療血液檢驗追蹤 Chemo Blood Tracker

照護者紀錄化療期間的血液檢驗報告，並把**每一次化療療程的恢復曲線疊在一起對照**，
看出第 N 次化療有沒有比前幾次進步。

- 後端：Python / Flask + SQLAlchemy
- 前端：HTML + Vue 3 + Chart.js（單頁，CDN 載入，免打包）
- 資料庫：PostgreSQL（部署於 Railway）／本機自動用 SQLite
- 追蹤項目：WBC 白血球、Hb 血色素、PLT 血小板、ANC 中性球、IgG 免疫球蛋白（選填，不一定每次都驗）
- 處置紀錄：升白針、輸血、輸血小板、IVIg 免疫球蛋白注射（記錄瓶數，自動換算公克）

## 本次更新

- **新增 IVIg 處置**：可記錄當天施打的免疫球蛋白瓶數（醫院規格一瓶 5g），畫面即時換算公克；
  原始資料表、處置統計表都會帶出，圖上標記畫在 IgG 圖。
- **新增 IgG 追蹤項目**：血清免疫球蛋白濃度，預設 700–1600 mg/dL（可在參考值設定改成 g/L、mg/mL）。
  **不是每次抽血都驗，允許留空**；有自己的曲線圖、參考值、原始資料欄與進步比對。
- **每項目「實心圓點／直線」開關**：在「⚙ 參考值設定 → 圖表顯示」勾選＝畫實心圓點，不勾＝只畫直線。
- **每項目「處置文字／空心圓」開關**：勾選＝處置以文字標籤呈現，不勾（預設）＝在資料點畫空心圓圈。
- **RWD 改善**：新增平板斷點、參考值設定面板可捲動、窄螢幕表格與處置欄不溢出，手機／平板／電腦皆有最佳顯示。

> ⚠️ **既有資料庫升級**：以上新增了資料表欄位。全新部署不受影響（`db.create_all()` 會自動建表）；
> 但 **Railway 上已有資料的資料庫**需手動補欄位——`schema.sql` 檔尾「升級用」區塊已備妥
> `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 指令，部署本版後執行一次即可。

## 核心概念

每筆檢驗都歸到「第 N 次化療」底下，並換算成**距離該次化療第一天的天數（Day，化療第一天 = Day 1）**。
因此每個療程都從 Day 1 出發，可以把多個療程的曲線疊在同一張圖上：

- X 軸 = 化療第幾天（Day 1、Day 8、Day 15…）
- Y 軸 = 數值
- 一條線 = 一個化療療程
- 綠色帶 = 正常參考區間；ANC 另有紅色「高風險 500」線
- 「進步比對」用每個療程的**最低點 (nadir)** 對照：最低點越高，代表骨髓抑制越輕、恢復越好

---

## 本機執行

```bash
pip install -r requirements.txt
python app.py
# 開啟 http://localhost:5000
```

沒有設定 `DATABASE_URL` 時會自動建立本機 `local.db`（SQLite），方便先試用。

---

## 部署到 Railway

### 步驟一：放上 GitHub

```bash
git init
git add .
git commit -m "init chemo blood tracker"
git branch -M main
git remote add origin https://github.com/<你的帳號>/chemo-tracker.git
git push -u origin main
```

### 步驟二：Railway 建立專案

1. 登入 [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → 選這個 repo。
2. Railway 會讀到 `requirements.txt` 與 `Procfile`，自動以 `gunicorn app:app` 啟動。

### 步驟三：加上 PostgreSQL

1. 在專案內 **New** → **Database** → **Add PostgreSQL**。
2. Railway 會自動產生 `DATABASE_URL` 環境變數並注入服務。
   - 程式已處理 `postgres://` → `postgresql://` 的格式差異，毋須手動改。
3. 服務首次啟動時，`db.create_all()` 會自動建立資料表，**不需要手動跑 SQL**。

> 附帶的 `schema.sql` 是完整資料結構，全新部署用不到（程式會自動建表）；
> 留著參考，或想自己先手動建 schema 時可用 `psql "$DATABASE_URL" -f schema.sql` 執行。

> ⚠️ **既有資料庫升級**：`db.create_all()` 只會建立「缺少的資料表」，**不會**為既有資料表補欄位。
> 若資料庫已有舊版的 `patients` / `lab_records` 表，部署有新增欄位的版本後，需手動執行
> `schema.sql` 檔尾「升級用」區塊的 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 指令一次
> （`psql "$DATABASE_URL" -f schema.sql` 或在 Railway 的 PostgreSQL Query 介面執行）。

### 步驟四：對外網址

到該服務的 **Settings → Networking → Generate Domain**，就會得到公開網址。

> 環境變數 `PORT` 由 Railway 自動帶入，`Procfile` 已綁定 `$PORT`。

---

## 操作流程

1. 右上角「＋ 新增病人」建立病人。
2. 左側表單輸入：化療次數、該次化療開始日期、抽血日期、各項數值（缺的留空即可；IgG 沒驗就留空）。
3. 當天有處置就勾選（升白針／輸血／輸血小板），IVIg 則填瓶數（會自動顯示換算公克）。
4. 同一次化療多次抽血，就重複輸入相同「化療次數」與「開始日期」。
5. 右側自動產生各項對照圖與「進步比對」摘要。
6. 「⚙ 參考值設定」可調整每位病人的正常區間（下限／上限、ANC 高風險線、IgG 區間），
   並在「圖表顯示」切換每項的「實心圓點／直線」與「處置文字／空心圓」。
7. 「⤓ 下載圖片 / 下載 PDF」把圖表與比對結果匯出，方便回診時給醫師看。

## 主要功能

- 五項指標（WBC / Hb / PLT / ANC / IgG）逐次化療對照曲線，X 軸為化療第幾天（Day 1 起算）
- IgG 為選填項目，允許留空，圖表自動跳過缺值並連線
- 處置紀錄：升白針、輸血、輸血小板，與可記錄瓶數／公克的 IVIg
- 進步比對：最低點（nadir）變化 ＋ 恢復天數（從最低點回到參考下限要幾天）＋ 每療程處置統計
- 曲線上標出最低點（空心圈）與恢復點（三角）；處置可選擇以文字標籤或空心圓圈呈現
- 每項目可切換顯示方式：實心圓點或純直線
- 正常參考值每位病人可自訂，恢復天數與圖表綠帶會同步更新
- 編輯／刪除單筆紀錄、刪除病人（含確認）
- 匯出 PNG 圖片或多頁 PDF
- 手機／平板／電腦響應式版面（RWD）

---

## 參考範圍說明（重要）

正常參考值現在可在網頁的「⚙ 參考值設定」直接調整，**每位病人各自一組**，存在資料庫裡。
新病人的預設值採台灣報告常見刻度（定義在 `static/app.js` 的 `DEFAULT_RANGES` / `DEFAULT_UNITS`，可改預設）：

| 項目 | 預設單位 | 預設正常區間 |
|------|---------|------------|
| WBC  | /µL     | 4000–10000 |
| Hb   | g/dL    | 12–16      |
| PLT  | 萬/µL   | 15–40      |
| ANC  | /µL     | ≥1500（高風險線 500） |
| IgG  | mg/dL   | 700–1600（選填，不一定每次都驗） |

各報告單位可能不同（例如 ANC 有時以 10³/µL 表示）。「⚙ 參考值設定」裡每個項目都有
**單位下拉選單**可選（WBC/PLT/ANC 提供 10³/µL、/µL、10⁹/L；Hb 提供 g/dL、g/L；IgG 提供 mg/dL、g/L、mg/mL）。
注意單位下拉**只改顯示標籤、不會換算數值**，所以請讓選的單位與你輸入的數值、設定的
參考值是同一種。選好後輸入框提示、圖表座標、比對文字都會跟著顯示該單位。

---

## 檔案結構

```
chemo-tracker/
├── app.py              Flask 後端與 API
├── models.py           資料模型（病人 / 化療週期 / 檢驗紀錄）
├── requirements.txt
├── Procfile            Railway 啟動指令
├── runtime.txt         Python 版本
├── templates/index.html前端頁面
├── static/app.js       Vue 應用與圖表邏輯
├── static/style.css
└── demo.html           離線預覽（內含範例資料，可直接開）
```

---

本工具僅供照護者紀錄與趨勢觀察，**不能取代醫療判斷**，用藥與處置請依醫療團隊指示。
