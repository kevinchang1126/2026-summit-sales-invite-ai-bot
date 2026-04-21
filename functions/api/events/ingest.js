// POST /api/events/ingest — 上傳檔案，解析活動資訊
// 策略：XLSX 優先用規則式解析（不依賴 Gemini）；其他格式用 Gemini（含模型降級與重試）
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../_auth.js';

// ── 支援的檔案類型 ───────────────────────────────────────────────────────────
const MIME_MAP = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:  'application/pdf',
  html: 'text/html',
  htm:  'text/html',
  md:   'text/markdown',
  txt:  'text/plain',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
};

// Gemini 模型降級鏈（前者 quota 耗盡時自動嘗試後者）
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

// ── Gemini 提取 Prompt ───────────────────────────────────────────────────────
const PROMPT = `你是活動資訊解析專家。請從以下文件中提取活動相關資訊，以 JSON 格式回傳，不需要任何 markdown 包裝或程式碼區塊。

必須回傳以下 JSON 結構（找不到的欄位設為 null）：
{"name":"活動主標題","description":"活動說明（100字以內）","event_date":"YYYY-MM-DD（若多場取第一場）","event_time":"HH:MM-HH:MM","location":"地點（含城市與場館）","target_audience":{"functions":["職能"],"titles":["職稱"]},"is_series":false,"series_name":null,"sessions":[{"name":"場次名","event_date":"YYYY-MM-DD","event_time":"HH:MM-HH:MM","location":"場地"}]}

判斷準則：若有多個不同日期/地點場次 is_series=true；sessions 只在 is_series=true 時填寫；只回傳 JSON。`;

// ── 工具函式 ─────────────────────────────────────────────────────────────────
function unescapeXml(s = '') {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x[Dd];/g, '');
}

function cleanStr(s = '') {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/** 欄字母 (A, AB…) → 0-based 數字 */
function colToIdx(col) {
  return col.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/** Excel 日期序列（數字）→ YYYY-MM-DD，失敗返回 null */
function excelSerialToISO(serial) {
  const n = parseFloat(serial);
  if (isNaN(n) || n < 1) return null;
  // Excel epoch: 1899-12-30（含1900閏年Bug補正）
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 判斷是否為 Excel 日期序列（2010~2040 年範圍） */
function isExcelDateSerial(val) {
  const s = String(val).trim();
  const n = Number(s);
  return s === String(n) && n >= 40179 && n <= 51545;
}

// ── ZIP 解壓（一次讀多個 entry）───────────────────────────────────────────────
async function readZipEntries(buffer, filterFn) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const result = {};
  let i = 0;

  while (i < bytes.length - 4) {
    if (dv.getUint32(i, true) !== 0x04034b50) { i++; continue; }

    const compression = dv.getUint16(i + 8, true);
    const compSz      = dv.getUint32(i + 18, true);
    const fnLen       = dv.getUint16(i + 26, true);
    const exLen       = dv.getUint16(i + 28, true);
    const dataStart   = i + 30 + fnLen + exLen;
    const filename    = new TextDecoder().decode(bytes.slice(i + 30, i + 30 + fnLen));

    if (filterFn(filename) && compSz > 0) {
      const compressed = bytes.slice(dataStart, dataStart + compSz);
      try {
        let xmlBytes;
        if (compression === 0) {
          xmlBytes = compressed;
        } else if (compression === 8) {
          const ds = new DecompressionStream('deflate-raw');
          const w = ds.writable.getWriter();
          const r = ds.readable.getReader();
          w.write(compressed); w.close();
          const chunks = [];
          while (true) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          xmlBytes = new Uint8Array(total);
          let pos = 0;
          for (const c of chunks) { xmlBytes.set(c, pos); pos += c.length; }
        }
        if (xmlBytes) {
          result[filename] = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
        }
      } catch { /* 忽略 */ }
    }

    const next = dataStart + compSz;
    i = next > i ? next : i + 1;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX 解析器（規則式，不依賴 Gemini）
// ─────────────────────────────────────────────────────────────────────────────

/** 解析單一 sheet XML，回傳 grid 和合併儲存格清單 */
function parseSheetXml(xml, sharedStrings) {
  // 將自閉合空白儲存格（<c ... />）展開為正常形式，避免 regex 誤吃下一個儲存格
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
      } else if (cellType === 'b') {
        const vM = inner.match(/<v>([^<]+)<\/v>/);
        value = vM ? (vM[1] === '1' ? 'TRUE' : 'FALSE') : '';
      } else {
        const vM = inner.match(/<v>([^<]+)<\/v>/);
        if (vM) value = vM[1];
      }

      if (!grid[rowIdx]) grid[rowIdx] = {};
      grid[rowIdx][colIdx] = cleanStr(unescapeXml(value));
    }
  }

  // 合併儲存格清單
  const merges = [];
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[\s\/]*/g)) {
    merges.push({ sc: colToIdx(m[1]), sr: parseInt(m[2]) - 1, ec: colToIdx(m[3]), er: parseInt(m[4]) - 1 });
  }

  return { grid, maxRow, maxCol, merges };
}

