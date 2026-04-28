// GET /api/admin/survey/search?q=潛客代號或公司名稱
// GET /api/admin/survey/search?list_generated=1[&q=...] ← 列出預先生成說帖
import { getUserCode, jsonResponse, jsonError } from '../../_auth.js';

export async function onRequestGet({ request, env }) {
  const userCode = getUserCode(request);
  if (!userCode) return jsonError('未授權', 401);

  const url = new URL(request.url);

  // ── 模式 A：列出當前使用者的負責客戶（含預生說帖標記）────────────────────
  if (url.searchParams.get('list_generated') === '1') {
    const q = (url.searchParams.get('q') || '').trim();
    const userDisplayName = url.searchParams.get('user_name') || ''; // 可選傳入姓名加速匹配

    // 從 survey_responses 出發，確保每個客戶都出現，再 LEFT JOIN 最新一筆說帖
    // 包含 bulk_generated（批量生成）與 follow_up（業務手動生成且有 customer_code）
    let sql = `
      SELECT sr.id, sr.customer_code, sr.company_name, sr.contact_name, sr.industry_type,
             sr.signals, sr.attended, sr.has_survey, sr.ac_name, sr.ac_code,
             p.id as pitch_id, p.content as pregenerated_content,
             p.customer_type as tier_label, p.created_at as pitch_created_at
      FROM survey_responses sr
      LEFT JOIN pitches p
        ON p.id = (
          SELECT id FROM pitches
          WHERE customer_code = sr.customer_code
            AND COALESCE(contact_name, '') = COALESCE(sr.contact_name, '')
            AND pitch_type IN ('bulk_generated', 'follow_up')
          ORDER BY id DESC LIMIT 1
        )
      WHERE (sr.ac_code = ? OR sr.ac_name = ?)
    `;
    const binds = [userCode, userCode]; // 這裡假設 userCode 同時可能是工號或姓名，實務上建議傳入正確欄位

    // 若有傳入 user_name 則多加一個綁定
    if (userDisplayName) {
        sql = sql.replace('WHERE (sr.ac_code = ? OR sr.ac_name = ?)', 'WHERE (sr.ac_code = ? OR sr.ac_name = ? OR sr.ac_name = ?)');
        binds.push(userDisplayName);
    }

    if (q.length >= 1) {
      sql += ` AND (sr.customer_code LIKE ? OR sr.company_name LIKE ? OR sr.contact_name LIKE ?)`;
      binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY sr.id DESC LIMIT 300`;

    const result = await env.DB.prepare(sql).bind(...binds).all();

    return jsonResponse({
      results: (result.results || []).map(r => ({
        ...r,
        signals: (() => { try { return JSON.parse(r.signals); } catch { return []; } })(),
      })),
    });
  }

  // ── 模式 B：關鍵字搜尋客戶（同一法人下的所有聯絡人全部回傳）──────────────
  const q = (url.searchParams.get('q') || '').trim();
  if (!q || q.length < 2) return jsonResponse({ results: [] });

  // 先找符合條件的 customer_code（可搜尋所有 AC 的客戶，可能有多筆同公司不同人）
  const surveyResults = await env.DB.prepare(`
    SELECT id, customer_code, company_name, contact_name, job_title, job_function,
           event_date, session_name, attended, has_survey, industry_type, signals,
           ac_code, ac_name
    FROM survey_responses
    WHERE customer_code LIKE ?
       OR company_name LIKE ?
       OR contact_name LIKE ?
    ORDER BY company_name, contact_name
    LIMIT 50
  `).bind(`%${q}%`, `%${q}%`, `%${q}%`).all();

  const rows = surveyResults.results;
  if (rows.length === 0) return jsonResponse({ results: [] });

  // 若搜到某個人，也一起撈出同公司其他聯絡人
  const codes = [...new Set(rows.map(r => r.customer_code))];
  const placeholders = codes.map(() => '?').join(',');

  const allContactsResult = await env.DB.prepare(`
    SELECT id, customer_code, company_name, contact_name, job_title, job_function,
           event_date, session_name, attended, has_survey, industry_type, signals,
           ac_code, ac_name
    FROM survey_responses
    WHERE customer_code IN (${placeholders})
    ORDER BY company_name, contact_name
    LIMIT 100
  `).bind(...codes).all();

  const allRows = allContactsResult.results;

  // 查詢每位聯絡人的說帖（bulk_generated 或業務手動生成的 follow_up）
  const pitchResults = await env.DB.prepare(`
    SELECT customer_code, contact_name, id as pitch_id,
           content as pregenerated_content, created_at as pitch_created_at
    FROM pitches
    WHERE pitch_type IN ('bulk_generated', 'follow_up')
      AND customer_code IN (${placeholders})
    ORDER BY id DESC
  `).bind(...codes).all();

  // 建立 key = customer_code|contact_name → pitch（取最新一筆）
  const pitchMap = {};
  for (const p of pitchResults.results) {
    const key = `${p.customer_code}|${p.contact_name || ''}`;
    if (!pitchMap[key]) {
      pitchMap[key] = {
        pitch_id: p.pitch_id,
        pregenerated_content: p.pregenerated_content,
        pitch_created_at: p.pitch_created_at,
      };
    }
  }

  return jsonResponse({
    results: allRows.map(r => ({
      ...r,
      signals: (() => { try { return JSON.parse(r.signals); } catch { return []; } })(),
      ...(pitchMap[`${r.customer_code}|${r.contact_name || ''}`] || {}),
    })),
  });
}
