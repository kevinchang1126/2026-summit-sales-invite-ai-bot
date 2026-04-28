// ===== State =====
const state = {
  currentPitchId: null,
  currentContent: '',
  voterId: getOrCreateVoterId(),
  leaderboardOffset: 0,
  leaderboardSort: 'top',
  leaderboardFilters: {
    industry: '',
    role: '',
    channel: ''
  },
  history: [],
  isEditing: false,
  pitchType: 'invite',
  followUp: {
    mode: 'search',
    industry: 'manufacturing',
    signals: [],
    channel: null,
    customerName: null,
    loadedSurvey: null,
    pregenLoaded: false,  // 預先說帖清單是否已載入過
  },
};

function getOrCreateVoterId() {
  let id = localStorage.getItem('voter_id');
  if (!id) {
    id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('voter_id', id);
  }
  return id;
}

// ===== Auth & Init =====
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const authOverlay = document.getElementById('auth-overlay');
  const appContainer = document.getElementById('app-container');
  const authMessage = document.getElementById('auth-message');

  if (token) {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '驗證失敗');

      localStorage.setItem('user_code', data.UserCode);
      localStorage.setItem('ad_name', data.UserName);
      localStorage.setItem('custom_nickname', data.custom_nickname || '');
      localStorage.setItem('display_name', data.display_name);
      localStorage.setItem('role', data.role || '');
      localStorage.setItem('managed_event_ids', JSON.stringify(data.managed_event_ids || []));

      window.history.replaceState({}, document.title, window.location.pathname);
      initApp();
    } catch (err) {
      authMessage.innerHTML = '請由數智入口&gt;諾瓦Nova 進入活動邀約快手<br><small style="color:#999; margin-top:8px; display:block;">(錯誤詳細：' + err.message + ')</small>';
      authMessage.style.color = 'red';
      document.querySelector('.spinner').style.display = 'none';
      document.querySelector('#auth-overlay h2').textContent = '驗證失敗';
    }
  } else {
    const IS_TEAMS_AUTH_REQUIRED = true; // 開啟 Teams 驗證限制
    const userCode = localStorage.getItem('user_code');

    if (userCode && (!IS_TEAMS_AUTH_REQUIRED || !userCode.startsWith('temp_'))) {
      // 已經有合法的登入紀錄 (非暫時身分)
      initApp();
    } else if (!IS_TEAMS_AUTH_REQUIRED) {
      // 暫時允許直接 URL 造訪，給予暫時身分
      localStorage.setItem('user_code', 'temp_' + Date.now());
      localStorage.setItem('ad_name', '直接造訪用戶');
      localStorage.setItem('custom_nickname', '');
      initApp(true); // 傳入 true 表示是未經 auth 的直接造訪
    } else if (isLocalDev()) {
      // 本地開發：以 /api/auth-dev 取代 Teams 驗證
      const ok = await tryDevLogin();
      if (ok) {
        initApp();
      } else {
        authMessage.innerHTML = '本地開發登入取消或失敗';
        authMessage.style.color = 'red';
        document.querySelector('.spinner').style.display = 'none';
        document.querySelector('#auth-overlay h2').textContent = '請重新整理頁面';
      }
    } else {
      authMessage.innerHTML = '請由數智入口&gt;諾瓦Nova 進入活動邀約快手';
      authMessage.style.color = 'red';
      document.querySelector('.spinner').style.display = 'none';
      document.querySelector('#auth-overlay h2').textContent = '驗證失敗';
    }
  }
});

// ===== Local Dev Login =====
function isLocalDev() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

async function tryDevLogin() {
  const saved = localStorage.getItem('dev_user_code') || '';
  const input = prompt(
    '🛠 本地開發登入\n\n請輸入欲模擬的 user_code（AD 帳號）\n可於 users / user_roles 表預先設定角色。',
    saved || 'dev_user'
  );
  if (!input) return false;
  const userCode = input.trim();
  if (!userCode) return false;
  localStorage.setItem('dev_user_code', userCode);

  try {
    const res = await fetch('/api/auth-dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: userCode, ad_name: userCode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'dev 登入失敗');
    localStorage.setItem('user_code',         data.UserCode);
    localStorage.setItem('ad_name',           data.UserName);
    localStorage.setItem('custom_nickname',   data.custom_nickname || '');
    localStorage.setItem('display_name',      data.display_name);
    localStorage.setItem('role',              data.role || '');
    localStorage.setItem('managed_event_ids', JSON.stringify(data.managed_event_ids || []));
    showDevBadge(userCode, data.role);
    return true;
  } catch (err) {
    alert('🛠 DEV 登入失敗：' + err.message);
    return false;
  }
}

function showDevBadge(userCode, role) {
  if (document.getElementById('dev-badge')) return;
  const badge = document.createElement('div');
  badge.id = 'dev-badge';
  badge.textContent = `🛠 DEV: ${userCode}${role ? ' · ' + role : ''}`;
  badge.title = '點我切換開發身分（清空 localStorage 並重新整理）';
  badge.style.cssText = [
    'position:fixed','top:4px','right:4px','z-index:9999',
    'background:#f59e0b','color:#fff','padding:3px 8px',
    'border-radius:999px','font-size:0.7rem','font-weight:600',
    'cursor:pointer','box-shadow:0 2px 6px rgba(0,0,0,0.2)',
    'letter-spacing:0.02em',
  ].join(';');
  badge.addEventListener('click', () => {
    if (!confirm('🛠 清除登入資訊並重新整理？')) return;
    ['user_code','ad_name','custom_nickname','display_name','role','managed_event_ids','dev_user_code']
      .forEach(k => localStorage.removeItem(k));
    location.reload();
  });
  document.body.appendChild(badge);
}

function initApp(isDirectAccess = false) {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';

  document.getElementById('display-ad-name').textContent = localStorage.getItem('ad_name') || '';
  document.getElementById('custom-nickname-input').value = localStorage.getItem('custom_nickname') || '';

  // 管理後台入口：superadmin / eventadmin 才顯示
  const role = localStorage.getItem('role');
  if (role === 'superadmin' || role === 'eventadmin') {
    const btn = document.getElementById('btn-admin-entry');
    if (btn) btn.style.display = 'inline-block';
  }

  // 本地開發 badge（reload 後也要顯示）
  if (isLocalDev() && localStorage.getItem('dev_user_code')) {
    showDevBadge(localStorage.getItem('dev_user_code'), role);
  }
}

// ===== Save Nickname =====
document.getElementById('btn-save-nickname').addEventListener('click', async () => {
  const newNickname = document.getElementById('custom-nickname-input').value.trim();
  const userCode = localStorage.getItem('user_code');

  if (!newNickname) return showToast('請輸入新暱稱');

  const btn = document.getElementById('btn-save-nickname');
  btn.disabled = true;

  try {
    const res = await fetch('/api/user/nickname', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: userCode, new_nickname: newNickname })
    });
    const data = await res.json();
    if (!res.ok) {
      const hint = document.getElementById('nickname-hint');
      hint.textContent = data.error;
      hint.style.color = 'var(--danger)';
      throw new Error(data.error);
    }

    localStorage.setItem('custom_nickname', data.custom_nickname);
    localStorage.setItem('display_name', data.custom_nickname);
    document.getElementById('nickname-hint').textContent = '※ 暱稱每 7 天只能修改一次 (修改成功)';
    document.getElementById('nickname-hint').style.color = 'var(--success)';
    showToast('暱稱更換成功！');
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ===== Tab Switching =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById('tab-' + tab.dataset.tab);
    target.classList.add('active');

    if (tab.dataset.tab === 'leaderboard') loadLeaderboard(true);
    if (tab.dataset.tab === 'history') renderHistory();
  });
});

// ===== Generate =====
const form = document.getElementById('form-generate');
const btnGenerate = document.getElementById('btn-generate');
const resultArea = document.getElementById('result-area');
const resultContent = document.getElementById('result-content');
const resultDisplay = document.getElementById('result-display');
const resultEdit = document.getElementById('result-edit');
const editTextarea = document.getElementById('edit-textarea');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await generatePitch();
});

document.getElementById('btn-regenerate').addEventListener('click', () => {
  generatePitch();
});

async function generatePitch() {
  // 回訪模式：不重新生成邀約說帖，改為顯示渠道選擇器
  if (state.pitchType === 'follow_up') {
    const regenSec = document.getElementById('fu-regen-section');
    regenSec.style.display = 'block';
    // 預選上次用的渠道
    if (state.followUp.channel) {
      const radio = regenSec.querySelector(`input[value="${state.followUp.channel}"]`);
      if (radio) radio.checked = true;
    }
    regenSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());

  const customInput = document.getElementById('custom-nickname-input').value.trim();
  data.author = customInput || localStorage.getItem('ad_name') || '匿名業務';
  data.user_code = localStorage.getItem('user_code');

  btnGenerate.disabled = true;
  btnGenerate.querySelector('.btn-text').style.display = 'none';
  btnGenerate.querySelector('.btn-loading').style.display = 'inline-flex';
  resultArea.style.display = 'none';
  exitEditMode();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || '生成失敗');
    }

    state.currentPitchId = result.id;
    state.currentContent = result.content;
    resultContent.classList.add('pitch-rendered');
    renderPitchContent(result.content, resultContent);
    resultArea.style.display = 'block';
    resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Reset vote states
    document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));

    // 前端暫存，以便立刻在我的紀錄看到
    state.history.unshift({
      id: result.id,
      industry: data.industry,
      role: data.role,
      channel: data.channel,
      content: result.content,
      created_at: new Date().toISOString()
    });

  } catch (err) {
    showToast(err.message);
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.querySelector('.btn-text').style.display = 'inline';
    btnGenerate.querySelector('.btn-loading').style.display = 'none';
  }
}

// ===== Copy =====
document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = state.isEditing ? editTextarea.value : state.currentContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製到剪貼簿');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(resultContent);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.execCommand('copy');
    showToast('已複製到剪貼簿');
  }
});

// ===== Edit Mode =====
const btnEdit = document.getElementById('btn-edit');
const btnSaveEdit = document.getElementById('btn-save-edit');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

btnEdit.addEventListener('click', () => {
  enterEditMode();
});

btnSaveEdit.addEventListener('click', async () => {
  const newContent = editTextarea.value.trim();
  if (!newContent) {
    showToast('內容不能為空');
    return;
  }
  state.currentContent = newContent;
  resultContent.classList.add('pitch-rendered');
  renderPitchContent(newContent, resultContent);

  // 更新 D1
  if (state.currentPitchId) {
    try {
      await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitch_id: state.currentPitchId,
          content: newContent,
          instruction: '直接使用這段內容取代原始說帖',
        }),
      });
    } catch { /* silent */ }
  }

  // 更新 local history
  updateLocalHistory(state.currentPitchId, newContent);

  exitEditMode();
  showToast('已儲存修改');
});

btnCancelEdit.addEventListener('click', () => {
  exitEditMode();
});

function enterEditMode() {
  state.isEditing = true;
  editTextarea.value = state.currentContent;
  resultDisplay.style.display = 'none';
  resultEdit.style.display = 'block';
  btnEdit.style.display = 'none';
  btnSaveEdit.style.display = 'inline-block';
  btnCancelEdit.style.display = 'inline-block';
  editTextarea.focus();
}

function exitEditMode() {
  state.isEditing = false;
  resultDisplay.style.display = 'block';
  resultEdit.style.display = 'none';
  btnEdit.style.display = 'inline-block';
  btnSaveEdit.style.display = 'none';
  btnCancelEdit.style.display = 'none';
}

// ===== AI Refine =====
const btnRefine = document.getElementById('btn-refine');
const refineInput = document.getElementById('refine-input');

// Quick refine chips
document.querySelectorAll('.refine-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    doRefine(chip.dataset.instruction);
  });
});

// Custom refine
btnRefine.addEventListener('click', () => {
  const instruction = refineInput.value.trim();
  if (!instruction) {
    showToast('請輸入微調指示');
    return;
  }
  doRefine(instruction);
});

async function doRefine(instruction) {
  const content = state.isEditing ? editTextarea.value : state.currentContent;
  if (!content) return;

  // Disable all refine buttons
  setRefineLoading(true);

  try {
    const res = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pitch_id: state.currentPitchId,
        content: content,
        instruction: instruction,
      }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || '微調失敗');

    state.currentContent = result.content;
    resultContent.classList.add('pitch-rendered');
    renderPitchContent(result.content, resultContent);

    if (state.isEditing) {
      editTextarea.value = result.content;
    }

    // 更新 local history
    updateLocalHistory(state.currentPitchId, result.content);

    refineInput.value = '';
    showToast('微調完成');
  } catch (err) {
    showToast(err.message);
  } finally {
    setRefineLoading(false);
  }
}

function setRefineLoading(loading) {
  document.querySelectorAll('.refine-chip').forEach(c => c.disabled = loading);
  btnRefine.disabled = loading;
  btnRefine.querySelector('.btn-text').style.display = loading ? 'none' : 'inline';
  btnRefine.querySelector('.btn-loading').style.display = loading ? 'inline-flex' : 'none';
}

function updateLocalHistory(pitchId, newContent) {
  const idx = state.history.findIndex(h => h.id === pitchId);
  if (idx !== -1) {
    state.history[idx].content = newContent;
  }
}

// ===== Vote =====
document.querySelectorAll('.btn-vote').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.currentPitchId) return;

    const voteType = btn.dataset.vote;
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitch_id: state.currentPitchId,
          vote_type: voteType,
          voter_id: state.voterId,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      if (result.action === 'removed') {
        btn.classList.remove('voted');
      } else {
        document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));
        btn.classList.add('voted');
      }

      showToast(result.action === 'removed' ? '已取消' : '感謝回饋！');
    } catch (err) {
      showToast(err.message);
    }
  });
});

