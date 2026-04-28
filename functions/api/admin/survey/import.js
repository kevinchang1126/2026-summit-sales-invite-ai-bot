// POST /api/admin/survey/import
// 批量匯入客戶問卷資料（支援製造業 / 流通業兩種 XLSX 格式）
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../../_auth.js';

// ── 問卷欄位對應（依 Excel header 關鍵字偵測）──────────────────────────────

// 製造業問卷：Q1 → signal code 對應
const MFG_Q1_SIGNALS = [
  'Q1_ARRANGE',  // 安排人員了解需求
  'Q1_INTEREST', // 對AI方案感興趣
  'Q1_ONLINE',   // 想了解AI最新應用（線上活動）
  'Q1_OFFLINE',  // 有意願參加實體活動
  'Q1_NOT_NOW',  // 先不用
];
const MFG_Q4_SIGNALS = [
  'Q4_NONE',       // 尚未起步
  'Q4_TRIAL',      // 局部嘗試
  'Q4_POINT',      // 點狀應用
  'Q4_INTEGRATED', // 系統整合
  'Q4_FULL',       // 全面賦能
];
const MFG_Q5_SIGNALS = [
  'Q5_SUPPLY_CHAIN', // 生產與供應鏈
  'Q5_FINANCE',      // 財務與行政核銷
  'Q5_RD',           // 研發與技術
  'Q5_DECISION',     // 經營管理與決策
];
const MFG_Q6_SIGNALS = [
  'Q6_FREQUENCY', // 高頻度重複作業
  'Q6_KNOWLEDGE', // 知識斷層經驗傳承
  'Q6_EXPERIENCE', // 既有作業流程輔助決策
  'Q6_WORKLOAD',  // 自動化處理重複行政
];
const MFG_Q7_SIGNALS = [
  'Q7_DATA',       // 數據品質不佳
  'Q7_RESISTANCE', // 員工排斥
  'Q7_TALENT',     // 缺乏AI人才
  'Q7_ROI',        // ROI不明確
];
const MFG_Q8_SIGNALS = [
  'Q8_BUDGET',   // 已有明確預算
  'Q8_EVALUATE', // 積極評估中
  'Q8_WATCH',    // 持觀望
  'Q8_NONE',     // 暫無規劃
];

// 流通業問卷：Q1
const DIST_Q1_SIGNALS = [
  'Q1_VISIT',            // 到府討論
  'Q1_REVIEW_PROCESS',   // 檢視作業流程
  'Q1_EXPLAIN_SOLUTION', // 進一步說明鼎新解決方案
  'Q1_OTHER',            // 其他（記錄但不加入主要 signals）
];
const DIST_Q4_SIGNALS = [
  'Q4_COMPETITION',   // 因應市場或同業競爭
  'Q4_REVENUE',       // 推動營收成長
  'Q4_EFFICIENCY',    // 提升效率與員工體驗
  'Q4_CUSTOMER_EXP',  // 提升客戶體驗
  'Q4_RESILIENCE',    // 強化企業韌性
  'Q4_SECURITY',      // 強化資安與資訊治理
  'Q4_SUSTAINABILITY',// 企業永續與創新
  'Q4_OTHER',         // 其他（記錄但不加入主要 signals）
];
const DIST_Q5_SIGNALS = [
  'Q5_NOT_EVALUATED', // 尚未評估
  'Q5_HALF_YEAR',     // 預計半年內導入
  'Q5_ONE_YEAR',      // 預計一年內導入
  'Q5_TWO_YEAR',      // 預計二年內導入
  'Q5_ADOPTED',       // 已導入
];

// ── ZIP / XLSX 解析工具（從 ingest.js 複製過來以避免跨檔 import）──────────

function unescapeXml(s = '') {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x[Dd];/g, '');
}
function cleanStr(s = '') { return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(); }
function colToIdx(col) { return col.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1; }

