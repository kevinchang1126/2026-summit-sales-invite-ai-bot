// 權限中介層：共用的身份與角色檢查工具
// 目前沒有 session token 機制，前端以 header `X-User-Code` 帶入 Teams 驗證後取得的 user_code
// 之後若導入 JWT / session 可從此模組單點替換

/**
 * 從 request 取出 user_code
 */
export function getUserCode(request) {
  return request.headers.get('X-User-Code') || null;
}

/**
 * 確保初始 superadmin 已寫入 user_roles
 * 首次呼叫任何受保護 API 時觸發，效能影響極小（單筆 upsert）
 */
let bootstrapped = false;
export async function ensureSuperadminBootstrap(env) {
  if (bootstrapped) return;
  const raw = env.INITIAL_SUPERADMINS || '';
  const codes = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const code of codes) {
    await env.DB.prepare(
      `INSERT INTO user_roles (user_code, role, granted_by)
       VALUES (?, 'superadmin', 'system:bootstrap')
       ON CONFLICT(user_code) DO UPDATE SET role='superadmin'`
    ).bind(code).run();
  }
  bootstrapped = true;
}

/**
 * 取得使用者角色資訊
 * 回傳 { role, managedEventIds } | null
 */
export async function getUserRole(env, userCode) {
  if (!userCode) return null;
  await ensureSuperadminBootstrap(env);

  const row = await env.DB.prepare(
    'SELECT role FROM user_roles WHERE user_code = ?'
  ).bind(userCode).first();
  if (!row) return null;

  let managedEventIds = [];
  if (row.role === 'eventadmin') {
    const rs = await env.DB.prepare(
      'SELECT event_id FROM event_admins WHERE user_code = ?'
    ).bind(userCode).all();
    managedEventIds = (rs.results || []).map(r => r.event_id);
  }
  return { role: row.role, managedEventIds };
}

/**
 * 檢查是否為 superadmin
 */
export async function isSuperadmin(env, userCode) {
  const r = await getUserRole(env, userCode);
  return r?.role === 'superadmin';
}

/**
 * 檢查是否有權限管理某活動（superadmin 或該活動的 eventadmin）
 */
export async function canManageEvent(env, userCode, eventId) {
  const r = await getUserRole(env, userCode);
  if (!r) return false;
  if (r.role === 'superadmin') return true;
  return r.role === 'eventadmin' && r.managedEventIds.includes(eventId);
}

/**
 * 包裝器：要求 superadmin
 */
export function requireSuperadmin(handler) {
  return async (ctx) => {
    const code = getUserCode(ctx.request);
    if (!(await isSuperadmin(ctx.env, code))) {
      return jsonError('需要 superadmin 權限', 403);
    }
    return handler(ctx);
  };
}

/**
 * 包裝器：要求可管理指定 event（從 URL params.id 取 event_id）
 */
export function requireEventManager(handler) {
  return async (ctx) => {
    const code = getUserCode(ctx.request);
    const eventId = ctx.params?.id || ctx.params?.eventId;
    if (!eventId) return jsonError('缺少 event_id', 400);
    if (!(await canManageEvent(ctx.env, code, eventId))) {
      return jsonError('無權管理此活動', 403);
    }
    return handler(ctx);
  };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, status);
}
