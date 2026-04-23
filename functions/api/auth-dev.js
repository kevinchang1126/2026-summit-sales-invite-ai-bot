// POST /api/auth-dev — 本地開發用模擬登入（繞過 Teams token 驗證）
// ─────────────────────────────────────────────────────────────────────
// Guard 條件（任一成立即可）：
//   1. hostname ∈ { localhost, 127.0.0.1, 0.0.0.0 }
//   2. env.DEV_AUTH_ENABLED === '1'
// 部署到 Cloudflare Pages 後，正式網域 hostname 不符 → 自動 403
// ─────────────────────────────────────────────────────────────────────
import { getUserRole } from './_auth.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(ctx) {
  try {
    return await handleDevAuth(ctx);
  } catch (e) {
    // 把錯誤細節回傳給 Network panel，方便診斷
    return jsonResponse({
      error:   'auth-dev 例外',
      message: e?.message || String(e),
      name:    e?.name || 'Error',
      stack:   e?.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : null,
    }, 500);
  }
}

async function handleDevAuth({ request, env }) {
  // ── Guard ───────────────────────────────────────────────────────────
  const host = new URL(request.url).hostname;
  const isLocal   = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  const isEnabled = env.DEV_AUTH_ENABLED === '1';
  if (!isLocal && !isEnabled) {
    return jsonResponse({ error: '本地開發專用端點；非本地請設定 DEV_AUTH_ENABLED=1' }, 403);
  }

  // ── 必備綁定檢查（最容易漏掉的點）──────────────────────────────────
  if (!env.DB) {
    return jsonResponse({
      error: 'env.DB binding 不存在；請確認 wrangler.toml 或用 npm run dev 啟動',
    }, 500);
  }

  // ── 解析 body ───────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const userCode = (body.user_code || '').trim();
  const adName   = (body.ad_name   || '').trim() || userCode || 'dev_user';
  if (!userCode) return jsonResponse({ error: 'user_code 必填' }, 400);

  // ── users 表 upsert ─────────────────────────────────────────────────
  const existed = await env.DB
    .prepare('SELECT * FROM users WHERE user_code = ?')
    .bind(userCode).first();

  if (!existed) {
    await env.DB
      .prepare('INSERT INTO users (user_code, ad_name) VALUES (?, ?)')
      .bind(userCode, adName).run();
  }

  const customNickname = existed?.custom_nickname || null;
  const displayName    = customNickname || existed?.ad_name || adName;

  // ── 取角色（會順便 bootstrap INITIAL_SUPERADMINS）──────────────────
  let roleInfo = null;
  try {
    roleInfo = await getUserRole(env, userCode);
  } catch (e) {
    // 角色取失敗不致命，用 null 繼續，但附帶 warning
    return jsonResponse({
      UserCode:          userCode,
      UserName:          existed?.ad_name || adName,
      custom_nickname:   customNickname,
      display_name:      displayName,
      role:              null,
      managed_event_ids: [],
      _dev_mode:         true,
      _warning:          'getUserRole 失敗：' + (e?.message || String(e)),
    });
  }

  return jsonResponse({
    UserCode:          userCode,
    UserName:          existed?.ad_name || adName,
    custom_nickname:   customNickname,
    display_name:      displayName,
    role:              roleInfo?.role || null,
    managed_event_ids: roleInfo?.managedEventIds || [],
    _dev_mode:         true,
  });
}
