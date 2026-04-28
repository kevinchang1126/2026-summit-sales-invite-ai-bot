# 資料庫 Schema 建議

本文件供 JS 工程師將講師卡 md 匯入資料庫時參考。

## 設計目標

1. **支援平台「講師速查」功能**：業務可瀏覽、搜尋、展開每張知識卡
2. **支援說帖「cite 標記渲染」**：前端抓到 `<cite code="XXX">引言</cite>` 時，用 code 快速查到完整內容
3. **支援未來擴充**：可新增講師、新增知識卡不破壞現有結構

---

## 主表：speaker_knowledge_cards

每張知識卡一筆資料。以下為建議 schema（以 MySQL / PostgreSQL 語法範例）：

```sql
CREATE TABLE speaker_knowledge_cards (
  -- 主鍵
  code              VARCHAR(20)   PRIMARY KEY,          -- 例：K-HYZ-05

  -- 講師資訊
  speaker_name      VARCHAR(50)   NOT NULL,             -- 例：黃盈彰
  speaker_title     VARCHAR(100)  NOT NULL,             -- 例：黃盈彰總經理
  speaker_code      VARCHAR(10)   NOT NULL,             -- 例：HYZ（對應 K-HYZ-xx 前綴）
  is_digiwin        BOOLEAN       NOT NULL DEFAULT FALSE, -- 是否為鼎新講師

  -- 知識卡內容
  short_quote       VARCHAR(100)  NOT NULL,             -- 10-20 字濃縮，hover 顯示標題
  full_content      TEXT          NOT NULL,             -- 100-150 字完整觀點，hover 展開
  business_phrases  JSON          NOT NULL,             -- 業務可用短句陣列

  -- 來源對應
  slide_ref         VARCHAR(50),                        -- 例：PPT Slide 12-17
  source_timestamp  VARCHAR(20),                        -- 例：00:20:48

  -- 適用訊號
  applicable_signals JSON         NOT NULL,             -- 例：["Q5_SUPPLY_CHAIN", "Q6_WORKLOAD"]

  -- 產業範圍
  industry_scope    VARCHAR(20)   NOT NULL DEFAULT 'both', -- manufacturing / retail / both

  -- 排序權重（講師速查顯示順序用）
  display_order     INT           NOT NULL DEFAULT 0,

  -- 時間戳
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 索引
  INDEX idx_speaker (speaker_code),
  INDEX idx_industry (industry_scope),
  INDEX idx_digiwin (is_digiwin)
);
```

---

## 欄位說明

### code（主鍵）

- 格式：`K-{講師代號}-{編號}`
- 講師代號對照：
  - `LYH` → 李義訓
  - `HYK` → 黃昱凱
  - `HYZ` → 黃盈彰
  - `LDK` → 林大馗
  - `HCH` → 洪春暉
  - `ZWN` → 詹文男
  - `ZH` → 朱浩
- 範例：`K-HYZ-05` = 黃盈彰的第 5 張知識卡

### speaker_name / speaker_title

兩個分開存，原因：
- `speaker_name`（「黃盈彰」）：前端顯示搜尋、頭像標註
- `speaker_title`（「黃盈彰總經理」）：hover textbox 內、說帖引用時使用正式稱謂

### is_digiwin

布林值。`true` 表示鼎新講師（李義訓、黃昱凱、黃盈彰）；`false` 表示外部講師（林大馗、洪春暉、詹文男、朱浩）。

用途：
- 講師速查 UI 可分群顯示（鼎新 vs 外部）
- 說帖生成時平台可驗證鼎新至少佔 SPEAKERS 首位

### short_quote

10-20 字的濃縮觀點，例如：「同步看身份、權限、追溯」。

用途：
- hover textbox 的標題列
- 講師速查卡片的副標
- CONTENT 內 `<cite code="XXX">` 的引言若未填，可用此作為 fallback

### full_content

100-150 字的完整觀點。原本講師卡 md 的「完整觀點」段落直接搬進來。