// 全域投票功能，供排行榜項目使用
window.votePitch = async function(pitchId, voteType, btn) {
  try {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pitch_id: pitchId,
        vote_type: voteType,
        voter_id: state.voterId,
      }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    const container = btn.closest('.pitch-stats');
    const likeBtn = container.querySelector('button[onclick*="like"]');
    const dislikeBtn = container.querySelector('button[onclick*="dislike"]');
    const likeCountSpan = likeBtn.querySelector('.count');
    const dislikeCountSpan = dislikeBtn.querySelector('.count');

    let likeCount = parseInt(likeCountSpan.textContent, 10);
    let dislikeCount = parseInt(dislikeCountSpan.textContent, 10);

    // 處理數量與狀態更新
    if (result.action === 'removed') {
      btn.classList.remove('voted');
      btn.style.opacity = '1';
      if (voteType === 'like') likeCount = Math.max(0, likeCount - 1);
      if (voteType === 'dislike') dislikeCount = Math.max(0, dislikeCount - 1);
    } else {
      // 移除另一個按鈕的選取狀態，並扣除數量
      if (likeBtn.classList.contains('voted') && voteType === 'dislike') {
        likeBtn.classList.remove('voted');
        likeBtn.style.opacity = '0.5';
        likeCount = Math.max(0, likeCount - 1);
      } else if (dislikeBtn.classList.contains('voted') && voteType === 'like') {
        dislikeBtn.classList.remove('voted');
        dislikeBtn.style.opacity = '0.5';
        dislikeCount = Math.max(0, dislikeCount - 1);
      }

      // 如果尚未選取原本的按鈕才能+1，避免重複點按+1 (一般已經透過 action 判斷)
      if (!btn.classList.contains('voted')) {
        if (voteType === 'like') likeCount++;
        if (voteType === 'dislike') dislikeCount++;
      }

      likeBtn.classList.remove('voted');
      dislikeBtn.classList.remove('voted');
      
      likeBtn.style.opacity = voteType === 'like' ? '1' : '0.5';
      dislikeBtn.style.opacity = voteType === 'dislike' ? '1' : '0.5';
      
      btn.classList.add('voted');
    }

    likeCountSpan.textContent = likeCount;
    dislikeCountSpan.textContent = dislikeCount;

    showToast(result.action === 'removed' ? '已取消' : '感謝回饋！');
  } catch (err) {
    showToast(err.message);
  }
};

// ===== Leaderboard =====
const leaderboardList = document.getElementById('leaderboard-list');
const sortSelect = document.getElementById('sort-select');
const btnLoadmore = document.getElementById('btn-loadmore');

sortSelect.addEventListener('change', () => {
  state.leaderboardSort = sortSelect.value;
  loadLeaderboard(true);
});

btnLoadmore.addEventListener('click', () => loadLeaderboard(false));

// 篩選器事件
document.getElementById('filter-industry').addEventListener('change', (e) => {
  state.leaderboardFilters.industry = e.target.value;
  loadLeaderboard(true);
});
document.getElementById('filter-role').addEventListener('change', (e) => {
  state.leaderboardFilters.role = e.target.value;
  loadLeaderboard(true);
});
document.getElementById('filter-channel').addEventListener('change', (e) => {
  state.leaderboardFilters.channel = e.target.value;
  loadLeaderboard(true);
});
document.getElementById('btn-clear-filters').addEventListener('click', () => {
  document.getElementById('filter-industry').value = '';
  document.getElementById('filter-role').value = '';
  document.getElementById('filter-channel').value = '';
  state.leaderboardFilters = { industry: '', role: '', channel: '' };
  loadLeaderboard(true);
});

async function loadLeaderboard(reset = false) {
  if (reset) {
    state.leaderboardOffset = 0;
    leaderboardList.innerHTML = '<div class="loading-placeholder">載入中...</div>';
  }

  try {
    const params = new URLSearchParams({
      sort: state.leaderboardSort,
      limit: 10,
      offset: state.leaderboardOffset,
      industry: state.leaderboardFilters.industry,
      role: state.leaderboardFilters.role,
      channel: state.leaderboardFilters.channel
    });

    const res = await fetch(`/api/pitches?${params.toString()}`);
    const data = await res.json();

    if (reset) leaderboardList.innerHTML = '';

    if (data.pitches.length === 0 && reset) {
      leaderboardList.innerHTML = '<p class="empty-state">還沒有任何說帖，快去生成第一篇吧！</p>';
      btnLoadmore.style.display = 'none';
      return;
    }

    data.pitches.forEach((pitch, i) => {
      const rank = state.leaderboardOffset + i + 1;
      leaderboardList.appendChild(createPitchItem(pitch, rank));
    });

    state.leaderboardOffset += data.pitches.length;
    btnLoadmore.style.display = state.leaderboardOffset < data.total ? 'block' : 'none';

  } catch (err) {
    leaderboardList.innerHTML = '<p class="empty-state">載入失敗，請稍後再試</p>';
  }
}

function createPitchItem(pitch, rank) {
  const el = document.createElement('div');
  el.className = 'pitch-item';

  const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-other';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;align-items:flex-start';

  const rankBadge = document.createElement('span');
  rankBadge.className = `rank-badge ${rankClass}`;
  rankBadge.textContent = rank;

  const inner = document.createElement('div');
  inner.style.cssText = 'flex:1;min-width:0';

  const metaDiv = document.createElement('div');
  metaDiv.className = 'pitch-meta';
  metaDiv.innerHTML = `
    <span class="tag tag-industry">${escapeHtml(pitch.industry)}</span>
    <span class="tag tag-channel">${escapeHtml(pitch.channel)}</span>
    <span class="tag tag-role">${escapeHtml(pitch.role)}</span>`;

  const previewDiv = document.createElement('div');
  previewDiv.className = 'pitch-preview pitch-rendered';
  renderPitchContent(pitch.content, previewDiv);
  previewDiv.addEventListener('click', () => previewDiv.classList.toggle('expanded'));

  const footerDiv = document.createElement('div');
  footerDiv.className = 'pitch-footer';
  footerDiv.innerHTML = `
    <span>${escapeHtml(pitch.author || '匿名業務')} · ${formatDate(pitch.created_at)}</span>
    <div class="pitch-stats">
      <button class="stat-item" style="color:var(--success); background:transparent; border:none; cursor:pointer; padding:4px;" onclick="votePitch('${pitch.id}', 'like', this)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/></svg>
        <span class="count">${pitch.likes}</span>
      </button>
      <button class="stat-item" style="color:var(--danger); background:transparent; border:none; cursor:pointer; padding:4px;" onclick="votePitch('${pitch.id}', 'dislike', this)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15V19a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/></svg>
        <span class="count">${pitch.dislikes}</span>
      </button>
    </div>`;

  inner.appendChild(metaDiv);
  inner.appendChild(previewDiv);
  inner.appendChild(footerDiv);
  wrapper.appendChild(rankBadge);
  wrapper.appendChild(inner);
  el.appendChild(wrapper);
  return el;
}

// ===== History =====
async function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '<div class="loading-placeholder">載入中...</div>';

  try {
    const userCode = localStorage.getItem('user_code');
    if (!userCode) throw new Error('未登入');

    const res = await fetch(`/api/pitches?user_code=${encodeURIComponent(userCode)}&limit=50`);
    const data = await res.json();
    state.history = data.pitches || [];

    if (state.history.length === 0) {
      list.innerHTML = '<p class="empty-state">尚無記錄，去生成第一篇說帖吧！</p>';
      return;
    }

    list.innerHTML = '';
    state.history.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'pitch-item';

      // 建立結構
      const metaHtml = `
        <div class="pitch-meta">
          <span class="tag tag-industry">${escapeHtml(item.industry)}</span>
          <span class="tag tag-channel">${escapeHtml(item.channel)}</span>
          <span class="tag tag-role">${escapeHtml(item.role || '')}</span>
        </div>`;

      const previewDiv = document.createElement('div');
      previewDiv.className = 'pitch-preview pitch-rendered history-preview';
      renderPitchContent(item.content, previewDiv);
      previewDiv.addEventListener('click', () => previewDiv.classList.toggle('expanded'));

      const footerHtml = `
        <div class="pitch-footer">
          <span>${formatDate(item.created_at)}</span>
          <div style="display:flex;gap:6px">
            <button class="btn-secondary" onclick="copyText(this)" data-content="${escapeAttr(item.content)}">複製</button>
            <button class="btn-secondary" onclick="reuseFromHistory(${item.id})">載入編輯</button>
          </div>
        </div>`;

      el.innerHTML = metaHtml + footerHtml;
      // 把 previewDiv 插入 metaHtml 之後、footerHtml 之前
      el.insertBefore(previewDiv, el.querySelector('.pitch-footer'));
      list.appendChild(el);
    });
  } catch (err) {
    list.innerHTML = '<p class="empty-state">無法載入歷史記錄</p>';
  }
}

// 從歷史記錄載入到編輯區
window.reuseFromHistory = function(pitchId) {
  const item = state.history.find(h => h.id === pitchId);
  if (!item) return;

  // 切換到「生成說帖」主 tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="generate"]').classList.add('active');
  document.getElementById('tab-generate').classList.add('active');

  // 切換到「邀約說帖」子頁籤（確保 result-area 可見）
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('subtab-invite').style.display = 'block';
  document.getElementById('subtab-followup').style.display = 'none';
  const inviteSubTab = document.querySelector('[data-subtab="invite"]');
  if (inviteSubTab) inviteSubTab.classList.add('active');

  // 填入說帖內容並渲染
  state.currentPitchId = item.id;
  state.currentContent = item.content;
  resultContent.classList.add('pitch-rendered');
  renderPitchContent(item.content, resultContent);
  resultArea.style.display = 'block';

  // 進入編輯模式
  enterEditMode();
  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ===== 回訪說帖結果區按鈕 =====
document.getElementById('fu-btn-copy').addEventListener('click', async () => {
  const text = state.currentContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製到剪貼簿');
  } catch {
    showToast('複製失敗');
  }
});

document.getElementById('fu-btn-regenerate').addEventListener('click', () => {
  document.getElementById('fu-result-area').style.display = 'none';
  generateFollowUpPitch();
});

// ===== Modal =====
document.getElementById('btn-info').addEventListener('click', () => {
  document.getElementById('modal-info').style.display = 'flex';
});
document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-info').style.display = 'none';
});
document.getElementById('modal-info').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('modal-info').style.display = 'none';
  }
});

// ===== Global Reset ===== 
// 移除原本的 localStorage.getItem('author_name') 機制

// ===== Utilities =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ===== 說帖 Markdown 渲染 =====
// 區塊標題中英對照
const SECTION_LABEL_MAP = {
  'CLASSIFICATION': '📋 說帖分類',
  'APPROACH': '🎯 策略方向',
  'CONTENT': '💬 說帖內容',
  'QUESTIONS': '❓ 建議提問',
  'SPEAKERS': '🎤 引用講師',
  'NEXT_ACTIONS': '🚀 後續行動',
};

// CLASSIFICATION 屬性名稱翻譯
const KV_KEY_MAP = {
  'tier': '階段',
  'label': '標籤',
  'primary_anchor': '主論述',
  'secondary_signals': '次要信號',
  'industry': '分流',
  'contact_method': '聯繫方式',
  'role': '職能',
  'channel': '渠道',
};

// CLASSIFICATION 屬性值翻譯（固定對照）
const KV_VAL_MAP = {
  // tier
  'P1': 'P1 立即推進', 'P2': 'P2 積極培育',
  'P3': 'P3 案例升溫', 'P4': 'P4 長期培育',
  // 行為情境碼
  'BEHAVIOR_ATTENDED_NO_SURVEY': '已到場・未填問卷',
  'BEHAVIOR_NO_SHOW':            '報名未到場',
  'BEHAVIOR_UNKNOWN':            '行為情境未知',
  'DEFAULT_P3':                  '案例升溫（預設）',
  'NONE':                        '（無）',
  // 製造業 Q1
  'Q1_ARRANGE':  '安排了解 AI 規劃',
  'Q1_INTEREST': '有興趣進一步了解',
  'Q1_ONLINE':   '希望線上了解',
  'Q1_OFFLINE':  '希望到府拜訪',
  'Q1_NOT_NOW':  '目前暫不考慮',
  // 製造業 Q4
  'Q4_NONE':       '尚未起步',
  'Q4_TRIAL':      '局部嘗試',
  'Q4_POINT':      '點狀應用',
  'Q4_INTEGRATED': '系統整合中',
  'Q4_FULL':       '全面賦能',
  // 製造業 Q5
  'Q5_SUPPLY_CHAIN': '生產與供應鏈',
  'Q5_FINANCE':      '財務與行政核銷',
  'Q5_RD':           '研發與技術',
  'Q5_DECISION':     '經營管理與決策',
  // 製造業 Q6
  'Q6_FREQUENCY':  '高頻重複作業',
  'Q6_KNOWLEDGE':  '知識傳承斷層',
  'Q6_EXPERIENCE': '流程輔助決策',
  'Q6_WORKLOAD':   '自動化行政處理',
  // 製造業 Q7
  'Q7_DATA':       '資料品質不佳',
  'Q7_RESISTANCE': '員工排斥變革',
  'Q7_TALENT':     '缺乏 AI 人才',
  'Q7_ROI':        'ROI 不明確',
  // 製造業 Q8
  'Q8_BUDGET':   '已有明確預算',
  'Q8_EVALUATE': '積極評估中',
  'Q8_WATCH':    '持觀望態度',
  'Q8_NONE':     '暫無規劃',
  // 流通業 Q1
  'Q1_VISIT':            '希望到府討論',
  'Q1_REVIEW_PROCESS':   '希望盤點現有流程',
  'Q1_EXPLAIN_SOLUTION': '希望說明解決方案',
  'Q1_OTHER':            '其他意願',
  // 流通業 Q4
  'Q4_COMPETITION':    '因應市場競爭',
  'Q4_REVENUE':        '推動營收成長',
  'Q4_EFFICIENCY':     '提升效率與體驗',
  'Q4_CUSTOMER_EXP':   '提升客戶體驗',
  'Q4_RESILIENCE':     '強化企業韌性',
  'Q4_SECURITY':       '強化資安治理',
  'Q4_SUSTAINABILITY': '企業永續創新',
  'Q4_OTHER':          '其他目標',
  // 流通業 Q5
  'Q5_NOT_EVALUATED': '尚未評估導入時程',
  'Q5_HALF_YEAR':     '預計半年內導入',
  'Q5_ONE_YEAR':      '預計一年內導入',
  'Q5_TWO_YEAR':      '預計兩年內導入',
  'Q5_ADOPTED':       '已導入系統',
  // 產業 / 聯繫方式
  'manufacturing': '製造業', 'retail': '流通/零售業',
  'phone': '電話話術', 'visit': '面訪話術',
  'line': 'LINE 訊息', 'email': 'Email',
};

function translateKvValue(raw) {
  // 支援逗號或「、」分隔的多值（secondary_signals）
  const parts = raw.split(/,\s*|、/).map(v => v.trim()).filter(Boolean);
  return parts.map(v => KV_VAL_MAP[v] || v).join('、');
}

