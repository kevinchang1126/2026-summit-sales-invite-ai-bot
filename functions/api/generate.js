// POST /api/generate — 動態組裝 prompt 呼叫 Gemini API
import { base } from './knowledge/base.js';
import { industry as industryKB } from './knowledge/industry.js';
import { role as roleKB } from './knowledge/role.js';
import { channel as channelKB } from './knowledge/channel.js';
import { customerType as customerTypeKB } from './knowledge/customer-type.js';
import { style as styleKB } from './knowledge/style.js';
import { SIGNAL_LABELS, buildFollowUpSystemPrompt } from './knowledge/followup.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    // 回訪說帖走獨立流程
    if (body.pitch_type === 'follow_up') {
      return handleFollowUp(body, env);
    }

    // ── 邀約說帖（原有邏輯）──────────────────────────
    const { industry, role, channel, scale, pain_points, session_pref, customer_type, style, author, user_code } = body;

    if (!industry || !role || !channel) {
      return jsonResponse({ error: '請填寫必填欄位：客戶產業別、邀約對象職能、邀約管道' }, 400);
    }

    // 動態組裝 system prompt — 只注入相關知識片段
    const systemPrompt = buildDynamicPrompt({ industry, role, channel, customer_type, style });
    const userMessage = buildUserMessage({ industry, role, channel, scale, pain_points, session_pref, customer_type, style });

    // Debug: 計算 token 估算（中文約 1.5 字/token）
    const estimatedTokens = Math.ceil(systemPrompt.length / 1.5);
    console.log(`[Prompt] 注入模組: base + ${industry} + ${role} + ${channel}${customer_type ? ' + ' + customer_type : ''}${style ? ' + ' + style : ''} | 估算 ${estimatedTokens} tokens`);

    const geminiResponse = await callGemini(env.GEMINI_API_KEY, systemPrompt, userMessage);

    // 存入 D1
    const result = await env.DB.prepare(
      `INSERT INTO pitches (industry, role, channel, scale, pain_points, session_pref, customer_type, style, content, author, user_code, pitch_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      industry, role, channel, scale || '', pain_points || '',
      session_pref || '', customer_type || '', style || '',
      geminiResponse, author || '匿名業務', user_code || null, 'invite'
    ).run();

    return jsonResponse({
      id: result.meta.last_row_id,
      content: geminiResponse,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: '生成失敗：' + err.message }, 500);
  }
}

// ============================================================
// 回訪說帖處理
// ============================================================

async function handleFollowUp(body, env) {
  const {
    industry_code,
    industry,
    signals = [],
    contact_method,
    channel,
    attendance = 'unknown',
    survey_filled = 'unknown',
    customer_name = '',
    customer_code = null,
    company_name = '',
    contact_name = '',
    author = '匿名業務',
    user_code = null,
  } = body;

  if (!industry_code || !contact_method) {
    return jsonResponse({ error: '請填寫必填欄位：客戶產業別、聯繫方式' }, 400);
  }

  const tierResult = classifyTier(industry_code, signals, attendance, survey_filled);
  const { tier, label, primaryAnchor, secondarySignals } = tierResult;

  const systemPrompt = buildFollowUpSystemPrompt(industry_code, contact_method, tier);
  const userMessage = buildFollowUpUserMessage({
    industry,
    industry_code,
    signals,
    contact_method,
    channel,
    attendance,
    survey_filled,
    customer_name,
    tier,
    label,
    primaryAnchor,
    secondarySignals,
  });

  console.log(`[FollowUp] industry=${industry_code} tier=${tier} contact=${contact_method} signals=[${signals.join(',')}]`);

  const geminiResponse = await callGemini(env.GEMINI_API_KEY, systemPrompt, userMessage);

  const result = await env.DB.prepare(
    `INSERT INTO pitches (industry, role, channel, scale, pain_points, session_pref, customer_type, style, content, author, user_code, customer_code, company_name, contact_name, pitch_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    industry || '回訪說帖', '', channel || contact_method, '',
    signals.join(','), '', `${tier}-${label}`, '',
    geminiResponse, author, user_code,
    customer_code, company_name || '', contact_name || '', 'follow_up'
  ).run();

  return jsonResponse({
    id: result.meta.last_row_id,
    content: geminiResponse,
    tier,
    label,
    primary_anchor: primaryAnchor,
  });
}

