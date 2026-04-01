// POST /api/vote — 投票（讚/倒讚）
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { pitch_id, vote_type, voter_id } = await request.json();

    if (!pitch_id || !vote_type || !voter_id) {
      return jsonResponse({ error: '缺少必要參數' }, 400);
    }

    if (!['like', 'dislike'].includes(vote_type)) {
      return jsonResponse({ error: '無效的投票類型' }, 400);
    }

    // 檢查是否已投票
    const existing = await env.DB.prepare(
      'SELECT id, vote_type FROM votes WHERE pitch_id = ? AND voter_id = ?'
    ).bind(pitch_id, voter_id).first();

    if (existing) {
      if (existing.vote_type === vote_type) {
        // 取消投票
        await env.DB.prepare('DELETE FROM votes WHERE id = ?').bind(existing.id).run();
        const col = vote_type === 'like' ? 'likes' : 'dislikes';
        await env.DB.prepare(`UPDATE pitches SET ${col} = ${col} - 1 WHERE id = ?`).bind(pitch_id).run();
        return jsonResponse({ action: 'removed', vote_type });
      } else {
        // 改票
        await env.DB.prepare('UPDATE votes SET vote_type = ? WHERE id = ?').bind(vote_type, existing.id).run();
        const oldCol = existing.vote_type === 'like' ? 'likes' : 'dislikes';
        const newCol = vote_type === 'like' ? 'likes' : 'dislikes';
        await env.DB.prepare(`UPDATE pitches SET ${oldCol} = ${oldCol} - 1, ${newCol} = ${newCol} + 1 WHERE id = ?`).bind(pitch_id).run();
        return jsonResponse({ action: 'changed', vote_type });
      }
    }

    // 新投票
    await env.DB.prepare(
      'INSERT INTO votes (pitch_id, voter_id, vote_type) VALUES (?, ?, ?)'
    ).bind(pitch_id, voter_id, vote_type).run();

    const col = vote_type === 'like' ? 'likes' : 'dislikes';
    await env.DB.prepare(`UPDATE pitches SET ${col} = ${col} + 1 WHERE id = ?`).bind(pitch_id).run();

    return jsonResponse({ action: 'added', vote_type });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: '投票失敗：' + err.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
