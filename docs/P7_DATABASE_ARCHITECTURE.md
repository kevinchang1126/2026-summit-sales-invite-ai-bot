# P7 業務客戶回訪系統 — 資料庫架構規劃

**生成日期**：2026-04-24  
**Phase**：P7（客戶跟進話術生成系統）  
**涉及系統**：D1 SQLite 資料庫 + Gemini API + 前端 UI

---

## 📋 目錄

- [1. 當前 D1 Schema 評估](#current-assessment)
- [2. P7 新增表設計](#p7-new-tables)
- [3. 資料流向與生命週期](#data-lifecycle)
- [4. 與現有知識庫的區隔](#knowledge-separation)
- [5. API 端點規劃](#api-endpoints)
- [6. 資料匯入流程](#data-import)
- [7. 實現步驟與優先級](#implementation-steps)

---

## <a id="current-assessment"></a>1. 當前 D1 Schema 評估

### 現有 12 張表

```
✅ users                     — 用戶（Teams 登入）
✅ user_roles                — 用戶角色授權（superadmin/eventadmin）
✅ event_admins              — 活動管理員範圍限制
✅ events                    — 活動主檔
✅ event_series              — 系列活動
✅ resources                 — 活動資源
✅ tags                      — 標籤字典
✅ tag_relations             — 標籤關聯
✅ pitches                   — Pitch 說帖排行（P1 舊系統）
✅ votes                     — 投票記錄
✅ rate_limits               — 限流
📌 （缺）知識庫專用表        — 目前知識內容存於 md 檔，未入 D1
```

### 評估：P7 能否用現有表？

| 需求 | 現有表 | 判定 | 說明 |
|---|---|---|---|
| 客戶資料存儲 | ❌ | 需新增 | 無客戶表，需要 `customers` 表 |
| 問卷訊號存儲 | ❌ | 需新增 | 無問卷記錄表，需要 `customer_survey_responses` |
| 業務-客戶對應 | ❌ | 需新增 | 無銷售負責範圍表，需要 `salesperson_assignments` |
| 預生成說帖 | ⚠️ 可用但不適 | 需新增 | 現有 `pitches` 是 P1 排行榜，邏輯不同 |
| 講師知識卡 | ❌ | 需新增 | 知識內容未結構化，需要 `speaker_knowledge_cards` |
| 說帖版本管理 | ❌ | 需新增 | 同一說帖多個聯繫方式版本，需要 `pitch_variants` |

**結論**：需新增 **6 張表**，保持現有結構不變。

---

## <a id="p7-new-tables"></a>2. P7 新增表設計

### 2.1 `customers` — 客戶主檔

存儲年會後跟進的客戶基本資料。

```sql
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- 基本資訊
  customer_name TEXT NOT NULL,
  customer_company TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_wechat TEXT,
  
  -- 產業與職位
  industry TEXT NOT NULL CHECK(industry IN ('manufacturing', 'retail')),
  job_title TEXT,
  
  -- 年會參與狀態
  event_id TEXT NOT NULL,
  attendance_status TEXT NOT NULL DEFAULT 'unknown' 
    CHECK(attendance_status IN ('attended', 'no_show', 'unknown')),
  survey_filled BOOLEAN DEFAULT 0,
  
  -- 銷售負責人
  assigned_user_code TEXT,
  assigned_user_name TEXT,
  
  -- 追蹤狀態
  current_tier TEXT DEFAULT 'unknown' CHECK(current_tier IN ('P1', 'P2', 'P3', 'P4', 'unknown')),
  last_tier_update INTEGER,
  
  -- 來源與時間戳
  imported_from TEXT,  -- 'csv', 'manual', 'system' 等
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  -- 索引
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_user_code) REFERENCES users(user_code) ON DELETE SET NULL
);

CREATE INDEX idx_customers_industry ON customers(industry);
CREATE INDEX idx_customers_event ON customers(event_id);
CREATE INDEX idx_customers_assigned ON customers(assigned_user_code);
CREATE INDEX idx_customers_tier ON customers(current_tier);
CREATE INDEX idx_customers_attendance ON customers(attendance_status);
```

### 2.2 `customer_survey_responses` — 客戶問卷訊號

存儲每個客戶的問卷勾選訊號，支持動態更新（客戶補填問卷時）。

```sql
CREATE TABLE IF NOT EXISTS customer_survey_responses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  customer_id TEXT NOT NULL UNIQUE,  -- 一個客戶一筆問卷記錄
  
  -- 訊號陣列（JSON 格式，存儲代碼清單）
  -- 範例：["Q1_ARRANGE", "Q4_INTEGRATED", "Q5_SUPPLY_CHAIN"]
  signals JSON NOT NULL DEFAULT '[]',
  
  -- 分類結果快取（避免每次都重新分類）
  primary_anchor TEXT,  -- 如 Q1_ARRANGE 或 BEHAVIOR_NO_SHOW
  secondary_signals JSON,  -- 其他訊號
  
  -- 問卷完成度
  last_updated INTEGER NOT NULL DEFAULT (unixepoch()),
  
  -- 備註（業務手動調整時記錄原因）
  manual_override BOOLEAN DEFAULT 0,
  manual_override_reason TEXT,
  override_by TEXT,
  override_at INTEGER,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX idx_responses_primary ON customer_survey_responses(primary_anchor);
CREATE INDEX idx_responses_updated ON customer_survey_responses(last_updated);
```

### 2.3 `salesperson_assignments` — 業務-客戶分配

定義每個業務負責的客戶範圍（支持按產業、事件篩選）。

```sql
CREATE TABLE IF NOT EXISTS salesperson_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  user_code TEXT NOT NULL,
  user_name TEXT NOT NULL,
  
  -- 分配維度（可複選組合）
  event_id TEXT,                    -- 若為空，表示所有活動
  assigned_industry TEXT,            -- 若為空，表示所有產業
  assigned_tier TEXT,                -- 若為空，表示所有 tier
  
  -- 分配詳情
  notes TEXT,
  
  -- 狀態
  is_active BOOLEAN DEFAULT 1,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  FOREIGN KEY (user_code) REFERENCES users(user_code) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX idx_assignments_user ON salesperson_assignments(user_code);
CREATE INDEX idx_assignments_event ON salesperson_assignments(event_id);
CREATE INDEX idx_assignments_active ON salesperson_assignments(is_active);
```

### 2.4 `speaker_knowledge_cards` — 講師知識卡

結構化存儲每位講師的觀點卡片（用於說帖生成時的引用和渲染）。

```sql
CREATE TABLE IF NOT EXISTS speaker_knowledge_cards (
  code TEXT PRIMARY KEY,  -- 例：K-HYZ-05，不自動生成
  
  -- 講師資訊
  speaker_name TEXT NOT NULL,        -- 黃盈彰
  speaker_title TEXT NOT NULL,       -- 黃盈彰總經理
  speaker_code TEXT NOT NULL,        -- HYZ
  is_digiwin BOOLEAN NOT NULL DEFAULT 0,
  
  -- 知識卡內容
  short_quote TEXT NOT NULL,         -- 10-20 字濃縮
  full_content TEXT NOT NULL,        -- 100-150 字完整觀點
  business_phrases JSON NOT NULL,    -- JSON 陣列，3-5 句業務可用短句
  
  -- 來源參考
  slide_ref TEXT,                    -- 例：PPT Slide 12-17
  source_timestamp TEXT,             -- 例：00:20:48
  
  -- 應用訊號
  applicable_signals JSON NOT NULL,  -- JSON 陣列，如 ["Q5_SUPPLY_CHAIN", "Q6_WORKLOAD"]
  
  -- 產業範圍
  industry_scope TEXT NOT NULL DEFAULT 'both',
    CHECK(industry_scope IN ('manufacturing', 'retail', 'both')),
  
  -- 排序
  display_order INT NOT NULL DEFAULT 0,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_cards_speaker ON speaker_knowledge_cards(speaker_code);
CREATE INDEX idx_cards_industry ON speaker_knowledge_cards(industry_scope);
CREATE INDEX idx_cards_digiwin ON speaker_knowledge_cards(is_digiwin);
```

### 2.5 `pre_generated_pitches` — 預生成說帖

存儲業務可直接使用或修改的預生成說帖。**核心表**。

```sql
CREATE TABLE IF NOT EXISTS pre_generated_pitches (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  -- 輸入參數（識別碼）
  event_id TEXT NOT NULL,
  industry TEXT NOT NULL,
  -- 分類（客戶群輪廓，不是單一客戶）
  primary_tier TEXT NOT NULL CHECK(primary_tier IN ('P1', 'P2', 'P3', 'P4')),
  primary_anchor TEXT,               -- 如 Q1_ARRANGE
  secondary_signals JSON,            -- 複合訊號清單
  
  -- 聯繫方式（4 個版本）
  contact_method TEXT NOT NULL 
    CHECK(contact_method IN ('phone', 'email', 'line', 'visit')),
  
  -- 生成內容（Markdown 格式，含 <cite> 標記）
  -- 以下欄位完整存儲說帖內容
  classification_text TEXT NOT NULL, -- CLASSIFICATION 區塊
  approach_text TEXT NOT NULL,       -- APPROACH 區塊
  content_text TEXT NOT NULL,        -- CONTENT 區塊（含 <cite code="K-XXX-NN">）
  questions_text TEXT NOT NULL,      -- QUESTIONS 區塊
  speakers_text TEXT NOT NULL,       -- SPEAKERS 區塊
  next_actions_text TEXT NOT NULL,   -- NEXT_ACTIONS 區塊
  
  -- 原始 Markdown（方便查審和再生成）
  raw_markdown TEXT NOT NULL,
  
  -- 生成資訊
  generated_by TEXT,                 -- 系統或人工
  generated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  generated_model TEXT,              -- gemini-flash-latest
  
  -- 使用統計
  view_count INT DEFAULT 0,
  use_count INT DEFAULT 0,           -- 業務實際使用次數
  last_used_at INTEGER,
  
  -- 版本控制
  is_latest BOOLEAN DEFAULT 1,       -- 是否為最新版本
  parent_pitch_id TEXT,              -- 若為修改版，指向原版本
  
  -- 質量檢查
  quality_score INT,                 -- 1-5，後續人工評分用
  quality_feedback TEXT,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_pitches_unique 
  ON pre_generated_pitches(event_id, industry, primary_tier, contact_method);
CREATE INDEX idx_pitches_tier ON pre_generated_pitches(primary_tier);
CREATE INDEX idx_pitches_contact ON pre_generated_pitches(contact_method);
CREATE INDEX idx_pitches_generated ON pre_generated_pitches(generated_at);
CREATE INDEX idx_pitches_latest ON pre_generated_pitches(is_latest);
```

### 2.6 `follow_up_histories` — 跟進歷史紀錄

業務使用說帖進行跟進時的記錄。

```sql
CREATE TABLE IF NOT EXISTS follow_up_histories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  
  customer_id TEXT NOT NULL,
  assigned_user_code TEXT NOT NULL,
  
  -- 使用的說帖
  pitch_id TEXT,                     -- 參考的預生成說帖 ID
  
  -- 跟進詳情
  contact_method TEXT NOT NULL 
    CHECK(contact_method IN ('phone', 'email', 'line', 'visit')),
  follow_up_content TEXT,            -- 業務實際傳送或說的內容
  
  -- 反應記錄
  customer_response TEXT,            -- 客戶反應
  response_sentiment TEXT             -- positive / neutral / negative
    CHECK(response_sentiment IN ('positive', 'neutral', 'negative', 'unknown')),
  
  -- 後續行動
  next_action TEXT,
  next_action_date INTEGER,
  
  -- 商機相關
  opportunity_created BOOLEAN DEFAULT 0,
  opportunity_id TEXT,
  
  notes TEXT,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT NOT NULL,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_user_code) REFERENCES users(user_code) ON DELETE SET NULL,
  FOREIGN KEY (pitch_id) REFERENCES pre_generated_pitches(id) ON DELETE SET NULL
);

CREATE INDEX idx_followup_customer ON follow_up_histories(customer_id);
CREATE INDEX idx_followup_user ON follow_up_histories(assigned_user_code);
CREATE INDEX idx_followup_date ON follow_up_histories(created_at);
CREATE INDEX idx_followup_response ON follow_up_histories(response_sentiment);
```

---

## <a id="data-lifecycle"></a>3. 資料流向與生命週期

```
┌─────────────────────────────────────────────────────────────────┐
│ 第一階段：資料導入                                               │
└─────────────────────────────────────────────────────────────────┘

業務提供客戶清單（CSV/XLSX）
    ↓
上傳到平台 → POST /api/customers/batch-import
    ↓
① 解析 & 驗證欄位（customer_name, industry, attendance_status 等）
② 插入 customers 表
③ 初始化 customer_survey_responses（signals 為空 or 從問卷資料填充）
④ 自動分類 tier（基於訊號或行為情境）
    ↓
customers + customer_survey_responses 兩表完成


┌─────────────────────────────────────────────────────────────────┐
│ 第二階段：預生成說帖（批量操作）                                 │
└─────────────────────────────────────────────────────────────────┘

管理後台 → Batch Generate Pitches
    ↓
選擇：event_id + industry + 欲生成的 tier + contact_methods
    ↓
FOR EACH (industry, tier, contact_method) COMBINATION:
    ① 查 customer_survey_responses 統計該組合的典型訊號
    ② 組合 Gemini 的 system prompt
    ③ 呼叫 /api/follow-up/generate-pitch
    ④ Gemini 回傳 Markdown 說帖（含分類 + 話術 + 講師卡）
    ⑤ Parser 解析 Markdown → 拆分為 6 個欄位
    ⑥ 存入 pre_generated_pitches（is_latest=1）
    ↓
pre_generated_pitches 表完成


┌─────────────────────────────────────────────────────────────────┐
│ 第三階段：業務選擇使用                                           │
└─────────────────────────────────────────────────────────────────┘

業務登入 → 進入「客戶跟進」頁面
    ↓
Filter：[我的客戶] [按產業] [按 Tier]
    ↓
GET /api/salesperson/customers
    → 查 customers + salesperson_assignments（filtering）
    → JOIN 最新的 pre_generated_pitches（基於 industry + tier）
    ↓
顯示客戶卡片 + 對應的預生成說帖 4 個版本（phone/email/line/visit）
    ↓
業務點擊「使用說帖」→ GET /api/pitches/[pitch_id]
    ↓
前端展示說帖，業務可複製或編輯
    ↓
業務記錄跟進 → POST /api/follow-up-records
    → 存入 follow_up_histories 表
    ↓
follow_up_histories 表記錄完成
```

---

## <a id="knowledge-separation"></a>4. 與現有知識庫的區隔

### 現有 P1 知識庫結構

```
functions/api/knowledge/
  ├── industry.js         → 返回行業洞見
  ├── role.js             → 返回職位通用建議
  ├── channel.js          → 返回管道特性
  └── ...

docs/
  ├── industry-pain-points.md
  ├── prompt.md
  └── ...
```

**用途**：支持 P1 的「Pitch 生成」功能（銷售人員為潛在客戶的初步說帖）

### P7 回訪知識庫結構

```
functions/api/follow-up/
  ├── generate-pitch.js   → 呼叫 Gemini + parser
  ├── knowledge.js        → 查詢 speaker_knowledge_cards

docs/回訪skill_v2/
  ├── SKILL.md            → 生成規則
  ├── rules/
  │   ├── classification_rules.md
  │   ├── speaker_citation_rules.md
  │   └── ...
  ├── templates/          → 各聯繫方式範本
  ├── speakers/           → 講師知識卡（導入到 DB）
  └── references/         → 製造/流通問卷對應表
```

**用途**：支持 P7 的「回訪說帖生成」（已參會客戶的後續跟進）

### 區隔策略

| 維度 | P1（現有 knowledge API） | P7（新增 follow-up API） |
|---|---|---|
| **知識源** | `docs/prompt.md` / `industry-pain-points.md` | `docs/回訪skill_v2/` |
| **API 端點** | `/api/knowledge/*` | `/api/follow-up/*` |
| **DB 表** | ❌ 無 | ✅ `speaker_knowledge_cards` + `pre_generated_pitches` |
| **輸入** | 自由文本 + 選項（行業/角色/管道）| 結構化勾選 + 客戶屬性 + 訊號 |
| **輸出** | Pitch（無說帖結構） | 格式化說帖（6 區塊 + cite 標記） |
| **目標使用者** | 全體業務 | 年會回訪業務 |

**設計方針**：
1. **獨立加載** → P7 不依賴 P1 的 knowledge API，有自己的 follow-up API
2. **資料共享** → speaker_knowledge_cards 可供前端的「講師速查」功能使用
3. **模型選擇** → P1 用 gemini-flash，P7 也用 gemini-flash（或依成本考慮用 1.5-flash）
4. **Prompt 管理** → SKILL.md 成為 P7 的「執行標準」，分層載入規則檔

---

## <a id="api-endpoints"></a>5. API 端點規劃

### 5.1 客戶管理 API

```
POST   /api/customers/batch-import
       輸入：{ file, event_id, industry, auto_assign_to_user }
       功能：解析 CSV/XLSX，插入 customers + customer_survey_responses，自動分類
       回傳：{ imported_count, errors[] }

GET    /api/salesperson/customers
       Query：?event_id=...&industry=...&tier=...
       功能：查詢業務分配給自己的客戶清單（自動 JOIN 最新的 pitch）
       回傳：[{ customer, current_tier, pitch_variants{phone, email, line, visit} }]

GET    /api/customers/[id]
       功能：客戶詳情 + 問卷訊號 + 跟進歷史
       回傳：{ customer, survey_responses, follow_up_history[] }

PATCH  /api/customers/[id]
       輸入：{ survey_signals?, attendance_status?, assigned_user_code? }
       功能：更新客戶訊號/狀態，自動重新分類 tier
       回傳：{ customer, updated_tier, affected_pitches[] }
```

### 5.2 說帖生成 API

```
POST   /api/follow-up/generate-pitch
       輸入：{
         industry: "manufacturing" | "retail",
         primary_tier: "P1" | "P2" | "P3" | "P4",
         primary_anchor: "Q1_ARRANGE" | "BEHAVIOR_NO_SHOW" | ...,
         secondary_signals: [...],
         contact_method: "phone" | "email" | "line" | "visit"
       }
       功能：
         ① 組合 system prompt（載入 SKILL.md + 對應規則）
         ② 呼叫 Gemini
         ③ Parser 分割成 6 個欄位
         ④ 插入或更新 pre_generated_pitches
       回傳：{
         id,
         raw_markdown,
         classification_text,
         approach_text,
         content_text,
         questions_text,
         speakers_text,
         next_actions_text,
         cite_markers: [{ code, quote, speaker }]  // 前端渲染用
       }
       權限：superadmin 或 事件的 event_admin

POST   /api/follow-up/batch-generate
       輸入：{
         event_id,
         industry: "manufacturing" | "retail" | "both",
         tiers: ["P1", "P2", "P3", "P4"],
         contact_methods: ["phone", "email", "line", "visit"]
       }
       功能：批量生成指定組合的說帖（可能耗時）
       回傳：{ job_id, status: "queued" | "processing" | "completed" }

GET    /api/follow-up/pitches
       Query：?event_id=...&industry=...&tier=...&contact_method=...
       功能：查詢預生成說帖清單
       回傳：[{ id, tier, primary_anchor, contact_method, generated_at, view_count }]

GET    /api/follow-up/pitches/[id]
       功能：獲取完整說帖
       回傳：{ 同上述 generate-pitch 回傳格式 }

POST   /api/follow-up/pitches/[id]/publish
       功能：將某個版本標記為可供業務使用的「published」版本
       權限：superadmin / event_admin
```

### 5.3 講師知識卡 API

```
GET    /api/speaker-knowledge-cards
       Query：?speaker_code=...&industry=...&signals=...
       功能：查詢知識卡清單（前端「講師速查」功能用）
       回傳：[{ code, speaker_title, short_quote, display_order }]

GET    /api/speaker-knowledge-cards/[code]
       功能：獲取完整知識卡（hover 展開用）
       回傳：{ code, speaker_title, short_quote, full_content, business_phrases, slide_ref, ... }

POST   /api/admin/speaker-knowledge-cards/import
       輸入：{ files: [speaker_md_content] }
       功能：批量導入講師卡（從 md 解析）
       權限：superadmin
       回傳：{ imported_count, errors[] }
```

### 5.4 跟進紀錄 API

```
POST   /api/follow-up-records
       輸入：{
         customer_id,
         contact_method: "phone" | "email" | "line" | "visit",
         follow_up_content,
         customer_response,
         response_sentiment: "positive" | "neutral" | "negative",
         next_action,
         next_action_date
       }
       功能：記錄一次跟進活動
       回傳：{ id, created_at }

GET    /api/customers/[id]/follow-up-history
       功能：查詢某客戶的所有跟進紀錄
       回傳：[{ id, follow_up_content, response_sentiment, next_action_date }]

GET    /api/salesperson/follow-up-stats
       Query：?start_date=...&end_date=...&response_sentiment=...
       功能：查詢業務自己的跟進統計（用於儀表板）
       回傳：{ total_count, positive_count, conversion_count, ... }
```

---

## <a id="data-import"></a>6. 資料匯入流程

### 6.1 客戶名單導入

**輸入格式** — CSV 或 XLSX

```csv
customer_name,customer_company,contact_email,industry,job_title,attendance_status,survey_filled
張三,ABC 製造股份有限公司,zhang@abc.com,manufacturing,廠長,attended,yes
李四,XYZ 流通有限公司,li@xyz.com,retail,採購主管,no_show,no
```

**匯入步驟**

```js
async function importCustomers(file, eventId) {
  // 1. 解析檔案
  const rows = parseCSV(file);
  
  // 2. 驗證必填欄位
  validateRows(rows);
  
  // 3. 批量插入 customers
  const customerIds = [];
  for (const row of rows) {
    const customerId = await db.prepare(`
      INSERT INTO customers (
        customer_name, customer_company, contact_email,
        industry, job_title, event_id,
        attendance_status, survey_filled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      row.customer_name,
      row.customer_company,
      row.contact_email,
      row.industry,
      row.job_title,
      eventId,
      row.attendance_status || 'unknown',
      row.survey_filled === 'yes' ? 1 : 0
    ).run();
    customerIds.push(customerId);
  }
  
  // 4. 初始化 customer_survey_responses（signals 為空，等待後續更新）
  for (const customerId of customerIds) {
    await db.prepare(`
      INSERT INTO customer_survey_responses (customer_id, signals)
      VALUES (?, '[]')
    `).bind(customerId).run();
  }
  
  // 5. 自動分類 tier（基於 attendance_status + survey_filled）
  for (const customerId of customerIds) {
    const tier = classifyTier({
      attendance: ...,
      survey_filled: ...,
      signals: []
    });
    await db.prepare(`
      UPDATE customers SET current_tier = ? WHERE id = ?
    `).bind(tier, customerId).run();
  }
  
  return { imported_count: customerIds.length };
}
```

### 6.2 問卷訊號導入（可選）

如果客戶清單已包含問卷資料（例如問卷系統直接導出），可進一步補充訊號。

**輸入格式** — CSV，包含訊號代碼列

```csv
customer_id,Q1_signal,Q4_signal,Q5_signal,Q7_signal
cust_001,Q1_ARRANGE,Q4_INTEGRATED,Q5_SUPPLY_CHAIN,Q7_DATA
cust_002,,Q4_TRIAL,Q5_FINANCE,
```

**匯入步驟**

```js
async function importSurveySignals(file) {
  const rows = parseCSV(file);
  
  for (const row of rows) {
    // 收集非空的訊號
    const signals = [
      row.Q1_signal,
      row.Q4_signal,
      row.Q5_signal,
      row.Q7_signal,
      // ... 其他題目
    ].filter(v => v);
    
    // 分類 tier
    const { tier, primary_anchor, secondary } = classifyTier({
      signals,
      industry: row.industry,
      attendance: row.attendance_status,
      survey_filled: signals.length > 0
    });
    
    // 更新 customer_survey_responses
    await db.prepare(`
      UPDATE customer_survey_responses
      SET signals = ?, primary_anchor = ?, secondary_signals = ?
      WHERE customer_id = ?
    `).bind(
      JSON.stringify(signals),
      primary_anchor,
      JSON.stringify(secondary),
      row.customer_id
    ).run();
    
    // 同步更新 customers 表的 tier
    await db.prepare(`
      UPDATE customers SET current_tier = ?, last_tier_update = ?
      WHERE id = ?
    `).bind(tier, unixepoch(), row.customer_id).run();
  }
}
```

### 6.3 講師知識卡導入（一次性）

**來源**：`docs/回訪skill_v2/speakers/*.md`

**步驟**：寫一個 Node.js 腳本遞迴讀取，解析 Markdown，批量插入。

```js
async function importSpeakerKnowledgeCards() {
  const speakers = [
    { name: '黃盈彰', code: 'HYZ', isDigiwin: true, file: './speakers/黃盈彰.md' },
    { name: '李義訓', code: 'LYH', isDigiwin: true, file: './speakers/李義訓.md' },
    // ...
  ];
  
  for (const speaker of speakers) {
    const content = fs.readFileSync(speaker.file, 'utf-8');
    
    // 用 regex 或 markdown parser 抽卡片
    const cards = parseMarkdownToCards(content);
    
    for (const card of cards) {
      await db.prepare(`
        INSERT OR REPLACE INTO speaker_knowledge_cards (
          code, speaker_name, speaker_title, speaker_code, is_digiwin,
          short_quote, full_content, business_phrases,
          slide_ref, source_timestamp, applicable_signals, industry_scope
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        card.code,
        speaker.name,
        card.title,
        speaker.code,
        speaker.isDigiwin ? 1 : 0,
        card.short_quote,
        card.full_content,
        JSON.stringify(card.business_phrases),
        card.slide_ref,
        card.source_timestamp,
        JSON.stringify(card.applicable_signals),
        card.industry_scope
      ).run();
    }
  }
  
  console.log(`Imported all speaker knowledge cards.`);
}
```

---

## <a id="implementation-steps"></a>7. 實現步驟與優先級

### 第 1 批（週 1-2）—— **必做**

優先級：**P0**（blocking，無法開始業務測試）

```
□ 新增 6 張表的 SQL （schema.sql）
□ 驗證 D1 遠端與本地都能執行新 schema
□ 測試：手動在本地 D1 執行 npm run db:init:local 確認表建立成功

□ 寫 /api/customers/batch-import 端點（CSV 解析 + 批量插入 + 自動分類）
□ 寫客戶查詢 API：GET /api/salesperson/customers
□ 寫客戶詳情 API：GET /api/customers/[id]
□ 測試：模擬上傳 10 個測試客戶，驗證分類正確

□ 寫 speaker_knowledge_cards 導入腳本
□ 從 docs/回訪skill_v2/speakers/*.md 批量導入（～50 張卡）
□ 前端講師速查頁面（展示知識卡清單 + hover 詳情）
```

### 第 2 批（週 3-4）—— **高優**

優先級：**P1**（說帖生成的核心）

```
□ 寫 Gemini 呼叫邏輯（system prompt 組合 + 分層載入規則）
□ 實現 /api/follow-up/generate-pitch 端點
□ Parser：將 Markdown 說帖拆分為 6 個欄位 + cite 標記提取
□ 寫入 pre_generated_pitches 表

□ 寫 /api/follow-up/batch-generate 端點（背景任務或排隊）
□ 前端：批量生成 UI + 進度條

□ 測試：
  - 人工驗證生成的說帖是否符合 SKILL.md 檢查清單
  - 驗證 cite 標記正確指向講師知識卡
  - 驗證 tier 相符、字數符合、無過度承諾
```

### 第 3 批（週 5）—— **高優**

優先級：**P1**（業務使用介面）

```
□ 新增「客戶跟進」頁面（/customers-followup.html）
  ├─ 過濾：[事件] [產業] [Tier]
  ├─ 客戶清單：name, company, status, current_tier, assigned_user
  ├─ 客戶卡片點開：
  │  ├─ 問卷訊號展示
  │  ├─ 跟進歷史 Timeline
  │  └─ 4 個預生成說帖版本（phone/email/line/visit）
  └─ 說帖操作：複製 / 修改 / 記錄跟進

□ 寫 /api/follow-up-records 端點
□ 前端跟進紀錄彈窗：
  ├─ 聯繫方式 (radio)
  ├─ 反應記錄 (textarea)
  ├─ 反應情感 (radio: positive/neutral/negative)
  ├─ 下一步行動 & 日期
  └─ 送出

□ 測試：業務使用完整流程（查詢 → 複製說帖 → 跟進 → 記錄）
```

### 第 4 批（週 6）—— **中優**

優先級：**P2**（儀表板 + 統計）

```
□ 寫 /api/salesperson/follow-up-stats 端點
□ 前端儀表板：
  ├─ 總跟進數
  ├─ 正面回應率
  ├─ 客戶分佈（按 Tier）
  └─ 轉化漏斗（報名 → 參會 → 填問卷 → 跟進 → 商機）

□ 業務自己的客戶列表分享 / 導出
```

### 第 5 批（迭代優化）—— **低優**

優先級：**P3**（未來增強）

```
□ 說帖版本控管 + A/B 測試（同一輪廓生成多版本供對比）
□ 質量評分 & 人工反饋
□ 講師知識卡的全文搜尋（FULLTEXT INDEX）
□ 業務手動修改訊號後的自動重新分類提示
□ Teams / Slack 整合（自動推送跟進提醒）
```

---

## 📊 資料量預估

| 表名 | 預計記錄數（年會規模 1000 人） | 儲存空間 |
|---|---|---|
| customers | 1000 | ~100 KB |
| customer_survey_responses | 1000 | ~50 KB |
| salesperson_assignments | 50 | ~5 KB |
| speaker_knowledge_cards | 50 | ~25 KB |
| pre_generated_pitches | ~32 (4 tier × 2 industry × 4 methods) | ~100 KB |
| follow_up_histories | 1000-3000（年會結束後 3 個月內） | ~300 KB |
| **合計** | | **~600 KB** |

**結論**：對 D1 零負擔（Cloudflare D1 支持 GB 級）。

---

## ✅ 檢查清單（實現前確認）

```
[ ] 現有 schema.sql 有備份
[ ] 新表 SQL 已過本地驗證（npm run db:init:local）
[ ] 新表已過 wrangler d1 remote 驗證（測試環境）
[ ] Gemini API key 已設定在 Pages Dashboard（GEMINI_API_KEY）
[ ] docs/回訪skill_v2/ 所有檔案已收納到版本控制
[ ] 講師知識卡導入腳本已寫好，預跑成功
[ ] API 端點的權限 check（superadmin / eventadmin / salesperson）已定義清楚
[ ] 前端「客戶跟進」頁面的 UI mockup 已確認
[ ] 測試資料集：10 個客戶、4 個 tier、2 個產業已準備
```

---

**文件版本**：v1.0  
**最後更新**：2026-04-24  
**負責人**：Kevin Chang  
**狀態**：待審核 → 可實現
