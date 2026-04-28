# P7 前端業務 UI 架構設計

**階段**：P7（客戶回訪話術生成系統）  
**優先級**：第一批（前端先做，後端跟上）  
**生成日期**：2026-04-24

---

## 📋 目錄

- [1. 整體頁面結構](#page-structure)
- [2. 講師卡的兩種調用方式](#speaker-cards-usage)
- [3. 前端檔案清單](#frontend-files)
- [4. 詳細頁面設計](#page-details)
- [5. 交互流程圖](#interaction-flows)
- [6. 資料繫結與 API 合約](#api-contracts)

---

## <a id="page-structure"></a>1. 整體頁面結構

### 新增 3 個頁面

```
public/
├─ index.html                    （現有，P1 說帖生成）
├─ admin.html                    （現有，後台管理）
├─ resources.html                （現有，P4 資源中心）
│
├─ follow-up.html               ✨ NEW — 回訪話術主頁面
│  ├─ 客戶清單區塊
│  ├─ 篩選區塊
│  └─ 客戶卡片（迷你版）
│
├─ follow-up-customer.html      ✨ NEW — 客戶詳情頁
│  ├─ 客戶基本資訊
│  ├─ 問卷訊號與分類結果
│  ├─ 跟進歷史
│  └─ 4 個聯繫方式說帖（可複製、編輯、記錄跟進）
│
├─ speaker-gallery.html         ✨ NEW — 講師速查頁
│  ├─ 講師卡列表（grid view）
│  ├─ 搜尋 & 篩選
│  └─ 卡片展開詳情（知識卡）
│
├─ follow-up.css                ✨ NEW
├─ follow-up.js                 ✨ NEW
└─ speaker-gallery.js           ✨ NEW
```

---

## <a id="speaker-cards-usage"></a>2. 講師卡的兩種調用方式

### 方式 1：業務主動查詢講師卡（speaker-gallery.html）

```
業務點擊「講師速查」→ /speaker-gallery.html
    ↓
展示所有講師卡清單（grid，可搜尋、篩選）
    ↓
業務點擊卡片 → 彈窗展開完整內容
    ├─ 短摘要（已顯示在卡片上）
    ├─ 完整觀點 (hover 後展開)
    ├─ 業務可用短句（列表）
    ├─ 來源參考 (PPT 頁碼、時間戳)
    ├─ 知識卡代碼 (K-HYZ-05) ← 方便複製到說帖
    └─ 適用訊號（標籤）
```

**資料來源**：
- 短期：`docs/回訪skill_v2/speakers/*.md` → 前端用 JavaScript 動態讀取 + 解析（不入 DB）
- 長期：可 sync 到 `speaker_knowledge_cards` 表，API 查詢

### 方式 2：說帖生成時自動引用（follow-up-customer.html）

```
說帖內容中出現：<cite code="K-HYZ-05">同步看身份、權限、追溯</cite>
    ↓
前端 JavaScript 偵測 <cite> 標記
    ↓
使用者 hover / 點擊 <cite>
    ↓
彈出 Tooltip / Modal
    ├─ 講師名稱 + 頭銜（黃盈彰總經理）
    ├─ short_quote（已在 <cite> 裡，但再顯示一次作強調）
    ├─ full_content（100-150 字）
    ├─ business_phrases（3-5 句業務可用短句）
    └─ slide_ref（可點擊開 PPT）

使用者可：
    ├─ 查看完整觀點
    ├─ 複製業務短句
    └─ 導航回 speaker-gallery.html 深入瞭解
```

**資料來源**：
- 說帖中的 `<cite code="K-HYZ-05">` 的 code 屬性
- 查詢 `speaker_knowledge_cards` 表 （或動態讀 md）
- 渲染成 Tooltip

### 技術決策：md vs DB

| 方案 | 優點 | 缺點 | 推薦 |
|---|---|---|---|
| **方案 A：MD 文件** | 靈活、易維護、版本控制 | 需前端解析、無搜尋索引 | 📌 **先做** |
| **方案 B：DB 表** | 快速、支援搜尋、結構化 | 需同步腳本、初期維護成本 | 優化階段做 |

**建議流程**：
1. **現在（第一批）**：前端直接讀 `docs/回訪skill_v2/speakers/*.md`，用 regex 解析
2. **未來**：當需要全文搜尋或大規模查詢時，才跑一次匯入腳本到 `speaker_knowledge_cards`

---

## <a id="frontend-files"></a>3. 前端檔案清單

### 3.1 HTML 頁面

#### `public/follow-up.html` — 回訪主頁

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>客戶回訪 — 話術生成</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="follow-up.css">
</head>
<body>
  <!-- 同 index.html / admin.html 的 header 結構 -->
  <header id="app-header">
    <div class="header-left">
      <h1>🎯 客戶回訪</h1>
    </div>
    <div class="header-right">
      <button id="speaker-gallery-btn" class="btn-icon">📚 講師速查</button>
      <div id="user-badge"></div>
    </div>
  </header>

  <!-- 主容器 -->
  <main id="app-container">
    
    <!-- 篩選面板 -->
    <aside id="filter-panel" class="fu-filter">
      <h3>篩選客戶</h3>
      
      <div class="filter-group">
        <label>活動</label>
        <select id="filter-event">
          <option value="">— 全部 —</option>
        </select>
      </div>

      <div class="filter-group">
        <label>產業</label>
        <div class="filter-chips">
          <input type="checkbox" id="filter-mfg" value="manufacturing">
          <label for="filter-mfg">製造</label>
          <input type="checkbox" id="filter-retail" value="retail">
          <label for="filter-retail">流通</label>
        </div>
      </div>

      <div class="filter-group">
        <label>分類層級</label>
        <div class="filter-chips">
          <input type="checkbox" id="filter-p1" value="P1">
          <label for="filter-p1">P1 立即推進</label>
          <input type="checkbox" id="filter-p2" value="P2">
          <label for="filter-p2">P2 積極培育</label>
          <input type="checkbox" id="filter-p3" value="P3">
          <label for="filter-p3">P3 案例升溫</label>
          <input type="checkbox" id="filter-p4" value="P4">
          <label for="filter-p4">P4 長期培育</label>
        </div>
      </div>

      <div class="filter-group">
        <label>搜尋</label>
        <input type="text" id="filter-search" placeholder="客戶名稱 / 公司名">
      </div>

      <button id="filter-reset" class="btn-secondary">重設篩選</button>
    </aside>

    <!-- 客戶清單 -->
    <section id="customer-list" class="fu-list">
      <div id="list-header">
        <h2>我的客戶 <span id="list-count">(0)</span></h2>
        <div id="view-toggle">
          <button data-view="card" class="view-btn active">卡片檢視</button>
          <button data-view="table" class="view-btn">列表檢視</button>
        </div>
      </div>

      <div id="customer-cards" class="fu-cards">
        <!-- 動態插入客戶卡片 -->
      </div>

      <div id="list-empty" style="display:none;">
        <p>無符合篩選的客戶</p>
      </div>
    </section>

  </main>

  <!-- 客戶詳情 Modal（側邊欄或新頁面？） -->
  <!-- 根據 UX 設計決定是否用 modal 或導航到新頁面 -->

  <script src="app.js"></script>
  <script src="follow-up.js"></script>
</body>
</html>
```

#### `public/follow-up-customer.html` — 客戶詳情頁

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>客戶詳情</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="follow-up.css">
</head>
<body>
  <header id="app-header">
    <button id="back-btn">← 返回客戶清單</button>
    <h1 id="customer-name"></h1>
    <div id="user-badge"></div>
  </header>

  <main id="app-container" class="fu-customer-detail">
    
    <!-- 左側：客戶資訊 + 問卷訊號 -->
    <aside id="customer-info" class="fu-sidebar">
      
      <section class="fu-card">
        <h3>客戶基本資訊</h3>
        <div class="info-row">
          <span class="label">公司：</span>
          <span id="company-name"></span>
        </div>
        <div class="info-row">
          <span class="label">職位：</span>
          <span id="job-title"></span>
        </div>
        <div class="info-row">
          <span class="label">產業：</span>
          <span id="industry-badge"></span>
        </div>
        <div class="info-row">
          <span class="label">聯繫方式：</span>
          <span id="contact-info"></span>
        </div>
      </section>

      <section class="fu-card">
        <h3>參會狀態</h3>
        <div class="info-row">
          <span class="label">出席：</span>
          <span id="attendance-badge"></span>
        </div>
        <div class="info-row">
          <span class="label">問卷：</span>
          <span id="survey-badge"></span>
        </div>
      </section>

      <section class="fu-card">
        <h3>分類結果</h3>
        <div class="classification-box">
          <div class="tier-badge" id="tier-display">P1</div>
          <p id="tier-label">立即推進</p>
        </div>
        <div id="signals-display" style="margin-top: 1rem;">
          <!-- 動態填入訊號標籤 -->
        </div>
      </section>

    </aside>

    <!-- 右側：說帖 + 跟進紀錄 -->
    <section id="pitches-section" class="fu-main">
      
      <!-- Tabs：4 個聯繫方式 -->
      <div id="pitch-tabs" class="fu-tabs">
        <button class="tab-btn active" data-method="phone">☎️ 電話</button>
        <button class="tab-btn" data-method="email">✉️ Email</button>
        <button class="tab-btn" data-method="line">💬 LINE</button>
        <button class="tab-btn" data-method="visit">🚶 親訪</button>
      </div>

      <!-- 說帖容器 -->
      <div id="pitch-container" class="fu-pitch">
        
        <!-- 說帖頭部（分類 + 生成資訊） -->
        <div id="pitch-header" class="pitch-header">
          <h3>回訪說帖</h3>
          <div class="pitch-meta">
            <span id="pitch-method">電話聯繫</span>
            <span id="pitch-generated">生成於 2026-04-24</span>
          </div>
        </div>

        <!-- CLASSIFICATION 區塊 -->
        <div id="pitch-classification" class="pitch-block">
          <h4>分類</h4>
          <div id="classification-content" class="code-block"></div>
        </div>

        <!-- APPROACH 區塊 -->
        <div id="pitch-approach" class="pitch-block">
          <h4>切入角度</h4>
          <p id="approach-content"></p>
        </div>

        <!-- CONTENT 區塊（核心說帖，含 <cite> 標記） -->
        <div id="pitch-content" class="pitch-block">
          <h4>說帖本文</h4>
          <p id="content-text"></p>
          <!-- <cite> 標記會在此呈現，JS 監聽 hover/click -->
        </div>

        <!-- QUESTIONS 區塊 -->
        <div id="pitch-questions" class="pitch-block">
          <h4>延伸問題</h4>
          <ul id="questions-list"></ul>
        </div>

        <!-- SPEAKERS 區塊 -->
        <div id="pitch-speakers" class="pitch-block">
          <h4>相關講師</h4>
          <ul id="speakers-list"></ul>
        </div>

        <!-- NEXT_ACTIONS 區塊 -->
        <div id="pitch-next-actions" class="pitch-block">
          <h4>下一步行動</h4>
          <div id="next-actions-content"></div>
        </div>

        <!-- 操作按鈕 -->
        <div class="pitch-actions">
          <button id="copy-pitch-btn" class="btn-primary">📋 複製說帖</button>
          <button id="edit-pitch-btn" class="btn-secondary">✏️ 編輯</button>
          <button id="record-followup-btn" class="btn-primary">📝 記錄跟進</button>
        </div>

      </div>

      <!-- 跟進歷史 Timeline -->
      <section id="followup-history" class="fu-timeline">
        <h3>跟進紀錄</h3>
        <div id="timeline-container">
          <!-- 動態填入時間線項目 -->
        </div>
      </section>

    </section>

  </main>

  <!-- 記錄跟進 Modal -->
  <dialog id="recordfollowup-modal" class="fu-modal">
    <div class="modal-content">
      <h2>記錄跟進</h2>
      <form id="followup-form">
        <div class="form-group">
          <label for="followup-method">聯繫方式</label>
          <select id="followup-method" required>
            <option>電話</option>
            <option>Email</option>
            <option>LINE</option>
            <option>親訪</option>
          </select>
        </div>

        <div class="form-group">
          <label for="followup-content">跟進內容</label>
          <textarea id="followup-content" rows="4" placeholder="記錄您說了什麼..."></textarea>
        </div>

        <div class="form-group">
          <label>客戶反應</label>
          <div class="radio-group">
            <input type="radio" id="response-positive" name="response" value="positive">
            <label for="response-positive">😊 正面</label>
            <input type="radio" id="response-neutral" name="response" value="neutral">
            <label for="response-neutral">😐 中立</label>
            <input type="radio" id="response-negative" name="response" value="negative">
            <label for="response-negative">😞 負面</label>
          </div>
        </div>

        <div class="form-group">
          <label for="next-action">下一步</label>
          <textarea id="next-action" rows="2" placeholder="例：安排需求訪談、寄資料、後續再聯繫..."></textarea>
        </div>

        <div class="form-group">
          <label for="next-action-date">計劃日期</label>
          <input type="date" id="next-action-date">
        </div>

        <div class="modal-actions">
          <button type="submit" class="btn-primary">保存紀錄</button>
          <button type="button" class="btn-secondary" onclick="this.closest('dialog').close()">取消</button>
        </div>
      </form>
    </div>
  </dialog>

  <!-- 講師卡 Tooltip（動態生成） -->
  <!-- <div id="speaker-tooltip" class="speaker-tooltip" style="display:none;">
    <!-- 內容由 JS 動態插入 -->
  <!-- </div> -->

  <script src="app.js"></script>
  <script src="follow-up.js"></script>
</body>
</html>
```

#### `public/speaker-gallery.html` — 講師速查頁

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>講師速查</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="follow-up.css">
</head>
<body>
  <header id="app-header">
    <button id="back-btn">← 返回</button>
    <h1>📚 講師速查</h1>
    <div id="user-badge"></div>
  </header>

  <main id="app-container" class="speaker-gallery">
    
    <!-- 搜尋 & 篩選 -->
    <aside id="gallery-filter" class="sg-filter">
      <div class="filter-group">
        <label>搜尋</label>
        <input type="text" id="search-speakers" placeholder="講師名稱、關鍵詞...">
      </div>

      <div class="filter-group">
        <label>講師分類</label>
        <div class="filter-chips">
          <input type="checkbox" id="filter-digiwin" value="digiwin">
          <label for="filter-digiwin">🏢 鼎新講師</label>
          <input type="checkbox" id="filter-external" value="external">
          <label for="filter-external">👥 外部講師</label>
        </div>
      </div>

      <div class="filter-group">
        <label>適用產業</label>
        <div class="filter-chips">
          <input type="checkbox" id="filter-sg-mfg" value="manufacturing">
          <label for="filter-sg-mfg">製造</label>
          <input type="checkbox" id="filter-sg-retail" value="retail">
          <label for="filter-sg-retail">流通</label>
        </div>
      </div>

      <div class="filter-group">
        <label>適用訊號</label>
        <select id="filter-signals" multiple>
          <option value="Q1_ARRANGE">Q1_ARRANGE</option>
          <option value="Q4_INTEGRATED">Q4_INTEGRATED</option>
          <!-- ... 所有訊號代碼 -->
        </select>
      </div>

      <button id="gallery-reset" class="btn-secondary">重設篩選</button>
    </aside>

    <!-- 講師卡網格 -->
    <section id="gallery-main" class="sg-grid">
      <!-- 動態插入講師卡片 -->
    </section>

  </main>

  <!-- 講師詳情 Modal -->
  <dialog id="speaker-detail-modal" class="sg-modal">
    <div class="modal-content">
      <button class="close-btn" onclick="this.closest('dialog').close()">✕</button>
      
      <div class="speaker-detail">
        <h2 id="speaker-title"></h2>
        
        <div class="detail-section">
          <h3>知識卡代碼</h3>
          <code id="speaker-code" class="copy-text"></code>
        </div>

        <div class="detail-section">
          <h3>濃縮觀點</h3>
          <p id="speaker-short-quote"></p>
        </div>

        <div class="detail-section">
          <h3>完整觀點</h3>
          <p id="speaker-full-content"></p>
        </div>

        <div class="detail-section">
          <h3>業務可用短句</h3>
          <ul id="speaker-phrases"></ul>
        </div>

        <div class="detail-section">
          <h3>來源參考</h3>
          <div id="speaker-reference"></div>
        </div>

        <div class="detail-section">
          <h3>適用訊號</h3>
          <div id="speaker-signals"></div>
        </div>
      </div>
    </div>
  </dialog>

  <script src="app.js"></script>
  <script src="follow-up.js"></script>
</body>
</html>
```

### 3.2 CSS 文件

#### `public/follow-up.css` — 回訪相關樣式

```css
/* ============================================================
   P7 Follow-up System — 回訪話術生成系統樣式
   ============================================================ */

:root {
  --color-p1: #dc2626;    /* 立即推進 - 紅 */
  --color-p2: #ea580c;    /* 積極培育 - 橙 */
  --color-p3: #eab308;    /* 案例升溫 - 黃 */
  --color-p4: #8b5cf6;    /* 長期培育 - 紫 */
}

/* ============================================================
   follow-up.html — 客戶清單主頁
   ============================================================ */

#app-container {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: 1.5rem;
  padding: 1.5rem;
}

.fu-filter {
  background: #f9fafb;
  border-radius: 8px;
  padding: 1.5rem;
  height: fit-content;
  position: sticky;
  top: 1.5rem;
}

.fu-filter h3 {
  margin-bottom: 1rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.filter-group {
  margin-bottom: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: #374151;
}

.filter-group select,
.filter-group input[type="text"] {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.9rem;
}

.filter-chips {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-chips input[type="checkbox"] {
  margin-right: 0.5rem;
}

.filter-chips label {
  display: flex;
  align-items: center;
  font-weight: 400;
  font-size: 0.9rem;
  cursor: pointer;
}

/* 客戶清單區塊 */

.fu-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

#list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

#list-header h2 {
  font-size: 1.3rem;
  font-weight: 600;
}

#view-toggle {
  display: flex;
  gap: 0.5rem;
}

.view-btn {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.view-btn.active {
  background: #0066cc;
  color: white;
  border-color: #0066cc;
}

/* 客戶卡片網格 */

.fu-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.fu-customer-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.2s;
}

.fu-customer-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: #0066cc;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 1rem;
}

.card-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1f2937;
}

.card-company {
  font-size: 0.85rem;
  color: #6b7280;
  margin-top: 0.2rem;
}

.tier-badge {
  display: inline-block;
  padding: 0.3rem 0.8rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
  color: white;
}

.tier-badge.p1 { background: var(--color-p1); }
.tier-badge.p2 { background: var(--color-p2); }
.tier-badge.p3 { background: var(--color-p3); }
.tier-badge.p4 { background: var(--color-p4); }

.card-meta {
  display: flex;
  gap: 1rem;
  margin: 1rem 0;
  font-size: 0.85rem;
  color: #6b7280;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.card-signals {
  margin: 1rem 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.signal-tag {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  background: #f3f4f6;
  border-radius: 4px;
  font-size: 0.75rem;
  color: #374151;
}

.card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.card-actions button {
  flex: 1;
  padding: 0.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.card-actions .btn-primary {
  background: #0066cc;
  color: white;
}

.card-actions .btn-primary:hover {
  background: #0052a3;
}

/* ============================================================
   follow-up-customer.html — 客戶詳情頁
   ============================================================ */

.fu-customer-detail {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 1.5rem;
  padding: 1.5rem;
}

.fu-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: fit-content;
  position: sticky;
  top: 1.5rem;
}

.fu-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
}

.fu-card h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 1rem;
  border-bottom: 1px solid #f3f4f6;
  padding-bottom: 0.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  font-size: 0.9rem;
}

.info-row .label {
  font-weight: 500;
  color: #6b7280;
}

.classification-box {
  text-align: center;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
}

.tier-display {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

#signals-display {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* 說帖容器 */

.fu-main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.fu-tabs {
  display: flex;
  gap: 0.5rem;
  border-bottom: 2px solid #e5e7eb;
}

.tab-btn {
  padding: 1rem 1.5rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
  color: #6b7280;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
}

.tab-btn.active {
  color: #0066cc;
  border-bottom-color: #0066cc;
}

.tab-btn:hover {
  color: #0066cc;
}

/* 說帖主體 */

.fu-pitch {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 2rem;
  line-height: 1.8;
}

.pitch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  border-bottom: 2px solid #f3f4f6;
  padding-bottom: 1rem;
}

.pitch-header h3 {
  font-size: 1.3rem;
  font-weight: 600;
}

.pitch-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  color: #6b7280;
}

.pitch-block {
  margin-bottom: 2rem;
}

.pitch-block h4 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.8rem;
  color: #1f2937;
}

