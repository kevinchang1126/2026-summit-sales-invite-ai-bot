// /api/events — 活動列表與建立
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../_auth.js';

// GET /api/events?status=upcoming
// GET /api/events?next_id=202604  → 回傳該月下一個可用 ID
// 所有已登入者可讀
export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const url = new URL(request.url);

  // 建議下一個 ID（用於前端表單 hint）
  const nextIdYm = url.searchParams.get('next_id');
  if (nextIdYm) {
    if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(nextIdYm)) {
      return jsonError('next_id 參數格式應為 YYYYMM（如 202604）', 400);
    }
    const fakeDate = nextIdYm.slice(0, 4) + '-' + nextIdYm.slice(4) + '-01';
    const nextId = await generateNextEventId(env.DB, fakeDate);
    return jsonResponse({ next_id: nextId });
  }

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

// ── 活動 ID 工具 ─────────────────────────────────────────────────────────────
const EVENT_ID_REGEX = /^20\d{2}(0[1-9]|1[0-2])\d{4}$/; // YYYYMM + 4碼，如 2026040001

/**
 * 依活動日期自動產生下一個可用 ID（YYYYMM + 遞增4碼）
 * @param {D1Database} db
 * @param {string} eventDate  YYYY-MM-DD
 * @param {number} [offset=0]  批次建立時用於偏移量（避免同月多筆碰撞）
 */
export async function generateNextEventId(db, eventDate, offset = 0) {
  const ym = eventDate.slice(0, 7).replace('-', ''); // "2026-04" → "202604"
  const row = await db.prepare(
    `SELECT MAX(CAST(SUBSTR(id, 7) AS INTEGER)) AS max_seq
     FROM events WHERE id LIKE ? AND LENGTH(id) = 10`
  ).bind(ym + '%').first();
  const nextSeq = (row?.max_seq ?? 0) + 1 + offset;
  if (nextSeq > 9999) throw new Error(`${ym} 月份活動 ID 已達上限 (9999)`);
  return ym + String(nextSeq).padStart(4, '0');
}

// POST /api/events —— 建立活動（superadmin 或 eventadmin）
// eventadmin 建立的活動會自動加入其管理範圍
export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { id, name, description, target_audience, event_date, event_time, location, cover_image_key, tags, series_id, series_order } = body;
  if (!name || !event_date) return jsonError('缺少必填欄位 name 或 event_date', 400);

  // ID 驗證：若提供則必須符合 YYYYMM+4碼格式；若未提供則自動產生
  let eventId;
  if (id) {
    if (!EVENT_ID_REGEX.test(id)) {
      return jsonError('活動 ID 格式錯誤，必須為 YYYYMM+4碼（如 2026040001）', 400);
    }
    eventId = id;
  } else {
    eventId = await generateNextEventId(env.DB, event_date);
  }
  const taJson = target_audience
    ? (typeof target_audience === 'string' ? target_audience : JSON.stringify(target_audience))
    : null;

  // 若指定 series_id，驗證該系列存在
  if (series_id) {
    const seriesRow = await env.DB.prepare('SELECT 1 FROM event_series WHERE id = ?').bind(series_id).first();
    if (!seriesRow) return jsonError('指定的系列不存在', 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO events (id, name, description, target_audience, event_date, event_time, location, cover_image_key, series_id, series_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(eventId, name, description || null, taJson, event_date, event_time || null, location || null, cover_image_key || null, series_id || null, series_order || null, userCode).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return jsonError('活動 ID 已存在', 409);
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
