# 客戶分類硬規則

本文件定義 tier（P1/P2/P3/P4）的判定邏輯。這是**硬規則**，AI 不得依語意自行判斷或偏離此表。

## 核心原則

1. **tier 由高商機訊號決定，不受其他訊號影響**
2. **內容由所有訊號共同決定**（此部分見其他規則檔）
3. **訊號順序不影響判定**（複選陣列無順序）
4. **行為情境可覆蓋訊號判定**（例如報名未到直接歸 P4 區）

## 判定流程

依下列順序執行，命中即停止：

```
Step 0：檢查行為情境（覆蓋層）
Step 1：掃描高商機訊號（P1 判定）
Step 2：掃描 P2 訊號組合
Step 3：掃描 P3 訊號組合
Step 4：預設 P3 或 P4
```

---

## Step 0：行為情境覆蓋層

在掃描問卷訊號**之前**，先檢查行為情境。

### 規則 0.1：報名未到場

**觸發條件**：`attendance = no_show`

**結果**：直接歸 P4
- label: 長期培育
- primary_anchor: `BEHAVIOR_NO_SHOW`
- 即使同時有填問卷且含高商機訊號，仍維持 P4（因為未親自到場，意願未確認）
- 話術策略：缺席關懷、年會精華補課、探詢是否仍有興趣

**例外**：若 signals 含高商機訊號 + `survey_filled = yes`，得在 CONTENT 最後提及「若方便，也歡迎直接安排一次短交流」但**不升級 tier**。

### 規則 0.2：有到場但未填問卷

**觸發條件**：`attendance = attended` + `survey_filled = no` + `signals` 為空

**結果**：直接歸 P3
- label: 案例升溫
- primary_anchor: `BEHAVIOR_ATTENDED_NO_SURVEY`
- 話術策略：年會印象詢問、補問簡化題項、不強推

### 規則 0.3：資料不完整

**觸發條件**：`attendance = unknown` 且 `signals` 為空

**結果**：直接歸 P4
- label: 長期培育
- primary_anchor: `BEHAVIOR_UNKNOWN`
- 話術策略：低壓力探詢、提供年會重點摘要

---

## Step 1：高商機訊號判定（P1）

### 製造版 P1 規則

**任一條件成立**即為 P1：

- signals 包含 `Q1_ARRANGE`
- signals 包含 `Q8_BUDGET`

**tier**: P1
**label**: 立即推進

**primary_anchor 記錄規則**：
- 同時有 `Q1_ARRANGE` 與 `Q8_BUDGET` → 記錄為 `Q1_ARRANGE`（Q1 優先）
- 只有 `Q1_ARRANGE` → 記錄為 `Q1_ARRANGE`
- 只有 `Q8_BUDGET` → 記錄為 `Q8_BUDGET`

### 流通版 P1 規則

**任一條件成立**即為 P1：

- signals 包含 `Q1_VISIT`
- signals 包含 `Q1_REVIEW_PROCESS`
- signals 包含 `Q1_EXPLAIN_SOLUTION` **且**同時包含 `Q5_HALF_YEAR` 或 `Q5_ONE_YEAR` 或 `Q5_ADOPTED`
- signals 包含 `Q4_REVENUE` 或 `Q4_EFFICIENCY`，**且**同時包含 `Q5_HALF_YEAR` 或 `Q5_ONE_YEAR` 或 `Q5_ADOPTED`

**tier**: P1
**label**: 立即推進

**primary_anchor 記錄規則**（依優先順序）：
1. `Q1_VISIT`
2. `Q1_REVIEW_PROCESS`
3. `Q1_EXPLAIN_SOLUTION`
4. `Q4_REVENUE` 或 `Q4_EFFICIENCY`（若前三個都沒有）

取最高優先的訊號作為 primary_anchor，其餘全部列入 secondary_signals。

---

## Step 2：P2 判定

### 製造版 P2 規則

未命中 P1，但符合以下任一：

- signals 同時包含 `Q1_INTEREST` 與 `Q8_EVALUATE`
- signals 包含 `Q8_EVALUATE` 且同時包含 `Q4_INTEGRATED` 或 `Q4_FULL`
- signals 包含 `Q1_OFFLINE` 且同時包含 `Q5_SUPPLY_CHAIN` 或 `Q5_DECISION`

**tier**: P2
**label**: 積極培育

**primary_anchor**：依上述條件順序記錄第一個符合的訊號。

### 流通版 P2 規則

未命中 P1，但符合以下任一：

- signals 包含 `Q1_EXPLAIN_SOLUTION` 且 Q4 有任一選項且 Q5 為 `Q5_ONE_YEAR` 或 `Q5_TWO_YEAR`
- signals 包含 `Q4_REVENUE` 或 `Q4_EFFICIENCY` 且 Q5 為 `Q5_ONE_YEAR`

**tier**: P2
**label**: 積極培育

---

## Step 3：P3 判定

### 製造版 P3 規則

未命中 P1、P2，但符合以下任一：

- signals 包含 `Q1_ONLINE` 或 `Q1_OFFLINE`
- signals 包含 `Q8_WATCH`
- signals 包含 `Q1_INTEREST`（單獨出現，無 Q8_EVALUATE）
- signals 只有 Q4/Q5/Q6/Q7 類訊號，無 Q1/Q8 訊號

**tier**: P3
**label**: 案例升溫

### 流通版 P3 規則

未命中 P1、P2，但符合以下任一：

