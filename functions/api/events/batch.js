// POST /api/events/batch —— 一次建立系列 + 多場次（豁免逐筆限流）
// body: {
//   series: { name, description, status },
//   sessions: [{ id, name, event_date, event_time, location, description, target_audience }, ...]
// }
// 注意：每個 session 的 id（活動專案代號）為必填，格式 YYYYMM+4碼
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../_auth.js';
import { EVENT_ID_REGEX } from './index.js';

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { series: seriesData, sessions } = body;
  if (!seriesData?.name) return jsonError('缺少 series.name', 400);
  if (!Array.isArray(sessions) || sessions.length === 0) return jsonError('sessions 不可為空', 400);

  // ── 前置驗證：所有 session 必須有合法 ID 才開始寫入 ────────────────────
  const idsSeen = new Set();
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const label = `場次 ${i + 1}（${s.name?.slice(0, 15) ?? ''}）`;
    if (!s.id)                      return jsonError(`${label} 缺少活動專案代號`, 400);
    if (!EVENT_ID_REGEX.test(s.id)) return jsonError(`${label} 專案代號格式錯誤（應為 YYYYMM+4碼，如 2026040001）`, 400);
    if (idsSeen.has(s.id))          return jsonError(`${label} 專案代號 ${s.id} 與其他場次重複`, 400);
    idsSeen.add(s.id);
    if (!s.name)       return jsonError(`${label} 缺少 name`, 400);
    if (!s.event_date) return jsonError(`${label} 缺少 event_date`, 400);
  }

  // ── 1. 建立系列 ──────────────────────────────────────────────────────────
  const seriesId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_series (id, name, description, status, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(seriesId, seriesData.name, seriesData.description || null, seriesData.status || 'active', userCode).run();

  // ── 2. 批次建立場次 ───────────────────────────────────────────────────────
  const createdEvents = [];
  const sharedTa = sessions.find(s => s.target_audience)?.target_audience;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const sessionTa = s.target_audience
      ? JSON.stringify(s.target_audience)
      : (sharedTa ? JSON.stringify(sharedTa) : null);

    try {
      await env.DB.prepare(
        `INSERT INTO events (id, name, description, target_audience, event_date, event_time,
                             location, series_id, series_order, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`
      ).bind(
        s.id, s.name, s.description || null, sessionTa,
        s.event_date, s.event_time || null, s.location || null,
        seriesId, i + 1, userCode
      ).run();

      // eventadmin 自動成為管理者
      if (roleInfo.role === 'eventadmin') {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO event_admins (user_code, event_id, granted_by) VALUES (?, ?, 'self:create')`
        ).bind(userCode, s.id).run();
      }

      createdEvents.push({ id: s.id, name: s.name, event_date: s.event_date });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return jsonError(`活動專案代號 ${s.id} 已存在，請確認後重試`, 409);
      }
      throw e;
    }
  }

  const seriesRow = await env.DB.prepare('SELECT * FROM event_series WHERE id = ?').bind(seriesId).first();
  return jsonResponse({ series: seriesRow, events: createdEvents }, 201);
}
