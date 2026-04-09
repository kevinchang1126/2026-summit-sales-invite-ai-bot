// POST /api/generate — 動態組裝 prompt 呼叫 Gemini API
import { base } from './knowledge/base.js';
import { industry as industryKB } from './knowledge/industry.js';
import { role as roleKB } from './knowledge/role.js';
import { channel as channelKB } from './knowledge/channel.js';
import { customerType as customerTypeKB } from './knowledge/customer-type.js';
import { style as styleKB } from './knowledge/style.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
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
      `INSERT INTO pitches (industry, role, channel, scale, pain_points, session_pref, customer_type, style, content, author, user_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      industry, role, channel, scale || '', pain_points || '',
      session_pref || '', customer_type || '', style || '',
      geminiResponse, author || '匿名業務', user_code || null
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 1024,
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