/**
 * 將原始說帖 Markdown 字串渲染成 HTML DOM 節點。
 * 功能：
 *  1. ## SECTION 標題替換為中文標籤
 *  2. <cite code="K-xxx"> 替換為 hover tooltip（不顯示 code）
 *  3. 其餘行正常渲染（保留換行、清單）
 */
function renderPitchContent(rawText, container) {
  if (!rawText) { container.innerHTML = ''; return; }

  // 先把 <cite code="K-xxx-00">文字</cite> 抽出，建立 data-code tooltip
  // 同時去除講師代碼 K-xxx-xx 在純文字段落中的出現（如「｜K-LYH-05」）
  let processed = rawText
    // 替換 <cite code="K-xxx">文字</cite> → <span class="cite-tooltip"> 版本
    .replace(/<cite\s+code="([^"]+)"\s*>([^<]*)<\/cite>/g, (_, code, text) => {
      return `__CITE_START__${code}__CITE_MID__${text}__CITE_END__`;
    })
    // 去掉在 ## SPEAKERS 或其他地方出現的 K-xxx-xx 代碼（含前後可能的 ｜ 或空格）
    .replace(/[\s　]*[\|｜][\s　]*K-[A-Z]+-\d{2}/g, '')
    .replace(/\bK-[A-Z]+-\d{2}\b/g, '');

  // 拆行處理
  const lines = processed.split('\n');
  const htmlParts = [];
  let inList = false;

  lines.forEach(line => {
    // 區塊標題 ## SECTION
    const sectionMatch = line.match(/^##\s+(\w+)$/);
    if (sectionMatch) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      const key = sectionMatch[1].toUpperCase();
      const label = SECTION_LABEL_MAP[key] || sectionMatch[1];
      htmlParts.push(`<div class="pitch-section-header">${escapeHtml(label)}</div>`);
      return;
    }

    // Markdown 清單項 「- 文字」 或「* 文字」
    const listMatch = line.match(/^[-*]\s+(.+)/);
    if (listMatch) {
      if (!inList) { htmlParts.push('<ul class="pitch-list-items">'); inList = true; }
      htmlParts.push(`<li>${renderInline(listMatch[1])}</li>`);
      return;
    }

    // key: value 格式（CLASSIFICATION 區塊內）
    const kvMatch = line.match(/^(\w[\w_]*):\s+(.+)/);
    if (kvMatch) {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      const keyLabel = KV_KEY_MAP[kvMatch[1]] || kvMatch[1];
      const valLabel = translateKvValue(kvMatch[2]);
      htmlParts.push(`<div class="pitch-kv"><span class="pitch-kv-key">${escapeHtml(keyLabel)}</span><span class="pitch-kv-val">${escapeHtml(valLabel)}</span></div>`);
      return;
    }

    // 空行
    if (line.trim() === '') {
      if (inList) { htmlParts.push('</ul>'); inList = false; }
      htmlParts.push('<div class="pitch-blank"></div>');
      return;
    }

    // 普通段落
    if (inList) { htmlParts.push('</ul>'); inList = false; }
    htmlParts.push(`<p class="pitch-para">${renderInline(line)}</p>`);
  });

  if (inList) htmlParts.push('</ul>');

  container.innerHTML = htmlParts.join('');
  attachCiteTooltips(container);
}

/** 處理行內的 cite 佔位符，轉成帶 data-code 的 span */
function renderInline(text) {
  const CITE_RE = /__CITE_START__([^_]*)__CITE_MID__([^_]*)__CITE_END__/g;
  let result = '';
  let lastIdx = 0;
  let m;
  while ((m = CITE_RE.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIdx, m.index));
    const code = m[1];
    const displayText = m[2];
    result += `<span class="cite-ref" data-code="${escapeHtml(code)}" tabindex="0">${escapeHtml(displayText)}<span class="cite-tooltip-bubble"></span></span>`;
    lastIdx = m.index + m[0].length;
  }
  result += escapeHtml(text.slice(lastIdx));
  return result;
}

/** 掛上 cite tooltip 的資料，並綁定點擊跳轉講師卡邏輯 */
function attachCiteTooltips(container) {
  const allCards = SPEAKER_DATA
    ? SPEAKER_DATA.flatMap(s => s.cards.map(c => ({ ...c, speakerName: s.name, speakerTitle: s.title })))
    : [];

  container.querySelectorAll('.cite-ref').forEach(el => {
    const code = el.dataset.code;
    const card = allCards.find(c => c.code === code);
    const bubble = el.querySelector('.cite-tooltip-bubble');
    if (!bubble) return;

    if (card) {
      // hover bubble 顯示：講師名 + 職稱 + 完整論點 full_text
      bubble.innerHTML = [
        `<strong>${escapeHtml(card.speakerName)}</strong>`,
        `<span class="cite-tooltip-title">${escapeHtml(card.speakerTitle)}</span>`,
        `<span class="cite-tooltip-quote">${escapeHtml(card.full_text || card.quote)}</span>`,
        `<span class="cite-tooltip-link">點擊可開啟完整講師卡 →</span>`,
      ].join('');
      // 行內顯示文字統一替換為 quote 短句，不管 AI 在 <cite> 裡塞了什麼
      const textNode = el.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = `「${card.quote}」`;
      }
    } else {
      bubble.innerHTML = `<span class="cite-tooltip-quote">${escapeHtml(code)}</span>`;
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!card) return;

      // 1. 切換到講師素材 tab
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const speakerTab = document.querySelector('[data-tab="speakers"]');
      if (speakerTab) speakerTab.classList.add('active');
      const speakerSection = document.getElementById('tab-speakers');
      if (speakerSection) speakerSection.classList.add('active');

      // 2. 重置講師篩選為「全部」，確保目標卡片有被渲染
      activeSpeakerId = '';
      speakerSearchTerm = '';
      document.getElementById('speaker-search').value = '';
      document.querySelectorAll('.speaker-filter-btn').forEach(b => b.classList.remove('active'));
      const allBtn = document.querySelector('.speaker-filter-btn[data-speaker=""]');
      if (allBtn) allBtn.classList.add('active');
      renderSpeakerCards();

      // 3. 展開對應講師卡並捲動
      setTimeout(() => {
        const cardEl = document.getElementById(`card-${code}`);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cardEl.classList.add('cited-highlight');
          setTimeout(() => cardEl.classList.remove('cited-highlight'), 2500);
          const detail = document.getElementById(`detail-${code}`);
          if (detail && !detail.classList.contains('open')) {
            toggleSpeakerCard(code);
          }
        }
      }, 150);
    });
  });
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  
  let safeStr = dateStr;
  // 將 SQLite 回傳的 YYYY-MM-DD HH:MM:SS 格式轉換為標準的 YYYY-MM-DDTHH:MM:SSZ (明確標示為 UTC 時間)
  if (safeStr.length === 19 && safeStr.includes(' ')) {
    safeStr = safeStr.replace(' ', 'T') + 'Z';
  } else if (safeStr.length === 19 && safeStr.includes('T')) {
    safeStr += 'Z';
  }

  const d = new Date(safeStr);
  if (isNaN(d.getTime())) return dateStr;

  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

window.copyText = async function(btn) {
  try {
    await navigator.clipboard.writeText(btn.dataset.content);
    showToast('已複製到剪貼簿');
  } catch {
    showToast('複製失敗');
  }
};

// =============================================================
// ===== P7: 回訪說帖模組 =====================================
// =============================================================

// ---- 問卷資料 ----
const QUESTIONNAIRE_DATA = {
  manufacturing: [
    {
      id: 'Q1', label: 'Q1 — 活動後希望的協助', type: 'checkbox',
      options: [
        { code: 'Q1_ARRANGE', text: '安排人員了解需求，進行 AI 說明與規劃', highlight: true },
        { code: 'Q1_INTEREST', text: '對 AI 方案感興趣，提供相關資料讓我參考' },
        { code: 'Q1_ONLINE',   text: '想了解 AI 最新應用，請幫報名線上活動' },
        { code: 'Q1_OFFLINE',  text: '線下實體體驗活動有意願參加' },
        { code: 'Q1_NOT_NOW',  text: '先不用，後續有需求再聯繫' },
      ]
    },
    {
      id: 'Q4', label: 'Q4 — 目前 AI 應用程度', type: 'checkbox',
      options: [
        { code: 'Q4_NONE',       text: '尚未起步' },
        { code: 'Q4_TRIAL',      text: '局部嘗試（個人用 ChatGPT 等）' },
        { code: 'Q4_POINT',      text: '點狀應用（特定部門使用）' },
        { code: 'Q4_INTEGRATED', text: '系統整合（已接核心系統）' },
        { code: 'Q4_FULL',       text: '全面賦能（數位勞動力）' },
      ]
    },
    {
      id: 'Q5', label: 'Q5 — 最急迫的領域', type: 'checkbox',
      options: [
        { code: 'Q5_SUPPLY_CHAIN', text: '生產與供應鏈管理' },
        { code: 'Q5_FINANCE',      text: '財務與行政核銷' },
        { code: 'Q5_RD',           text: '研發與技術支援' },
        { code: 'Q5_DECISION',     text: '經營管理與決策' },
      ]
    },
    {
      id: 'Q6', label: 'Q6 — 期待 Agent 帶來的成效', type: 'checkbox',
      options: [
        { code: 'Q6_FREQUENCY', text: '高頻度：重複性作業任務' },
        { code: 'Q6_KNOWLEDGE', text: '高知識：資訊斷層、經驗傳承' },
        { code: 'Q6_EXPERIENCE',text: '高經驗：既有流程、輔助決策' },
        { code: 'Q6_WORKLOAD',  text: '負荷率：自動化處理重複性行政事務' },
      ]
    },
    {
      id: 'Q7', label: 'Q7 — AI 轉型面臨的挑戰', type: 'checkbox',
      options: [
        { code: 'Q7_DATA',       text: '企業內部數據品質不佳或尚未整合' },
        { code: 'Q7_RESISTANCE', text: '員工對 AI 轉型產生排斥感或恐懼' },
        { code: 'Q7_TALENT',     text: '缺乏具備 AI 應用能力的專業人才' },
        { code: 'Q7_ROI',        text: '導入成本過高且 ROI 不明確' },
      ]
    },
    {
      id: 'Q8', label: 'Q8 — 投入意願', type: 'checkbox',
      options: [
        { code: 'Q8_BUDGET',   text: '已有明確預算並開始執行相關專案', highlight: true },
        { code: 'Q8_EVALUATE', text: '積極評估中，正在尋找合適的解決方案' },
        { code: 'Q8_WATCH',    text: '持觀望態度，優先觀察產業指標性企業的成效' },
        { code: 'Q8_NONE',     text: '目前暫無規劃' },
      ]
    },
  ],
  retail: [
    {
      id: 'Q1', label: 'Q1 — 活動後希望的協助', type: 'checkbox',
      options: [
        { code: 'Q1_VISIT',            text: '到府討論貴公司需求，並討論可能的協助', highlight: true },
        { code: 'Q1_REVIEW_PROCESS',   text: '檢視貴公司目前作業流程狀況並討論可能之協助', highlight: true },
        { code: 'Q1_EXPLAIN_SOLUTION', text: '針對貴公司資訊需求再進一步說明鼎新解決方案' },
        { code: 'Q1_OTHER',            text: '其他' },
      ]
    },
    {
      id: 'Q4', label: 'Q4 — AI 導入的主要目的', type: 'checkbox',
      options: [
        { code: 'Q4_COMPETITION',  text: '因應市場或同業競爭' },
        { code: 'Q4_REVENUE',      text: '推動營收成長', highlight: true },
        { code: 'Q4_EFFICIENCY',   text: '提升營運效率與員工體驗', highlight: true },
        { code: 'Q4_CUSTOMER_EXP', text: '提升客戶體驗與服務效率' },
        { code: 'Q4_RESILIENCE',   text: '強化企業韌性' },
        { code: 'Q4_SECURITY',     text: '強化資安與資訊治理能力' },
        { code: 'Q4_SUSTAINABILITY',text: '企業永續與創新' },
        { code: 'Q4_OTHER',        text: '其他' },
      ]
    },
    {
      id: 'Q5', label: 'Q5 — 預計 AI 採用時程', type: 'radio',
      options: [
        { code: 'Q5_ADOPTED',       text: '已導入', highlight: true },
        { code: 'Q5_HALF_YEAR',     text: '預計半年內導入', highlight: true },
        { code: 'Q5_ONE_YEAR',      text: '預計一年內導入' },
        { code: 'Q5_TWO_YEAR',      text: '預計二年內導入' },
        { code: 'Q5_NOT_EVALUATED', text: '尚未評估' },
      ]
    },
  ]
};

// ---- 子頁籤切換 ----
document.querySelectorAll('.sub-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isFollowup = tab.dataset.subtab === 'followup';
    document.getElementById('subtab-invite').style.display = isFollowup ? 'none' : '';
    document.getElementById('subtab-followup').style.display = isFollowup ? '' : 'none';
    state.pitchType = isFollowup ? 'follow_up' : 'invite';
    document.getElementById('result-area').style.display = 'none';
    document.getElementById('fu-regen-section').style.display = 'none';
    if (isFollowup) {
      document.getElementById('fu-channel-card').style.display = 'none';
      // 同步目前的模式顯示
      const mode = state.followUp.mode || 'search';
      const hasLoaded = !!state.followUp.loadedSurvey;
      
      document.getElementById('fu-mode-search').style.display = mode === 'search' ? '' : 'none';
      // 搜尋模式下，只有在「已載入客戶」時才顯示問卷區；輪廓模式下則恆顯示
      document.getElementById('fu-mode-profile').style.display = (mode === 'profile' || (mode === 'search' && hasLoaded)) ? '' : 'none';
      
      if (mode === 'search') {
        loadPregeneratedPitches();
      } else {
        renderQuestionnaire(state.followUp.industry || 'manufacturing');
      }
    }
  });
});

// ---- 模式切換（搜尋 vs 輪廓）----
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    state.followUp.mode = mode;
    document.getElementById('fu-mode-search').style.display = mode === 'search' ? '' : 'none';
    document.getElementById('fu-mode-profile').style.display = mode === 'profile' ? '' : 'none';
    if (mode === 'profile') {
      document.getElementById('fu-channel-card').style.display = '';
    } else {
      const val = document.getElementById('fu-customer-search').value.trim();
      document.getElementById('fu-channel-card').style.display = val.length >= 2 ? '' : 'none';
      // 首次進入搜尋模式時載入預先說帖清單
      if (!state.followUp.pregenLoaded) {
        state.followUp.pregenLoaded = true;
        loadPregeneratedPitches();
      }
    }
  });
});

