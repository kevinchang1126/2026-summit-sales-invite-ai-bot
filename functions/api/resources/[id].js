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
  const url = new URL(request.url);
  // preview 端點允許 ?uc= query param 作為 iframe 無法帶 header 的 fallback
  const userCode = getUserCode(request) || (url.searchParams.get('action') === 'preview' ? url.searchParams.get('uc') : null);
  if (!userCode) return jsonError('未登入', 401);

  const resource = await getResource(env, params.id);
  if (!resource) return jsonError('找不到資源', 404);

  // ── 預覽串流模式（inline，供 iframe 使用）────────────────────────────────
  if (url.searchParams.get('action') === 'preview') {
    if (resource.storage_type === 'link') {
      return Response.redirect(resource.url, 302);
    }
    const obj = await env.RESOURCES.get(resource.r2_key);
    if (!obj) return jsonError('R2 檔案不存在', 404);

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    // inline 讓瀏覽器直接顯示而非下載
    headers.set('Content-Disposition', 'inline');
    if (resource.file_size) headers.set('Content-Length', String(resource.file_size));
    headers.set('Cache-Control', 'private, max-age=300');
    // 允許 same-origin iframe 嵌入
    headers.set('X-Frame-Options', 'SAMEORIGIN');

    return new Response(obj.body, { headers });
  }

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

  const contentType = request.headers.get('Content-Type') || '';
  let title, description, resource_type, tags;
  let newFile = null;

  if (contentType.includes('multipart/form-data')) {
    let formData;
    try { formData = await request.formData(); } catch { return jsonError('multipart 解析失敗', 400); }
    title         = formData.get('title') ?? undefined;
    description   = formData.get('description') ?? undefined;
    resource_type = formData.get('resource_type') ?? undefined;
    const rawTags = formData.get('tags');
    tags = rawTags !== null ? rawTags.split(',').filter(Boolean) : undefined;
    const file = formData.get('file');
    if (file instanceof File && file.size > 0) newFile = file;
  } else {
    let body;
    try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }
    ({ title, description, resource_type, tags } = body);
  }

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

  // ── 替換 R2 檔案 ─────────────────────────────────────────────────────────
  if (newFile && resource.storage_type === 'r2') {
    const maxSize = parseInt(env.MAX_UPLOAD_SIZE || '15728640', 10);
    if (newFile.size > maxSize) {
      return jsonError(`檔案超過 ${Math.round(maxSize / 1024 / 1024)} MB 上限`, 413);
    }
    const mimeType   = newFile.type || 'application/octet-stream';
    const sanitized  = newFile.name.replace(/[^\w.\-]/g, '_');
    const newR2Key   = `events/${resource.event_id}/resources/${params.id}/${sanitized}`;
    const fileBuffer = await newFile.arrayBuffer();

    try {
      await env.RESOURCES.put(newR2Key, fileBuffer, { httpMetadata: { contentType: mimeType } });
      if (resource.r2_key && resource.r2_key !== newR2Key) {
        await env.RESOURCES.delete(resource.r2_key).catch(() => {});
      }
    } catch (e) {
      return jsonError('R2 上傳失敗：' + e.message, 500);
    }

    updates.push('r2_key = ?');   binds.push(newR2Key);
    updates.push('file_name = ?'); binds.push(newFile.name);
    updates.push('file_size = ?'); binds.push(newFile.size);
    updates.push('mime_type = ?'); binds.push(mimeType);
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