/** 合併儲存格：把 anchor 值傳播到整個 range（只填空格，不覆蓋有值的格） */
function applyMerges(grid, merges) {
  for (const { sc, sr, ec, er } of merges) {
    const anchor = grid[sr]?.[sc] ?? '';
    for (let r = sr; r <= er; r++) {
      for (let c = sc; c <= ec; c++) {
        if (r === sr && c === sc) continue;
        if (!grid[r]) grid[r] = {};
        if (!grid[r][c]) grid[r][c] = anchor;
      }
    }
  }
}

/** 將 grid 內的 Excel 日期序列原地轉換為 ISO 字串，並收集所有日期 */
function convertDateSerials(grid, maxRow, maxCol) {
  const dates = [];
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      const v = grid[r]?.[c];
      if (v && isExcelDateSerial(v)) {
        const iso = excelSerialToISO(v);
        if (iso) { grid[r][c] = iso; dates.push(iso); }
      }
    }
  }
  return [...new Set(dates)].sort();
}

/**
 * 規則式 XLSX 事件萃取
 * 策略：
 *   1. 第一列（通常是合併大標題）→ 系列名
 *   2. 在前 5 列尋找 "日期","主題","地區" 等 header 關鍵字 → 判斷欄類型
 *   3. 在資料列，每個「日期欄」+其右側「主題欄」形成一組事件
 */