.pitch-block p {
  margin-bottom: 1rem;
  color: #374151;
}

.pitch-block ul {
  list-style: disc;
  padding-left: 1.5rem;
}

.pitch-block li {
  margin-bottom: 0.5rem;
  color: #374151;
}

.code-block {
  background: #f9fafb;
  border-left: 4px solid #0066cc;
  padding: 1rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
  color: #1f2937;
}

/* <cite> 標記樣式 */

cite {
  cursor: help;
  border-bottom: 2px dotted #0066cc;
  padding: 0 2px;
  position: relative;
}

cite:hover {
  background: #eff6ff;
}

/* 講師 Tooltip */

.speaker-tooltip {
  position: absolute;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-width: 300px;
  font-size: 0.9rem;
  line-height: 1.6;
}

.speaker-tooltip h4 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.speaker-tooltip .quote {
  font-style: italic;
  color: #0066cc;
  margin-bottom: 0.5rem;
}

.speaker-tooltip .content {
  color: #374151;
  margin-bottom: 1rem;
}

.speaker-tooltip .reference {
  font-size: 0.8rem;
  color: #6b7280;
  border-top: 1px solid #f3f4f6;
  padding-top: 0.5rem;
}

/* 說帖操作按鈕 */

.pitch-actions {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
  border-top: 1px solid #f3f4f6;
  padding-top: 1.5rem;
}

