// /api/events/series — 系列活動列表與建立
import { getUserCode, getUserRole, isSuperadmin, jsonResponse, jsonError } from '../../_auth.js';

// GET /api/events/series?status=active
export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  let sql = `
    SELECT s.*,
           COUNT(e.id) AS event_count
    FROM event_series s
    LEFT JOIN events e ON e.series_id = s.id
  `;
  const binds = [];
  if (status) {
    sql += ' WHERE s.status = ?';
    binds.push(status);
  }
  sql += ' GROUP BY s.id ORDER BY s.created_at DESC';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return jsonResponse({ series: results || [] });
}

// POST /api/events/series — 建立系列（superadmin 或 eventadmin）
export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { name, description, cover_image_key, status } = body;
  if (!name) return jsonError('缺少必填欄位 name', 400);

  const seriesId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_series (id, name, description, cover_image_key, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    seriesId,
    name,
    description || null,
    cover_image_key || null,
    status || 'active',
    userCode
  ).run();

  const row = await env.DB.prepare('SELECT * FROM event_series WHERE id = ?').bind(seriesId).first();
  return jsonResponse({ series: row }, 201);
}