- signals 包含 Q4 任一選項且 Q5 為 `Q5_TWO_YEAR`
- signals 只有 Q4 訊號，無 Q1/Q5 訊號

**tier**: P3
**label**: 案例升溫

---

## Step 4：P4 判定

### 製造版 P4 規則

未命中 P1、P2、P3，且符合以下任一：

- signals 包含 `Q1_NOT_NOW`
- signals 包含 `Q8_NONE`
- signals 為空（且無法由行為情境判定為 P3）

**tier**: P4
**label**: 長期培育

### 流通版 P4 規則

未命中 P1、P2、P3，且符合以下任一：

- signals 包含 `Q5_NOT_EVALUATED` 且無其他有效訊號
- signals 為空（且無法由行為情境判定為 P3）

**tier**: P4
**label**: 長期培育

---

## 判定結果記錄格式

最終輸出至 CLASSIFICATION 區塊的欄位：

```
tier: P1 | P2 | P3 | P4
label: 立即推進 | 積極培育 | 案例升溫 | 長期培育
primary_anchor: {觸發該 tier 的主要訊號代碼}
secondary_signals: {其餘訊號，逗號分隔；若無填 NONE}
industry: manufacturing | retail
contact_method: phone | visit | line | email
```

---

## 完整判定範例

### 範例 A：製造版 P1

輸入：
```json
{
  "industry": "manufacturing",
  "signals": ["Q1_ARRANGE", "Q5_SUPPLY_CHAIN", "Q7_DATA"],
  "contact_method": "phone",
  "attendance": "attended",
  "survey_filled": "yes"
}
```

判定過程：
- Step 0：無覆蓋條件
- Step 1：含 `Q1_ARRANGE` → P1 命中

輸出：
```
tier: P1
label: 立即推進
primary_anchor: Q1_ARRANGE
secondary_signals: Q5_SUPPLY_CHAIN, Q7_DATA
```

### 範例 B：流通版 P1（複合條件）

輸入：
```json
{
  "industry": "retail",
  "signals": ["Q4_REVENUE", "Q5_HALF_YEAR", "Q4_EFFICIENCY"],
  "contact_method": "visit"
}
```

判定過程：
- Step 0：無覆蓋條件
- Step 1：`Q4_REVENUE` + `Q5_HALF_YEAR` 命中流通 P1 第 4 條件 → P1

輸出：
```
tier: P1
label: 立即推進
primary_anchor: Q4_REVENUE
secondary_signals: Q5_HALF_YEAR, Q4_EFFICIENCY
```

### 範例 C：製造版 P2

輸入：
```json
{
  "industry": "manufacturing",
  "signals": ["Q1_INTEREST", "Q8_EVALUATE", "Q7_ROI"],
  "contact_method": "email"
}
```

判定過程：
- Step 0：無覆蓋條件
- Step 1：無高商機訊號 → 跳過
- Step 2：含 `Q1_INTEREST` + `Q8_EVALUATE` → P2 命中

輸出：
```
tier: P2
label: 積極培育
primary_anchor: Q1_INTEREST
secondary_signals: Q8_EVALUATE, Q7_ROI
```

### 範例 D：報名未到場（覆蓋層）

輸入：
```json
{
  "industry": "manufacturing",
  "signals": ["Q1_ARRANGE"],
  "contact_method": "phone",
  "attendance": "no_show",
  "survey_filled": "yes"
}
```

判定過程：
- Step 0：`attendance = no_show` → 直接 P4（**即使含高商機訊號也不升級**）

輸出：
```
tier: P4
label: 長期培育
primary_anchor: BEHAVIOR_NO_SHOW
secondary_signals: Q1_ARRANGE
```

CONTENT 特別處理：可在結尾輕提「若方便，也歡迎直接安排一次短交流」，但整體語氣仍為缺席關懷。

### 範例 E：有到場未填問卷

輸入：
```json
{
  "industry": "retail",
  "signals": [],
  "contact_method": "line",
  "attendance": "attended",
  "survey_filled": "no"
}
```

判定過程：
- Step 0：規則 0.2 命中 → P3

輸出：
```
tier: P3
label: 案例升溫
primary_anchor: BEHAVIOR_ATTENDED_NO_SURVEY
secondary_signals: NONE
```

---

## 邊界情況處理

### 訊號互相衝突

**情境**：signals 同時含 `Q1_ARRANGE`（高商機）與 `Q1_NOT_NOW`（低溫度）

**處理**：高商機訊號優先，歸 P1。將 `Q1_NOT_NOW` 放入 secondary_signals，並在 CONTENT 中納入「我們也了解內部可能有不同聲音」的語氣軟化。

### 訊號數量超過 6 個

**處理**：仍照規則判定 tier，但 CONTENT 只挑 3-4 個最核心訊號回應，避免話術過度散亂。其餘訊號列入 secondary_signals 供 next_actions 使用。

### 產業別與訊號代碼不符

**情境**：industry 為 manufacturing，但 signals 含流通版代碼（如 `Q1_VISIT`）

**處理**：視為無效訊號忽略，並在生成的 APPROACH 區塊標註「偵測到訊號不符產業別，以有效訊號為準」。若全部訊號都無效，回退到 Step 0 行為情境判定。

### 低機率組合未命中任何規則

**處理**：預設歸 P3（案例升溫），primary_anchor 記錄為 `DEFAULT_P3`，並使用最保守、最教育性的話術策略。