.pitch-actions button {
  padding: 0.8rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s;
}

.pitch-actions .btn-primary {
  background: #0066cc;
  color: white;
}

.pitch-actions .btn-primary:hover {
  background: #0052a3;
}

.pitch-actions .btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.pitch-actions .btn-secondary:hover {
  background: #e5e7eb;
}

/* 跟進歷史 Timeline */

.fu-timeline {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  margin-top: 1.5rem;
}

.fu-timeline h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}

#timeline-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.timeline-item {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: #f9fafb;
  border-left: 3px solid #0066cc;
  border-radius: 4px;
}

.timeline-date {
  font-size: 0.8rem;
  color: #6b7280;
  font-weight: 600;
  min-width: 80px;
}

.timeline-content {
  flex: 1;
  font-size: 0.9rem;
  color: #374151;
}

.timeline-method {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  background: #dbeafe;
  color: #0066cc;
  border-radius: 4px;
  font-size: 0.8rem;
  margin-bottom: 0.3rem;
}

.timeline-response {
  margin-top: 0.5rem;
}

.timeline-response.positive { color: #059669; }
.timeline-response.neutral { color: #d97706; }
.timeline-response.negative { color: #dc2626; }

/* ============================================================
   speaker-gallery.html — 講師速查頁
   ============================================================ */

.speaker-gallery {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: 1.5rem;
  padding: 1.5rem;
}

.sg-filter {
  background: #f9fafb;
  border-radius: 8px;
  padding: 1.5rem;
  height: fit-content;
  position: sticky;
  top: 1.5rem;
}

.sg-filter h3 {
  margin-bottom: 1rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.sg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
}

.speaker-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.speaker-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: #0066cc;
}

.speaker-avatar {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, #0066cc, #0052a3);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  color: white;
  margin: 0 auto 1rem;
}

.speaker-name {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.2rem;
}

.speaker-title {
  font-size: 0.85rem;
  color: #6b7280;
  margin-bottom: 0.8rem;
}

.speaker-quote {
  font-size: 0.85rem;
  color: #374151;
  font-style: italic;
  margin-bottom: 1rem;
  line-height: 1.5;
}

.speaker-badge {
  display: inline-block;
  padding: 0.3rem 0.8rem;
  background: #0066cc;
  color: white;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
}

.speaker-badge.external {
  background: #6b7280;
}

/* 講師詳情 Modal */

.sg-modal {
  border: none;
  border-radius: 8px;
  padding: 0;
  width: 90%;
  max-width: 600px;
}

.sg-modal::backdrop {
  background: rgba(0, 0, 0, 0.5);
}

.sg-modal .modal-content {
  padding: 2rem;
  position: relative;
}

.close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6b7280;
}

.speaker-detail h2 {
  font-size: 1.3rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
  color: #1f2937;
}

.detail-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #f3f4f6;
}

