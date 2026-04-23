// POST /api/refine — AI 微調說帖
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { pitch_id, content, instruction } = await request.json();

    if (!content || !instruction) {
      return jsonResponse({ error: '請提供說帖內容與微調指示' }, 400);
    }

    const systemPrompt = `你是鼎新數智的資深業務顧問助理，專門協助業務人員優化邀約說帖。
請根據使用者的指示，微調以下說帖內容。

注意事項：
- 保留原始說帖的核心資訊與年會細節（日期、地點、講者等）
- 不可自行編造任何年會細節
- 根據指示調整語氣、口吻、切入點等
- 輸出微調後的完整說帖，不需要額外解釋`;

    const userMessage = `原始說帖：
${content}

微調指示：${instruction}

請直接輸出修改後的完整說帖：`;

    const refined = await callGemini(env.GEMINI_API_KEY, systemPrompt, userMessage);

    // 更新 D1 中的記錄（如果有 pitch_id）
    if (pitch_id) {
      await env.DB.prepare(
        'UPDATE pitches SET content = ? WHERE id = ?'
      ).bind(refined, pitch_id).run();
    }

    return jsonResponse({ content: refined });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: '微調失敗：' + err.message }, 500);
  }
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
        temperature: 0.7,
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