用途：
- hover textbox 展開後的主文
- 講師速查詳細頁的主內容

### business_phrases（JSON 陣列）

業務可直接貼用的口語短句，3-5 句為佳。

範例：
```json
[
  "急單不用靠五通電話，AI 可以直接召集跨部門分身協作",
  "從雜訊到待辦，Agent 讓跨部門訊號變成可執行任務",
  "合規、庫存、產能可以同步檢核，不再等人來回確認"
]
```

用途：
- 講師速查卡片下方的「業務可用短句」區
- 業務想臨場接話時的快速參考

### slide_ref

PPT 對應頁碼，例如：`PPT Slide 12-17`。

用途：
- hover textbox 顯示來源參照
- 業務準備親訪時快速定位 PPT 段落

### source_timestamp

逐字稿時間戳，例如：`00:20:48`。

用途：
- 如果你未來想讓業務能快速聽講師原音，這個欄位可串接影片/音檔播放起點
- hover textbox 也可以顯示時間戳

### applicable_signals（JSON 陣列）

該知識卡適用的問卷訊號代碼。

範例：
```json
["Q5_SUPPLY_CHAIN", "Q5_DECISION", "Q6_WORKLOAD", "Q8_BUDGET"]
```

用途：
- AI 生成說帖時的推薦依據（雖然主要靠 speaker_citation_rules.md）
- 講師速查可做「依訊號篩選知識卡」功能
- 未來做「客戶訊號 → 最相關知識卡」推薦系統的基礎

### industry_scope

三個可能值：
- `manufacturing`：僅適用製造
- `retail`：僅適用流通（朱浩所長的所有知識卡都標這個）
- `both`：兩者皆適用（鼎新三位講師多為 both）

用途：
- 說帖生成時過濾不適用的知識卡
- 講師速查做產業篩選

### display_order

用來排序講師速查的顯示順序。建議排序邏輯：
- 鼎新講師排前面
- 同一講師內，知識卡依 code 末兩碼排序
- 朱浩所長在流通場景優先顯示

---

## 副表：sales_pitches（說帖儲存，選配）

如果未來想讓業務看到自己生成過的說帖歷史，可加這張表：

```sql
CREATE TABLE sales_pitches (
  id                INT           AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(50),                        -- 業務使用者 ID
  customer_id       VARCHAR(50),                        -- 客戶 ID（若有串客戶系統）

  -- 輸入
  industry          VARCHAR(20)   NOT NULL,             -- manufacturing / retail
  signals           JSON          NOT NULL,             -- 勾選的訊號陣列
  contact_method    VARCHAR(10)   NOT NULL,             -- phone / visit / line / email
  attendance        VARCHAR(20),
  survey_filled     VARCHAR(10),

  -- 輸出（整段 Markdown 原文，Parser 前）
  raw_output        TEXT          NOT NULL,

  -- Parser 後的結構化結果
  tier              VARCHAR(5)    NOT NULL,             -- P1 / P2 / P3 / P4
  label             VARCHAR(20),
  primary_anchor    VARCHAR(30),
  secondary_signals JSON,
  approach          TEXT,
  content           TEXT,                               -- 含 <cite> 標記
  questions         JSON,
  speakers          JSON,                               -- 引用的 code 陣列
  next_action       TEXT,
  next_timing       VARCHAR(50),
  next_materials    JSON,

  -- 時間戳
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_user (user_id),
  INDEX idx_tier (tier),
  INDEX idx_created (created_at)
);
```

---

## 匯入資料的建議流程

### Step 1：解析講師卡 md

寫一個 Node.js 或 Python 腳本，遞迴讀取 `speakers/*.md`，用 regex 或 markdown parser 抓出每張知識卡的欄位。

