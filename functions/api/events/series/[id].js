// /api/events/series/[id] — 單一系列的查詢、更新、刪除
import { getUserCode, getUserRole, isSuperadmin, canManageEvent, jsonResponse, jsonError } from '../../_auth.js';

async function canManageSeries(env, userCode, seriesId) {
  // superadmin 可管理所有系列
  if (await isSuperadmin(env, userCode)) return true;
  // eventadmin：若管理該系列內任何一個活動，即可管理此系列
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'eventadmin') return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM events e
     JOIN event_admins ea ON ea.event_id = e.id AND ea.user_code = ?
     WHERE e.series_id = ? LIMIT 1`
  ).bind(userCode, seriesId).first();
  return !!row;
}

// GET /api/events/series/:id  — 含旗下所有場次
export async function onRequestGet({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const series = await env.DB.prepare('SELECT * FROM event_series WHERE id = ?')
    .bind(params.id).first();
  if (!series) return jsonError('找不到系列', 404);

  const { results: sessions } = await env.DB.prepare(
    'SELECT * FROM events WHERE series_id = ? ORDER BY series_order ASC, event_date ASC'
  ).bind(params.id).all();

  return jsonResponse({ series, sessions: sessions || [] });
}

// PUT /api/events/series/:id  — 更新系列基本資訊
export async function onRequestPut({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!await canManageSeries(env, userCode, params.id)) {
    return jsonError('無權限管理此系列', 403);
  }

  const series = await env.DB.prepare('SELECT 1 FROM event_series WHERE id = ?')
    .bind(params.id).first();
  if (!series) return jsonError('找不到系列', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { name, description, cover_image_key, status } = body;
  if (!name) return jsonError('name 為必填', 400);

  const validStatuses = ['active', 'ended', 'archived'];
  if (status && !validStatuses.includes(status)) return jsonError('無效的 status', 400);

  await env.DB.prepare(
    `UPDATE event_series
     SET name = ?, description = ?, cover_image_key = ?, status = ?
     WHERE id = ?`
  ).bind(name, description || null, cover_image_key || null, status || 'active', params.id).run();

  const updated = await env.DB.prepare('SELECT * FROM event_series WHERE id = ?')
    .bind(params.id).first();
  return jsonResponse({ series: updated });
}

// DELETE /api/events/series/:id  — 僅 superadmin，旗下活動 series_id 設為 NULL（ON DELETE SET NULL）
export async function onRequestDelete({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!await isSuperadmin(env, userCode)) return jsonError('需要 superadmin 權限', 403);

  const meta = await env.DB.prepare('DELETE FROM event_series WHERE id = ?')
    .bind(params.id).run();
  if (meta.meta?.changes === 0) return jsonError('找不到系列', 404);

  return jsonResponse({ success: true });
}
