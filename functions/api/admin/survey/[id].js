// DELETE /api/admin/survey/:id  → 刪除問卷記錄（及其 bulk_generated 說帖）
// PUT    /api/admin/survey/:id  → 更新可編輯欄位
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../../_auth.js';

export async function onRequestDelete({ request, env, params }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') return jsonError('需要 superadmin 權限', 403);

  const id = parseInt(params.id, 10);
  if (!id) return jsonError('無效 ID', 400);

  try {
    const rec = await env.DB.prepare('SELECT customer_code FROM survey_responses WHERE id=?').bind(id).first();
    if (!rec) return jsonError('記錄不存在', 404);

    if (rec.customer_code) {
      await env.DB.prepare(`DELETE FROM pitches WHERE customer_code=? AND pitch_type='bulk_generated'`)
        .bind(rec.customer_code).run();
    }
    await env.DB.prepare('DELETE FROM survey_responses WHERE id=?').bind(id).run();
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonError('刪除失敗：' + e.message, 500);
  }
}

export async function onRequestPut({ request, env, params }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') return jsonError('需要 superadmin 權限', 403);

  const id = parseInt(params.id, 10);
  if (!id) return jsonError('無效 ID', 400);

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('無效請求', 400);

  const { attended, has_survey, contact_name, job_title } = body;

  try {
    await env.DB.prepare(
      `UPDATE survey_responses SET attended=?, has_survey=?, contact_name=?, job_title=? WHERE id=?`
    ).bind(attended ? 1 : 0, has_survey ? 1 : 0, contact_name || '', job_title || '', id).run();
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonError('更新失敗：' + e.message, 500);
  }
}
