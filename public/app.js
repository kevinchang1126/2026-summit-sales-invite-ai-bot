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
  history: JSON.parse(localStorage.getItem('pitch_history') || '[]'),
  isEditing: false,
};

function getOrCreateVoterId() {
  let id = localStorage.getItem('voter_id');
  if (!id) {
    id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('voter_id', id);
  }
  return id;
}

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
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());

  // 儲存暱稱到 cookie
  if (data.author) {
    localStorage.setItem('author_name', data.author);
  }

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
    resultContent.textContent = result.content;
    resultArea.style.display = 'block';
    resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Reset vote states
    document.querySelectorAll('.btn-vote').forEach(b => b.classList.remove('voted'));

    // Save to local history
    const historyItem = {
      id: result.id,
      industry: data.industry,
      role: data.role,
      channel: data.channel,
      content: result.content,
      created_at: new Date().toISOString(),
    };
    state.history.unshift(historyItem);
    if (state.history.length > 50) state.history.pop();
    localStorage.setItem('pitch_history', JSON.stringify(state.history));

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
  resultContent.textContent = newContent;

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
    resultContent.textContent = result.content;

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
    localStorage.setItem('pitch_history', JSON.stringify(state.history));
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

  el.innerHTML = `
    <div style="display:flex;align-items:flex-start">
      <span class="rank-badge ${rankClass}">${rank}</span>
      <div style="flex:1;min-width:0">
        <div class="pitch-meta">
          <span class="tag tag-industry">${escapeHtml(pitch.industry)}</span>
          <span class="tag tag-channel">${escapeHtml(pitch.channel)}</span>
          <span class="tag tag-role">${escapeHtml(pitch.role)}</span>
        </div>
        <div class="pitch-preview" onclick="this.classList.toggle('expanded')">${escapeHtml(pitch.content)}</div>
        <div class="pitch-footer">
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
          </div>
        </div>
      </div>
    </div>
  `;
  return el;
}

// ===== History =====
function renderHistory() {
  const list = document.getElementById('history-list');
  if (state.history.length === 0) {
    list.innerHTML = '<p class="empty-state">尚無記錄，去生成第一篇說帖吧！</p>';
    return;
  }

  list.innerHTML = '';
  state.history.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'pitch-item';
    el.innerHTML = `
      <div class="pitch-meta">
        <span class="tag tag-industry">${escapeHtml(item.industry)}</span>
        <span class="tag tag-channel">${escapeHtml(item.channel)}</span>
        <span class="tag tag-role">${escapeHtml(item.role)}</span>
      </div>
      <div class="pitch-preview" onclick="this.classList.toggle('expanded')">${escapeHtml(item.content)}</div>
      <div class="pitch-footer">
        <span>${formatDate(item.created_at)}</span>
        <div style="display:flex;gap:6px">
          <button class="btn-secondary" onclick="copyText(this)" data-content="${escapeAttr(item.content)}">複製</button>
          <button class="btn-secondary" onclick="reuseFromHistory(${item.id})">載入編輯</button>
        </div>
      </div>
    `;
    list.appendChild(el);
  });
}

// 從歷史記錄載入到編輯區
window.reuseFromHistory = function(pitchId) {
  const item = state.history.find(h => h.id === pitchId);
  if (!item) return;

  // 切換到生成頁
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="generate"]').classList.add('active');
  document.getElementById('tab-generate').classList.add('active');

  // 顯示結果區
  state.currentPitchId = item.id;
  state.currentContent = item.content;
  resultContent.textContent = item.content;
  resultArea.style.display = 'block';

  // 進入編輯模式
  enterEditMode();
  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

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

// ===== Restore saved author name =====
const savedAuthor = localStorage.getItem('author_name');
if (savedAuthor) {
  const authorInput = form.querySelector('[name="author"]');
  if (authorInput) authorInput.value = savedAuthor;
}

// ===== Utilities =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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