.detail-section h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: #374151;
}

.detail-section code {
  background: #f3f4f6;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  cursor: copy;
}

.detail-section code:hover {
  background: #e5e7eb;
}

.detail-section ul {
  list-style: disc;
  padding-left: 1.5rem;
}

.detail-section li {
  margin-bottom: 0.5rem;
  color: #374151;
}

/* 響應式 */

@media (max-width: 768px) {
  #app-container,
  .fu-customer-detail,
  .speaker-gallery {
    grid-template-columns: 1fr;
  }

  .fu-filter,
  .sg-filter,
  .fu-sidebar {
    position: static;
  }

  .fu-cards,
  .sg-grid {
    grid-template-columns: 1fr;
  }

  .fu-tabs {
    flex-wrap: wrap;
  }

  .pitch-actions {
    flex-direction: column;
  }
}
```

### 3.3 JavaScript 文件

#### `public/follow-up.js` — 邏輯層（稍後詳細）

關鍵功能：
- 客戶清單載入與篩選
- 說帖 Tab 切換與展示
- `<cite>` 標記的 hover/click 監聽
- 跟進紀錄 Modal 操作
- 講師卡動態載入與渲染

---

## <a id="page-details"></a>4. 詳細頁面設計

### 4.1 follow-up.html — 客戶清單

**左側篩選面板**：
- 活動 (dropdown)
- 產業 (checkbox: 製造/流通)
- 分類層級 (checkbox: P1/P2/P3/P4)
- 搜尋 (text input)
- 重設按鈕

**主區域**：
- 標題 + 客戶數量
- 檢視切換 (卡片/表格)
- 客戶卡片網格

**每張客戶卡片包含**：
```
┌─────────────────────────────┐
│ [P1 badge]                  │
│ 張三                         │
│ ABC 製造股份有限公司          │
├─────────────────────────────┤
│ 📍 製造 | 📞 attended | ✅ yes│
├─────────────────────────────┤
│ [Q1_ARRANGE] [Q5_SUPPLY_CHAIN]
├─────────────────────────────┤
│ [檢視詳情] [記錄跟進]        │
└─────────────────────────────┘
```

### 4.2 follow-up-customer.html — 客戶詳情

**左側邊欄**（sticky）：
- 客戶基本資訊（公司、職位、產業、聯繫方式）
- 參會狀態（出席、問卷）
- 分類結果（P1 + 訊號標籤）

**右側主區域**：
- Tabs（4 個聯繫方式）
- 說帖內容（6 個區塊）
- 講師卡 Tooltip（hover/click）
- 操作按鈕（複製、編輯、記錄跟進）
- 跟進歷史 Timeline

### 4.3 speaker-gallery.html — 講師速查

**左側篩選**：
- 搜尋
- 講師分類 (checkbox: 鼎新/外部)
- 產業篩選 (checkbox: 製造/流通)
- 訊號篩選 (multi-select)
- 重設

**主區域**：
- 講師卡網格（每張卡片顯示：頭像、名字、頭銜、濃縮觀點、鼎新/外部 badge）
- 點擊展開 Modal

**Modal 內容**：
- 知識卡代碼（可複製）
- 濃縮觀點
- 完整觀點
- 業務可用短句
- 來源參考（PPT 頁碼、時間戳）
- 適用訊號

---

## <a id="interaction-flows"></a>5. 交互流程圖

### 流程 1：業務查詢客戶與說帖

```
業務登入 → Dashboard（現有 index.html）
    ↓