// ---- 預先生成說帖清單 ----
let _pregenAllData = [];

async function loadPregeneratedPitches(q = '') {
  const section = document.getElementById('fu-pregenerated-section');
  const listEl = document.getElementById('fu-pregen-list');
  const countEl = document.getElementById('fu-pregen-count');
  section.style.display = '';
  listEl.innerHTML = '<div class="pregen-empty">載入中…</div>';

  try {
    const userCode = localStorage.getItem('user_code') || '';
    const userName = localStorage.getItem('ad_name') || '';
    const url = `/api/admin/survey/search?list_generated=1&user_name=${encodeURIComponent(userName)}${q ? '&q=' + encodeURIComponent(q) : ''}`;
    const res = await fetch(url, { headers: { 'X-User-Code': userCode } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _pregenAllData = data.results || [];
    countEl.textContent = _pregenAllData.length;
    renderPregeneratedList(_pregenAllData);
  } catch (err) {
    listEl.innerHTML = `<div class="pregen-empty">載入失敗：${err.message}</div>`;
  }
}

function renderPregeneratedList(items) {
  const listEl = document.getElementById('fu-pregen-list');
  if (items.length === 0) {
    listEl.innerHTML = '<div class="pregen-empty">目前沒有預先生成的說帖，請至後台執行批量生成。</div>';
    return;
  }

  const TIER_LABELS = { P1: 'P1 立即推進', P2: 'P2 積極培育', P3: 'P3 案例升溫', P4: 'P4 長期培育' };

  listEl.innerHTML = items.map(r => {
    const hasPitch = !!r.pregenerated_content;
    const tierStr = hasPitch ? (r.tier_label || '').split('-')[0] : '';
    const tierDisplay = TIER_LABELS[tierStr] || (r.tier_label || '');
    const signals = Array.isArray(r.signals) ? r.signals : [];
    const attended = r.attended ? '✔到場' : '✖未到';
    const survey = r.has_survey ? '✔問卷' : '—';
    return `
      <div class="pregen-item ${hasPitch ? 'has-pitch' : 'no-pitch'}" id="pregen-item-${r.pitch_id || r.id}">
        <div class="pregen-item-header" onclick="${hasPitch ? `togglePregenItem(${r.pitch_id})` : `selectNoPitchCustomer('${escapeHtml(r.customer_code)}', ${r.id})`}">
          <div class="pregen-item-meta">
            <code>${escapeHtml(r.customer_code || '')}</code>
            <span class="pregen-company">${escapeHtml(r.company_name || '')}</span>
            <span class="pregen-contact">${escapeHtml(r.contact_name || '')}</span>
            ${hasPitch ? (tierStr ? `<span class="pregen-tier-badge ${tierStr}">${escapeHtml(tierDisplay)}</span>` : '') : '<span class="pregen-no-pitch-badge">無預生說帖</span>'}
            <small style="color:var(--text-secondary)">${attended} · ${survey} · ${signals.length} 訊號</small>
          </div>
          <span class="pregen-expand-icon" id="pregen-icon-${r.pitch_id || r.id}">${hasPitch ? '▸' : '⚡️'}</span>
        </div>
        ${hasPitch ? `
        <div class="pregen-item-detail" id="pregen-detail-${r.pitch_id}">
          <div class="pregen-content-wrap">
            <div class="pregen-content-text" data-pitch-raw="${escapeHtml(r.pregenerated_content || '')}"></div>
          </div>
          <div class="pregen-regen-bar">
            <span class="pregen-regen-label">選擇渠道重新生成：</span>
            <div class="pregen-regen-channels">
              <label><input type="radio" name="pregen-ch-${r.pitch_id}" value="phone"> 📞 電話</label>
              <label><input type="radio" name="pregen-ch-${r.pitch_id}" value="visit"> 🤝 面訪</label>
              <label><input type="radio" name="pregen-ch-${r.pitch_id}" value="line"> 💬 LINE</label>
              <label><input type="radio" name="pregen-ch-${r.pitch_id}" value="email" checked> 📧 Email</label>
            </div>
            <div class="pregen-action-btns">
              <button class="pregen-use-btn" onclick="usePregenPitch(${r.pitch_id})">直接使用</button>
              <button class="pregen-regen-btn" onclick="regenPregenPitch(${r.pitch_id}, '${escapeHtml(r.customer_code)}', '${escapeHtml(r.industry_type || 'manufacturing')}', ${JSON.stringify(signals).replace(/"/g, '&quot;')})">重新生成</button>
            </div>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');
}

window.selectNoPitchCustomer = function(customerCode, surveyId) {
  const item = _pregenAllData.find(r => r.id === surveyId);
  if (!item) return;
  loadSurveyCustomer(item);
  document.getElementById('fu-customer-search').value =
    `${item.customer_code} — ${item.company_name}${item.contact_name ? ' / ' + item.contact_name : ''}`;
  showToast(`已選取 ${item.company_name || item.customer_code}，請手動生成說帖`);
};

window.togglePregenItem = function(pitchId) {
  const detail = document.getElementById(`pregen-detail-${pitchId}`);
  const icon = document.getElementById(`pregen-icon-${pitchId}`);
  if (!detail) return;
  const isOpen = detail.classList.toggle('open');
  if (icon) icon.textContent = isOpen ? '▾' : '▸';
  if (isOpen) {
    const contentEl = detail.querySelector('.pregen-content-text');
    if (contentEl && contentEl.dataset.pitchRaw && !contentEl.dataset.rendered) {
      renderPitchContent(contentEl.dataset.pitchRaw, contentEl);
      contentEl.dataset.rendered = '1';
    }
  }
};

window.usePregenPitch = function(pitchId) {
  const item = _pregenAllData.find(r => r.pitch_id === pitchId);
  if (!item) return;
  state.currentContent = item.pregenerated_content;
  state.currentPitchId = pitchId;
  resultContent.textContent = item.pregenerated_content;
  resultArea.style.display = 'block';
  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));
  showToast(`已載入 ${item.company_name || item.customer_code} 的說帖`);
};

window.regenPregenPitch = async function(pitchId, customerCode, industryType, signals) {
  const ch = document.querySelector(`input[name="pregen-ch-${pitchId}"]:checked`)?.value || 'email';
  const item = _pregenAllData.find(r => r.pitch_id === pitchId);
  if (!item) return;

  const channelMap = { phone: '電話話術', visit: '面訪話術', line: 'LINE訊息', email: 'Email' };
  const btn = document.querySelector(`#pregen-item-${pitchId} .pregen-regen-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }

  try {
    const payload = {
      pitch_type: 'follow_up',
      industry: industryType === 'manufacturing' ? '製造業' : '流通/零售',
      industry_code: industryType,
      signals: Array.isArray(signals) ? signals : [],
      contact_method: ch,
      channel: channelMap[ch] || ch,
      customer_code: customerCode,
      company_name: item.company_name || '',
      customer_name: item.company_name || customerCode,
      role: '',
      user_code: localStorage.getItem('user_code'),
      author: localStorage.getItem('custom_nickname') || localStorage.getItem('ad_name') || '匿名業務',
    };
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || '生成失敗');

    state.currentPitchId = result.id;
    state.currentContent = result.content;
    resultContent.textContent = result.content;
    resultArea.style.display = 'block';
    resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));
    showToast(`已重新生成 ${channelMap[ch]} 版本說帖`);
  } catch (err) {
    showToast(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '重新生成'; }
  }
};

// 預先說帖清單搜尋防抖
let _pregenSearchTimer = null;
document.getElementById('fu-pregen-search')?.addEventListener('input', e => {
  clearTimeout(_pregenSearchTimer);
  _pregenSearchTimer = setTimeout(() => {
    const q = e.target.value.trim();
    loadPregeneratedPitches(q);
  }, 300);
});

// ---- 產業切換 ----
document.querySelectorAll('.industry-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.industry-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.followUp.industry = btn.dataset.industry;
    state.followUp.signals = [];
    renderQuestionnaire(btn.dataset.industry);
    document.getElementById('fu-channel-card').style.display = '';
  });
});

// ---- 搜尋模式：防抖 + autocomplete ----
let _surveySearchTimer = null;

document.getElementById('fu-customer-search').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  state.followUp.customerName = val || null;
  document.getElementById('fu-channel-card').style.display = val.length >= 2 ? '' : 'none';
  if (val.length >= 2) {
    document.getElementById('btn-generate-followup').disabled =
      !document.querySelector('input[name="fu-channel"]:checked');
  }

  // 若已有帶入客戶資料，清除（使用者重新輸入表示要換人）
  if (state.followUp.loadedSurvey) {
    clearLoadedSurvey();
  }

  // 防抖搜尋：至少 2 字才發 API
  clearTimeout(_surveySearchTimer);
  const resultsEl = document.getElementById('fu-customer-results');
  if (val.length < 2) { resultsEl.style.display = 'none'; return; }

  _surveySearchTimer = setTimeout(async () => {
    try {
      const userCode = localStorage.getItem('user_code') || '';
      const res = await fetch(`/api/admin/survey/search?q=${encodeURIComponent(val)}`, {
        headers: { 'X-User-Code': userCode },
      });
      if (!res.ok) { resultsEl.style.display = 'none'; return; }
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) { resultsEl.style.display = 'none'; return; }

      // 依 customer_code 分組，同一法人顯示所有聯絡人
      const grouped = [];
      const groupMap = {};
      for (const r of results) {
        if (!groupMap[r.customer_code]) {
          groupMap[r.customer_code] = { code: r.customer_code, company: r.company_name, industry: r.industry_type, contacts: [] };
          grouped.push(groupMap[r.customer_code]);
        }
        groupMap[r.customer_code].contacts.push(r);
      }

      resultsEl.innerHTML = grouped.map(g => {
        const industryTag = g.industry === 'manufacturing' ? '製造' : '流通';
        const contactsHtml = g.contacts.map(r => {
          const hasPitch = !!r.pregenerated_content;
          const attended = r.attended ? '✔到場' : '✖未到';
          const survey = r.has_survey ? '✔問卷' : '—';
          const signalCount = (r.signals || []).length;
          return `<div class="customer-ac-contact" data-customer='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
            <span class="ac-contact-name">${escapeHtml(r.contact_name || '（未知）')}</span>
            ${r.job_title ? `<span class="ac-contact-title">${escapeHtml(r.job_title)}</span>` : ''}
            <span class="ac-contact-meta">${attended} · ${survey} · ${signalCount} 訊號</span>
            ${hasPitch ? '<span class="ac-pitch-badge">有說帖</span>' : ''}
          </div>`;
        }).join('');
        return `<div class="customer-ac-group">
          <div class="customer-ac-group-header">
            <strong>${escapeHtml(g.code)}</strong>
            <span>${escapeHtml(g.company || '')}</span>
            <span class="ac-industry-tag">${industryTag}</span>
            <small style="color:var(--text-secondary);margin-left:auto;">${g.contacts.length} 位聯絡人</small>
          </div>
          ${contactsHtml}
        </div>`;
      }).join('');
      resultsEl.style.display = 'block';

      // 點擊聯絡人帶入
      resultsEl.querySelectorAll('.customer-ac-contact').forEach(item => {
        item.addEventListener('click', () => {
          try {
            const customer = JSON.parse(item.dataset.customer);
            loadSurveyCustomer(customer);
            document.getElementById('fu-customer-search').value =
              `${customer.customer_code} — ${customer.company_name}${customer.contact_name ? ' / ' + customer.contact_name : ''}`;
            resultsEl.style.display = 'none';
          } catch { /* noop */ }
        });
      });
    } catch { resultsEl.style.display = 'none'; }
  }, 300);
});

// 點擊其他地方收起下拉
document.addEventListener('click', (e) => {
  if (!e.target.closest('#fu-mode-search')) {
    document.getElementById('fu-customer-results').style.display = 'none';
  }
});

// 帶入問卷客戶資料
function loadSurveyCustomer(customer) {
  state.followUp.loadedSurvey = customer;
  state.followUp.customerName = customer.company_name || customer.customer_code;

  const signals = Array.isArray(customer.signals)
    ? customer.signals
    : (() => { try { return JSON.parse(customer.signals); } catch { return []; } })();

  // 1. 切換到「依客戶輪廓」模式讓問卷可以顯示和勾選
  const industry = customer.industry_type || 'manufacturing';
  document.querySelectorAll('.industry-btn').forEach(b => b.classList.remove('active'));
  const targetIndustryBtn = document.querySelector(`.industry-btn[data-industry="${industry}"]`);
  if (targetIndustryBtn) {
    targetIndustryBtn.classList.add('active');
    state.followUp.industry = industry;
  }

  // 2. 確保問卷容器在搜尋模式下也能顯示（用於顯示載入的資料）
  document.getElementById('fu-mode-profile').style.display = 'block';
  renderQuestionnaire(industry);

  // 3. 勾選對應訊號
  signals.forEach(code => {
    const input = document.querySelector(`#fu-questionnaire input[value="${code}"]`);
    if (input) input.checked = true;
  });
  collectSignals();

  // 4. 顯示帶入資訊橫幅
  const banner = document.getElementById('fu-loaded-customer');
  const infoSpan = document.getElementById('fu-loaded-info');
  infoSpan.textContent =
    `✅ 已帶入：${customer.customer_code} — ${customer.company_name || ''} （${signals.length} 個訊號）`;
  banner.style.display = 'flex';

  // 5. 若有預先生成說帖，直接顯示在回訪說帖的結果區
  if (customer.pregenerated_content) {
    state.currentContent = customer.pregenerated_content;
    state.currentPitchId = customer.pitch_id || null;
    const fuResultArea = document.getElementById('fu-result-area');
    const fuResultContent = document.getElementById('fu-result-content');
    renderPitchContent(customer.pregenerated_content, fuResultContent);
    if (fuResultArea) {
      fuResultArea.style.display = 'block';
      fuResultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));
    showToast(`已帶入 ${customer.company_name || customer.customer_code} 的預先生成說帖`);
  } else {
    // 6. 無預先說帖：顯示渠道卡讓業務手動生成
    document.getElementById('fu-channel-card').style.display = '';
    showToast(`已帶入 ${customer.company_name || customer.customer_code} 的問卷資料`);
  }
}

function clearLoadedSurvey() {
  state.followUp.loadedSurvey = null;
  document.getElementById('fu-loaded-customer').style.display = 'none';
  // 若在搜尋模式，清除後隱藏問卷
  if (state.followUp.mode === 'search') {
    document.getElementById('fu-mode-profile').style.display = 'none';
  }
  // 清除問卷勾選
  document.querySelectorAll('#fu-questionnaire input:checked').forEach(i => { i.checked = false; });
  collectSignals();
}

