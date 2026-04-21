// POST /api/events/batch —— 一次建立系列 + 多場次（豁免逐筆限流）
// body: { series: { name, description, status }, sessions: [{ name, event_date, ... }] }
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../_auth.js';
import { generateNextEventId } from './index.js';

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { series: seriesData, sessions } = body;
  if (!seriesData?.name)       return jsonError('缺少 series.name', 400);
  if (!Array.isArray(sessions) || sessions.length === 0) return jsonError('sessions 不可為空', 400);

  // ── 1. 建立系列 ──────────────────────────────────────────────────────────
  const seriesId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_series (id, name, description, status, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(seriesId, seriesData.name, seriesData.description || null, seriesData.status || 'active', userCode).run();

  // ── 2. 批次建立場次（收集同月份計數，避免 ID 碰撞）────────────────────
  // 先算出每個月份的起始 offset
  const monthOffsets = {}; // { '202604': 0, '202605': 0, ... }

  // 預先查出各月最大序號
  const monthsNeeded = [...new Set(sessions.map(s => (s.event_date || '').slice(0, 7).replace('-', '')))];
  for (const ym of monthsNeeded) {
    if (!ym || ym.length !== 6) continue;
    const row = await env.DB.prepare(
      `SELECT MAX(CAST(SUBSTR(id, 7) AS INTEGER)) AS max_seq
       FROM events WHERE id LIKE ? AND LENGTH(id) = 10`
    ).bind(ym + '%').first();
    monthOffsets[ym] = row?.max_seq ?? 0;
  }

  const createdEvents = [];
  const taJson = sessions[0]?.target_audience
    ? JSON.stringify(sessions[0].target_audience)
    : null;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (!s.name || !s.event_date) continue;

    // 計算此場次的 ID
    const ym = s.event_date.slice(0, 7).replace('-', '');
    monthOffsets[ym] = (monthOffsets[ym] ?? 0) + 1;
    const seq = monthOffsets[ym];
    if (seq > 9999) { continue; } // 超限跳過
    const eventId = ym + String(seq).padStart(4, '0');

    const sessionTa = s.target_audience
      ? JSON.stringify(s.target_audience)
      : taJson;

    try {
      await env.DB.prepare(
        `INSERT INTO events (id, name, description, target_audience, event_date, event_time,
                             location, series_id, series_order, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`
      ).bind(
        eventId, s.name, s.description || null, sessionTa,
        s.event_date, s.event_time || null, s.location || null,
        seriesId, i + 1, userCode
      ).run();

      // eventadmin 自動成為管理者
      if (roleInfo.role === 'eventadmin') {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO event_admins (user_code, event_id, granted_by) VALUES (?, ?, 'self:create')`
        ).bind(userCode, eventId).run();
      }

      createdEvents.push({ id: eventId, name: s.name, event_date: s.event_date });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) continue; // ID 碰撞跳過（不常見）
      throw e;
    }
  }

  const seriesRow = await env.DB.prepare('SELECT * FROM event_series WHERE id = ?').bind(seriesId).first();
  return jsonResponse({ series: seriesRow, events: createdEvents }, 201);
}