點「🎯 客戶回訪」 → follow-up.html
    ↓
[篩選客戶：製造、P1-P2]
    ↓
看到 5 個客戶卡片，點擊「檢視詳情」
    ↓
進入 follow-up-customer.html
    ↓
左側看到客戶基本資訊 + 分類結果 (P1, Q1_ARRANGE + Q5_SUPPLY_CHAIN)
    ↓
點擊「☎️ 電話」 Tab
    ↓
說帖內容展示（包含 <cite code="K-HYZ-05">同步看身份、權限、追溯</cite>）
    ↓
滑鼠 hover 在 <cite> 標記
    ↓
Tooltip 彈出：
    ├─ 黃盈彰總經理
    ├─ 短摘要（已在 <cite> 中）
    ├─ 完整觀點（100-150 字）
    ├─ 業務可用短句
    └─ 來源參考
    ↓
業務複製說帖 → 送給客戶 ✅
```

### 流程 2：業務主動查詢講師

```
業務登入 follow-up.html
    ↓
點「📚 講師速查」 → speaker-gallery.html
    ↓
看到所有 7 位講師卡片網格
    ↓
搜尋「黃盈彰」或篩選「製造 + 供應鏈」
    ↓
展示相關講師卡片
    ↓
點擊黃盈彰卡片
    ↓