function buildFollowUpUserMessage({ industry, industry_code, signals, contact_method, channel, attendance, survey_filled, customer_name, tier, label, primaryAnchor, secondarySignals }) {
  // tier 已由 classifyTier 計算後傳入
  const signalDescriptions = signals.map(s => `  - ${s}：${SIGNAL_LABELS[s] || s}`).join('\n');

  const behaviorNote = attendance === 'no_show'
    ? '\n行為情境：客戶報名未到場，使用缺席關懷策略。'
    : attendance === 'attended' && survey_filled === 'no'
      ? '\n行為情境：客戶有到場但未填問卷，使用案例升溫策略。'
      : '';

  // P1/P2 有到場客戶 → 說帖開頭先感謝參與年會
  const attendedWarmOpening = attendance === 'attended' && (tier === 'P1' || tier === 'P2')
    ? '\n開頭情境：客戶有實際出席年會活動，說帖第一段請先以感謝客戶撥冗親臨年會為開場，表達誠摯感謝，再自然承接問卷訊號或趨勢內容。'
    : '';

  return `請為以下客戶輪廓生成回訪說帖：

【客戶輪廓】
- 產業別：${industry || industry_code}
- 系統判定分類：${tier}（${label}）
- 主要錨點訊號：${primaryAnchor}
- 其他訊號：${secondarySignals.length > 0 ? secondarySignals.join(', ') : 'NONE'}
- 聯繫方式：${channel || contact_method}${behaviorNote}${attendedWarmOpening}

【問卷訊號詳細描述】
${signalDescriptions || '  （無問卷訊號，依行為情境判定）'}

【生成要求】
1. CLASSIFICATION 區塊的 tier 填入「${tier}」，label 填入「${label}」，primary_anchor 填入「${primaryAnchor}」，secondary_signals 填入「${secondarySignals.join(', ') || 'NONE'}」，industry 填入「${industry_code}」，contact_method 填入「${contact_method}」
2. 依照指定 tier（${tier}）的行為指引生成 APPROACH、CONTENT、QUESTIONS、SPEAKERS、NEXT_ACTIONS
3. 依照${channel || contact_method}的格式規範控制字數與結構
4. 話術使用群體語言（「這類規模的${industry || industry_code}」「在您這個產業」），不得使用個別客戶語言
5. 講師引用只能使用知識卡清單中的有效代碼`;
}

// ============================================================
// 客戶分類邏輯（硬規則，對應 classification_rules.md）
// ============================================================

function classifyTier(industry_code, signals, attendance, survey_filled) {
  const s = new Set(signals);

  // Step 0：行為情境覆蓋層
  if (attendance === 'no_show') {
    return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_NO_SHOW', secondarySignals: [...signals] };
  }
  if (attendance === 'attended' && survey_filled === 'no' && signals.length === 0) {
    return { tier: 'P3', label: '案例升溫', primaryAnchor: 'BEHAVIOR_ATTENDED_NO_SURVEY', secondarySignals: [] };
  }
  if (attendance === 'unknown' && signals.length === 0) {
    return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_UNKNOWN', secondarySignals: [] };
  }

  return industry_code === 'manufacturing'
    ? classifyManufacturing(s, signals)
    : classifyRetail(s, signals);
}

function pick(signals, anchor) {
  return { primaryAnchor: anchor, secondarySignals: signals.filter(x => x !== anchor) };
}

function classifyManufacturing(s, signals) {
  // P1
  if (s.has('Q1_ARRANGE')) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_ARRANGE') };
  if (s.has('Q8_BUDGET'))  return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q8_BUDGET') };

  // P2
  if (s.has('Q1_INTEREST') && s.has('Q8_EVALUATE'))
    return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q1_INTEREST') };
  if (s.has('Q8_EVALUATE') && (s.has('Q4_INTEGRATED') || s.has('Q4_FULL')))
    return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q8_EVALUATE') };
  if (s.has('Q1_OFFLINE') && (s.has('Q5_SUPPLY_CHAIN') || s.has('Q5_DECISION')))
    return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q1_OFFLINE') };

  // P3
  if (s.has('Q1_ONLINE'))  return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q1_ONLINE') };
  if (s.has('Q1_OFFLINE')) return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q1_OFFLINE') };
  if (s.has('Q8_WATCH'))   return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q8_WATCH') };
  if (s.has('Q1_INTEREST')) return { tier: 'P3', label: '案例升溫', ...pick(signals, 'Q1_INTEREST') };
  const hasQ1orQ8 = signals.some(x => x.startsWith('Q1_') || x.startsWith('Q8_'));
  if (!hasQ1orQ8 && signals.length > 0) {
    const anchor = signals[0];
    return { tier: 'P3', label: '案例升溫', ...pick(signals, anchor) };
  }

  // P4
  if (s.has('Q1_NOT_NOW')) return { tier: 'P4', label: '長期培育', ...pick(signals, 'Q1_NOT_NOW') };
  if (s.has('Q8_NONE'))    return { tier: 'P4', label: '長期培育', ...pick(signals, 'Q8_NONE') };
  return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_UNKNOWN', secondarySignals: signals };
}

