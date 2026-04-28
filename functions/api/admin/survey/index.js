// GET /api/admin/survey/import?list=1  ← 列出所有問卷記錄
// GET /api/admin/survey/import?recent=1 ← 最近匯入的記錄（1小時內）
// 用於前台列表顯示和批量生成時取得 ID 列表
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../../_auth.js';

export { onRequestPost } from './import.js';

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') {
    return jsonError('需要 superadmin 權限', 403);
  }

  const url = new URL(request.url);
  const recentMode = url.searchParams.get('recent') === '1';
  const q = (url.searchParams.get('q') || '').trim();
  const industry = url.searchParams.get('industry');
  const location = url.searchParams.get('location');
  const attended = url.searchParams.get('attended');
  const hasSurvey = url.searchParams.get('survey');
  const hasPitch = url.searchParams.get('pitch');
  const sort = url.searchParams.get('sort') || 'imported_at';
  const order = url.searchParams.get('order') || 'DESC';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '300'), 1000);

  let sql = `
    SELECT sr.id, sr.customer_code, sr.company_name, sr.contact_name, sr.job_title, sr.job_function,
           sr.event_date, sr.session_name, sr.attended, sr.has_survey, sr.industry_type, sr.signals, sr.ac_code, sr.ac_name,
           (CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) as has_pitch
    FROM survey_responses sr
    LEFT JOIN pitches p 
      ON p.customer_code = sr.customer_code 
     AND COALESCE(p.contact_name, '') = COALESCE(sr.contact_name, '')
     AND p.pitch_type = 'bulk_generated'
    WHERE 1=1
  `;
  const binds = [];

  if (recentMode) {
    sql += ` AND sr.imported_at >= datetime('now', '-1 hour')`;
  }
  if (q) {
    sql += ` AND (sr.customer_code LIKE ? OR sr.company_name LIKE ? OR sr.contact_name LIKE ?)`;
    const qVal = `%${q}%`;
    binds.push(qVal, qVal, qVal);
  }
  if (industry) {
    sql += ` AND sr.industry_type = ?`;
    binds.push(industry);
  }
  if (location) {
    sql += ` AND sr.session_name LIKE ?`;
    binds.push(`%${location}%`);
  }
  if (attended !== null && attended !== '') {
    sql += ` AND sr.attended = ?`;
    binds.push(parseInt(attended));
  }
  if (hasSurvey !== null && hasSurvey !== '') {
    sql += ` AND sr.has_survey = ?`;
    binds.push(parseInt(hasSurvey));
  }
  if (hasPitch !== null && hasPitch !== '') {
    if (hasPitch === '1') sql += ` AND p.id IS NOT NULL`;
    else sql += ` AND p.id IS NULL`;
  }

  // 排序白名單
  const allowedSort = ['customer_code', 'company_name', 'session_name', 'industry_type', 'attended', 'has_survey', 'has_pitch', 'imported_at'];
  const finalSort = allowedSort.includes(sort) ? (sort === 'has_pitch' ? 'p.id' : `sr.${sort}`) : 'sr.imported_at';
  const finalOrder = order === 'ASC' ? 'ASC' : 'DESC';

  sql += ` ORDER BY ${finalSort} ${finalOrder} LIMIT ?`;
  binds.push(limit);

  try {
    const stmt = env.DB.prepare(sql).bind(...binds);
    const result = await stmt.all();
    return jsonResponse({ results: result.results || [] });
  } catch (e) {
    return jsonError('查詢失敗：' + e.message, 500);
  }
}

// 支援批量刪除
export async function onRequestDelete({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') {
    return jsonError('需要 superadmin 權限', 403);
  }

  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return jsonError('未提供有效的 ID 列表', 400);
    }

    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM survey_responses WHERE id IN (${placeholders})`).bind(...ids).run();

    return jsonResponse({ success: true, count: ids.length });
  } catch (e) {
    return jsonError('刪除失敗：' + e.message, 500);
  }
}