建議用的欄位標記（md 中已用）：
- `### K-XXX-NN：標題` → code + 卡片名稱
- `- **short_quote**: ...` → short_quote
- `- **slide_ref**: ...` → slide_ref
- `- **source_timestamp**: ...` → source_timestamp
- `- **applicable_signals**: ...` → applicable_signals
- `#### 完整觀點` 下一段 → full_content
- `#### 業務可用短句` 下 `- ` 清單 → business_phrases 陣列

### Step 2：寫入資料庫

```javascript
// 偽代碼示例
const cards = parseSpeakerMarkdown('./speakers/黃盈彰.md');
for (const card of cards) {
  await db.query(`
    INSERT INTO speaker_knowledge_cards
    (code, speaker_name, speaker_title, speaker_code, is_digiwin,
     short_quote, full_content, business_phrases,
     slide_ref, source_timestamp, applicable_signals, industry_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    card.code,
    '黃盈彰',
    '黃盈彰總經理',
    'HYZ',
    true,
    card.short_quote,
    card.full_content,
    JSON.stringify(card.business_phrases),
    card.slide_ref,
    card.source_timestamp,
    JSON.stringify(card.applicable_signals),
    'both'
  ]);
}
```

### Step 3：建立索引與全文搜尋（選配）

若要做「關鍵字搜尋」功能，可加 FULLTEXT 索引：

```sql
ALTER TABLE speaker_knowledge_cards
ADD FULLTEXT INDEX idx_fulltext (short_quote, full_content);
```

---

## 前端渲染 cite 標記的建議

### 步驟 1：Parser 抓 cite 標記

```javascript
// 用 regex 找出所有 <cite> 標記
const citePattern = /<cite code="([^"]+)">([^<]+)<\/cite>/g;
const matches = [...contentText.matchAll(citePattern)];

for (const match of matches) {
  const [fullMatch, code, quote] = match;
  // code = "K-HYZ-05"
  // quote = "同步看身份、權限、追溯"
}
```

### 步驟 2：查資料庫

```javascript
async function getCardByCode(code) {
  return await db.queryOne(
    'SELECT * FROM speaker_knowledge_cards WHERE code = ?',
    [code]
  );
}
```

### 步驟 3：渲染成 hover 元件

以 React + Radix UI Tooltip 為例：

```jsx
<Tooltip>
  <Tooltip.Trigger asChild>
    <span className="cite-marker">{quote}</span>
  </Tooltip.Trigger>
  <Tooltip.Content>
    <h4>{card.speaker_title}</h4>
    <p><strong>{card.short_quote}</strong></p>
    <p>{card.full_content}</p>
    <small>{card.slide_ref} · {card.source_timestamp}</small>
  </Tooltip.Content>
</Tooltip>
```

行動裝置上 Radix UI Tooltip 會自動轉成 tap 觸發，不需額外處理。

---

## 預估資料量

目前 skill 中定義的知識卡數量：

| 講師 | 知識卡數 |
| --- | --- |
| 李義訓副總裁 | 6 |
| 黃昱凱副總裁 | 7 |
| 黃盈彰總經理 | 8 |
| 林大馗董事 | 6 |
| 洪春暉所長 | 7 |
| 詹文男院長 | 9 |
| 朱浩所長 | 7 |
| **合計** | **50** |

單張卡約 300-500 bytes（不含索引），整張表約 25 KB，對資料庫幾乎零負擔。

---

## 未來擴充建議

### 新增講師

1. 新增一份 `speakers/{新講師}.md`
2. 更新 `rules/speaker_citation_rules.md` 的講師對應表與知識卡清單
3. 更新 `references/講師稱謂對照表.md`
4. 重新執行匯入腳本

### 新增知識卡

1. 在既有 `speakers/{講師}.md` 新增一張卡（用下一個編號）
2. 更新 `rules/speaker_citation_rules.md` 的知識卡清單
3. 重新執行匯入腳本

### 知識卡版本控管

如果想追蹤知識卡內容的變更歷史，可加一張 `speaker_knowledge_cards_history` 表，用 trigger 自動寫入變更紀錄。目前階段不建議提前優化。
