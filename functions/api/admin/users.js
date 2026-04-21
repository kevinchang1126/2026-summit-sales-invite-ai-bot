// GET /api/admin/users?q=xxx —— 搜尋使用者（給指派角色時挑人用）
import { getUserCode, isSuperadmin, jsonResponse, jsonError } from '../_auth.js';

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  let sql = `SELECT u.user_code, u.ad_name, u.custom_nickname, ur.role
             FROM users u
             LEFT JOIN user_roles ur ON ur.user_code = u.user_code`;
  const binds = [];
  if (q) {
    sql += ' WHERE u.user_code LIKE ? OR u.ad_name LIKE ? OR u.custom_nickname LIKE ?';
    const pat = `%${q}%`;
    binds.push(pat, pat, pat);
  }
  sql += ' ORDER BY u.ad_name LIMIT 50';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return jsonResponse({ users: results || [] });
}
