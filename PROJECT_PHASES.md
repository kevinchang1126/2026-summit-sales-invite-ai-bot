# 2026 鼎新企業高峰年會邀約助手 — 項目進度（P1-P6）

## 📋 目錄
- [Phase 1：基礎架構 + Pitch 說帖系統](#phase-1)
- [Phase 2：系列活動管理 + 資源中心 Schema](#phase-2)
- [Phase 3：內容知識庫最佳化](#phase-3)
- [Phase 4：資源中心獨立頁面](#phase-4)
- [Phase 5：後續經營回訪話術生成](#phase-5)
- [Phase 6：額外功能 & 優化](#phase-6)
- [新功能：業務客戶跟進系統](#new-feature)

---

## <a id="phase-1"></a>✅ Phase 1：基礎架構 + Pitch 說帖系統

**目標**：建立 Cloudflare Pages 無伺服器架構，實現 AI 驅動的說帖生成與投票機制

### 已完成 ✅
| 功能 | 實現方式 | 狀態 |
|---|---|---|
| **Cloudflare Pages 部署** | 前端 (`public/`) + Functions (`functions/`) | ✅ 已部署 |
| **D1 Serverless Database** | SQLite 邊緣資料庫，users/pitches/votes/rate_limits 等表 | ✅ 已建立 |
| **Teams SSO 驗證** | `/api/auth` 端點接收 Teams token 交換 | ✅ 已實現 |
| **說帖生成 API** | `POST /api/generate`，呼叫 Gemini API | ✅ 已實現 |
| **說帖精修 API** | `POST /api/refine`，基於反饋優化文案 | ✅ 已實現 |
| **投票系統** | `POST /api/vote`，防重複投票 (UNIQUE constraint) | ✅ 已實現 |
| **優秀說帖排行榜** | `GET /api/pitches?sort=likes`，按讚數排序 | ✅ 已實現 |
| **主頁 (index.html)** | 說帖生成表單 + 排行榜展示 | ✅ 已實現 |
| **限流保護** | rate_limits 表，防 API 濫用 | ✅ 已實現 |
| **用戶管理** | `/api/me` / `/api/user/nickname`，支援自訂暱稱 | ✅ 已實現 |

### 待完善 ⚠️
- 無（P1 功能完整）

---

## <a id="phase-2"></a>✅ Phase 2：系列活動管理 + 資源中心 Schema

**目標**：支援多場次系列活動、XLSX 批量匯入、資源庫管理架構

### 已完成 ✅
| 功能 | 實現方式 | 狀態 |
|---|---|---|
| **event_series 表** | 管理系列活動（如 2026040001 台北/台中場） | ✅ 已建立 |
| **events 表擴充** | 新增 `series_id`, `series_order`, `session_code` 欄位 | ✅ 已擴充 |
| **event_admins 表** | 區別 superadmin / eventadmin 可管轄的活動範圍 | ✅ 已建立 |
| **resources 表** | 資源文檔（article/slide/video，link/R2 存儲） | ✅ 已建立 |
| **tags & tag_relations** | 標籤系統（industry/role/channel 等分類） | ✅ 已建立 |
| **XLSX 批量匯入** | 解析 Excel，驗證欄位，批量建立活動 | ✅ 已實現 |
| **活動 ID 格式卡控** | YYYYMM+4碼（如 2026040001），純人工必填 | ✅ 已實現 |
| **Batch 端點** | `POST /api/events/batch`，支援 429 重試 | ✅ 已實現 |
| **資源上傳 API** | `POST /api/resources`，支援 R2 存儲 | ✅ 已實現 |
| **標籤管理 API** | `GET/POST/PUT /api/admin/tags`（superadmin only） | ✅ 已實現 |
| **活動管理後台** | `/admin.html`，可建立/編輯活動與資源 | ✅ 已實現 |

### 待完善 ⚠️
- 無（P2 功能完整）

---

## <a id="phase-3"></a>✅ Phase 3：內容知識庫最佳化

**目標**：完善行業洞見、角色話術、溝通管道知識庫

### 已完成 ✅
| 功能 | 實現方式 | 狀態 |
|---|---|---|
| **知識庫 API** | `/api/knowledge/{category}`（industry/role/channel 等） | ✅ 已實現 |
| **行業痛點內容** | `docs/industry-pain-points.md`，塑膠/製造/生醫等 | ✅ 已整理 |
| **核心論述架構** | `docs/event-info.md`，含年會定調與核心主訴 | ✅ 已整理 |
| **說話人資訊** | `docs/speakers.md`，講者背景與課題 | ✅ 已整理 |
| **Prompt 最佳化** | `docs/prompt.md`，說帖生成提示詞 | ✅ 已整理 |
| **內容一致性** | 確保 Gemini 生成文案符合年會論述 | ✅ 已優化 |

### 待完善 ⚠️
- 無（P3 功能完整）

---

## <a id="phase-4"></a>✅ Phase 4：資源中心獨立頁面

**目標**：為與會者提供參會前後的資源查閱平台；支援開發環境快速驗證

### 已完成 ✅
| 功能 | 實現方式 | 狀態 |
|---|---|---|
| **資源中心頁面** | `/public/resources.html`，獨立展示區 | ✅ 已建立 |
| **動態篩選** | 事件篩選 / 資源類型 / 關鍵字 / 標籤（AND/OR） | ✅ 已實現 |
| **事件計數切換** | 預設 5 場，支援 10/20/all 切換 | ✅ 已實現 |
| **最近場次排序** | 按 `|event_date - today|` 升序，最接近的優先 | ✅ 已實現 |
| **資源卡片展示** | 標題、描述、類型著色（article/slide/video） | ✅ 已實現 |
| **行動裝置支援** | 響應式設計，骨架屏載入動畫 | ✅ 已實現 |
| **URL 狀態同步** | Query string 保存篩選狀態，前進後退可恢復 | ✅ 已實現 |
| **dev-auth 端點** | `/api/auth-dev`，本地開發用 SSO 繞過 | ✅ 已實現 |
| **dev-auth 防護** | Hostname guard + env.DEV_AUTH_ENABLED，正式環境自動 403 | ✅ 已實現 |
| **Dev 環境快速驗證** | 種子資料 `seed-dev.sql`（6 tags, 3 events, 5 resources） | ✅ 已準備 |
| **多語言提示** | 頁面文案統一繁體中文 | ✅ 已實現 |

### 待完善 ⚠️
- 無（P4 功能完整）

### 部署前檢查清單
```
□ 正式 D1 schema 與本地同步 ✅ 已確認
□ 正式 R2 bucket (summit-resources) 存在 ✅ 已確認
□ .gitignore 排除 .wrangler/ 和 .dev.vars ✅ 已確認
□ GEMINI_API_KEY 在 Pages Dashboard 已設定 ⚠️ 需驗證
□ auth-dev.js guard 防止正式環境執行 ✅ 已驗證
□ 移除垃圾檔案 (testhar/, xlsx_debug.txt) ⚠️ 待清理
□ 本地測試通過：資源中心獨立頁正常運作 ✅ 已驗證
```

---

## <a id="phase-5"></a>⏳ Phase 5：後續經營回訪話術生成

**目標**：協助業務針對不同參會狀態客戶生成個性化的後續跟進話術

### 整體定位
- **使用者**：銷售團隊業務人員
- **輸入**：參會狀態（已填問卷/已參會未填/未參會） + 客戶屬性（產業/職位）
- **輸出**：結構化的回訪話術（開場 → 痛點 → 場景 → CTA）
- **關鍵**：依參會狀態動態調整切入點

### 設計決策清單（待確認）
| 決策點 | 選項 | 影響 | 狀態 |
|---|---|---|---|
| **觸發時機** | 1. 手動按鈕點擊 2. 後台批量生成 3. 定時排程 | 工作流程設計 | ⏳ 待決定 |
| **訊息結構** | 1. 簡潔版（2-3 段） 2. 完整版（開場→洞見→案例→CTA） | 銷售話術複雜度 | ⏳ 待決定 |
| **個人化深度** | 1. 客戶屬性+參會狀態 2. 加入客戶互動歷史 3. 含席次+講者偏好 | 資料需求與 API 複雜度 | ⏳ 待決定 |
| **輸出管道** | 1. 平台內複製 2. 一鍵複製到剪貼簿 3. Email/Teams 分享 | 銷售工作流集成 | ⏳ 待決定 |
| **資源中心整合** | 是否在話術中附帶相關資源連結 | UX 與資源相關性 | ⏳ 待決定 |

### 建議做法
1. **Phase 5a（必做）**：參會狀態分類 + 話術模板設計
   - [ ] 在 D1 建立 `customer_interactions` 或 `follow_up_templates` 表
   - [ ] 根據參會狀態設計 3 版 Gemini prompt
   - [ ] 前端新增「生成回訪話術」按鈕 → `/api/follow-up-generate`

2. **Phase 5b（可選）**：整合資源中心與參會紀錄
   - [ ] 關聯客戶參會席次與內容消費紀錄
   - [ ] 話術中動態推薦相關資源

### 待啟動任務
- 確認上述 5 個決策點
- 設計資料模型（customer_interactions / event_attendance / follow_up_history）
- 編寫回訪話術 Prompt 範本
- 實現前端表單與 API 端點

---

## <a id="phase-6"></a>⏳ Phase 6：額外功能 & 優化

**目標**：提升整體產品體驗與運營效率

### 計劃中 ⏳

#### 6.1 高級分析與報表
- [ ] 說帖生成統計：按業務/產業/管道統計使用頻率
- [ ] 參會轉化漏斗：報名 → 簽到 → 問卷填寫 → 後續跟進
- [ ] 回訪成效追蹤：記錄後續跟進是否轉化為商機

#### 6.2 批量操作與自動化
- [ ] 批量生成回訪話術（針對同一族群客戶）
- [ ] 排程自動提醒（如：會後 3 天自動提醒業務跟進）
- [ ] 話術範本庫管理（superadmin 可建立標準模板）

#### 6.3 協作工具
- [ ] 話術分享與評論（團隊內評估效果）
- [ ] 最佳實踐沉澱（自動匯總高轉化率話術）
- [ ] Teams/Slack 整合（直接推送回訪提醒）

#### 6.4 行動裝置最佳化
- [ ] 資源中心移動版本優化
- [ ] 生成話術快速分享卡片（OG Meta Tags）
- [ ] 離線緩存支援

#### 6.5 AI 能力升級
- [ ] 從 Gemini Flash 升級至 Gemini 2.0（更強上下文理解）
- [ ] 多輪對話精修（業務可與 AI 來回迭代話術）
- [ ] A/B 測試助手（自動生成同一客戶的多版本話術供對比）

---

## <a id="new-feature"></a>🚀 新功能：業務客戶跟進系統（P7）

**目標**：建立客戶生命週期管理，讓業務能在平台上直接管理與跟進客戶

### 核心場景
```
銷售業務流程：
1. 參會者簽到/問卷填寫 → 建立 customer_record
2. 按參會狀態分類（已填/未填/未參與）
3. 一鍵生成個性化回訪話術
4. 記錄跟進歷史（何時跟進、說了什麼、反應如何）
5. 追蹤轉化結果（是否有後續商機）
```

### 新增資料表（Schema 擴充）
```sql
-- 客戶參會紀錄
CREATE TABLE IF NOT EXISTS customer_records (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_company TEXT,
  customer_industry TEXT,     -- tag_id ref
  customer_role TEXT,          -- tag_id ref
  contact_channel TEXT,        -- email / phone / wechat
  attendance_status TEXT CHECK(attendance_status IN ('registered', 'attended_filled_form', 'attended_no_form', 'no_show')),
  attended_sessions TEXT,      -- JSON array of session_ids
  form_data JSONB,             -- 參會問卷數據
  last_contact_date INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- 跟進歷史
CREATE TABLE IF NOT EXISTS follow_up_records (
  id TEXT PRIMARY KEY,
  customer_record_id TEXT NOT NULL,
  follow_up_date INTEGER,
  follow_up_method TEXT CHECK(follow_up_method IN ('phone', 'email', 'wechat', 'in_person')),
  pitch_content TEXT,          -- 使用的話術
  notes TEXT,                  -- 業務備註
  response_status TEXT CHECK(response_status IN ('interested', 'not_interested', 'pending', 'no_response')),
  opportunity_created BOOLEAN DEFAULT 0,
  created_by TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (customer_record_id) REFERENCES customer_records(id)
);
```

### 新增 API 端點
```
GET    /api/customers?event_id=...&status=...&industry=...     列表查詢
POST   /api/customers                                           建立客戶記錄
PATCH  /api/customers/[id]                                      更新客戶狀態
POST   /api/follow-up-records                                   記錄跟進歷史
GET    /api/customers/[id]/follow-up-history                    查看跟進歷史
POST   /api/customers/[id]/generate-pitch                       生成個性化回訪話術
```

### 新增前端頁面
```
/customers.html
├─ 客戶列表 (table view，可按參會狀態/產業篩選)
├─ 客戶詳情卡片
│  ├─ 參會紀錄（已填問卷 Y/N）
│  ├─ 跟進歷史 Timeline
│  ├─ 生成回訪話術 (Button)
│  └─ 記錄跟進 (Modal form)
└─ 統計看板 (Dashboard)
   ├─ 參會轉化漏斗圖
   ├─ 跟進成效柱狀圖
   └─ 商機率表
```

### 導入流程
1. **資料來源**：參會簽到系統或問卷系統導出 CSV/XLSX
2. **批量導入**：`POST /api/customers/batch-import` 解析並插入
3. **自動分類**：根據簽到簽 + 問卷填寫狀態自動標記 attendance_status

### 使用者角色權限
- **Superadmin**：檢視所有活動客戶，全局統計
- **Event Admin**：檢視己管轄活動的客戶與跟進
- **Salesperson**（新角色）：檢視己跟進客戶，記錄跟進歷史

---

## 🔍 當前代碼結構總覽

### API 端點清單（30+ 個）
```
Authentication:
├─ POST   /api/auth                (Teams SSO)
├─ POST   /api/auth-dev            (本地開發用)
├─ GET    /api/me                  (取得當前用戶)

Events Management:
├─ GET    /api/events              (列表)
├─ POST   /api/events              (建立)
├─ GET    /api/events/[id]         (詳情)
├─ PATCH  /api/events/[id]         (編輯)
├─ POST   /api/events/batch        (批量建立)
├─ POST   /api/events/ingest       (Webhook 導入)
├─ GET    /api/events/series/[id]  (系列活動詳情)
├─ POST   /api/events/series       (建立系列)

Resources:
├─ GET    /api/resources           (列表)
├─ POST   /api/resources           (上傳)
├─ GET    /api/resources/[id]      (下載/詳情)
├─ DELETE /api/resources/[id]      (刪除)

Pitch & Content:
├─ GET    /api/pitches             (排行榜)
├─ POST   /api/generate            (說帖生成)
├─ POST   /api/refine              (精修)
├─ POST   /api/vote                (投票)

Knowledge Base:
├─ GET    /api/knowledge/industry
├─ GET    /api/knowledge/role
├─ GET    /api/knowledge/channel
├─ GET    /api/knowledge/customer-type
├─ GET    /api/knowledge/style
├─ GET    /api/knowledge/base

Admin:
├─ GET    /api/admin/tags          (標籤列表)
├─ POST   /api/admin/tags          (新增標籤)
├─ PATCH  /api/admin/tags/[id]     (編輯標籤)
├─ DELETE /api/admin/tags/[id]     (刪除標籤)
├─ GET    /api/admin/roles         (角色列表)
├─ POST   /api/admin/roles/[user]  (授予角色)

User:
├─ PATCH  /api/user/nickname       (更新暱稱)
├─ GET    /api/tags                (所有標籤)
```

### 前端頁面（6 個）
```
public/
├─ index.html              (主頁 - Pitch 生成 + 排行榜)
├─ admin.html              (管理後台 - 活動/資源/標籤管理)
├─ resources.html          (資源中心 - P4 新增)
├─ style.css               (全局樣式)
├─ app.js                  (主頁邏輯)
├─ admin.js                (後台邏輯)
├─ resources.js            (資源中心邏輯)
├─ admin.css               (後台樣式)
└─ resources.css           (資源中心樣式)
```

### 資料庫表（12 個）
```
users                      (用戶)
user_roles                 (角色授權)
pitches                    (說帖)
votes                      (投票)
rate_limits                (限流)
events                     (活動)
event_series               (系列活動)
event_admins               (活動管理員)
resources                  (資源)
tags                       (標籤字典)
tag_relations              (標籤關聯)
```

---

## 📅 後續行動方案

### 立即（部署 P4）
```bash
# 清理垃圾檔案
rm -rf testhar/
rm "C\357\200\272UsersertaiDownloadsxlsx_debug.txt"

# 確認環境變數
# Dashboard 驗證：GEMINI_API_KEY 已設定

# 提交並部署
git add functions/api/auth-dev.js functions/api/resources/ functions/api/admin/tags/ \
        functions/api/tags/ public/resources.* package.json schema.sql
git commit -m "feat(P4): 資源中心獨立頁 + dev 驗證端點 + 標籤管理"
npm run deploy

# 部署後煙霧測試（見上文 P4 部分）
```

### 短期（啟動 P5）
```
1. 確認 5 個設計決策（觸發時機/訊息結構/個人化/輸出管道/資源整合）
2. 設計回訪話術 Prompt 與資料模型
3. 實現 /api/follow-up-generate 與前端表單
4. 測試：針對不同參會狀態生成話術
```

### 中期（規劃 P7 - 客戶跟進系統）
```
1. 擴展 D1 schema（customer_records / follow_up_records）
2. 實現批量導入 API
3. 建立 customers.html 前端
4. 集成 P5 的回訪話術
```

---

## 📝 版本控制與 Git 紀錄

| 階段 | 主要 Commit | 日期 | 說明 |
|---|---|---|---|
| P1 初始化 | `76f20ac` | 初期 | Cloudflare Pages + Pitch 系統基礎 |
| P1 部署 | `c211835` | 初期 | 用戶管理 + API 端點完成 |
| P1 前端 | `fb98152` | 初期 | 前端邏輯實現 |
| P2 內容 | `ae67916` | 初期 | 知識庫最佳化 |
| P2 系列 | `476bf35` | 初期 | Teams 驗證調整 |
| P2 新增 | `4e93cd3` | 進中期 | 系列活動 + XLSX 解析 |
| P2 修復 | `93dfe12` | 進中期 | XLSX 空白 + Gemini 陣列修正 |
| P2 格式 | `a0ea8d8` | 進中期 | 活動 ID 格式卡控 + Batch 429 修正 |
| P3 重構 | `3524cb6` | 進中期 | 活動 ID 純人工必填 |
| P4 資源中心 | `fca322c` | 最近 | 資源中心獨立頁 |
| P5 準備 | `b58d2ed` | 最近 | 核心論述參考 + 跟進提示詞 |

---

**Last Updated**: 2026-04-24  
**Current Phase**: P4 ✅ 完成，P5 ⏳ 待啟動  
**Next Milestone**: 確認 P5 設計決策 → 實現回訪話術 API