function xlsxRuleExtract(grid, maxRow, maxCol, sheetName) {
  // ── 1. 系列名稱：第一列最長有意義文字
  let seriesName = null;
  for (let c = 0; c <= maxCol; c++) {
    const v = (grid[0]?.[c] || '').split('\n')[0].trim();
    if (v.length > 3) { seriesName = v; break; }
  }

  // ── 2. 掃描前 5 列，找出各欄類型
  //    colRole[colIdx] = 'date' | 'topic' | 'location' | 'category'
  const colRole = {};
  const DATE_KW  = ['日期', 'date', '時間'];
  // 移除 '活動' 避免「活動日期」被同時命中 date 和 topic
  const TOPIC_KW = ['主題', 'topic', '標題', '名稱', '內容'];
  const LOC_KW   = ['地區', '地點', '城市', 'location', '地方'];
  const CAT_KW   = ['主軸', '議題', 'category', '類別', '分類'];

  let headerRowEnd = 0; // 資料列從哪開始
  for (let r = 0; r <= Math.min(5, maxRow); r++) {
    let foundHeader = false;
    for (let c = 0; c <= maxCol; c++) {
      const v = (grid[r]?.[c] || '').toLowerCase();
      // 用 if/else if：DATE 優先，避免「活動日期」被誤判為 topic
      if (DATE_KW.some(kw => v.includes(kw))) {
        colRole[c] = 'date'; foundHeader = true;
      } else if (TOPIC_KW.some(kw => v.includes(kw))) {
        colRole[c] = 'topic'; foundHeader = true;
      } else if (LOC_KW.some(kw => v.includes(kw))) {
        colRole[c] = 'location'; foundHeader = true;
      }
      if (CAT_KW.some(kw => v.includes(kw))) colRole[c] = 'category';
    }
    if (foundHeader) headerRowEnd = r;
  }

  // 若找不到任何 header，嘗試從資料中自動判斷
  if (!Object.keys(colRole).some(k => colRole[k] === 'date')) {
    // 找第一個包含 ISO 日期的欄
    for (let r = 1; r <= Math.min(4, maxRow); r++) {
      for (let c = 0; c <= maxCol; c++) {
        const v = grid[r]?.[c] || '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { colRole[c] = 'date'; break; }
      }
    }
  }

  // ── 3. 找出「日期欄」列表（可能有多個：online + offline）
  const dateCols = Object.entries(colRole)
    .filter(([, t]) => t === 'date')
    .map(([c]) => parseInt(c))
    .sort((a, b) => a - b);

  // 每個日期欄右側第一個 topic 欄
  const topicCols = Object.entries(colRole)
    .filter(([, t]) => t === 'topic')
    .map(([c]) => parseInt(c))
    .sort((a, b) => a - b);
  const locationCols = Object.entries(colRole)
    .filter(([, t]) => t === 'location')
    .map(([c]) => parseInt(c));

  function findTopicCol(afterCol) {
    return topicCols.find(c => c > afterCol) ?? topicCols[0] ?? -1;
  }
  function findLocationCol(afterCol) {
    return locationCols.find(c => c > afterCol) ?? locationCols[0] ?? -1;
  }

  // ── 4. 資料列萃取
  //   每個「日期欄」到下一個日期欄之間視為一個 column group
  //   Topic / Location 必須在同一 group 內才算匹配
  const sessions = [];
  const DATA_START = headerRowEnd + 1;

  for (let r = DATA_START; r <= maxRow; r++) {
    const row = grid[r] || {};
    if (Object.keys(row).length === 0) continue;

    for (let gi = 0; gi < dateCols.length; gi++) {
      const dc = dateCols[gi];
      const nextDc = dateCols[gi + 1]; // group 上界（undefined = 無限）

      const dateVal = row[dc];
      if (!dateVal) continue;

      // 驗證是否為有效日期
      const isIso = /^\d{4}-\d{2}-\d{2}$/.test(dateVal);
      const isDateText = dateVal.length < 20 && /\d/.test(dateVal);
      if (!isIso && !isDateText) continue;

      // 在同 group 內找 topic / location（> dc，且 < nextDc 如果存在）
      const inGroup = c => c > dc && (nextDc === undefined || c < nextDc);
      const tc = topicCols.find(inGroup) ?? topicCols.find(c => c > dc) ?? -1;
      const lc = locationCols.find(inGroup) ?? -1;

      const rawTopic = tc >= 0 ? (row[tc] || '') : '';
      const topicLines = rawTopic.split('\n').map(s => s.trim()).filter(Boolean);
      const sessionName = topicLines[0] || `場次 ${sessions.length + 1}`;
      const sessionDesc = topicLines.slice(1).join('\n') || null;
      const location = lc >= 0 ? (row[lc] || '') || null : null;

      sessions.push({
        name: sessionName,
        event_date: dateVal,
        event_time: null,
        location,
        description: sessionDesc,
      });
    }
  }

  // ── 5. 組裝 preview
  const isSeries = sessions.length > 1;
  const first = sessions[0] || {};

  return {
    name: isSeries ? (seriesName || sheetName) : (first.name || seriesName),
    description: isSeries ? null : first.description,
    event_date: first.event_date || null,
    event_time: null,
    location: isSeries ? null : first.location,
    target_audience: null,
    is_series: isSeries,
    series_name: isSeries ? seriesName : null,
    sessions: isSeries ? sessions : null,
  };
}