// 清除按鈕
document.getElementById('fu-clear-customer')?.addEventListener('click', () => {
  document.getElementById('fu-customer-search').value = '';
  state.followUp.customerName = null;
  clearLoadedSurvey();
  document.getElementById('fu-channel-card').style.display = 'none';
});

// ---- 渠道選擇 ----
document.querySelectorAll('input[name="fu-channel"]').forEach(r => {
  r.addEventListener('change', () => {
    state.followUp.channel = r.value;
    document.getElementById('btn-generate-followup').disabled = false;
  });
});

// ---- 渲染問卷 ----
function renderQuestionnaire(industry) {
  const container = document.getElementById('fu-questionnaire');
  const questions = QUESTIONNAIRE_DATA[industry] || [];
  container.innerHTML = questions.map(q => `
    <div class="q-group">
      <div class="q-group-header">${escapeHtml(q.label)}</div>
      <div class="q-options">
        ${q.options.map(opt => `
          <label class="q-option${opt.highlight ? ' has-highlight' : ''}">
            <input type="${q.type || 'checkbox'}" name="fu-signal-${q.id}" value="${opt.code}" onchange="collectSignals()">
            <span class="q-option-label">${escapeHtml(opt.text)}</span>
            ${opt.highlight ? '<span class="signal-highlight-badge">★ 高商機</span>' : ''}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ---- 收集訊號 ----
function collectSignals() {
  state.followUp.signals = Array.from(
    document.querySelectorAll('#fu-questionnaire input:checked')
  ).map(el => el.value);
}

// ---- 生成回訪說帖 ----
document.getElementById('btn-generate-followup').addEventListener('click', () => {
  generateFollowUpPitch();
});

document.getElementById('btn-confirm-regen').addEventListener('click', () => {
  const ch = document.querySelector('input[name="fu-regen-ch"]:checked')?.value;
  if (!ch) { showToast('請先選擇聯繫渠道'); return; }
  state.followUp.channel = ch;
  document.getElementById('fu-regen-section').style.display = 'none';
  generateFollowUpPitch();
});

async function generateFollowUpPitch() {
  const channel = state.followUp.channel;
  if (!channel) { showToast('請先選擇聯繫渠道'); return; }
  collectSignals();

  const btnFU = document.getElementById('btn-generate-followup');
  btnFU.disabled = true;
  btnFU.querySelector('.btn-text').style.display = 'none';
  btnFU.querySelector('.btn-loading').style.display = 'inline-flex';
  resultArea.style.display = 'none';
  exitEditMode();

  const channelMap = { phone: '電話話術', visit: '面訪話術', line: 'LINE訊息', email: 'Email' };

  const loadedSurvey = state.followUp.loadedSurvey;
  const payload = {
    pitch_type: 'follow_up',
    industry: state.followUp.industry === 'manufacturing' ? '製造業' : '流通/零售',
    industry_code: state.followUp.industry,
    signals: state.followUp.signals,
    contact_method: channel,
    channel: channelMap[channel] || channel,
    customer_name: state.followUp.customerName || '',
    customer_code: loadedSurvey?.customer_code || null,
    company_name: loadedSurvey?.company_name || '',
    contact_name: loadedSurvey?.contact_name || '',
    role: '',
    user_code: localStorage.getItem('user_code'),
    author: localStorage.getItem('custom_nickname') || localStorage.getItem('ad_name') || '匿名業務',
  };

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || '生成失敗');

    state.currentPitchId = result.id;
    state.currentContent = result.content;

    // 顯示回訪結果區（位於 subtab-followup 內）
    const fuResultArea = document.getElementById('fu-result-area');
    const fuResultContent = document.getElementById('fu-result-content');
    renderPitchContent(result.content, fuResultContent);
    fuResultArea.style.display = 'block';
    fuResultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));

    // 若是從搜尋現有客戶生成，重新整理預先生成清單，讓該客戶顯示為「已有說帖」
    if (payload.customer_code && state.followUp.pregenLoaded) {
      loadPregenList();
    }

    state.history.unshift({
      id: result.id,
      industry: payload.industry,
      role: '',
      channel: payload.channel,
      content: result.content,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    showToast(err.message);
  } finally {
    btnFU.disabled = false;
    btnFU.querySelector('.btn-text').style.display = 'inline';
    btnFU.querySelector('.btn-loading').style.display = 'none';
  }
}

// =============================================================
// ===== P7: 年會講師素材模組 ==================================
// =============================================================

const SPEAKER_RESOURCE_MAP = {
  HYK: '2bcc29f3-f814-4123-aaea-c359d3cce226',
  HYZ: '954ec1c7-f0b2-48dc-be0d-f2485092d126',
  LYH: '3e6a722b-5d4e-427e-a780-8625dc9157c7',
  LDK: '0972fe73-b807-4b7b-b17e-a552999160d8',
  ZWN: '1cddd26f-d126-4e83-aaa8-e37202614c44',
  HCH: 'ffcd9536-e69d-4295-9d7a-4abbfbc64173',
  ZH:  '9bfe52bf-5726-436e-85ee-ee88007e0bcf',
};

