// GET    /api/resources/:id             — 取得資源詳情（含標籤）
// GET    /api/resources/:id?action=download — 串流 R2 檔案 或 重新導向外部連結
// PUT    /api/resources/:id             — 更新標題/說明/類型/標籤
// DELETE /api/resources/:id             — 刪除資源（含 R2 清理）
import { getUserCode, canManageEvent, jsonResponse, jsonError } from '../_auth.js';

async function getResource(env, id) {
  return env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(id).first();
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function onRequestGet({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const resource = await getResource(env, params.id);
  if (!resource) return jsonError('找不到資源', 404);

  const url = new URL(request.url);

  // ── 下載模式 ─────────────────────────────────────────────────────────────
  if (url.searchParams.get('action') === 'download') {
    if (resource.storage_type === 'link') {
      return Response.redirect(resource.url, 302);
    }
    // R2 串流
    const obj = await env.RESOURCES.get(resource.r2_key);
    if (!obj) return jsonError('R2 檔案不存在', 404);

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    const encodedName = encodeURIComponent(resource.file_name || 'download');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    if (resource.file_size) headers.set('Content-Length', String(resource.file_size));
    headers.set('Cache-Control', 'private, max-age=300');

    return new Response(obj.body, { headers });
  }

  // ── 詳情模式 ─────────────────────────────────────────────────────────────
  const { results: tagRows } = await env.DB.prepare(
    `SELECT t.* FROM tags t
     JOIN tag_relations tr ON tr.tag_id = t.id
     WHERE tr.target_type = 'resource' AND tr.target_id = ?
     ORDER BY t.category, t.sort_order`
  ).bind(params.id).all();

  return jsonResponse({ resource: { ...resource, tags: tagRows || [] } });
}

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function onRequestPut({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const resource = await getResource(env, params.id);
  if (!resource) return jsonError('找不到資源', 404);

  if (!(await canManageEvent(env, userCode, resource.event_id))) {
    return jsonError('無權管理此資源', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { title, description, resource_type, tags } = body;

  const updates = [];
  const binds = [];

  if (title !== undefined) {
    if (!title.trim()) return jsonError('title 不可為空', 400);
    updates.push('title = ?'); binds.push(title.trim());
  }
  if (description !== undefined) {
    updates.push('description = ?'); binds.push(description?.trim() || null);
  }
  if (resource_type !== undefined) {
    if (!['article', 'slide', 'video', 'other'].includes(resource_type)) {
      return jsonError('無效的 resource_type', 400);
    }
    updates.push('resource_type = ?'); binds.push(resource_type);
  }

  if (updates.length > 0) {
    binds.push(params.id);
    await env.DB.prepare(`UPDATE resources SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  // 更新標籤
  if (Array.isArray(tags)) {
    await env.DB.prepare(
      `DELETE FROM tag_relations WHERE target_type = 'resource' AND target_id = ?`
    ).bind(params.id).run();
    for (const tagId of tags) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO tag_relations (target_type, target_id, tag_id) VALUES ('resource', ?, ?)`
      ).bind(params.id, tagId).run().catch(() => {});
    }
  }

  const row = await env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(params.id).first();
  return jsonResponse({ resource: row });
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function onRequestDelete({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const resource = await getResource(env, params.id);
  if (!resource) return jsonError('找不到資源', 404);

  if (!(await canManageEvent(env, userCode, resource.event_id))) {
    return jsonError('無權刪除此資源', 403);
  }

  // 先刪 R2（若有）
  if (resource.storage_type === 'r2' && resource.r2_key) {
    await env.RESOURCES.delete(resource.r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM resources WHERE id = ?').bind(params.id).run();
  return jsonResponse({ success: true });
}
