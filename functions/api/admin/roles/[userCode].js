// DELETE /api/admin/roles/:userCode —— 撤銷角色（superadmin）
import { getUserCode, isSuperadmin, jsonResponse, jsonError } from '../../_auth.js';

export async function onRequestDelete({ request, env, params }) {
  const operator = getUserCode(request);
  if (!(await isSuperadmin(env, operator))) return jsonError('需要 superadmin 權限', 403);

  const target = params.userCode;
  if (target === operator) return jsonError('不能撤銷自己的角色', 400);

  await env.DB.prepare('DELETE FROM event_admins WHERE user_code = ?').bind(target).run();
  const r = await env.DB.prepare('DELETE FROM user_roles WHERE user_code = ?').bind(target).run();

  if ((r.meta?.changes || 0) === 0) return jsonError('此使用者沒有角色紀錄', 404);
  return jsonResponse({ success: true });
}
