// PUT /api/admin/tags/:id    — 更新標籤名稱/排序（superadmin）
// DELETE /api/admin/tags/:id — 刪除標籤（superadmin，會連動刪除 tag_relations）
import { getUserCode, isSuperadmin, jsonResponse, jsonError } from '../../_auth.js';

export async function onRequestPut({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  const tag = await env.DB.prepare('SELECT 1 FROM tags WHERE id = ?').bind(params.id).first();
  if (!tag) return jsonError('找不到標籤', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { name, sort_order } = body;
  const updates = [];
  const binds = [];
  if (name !== undefined)       { updates.push('name = ?');       binds.push(name.trim()); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); binds.push(sort_order); }

  if (updates.length === 0) return jsonError('沒有可更新的欄位', 400);

  binds.push(params.id);
  try {
    await env.DB.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return jsonError('此標籤名稱在該分類已存在', 409);
    throw e;
  }

  const updated = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(params.id).first();
  return jsonResponse({ tag: updated });
}

export async function onRequestDelete({ request, env, params }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  const meta = await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(params.id).run();
  if ((meta.meta?.changes ?? 0) === 0) return jsonError('找不到標籤', 404);

  return jsonResponse({ success: true });
}
