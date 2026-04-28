---
name: sales-revisit-pitch-generator
description: 當業務需要針對年會後的客戶（製造或流通產業）生成回訪說帖時使用。根據業務在平台勾選的客戶輪廓（產業別、問卷訊號、聯繫方式），產出可直接使用的回訪說帖，包含客戶分類、切入角度、話術本文、延伸問題、講師引用與下一步行動。支援製造版與流通版問卷邏輯，並依鼎新數智講師優先原則挑選引用內容。
---

# 年會業務回訪說帖生成 Skill

## 觸發情境

當以下所有條件同時成立時，使用此 skill：

1. 使用者（業務）透過平台傳入客戶輪廓勾選資訊
2. 輪廓資訊包含產業別（製造或流通）、問卷訊號代碼、聯繫方式
3. 目的為生成「符合該輪廓的客戶群通用說帖」，不是針對單一個別客戶

若使用者只是詢問年會內容、問講師觀點、問問卷題目本身，不觸發此 skill，直接回答即可。

## 核心設計原則

1. **群體通用說帖**：話術中不得使用「您上次提到」等個別客戶語言，應用「這類規模的製造業常見…」等群體語言
2. **tier 由高商機訊號決定，內容由所有訊號決定**：分類優先級只看 Q1 與 Q8 錨點；話術內容、講師選擇、延伸問題綜合所有訊號
3. **鼎新講師優先**：李義訓、黃昱凱、黃盈彰為主引用來源；引用 2 位以上時鼎新至少 1 位且排首位
4. **混合規則路線**：分類用硬規則查表；講師用半硬規則；話術內容用軟規則 + checklist 檢查

---

## 分層載入策略（重要）

為避免 prompt 過長造成規則遵循下降，**依條件載入規則檔**，非全載。

### 一律載入（骨幹，每次必讀）

- `schemas/input_schema.md`
- `rules/classification_rules.md`
- `rules/speaker_citation_rules.md`
- `rules/governance_language_rules.md`
- `references/講師稱謂對照表.md`
- `references/鼎新核心觀點速查.md`

### 依產業別載入（擇一）

- `industry = manufacturing` → `references/製造問卷_對應表.md`
- `industry = retail` → `references/流通問卷_對應表.md`

### 依聯繫方式載入（擇一，內含該方式專屬禁令）

- `contact_method = phone` → `templates/電話_話術範本.md`
- `contact_method = visit` → `templates/親訪_議程範本.md`
- `contact_method = line` → `templates/LINE_訊息範本.md`
- `contact_method = email` → `templates/EMAIL_信件範本.md`

### 依 tier 載入（擇一段落）

執行完 Step 3 分類後，依判定出的 tier，從 `rules/tier_behaviors.md` **只讀對應段落**（P1/P2/P3/P4 其中一段）。

### 依挑選到的講師載入（1-3 份）

執行完 Step 4 講師挑選後，才讀取對應的 `speakers/{name}.md`，不預先全載。

---

## 核心生成流程

### Step 1：驗證輸入

平台傳入 JSON：

```json
{
  "industry": "manufacturing | retail",
  "signals": ["Q1_ARRANGE", "Q7_ROI"],
  "contact_method": "phone | visit | line | email",
  "attendance": "attended | no_show | unknown",
  "survey_filled": "yes | no"
}
```

驗證：industry 必填；signals 允許空陣列；contact_method 必填，預設 phone。

### Step 2：載入骨幹資料

讀取「一律載入」清單 + 依產業別選讀的問卷對應表 + 依聯繫方式選讀的範本。

### Step 3：分類客戶輪廓

依 `rules/classification_rules.md` 三階段判定（行為覆蓋層 → 高商機掃描 → 降級判定），得出 tier。

**分類後立即從 `rules/tier_behaviors.md` 載入對應 tier 段落**。

### Step 4：挑選講師引用

依 `rules/speaker_citation_rules.md` 的優先清單，選出 1-3 位（鼎新至少 1 位），**再讀取對應講師 md**。

### Step 5：生成說帖內容

依範本骨架與 tier 行為指引，依序填充：APPROACH → CONTENT → QUESTIONS → SPEAKERS → NEXT_ACTIONS。

### Step 6：執行最終檢查清單

對照本文件末尾「最終檢查清單」逐項驗證。任一項失敗則針對違反段落重新生成。

---

## 輸出格式（固定標題 Markdown）

**嚴格遵循此格式**。平台端 Parser 依賴此格式解析，不得新增、刪除或調整順序。

```markdown
## CLASSIFICATION
tier: P1
label: 立即推進
primary_anchor: Q1_ARRANGE
secondary_signals: Q7_ROI, Q5_SUPPLY_CHAIN
industry: manufacturing
contact_method: phone

## APPROACH
[2-4 句自然語氣，說明此客戶輪廓最適合從哪個角度切入。純散文，不條列。]

## CONTENT
[依聯繫方式範本的話術本文，完全自然語氣。
引用講師觀點時使用 <cite code="知識卡代碼">引言</cite> 標記。
範例：黃盈彰總經理分享的作法是<cite code="K-HYZ-05">同步看身份、權限、追溯</cite>。
字數限制：電話 ≤ 180 字 / LINE ≤ 150 字 / 親訪與 EMAIL 見範本。]

## QUESTIONS
- 問題 1
- 問題 2
- 問題 3

## SPEAKERS
- 黃昱凱副總裁｜數智分身補足人力缺口｜K-HYK-06
- 黃盈彰總經理｜急單跨部門協作｜K-HYZ-05

## NEXT_ACTIONS
action: 3 個工作天內安排需求訪談
timing: 本週內
materials: 製造業供應鏈案例, 智慧底座說明資料
```

