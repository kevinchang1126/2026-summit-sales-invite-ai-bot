// GET /api/resources?event_id=:id&type=:type — 列出活動下的資源（所有登入用戶）
// POST /api/resources                         — 新增資源（eventadmin 或 superadmin）
//   multipart/form-data  → 檔案上傳至 R2
//   application/json     → 外部連結
import { getUserCode, canManageEvent, jsonResponse, jsonError } from '../_auth.js';

// ── 工具函式 ──────────────────────────────────────────────────────────────────
function parseTags(raw) {
  if (!raw) return [];
  return raw.split(',').map(t => {
    const parts = t.split('::');
    return parts.length === 3 ? { id: parts[0], category: parts[1], name: parts[2] } : null;
  }).filter(Boolean);
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const url = new URL(request.url);
  const eventId      = url.searchParams.get('event_id');
  const resourceType = url.searchParams.get('type');

  let sql = `
    SELECT r.*,
           e.name AS event_name,
           GROUP_CONCAT(t.id || '::' || t.category || '::' || t.name) AS tags_raw
    FROM resources r
    LEFT JOIN events e ON e.id = r.event_id
    LEFT JOIN tag_relations tr ON tr.target_type = 'resource' AND tr.target_id = r.id
    LEFT JOIN tags t ON t.id = tr.tag_id
  `;
  const binds = [];
  const conditions = [];

  if (eventId) {
    conditions.push('r.event_id = ?');
    binds.push(eventId);
  }
  if (resourceType) {
    conditions.push('r.resource_type = ?');
    binds.push(resourceType);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' GROUP BY r.id ORDER BY r.created_at DESC';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();

  const resources = (results || []).map(r => ({
    ...r,
    tags:     parseTags(r.tags_raw),
    tags_raw: undefined,
  }));

  return jsonResponse({ resources });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const contentType = request.headers.get('Content-Type') || '';
  let event_id, title, description, resource_type, storage_type, resourceUrl, tagIds;
  let fileBuffer, fileName, fileSize, mimeType;

  if (contentType.includes('multipart/form-data')) {
    // ── 檔案上傳 ─────────────────────────────────────────────────────────────
    let formData;
    try { formData = await request.formData(); } catch { return jsonError('multipart 解析失敗', 400); }

    event_id      = formData.get('event_id') || '';
    title         = formData.get('title') || '';
    description   = formData.get('description') || '';
    resource_type = formData.get('resource_type') || '';
    storage_type  = 'r2';
    const rawTags = formData.get('tags') || '';
    tagIds = rawTags ? rawTags.split(',').filter(Boolean) : [];

    const file = formData.get('file');
    if (!file || !(file instanceof File)) return jsonError('缺少檔案', 400);
    fileName   = file.name;
    fileSize   = file.size;
    mimeType   = file.type || 'application/octet-stream';
    fileBuffer = await file.arrayBuffer();

    // 檔案大小檢查
    const maxSize = parseInt(env.MAX_UPLOAD_SIZE || '15728640', 10);
    if (fileSize > maxSize) {
      return jsonError(`檔案超過 ${Math.round(maxSize / 1024 / 1024)} MB 上限`, 413);
    }
  } else {
    // ── 外部連結（JSON body）──────────────────────────────────────────────────
    let body;
    try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }
    ({ event_id, title, description, resource_type, storage_type = 'link' } = body);
    resourceUrl = body.url;
    tagIds = Array.isArray(body.tags) ? body.tags : [];
  }

  // ── 必填欄位驗證 ──────────────────────────────────────────────────────────
  if (!event_id)      return jsonError('缺少 event_id', 400);
  if (!title)         return jsonError('缺少 title', 400);
  if (!resource_type) return jsonError('缺少 resource_type', 400);
  if (!['article', 'slide', 'video', 'other'].includes(resource_type)) {
    return jsonError('無效的 resource_type（article/slide/video/other）', 400);
  }
  if (!['link', 'r2'].includes(storage_type)) {
    return jsonError('無效的 storage_type（link/r2）', 400);
  }
  if (storage_type === 'link' && !resourceUrl) return jsonError('連結資源需提供 url', 400);

  // ── 權限檢查 ──────────────────────────────────────────────────────────────
  if (!(await canManageEvent(env, userCode, event_id))) {
    return jsonError('無權為此活動上傳資源', 403);
  }

  // ── 活動存在驗證 ──────────────────────────────────────────────────────────
  const eventRow = await env.DB.prepare('SELECT 1 FROM events WHERE id = ?').bind(event_id).first();
  if (!eventRow) return jsonError('活動不存在', 404);

  const resourceId = crypto.randomUUID();
  let r2Key = null;

  // ── R2 上傳 ───────────────────────────────────────────────────────────────
  if (storage_type === 'r2') {
    const sanitized = fileName.replace(/[^\w.\-]/g, '_');
    r2Key = `events/${event_id}/resources/${resourceId}/${sanitized}`;
    try {
      await env.RESOURCES.put(r2Key, fileBuffer, {
        httpMetadata: { contentType: mimeType },
      });
    } catch (e) {
      return jsonError('R2 上傳失敗：' + e.message, 500);
    }
  }

  // ── 寫入 D1 ───────────────────────────────────────────────────────────────
  try {
    await env.DB.prepare(
      `INSERT INTO resources
         (id, event_id, title, description, resource_type, storage_type,
          url, r2_key, file_name, file_size, mime_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      resourceId, event_id, title.trim(), description?.trim() || null,
      resource_type, storage_type,
      resourceUrl || null, r2Key,
      fileName || null, fileSize || null, mimeType || null,
      userCode
    ).run();
  } catch (e) {
    // DB 失敗時清理已上傳的 R2 物件
    if (r2Key) await env.RESOURCES.delete(r2Key).catch(() => {});
    throw e;
  }

  // ── 標籤關聯 ─────────────────────────────────────────────────────────────
  for (const tagId of tagIds) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tag_relations (target_type, target_id, tag_id) VALUES ('resource', ?, ?)`
    ).bind(resourceId, tagId).run().catch(() => {});
  }

  const row = await env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(resourceId).first();
  return jsonResponse({ resource: row }, 201);
}