async function readZipEntries(buffer, filterFn) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const result = {};
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos < 0) return result;
  const cdTotal = dv.getUint16(eocdPos + 10, true);
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  let pos = cdOffset;
  for (let n = 0; n < cdTotal; n++) {
    if (pos + 46 > bytes.length) break;
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const compMethod = dv.getUint16(pos + 10, true);
    const compSz = dv.getUint32(pos + 20, true);
    const fnLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localHdrOff = dv.getUint32(pos + 42, true);
    const filename = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + fnLen));
    if (filterFn(filename) && compSz > 0) {
      const lhFnLen = dv.getUint16(localHdrOff + 26, true);
      const lhExtraLen = dv.getUint16(localHdrOff + 28, true);
      const dataStart = localHdrOff + 30 + lhFnLen + lhExtraLen;
      if (dataStart + compSz <= bytes.length) {
        const compressed = bytes.slice(dataStart, dataStart + compSz);
        try {
          let xmlBytes;
          if (compMethod === 0) {
            xmlBytes = compressed;
          } else if (compMethod === 8) {
            const ds = new DecompressionStream('deflate-raw');
            const w = ds.writable.getWriter();
            const r = ds.readable.getReader();
            w.write(compressed); w.close();
            const chunks = [];
            while (true) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
            const total = chunks.reduce((s, c) => s + c.length, 0);
            xmlBytes = new Uint8Array(total);
            let p = 0;
            for (const c of chunks) { xmlBytes.set(c, p); p += c.length; }
          }
          if (xmlBytes) result[filename] = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
        } catch { /* ignore */ }
      }
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return result;
}

function parseSheetXml(xml, sharedStrings) {
  xml = xml.replace(/<c(\s[^>]*)\/>/g, '<c$1></c>');
  const grid = {};
  let maxRow = 0, maxCol = 0;
  for (const rowM of xml.matchAll(/<row[^>]+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIdx = parseInt(rowM[1]) - 1;
    maxRow = Math.max(maxRow, rowIdx);
    for (const cellM of rowM[2].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellM[1], inner = cellM[2];
      const refM = attrs.match(/r="([A-Z]+)\d+"/);
      if (!refM) continue;
      const colIdx = colToIdx(refM[1]);
      maxCol = Math.max(maxCol, colIdx);
      const cellType = (attrs.match(/t="([^"]+)"/) || [])[1];
      let value = '';
      if (cellType === 's') {
        const vM = inner.match(/<v>(\d+)<\/v>/);
        if (vM) value = sharedStrings[parseInt(vM[1])] ?? '';
      } else if (cellType === 'inlineStr') {
        value = [...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => unescapeXml(x[1])).join('');
      } else {
        const vM = inner.match(/<v>([^<]+)<\/v>/);
        if (vM) value = vM[1];
      }
      if (!grid[rowIdx]) grid[rowIdx] = {};
      grid[rowIdx][colIdx] = cleanStr(unescapeXml(value));
    }
  }
  return { grid, maxRow, maxCol };
}

async function parseXlsx(buffer) {
  const files = await readZipEntries(buffer, n =>
    n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n)
  );
  const ssXml = files['xl/sharedStrings.xml'] || '';
  const sharedStrings = [];
  for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => unescapeXml(x[1]));
    sharedStrings.push(cleanStr(texts.join('')));
  }
  const sheetFiles = Object.keys(files)
    .filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.match(/(\d+)/)?.[1]) - parseInt(b.match(/(\d+)/)?.[1]));
  if (!sheetFiles.length) return null;
  return parseSheetXml(files[sheetFiles[0]], sharedStrings);
}

// ── 問卷偵測與解析 ───────────────────────────────────────────────────────────

/** 判斷問卷類型：製造業  // 流通業問卷有 Q5 導入時程選項，製造業沒有 */
function detectIndustryType(headers) {
  const h = headers.map(v => (v || '').toLowerCase());
  // 製造業有 Q8 / Q6 / Q7 欄位，流通業沒有
  const hasMfgQ8 = h.some(x => x.includes('q8'));
  const hasMfgQ6 = h.some(x => x.includes('q6'));
  const hasDistQ5Time = h.some(x => x.includes('半年') || x.includes('一年') || x.includes('二年') || x.includes('已導入'));
  if (hasMfgQ8 || hasMfgQ6) return 'manufacturing';
  if (hasDistQ5Time) return 'retail';
  // fallback: 看 Q4 內容
  const hasQ4Revenue = h.some(x => x.includes('營收'));
  return hasQ4Revenue ? 'retail' : 'manufacturing';
}

