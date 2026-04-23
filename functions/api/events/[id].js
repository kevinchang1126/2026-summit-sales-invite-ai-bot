// /api/events/:id —— 單一活動
import { getUserCode, isSuperadmin, canManageEvent, jsonResponse, jsonError } from '../_auth.js';

export async function onRequestGet({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(params.id).first();
  if (!event) return jsonError('找不到活動', 404);

  const { results: tags } = await env.DB.prepare(
    `SELECT t.* FROM tags t
     JOIN tag_relations r ON r.tag_id = t.id
     WHERE r.target_type = 'event' AND r.target_id = ?`
  ).bind(params.id).all();

  return jsonResponse({ event: { ...event, tags: tags || [] } });
}

// PUT /api/events/:id —— 編輯（superadmin 或該活動的 eventadmin）
export async function onRequestPut({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!(await canManageEvent(env, userCode, params.id))) {
    return jsonError('無權管理此活動', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const editable = ['name', 'description', 'target_audience', 'event_date', 'event_time', 'location', 'cover_image_key', 'status', 'series_id', 'series_order', 'session_code'];
  const updates = [];
  const binds = [];
  for (const f of editable) {
    if (f in body) {
      let v = body[f];
      if (f === 'target_audience' && v && typeof v !== 'string') v = JSON.stringify(v);
      updates.push(`${f} = ?`);
      binds.push(v);
    }
  }

  if (updates.length === 0 && !('tags' in body)) {
    return jsonError('沒有可更新的欄位', 400);
  }

  if (updates.length > 0) {
    updates.push('updated_at = unixepoch()');
    binds.push(params.id);
    await env.DB.prepare(
      `UPDATE events SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();
  }

  if (Array.isArray(body.tags)) {
    await env.DB.prepare(
      `DELETE FROM tag_relations WHERE target_type = 'event' AND target_id = ?`
    ).bind(params.id).run();
    for (const tagId of body.tags) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO tag_relations (target_type, target_id, tag_id) VALUES ('event', ?, ?)`
      ).bind(params.id, tagId).run();
    }
  }

  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(params.id).first();
  return jsonResponse({ event: row });
}

// DELETE /api/events/:id —— 僅 superadmin
export async function onRequestDelete({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  const r = await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(params.id).run();
  if ((r.meta?.changes || 0) === 0) return jsonError('找不到活動', 404);
  return jsonResponse({ success: true });
}
