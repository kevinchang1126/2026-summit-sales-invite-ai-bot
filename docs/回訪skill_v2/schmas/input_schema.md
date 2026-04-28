# 輸入 Schema：訊號代碼表

本文件定義平台端勾選選項與訊號代碼的對應關係。所有規則檔、範本、講師對應都使用此處定義的代碼。

## 輸入 JSON 格式

```json
{
  "industry": "manufacturing",
  "signals": ["Q1_ARRANGE", "Q7_ROI"],
  "contact_method": "phone",
  "attendance": "attended",
  "survey_filled": "yes"
}
```

### 欄位說明

| 欄位 | 類型 | 必填 | 允許值 |
| --- | --- | --- | --- |
| industry | string | 是 | `manufacturing` / `retail` |
| signals | array | 否（空陣列代表未填問卷） | 見下方訊號代碼表 |
| contact_method | string | 是 | `phone` / `visit` / `line` / `email` |
| attendance | string | 否 | `attended` / `no_show` / `unknown` |
| survey_filled | string | 否 | `yes` / `no` |

### 訊號複選規則

- 每題選項都可複選
- 可跨題勾選（例如同時勾 Q1 的一個選項 + Q7 的一個選項）
- 平台無強制上限，但建議單次呼叫不超過 6 個訊號
- 訊號在 signals 陣列中的順序**不影響判定結果**

---

## 製造版訊號代碼表

### Q1_協助需求（複選）

| 代碼 | 選項文字 | 高商機標記 |
| --- | --- | --- |
| `Q1_ARRANGE` | 安排人員了解需求，進行 AI 說明與規劃 | ★ 高商機 |
| `Q1_INTEREST` | 對 AI 方案感興趣，提供相關資料讓我參考 | |
| `Q1_ONLINE` | 想了解 AI 最新應用，請幫報名線上活動 | |
| `Q1_OFFLINE` | 線下實體體驗活動有意願參加 | |
| `Q1_NOT_NOW` | 先不用，後續有需求再聯繫 | |

### Q4_AI應用程度（複選）

| 代碼 | 選項文字 |
| --- | --- |
| `Q4_NONE` | 尚未起步 |
| `Q4_TRIAL` | 局部嘗試 |
| `Q4_POINT` | 點狀應用 |
| `Q4_INTEGRATED` | 系統整合 |
| `Q4_FULL` | 全面賦能 |

### Q5_急迫領域（複選）

| 代碼 | 選項文字 |
| --- | --- |
| `Q5_SUPPLY_CHAIN` | 生產與供應鏈管理 |
| `Q5_FINANCE` | 財務與行政核銷 |
| `Q5_RD` | 研發與技術支援 |
| `Q5_DECISION` | 經營管理與決策 |

### Q6_Agent期待成效（複選）

| 代碼 | 選項文字 |
| --- | --- |
| `Q6_FREQUENCY` | 高頻度：重複性作業任務 |
| `Q6_KNOWLEDGE` | 高知識：資訊斷層、經驗傳承 |
| `Q6_EXPERIENCE` | 高經驗：既有流程、輔助決策 |
| `Q6_WORKLOAD` | 負荷率：自動化處理重複性行政事務 |

### Q7_AI轉型挑戰（複選）

| 代碼 | 選項文字 |
| --- | --- |
| `Q7_DATA` | 企業內部數據品質不佳或尚未整合 |
| `Q7_RESISTANCE` | 員工對 AI 轉型產生排斥感或恐懼 |
| `Q7_TALENT` | 缺乏具備 AI 應用能力的專業人才 |
| `Q7_ROI` | 導入成本過高且 ROI 不明確 |

### Q8_投入意願（複選）

| 代碼 | 選項文字 | 高商機標記 |
| --- | --- | --- |
| `Q8_BUDGET` | 已有明確預算並開始執行相關專案 | ★ 高商機 |
| `Q8_EVALUATE` | 積極評估中，正在尋找合適的解決方案與合作夥伴 | |
| `Q8_WATCH` | 持觀望態度，優先觀察產業指標性企業的成效 | |
| `Q8_NONE` | 目前暫無規劃 | |

---

## 流通版訊號代碼表

### Q1_活動後協助需求（複選）

