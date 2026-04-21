// GET /api/me —— 回傳當前使用者角色，供前端判斷是否顯示後台入口
import { getUserCode, getUserRole, jsonResponse, jsonError } from './_auth.js';

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未登入', 401);

  const roleInfo = await getUserRole(env, userCode);
  return jsonResponse({
    user_code: userCode,
    role: roleInfo?.role || null,
    managed_event_ids: roleInfo?.managedEventIds || [],
  });
}