Modal 展開：完整觀點、短句、知識卡代碼（可複製）
    ↓
業務複製知識卡代碼 K-HYZ-05 → 用於編輯說帖時直接引用 ✅
```

### 流程 3：業務記錄跟進

```
follow-up-customer.html
    ↓
點「📝 記錄跟進」
    ↓
Modal 彈出：
    ├─ 聯繫方式 (radio: 電話/Email/LINE/親訪)
    ├─ 跟進內容 (textarea)
    ├─ 客戶反應 (radio: 正面/中立/負面)
    ├─ 下一步 (textarea)
    └─ 計劃日期 (date picker)
    ↓
點「保存紀錄」
    ↓
POST /api/follow-up-records
    ↓
紀錄保存 → Timeline 自動刷新，顯示新紀錄 ✅
```

---

## <a id="api-contracts"></a>6. 資料繫結與 API 合約

### 6.1 前端需要調用的 API

#### 客戶管理

```javascript
// 1. 取得「我的客戶」清單
GET /api/salesperson/customers?event_id=xxx&industry=xxx&tier=xxx
// 回傳：
// {
//   customers: [
//     {
//       id: "cust_001",
//       customer_name: "張三",
//       customer_company: "ABC 製造",
//       industry: "manufacturing",
//       attendance_status: "attended",
//       survey_filled: true,
//       current_tier: "P1",
//       signals: ["Q1_ARRANGE", "Q5_SUPPLY_CHAIN"],
//       assigned_user_code: "16890"
//     },
//     ...
//   ]
// }