/** XLSX 全流程：解析 → 轉換 → 規則萃取 → 備用 Markdown 字串 */
async function processXlsx(buffer) {
  const files = await readZipEntries(buffer, n =>
    n === 'xl/sharedStrings.xml' ||
    n === 'xl/workbook.xml' ||
    /^xl\/worksheets\/sheet\d+\.xml$/.test(n)
  );

  // Shared strings
  const ssXml = files['xl/sharedStrings.xml'] || '';
  const sharedStrings = [];
  for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => unescapeXml(x[1]));
    sharedStrings.push(cleanStr(texts.join('')));
  }

  // Sheet 名稱
  const wbXml = files['xl/workbook.xml'] || '';
  const sheetNames = [...wbXml.matchAll(/<sheet[^>]+name="([^"]+)"/g)].map(m => unescapeXml(m[1]));

  // 排序 sheet 檔案
  const sheetFiles = Object.keys(files)
    .filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.match(/(\d+)/)?.[1]) - parseInt(b.match(/(\d+)/)?.[1]));

  if (!sheetFiles.length) return null;

  // 只取第一個 sheet（通常規劃表只有一頁）
  const sheetXml = files[sheetFiles[0]];
  const sheetName = sheetNames[0] || 'Sheet1';
  const { grid, maxRow, maxCol, merges } = parseSheetXml(sheetXml, sharedStrings);
  applyMerges(grid, merges);
  convertDateSerials(grid, maxRow, maxCol); // 原地轉換

  // 規則式萃取
  const preview = xlsxRuleExtract(grid, maxRow, maxCol, sheetName);

  // 同時產出乾淨 Markdown（給 Gemini 使用或 debug）
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const cells = [];
    for (let c = 0; c <= maxCol; c++) {
      cells.push((grid[r]?.[c] || '').replace(/\|/g, '\\|').replace(/\n/g, ' / '));
    }
    rows.push('| ' + cells.join(' | ') + ' |');
    if (r === 0) rows.push('|' + Array(maxCol + 1).fill(' --- ').join('|') + '|');
  }
  const markdown = `## ${sheetName}\n\n${rows.join('\n')}`;

  return { preview, markdown, grid, maxRow, maxCol };
}

// ─────────────────────────────────────────────────────────────────────────────
// 其他格式的文字擷取（DOCX / PPTX / HTML / MD / TXT）
// ─────────────────────────────────────────────────────────────────────────────

