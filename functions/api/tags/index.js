// GET /api/tags?category=:cat — 取得標籤清單（所有登入用戶可讀）
import { getUserCode, jsonResponse, jsonError } from '../_auth.js';

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const url = new URL(request.url);
  const category = url.searchParams.get('category');

  let sql = 'SELECT * FROM tags';
  const binds = [];
  if (category) {
    sql += ' WHERE category = ?';
    binds.push(category);
  }
  sql += ' ORDER BY category, sort_order, name';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  const tags = results || [];

  // 依 category 分組，方便前端直接使用
  const grouped = {};
  for (const tag of tags) {
    if (!grouped[tag.category]) grouped[tag.category] = [];
    grouped[tag.category].push(tag);
  }

  return jsonResponse({ tags, grouped });
}