// 2. 取得客戶詳情
GET /api/customers/[id]
// 回傳：
// {
//   customer: { ...同上 },
//   survey_responses: {
//     signals: ["Q1_ARRANGE", "Q5_SUPPLY_CHAIN"],
//     primary_anchor: "Q1_ARRANGE",
//     secondary_signals: ["Q5_SUPPLY_CHAIN"]
//   },
//   follow_up_history: [
//     {
//       id: "followup_001",
//       created_at: 1713931200,
//       contact_method: "phone",
//       follow_up_content: "討論供應鏈導入方案",
//       customer_response: "interested",
//       response_sentiment: "positive",
//       next_action: "安排需求訪談"
//     }
//   ]
// }
```

#### 說帖查詢

```javascript
// 3. 取得預生成說帖
GET /api/follow-up/pitches/[id]
// 回傳：
// {
//   id: "pitch_001",
//   tier: "P1",
//   industry: "manufacturing",
//   contact_method: "phone",
//   classification_text: "tier: P1\nlabel: 立即推進\n...",
//   approach_text: "您已經在想怎麼往下走了...",
//   content_text: "針對供應鏈 Agent...<cite code='K-HYZ-05'>同步看身份、權限、追溯</cite>...",
//   questions_text: "- 問題 1\n- 問題 2\n...",
//   speakers_text: "- 黃盈彰總經理|...|K-HYZ-05\n...",
//   next_actions_text: "action: 3 個工作天內安排...",
//   raw_markdown: "完整 Markdown..."
// }
```

#### 講師卡

```javascript
// 4. 查詢講師卡清單（用於 speaker-gallery）
GET /api/speaker-knowledge-cards?industry=manufacturing&signals=Q5_SUPPLY_CHAIN
// 回傳：
// {
//   cards: [
//     {
//       code: "K-HYZ-05",
//       speaker_name: "黃盈彰",
//       speaker_title: "黃盈彰總經理",
//       speaker_code: "HYZ",
//       is_digiwin: true,
//       short_quote: "同步看身份、權限、追溯",
//       industry_scope: "both"
//     },
//     ...
//   ]
// }

