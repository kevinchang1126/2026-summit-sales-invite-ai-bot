// GET /api/pitches — 取得排行榜或歷史記錄
// 支援篩選條件: ?sort=top|latest&limit=10&offset=0&industry=xxx&role=xxx&channel=xxx
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort') || 'top';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const industry = url.searchParams.get('industry');
  const role = url.searchParams.get('role');
  const channel = url.searchParams.get('channel');
  const userCode = url.searchParams.get('user_code');

  let orderBy = 'likes DESC, created_at DESC';
  if (sort === 'latest') {
    orderBy = 'created_at DESC';
  }

  let conditions = [];
  let params = [];

  if (industry) {
    conditions.push('industry = ?');
    params.push(industry);
  }
  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }
  if (channel) {
    conditions.push('channel = ?');
    params.push(channel);
  }
  if (userCode) {
    conditions.push('user_code = ?');
    params.push(userCode);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const query = `
    SELECT id, industry, role, channel, content, author, likes, dislikes, created_at
    FROM pitches ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `;
  const { results } = await env.DB.prepare(query).bind(...params, limit, offset).all();

  const countQuery = `SELECT COUNT(*) as total FROM pitches ${whereClause}`;
  const { results: countResult } = await env.DB.prepare(countQuery).bind(...params).all();

  return new Response(JSON.stringify({
    pitches: results,
    total: countResult[0].total,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
