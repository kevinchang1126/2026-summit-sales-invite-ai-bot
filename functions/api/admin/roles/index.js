// /api/admin/roles —— 角色列表與指派（superadmin only）
import { getUserCode, isSuperadmin, jsonResponse, jsonError } from '../../_auth.js';

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  const { results } = await env.DB.prepare(
    `SELECT ur.user_code, ur.role, ur.granted_by, ur.granted_at,
            u.ad_name, u.custom_nickname
     FROM user_roles ur
     LEFT JOIN users u ON u.user_code = ur.user_code
     ORDER BY ur.role, ur.granted_at DESC`
  ).all();

  const rows = results || [];
  for (const r of rows) {
    if (r.role === 'eventadmin') {
      const { results: evts } = await env.DB.prepare(
        `SELECT ea.event_id, e.name AS event_name
         FROM event_admins ea LEFT JOIN events e ON e.id = ea.event_id
         WHERE ea.user_code = ?`
      ).bind(r.user_code).all();
      r.events = evts || [];
    } else {
      r.events = [];
    }
  }

  return jsonResponse({ roles: rows });
}

// POST /api/admin/roles  body: { user_code, role, event_ids? }
export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  if (!(await isSuperadmin(env, userCode))) return jsonError('需要 superadmin 權限', 403);

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { user_code, role, event_ids } = body;
  if (!user_code || !role) return jsonError('缺少 user_code 或 role', 400);
  if (!['superadmin', 'eventadmin'].includes(role)) {
    return jsonError('role 必須是 superadmin 或 eventadmin', 400);
  }

  const u = await env.DB.prepare('SELECT 1 FROM users WHERE user_code = ?').bind(user_code).first();
  if (!u) return jsonError('此 user_code 尚未登入過系統，請先請他登入一次再指派', 400);

  // eventadmin 可以無 event_ids（之後由 superadmin 補指派，或他自己建立活動自動成為該活動 admin）
  if (role === 'eventadmin' && event_ids !== undefined && !Array.isArray(event_ids)) {
    return jsonError('event_ids 必須是陣列', 400);
  }

  await env.DB.prepare(
    `INSERT INTO user_roles (user_code, role, granted_by) VALUES (?, ?, ?)
     ON CONFLICT(user_code) DO UPDATE
       SET role = excluded.role,
           granted_by = excluded.granted_by,
           granted_at = unixepoch()`
  ).bind(user_code, role, userCode).run();

  if (role === 'eventadmin') {
    // 僅當 caller 有明確傳入 event_ids 才重設範圍；未傳代表「不改現有範圍」
    if (Array.isArray(event_ids)) {
      await env.DB.prepare('DELETE FROM event_admins WHERE user_code = ?').bind(user_code).run();
      for (const eid of event_ids) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO event_admins (user_code, event_id, granted_by) VALUES (?, ?, ?)'
        ).bind(user_code, eid, userCode).run();
      }
    }
  } else {
    await env.DB.prepare('DELETE FROM event_admins WHERE user_code = ?').bind(user_code).run();
  }

  return jsonResponse({ success: true, user_code, role });
}