/** 取得各 Q 的欄位起始 index */
function findQColumns(headers) {
  const map = { q1: [], q4: [], q5: [], q6: [], q7: [], q8: [], base: {} };
  headers.forEach((h, i) => {
    if (!h) return;
    const lower = h.toLowerCase();
    // 基本欄位
    if (lower.includes('潛客代號') || lower.includes('客代號')) map.base.customer_code = i;
    else if (lower.includes('客戶全名') || lower.includes('客戶名稱')) map.base.company_name = i;
    else if (lower.includes('客戶姓名') || lower.includes('聯絡人')) map.base.contact_name = i;
    else if (lower.includes('部門') && !lower.includes('ac')) map.base.department = i;
    else if (lower.includes('職稱') && !lower.includes('ac')) map.base.job_title = i;
    else if (lower.includes('職能') && !lower.includes('ac')) map.base.job_function = i;
    else if (lower.includes('活動日期')) map.base.event_date = i;
    else if (lower === '場次' || (lower.includes('場次') && !lower.includes('ac') && !lower.includes('序'))) map.base.session_name = i;
    else if (lower.includes('序號')) map.base.serial_no = i;
    else if (lower.includes('ac') && (lower.includes('工號') || lower === 'ac規劃師')) map.base.ac_code = i;
    else if (lower.includes('ac') && lower.includes('姓名')) map.base.ac_name = i;
    else if (lower.includes('ac') && lower.includes('部門')) map.base.ac_dept = i;
    else if (lower.includes('實到') || lower === '實到否') map.base.attended = i;
    else if (lower.includes('問卷') || lower === '問卷否') map.base.has_survey = i;
    // 問卷欄位
    else if (lower.startsWith('q1')) map.q1.push(i);
    else if (lower.startsWith('q4')) map.q4.push(i);
    else if (lower.startsWith('q5')) map.q5.push(i);
    else if (lower.startsWith('q6')) map.q6.push(i);
    else if (lower.startsWith('q7')) map.q7.push(i);
    else if (lower.startsWith('q8')) map.q8.push(i);
  });
  return map;
}

/** 把 bits array + signal list → 勾選的 signal codes */
function extractSignals(row, colIndices, signalList) {
  const signals = [];
  const raw = [];
  colIndices.forEach((colIdx, i) => {
    const val = row[colIdx];
    const bit = val === '1' || val === 'Y' || val === 'y' || val === 'TRUE' || val === 'true' || val === 'T' ? 1 : 0;
    raw.push(bit);
    if (bit === 1 && signalList[i]) signals.push(signalList[i]);
  });
  return { signals, raw };
}

/** 解析單行 row 為結構化資料 */
function parseRow(row, colMap, industryType) {
  const b = colMap.base;
  const boolVal = v => v === 'Y' || v === 'y' || v === '1' || v === 'TRUE' ? 1 : 0;

  const q1Signals = industryType === 'manufacturing' ? MFG_Q1_SIGNALS : DIST_Q1_SIGNALS;
  const q4Signals = industryType === 'manufacturing' ? MFG_Q4_SIGNALS : DIST_Q4_SIGNALS;
  const q5Signals = industryType === 'manufacturing' ? MFG_Q5_SIGNALS : DIST_Q5_SIGNALS;

  const q1 = extractSignals(row, colMap.q1, q1Signals);
  const q4 = extractSignals(row, colMap.q4, q4Signals);
  const q5 = extractSignals(row, colMap.q5, q5Signals);
  const q6 = extractSignals(row, colMap.q6, MFG_Q6_SIGNALS);
  const q7 = extractSignals(row, colMap.q7, MFG_Q7_SIGNALS);
  const q8 = extractSignals(row, colMap.q8, MFG_Q8_SIGNALS);

  const allSignals = [...q1.signals, ...q4.signals, ...q5.signals, ...q6.signals, ...q7.signals, ...q8.signals];

  // 出席狀態推導
  const attended = boolVal(row[b.attended]);
  const has_survey = boolVal(row[b.has_survey]);
  // 補充行為信號（問卷=N but 出席=Y → 出席未填問卷）
  if (attended && !has_survey && allSignals.length === 0) {
    // 不加入 signals，讓 classifyTier 依行為情境判斷
  }

  return {
    customer_code: String(row[b.customer_code] || '').trim(),
    company_name: String(row[b.company_name] || '').trim(),
    contact_name: String(row[b.contact_name] || '').trim(),
    department: String(row[b.department] || '').trim(),
    job_title: String(row[b.job_title] || '').trim(),
    job_function: String(row[b.job_function] || '').trim(),
    event_date: String(row[b.event_date] || '').trim(),
    session_name: String(row[b.session_name] || '').trim(),
    serial_no: String(row[b.serial_no] || '').trim(),
    ac_code: String(row[b.ac_code] || '').trim(),
    ac_name: String(row[b.ac_name] || '').trim(),
    ac_dept: String(row[b.ac_dept] || '').trim(),
    attended,
    has_survey,
    industry_type: industryType,
    signals: JSON.stringify(allSignals),
    q1_raw: JSON.stringify(q1.raw),
    q4_raw: JSON.stringify(q4.raw),
    q5_raw: JSON.stringify(q5.raw),
    q6_raw: JSON.stringify(q6.raw),
    q7_raw: JSON.stringify(q7.raw),
    q8_raw: JSON.stringify(q8.raw),
  };
}