const SPEAKER_DATA = [
  {
    id: 'HYK', name: '黃昱凱', title: '鼎新數智 副總裁', type: 'digiwin',
    cards: [
      { code: 'K-HYK-01', slide_ref: 'Slide 2',
        quote: '缺工不是短期問題，而是 AI 的結構性理由',
        signals: ['Q7_TALENT','Q8_WATCH','Q8_EVALUATE','Q1_INTEREST'],
        full_text: '台灣企業面臨少子化、招募留任挑戰，企業成長速度已被人力供給與熟手經驗所限制。AI 導入不只是追流行，而是面對長期人力供給下降時，必須思考的新生產力來源。這讓 AI 從「可選工具」變成「維持增長與韌性」的必要能力。',
        phrases: ['缺工不只是 HR 問題，也會變成企業成長天花板。','少子化與招募留任是結構性問題，不是短期波動。','AI 在這裡不是錦上添花，而是維持增長與韌性的必要能力。'] },
      { code: 'K-HYK-02', slide_ref: 'Slide 3',
        quote: '員工會用 AI 只是開始，不是企業生產力',
        signals: ['Q4_TRIAL','Q4_POINT','Q6_FREQUENCY','Q7_DATA','Q8_EVALUATE'],
        full_text: 'AI 若只停留在個人生產力提升，無法達到組織增長。員工會使用 AI 工具只是開始，若 AI 沒有融入企業運行流程，知識仍停留在人身上。個人效率提升，可能讓錯誤轉嫁給主管覆核，反而加重組織負擔。',
        phrases: ['同仁用 ChatGPT 是好事，但還不是企業 AI 生產力。','下一步不是多買工具，而是讓成果進到公司流程。','AI 要從個人用、走到部門用、最後到企業級運行。'] },
      { code: 'K-HYK-03', slide_ref: 'Slide 5-7',
        quote: '分身不是替身：人做智慧的事，AI 做智能的事',
        signals: ['Q6_KNOWLEDGE','Q6_EXPERIENCE','Q7_RESISTANCE','Q7_TALENT'],
        full_text: '鼎新的設計是「分身」不是「替身」。分身需要透過人的授權，目標不是取代人，而是讓人做智慧的事，AI 做智能的事。個人分身懂使用者，企業分身懂制度，能把人的判斷經驗沉澱為組織能力。',
        phrases: ['我們談的是分身，不是替身。','人做智慧的事，AI 做智能的事。','AI 負責整理、追蹤、執行；人保留方向、判斷、授權。'] },
      { code: 'K-HYK-04', slide_ref: 'Slide 8-9',
        quote: 'AI 進 ERP 前，身份、權限、查核要先定義',
        signals: ['Q4_INTEGRATED','Q5_FINANCE','Q5_SUPPLY_CHAIN','Q7_DATA','Q8_BUDGET'],
        full_text: 'AI 若進入 ERP，數據、金額錯誤都會造成營運風險。若涉及 MES、APS、簽核、採購或跨部門協作，就必須先處理身份、權限、授權、查核、內控與風控。C 端可以改答案，B 端差一塊錢就要追溯，治理必須先到位。',
        phrases: ['AI 一旦進 ERP、MES、APS，就不能只談模型能力。','誰授權、能做什麼、做到哪裡、錯了誰覆核，都要先定義。','C 端可以改答案，B 端差一塊錢就要追溯。'] },
      { code: 'K-HYK-05', slide_ref: 'Slide 4, 10',
        quote: '企業運行空間是 AI 原生企業的 OS',
        signals: ['Q4_FULL','Q7_DATA','Q7_TALENT','Q8_EVALUATE'],
        full_text: '企業運行空間是 AI 原生企業的作業系統，整合 AI 記憶、模型能力、結構化資料與非結構化資料。AI 原生企業需要資料底座、治理機制、權限控管與運行環境，才能從工具使用走向企業能力。沒有完整資料與 API，Agent 很難真正辦得成事。',
        phrases: ['企業運行空間像 OS，是 AI 原生企業的基礎設施。','要從個人 AI 走到企業 Agent，底下要有完整運行環境。','沒有資料可用性，Agent 很難真正辦得成事。'] },
      { code: 'K-HYK-06', slide_ref: 'Slide 10',
        quote: '數位勞動力補營收成長與人力需求的缺口',
        signals: ['Q7_TALENT','Q8_BUDGET','Q5_SUPPLY_CHAIN','Q6_WORKLOAD'],
        full_text: '傳統企業營收增加時，人力需求通常也等比例增加。AI 原生企業的目標，是透過數位勞動力補足這段缺口，讓營收成長不必完全等比例依賴人力成長。對成長中但人補不上的企業，這是 AI 最直接的價值主張。',
        phrases: ['數位勞動力補足營收成長與人力需求之間的缺口。','營收再漲一成，不該等比例多十個人。','AI 讓企業不被招募速度卡住。'] },
      { code: 'K-HYK-07', slide_ref: 'Slide 9-10',
        quote: 'AI 三階段：Copilot、Agent 加入團隊、指揮多分身',
        signals: ['Q4_TRIAL','Q8_EVALUATE','Q8_WATCH','Q6_KNOWLEDGE'],
        full_text: '企業 AI 發展分三個階段：第一階段是 Copilot（人加 AI）；第二階段是人加 Agent，讓 Agent 加入協作；第三階段是人作為 Commander，AI Agent 負責運營。不同階段要補的能力不同，越往後越需要資料、權限、治理與流程整合。',
        phrases: ['AI 發展三階段：員工用 AI、Agent 加入團隊、人指揮多分身。','不同階段需要補的能力不同。','先判斷貴公司現在在哪一階段，下一步才清楚。'] },
    ]
  },
  {
    id: 'HYZ', name: '黃盈彰', title: '鼎新數智 總經理', type: 'digiwin',
    cards: [
      { code: 'K-HYZ-01', slide_ref: 'Slide 2',
        quote: 'AI 落地要先過信任、治理、起步、效益四道門檻',
        signals: ['Q4_NONE','Q4_TRIAL','Q7_RESISTANCE','Q7_ROI','Q8_WATCH'],
        full_text: '企業 AI 落地有四道門檻：信任、治理、起步、效益。現實中很多企業第一步就卡在信任，第二步還不知道怎麼治理，導致起步與 ROI 評估都延後。不應急著推大規模導入，而是先拆解卡點：是信任、治理，還是場景不清楚？',
        phrases: ['AI 落地不是先買工具，而是先過信任、治理、起步、效益四道門檻。','企業 AI 常見的不是不想做，而是先卡在不相信可控。','先把卡點分層，反而更容易找到第一步。'] },
      { code: 'K-HYZ-02', slide_ref: 'Slide 4',
        quote: '智慧底座讓 AI 讀懂企業的資料、流程、邏輯與權限',
        signals: ['Q4_POINT','Q4_INTEGRATED','Q7_DATA','Q7_TALENT','Q8_EVALUATE'],
        full_text: '智慧底座把企業核心系統中的數據、流程、邏輯與權限，改造成 AI 可理解、可調用、可治理的能力。即使客戶已使用多年 ERP，也不必推翻重來，而是讓底層能被 AI 讀懂。沒有智慧底座，AI Agent 只能接觸表層，很難進入正式流程。',
        phrases: ['鼎新的主張不是先追求最聰明的模型，而是先把智慧底座建好。','AI 不用從零做起，但要讓 AI 讀得懂現有資料與流程。','智慧底座是企業 AI 能進核心系統的前提。'] },
      { code: 'K-HYZ-03', slide_ref: 'Slide 3, 7',
        quote: 'AI 要成為能力放大器，而不是風險放大器',
        signals: ['Q4_TRIAL','Q4_POINT','Q7_DATA','Q7_RESISTANCE'],
        full_text: '企業級 AI 需要安全品質控制、自我反饋閉環、人機確認節點與全程可觀測性，才能避免 AI 越界、幻覺或決策不可追溯。讓 AI 成為能力放大器而不是風險放大器，中間只隔一個治理設計。',
        phrases: ['AI 不是不能用，而是要有護欄。','越靠近營運核心，越需要定義 AI 能做什麼、不能做什麼。','能力放大器與風險放大器，中間只隔一個治理設計。'] },
      { code: 'K-HYZ-04', slide_ref: 'Slide 8-9',
        quote: 'Server 管企業知識，Edge 捕獲個人經驗',
        signals: ['Q4_POINT','Q4_INTEGRATED','Q6_KNOWLEDGE','Q6_EXPERIENCE','Q7_TALENT'],
        full_text: 'Digiwin AI Server 負責企業級知識管理、跨部門協作與權限安控；AI Edge 在員工身邊捕獲業務過程、決策習慣與個人經驗。這讓企業不只記錄 ERP 的結果，也能捕捉「為什麼這樣決策」，讓資深判斷邏輯被系統化沉澱。',
        phrases: ['很多系統只記錄結果，但沒記錄為什麼這樣決定。','Edge 捕獲判斷過程，Server 沉澱成組織智慧。','資深經驗不該隨人離職而流失。'] },
      { code: 'K-HYZ-05', slide_ref: 'Slide 12-17',
        quote: '急單場景 AI 可召集業務、生管、採購等分身協作',
        signals: ['Q5_SUPPLY_CHAIN','Q5_DECISION','Q6_FREQUENCY','Q8_BUDGET'],
        full_text: '以大客急單為案例：提前 7 天交貨，AI Agent 可讀取郵件、Excel，轉成待辦清單，召集業務、生管、採購、庫存等職能分身，完成合規檢核、庫存查核、訂單生成與 ERP 錄入。跨部門急件是最容易看出 AI-AI 協同價值的場景。',
        phrases: ['急單不用靠五通電話，AI 可以直接召集跨部門分身協作。','從雜訊到待辦，Agent 讓跨部門訊號變成可執行任務。','合規、庫存、產能可以同步檢核，不再等人來回確認。'] },
      { code: 'K-HYZ-06', slide_ref: 'Slide 18-19',
        quote: 'AI 可集結財務、採購、供應鏈分身做情境推演',
        signals: ['Q5_SUPPLY_CHAIN','Q5_DECISION','Q6_KNOWLEDGE','Q8_BUDGET'],
        full_text: '面對原物料暴漲與關稅衝擊，AI 可集結財務、採購、供應鏈等虛擬專家，進行多輪討論，盤點安全庫存、計算資產風險、推演不同策略對毛利的影響，最後形成風險評估報告。把「決策推演」從單人經驗判斷，變成多分身協同分析。',
        phrases: ['決策不再只靠一個人的經驗，而是多分身同時盤點。','原物料、關稅、匯率的影響可以即時推演。','風險評估報告不用等週會，而是幾分鐘內就能產出。'] },
      { code: 'K-HYZ-07', slide_ref: 'Slide 24-26',
        quote: '製造現場從追異常進化成預警、分析、執行閉環',
        signals: ['Q5_SUPPLY_CHAIN','Q6_EXPERIENCE','Q6_WORKLOAD','Q7_ROI'],
        full_text: '製造主管可直接詢問 Agent 哪些工單快過期，Agent 讀取工單與 OT 數據，抓出逾期工單、診斷進度健康度、判斷設備負載，並在確認後聯動系統完成操作。設備滯後時，Agent 分析連鎖影響並提出改道方案，讓現場從「事後追趕」進化成「先期預控」。',
        phrases: ['主管不用再每天追工單，Agent 直接抓出逾期與連鎖風險。','設備負載、產能、排程可以被連動調整。','異常從事後救火，變成事前預控。'] },
      { code: 'K-HYZ-08', slide_ref: 'Slide 27-31',
        quote: '未來競爭力不在誰有 AI，而在誰管得好 AI',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q7_DATA','Q7_TALENT','Q8_BUDGET'],
        full_text: '未來企業不再只買 IT 系統，而是聘請數位勞動力。組織邊界從部門邊界，升級為權限、規則與任務場景邊界。實體組織負責授權、法律責任與目標設定，數智組織負責任務交付；治理不是事後稽核，而是內嵌於每一次 Agent 執行中。',
        phrases: ['未來的差距不在誰有 AI，而在誰能管理 AI。','組織邊界會從部門升級為權限、規則、任務場景。','治理不是稽核，而是內嵌於每次 Agent 執行中。'] },
    ]
  },
  {
    id: 'LYH', name: '李義訓', title: '鼎新數智流通事業群 副總裁', type: 'digiwin',
    cards: [
      { code: 'K-LYH-01', slide_ref: 'Slide 3-4',
        quote: '缺工不只是人數問題，而是經驗與判斷力流失',
        signals: ['Q5_SUPPLY_CHAIN','Q5_DECISION','Q6_KNOWLEDGE','Q6_EXPERIENCE','Q7_TALENT'],
        full_text: '客戶若只把問題看成缺工，容易只想到補人或自動化。更深層的問題是現場判斷力與經驗流失。AI 的價值不是單純替代體力，而是把知識、經驗、專業沉澱下來，讓企業不再過度依賴少數資深人員。',
        phrases: ['缺工只是表層，真正的風險是現場判斷力與經驗流失。','AI 要補的不是人數，而是熟手經驗與判斷力。','資深同仁離職前，經驗應該先被沉澱成企業資產。'] },
      { code: 'K-LYH-02', slide_ref: 'Slide 5, 12',
        quote: '個人用 AI 不等於企業 AI 生產力',
        signals: ['Q4_TRIAL','Q4_POINT','Q7_DATA','Q7_ROI','Q8_EVALUATE'],
        full_text: '個人使用 AI 可以提升效率，但企業不一定因此提升整體生產力。若沒有數據基礎、流程整合、權限控管與可追溯，AI 可能只在個人層面產生零散效益，甚至把錯誤轉嫁給組織。真正的企業 AI 生產力，需要正式流程、可沉澱的知識與可管理的運作。',
        phrases: ['員工會用 AI，不代表企業具備 AI 生產力。','個人效率提升可能讓主管花更多時間覆核錯誤。','AI 要從個人工具走向公司可控、可沉澱、可複製的能力。'] },
      { code: 'K-LYH-03', slide_ref: 'Slide 8-9',
        quote: 'AI 進正式流程要看誰能用、做到哪、怎麼追溯',
        signals: ['Q4_INTEGRATED','Q5_FINANCE','Q5_DECISION','Q7_DATA','Q8_BUDGET'],
        full_text: '企業 AI 與個人 AI 最大差異在責任與可控性。治理拆成三個關鍵：身份可識別、權限可界定、決策可追溯。若 AI 要進入正式流程，不能只問模型準不準，而要先問：誰在用、能做什麼、決策怎麼追溯。鼎新的作法是讓 AI 成為有身份的運作單位。',
        phrases: ['企業級 AI 要先回答三件事：誰在做、能做什麼、決策怎麼追溯。','AI 進正式流程，治理不是選配而是標配。','鼎新的作法是讓 AI 成為有身份的運作單位，不是一個模糊工具。'] },
      { code: 'K-LYH-04', slide_ref: 'Slide 6-7, 10',
        quote: '數智分身不是聊天工具，是企業協作能力',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q6_FREQUENCY','Q6_KNOWLEDGE','Q8_BUDGET'],
        full_text: '數智分身不是單點問答工具，而是把特定角色、場景或專業能力沉澱成可協作的 AI 代理。它讓企業突破「營收成長必然帶動人力成長」的限制，人負責方向與判斷，AI 分身負責感知、整理、分析、推進與執行。',
        phrases: ['分身不是聊天工具，是把知識、經驗、專業沉澱成可協作的企業能力。','從員工用 AI，到 AI 加入團隊，再到人指揮多個分身協作。','讓人做智慧的事，AI 做智能的事。'] },
      { code: 'K-LYH-05', slide_ref: 'Slide 12',
        quote: '用四高選 AI 場景：高負荷、高頻、高知識、高經驗',
        signals: ['Q6_FREQUENCY','Q6_KNOWLEDGE','Q6_EXPERIENCE','Q6_WORKLOAD','Q7_ROI','Q8_EVALUATE'],
        full_text: '第一個場景不應只看技術可不可做，而要看是否符合高負荷、高頻次、高知識、高經驗。這類場景通常痛點明確、效益容易被看見，也更容易延伸到數智分身或企業級 Agent。符合的條件越多，越值得先做。',
        phrases: ['第一個 AI 場景可以用四高篩選：高負荷、高頻次、高知識、高經驗。','符合越多條件，越容易看出效益。','不知道從哪開始，就從這四個維度盤點。'] },
      { code: 'K-LYH-06', slide_ref: 'Slide 11, 7',
        quote: 'AI 不是取代資深員工，而是放大經驗與傳承',
        signals: ['Q7_RESISTANCE','Q7_TALENT','Q8_EVALUATE','Q8_WATCH'],
        full_text: 'AI 轉型不只是替代人，而是重新定義人的價值。資深員工不是被 AI 取代，而是能把經驗轉成企業知識與數智分身的高品質判斷基礎；新進員工則透過 AI 提升感知、思考與行動能力。資深員工投入越深，企業知識沉澱越完整。',
        phrases: ['AI 不是把資深員工取代，而是把資深經驗放大、沉澱、傳承。','資深員工投入越深，企業知識沉澱越完整。','AI 協作讓新人也能做出穩定判斷。'] },
    ]
  },
  {
    id: 'LDK', name: '林大馗', title: 'KPMG Advisory 執行董事', type: 'external',
    cards: [
      { code: 'K-LDK-01', slide_ref: 'Slide 3, 5',
        quote: 'CEO 關注的不只是 AI 功能，而是 ROI 時間感',
        signals: ['Q7_ROI','Q8_EVALUATE','Q8_WATCH','Q1_INTEREST'],
        full_text: 'AI 不只是部門工具，而是企業成長、營運效率、人才與風險管理的策略議題。若客戶擔心 ROI，應避免直接推大型願景，而是先協助找出能在短期驗證價值的場景。ROI 不是先從模型算，而是從可衡量的小場景算起。',
        phrases: ['AI 已經進入 CEO 關注的成長與營運議題。','ROI 要推進，必須先把價值指標定清楚。','從可量化的小場景開始，比從大願景談投報更有說服力。'] },
      { code: 'K-LDK-02', slide_ref: 'Slide 8-9',
        quote: 'AI 落地三要素：Value、Data、People',
        signals: ['Q4_NONE','Q4_TRIAL','Q4_POINT','Q7_DATA','Q7_TALENT','Q8_EVALUATE'],
        full_text: '導入 AI 可用三個維度做初步診斷：Value 是否清楚、Data 是否可用、People 是否具備能力與接受度。這能避免只從技術或工具出發，而忽略價值與組織承接能力。三個維度越清楚，越適合推進。',
        phrases: ['AI 落地可以先看三件事：Value、Data、People。','不要只看工具，要看價值、資料、人是否到位。','三個維度越清楚，越容易找到該從哪裡開始。'] },
      { code: 'K-LDK-03', slide_ref: 'Slide 10-13',
        quote: '資料治理沒做好，Gen AI 會外洩或幻覺',
        signals: ['Q4_POINT','Q4_INTEGRATED','Q7_DATA','Q8_BUDGET'],
        full_text: '資料治理是 AI 落地的前提。對製造業而言，資料治理影響生產資料場景、設備品質、稼動率分析與品質改善。若資料分級、定義、品質與權限不清楚，AI Agent 越深入流程，風險越高。',
        phrases: ['資料治理沒做好，Gen AI 容易出現外洩、幻覺與錯誤決策。','AI 越深入流程，資料風險越高。','數據品質、分級、權限，是 AI 落地的前提。'] },
      { code: 'K-LDK-04', slide_ref: 'Slide 16-17',
        quote: '員工私下用 AI 比你想的多，Shadow AI 已經在發生',
        signals: ['Q4_TRIAL','Q4_POINT','Q7_RESISTANCE','Q7_DATA','Q8_WATCH'],
        full_text: 'Shadow AI 指員工私下使用未受控的 AI 工具。這類客戶不一定未導入 AI，而是 AI 已在組織中發生，只是還沒有管理。禁止用不現實，建立可控環境更重要。企業該問的是有多少員工在用、用什麼、上傳了什麼。',
        phrases: ['很多企業不是沒有 AI，而是已經有 Shadow AI，只是還沒有治理。','禁止用不現實，建立可控環境更重要。','企業該問的是有多少員工在用、用什麼、上傳了什麼。'] },
      { code: 'K-LDK-05', slide_ref: 'Slide 18-20',
        quote: '可信任 AI 需要治理、公平、隱私、資安、透明、永續',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q7_DATA','Q7_ROI','Q8_BUDGET'],
        full_text: '可信任 AI 不只是資安問題，而是完整治理框架，包含治理問責、公平性、隱私、資安、透明度與永續性，並在 AI 規劃、建置與上線後持續評估風險。這是 AI 進入核心流程前必須同步建立的框架。',
        phrases: ['可信任 AI 不是單一資安控管，而是六個原則的整體框架。','治理問責、公平、隱私、資安、透明、永續，六個都要顧。','AI 進核心流程前，治理框架要同步設計。'] },
      { code: 'K-LDK-06', slide_ref: 'Slide 20-22',
        quote: 'Agent 能用工具之前，要先定義工具監督與人類確認',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q6_FREQUENCY','Q7_DATA','Q8_BUDGET'],
        full_text: '當 AI Agent 能調用工具、讀寫系統時，風險不只來自模型本身，也來自工具選擇、使用與監控。企業必須定義哪些工具可被調用、誰監督、多久驗證、風險等級如何分級。上線前後都需要風險評估，人類介入節點要清楚定義。',
        phrases: ['Agent 能用工具之前，要先定義工具選擇、使用、監控與人類監督。','風險不只來自模型，也來自 Agent 能做什麼。','上線前風險評估、上線後持續監控，不是單次動作。'] },
    ]
  },
  {
    id: 'ZWN', name: '詹文男', title: '數位轉型學院 院長', type: 'external',
    cards: [
      { code: 'K-ZWN-01', slide_ref: 'Slide 9-11',
        quote: 'Agent 已從工具變成數位員工',
        signals: ['Q4_TRIAL','Q4_POINT','Q6_FREQUENCY','Q6_WORKLOAD','Q8_WATCH'],
        full_text: 'AI 已從工具逐漸變成夥伴與數位員工。Agent 可以持續執行任務，協助每日早報、競爭情報、收件箱管理、跨工具操作等工作。對企業而言，重點是能否形成 24 小時營運能力與更高人均產值。',
        phrases: ['Agentic AI 的下一步，是從工具變成數位員工。','從被動問答，到持續執行、24 小時運作。','人均產值可以被 Agent 大幅放大。'] },
      { code: 'K-ZWN-02', slide_ref: 'Slide 17-19',
        quote: '供應鏈 Agent 可做比價、風險分析、議價',
        signals: ['Q5_SUPPLY_CHAIN','Q6_KNOWLEDGE','Q6_WORKLOAD','Q8_BUDGET'],
        full_text: '在供應鏈管理中，Agent 可根據規格、數量與預算理解採購需求，自動搜尋供應商、分析風險、比較交期與品質、比價、議價，並在符合公司政策時下單。適合對應製造業客戶的採購、交期與風險管理痛點。',
        phrases: ['供應鏈 Agent 可以先從找供應商、比價、風險分析、議價建議開始。','不用一開始就全自動下單，可以先做半自動。','採購繁瑣、資料分散、決策靠人，Agent 最能發揮。'] },
      { code: 'K-ZWN-03', slide_ref: 'Slide 24-28',
        quote: '三類 Agent：流程、決策、行動自動化',
        signals: ['Q4_NONE','Q4_TRIAL','Q4_INTEGRATED','Q6_FREQUENCY','Q6_KNOWLEDGE'],
        full_text: 'Agent 分三類：Workflow Agent 照流程做事（流程自動化）；Autonomous Agent 可參與判斷（決策智慧化）；Software + Hardware Agent 能動手執行（行動自動化與數位勞動力）。企業可依成熟度逐步推進，而不是一開始就追求全自動。',
        phrases: ['三類 Agent 對應三個成熟階段：流程、決策、行動。','不用一開始就追求全自動，可以階段性推進。','先判斷現在在哪一層，下一步才清楚。'] },
      { code: 'K-ZWN-04', slide_ref: 'Slide 26',
        quote: '流程沒理順，AI 只會加速混亂',
        signals: ['Q4_NONE','Q4_TRIAL','Q7_DATA','Q7_ROI','Q8_WATCH'],
        full_text: '第一階段流程自動化的關鍵不是導入 AI，而是先做流程盤點。若流程是亂的，AI 只會加速混亂。適合用於尚未起步或剛開始局部嘗試的客戶，協助先找出低風險、可標準化、可衡量的場景。',
        phrases: ['流程沒理順，AI 只會加速混亂。','先盤點流程與責任，再談 AI。','第一個試點要低風險、高頻、可量化。'] },
      { code: 'K-ZWN-05', slide_ref: 'Slide 27',
        quote: 'AI 決策要資料 ready 且有人類監督',
        signals: ['Q4_POINT','Q4_INTEGRATED','Q5_SUPPLY_CHAIN','Q5_DECISION','Q7_DATA'],
        full_text: 'Autonomous Agent 能參與庫存預測、風險評估、智慧排程、動態定價等決策，但前提是資料即時、品質足夠、能整合。AI 會自己決策但不一定對，因此企業需要 Human-in-the-loop，讓人監督 AI 的判斷與執行。',
        phrases: ['決策智慧化的前提是資料 ready，而且要有人類監督。','AI 會自己決策，但不一定對。','Human-in-the-loop 不是多餘，是必要。'] },
      { code: 'K-ZWN-06', slide_ref: 'Slide 28-30',
        quote: '未來競爭優勢是決策速度 × 決策品質',
        signals: ['Q5_DECISION','Q6_KNOWLEDGE','Q6_EXPERIENCE','Q8_EVALUATE'],
        full_text: '高速決策型企業把決策效率視為核心競爭力。AI 讓企業在競爭情報、市場動態、內部運作資料上做到更快的洞察與判斷。未來企業的競爭優勢不只是效率，而是決策速度與決策品質的結合。',
        phrases: ['未來競爭不只看效率，更看決策速度 × 決策品質。','高速決策型企業靠 AI 整合內外部資料，更快做出正確判斷。','競爭情報、市場動態、內部運作，都要能被即時分析。'] },
      { code: 'K-ZWN-07', slide_ref: 'Slide 31-32',
        quote: '價值鏈從線性流程變成即時循環系統',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q5_SUPPLY_CHAIN','Q5_DECISION'],
        full_text: '傳統價值鏈是線性的：設計→採購→生產→銷售。AI 讓每一環都能感知下一環的狀態並即時調整，形成即時循環系統。這讓供應鏈、生產與銷售之間的資訊流從「事後同步」變成「即時協作」。',
        phrases: ['價值鏈從線性流程，變成即時循環系統。','設計、採購、生產、銷售之間的資訊不再是事後同步，而是即時協作。','AI 讓每一環都能感知下一環的狀態。'] },
      { code: 'K-ZWN-08', slide_ref: 'Slide 33-35',
        quote: 'Agent 四大挑戰：資料、技術、法規、組織',
        signals: ['Q7_DATA','Q7_RESISTANCE','Q7_TALENT','Q7_ROI','Q8_BUDGET'],
        full_text: 'Agent 導入面臨四大挑戰：資料品質與整合、技術能力與基礎設施、法規遵循與治理、以及組織文化與變革管理。對於每一項挑戰，都需要提前盤點並設計對應策略，才能讓 Agent 真正落地而非停留在 POC。',
        phrases: ['Agent 導入前要先盤點四大挑戰：資料、技術、法規、組織。','每一個挑戰都需要提前設計對應策略。','若這四項沒有準備好，Agent 很容易停在 POC，難以規模化。'] },
      { code: 'K-ZWN-09', slide_ref: 'Slide 36-38',
        quote: 'POC 不是終點，擴大成 Scale 才是挑戰',
        signals: ['Q4_POINT','Q4_INTEGRATED','Q7_TALENT','Q7_ROI','Q8_BUDGET'],
        full_text: '很多企業 POC 成功後卻陷入規模化困境：資料架構不夠、組織沒有同步、技術債積累。POC 到 Scale 需要完整的導入路線圖、技術基礎、組織變革管理與持續的效益驗證機制。',
        phrases: ['POC 成功是開始，規模化才是真正的挑戰。','POC 到 Scale 需要路線圖、技術基礎、組織變革管理。','很多企業 POC 成功後陷入規模化困境，關鍵在架構和組織。'] },
    ]
  },
  {
    id: 'HCH', name: '洪春暉', title: '資策會 MIC 所長', type: 'external',
    cards: [
      { code: 'K-HCH-01', slide_ref: 'Slide 7-10',
        quote: 'AI 不是要不要做，而是做在哪裡、怎麼做好',
        signals: ['Q4_NONE','Q4_TRIAL','Q7_ROI','Q8_WATCH','Q1_INTEREST'],
        full_text: 'AI 已不是要不要導入，而是如何導入、導入在哪裡、如何做好。企業導入 AI 的效益不再只看降低成本與提升效率，而是延伸到創新、產品開發、員工與客戶滿意和差異化競爭。對觀望客戶，這是很好的認知轉換起點。',
        phrases: ['AI 現在不是要不要導入，而是導入在哪裡、怎麼做好。','AI 的價值從降成本，擴大到創新與差異化競爭。','管理層最希望 AI 改善哪一個經營指標？'] },
      { code: 'K-HCH-02', slide_ref: 'Slide 13',
        quote: 'Agentic AI 是數位勞動力，不是問答工具',
        signals: ['Q4_TRIAL','Q4_POINT','Q6_FREQUENCY','Q6_KNOWLEDGE','Q6_WORKLOAD'],
        full_text: '傳統 AI 偏向一次性回答，Agentic AI 則能規劃任務、使用工具、分階段執行、自我修正。Agent 落實重點包含記憶力、規劃能力、工具使用與產出要求。對仍把 AI 當問答工具的客戶，這個區分很關鍵。',
        phrases: ['Agentic AI 不只是回答問題，而是能規劃、使用工具、追蹤任務並自我修正。','從個人問答工具，走向數位勞動力。','Agent 落實重點：記憶、規劃、工具、產出。'] },
      { code: 'K-HCH-03', slide_ref: 'Slide 14',
        quote: '供應鏈採購是 Agentic AI 高價值入口',
        signals: ['Q5_SUPPLY_CHAIN','Q6_FREQUENCY','Q6_WORKLOAD','Q8_EVALUATE'],
        full_text: 'Agentic AI 以供應鏈管理作為「快思」案例，可協助自動生成採購流程、自動生成採購單，並協助設計採購流程與議價。外部環境與關稅變化快速，供應鏈管理需要更即時的資訊整理與決策支援。',
        phrases: ['供應鏈變動快，Agent 可以先從採購流程、比價、風險整理切入。','關稅、供應波動時代，AI 的決策支援更有價值。','採購流程中哪些判斷最依賴資深人員？'] },
      { code: 'K-HCH-04', slide_ref: 'Slide 16',
        quote: '先做可追溯小流程，再做 Agent',
        signals: ['Q4_POINT','Q4_INTEGRATED','Q7_DATA','Q7_TALENT','Q8_EVALUATE'],
        full_text: 'AI 可將使用者需求轉為可執行程式碼，建構可解釋、可追溯的資料收集流程。Agent 導入不是只接一個模型，而是要把資料來源、流程邏輯、追溯機制與輸出檢核一起設計。第一步是先選一個任務，把資料、流程和覆核方式做成可追溯的小流程。',
        phrases: ['第一步不一定是大型平台，而是先做一個可追溯的小流程。','資料分散不是卡點，關鍵是選一個場景先跑起來。','Agent 導入是流程設計，不是只接模型。'] },
      { code: 'K-HCH-05', slide_ref: 'Slide 19',
        quote: 'Agent 要部署，Agent Ops 和安全治理要同步設計',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q7_DATA','Q8_BUDGET'],
        full_text: 'Agent 管理重點包含建置、評估與測試、人類回饋、監控與追蹤。企業需要管理 Agent 的部署、權限、安全、成本與任務執行過程（Agent Ops 與 Agent Security Ops）。這不是導入完成後才補，而是要與導入同步設計。',
        phrases: ['Agent 上線後，需要 Agent Ops 與安全治理，不只是功能導入。','權限、安全、監控、異常處理，要跟導入一起設計。','Agent 管理是新議題，不是傳統 IT 能涵蓋的。'] },
      { code: 'K-HCH-06', slide_ref: 'Slide 21',
        quote: '用人機合作矩陣選第一個 AI 場景',
        signals: ['Q6_FREQUENCY','Q6_KNOWLEDGE','Q7_RESISTANCE','Q7_TALENT','Q8_EVALUATE'],
        full_text: '可用「AI 對人的賦能程度」與「員工想不想跟 AI 合作」來選擇任務。高賦能且員工意願高，是適合作為第一個試點的低垂果實；高賦能但員工抗拒，則需要先處理溝通、教育與角色再設計。',
        phrases: ['第一個場景最好同時具備高價值和高接受度。','哪些工作同仁最希望 AI 幫忙？','高賦能但員工抗拒的場景，先處理溝通再上 AI。'] },
      { code: 'K-HCH-07', slide_ref: 'Slide 22',
        quote: 'AI 導入會推動組織與角色再設計',
        signals: ['Q4_INTEGRATED','Q4_FULL','Q7_RESISTANCE','Q7_TALENT'],
        full_text: '未來會有越來越多 Agent 導入組織，企業結構會因場景軟體化、人機協作與角色調整而改變。AI 已不只是部門工具，要進入核心流程時，角色分工應同步討論，持續平衡人員、科技、任務與組織架構。',
        phrases: ['AI 進入核心流程，角色分工要同步討論。','企業結構會因場景軟體化而重新設計。','哪些工作由 AI 做、哪些由人覆核、哪些要重新訓練？'] },
    ]
  },
  {
    id: 'ZH', name: '朱浩', title: '商研院 資深研究員兼所長', type: 'external',
    cards: [
      { code: 'K-ZH-01', slide_ref: 'Slide 4-5',
        quote: '流通業的 AI 不是選項，而是經營必要能力',
        signals: ['Q1_VISIT','Q1_REVIEW_PROCESS','Q4_COMPETITION','Q4_REVENUE','Q5_HALF_YEAR'],
        full_text: '朱浩所長把 AI 代理放在流通業競爭力的脈絡下：缺工、成本壓力、即時服務要求與市場競爭，已把 AI 從「可選工具」推成「必要能力」。對有時程、有意願的流通業客戶，這是很好的高機會開場。',
        phrases: ['AI 對流通業已經不是要不要做，而是怎麼更快變成經營能力。','缺工、成本、即時服務需求，把 AI 從選項推成必要。','現在不做，未來會更難追。'] },
      { code: 'K-ZH-02', slide_ref: 'Slide 5',
        quote: 'AI 不只省成本，是預判、決策、規模化服務',
        signals: ['Q4_REVENUE','Q4_EFFICIENCY','Q4_CUSTOMER_EXP','Q5_HALF_YEAR','Q5_ONE_YEAR'],
        full_text: '把 AI 從「節省人力、減少重工」推進到「預判需求、做決策、做個人化服務」。對流通業來說，第一個場景應優先選那種能直接連到營收、效率或顧客體驗的地方，而不只是後台自動化。',
        phrases: ['AI 現在不只是省成本，更重要的是預判、決策、規模化服務。','第一個場景要選能直接影響營收或轉單率的地方。','不是做後台自動化，而是找經營能力。'] },
      { code: 'K-ZH-03', slide_ref: 'Slide 7-8',
        quote: '前台即時服務、訂位、客服是流通高價值切入點',
        signals: ['Q1_EXPLAIN_SOLUTION','Q4_CUSTOMER_EXP','Q4_REVENUE','Q5_HALF_YEAR'],
        full_text: '餐飲訂位、零售客服、深夜時段訂單與會員個人化推薦等場景，AI 在流通前台的價值很直接。這類場景的共通點：客戶等待不能太久、服務必須一致、問題量大又有時段性，且沒接住就直接影響營收或滿意度。',
        phrases: ['前台即時服務、深夜訂單、訂位客服，是流通業很適合先做的起點。','客戶等不得，前台 AI 最容易看出價值。','會員個人化、24 小時訂單，都是很直接的 AI 場景。'] },
      { code: 'K-ZH-04', slide_ref: 'Slide 8-9',
        quote: '庫存、補貨、供應反應速度是流通高價值切入',
        signals: ['Q4_RESILIENCE','Q4_EFFICIENCY','Q5_HALF_YEAR','Q5_ADOPTED'],
        full_text: '自主庫存、補貨判斷、配送預排與供應鏈反應速度適合對應流通業的韌性與效率動機，因為它同時關係到缺貨、壓貨、報廢、週轉與前台供應穩定。AI 可以先從預判與決策支援做起，不用一開始就全自動。',
        phrases: ['庫存、補貨、配送預排，通常很容易看出 AI 價值。','AI 可以先從預判與決策支援做起，不用一開始就全自動。','韌性場景同時解缺貨、壓貨、報廢、週轉問題。'] },
      { code: 'K-ZH-05', slide_ref: 'Slide 10',
        quote: '大型談整合，中型高 ROI 場景，小型用 SaaS',
        signals: ['Q1_VISIT','Q1_REVIEW_PROCESS','Q5_NOT_EVALUATED','Q5_TWO_YEAR'],
        full_text: '流通業者依規模有不同導入起點：大型業者適合談 AI 中台與跨部門數據整合；中型業者適合先找高 ROI 場景；小型業者不必急著自建，先善用成熟 SaaS 工具最快。這張卡適合回訪時快速校準提案深度。',
        phrases: ['大型談整合，中型談高 ROI 場景，小型先用成熟 SaaS。','不同規模的 AI 起點不一樣。','提案深度要對齊客戶規模與資源。'] },
      { code: 'K-ZH-06', slide_ref: 'Slide 11',
        quote: '流通導入前三件事：數據、變革管理、個資合規',
        signals: ['Q1_REVIEW_PROCESS','Q4_SECURITY','Q5_HALF_YEAR','Q5_ADOPTED'],
        full_text: '流通導入風險三件事：第一是沒有乾淨數據，AI 跑不出東西；第二是員工若把 AI 當裁員訊號，推進會卡住；第三是流通有大量會員與交易資料，個資與授權不能模糊。這三件事先清楚，後面 PoC 會穩很多。',
        phrases: ['流通導入要先盤三件事：數據、變革管理、個資合規。','沒有乾淨數據、沒有內部共識、沒有個資治理，AI 很難穩定落地。','這三件事先清楚，後面 PoC 會穩很多。'] },
      { code: 'K-ZH-07', slide_ref: 'Slide 10-11',
        quote: '從單店單功能 PoC 開始，是流通最穩健方式',
        signals: ['Q1_EXPLAIN_SOLUTION','Q4_EFFICIENCY','Q5_NOT_EVALUATED','Q5_TWO_YEAR'],
        full_text: '流通導入 AI 不要一開始就全面鋪開，而要從單店、單功能、單場景的 PoC 開始，設 KPI、看 ROI，再逐步擴散。這對還在觀望或剛起步的客戶特別有用，降低決策壓力，也更容易跨過第一步。',
        phrases: ['第一個場景不要選太大，先找一個看得見 KPI 的 PoC。','從單店、單一功能、單一場景開始，最容易成功。','先做出結果再擴大，通常最穩健。'] },
    ]
  },
];

