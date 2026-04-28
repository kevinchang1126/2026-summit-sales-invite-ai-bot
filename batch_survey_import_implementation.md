# 客戶問卷批量匯入與自動說帖生成系統 — 實作記錄

本文件記錄了在 2026 數位峰會業務邀約 AI 機器人專案中，實作「客戶問卷批量匯入」與「預先生成回訪說帖」系統的技術細節與改動。

## 1. 核心功能概述
- **批量匯入**：支援 Excel (.xlsx) 檔案上傳，自動解析「製造業」與「流通業」問卷。
- **訊號解析**：依據 `input_schema.md` 規範，將問卷答題自動轉換為系統可識別的訊號代碼 (Signal Codes)。
- **重複偵測**：提供 Dry-run 預覽模式，偵測重複的潛客代號，並允許使用者選擇「跳過」或「覆蓋更新」。
- **自動化說帖**：匯入完成後可一鍵觸發 Gemini API，根據客戶產業、出席狀況與問卷訊號，預先生成 Email 格式的回訪說帖。
- **前台整合**：在回訪說帖頁面提供搜尋功能，選取客戶後自動帶入問卷訊號，加速業務二次編輯。

## 2. 資料庫異動 (Schema Changes)
### 新增 `survey_responses` 表
儲存問卷原始資料與解析後的訊號。
```sql
CREATE TABLE survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code TEXT NOT NULL,
  company_name TEXT,
  contact_name TEXT,
  department TEXT,
  job_title TEXT,
  job_function TEXT,
  event_date TEXT,
  session_name TEXT,
  serial_no TEXT,
  ac_code TEXT,
  ac_name TEXT,
  ac_dept TEXT,
  attended INTEGER DEFAULT 0,
  has_survey INTEGER DEFAULT 0,
  industry_type TEXT NOT NULL CHECK(industry_type IN ('manufacturing','retail')),
  signals TEXT DEFAULT '[]', -- 解析後的代碼陣列
  q1_raw TEXT DEFAULT '[]',   -- 原始答題 bits
  q4_raw TEXT DEFAULT '[]',
  q5_raw TEXT DEFAULT '[]',
  q6_raw TEXT DEFAULT '[]',
  q7_raw TEXT DEFAULT '[]',
  q8_raw TEXT DEFAULT '[]',
  imported_by TEXT,
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_code, event_date, session_name)
);
```

### `pitches` 表更新
- 新增 `customer_code`：關聯說帖與特定客戶。
- 新增 `pitch_type`：區分 `invite` (邀約), `follow_up` (回訪), `bulk_generated` (批量預生)。

## 3. 後端 API 實作
| 路徑 | 方法 | 說明 |
| --- | --- | --- |
| `/api/admin/survey/import` | POST | 批量解析 XLSX，支援 `dry_run` 與 `overwrite_codes`。 |
| `/api/admin/survey/import` | GET | 取得匯入記錄列表、最近匯入記錄或搜尋客戶。 |
| `/api/admin/survey/search` | GET | 供前台 app.js 搜尋客戶資訊。 |
| `/api/admin/survey/bulk-generate` | POST | 批次呼叫 Gemini 生成說帖，內建 Rate Limit 控制 (Batch Size=5)。 |

## 4. 前端 UI/UX 改動
### 管理後台 (Admin Dashboard)
- **新增導航**：加入「📊 問卷匯入」選單（僅限 superadmin）。
- **匯入 Modal**：四步驟引導（上傳 → 預覽/重複確認 → 匯入執行 → 批量生成）。
- **進度條**：即時顯示說帖生成進度，每批次間隔 2.5 秒以避免 API 429 錯誤。

### 生成說帖頁 (Frontend App)
- **Autocomplete 搜尋**：在回訪模式下，輸入潛客代號或公司名會顯示下拉選單。
- **自動帶入**：選取客戶後，系統會自動切換產業別並勾選問卷 Q1-Q8 的所有訊號。
- **狀態顯示**：顯示「✅ 已帶入：[客戶名稱]」橫幅，並提供清除功能。

## 5. 產業邏輯標準化
依據 `docs/回訪skill_v2/schmas/input_schema.md` 進行校準：
- **製造業 (manufacturing)**：包含 Q1, Q4, Q5, Q6, Q7, Q8。
- **流通業 (retail)**：包含 Q1, Q4, Q5（時程）。
- **行為情境 (Behavioral)**：
  - `BEHAVIOR_NO_SHOW`：未到場。
  - `BEHAVIOR_ATTENDED_NO_SURVEY`：有到場但未填問卷。

## 6. 使用說明
1. 前往 **管理後台 > 問卷匯入**。
2. 上傳問卷 XLSX 檔。
3. 檢視重複資料，確認是否覆蓋。
4. 點選 **「開始預先生成說帖」**，等待進度條完成。
5. 業務員前往 **生成說帖 > 回訪說帖**，搜尋客戶後即可看到自動填好的問卷內容，並直接點選「生成回訪說帖」進行微調。

---
*最後更新日期：2026-04-27*