### 格式細節

- **CLASSIFICATION**：每行 key: value；tier 僅能為 P1/P2/P3/P4；若無問卷資料 primary_anchor 填 NONE
- **APPROACH**：純散文，不超過 4 句
- **CONTENT**：不得使用 `##` 或 `###` 子標題；EMAIL 需在開頭寫「主旨：XXX」再空一行接正文；引用講師觀點時用 `<cite code="知識卡代碼">引言</cite>` 標記（引言長度依聯繫方式：電話/LINE 10-20 字，親訪/EMAIL 30-50 字）
- **QUESTIONS**：一律 `- ` 開頭；3-5 個，每題單句
- **SPEAKERS**：格式 `- {正式稱謂}｜{觀點摘要 15 字內}｜{知識卡代碼}`；全形直線｜；1-3 位，鼎新排首位
- **NEXT_ACTIONS**：3 個 key: value；materials 逗號分隔

---

## 最終檢查清單（生成前必過）

每次輸出前依序勾選。**任一項不通過即重新生成違反段落**，不得遷就其他區塊。

### A. 格式結構

- [ ] 6 個固定區塊標題存在且順序正確
- [ ] tier 與分類規則判定結果一致
- [ ] CONTENT 區塊內無 `##` 或 `###` 子標題
- [ ] CONTENT 內的 `<cite>` 標記符合 `<cite code="XXX">引言</cite>` 格式
- [ ] CONTENT 內的 `<cite>` code 屬性值存在於 speaker_citation_rules.md 的知識卡清單中
- [ ] QUESTIONS 為 3-5 個，每題單句
- [ ] SPEAKERS 使用全形直線｜且含知識卡代碼

### B. 客戶輪廓語言

- [ ] 無「您上次」「上回」「之前您有」等個別互動語言
- [ ] 無具體產品線、人數規模、營收數字、地點等假設
- [ ] 使用「這類規模」「類似情境」「在您這個產業」等群體語言

### C. 講師引用

- [ ] 若引用 2 位以上，SPEAKERS 首位為鼎新講師（李義訓/黃昱凱/黃盈彰）
- [ ] 講師稱謂符合對照表（副總裁不簡稱副總；不直呼姓名）
- [ ] CONTENT 本文實際提名講師 ≤ 2 位
- [ ] 電話與 LINE 場景中，CONTENT 實際提名講師 ≤ 1 位
- [ ] CONTENT 內 `<cite>` 標記總數：電話/LINE ≤ 2 個，親訪/EMAIL ≤ 4 個
- [ ] `<cite>` 標記的引言長度符合聯繫方式限制
- [ ] 觀點可對應到該講師 md 的知識卡代碼
- [ ] 未捏造講師未說過的觀點

### D. tier 對應語氣

依 `rules/tier_behaviors.md` 對應 tier 段落逐項檢查。重點：

- [ ] P1：含具體下一步行動；不停留在教育層級
- [ ] P2：無直接推大型導入；含「先寄資料」或「短訪談」低壓力選項
- [ ] P3：無「急迫、立即、馬上」等急推詞
- [ ] P4：無強推語言；話術為關懷 + 提供價值

### E. 治理語言（條件式）

當訊號含 `Q4_INTEGRATED` / `Q4_FULL` / `Q5_FINANCE` / `Q5_DECISION` / `Q7_DATA`（製造）或 `Q4_SECURITY`（流通）時必檢：

- [ ] CONTENT 提及身份、權限、責任、追溯、可監督其中至少一項
- [ ] 若 tier = P1，CONTENT 使用「代理治理」或「可控、可用、可負責」語言至少一次
- [ ] 具體指出治理的哪一面，未停留在「要做治理」空泛語

### F. 品質與誠信

- [ ] 無「業界最好」「獨家」「保證省 X%」等誇大或量化承諾
- [ ] 無直接點名競爭對手產品
- [ ] 無過度合規保證
- [ ] 無假設客戶性別、年齡、國籍（用「您」或「貴公司」）

### G. 聯繫方式字數（見範本詳細規範）

- [ ] 電話 CONTENT ≤ 180 字
- [ ] LINE CONTENT ≤ 150 字
- [ ] EMAIL 含主旨且主旨 ≤ 25 字
- [ ] 親訪含會談流程與會前準備資料清單

### H. 邏輯一致性

- [ ] CONTENT 提到的講師都在 SPEAKERS 區塊列出
- [ ] SPEAKERS 列出的講師，CONTENT 中至少間接引用觀點
- [ ] NEXT_ACTIONS 的 action 與 tier 相符