// 流通版訊號集合（用於 tag 著色）
const RETAIL_SIGNALS = new Set([
  'Q1_VISIT','Q1_REVIEW_PROCESS','Q1_EXPLAIN_SOLUTION','Q1_OTHER',
  'Q4_COMPETITION','Q4_REVENUE','Q4_EFFICIENCY','Q4_CUSTOMER_EXP',
  'Q4_RESILIENCE','Q4_SECURITY','Q4_SUSTAINABILITY','Q4_OTHER',
  'Q5_NOT_EVALUATED','Q5_HALF_YEAR','Q5_ONE_YEAR','Q5_TWO_YEAR','Q5_ADOPTED',
]);

// 訊號代碼 → 自然語言對照（供 tag 顯示用）
const SIGNAL_LABELS = {
  Q1_ARRANGE: '安排了解 AI 規劃', Q1_INTEREST: '有興趣進一步了解',
  Q1_ONLINE: '線上方式了解', Q1_OFFLINE: '希望到府拜訪', Q1_NOT_NOW: '目前暫不考慮',
  Q1_VISIT: '希望業務拜訪', Q1_REVIEW_PROCESS: '希望盤點現有流程', Q1_EXPLAIN_SOLUTION: '希望說明解決方案',
  Q4_NONE: '尚未使用 AI', Q4_TRIAL: '試用個人 AI 工具', Q4_POINT: '局部 AI 嘗試',
  Q4_INTEGRATED: '整合至業務系統', Q4_FULL: '已全面導入',
  Q4_REVENUE: '推動營收成長', Q4_EFFICIENCY: '提升運營效率', Q4_CUSTOMER_EXP: '改善客戶體驗',
  Q4_COMPETITION: '提升競爭力', Q4_RESILIENCE: '強化供應韌性',
  Q4_SECURITY: '資安與個資合規', Q4_SUSTAINABILITY: '關注永續發展',
  Q5_SUPPLY_CHAIN: '供應鏈場景', Q5_FINANCE: '財務報表場景',
  Q5_RD: '研發品質場景', Q5_DECISION: '管理決策場景',
  Q5_ADOPTED: '已導入 AI', Q5_HALF_YEAR: '半年內導入',
  Q5_ONE_YEAR: '一年內導入', Q5_TWO_YEAR: '兩年內導入', Q5_NOT_EVALUATED: '尚未評估時程',
  Q6_FREQUENCY: '高頻重複工作', Q6_KNOWLEDGE: '知識傳承困難',
  Q6_EXPERIENCE: '資深經驗斷層', Q6_WORKLOAD: '人力負荷沉重',
  Q7_ROI: '擔心 ROI 難衡量', Q7_DATA: '資料整合困難',
  Q7_RESISTANCE: '擔心員工抗拒', Q7_TALENT: '缺乏 AI 人才',
  Q8_BUDGET: '已有預算規劃', Q8_EVALUATE: '正在評估方案',
  Q8_WATCH: '持續觀望', Q8_NONE: '暫無明確規劃',
};