| 代碼 | 選項文字 | 高商機標記 |
| --- | --- | --- |
| `Q1_VISIT` | 到府討論貴公司需求，並討論可能的協助 | ★ 高商機 |
| `Q1_REVIEW_PROCESS` | 檢視貴公司目前作業流程狀況並討論可能之協助 | ★ 高商機 |
| `Q1_EXPLAIN_SOLUTION` | 針對貴公司資訊需求再進一步說明鼎新解決方案 | |
| `Q1_OTHER` | 其他 | |

### Q4_AI導入關鍵因素（複選）

| 代碼 | 選項文字 |
| --- | --- |
| `Q4_COMPETITION` | 因應市場或同業競爭 |
| `Q4_REVENUE` | 推動營收成長 |
| `Q4_EFFICIENCY` | 提升營運效率與員工體驗 |
| `Q4_CUSTOMER_EXP` | 提升客戶體驗與服務效率 |
| `Q4_RESILIENCE` | 強化企業韌性 |
| `Q4_SECURITY` | 強化資安與資訊治理能力 |
| `Q4_SUSTAINABILITY` | 企業永續與創新 |
| `Q4_OTHER` | 其他 |

### Q5_AI採用時程（單選）

| 代碼 | 選項文字 | 溫度標記 |
| --- | --- | --- |
| `Q5_NOT_EVALUATED` | 尚未評估 | 低 |
| `Q5_HALF_YEAR` | 預計半年內導入 | 高 |
| `Q5_ONE_YEAR` | 預計一年內導入 | 中高 |
| `Q5_TWO_YEAR` | 預計二年內導入 | 中 |
| `Q5_ADOPTED` | 已導入 | 高 |

---

## 高商機訊號清單（判定分類用）

只要 signals 陣列中包含以下任一代碼，直接歸為 P1：

**製造版**：
- `Q1_ARRANGE`
- `Q8_BUDGET`

**流通版**：
- `Q1_VISIT`
- `Q1_REVIEW_PROCESS`
- `Q1_EXPLAIN_SOLUTION` + 同時含 `Q5_HALF_YEAR` / `Q5_ONE_YEAR` / `Q5_ADOPTED`
- `Q4_REVENUE` 或 `Q4_EFFICIENCY` + 同時含 `Q5_HALF_YEAR` / `Q5_ONE_YEAR` / `Q5_ADOPTED`

詳細判定邏輯見 `rules/classification_rules.md`。

---

## 行為情境代碼

用於無問卷資料或補充判定時：

| 代碼 | 意義 |
| --- | --- |
| `BEHAVIOR_ATTENDED_NO_SURVEY` | 有到場但未填問卷 |
| `BEHAVIOR_NO_SHOW` | 有報名未到場 |
| `BEHAVIOR_UNKNOWN` | 資料不完整 |

這些代碼不由業務手動勾選，由平台依 `attendance` 與 `survey_filled` 欄位自動推導。

---

## 訊號組合範例（供 JS 工程師參考）

### 範例 1：製造版高商機客戶

```json
{
  "industry": "manufacturing",
  "signals": ["Q1_ARRANGE", "Q4_INTEGRATED", "Q5_SUPPLY_CHAIN", "Q7_DATA"],
  "contact_method": "phone"
}
```

判定：P1（Q1_ARRANGE 為高商機錨點）
話術重點：供應鏈場景 + 系統整合 + 先解數據治理問題

### 範例 2：流通版觀望客戶

```json
{
  "industry": "retail",
  "signals": ["Q1_EXPLAIN_SOLUTION", "Q4_REVENUE", "Q5_TWO_YEAR"],
  "contact_method": "email"
}
```

判定：P3（無高商機錨點，Q5 溫度偏中）
話術重點：案例升溫 + 先教育、再談場景

### 範例 3：報名未到場

```json
{
  "industry": "manufacturing",
  "signals": [],
  "contact_method": "phone",
  "attendance": "no_show",
  "survey_filled": "no"
}
```

判定：P4（依行為情境自動歸類）
話術重點：缺席關懷 + 年會精華補課

### 範例 4：製造版有到場未填問卷

```json
{
  "industry": "manufacturing",
  "signals": [],
  "contact_method": "line",
  "attendance": "attended",
  "survey_filled": "no"
}
```

判定：P3（有到場但資訊不足，需低壓力探詢）
話術重點：年會印象詢問 + 補問簡化題項