// ── 主 Handler ────────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') {
    return jsonError('需要 superadmin 權限', 403);
  }

  const contentType = request.headers.get('content-type') || '';
  let buffer, overwriteCodesStr = '', dryRun = false;

  if (contentType.includes('multipart/form-data')) {
    let formData;
    try { formData = await request.formData(); }
    catch { return jsonError('請以 multipart/form-data 上傳', 400); }

    const file = formData.get('file');
    if (!file || typeof file === 'string') return jsonError('缺少 file 欄位', 400);
    buffer = await file.arrayBuffer();
    overwriteCodesStr = formData.get('overwrite_codes') || '';
    dryRun = formData.get('dry_run') === '1';
  } else {
    return jsonError('請以 multipart/form-data 上傳', 400);
  }

  // 解析 XLSX
  const parsed = await parseXlsx(buffer);
  if (!parsed) return jsonError('無法解析此 XLSX 檔案', 422);

  const { grid, maxRow, maxCol } = parsed;

  // 第一列為 header (使用 maxCol 確保 index 正確)
  const headers = [];
  for (let i = 0; i <= maxCol; i++) {
    headers[i] = grid[0] ? grid[0][i] : undefined;
  }

  const colMap = findQColumns(headers);
  const industryType = detectIndustryType(headers);

  if (colMap.base.customer_code === undefined) return jsonError('找不到「潛客代號」欄位，請確認檔案格式', 422);

  // 解析所有資料列
  const rows = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = grid[r];
    if (!row) continue;
    const customerCode = String(row[colMap.base.customer_code] || '').trim();
    if (!customerCode || customerCode === '0' || customerCode === '') continue;
    rows.push(parseRow(row, colMap, industryType));
  }

  if (rows.length === 0) return jsonError('未找到有效資料列', 422);

  // dry run：只返回解析結果（前5筆預覽 + 重複檢測）
  if (dryRun) {
    const codes = [...new Set(rows.map(r => r.customer_code))];
    const placeholders = codes.map(() => '?').join(',');
    const existing = codes.length > 0
      ? await env.DB.prepare(`SELECT customer_code, contact_name, event_date, session_name FROM survey_responses WHERE customer_code IN (${placeholders})`).bind(...codes).all()
      : { results: [] };

    const existingSet = new Set(existing.results.map(e => `${e.customer_code}|${e.contact_name}|${e.event_date}|${e.session_name}`));
    const duplicates = rows.filter(r => existingSet.has(`${r.customer_code}|${r.contact_name}|${r.event_date}|${r.session_name}`));

    return jsonResponse({
      industry_type: industryType,
      total: rows.length,
      preview: rows.slice(0, 5).map(r => ({
        customer_code: r.customer_code,
        company_name: r.company_name,
        contact_name: r.contact_name,
        session_name: r.session_name,
        event_date: r.event_date,
        attended: r.attended,
        has_survey: r.has_survey,
        signals: JSON.parse(r.signals),
      })),
      duplicates: duplicates.map(r => ({
        customer_code: r.customer_code,
        company_name: r.company_name,
        session_name: r.session_name,
        event_date: r.event_date,
      })),
    });
  }

  // 正式匯入
  // overwrite key 格式：customer_code|contact_name（允許同公司不同人分開覆蓋）
  const overwriteKeys = new Set(
    overwriteCodesStr ? overwriteCodesStr.split(',').map(s => s.trim()).filter(Boolean) : []
  );

  let imported = 0, skipped = 0, overwritten = 0;
  const errors = [];

  for (const row of rows) {
    // 重複判斷：同一法人 + 同一自然人 + 同一場次 = 同一筆
    const rowKey = `${row.customer_code}|${row.contact_name}`;
    try {
      if (overwriteKeys.has(row.customer_code) || overwriteKeys.has(rowKey)) {
        // 覆蓋更新
        await env.DB.prepare(`
          INSERT INTO survey_responses
            (customer_code, company_name, contact_name, department, job_title, job_function,
             event_date, session_name, serial_no, ac_code, ac_name, ac_dept,
             attended, has_survey, industry_type, signals, q1_raw, q4_raw, q5_raw, q6_raw, q7_raw, q8_raw, imported_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(customer_code, contact_name, event_date, session_name) DO UPDATE SET
            company_name=excluded.company_name, department=excluded.department,
            job_title=excluded.job_title, job_function=excluded.job_function,
            ac_code=excluded.ac_code, ac_name=excluded.ac_name, ac_dept=excluded.ac_dept,
            attended=excluded.attended, has_survey=excluded.has_survey,
            signals=excluded.signals, q1_raw=excluded.q1_raw, q4_raw=excluded.q4_raw,
            q5_raw=excluded.q5_raw, q6_raw=excluded.q6_raw, q7_raw=excluded.q7_raw,
            q8_raw=excluded.q8_raw, imported_by=excluded.imported_by, imported_at=datetime('now')
        `).bind(
          row.customer_code, row.company_name, row.contact_name, row.department,
          row.job_title, row.job_function, row.event_date, row.session_name, row.serial_no,
          row.ac_code, row.ac_name, row.ac_dept, row.attended, row.has_survey,
          row.industry_type, row.signals, row.q1_raw, row.q4_raw, row.q5_raw,
          row.q6_raw, row.q7_raw, row.q8_raw, userCode
        ).run();
        overwritten++;
      } else {
        // 僅插入（已存在則跳過）
        const result = await env.DB.prepare(`
          INSERT OR IGNORE INTO survey_responses
            (customer_code, company_name, contact_name, department, job_title, job_function,
             event_date, session_name, serial_no, ac_code, ac_name, ac_dept,
             attended, has_survey, industry_type, signals, q1_raw, q4_raw, q5_raw, q6_raw, q7_raw, q8_raw, imported_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          row.customer_code, row.company_name, row.contact_name, row.department,
          row.job_title, row.job_function, row.event_date, row.session_name, row.serial_no,
          row.ac_code, row.ac_name, row.ac_dept, row.attended, row.has_survey,
          row.industry_type, row.signals, row.q1_raw, row.q4_raw, row.q5_raw,
          row.q6_raw, row.q7_raw, row.q8_raw, userCode
        ).run();
        if (result.meta.changes > 0) imported++;
        else skipped++;
      }
    } catch (e) {
      errors.push({ customer_code: row.customer_code, contact_name: row.contact_name, error: e.message });
    }
  }

  return jsonResponse({ imported, skipped, overwritten, errors, total: rows.length });
}

// GET /api/admin/survey/import?list=1    ← 列出所有問卷記錄
// GET /api/admin/survey/import?recent=1  ← 最近 1 小時匯入的（用於取 ID 啟動批量生成）
// GET /api/admin/survey/import?q=...     ← 搜尋（潛客代號 / 公司 / 聯絡人）
export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') {
    return jsonError('需要 superadmin 權限', 403);
  }

  const url = new URL(request.url);
  const listMode   = url.searchParams.get('list') === '1';
  const recentMode = url.searchParams.get('recent') === '1';
  const q          = (url.searchParams.get('q') || '').trim();

  let sql, binds;
  if (recentMode) {
    sql   = `SELECT id, customer_code, company_name, session_name, event_date, signals
             FROM survey_responses
             WHERE imported_at >= datetime('now', '-1 hour')
             ORDER BY id DESC LIMIT 200`;
    binds = [];
  } else if (q) {
    sql   = `SELECT sr.id, sr.customer_code, sr.company_name, sr.contact_name, sr.job_title, sr.job_function,
                    sr.event_date, sr.session_name, sr.attended, sr.has_survey, sr.industry_type, sr.signals,
                    sr.ac_code, sr.ac_name,
                    CASE WHEN MAX(p.id) IS NOT NULL THEN 1 ELSE 0 END as has_pitch,
                    MAX(p.created_at) as pitch_created_at
             FROM survey_responses sr
             LEFT JOIN pitches p ON p.customer_code = sr.customer_code AND p.pitch_type = 'bulk_generated'
             WHERE sr.customer_code LIKE ? OR sr.company_name LIKE ? OR sr.contact_name LIKE ?
             GROUP BY sr.id
             ORDER BY sr.imported_at DESC LIMIT 50`;
    binds = [`%${q}%`, `%${q}%`, `%${q}%`];
  } else {
    sql   = `SELECT sr.id, sr.customer_code, sr.company_name, sr.contact_name, sr.job_title, sr.job_function,
                    sr.event_date, sr.session_name, sr.attended, sr.has_survey, sr.industry_type, sr.signals,
                    sr.ac_code, sr.ac_name,
                    CASE WHEN MAX(p.id) IS NOT NULL THEN 1 ELSE 0 END as has_pitch,
                    MAX(p.created_at) as pitch_created_at
             FROM survey_responses sr
             LEFT JOIN pitches p ON p.customer_code = sr.customer_code AND p.pitch_type = 'bulk_generated'
             GROUP BY sr.id
             ORDER BY sr.imported_at DESC LIMIT 300`;
    binds = [];
  }

  try {
    const stmt   = env.DB.prepare(sql);
    const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return jsonResponse({ results: result.results || [] });
  } catch (e) {
    return jsonError('查詢失敗：' + e.message, 500);
  }
}
