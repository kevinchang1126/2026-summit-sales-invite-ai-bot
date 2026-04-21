// Rate limiting middleware — 基於 cookie + IP 的限流
// 公開端點每分鐘最多 30 次；已有 auth 的管理端點豁免（endpoint 本身已驗權）

const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 30;    // requests per window（公開端點用）

// 需要 admin 驗證的端點，已在 handler 內部驗權，不需額外限流
const ADMIN_PATH_PREFIXES = [
  '/api/events',   // 需要 eventadmin/superadmin
  '/api/admin',    // 需要 superadmin
];

export async function onRequest(context) {
  const { request, env, next } = context;

  // 只對 POST 請求做限流
  if (request.method !== 'POST') {
    return next();
  }

  // 管理端點豁免——已在 handler 內做身份驗證
  const url = new URL(request.url);
  if (ADMIN_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
    return next();
  }

  // 識別使用者：優先用 cookie，沒有的話用 IP + UA 組合
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/sid=([^;]+)/);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const ua = request.headers.get('User-Agent') || '';
  const clientId = match ? match[1] : `ip_${ip}_${simpleHash(ua)}`;

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW;

  try {
    // 清理過期記錄 + 計數，合併為一次查詢
    await env.DB.prepare(
      'DELETE FROM rate_limits WHERE timestamp < ?'
    ).bind(windowStart).run();

    const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM rate_limits WHERE client_id = ? AND timestamp >= ?'
    ).bind(clientId, windowStart).first();

    if (countResult && countResult.cnt >= RATE_LIMIT_MAX) {
      return new Response(JSON.stringify({
        error: '請求太頻繁，請稍後再試（每分鐘最多 10 次）'
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(RATE_LIMIT_WINDOW),
        },
      });
    }

    // 記錄本次請求
    await env.DB.prepare(
      'INSERT INTO rate_limits (client_id, timestamp) VALUES (?, ?)'
    ).bind(clientId, now).run();

  } catch (e) {
    // 限流失敗不阻擋請求
    console.error('Rate limit error:', e);
  }

  // 繼續處理請求
  const response = await next();

  // 如果還沒有 sid cookie，設定一個
  if (!match) {
    const newSid = 'sid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', `sid=${newSid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  return response;
}

// 簡易 hash，用於將 User-Agent 轉為短字串
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
