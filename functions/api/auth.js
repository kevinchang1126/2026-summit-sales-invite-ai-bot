// POST /api/auth — 讀取 Teams token 並轉發驗證
import { getUserRole } from './_auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const { token } = await request.json();
    if (!token) {
      return jsonResponse({ error: '缺少 token' }, 400);
    }

    // 發送請求至 AIEP API
    const authRes = await fetch('https://aiep.digiwin.com/aiep/webapi/api/identitycheck', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    const bodyText = await authRes.text();
    let authData;
    try {
      authData = JSON.parse(bodyText);
    } catch {
      return jsonResponse({ error: '整合平台回傳格式錯誤', details: bodyText }, 500);
    }

    if (authData.Success === false) {
      return jsonResponse({ error: authData.ErrorMsg || 'Token 驗證失敗', code: authData.ErrorCode }, 401);
    }

    const userData = authData.Data;
    if (!userData || !userData.UserCode) {
      return jsonResponse({ error: '驗證成功，但找不到使用者資訊' }, 500);
    }

    // 檢查資料庫是否有此使用者
    const dbUser = await env.DB.prepare('SELECT * FROM users WHERE user_code = ?').bind(userData.UserCode).first();

    let finalNickname = userData.UserName;
    let customNickname = null;

    if (!dbUser) {
      // 第一次登入，建立使用者
      await env.DB.prepare('INSERT INTO users (user_code, ad_name) VALUES (?, ?)')
        .bind(userData.UserCode, userData.UserName)
        .run();
    } else {
      if (dbUser.custom_nickname) {
        customNickname = dbUser.custom_nickname;
        finalNickname = customNickname; // 預設使用自訂暱稱
      }
    }

    // 取得角色（同時會自動 bootstrap 初始 superadmin）
    const roleInfo = await getUserRole(env, userData.UserCode);

    return jsonResponse({
      ...userData,
      custom_nickname: customNickname,
      display_name: finalNickname,
      role: roleInfo?.role || null,
      managed_event_ids: roleInfo?.managedEventIds || []
    });
  } catch (err) {
    return jsonResponse({ error: '伺服器內部錯誤：' + err.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
