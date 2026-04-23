// POST /api/events/batch —— 一次建立系列 + 多場次（豁免逐筆限流）
// body: {
//   series: { name, description, status, project_code },
//   sessions: [{ session_code, name, event_date, event_time, location, description, target_audience }, ...]
// }
// 注意：
//   • series.project_code 為必填（YYYYMM+4碼），由外部系統指派
//   • 每個 session 以 session_code（地點代號）識別，events.id 由系統自動產生（UUID）
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../_auth.js';
import { SESSION_CODE_RE, EVENT_ID_REGEX } from './index.js';

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || !['superadmin', 'eventadmin'].includes(roleInfo.role)) {
    return jsonError('需要 superadmin 或 eventadmin 權限', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('JSON 格式錯誤', 400); }

  const { series: seriesData, sessions } = body;
  if (!seriesData?.name)         return jsonError('缺少 series.name', 400);
  if (!seriesData?.project_code) return jsonError('缺少 series.project_code（活動專案代號，格式 YYYYMM+4碼）', 400);
  if (!EVENT_ID_REGEX.test(seriesData.project_code)) {
    return jsonError('series.project_code 格式錯誤（應為 YYYYMM+4碼，如 2026040001）', 400);
  }
  if (!Array.isArray(sessions) || sessions.length === 0) return jsonError('sessions 不可為空', 400);

  // ── 前置驗證：所有 session 必須有合法 session_code 才開始寫入 ──────────────
  const codesSeen = new Set();
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const label = `場次 ${i + 1}（${s.name?.slice(0, 15) ?? ''}）`;
    if (!s.session_code) return jsonError(`${label} 缺少場次代號（session_code）`, 400);
    const sc = String(s.session_code).toUpperCase();
    if (!SESSION_CODE_RE.test(sc)) {
      return jsonError(`${label} 場次代號格式錯誤（範例：台北 02/02A，線上 999A，OT 序列 OT01，泰國 TH）`, 400);
    }
    if (codesSeen.has(sc)) return jsonError(`${label} 場次代號 ${sc} 與其他場次重複`, 400);
    codesSeen.add(sc);
    if (!s.name)       return jsonError(`${label} 缺少 name`, 400);
    if (!s.event_date) return jsonError(`${label} 缺少 event_date`, 400);
  }

  // ── 1. 建立系列 ──────────────────────────────────────────────────────────
  const seriesId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO event_series (id, name, description, status, project_code, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(seriesId, seriesData.name, seriesData.description || null,
           seriesData.status || 'active', seriesData.project_code, userCode).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return jsonError(`活動專案代號 ${seriesData.project_code} 已存在，請確認後重試`, 409);
    }
    throw e;
  }

  // ── 2. 批次建立場次 ───────────────────────────────────────────────────────
  const createdEvents = [];
  const sharedTa = sessions.find(s => s.target_audience)?.target_audience;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const sc = String(s.session_code).toUpperCase();
    const sessionTa = s.target_audience
      ? JSON.stringify(s.target_audience)
      : (sharedTa ? JSON.stringify(sharedTa) : null);
    const eventId = crypto.randomUUID();

    try {
      await env.DB.prepare(
        `INSERT INTO events (id, name, description, target_audience, event_date, event_time,
                             location, series_id, series_order, session_code, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`
      ).bind(
        eventId, s.name, s.description || null, sessionTa,
        s.event_date, s.event_time || null, s.location || null,
        seriesId, i + 1, sc, userCode
      ).run();

      // eventadmin 自動成為管理者
      if (roleInfo.role === 'eventadmin') {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO event_admins (user_code, event_id, granted_by) VALUES (?, ?, 'self:create')`
        ).bind(userCode, eventId).run();
      }

      createdEvents.push({ id: eventId, name: s.name, event_date: s.event_date, session_code: sc });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return jsonError(`場次代號 ${sc} 在此系列中已存在，請確認後重試`, 409);
      }
      throw e;
    }
  }

  const seriesRow = await env.DB.prepare('SELECT * FROM event_series WHERE id = ?').bind(seriesId).first();
  return jsonResponse({ series: seriesRow, events: createdEvents }, 201);
}
