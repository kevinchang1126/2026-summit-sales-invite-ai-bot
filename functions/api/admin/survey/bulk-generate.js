// POST /api/admin/survey/bulk-generate
// 批量為已匯入的問卷客戶預先生成回訪說帖（Email 格式）
// 前端傳入 survey_id 陣列 + batch_size 控制速率
import { getUserCode, getUserRole, jsonResponse, jsonError } from '../../_auth.js';
import { buildFollowUpSystemPrompt, SIGNAL_LABELS } from '../../knowledge/followup.js';

const CONTACT_METHOD = 'email'; // 預先生成一律用 Email

function classifyTier(industryCode, signals, attended, has_survey) {
  const s = new Set(signals);
  if (!attended && has_survey === 0 && signals.length === 0) {
    return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_NO_SHOW', secondarySignals: [...signals] };
  }
  if (attended && !has_survey && signals.length === 0) {
    return { tier: 'P3', label: '案例升溫', primaryAnchor: 'BEHAVIOR_ATTENDED_NO_SURVEY', secondarySignals: [] };
  }
  if (signals.length === 0) {
    return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_UNKNOWN', secondarySignals: [] };
  }
  return industryCode === 'manufacturing'
    ? classifyManufacturing(s, signals)
    : classifyRetail(s, signals);
}

function pick(signals, anchor) {
  return { primaryAnchor: anchor, secondarySignals: signals.filter(x => x !== anchor) };
}

function classifyManufacturing(s, signals) {
  if (s.has('Q1_ARRANGE')) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_ARRANGE') };
  if (s.has('Q8_BUDGET')) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q8_BUDGET') };
  if (s.has('Q1_INTEREST') && s.has('Q8_EVALUATE')) return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q1_INTEREST') };
  if (s.has('Q8_EVALUATE') && (s.has('Q4_INTEGRATED') || s.has('Q4_FULL'))) return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q8_EVALUATE') };
  if (s.has('Q1_OFFLINE') && (s.has('Q5_SUPPLY_CHAIN') || s.has('Q5_DECISION'))) return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q1_OFFLINE') };
  if (s.has('Q1_ONLINE')) return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q1_ONLINE') };
  if (s.has('Q1_OFFLINE')) return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q1_OFFLINE') };
  if (s.has('Q8_WATCH')) return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q8_WATCH') };
  if (s.has('Q1_INTEREST')) return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q1_INTEREST') };
  const hasQ1orQ8 = signals.some(x => x.startsWith('Q1_') || x.startsWith('Q8_'));
  if (!hasQ1orQ8 && signals.length > 0) return { tier: 'P3', label: '案例升溫', ...pick(signals, signals[0]) };
  if (s.has('Q1_NOT_NOW')) return { tier: 'P4', label: '長期培育', ...pick(signals, 'Q1_NOT_NOW') };
  return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_UNKNOWN', secondarySignals: signals };
}

function classifyRetail(s, signals) {
  const q5High = s.has('Q5_HALF_YEAR') || s.has('Q5_ONE_YEAR') || s.has('Q5_ADOPTED');
  const q5Mid = s.has('Q5_ONE_YEAR') || s.has('Q5_TWO_YEAR');
  const hasQ4 = signals.some(x => x.startsWith('Q4_'));
  if (s.has('Q1_VISIT')) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_VISIT') };
  if (s.has('Q1_REVIEW_PROCESS')) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_REVIEW_PROCESS') };
  if (s.has('Q1_EXPLAIN_SOLUTION') && q5High) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_EXPLAIN_SOLUTION') };
  if ((s.has('Q4_REVENUE') || s.has('Q4_EFFICIENCY')) && q5High) {
    const anchor = s.has('Q4_REVENUE') ? 'Q4_REVENUE' : 'Q4_EFFICIENCY';
    return { tier: 'P1', label: '立即推進', ...pick(signals, anchor) };
  }
  if (s.has('Q1_EXPLAIN_SOLUTION') && hasQ4 && q5Mid) return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q1_EXPLAIN_SOLUTION') };
  if ((s.has('Q4_REVENUE') || s.has('Q4_EFFICIENCY')) && s.has('Q5_ONE_YEAR')) {
    const anchor = s.has('Q4_REVENUE') ? 'Q4_REVENUE' : 'Q4_EFFICIENCY';
    return { tier: 'P2', label: '積極培育', ...pick(signals, anchor) };
  }
  if (hasQ4 && s.has('Q5_TWO_YEAR')) {
    const anchor = signals.find(x => x.startsWith('Q4_')) || 'DEFAULT_P3';
    return { tier: 'P3', label: '案例升溫', ...pick(signals, anchor) };
  }
  if (s.has('Q5_NOT_EVALUATED') && signals.filter(x => !x.startsWith('Q5_')).length === 0) {
    return { tier: 'P4', label: '長期培育', ...pick(signals, 'Q5_NOT_EVALUATED') };
  }
  return { tier: 'P3', label: '案例升溫', primaryAnchor: 'DEFAULT_P3', secondarySignals: signals };
}

