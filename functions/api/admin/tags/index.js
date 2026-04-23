// GET /api/admin/tags  — 管理用標籤列表（superadmin）
// POST /api/admin/tags — 新增標籤（superadmin）
import { getUserCode, isSuperadmin, jsonResponse, jsonError } from '../../_auth.js';

const VALID_CATEGORIES = [
  'industry', 'role', 'channel', 'scale',
  'customer_type', 'session_pref', 'resource_type', 'custom',
];

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  const { results } = await env.DB.prepare(
    'SELECT * FROM tags ORDER BY category, sort_order, name'
  ).all();
  return jsonResponse({ tags: results || [] });
}

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { category, name, sort_order } = body;
  if (!category) return jsonError('缺少 category', 400);
  if (!name)     return jsonError('缺少 name', 400);
  if (!VALID_CATEGORIES.includes(category)) return jsonError(`無效的 category（可用：${VALID_CATEGORIES.join('/')}）`, 400);

  const tagId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      'INSERT INTO tags (id, category, name, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(tagId, category, name.trim(), sort_order ?? 0).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return jsonError(`標籤「${name}」在此分類已存在`, 409);
    throw e;
  }

  const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(tagId).first();
  return jsonResponse({ tag }, 201);
}