// 5. 取得單一講師卡完整內容
GET /api/speaker-knowledge-cards/[code]
// 例：GET /api/speaker-knowledge-cards/K-HYZ-05
// 回傳：
// {
//   code: "K-HYZ-05",
//   speaker_name: "黃盈彰",
//   speaker_title: "黃盈彰總經理",
//   speaker_code: "HYZ",
//   is_digiwin: true,
//   short_quote: "同步看身份、權限、追溯",
//   full_content: "企業 AI 導入時，身份認證、權限管理、流程追溯是三個核心治理...",
//   business_phrases: [
//     "不是誰都可以叫 AI 做事",
//     "權限邊界要清楚",
//     "每個決定都能追溯誰下的"
//   ],
//   slide_ref: "PPT Slide 12-17",
//   source_timestamp: "00:20:48",
//   applicable_signals: ["Q4_INTEGRATED", "Q5_FINANCE", "Q7_DATA"],
//   industry_scope: "both"
// }
```

#### 跟進紀錄

```javascript
// 6. 記錄跟進（POST）
POST /api/follow-up-records
// 輸入：
// {
//   customer_id: "cust_001",
//   contact_method: "phone",
//   follow_up_content: "討論供應鏈 Agent 導入節奏，客戶對多系統串接有疑慮",
//   customer_response: "interested",
//   response_sentiment: "positive",
//   next_action: "3 個工作天內安排需求訪談",
//   next_action_date: 1714017600
// }
// 回傳：{ id: "followup_001", created_at: 1713931200 }
```

### 6.2 講師卡資料來源（MD vs DB 決策）

**方案 A：直接從 MD 讀取（推薦現在做）**

```javascript
// follow-up.js
async function loadSpeakerCard(code) {
  // 例：code = "K-HYZ-05"
  const [speaker, cardNum] = code.split('-');
  const speakerMap = {
    'HYZ': '黃盈彰',
    'LYH': '李義訓',
    'HYK': '黃昱凱',
    // ...
  };
  
  const mdPath = `docs/回訪skill_v2/speakers/${speakerMap[speaker]}.md`;
  const content = await fetch(mdPath).then(r => r.text());
  
  // 用 regex 抽出對應的 K-HYZ-05 段落
  const cardContent = parseMarkdownCard(content, code);
  
  return {
    code,
    speaker_title: cardContent.title,
    short_quote: cardContent.shortQuote,
    full_content: cardContent.fullContent,
    business_phrases: cardContent.phrases,
    slide_ref: cardContent.slideRef,
    source_timestamp: cardContent.timestamp,
    applicable_signals: cardContent.signals,
    industry_scope: cardContent.industryScope
  };
}
```

**方案 B：從 API 查詢（未來優化）**

```javascript
async function loadSpeakerCard(code) {
  const res = await fetch(`/api/speaker-knowledge-cards/${code}`);
  return await res.json();
}
```

---

## 🎯 實現優先級

### 第 1 步（這週）— **HTML 結構**

```
✅ follow-up.html（客戶清單頁）
✅ follow-up-customer.html（客戶詳情頁）
✅ speaker-gallery.html（講師速查頁）
✅ follow-up.css（全部樣式）
```

### 第 2 步（下週）— **JavaScript 邏輯**

```
✅ 客戶清單載入 & 篩選
✅ 說帖 Tab 切換 & 展示
✅ <cite> 標記監聽與 Tooltip 渲染
✅ 跟進紀錄 Modal 送出
✅ 講師速查搜尋與展開
```

### 第 3 步（後續）— **API 實現**

```
✅ /api/salesperson/customers
✅ /api/customers/[id]
✅ /api/follow-up/pitches/[id]
✅ /api/speaker-knowledge-cards
✅ /api/follow-up-records
```

---

## 📝 檢查清單（編碼前）

```
□ follow-up.html 已完成（HTML 結構）
□ follow-up-customer.html 已完成
□ speaker-gallery.html 已完成
□ follow-up.css 已完成（全部樣式）
□ follow-up.js 框架建立（待填邏輯）
□ 與 app.js 的整合點確認（user badge、登入狀態）
□ 聯絡方式命名統一（phone/email/line/visit）
□ 訊號代碼清單確認（Q1_ARRANGE 等）
□ Tier 顏色常數定義（P1=紅、P2=橙、P3=黃、P4=紫）
```

---

**文件版本**：v1.0  
**優先級**：P0（blocking）  
**預計工作量**：20-30 小時（前端）  
**後續依賴**：API 端點 + 後端資料層實現