function classifyRetail(s, signals) {
  const q5High = s.has('Q5_HALF_YEAR') || s.has('Q5_ONE_YEAR') || s.has('Q5_ADOPTED');
  const q5Mid  = s.has('Q5_ONE_YEAR') || s.has('Q5_TWO_YEAR');
  const hasQ4  = signals.some(x => x.startsWith('Q4_'));

  // P1
  if (s.has('Q1_VISIT'))          return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_VISIT') };
  if (s.has('Q1_REVIEW_PROCESS')) return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_REVIEW_PROCESS') };
  if (s.has('Q1_EXPLAIN_SOLUTION') && q5High)
    return { tier: 'P1', label: '立即推進', ...pick(signals, 'Q1_EXPLAIN_SOLUTION') };
  if ((s.has('Q4_REVENUE') || s.has('Q4_EFFICIENCY')) && q5High) {
    const anchor = s.has('Q4_REVENUE') ? 'Q4_REVENUE' : 'Q4_EFFICIENCY';
    return { tier: 'P1', label: '立即推進', ...pick(signals, anchor) };
  }

  // P2
  if (s.has('Q1_EXPLAIN_SOLUTION') && hasQ4 && q5Mid)
    return { tier: 'P2', label: '積極培育', ...pick(signals, 'Q1_EXPLAIN_SOLUTION') };
  if ((s.has('Q4_REVENUE') || s.has('Q4_EFFICIENCY')) && s.has('Q5_ONE_YEAR')) {
    const anchor = s.has('Q4_REVENUE') ? 'Q4_REVENUE' : 'Q4_EFFICIENCY';
    return { tier: 'P2', label: '積極培育', ...pick(signals, anchor) };
  }

  // P3
  if (hasQ4 && s.has('Q5_TWO_YEAR')) {
    const anchor = signals.find(x => x.startsWith('Q4_')) || 'DEFAULT_P3';
    return { tier: 'P3', label: '案例升溫', ...pick(signals, anchor) };
  }
  if (hasQ4 && !signals.some(x => x.startsWith('Q1_') || x.startsWith('Q5_'))) {
    const anchor = signals.find(x => x.startsWith('Q4_')) || 'DEFAULT_P3';
    return { tier: 'P3', label: '案例升溫', ...pick(signals, anchor) };
  }

  // P4
  const nonQ5 = signals.filter(x => !x.startsWith('Q5_'));
  if (s.has('Q5_NOT_EVALUATED') && nonQ5.length === 0)
    return { tier: 'P4', label: '長期培育', ...pick(signals, 'Q5_NOT_EVALUATED') };
  if (signals.length === 0)
    return { tier: 'P4', label: '長期培育', primaryAnchor: 'BEHAVIOR_UNKNOWN', secondarySignals: [] };

  return { tier: 'P3', label: '案例升溫', primaryAnchor: 'DEFAULT_P3', secondarySignals: signals };
}

/**
 * 動態組裝 System Prompt
 * 只注入與使用者選擇相關的知識片段，減少 token 耗用
 */
function buildDynamicPrompt({ industry, role, channel, customer_type, style }) {
  const segments = [base]; // 基礎永遠載入

  // 按產業別注入
  if (industryKB[industry]) {
    segments.push(industryKB[industry]);
  }

  // 按職級注入
  if (roleKB[role]) {
    segments.push(roleKB[role]);
  }

  // 按管道注入（輸出格式）
  if (channelKB[channel]) {
    segments.push(channelKB[channel]);
  }

  // 選填：按客戶類型注入
  if (customer_type && customerTypeKB[customer_type]) {
    segments.push(customerTypeKB[customer_type]);
  }

  // 選填：按溝通風格注入
  if (style && styleKB[style]) {
    segments.push(styleKB[style]);
  }

  return segments.join('\n\n');
}

function buildUserMessage({ industry, role, channel, scale, pain_points, session_pref, customer_type, style }) {
  let msg = `請根據以下資訊，產出個人化邀約說帖：

1. 客戶產業別：${industry}
2. 邀約對象職能：${role}
3. 邀約管道：${channel}`;

  if (scale) msg += `\n4. 客戶公司規模：${scale}`;
  if (pain_points) msg += `\n5. 已知痛點或背景：${pain_points}`;
  if (session_pref) msg += `\n6. 場次偏好：${session_pref}`;
  if (customer_type) msg += `\n7. 客戶類型：${customer_type}`;
  if (style) msg += `\n8. 客戶偏好風格：${style}`;

  return msg;
}

async function callGemini(apiKey, systemPrompt, userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4096, // 增加 token 限制以允許更長的輸出
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '（無法生成內容）';
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