async function docxToText(buffer) {
  const files = await readZipEntries(buffer, n => n === 'word/document.xml');
  const xml = files['word/document.xml'];
  if (!xml) return null;
  const lines = [];
  for (const pm of xml.matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)) {
    const texts = [...pm[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => unescapeXml(m[1]));
    const line = cleanStr(texts.join(''));
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

async function pptxToText(buffer) {
  const files = await readZipEntries(buffer, n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slideKeys = Object.keys(files).sort((a, b) => {
    return parseInt(a.match(/(\d+)/)?.[1]) - parseInt(b.match(/(\d+)/)?.[1]);
  });
  const slides = [];
  for (const key of slideKeys) {
    const texts = [...files[key].matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map(m => unescapeXml(m[1]).trim()).filter(Boolean);
    if (texts.length) slides.push(`### 投影片 ${slideKeys.indexOf(key) + 1}\n${texts.join(' | ')}`);
  }
  return slides.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini File API（PDF / 圖片用）
// ─────────────────────────────────────────────────────────────────────────────

async function uploadToGeminiFiles(buffer, mimeType, filename, apiKey) {
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buffer.byteLength),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: filename } }),
    }
  );
  if (!initRes.ok) throw new Error(`File API init failed: ${initRes.status}`);

  const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`File upload failed: ${uploadRes.status}`);

  const fileData = await uploadRes.json();
  let state = fileData.file?.state;
  let uri   = fileData.file?.uri;
  const name = fileData.file?.name?.split('/').pop();

  let tries = 0;
  while (state === 'PROCESSING' && tries < 15) {
    await new Promise(r => setTimeout(r, 1500));
    const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${name}?key=${apiKey}`);
    const pd = await poll.json();
    state = pd.file?.state; uri = pd.file?.uri; tries++;
  }
  if (state !== 'ACTIVE') throw new Error(`File processing failed (state: ${state})`);
  return uri;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini generateContent（模型降級鏈 + 重試）
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(apiKey, parts) {
  let lastErr;

  for (const model of GEMINI_MODELS) {
    // 每個模型最多重試 2 次（共 4 次嘗試）
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generation_config: {
                response_mime_type: 'application/json',
                temperature: 0.1,
                max_output_tokens: 2048,
              },
            }),
          }
        );

        if (res.status === 429) {
          lastErr = new Error(`${model} Quota 已達上限，正在嘗試備用模型...`);
          break; // 跳到下一個模型
        }

        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Gemini ${model} ${res.status}: ${t.slice(0, 200)}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini 回傳空結果');

        const cleaned = text.trim()
          .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        return JSON.parse(cleaned);

      } catch (e) {
        if (e.message.includes('429') || e.message.includes('Quota')) {
          lastErr = e; break; // 跳到下一個模型
        }
        throw e; // 非 quota 錯誤直接拋出
      }
    }

    if (lastErr && !lastErr.message.includes('Quota')) throw lastErr;
  }

  throw lastErr || new Error('所有 Gemini 模型 Quota 均已耗盡，請稍後再試');
}

// ─────────────────────────────────────────────────────────────────────────────
// 日期修正工具
// ─────────────────────────────────────────────────────────────────────────────

function fixDate(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主 Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return jsonError('伺服器未設定 GEMINI_API_KEY', 500);

  let formData;
  try { formData = await request.formData(); }
  catch { return jsonError('請以 multipart/form-data 上傳檔案', 400); }

  const file = formData.get('file');
  if (!file || typeof file === 'string') return jsonError('缺少 file 欄位', 400);

  const filename = file.name || 'upload.bin';
  const ext = filename.split('.').pop().toLowerCase();
  const mimeType = MIME_MAP[ext];
  if (!mimeType) {
    return jsonError(`不支援 .${ext}，支援格式：${Object.keys(MIME_MAP).join(', ')}`, 400);
  }

  const buffer = await file.arrayBuffer();
  const MAX = parseInt(env.MAX_UPLOAD_SIZE || '15728640', 10);
  if (buffer.byteLength > MAX) return jsonError('檔案超過 15MB 上限', 400);

  try {
    // ── XLSX：規則式優先，Gemini 可選強化 ──────────────────────────────────
    if (mimeType.includes('spreadsheetml')) {
      const result = await processXlsx(buffer);
      if (!result) return jsonError('無法解析此 XLSX 檔案', 422);

      const { preview: rulePreview, markdown } = result;

      // 若規則式已找到完整資料（有名稱 + 有日期），直接返回，不呼叫 Gemini
      if (rulePreview.name && (rulePreview.event_date || rulePreview.sessions?.length)) {
        return jsonResponse({
          preview: rulePreview,
          filename,
          file_size: buffer.byteLength,
          method: 'rule-based', // 告知前端使用規則式解析
        });
      }

      // 規則式資料不足 → 嘗試 Gemini（用乾淨 Markdown）
      try {
        const geminiPreview = await callGemini(apiKey, [
          { text: PROMPT },
          { text: `\n\n以下是從 ${filename} 轉換的表格內容：\n\n${markdown.slice(0, 30000)}` },
        ]);
        geminiPreview.event_date = fixDate(geminiPreview.event_date);
        if (Array.isArray(geminiPreview.sessions)) {
          geminiPreview.sessions = geminiPreview.sessions.map(s => ({ ...s, event_date: fixDate(s.event_date) }));
        }
        return jsonResponse({ preview: geminiPreview, filename, file_size: buffer.byteLength, method: 'gemini' });
      } catch (geminiErr) {
        // Gemini 失敗（quota 耗盡）→ 返回規則式結果 + 警告
        return jsonResponse({
          preview: rulePreview,
          filename,
          file_size: buffer.byteLength,
          method: 'rule-based',
          warning: `AI 強化解析暫時無法使用（${geminiErr.message}），已顯示規則式基本結果，請手動補充目標受眾等資訊`,
        });
      }
    }

    // ── HTML ────────────────────────────────────────────────────────────────
    if (mimeType === 'text/html') {
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ').trim();
      const preview = await callGemini(apiKey, [
        { text: PROMPT },
        { text: `\n\n文件內容（${filename}）：\n${text.slice(0, 50000)}` },
      ]);
      preview.event_date = fixDate(preview.event_date);
      if (Array.isArray(preview.sessions)) {
        preview.sessions = preview.sessions.map(s => ({ ...s, event_date: fixDate(s.event_date) }));
      }
      return jsonResponse({ preview, filename, file_size: buffer.byteLength });
    }

    // ── Markdown / 純文字 ───────────────────────────────────────────────────
    if (mimeType === 'text/markdown' || mimeType === 'text/plain') {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const preview = await callGemini(apiKey, [
        { text: PROMPT },
        { text: `\n\n文件內容（${filename}）：\n${text.slice(0, 50000)}` },
      ]);
      preview.event_date = fixDate(preview.event_date);
      if (Array.isArray(preview.sessions)) {
        preview.sessions = preview.sessions.map(s => ({ ...s, event_date: fixDate(s.event_date) }));
      }
      return jsonResponse({ preview, filename, file_size: buffer.byteLength });
    }

    // ── DOCX ────────────────────────────────────────────────────────────────
    if (mimeType.includes('wordprocessingml')) {
      const text = await docxToText(buffer);
      if (!text) return jsonError('無法從此 DOCX 中解析文字', 422);
      const preview = await callGemini(apiKey, [
        { text: PROMPT },
        { text: `\n\n文件內容（${filename}）：\n${text.slice(0, 50000)}` },
      ]);
      preview.event_date = fixDate(preview.event_date);
      if (Array.isArray(preview.sessions)) {
        preview.sessions = preview.sessions.map(s => ({ ...s, event_date: fixDate(s.event_date) }));
      }
      return jsonResponse({ preview, filename, file_size: buffer.byteLength });
    }

    // ── PPTX ────────────────────────────────────────────────────────────────
    if (mimeType.includes('presentationml')) {
      const text = await pptxToText(buffer);
      if (!text) return jsonError('無法從此 PPTX 中解析文字', 422);
      const preview = await callGemini(apiKey, [
        { text: PROMPT },
        { text: `\n\n文件內容（${filename}）：\n${text.slice(0, 50000)}` },
      ]);
      preview.event_date = fixDate(preview.event_date);
      if (Array.isArray(preview.sessions)) {
        preview.sessions = preview.sessions.map(s => ({ ...s, event_date: fixDate(s.event_date) }));
      }
      return jsonResponse({ preview, filename, file_size: buffer.byteLength });
    }

    // ── PDF / 圖片 → Gemini File API ────────────────────────────────────────
    const fileUri = await uploadToGeminiFiles(buffer, mimeType, filename, apiKey);
    const preview = await callGemini(apiKey, [
      { text: PROMPT },
      { file_data: { mime_type: mimeType, file_uri: fileUri } },
    ]);
    preview.event_date = fixDate(preview.event_date);
    if (Array.isArray(preview.sessions)) {
      preview.sessions = preview.sessions.map(s => ({ ...s, event_date: fixDate(s.event_date) }));
    }
    return jsonResponse({ preview, filename, file_size: buffer.byteLength });

  } catch (e) {
    return jsonError(`解析失敗：${e.message}`, 502);
  }
}
