// PUT /api/user/nickname — 處理更換暱稱請求 (7天冷卻期)
export async function onRequestPut({ request, env }) {
  try {
    const { user_code, new_nickname } = await request.json();

    if (!user_code || !new_nickname) {
      return jsonResponse({ error: '缺少必填欄位 (user_code, new_nickname)' }, 400);
    }

    if (new_nickname.length > 20) {
      return jsonResponse({ error: '暱稱長度不可超過 20 字元' }, 400);
    }

    const dbUser = await env.DB.prepare('SELECT last_nickname_update FROM users WHERE user_code = ?').bind(user_code).first();

    if (!dbUser) {
      return jsonResponse({ error: '查無此使用者，請重新登入' }, 404);
    }

    // 檢查 7 天限制
    if (dbUser.last_nickname_update) {
      const lastUpdate = new Date(dbUser.last_nickname_update);
      const now = new Date();
      const diffMs = now.getTime() - lastUpdate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays < 7) {
        const nextAllowedDate = new Date(lastUpdate.getTime() + 7 * 24 * 60 * 60 * 1000);
        return jsonResponse({ 
          error: `距離上次修改未滿 7 天！下次可修改時間：${formatDate(nextAllowedDate)}`,
          next_allowed: nextAllowedDate.toISOString()
        }, 403);
      }
    }

    // 可以更新
    await env.DB.prepare('UPDATE users SET custom_nickname = ?, last_nickname_update = datetime("now") WHERE user_code = ?')
      .bind(new_nickname, user_code)
      .run();

    return jsonResponse({ success: true, custom_nickname: new_nickname });
  } catch (err) {
    return jsonResponse({ error: '伺服器內部錯誤：' + err.message }, 500);
  }
}

function formatDate(d) {
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