async function callGemini(apiKey, systemPrompt, userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function onRequestPost({ request, env }) {
  const userCode = getUserCode(request);
  const roleInfo = await getUserRole(env, userCode);
  if (!roleInfo || roleInfo.role !== 'superadmin') {
    return jsonError('需要 superadmin 權限', 403);
  }

  const { survey_ids, batch_size = 5 } = await request.json().catch(() => ({}));
  if (!survey_ids || !Array.isArray(survey_ids) || survey_ids.length === 0) {
    return jsonError('請提供 survey_ids 陣列', 400);
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return jsonError('未設定 GEMINI_API_KEY', 500);

  // 查詢指定的 survey 記錄
  const ids = survey_ids.slice(0, 50); // 每次最多50筆
  const placeholders = ids.map(() => '?').join(',');
  const surveys = await env.DB.prepare(
    `SELECT * FROM survey_responses WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  if (!surveys.results.length) return jsonError('找不到指定的問卷記錄', 404);

  const results = [];
  const errors = [];

  // 依照 batch_size 控制速率（避免 Gemini API 限流）
  for (let i = 0; i < surveys.results.length; i++) {
    const survey = surveys.results[i];
    if (i > 0 && i % batch_size === 0) {
      // 每批次之間休息 2 秒
      await new Promise(r => setTimeout(r, 2000));
    }

    try {
      const signals = (() => { try { return JSON.parse(survey.signals); } catch { return []; } })();
      const tierResult = classifyTier(
        survey.industry_type,
        signals,
        survey.attended === 1,
        survey.has_survey
      );
      const { tier, label, primaryAnchor, secondarySignals } = tierResult;

      const industryLabel = survey.industry_type === 'manufacturing' ? '製造業' : '流通/零售業';
      const systemPrompt = buildFollowUpSystemPrompt(survey.industry_type, CONTACT_METHOD, tier);

      const signalDescriptions = signals.map(s => `  - ${s}：${SIGNAL_LABELS[s] || s}`).join('\n');
      const behaviorNote = survey.attended === 0
        ? '\n行為情境：客戶報名未到場，使用缺席關懷策略。'
        : survey.attended === 1 && survey.has_survey === 0
          ? '\n行為情境：客戶有到場但未填問卷，使用案例升溫策略。'
          : '';

      // P1/P2 有到場 → 開頭先感謝客戶出席年會
      const attendedWarmOpening = survey.attended === 1 && (tier === 'P1' || tier === 'P2')
        ? '\n開頭情境：客戶有實際出席年會活動，說帖第一段請先以感謝客戶撥冗親臨年會為開場，表達誠摯感謝，再自然承接問卷訊號或趨勢內容。'
        : '';

      const userMessage = `請為以下客戶輪廓生成回訪說帖：

【客戶輪廓】
- 產業別：${industryLabel}
- 系統判定分類：${tier}（${label}）
- 主要錨點訊號：${primaryAnchor}
- 其他訊號：${secondarySignals.length > 0 ? secondarySignals.join(', ') : 'NONE'}
- 聯繫方式：email${behaviorNote}${attendedWarmOpening}

【問卷訊號詳細描述】
${signalDescriptions || '  （無問卷訊號，依行為情境判定）'}

【生成要求】
1. CLASSIFICATION 區塊的 tier 填入「${tier}」，label 填入「${label}」，primary_anchor 填入「${primaryAnchor}」，secondary_signals 填入「${secondarySignals.join(', ') || 'NONE'}」，industry 填入「${survey.industry_type}」，contact_method 填入「email」
2. 依照指定 tier（${tier}）的行為指引生成 APPROACH、CONTENT、QUESTIONS、SPEAKERS、NEXT_ACTIONS
3. 依照 email 的格式規範控制字數與結構
4. 話術使用群體語言（「這類規模的${industryLabel}」「在您這個產業」），不得使用個別客戶語言
5. 講師引用只能使用知識卡清單中的有效代碼`;

      const content = await callGemini(apiKey, systemPrompt, userMessage);
      if (!content) throw new Error('Gemini 回傳空結果');

      // 存入 pitches 表（標記為 bulk_generated，含 contact_name 精確對應聯絡人）
      const insertResult = await env.DB.prepare(`
        INSERT INTO pitches
          (industry, role, channel, scale, pain_points, session_pref, customer_type, style,
           content, author, user_code, customer_code, company_name, contact_name, pitch_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        survey.industry_type === 'manufacturing' ? '製造業' : '流通/零售業',
        survey.job_function || '',
        'email',
        '',
        signals.join(','),
        survey.session_name || '',
        '',
        '',
        content,
        survey.ac_name || '系統預先生成',
        survey.ac_code || userCode,   // 優先用 XLSX 的 AC 規劃師工號
        survey.customer_code,
        survey.company_name || '',
        survey.contact_name || '',
        'bulk_generated'
      ).run();

      results.push({
        survey_id: survey.id,
        customer_code: survey.customer_code,
        company_name: survey.company_name,
        pitch_id: insertResult.meta.last_row_id,
        tier,
        label,
      });
    } catch (e) {
      errors.push({
        survey_id: survey.id,
        customer_code: survey.customer_code,
        error: e.message,
      });
    }
  }

  return jsonResponse({
    generated: results.length,
    failed: errors.length,
    results,
    errors,
  });
}
