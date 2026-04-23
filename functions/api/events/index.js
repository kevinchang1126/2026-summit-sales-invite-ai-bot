// /api/events — 活動列表與建立
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../_auth.js';

// GET /api/events?status=upcoming
// 所有已登入者可讀
export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  let sql = `
    SELECT e.*, s.name AS series_name
    FROM events e
    LEFT JOIN event_series s ON s.id = e.series_id
  `;
  const binds = [];
  if (status) {
    sql += ' WHERE e.status = ?';
    binds.push(status);
  }
  sql += ' ORDER BY e.event_date DESC';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return jsonResponse({ events: results || [] });
}

// ── 活動 ID 格式驗證 ─────────────────────────────────────────────────────────
// 活動專案代號由外部系統指派，格式：YYYYMM + 4碼數字（如 2026040001）
// 本平台不自動產生，只負責格式卡控
export const EVENT_ID_REGEX = /^20\d{2}(0[1-9]|1[0-2])\d{4}$/;

// ── 場次代號格式驗證 ──────────────────────────────────────────────────────────
// 系列活動下每個場次的地點代號，由外部系統規範，本平台做格式卡控：
//   數字型  : 台北 02~02W、基隆 024、桃園 03~03F、台中 04~04S、高雄 07~07C…
//   線上    : 999、999A~999Z、999AA~999AZ（最多 3碼數字 + 0~2 英文字母）
//   OT序列  : OT01~OT99
//   海外    : TH（泰國）、U01（馬來西亞）、VAJ（越南）
export const SESSION_CODE_RE = /^(OT\d{2}|TH|U\d{2}|VAJ|\d{2,4}[A-Z]{0,2})$/i;

// POST /api/events —— 建立活動（superadmin 或 eventadmin）
// eventadmin 建立的活動會自動加入其管理範圍
// ────────────────────────────────────────────────────────────────────────────
// 有 series_id → 系列場次模式：
//   • id（活動主鍵）由系統自動產生（UUID）
//   • session_code 必填，格式依場次代號規範
// 無 series_id → 獨立活動模式：
//   • id 必填，格式 YYYYMM+4碼（即活動專案代號）
//   • session_code 忽略
export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { id, name, description, target_audience, event_date, event_time, location,
          cover_image_key, tags, series_id, series_order, session_code } = body;
  if (!name || !event_date) return jsonError('缺少必填欄位 name 或 event_date', 400);

  let eventId;
  let finalSessionCode = null;

  if (series_id) {
    // ── 系列場次：session_code 必填，id 自動產生 ──────────────────────────
    if (!session_code) return jsonError('系列場次必須填寫場次代號（session_code）', 400);
    const sc = String(session_code).toUpperCase();
    if (!SESSION_CODE_RE.test(sc)) {
      return jsonError('場次代號格式錯誤（範例：台北 02、02A，線上 999A，OT 序列 OT01，泰國 TH）', 400);
    }
    eventId = crypto.randomUUID();
    finalSessionCode = sc;

    // 驗證系列存在
    const seriesRow = await env.DB.prepare('SELECT 1 FROM event_series WHERE id = ?').bind(series_id).first();
    if (!seriesRow) return jsonError('指定的系列不存在', 400);
  } else {
    // ── 獨立活動：id 必填，格式 YYYYMM+4碼 ─────────────────────────────────
    if (!id) return jsonError('活動專案代號（ID）為必填', 400);
    if (!EVENT_ID_REGEX.test(id)) {
      return jsonError('活動 ID 格式錯誤，必須為 YYYYMM+4碼數字（如 2026040001）', 400);
    }
    eventId = id;
  }

  const taJson = target_audience
    ? (typeof target_audience === 'string' ? target_audience : JSON.stringify(target_audience))
    : null;

  try {
    await env.DB.prepare(
      `INSERT INTO events (id, name, description, target_audience, event_date, event_time,
                           location, cover_image_key, series_id, series_order, session_code, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, name, description || null, taJson, event_date, event_time || null,
           location || null, cover_image_key || null, series_id || null, series_order || null,
           finalSessionCode, userCode).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return series_id
        ? jsonError(`場次代號 ${finalSessionCode} 在此系列中已存在`, 409)
        : jsonError('活動 ID 已存在', 409);
    }
    throw e;
  }

  if (Array.isArray(tags)) {
    for (const tagId of tags) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO tag_relations (target_type, target_id, tag_id) VALUES ('event', ?, ?)`
      ).bind(eventId, tagId).run();
    }
  }

  // eventadmin 自動成為該活動的管理者
  if (roleInfo.role === 'eventadmin') {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO event_admins (user_code, event_id, granted_by) VALUES (?, ?, 'self:create')`
    ).bind(userCode, eventId).run();
  }

  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first();
  return jsonResponse({ event: row }, 201);
}