// ---- 講師篩選 ----
let activeSpeakerId = '';
let speakerSearchTerm = '';

document.querySelectorAll('.speaker-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speaker-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSpeakerId = btn.dataset.speaker;
    renderSpeakerCards();
  });
});

document.getElementById('speaker-search').addEventListener('input', (e) => {
  speakerSearchTerm = e.target.value.trim().toLowerCase();
  // 搜尋時取消篩選按鈕的 active（全部）
  if (speakerSearchTerm) {
    document.querySelectorAll('.speaker-filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.speaker-filter-btn[data-speaker=""]').classList.add('active');
    activeSpeakerId = '';
  }
  renderSpeakerCards();
});

function formatSlideRef(ref) {
  if (!ref) return '';
  // "Slide 2" → "簡報第2頁"、"Slide 5-7" → "簡報第5-7頁"、"Slide 3, 7" → "簡報第3、7頁"
  return ref.replace(/Slide\s+([\d,\s\-]+)/gi, (_, pages) =>
    `簡報第${pages.replace(/,\s*/g, '、').trim()}頁`
  );
}

function extractFirstPage(slideRef) {
  if (!slideRef) return null;
  const m = slideRef.match(/Slide\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function renderSpeakerCards() {
  const list = document.getElementById('speaker-cards-list');
  const allCards = [];

  SPEAKER_DATA.forEach(speaker => {
    if (activeSpeakerId && speaker.id !== activeSpeakerId) return;
    speaker.cards.forEach(card => {
      if (speakerSearchTerm) {
        const phrasesText = (card.phrases || []).join(' ');
        const signalLabelsText = card.signals.map(s => SIGNAL_LABELS[s] || s).join(' ');
        const raw = `${speaker.name} ${card.code} ${card.quote} ${card.signals.join(' ')} ${signalLabelsText} ${card.full_text || ''} ${card.slide_ref || ''} ${phrasesText}`.toLowerCase();
        const haystack = raw.replace(/\s+/g, '');
        const needle = speakerSearchTerm.replace(/\s+/g, '');
        if (!haystack.includes(needle)) return;
      }
      allCards.push({ speaker, card });
    });
  });

  if (allCards.length === 0) {
    list.innerHTML = '<p class="empty-state">找不到相關素材，請嘗試其他關鍵字</p>';
    return;
  }

  list.innerHTML = allCards.map(({ speaker, card }) => {
    const initials = speaker.name.charAt(0);
    const signalTags = card.signals.map(s => {
      const label = SIGNAL_LABELS[s] || s;
      return `<span class="signal-tag${RETAIL_SIGNALS.has(s) ? ' retail-signal' : ''}">${label}</span>`;
    }).join('');
    const phraseItems = (card.phrases || []).map(p =>
      `<div class="speaker-phrase-item" onclick="copyPhrase(this)">${p}</div>`
    ).join('');
    const slideLabel = formatSlideRef(card.slide_ref);
    const slideResourceId = SPEAKER_RESOURCE_MAP[speaker.id];
    const slidePage = extractFirstPage(card.slide_ref);
    const slideHtml = slideLabel
      ? slideResourceId
        ? `<button class="speaker-card-slideref speaker-slide-btn" onclick="openSlidePreview('${slideResourceId}','${escapeHtml(speaker.name)} — ${escapeHtml(slideLabel)}',${slidePage ?? 'null'})">📊 ${slideLabel} <span class="slide-preview-hint">點擊預覽 ›</span></button>`
        : `<div class="speaker-card-slideref">📊 ${slideLabel}</div>`
      : '';
    const detailHtml = `
      <div class="speaker-card-detail" id="detail-${card.code}">
        <div class="speaker-card-fulltext">${card.full_text || ''}</div>
        ${slideHtml}
        ${phraseItems ? `<div class="speaker-phrase-list"><div class="speaker-phrase-title">業務可用話術（點擊複製）</div>${phraseItems}</div>` : ''}
      </div>`;
    return `
      <div class="speaker-card" id="card-${card.code}">
        <div class="speaker-card-header">
          <div class="speaker-avatar ${speaker.type}">${initials}</div>
          <div class="speaker-card-meta">
            <div class="speaker-card-name">${speaker.name}</div>
            <div class="speaker-card-title">${speaker.title}</div>
          </div>
        </div>
        <div class="speaker-card-quote" onclick="toggleSpeakerCard('${card.code}')">「${card.quote}」<span class="speaker-card-expand-icon" title="點即展開">▸</span></div>
        <div class="speaker-card-hint">點擊引言可展開完整內容與話術</div>
        <div class="speaker-card-signals">${signalTags}</div>
        ${detailHtml}
      </div>
    `;
  }).join('');
}

window.toggleSpeakerCard = function(code) {
  const detail = document.getElementById(`detail-${code}`);
  const card = document.getElementById(`card-${code}`);
  if (!detail) return;
  const isOpen = detail.classList.toggle('open');
  const icon = card.querySelector('.speaker-card-expand-icon');
  if (icon) icon.textContent = isOpen ? '▾' : '▸';
};

window.copyPhrase = async function(el) {
  const text = el.textContent;
  try {
    await navigator.clipboard.writeText(text);
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1500);
  } catch {
    showToast('複製失敗，請手動複製');
  }
};

// ── 講師簡報預覽 Modal（PDF.js） ───────────────────────────────
const _PDFJS_W = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let _sPdfDoc = null, _sPdfPage = 1, _sPdfTotal = 0, _sPdfBusy = false, _sPdfQueued = null;

function _sPdfNav() {
  const info = document.getElementById('speaker-pdf-page-info');
  const prev = document.getElementById('speaker-pdf-prev');
  const next = document.getElementById('speaker-pdf-next');
  if (info) info.textContent = `${_sPdfPage} / ${_sPdfTotal}`;
  if (prev) prev.disabled = _sPdfPage <= 1;
  if (next) next.disabled = _sPdfPage >= _sPdfTotal;
}

async function _sPdfRender(n) {
  if (!_sPdfDoc) return;
  if (_sPdfBusy) { _sPdfQueued = n; return; }
  _sPdfBusy = true;
  _sPdfPage = n;
  _sPdfNav();
  const cont   = document.getElementById('speaker-pdf-container');
  const canvas = document.getElementById('speaker-pdf-canvas');
  const pg     = await _sPdfDoc.getPage(n);
  const dpr    = Math.min(window.devicePixelRatio || 1, 2);
  const w      = (cont.clientWidth || 360) - 16;
  const nat    = pg.getViewport({ scale: 1 });
  const vp     = pg.getViewport({ scale: (w / nat.width) * dpr });
  canvas.width  = vp.width;
  canvas.height = vp.height;
  canvas.style.width  = `${w}px`;
  canvas.style.height = `${Math.round(w * nat.height / nat.width)}px`;
  await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  _sPdfBusy = false;
  if (_sPdfQueued !== null) { const q = _sPdfQueued; _sPdfQueued = null; await _sPdfRender(q); }
}

window.speakerPdfPrev = async () => { if (_sPdfPage > 1) await _sPdfRender(_sPdfPage - 1); };
window.speakerPdfNext = async () => { if (_sPdfPage < _sPdfTotal) await _sPdfRender(_sPdfPage + 1); };

window.openSlidePreview = async function(resourceId, title, page) {
  const modal    = document.getElementById('speaker-preview-modal');
  if (!modal) return;
  const loading  = document.getElementById('speaker-preview-loading');
  const pdfCont  = document.getElementById('speaker-pdf-container');
  const controls = document.getElementById('speaker-pdf-controls');
  const iframe   = document.getElementById('speaker-preview-iframe');
  const body     = document.getElementById('speaker-preview-body');
  const titleEl  = document.getElementById('speaker-preview-title');

  _sPdfDoc = null; _sPdfBusy = false; _sPdfQueued = null;
  titleEl.textContent = title;
  loading.style.display  = 'flex';
  pdfCont.style.display  = 'none';
  iframe.style.display   = 'none';
  controls.style.display = 'none';
  body.classList.remove('pdf-active');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const uc     = localStorage.getItem('user_code') || '';
  const pdfUrl = `/api/resources/${resourceId}?action=preview&uc=${encodeURIComponent(uc)}`;

  if (window.pdfjsLib) {
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = _PDFJS_W;
      const task = window.pdfjsLib.getDocument({ url: pdfUrl });
      _sPdfDoc   = await task.promise;
      _sPdfTotal = _sPdfDoc.numPages;
      loading.style.display = 'none';
      pdfCont.style.display = 'block';
      body.classList.add('pdf-active');
      if (_sPdfTotal > 1) controls.style.display = 'flex';
      await _sPdfRender(Math.max(1, Math.min(page || 1, _sPdfTotal)));
      return;
    } catch (e) {
      console.warn('PDF.js failed, iframe fallback:', e);
    }
  }
  // iframe fallback（桌面 Chrome/Firefox）
  loading.style.display = 'none';
  iframe.src = pdfUrl + (page ? `#page=${page}` : '');
  iframe.style.display = 'block';
};

window.closeSlidePreview = function() {
  const modal  = document.getElementById('speaker-preview-modal');
  const iframe = document.getElementById('speaker-preview-iframe');
  if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
  if (iframe) iframe.src = '';
  _sPdfDoc = null;
};


window.copySpeakerCard = async function(code, btn) {
  const flat = SPEAKER_DATA.flatMap(s => s.cards.map(c => ({ ...c, speakerName: s.name, speakerTitle: s.title })));
  const entry = flat.find(c => c.code === code);
  if (!entry) return;
  const signalLabels = entry.signals.map(s => SIGNAL_LABELS[s] || s).join('、');
  const phrasesText = (entry.phrases || []).map((p, i) => `  ${i + 1}. ${p}`).join('\n');
  const slideLabel = formatSlideRef(entry.slide_ref);
  const text = [
    `${entry.speakerName}（${entry.speakerTitle}）`,
    slideLabel ? `📊 ${slideLabel}` : '',
    `「${entry.quote}」`,
    '',
    entry.full_text || '',
    '',
    phrasesText ? `業務可用話術：\n${phrasesText}` : '',
    '',
    `適用情境：${signalLabels}`,
  ].filter(l => l !== undefined).join('\n').trim();
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = '已複製 ✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    showToast('複製失敗，請手動複製');
  }
};
