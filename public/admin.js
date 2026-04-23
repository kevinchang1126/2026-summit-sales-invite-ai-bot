// ===== Admin Console =====

const state = {
  userCode: localStorage.getItem('user_code') || '',
  role: null,
  events: [],
  series: [],
  roles: [],
  resources: [],
  allTags: [],           // GET /api/tags 快取
  userSearchTimer: null,
  selectedUser: null,
  ingestPreview: null,   // 最近一次 Gemini 解析結果
  resourceFile: null,    // 待上傳的 File 物件
};

// ------- Fetch helper -------
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Code': state.userCode,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------- Init -------
document.addEventListener('DOMContentLoaded', async () => {
  if (!state.userCode) {
    // 沒登入 → 回前台走 Teams 驗證
    location.replace('/');
    return;
  }

  try {
    const me = await api('GET', '/api/me');
    if (!me.role || !['superadmin', 'eventadmin'].includes(me.role)) {
      alert('您沒有後台存取權限');
      location.replace('/');
      return;
    }
    state.role = me.role;
    state.managedEventIds = me.managed_event_ids || [];
  } catch (e) {
    alert('驗證失敗：' + e.message);
    location.replace('/');
    return;
  }

  // 顯示 UI
  document.body.classList.toggle('is-superadmin', state.role === 'superadmin');
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('admin-app').style.display = 'block';
  document.getElementById('admin-name').textContent = localStorage.getItem('display_name') || localStorage.getItem('ad_name') || '';
  const badge = document.getElementById('admin-role');
  badge.textContent = state.role;
  badge.classList.add(state.role);

  bindNav();
  bindEventModal();
  bindRoleModal();
  bindSeriesModal();
  bindIngestModal();
  bindResourceModal();
  bindTagModal();
  loadEvents();
});

// ------- Navigation -------
function bindNav() {
  document.querySelectorAll('.side-nav').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.side-nav').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      document.getElementById('view-' + v).classList.add('active');
      if (v === 'roles')     loadRoles();
      if (v === 'events')    loadEvents();
      if (v === 'series')    loadSeries();
      if (v === 'resources') loadResources();
      if (v === 'tags')      loadTagsAdmin();
    });
  });
}

// ------- Events =================================================
async function loadEvents() {
  const tbody = document.getElementById('events-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty">載入中...</td></tr>';
  try {
    const { events } = await api('GET', '/api/events');
    state.events = events;
    if (events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">還沒有任何活動，點右上「新增活動」建立第一筆</td></tr>';
      return;
    }
    tbody.innerHTML = events.map(e => renderEventRow(e)).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openEventModal(state.events.find(ev => ev.id === b.dataset.edit))));
    tbody.querySelectorAll('[data-delete]').forEach(b =>
      b.addEventListener('click', () => confirmDeleteEvent(b.dataset.delete)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">載入失敗：${e.message}</td></tr>`;
  }
}

function canManageEvent(eventId) {
  if (state.role === 'superadmin') return true;
  return (state.managedEventIds || []).includes(eventId);
}

function renderEventRow(e) {
  const canEdit = canManageEvent(e.id);
  const canDelete = state.role === 'superadmin';
  // 系列場次顯示「場次代號」，獨立活動顯示「活動ID（即專案代號）」
  const codeDisplay = e.session_code
    ? `場次代號：<code>${escapeHtml(e.session_code)}</code>`
    : escapeHtml(e.id);
  return `
    <tr>
      <td>
        <strong>${escapeHtml(e.name)}</strong>
        ${e.series_name ? `<span style="font-size:0.75rem;background:#eff6ff;color:#1d4ed8;padding:1px 7px;border-radius:999px;margin-left:6px;">📋 ${escapeHtml(e.series_name)}</span>` : ''}
        <br><small style="color:var(--text-secondary);">${codeDisplay}</small>
      </td>
      <td>${e.event_date}${e.event_time ? '<br><small>' + escapeHtml(e.event_time) + '</small>' : ''}</td>
      <td><span class="status-chip ${e.status}">${statusLabel(e.status)}</span></td>
      <td>${escapeHtml(e.created_by || '—')}</td>
      <td><div class="row-actions">
        ${canEdit ? `<button class="btn-ghost" data-edit="${e.id}">編輯</button>` : ''}
        ${canDelete ? `<button class="btn-danger" data-delete="${e.id}">刪除</button>` : ''}
      </div></td>
    </tr>`;
}

function statusLabel(s) {
  return { upcoming: '即將舉行', ongoing: '進行中', ended: '已結束', archived: '已封存' }[s] || s;
}

// ─── 儲存遮罩（防止操作中途離頁）──────────────────────────────────────────
let _savingActive = false;

function showSavingOverlay(msg) {
  _savingActive = true;
  document.getElementById('saving-overlay-msg').textContent = msg || '儲存中，請勿關閉頁面...';
  document.getElementById('saving-overlay').classList.add('active');
}
function hideSavingOverlay() {
  _savingActive = false;
  document.getElementById('saving-overlay').classList.remove('active');
}
window.addEventListener('beforeunload', e => {
  if (_savingActive) {
    e.preventDefault();
    e.returnValue = '正在儲存資料，確定要離開嗎？';
  }
});

// ─── 格式驗證正規表達式 ────────────────────────────────────────────────────────
// 活動專案代號（獨立活動 ID 或系列的 project_code）：YYYYMM+4碼，由外部系統指派
const EVENT_ID_RE = /^20\d{2}(0[1-9]|1[0-2])\d{4}$/;
// 場次代號（系列下各場次的地點代號）
const SESSION_CODE_RE = /^(OT\d{2}|TH|U\d{2}|VAJ|\d{2,4}[A-Z]{0,2})$/i;

function bindEventModal() {
  const modal = document.getElementById('event-modal');
  document.getElementById('btn-new-event').addEventListener('click', () => openEventModal(null));
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

  // ID 欄位即時格式驗證提示
  document.getElementById('event-id-input').addEventListener('input', function () {
    const err = document.getElementById('event-id-error');
    if (!this.value || EVENT_ID_RE.test(this.value)) {
      err.style.display = 'none';
    } else {
      err.textContent = '格式錯誤：應為 10 碼數字，YYYYMM+4碼（如 2026040001）';
      err.style.display = 'block';
    }
  });

  // session_code 欄位即時格式驗證提示
  document.getElementById('event-session-code-input').addEventListener('input', function () {
    const err = document.getElementById('event-session-code-error');
    const val = this.value.trim().toUpperCase();
    if (!val || SESSION_CODE_RE.test(val)) {
      err.style.display = 'none';
    } else {
      err.textContent = '格式錯誤（如 02、02A、999A、OT01、TH）';
      err.style.display = 'block';
    }
  });

  // 系列選取切換：有系列 → 顯示 session_code，無系列 → 顯示 id（活動專案代號）
  document.getElementById('event-series-select').addEventListener('change', function () {
    const hasSeries = !!this.value;
    document.getElementById('event-id-group').style.display         = hasSeries ? 'none' : 'block';
    document.getElementById('event-session-code-group').style.display = hasSeries ? 'block' : 'none';
    const idInput = document.getElementById('event-id-input');
    idInput.required         = !hasSeries;
    document.getElementById('event-session-code-input').required = hasSeries;
  });

  document.getElementById('event-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const isNew = !form.dataset.editId;
    const hasSeries = !!form.series_id.value;

    if (hasSeries) {
      // 系列場次：驗證 session_code
      const sc = form.session_code.value.trim().toUpperCase();
      if (isNew && !sc) { showToast('請填寫場次代號（如 02、999A）'); return; }
      if (sc && !SESSION_CODE_RE.test(sc)) { showToast('場次代號格式錯誤（如 02、999A、OT01、TH）'); return; }
    } else {
      // 獨立活動：驗證活動專案代號 id
      const id = form.id.value.trim();
      if (isNew) {
        if (!id) { showToast('請填寫活動專案代號（YYYYMM+4碼）'); return; }
        if (!EVENT_ID_RE.test(id)) { showToast('活動 ID 格式錯誤，應為 10 碼數字（如 2026040001）'); return; }
      }
    }

    const payload = {
      name:         form.name.value.trim(),
      description:  form.description.value.trim(),
      event_date:   form.event_date.value,
      event_time:   form.event_time.value.trim(),
      location:     form.location.value.trim(),
      status:       form.status.value,
      series_id:    form.series_id.value || null,
      series_order: form.series_order.value ? parseInt(form.series_order.value, 10) : null,
      target_audience: {
        functions: csv(form.audience_functions.value),
        titles:    csv(form.audience_titles.value),
      },
    };

    if (hasSeries) {
      payload.session_code = form.session_code.value.trim().toUpperCase() || undefined;
    } else if (isNew) {
      payload.id = form.id.value.trim();
    }

    showSavingOverlay('儲存活動中...');
    try {
      if (!isNew) {
        await api('PUT', `/api/events/${encodeURIComponent(form.dataset.editId)}`, payload);
        showToast('已更新');
      } else {
        await api('POST', '/api/events', payload);
        showToast('已新增');
      }
      modal.classList.remove('active');
      loadEvents();
    } catch (err) {
      showToast('儲存失敗：' + err.message);
    } finally {
      hideSavingOverlay();
    }
  });
}

async function openEventModal(e, prefill) {
  const modal = document.getElementById('event-modal');
  const form  = document.getElementById('event-form');
  form.reset();
  document.getElementById('event-modal-title').textContent = e ? '編輯活動' : '新增活動';

  // 填入 series 下拉
  await populateSeriesSelect(e?.series_id);

  const idInput = document.getElementById('event-id-input');
  const idErr   = document.getElementById('event-id-error');
  const scInput = document.getElementById('event-session-code-input');
  const scErr   = document.getElementById('event-session-code-error');
  if (idErr) idErr.style.display = 'none';
  if (scErr) scErr.style.display = 'none';

  if (e) {
    // ── 編輯模式 ───────────────────────────────────────────────────────────
    form.dataset.editId = e.id;

    const hasSeries = !!e.series_id;

    // id 欄位（獨立活動時顯示，唯讀）
    document.getElementById('event-id-group').style.display          = hasSeries ? 'none' : 'block';
    document.getElementById('event-session-code-group').style.display = hasSeries ? 'block' : 'none';

    if (hasSeries) {
      // 系列場次：顯示 session_code（唯讀）
      scInput.value        = e.session_code || '';
      scInput.readOnly     = true;
      scInput.style.background = 'var(--bg-secondary, #f3f4f6)';
      scInput.style.cursor = 'not-allowed';
    } else {
      // 獨立活動：顯示 id（唯讀）
      idInput.value        = e.id;
      idInput.readOnly     = true;
      idInput.style.background = 'var(--bg-secondary, #f3f4f6)';
      idInput.style.cursor = 'not-allowed';
    }

    form.name.value         = e.name || '';
    form.description.value  = e.description || '';
    form.event_date.value   = e.event_date || '';
    form.event_time.value   = e.event_time || '';
    form.location.value     = e.location || '';
    form.status.value       = e.status || 'upcoming';
    form.series_order.value = e.series_order || '';
    try {
      const ta = e.target_audience ? JSON.parse(e.target_audience) : {};
      form.audience_functions.value = (ta.functions || []).join(',');
      form.audience_titles.value    = (ta.titles || []).join(',');
    } catch { /* noop */ }

  } else {
    // ── 新增模式 ───────────────────────────────────────────────────────────
    delete form.dataset.editId;

    // 預設顯示 id 欄位（無系列時），選了系列後由 change 事件切換
    document.getElementById('event-id-group').style.display          = 'block';
    document.getElementById('event-session-code-group').style.display = 'none';

    idInput.value        = '';
    idInput.readOnly     = false;
    idInput.style.background = '';
    idInput.style.cursor = '';
    idInput.placeholder  = '請輸入活動專案代號（如 2026040001）';

    scInput.value        = '';
    scInput.readOnly     = false;
    scInput.style.background = '';
    scInput.style.cursor = '';

    form.status.value    = 'upcoming';
  }

  // 來自 ingest 的預填值覆蓋
  if (prefill) {
    if (prefill.name)        form.name.value = prefill.name;
    if (prefill.description) form.description.value = prefill.description;
    if (prefill.event_date)  form.event_date.value = prefill.event_date;
    if (prefill.event_time)  form.event_time.value = prefill.event_time;
    if (prefill.location)    form.location.value = prefill.location;
    if (prefill.target_audience) {
      const ta = prefill.target_audience;
      form.audience_functions.value = (ta.functions || []).join(',');
      form.audience_titles.value    = (ta.titles || []).join(',');
    }
    if (prefill.series_id) {
      form.series_id.value = prefill.series_id;
      // 觸發切換邏輯
      document.getElementById('event-id-group').style.display          = 'none';
      document.getElementById('event-session-code-group').style.display = 'block';
    }
    if (prefill.series_order) form.series_order.value = prefill.series_order;
    if (prefill.session_code) scInput.value = prefill.session_code;
  }

  modal.classList.add('active');
}

async function populateSeriesSelect(selectedId) {
  const sel = document.getElementById('event-series-select');
  if (state.series.length === 0) {
    try { const { series } = await api('GET', '/api/events/series'); state.series = series; } catch { /* noop */ }
  }
  sel.innerHTML = '<option value="">— 無 —</option>'
    + state.series.map(s =>
        `<option value="${escapeHtml(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');
}

async function confirmDeleteEvent(id) {
  const ev = state.events.find(e => e.id === id);
  if (!confirm(`確定刪除活動「${ev?.name}」？此操作會連動刪除底下所有資源。`)) return;
  try {
    await api('DELETE', `/api/events/${encodeURIComponent(id)}`);
    showToast('已刪除');
    loadEvents();
  } catch (err) {
    showToast('刪除失敗：' + err.message);
  }
}

// ------- Roles ==================================================
async function loadRoles() {
  const tbody = document.getElementById('roles-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty">載入中...</td></tr>';
  try {
    const { roles } = await api('GET', '/api/admin/roles');
    state.roles = roles;
    if (roles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">尚無角色指派</td></tr>';
      return;
    }
    tbody.innerHTML = roles.map(r => renderRoleRow(r)).join('');
    tbody.querySelectorAll('[data-revoke]').forEach(b =>
      b.addEventListener('click', () => confirmRevoke(b.dataset.revoke)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">載入失敗：${e.message}</td></tr>`;
  }
}

function renderRoleRow(r) {
  const displayName = r.custom_nickname || r.ad_name || '(未知)';
  const eventsText = r.role === 'superadmin' ? '— 全部 —' :
    (r.events || []).map(e => escapeHtml(e.event_name || e.event_id)).join('、') || '(未指派)';
  const isSelf = r.user_code === state.userCode;
  return `
    <tr>
      <td><strong>${escapeHtml(displayName)}</strong><br><small>${escapeHtml(r.user_code)}</small></td>
      <td><span class="role-badge ${r.role}">${r.role}</span></td>
      <td>${eventsText}</td>
      <td>${escapeHtml(r.granted_by || '—')}</td>
      <td>${isSelf ? '<small>（本人）</small>' : `<button class="btn-danger" data-revoke="${escapeHtml(r.user_code)}">撤銷</button>`}</td>
    </tr>`;
}

async function confirmRevoke(userCode) {
  const r = state.roles.find(x => x.user_code === userCode);
  if (!confirm(`確定撤銷 ${r?.ad_name || userCode} 的 ${r?.role} 角色？`)) return;
  try {
    await api('DELETE', `/api/admin/roles/${encodeURIComponent(userCode)}`);
    showToast('已撤銷');
    loadRoles();
  } catch (err) {
    showToast('撤銷失敗：' + err.message);
  }
}

function bindRoleModal() {
  const modal = document.getElementById('role-modal');
  document.getElementById('btn-new-role').addEventListener('click', () => openRoleModal());
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

  // 使用者搜尋
  const searchInput = document.getElementById('role-user-search');
  const listEl = document.getElementById('role-user-list');
  searchInput.addEventListener('input', () => {
    clearTimeout(state.userSearchTimer);
    state.userSearchTimer = setTimeout(async () => {
      const q = searchInput.value.trim();
      if (q.length < 1) { listEl.classList.remove('active'); listEl.innerHTML = ''; return; }
      try {
        const { users } = await api('GET', `/api/admin/users?q=${encodeURIComponent(q)}`);
        if (users.length === 0) {
          listEl.innerHTML = '<div class="user-search-item" style="color:#999;">找不到使用者</div>';
        } else {
          listEl.innerHTML = users.map(u =>
            `<div class="user-search-item" data-code="${escapeHtml(u.user_code)}" data-name="${escapeHtml(u.ad_name || '')}">
              <strong>${escapeHtml(u.ad_name || '(未命名)')}</strong>
              <small style="color:#999; margin-left:8px;">${escapeHtml(u.user_code)}</small>
              ${u.role ? `<span class="role-badge ${u.role}" style="margin-left:8px;">${u.role}</span>` : ''}
            </div>`
          ).join('');
          listEl.querySelectorAll('.user-search-item[data-code]').forEach(el => {
            el.addEventListener('click', () => {
              state.selectedUser = { user_code: el.dataset.code, ad_name: el.dataset.name };
              document.querySelector('#role-form input[name=user_code]').value = el.dataset.code;
              document.getElementById('role-user-selected').textContent = `已選擇：${el.dataset.name} (${el.dataset.code})`;
              listEl.classList.remove('active');
              searchInput.value = '';
            });
          });
        }
        listEl.classList.add('active');
      } catch (e) { /* noop */ }
    }, 250);
  });

  // role 切換顯示 event 選單
  const roleSelect = document.getElementById('role-select');
  const eventsGroup = document.getElementById('role-events-group');
  roleSelect.addEventListener('change', () => {
    eventsGroup.style.display = roleSelect.value === 'eventadmin' ? 'block' : 'none';
  });

  // 提交
  document.getElementById('role-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const user_code = form.user_code.value;
    const role = form.role.value;
    if (!user_code) { showToast('請先選擇使用者'); return; }

    const payload = { user_code, role };
    if (role === 'eventadmin') {
      const checked = [...document.querySelectorAll('#role-events-checklist input:checked')].map(i => i.value);
      if (checked.length === 0) { showToast('eventadmin 必須指派至少一個活動'); return; }
      payload.event_ids = checked;
    }
    try {
      await api('POST', '/api/admin/roles', payload);
      showToast('已指派');
      modal.classList.remove('active');
      loadRoles();
    } catch (err) {
      showToast('指派失敗：' + err.message);
    }
  });
}

async function openRoleModal() {
  const modal = document.getElementById('role-modal');
  document.getElementById('role-form').reset();
  document.getElementById('role-user-selected').textContent = '';
  document.querySelector('#role-form input[name=user_code]').value = '';
  document.getElementById('role-events-group').style.display = 'block';

  // 載入活動清單
  try {
    if (state.events.length === 0) await loadEvents();
  } catch {}
  const checklist = document.getElementById('role-events-checklist');
  checklist.innerHTML = state.events.length === 0
    ? '<p style="color:var(--text-secondary);">請先建立活動</p>'
    : state.events.map(e =>
        `<label><input type="checkbox" value="${escapeHtml(e.id)}"> ${escapeHtml(e.name)} <small style="color:#999;">(${e.event_date})</small></label>`
      ).join('');

  modal.classList.add('active');
}

// ------- Series ==================================================
async function loadSeries() {
  const tbody = document.getElementById('series-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="empty">載入中...</td></tr>';
  try {
    const { series } = await api('GET', '/api/events/series');
    state.series = series;
    if (series.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">還沒有系列活動，點右上「新增系列」建立</td></tr>';
      return;
    }
    tbody.innerHTML = series.map(s => renderSeriesRow(s)).join('');
    tbody.querySelectorAll('[data-edit-series]').forEach(b =>
      b.addEventListener('click', () => openSeriesModal(state.series.find(s => s.id === b.dataset.editSeries))));
    tbody.querySelectorAll('[data-delete-series]').forEach(b =>
      b.addEventListener('click', () => confirmDeleteSeries(b.dataset.deleteSeries)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">載入失敗：${e.message}</td></tr>`;
  }
}

function renderSeriesRow(s) {
  const canDelete = state.role === 'superadmin';
  const statusMap = { active: '進行中', ended: '已結束', archived: '已封存' };
  const codeLabel = s.project_code
    ? `專案代號：<code>${escapeHtml(s.project_code)}</code>`
    : `<span style="color:var(--danger);font-size:0.72rem;">⚠ 未設專案代號</span>`;
  return `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong><br><small style="color:var(--text-secondary);">${codeLabel}</small></td>
      <td style="text-align:center;">${s.event_count ?? 0} 場</td>
      <td><span class="status-chip ${s.status}">${statusMap[s.status] || s.status}</span></td>
      <td>${escapeHtml(s.created_by || '—')}</td>
      <td><div class="row-actions">
        <button class="btn-ghost" data-edit-series="${escapeHtml(s.id)}">編輯</button>
        ${canDelete ? `<button class="btn-danger" data-delete-series="${escapeHtml(s.id)}">刪除</button>` : ''}
      </div></td>
    </tr>`;
}

function bindSeriesModal() {
  const modal = document.getElementById('series-modal');
  document.getElementById('btn-new-series').addEventListener('click', () => openSeriesModal(null));
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

  // project_code 即時驗證
  document.getElementById('series-project-code-input').addEventListener('input', function () {
    const err = document.getElementById('series-project-code-error');
    if (!this.value || EVENT_ID_RE.test(this.value)) {
      err.style.display = 'none';
    } else {
      err.textContent = '格式錯誤：應為 10 碼數字，YYYYMM+4碼（如 2026040001）';
      err.style.display = 'block';
    }
  });

  document.getElementById('series-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value; // 有值 = 編輯，空 = 新增

    // project_code 驗證
    const pcInput = document.getElementById('series-project-code-input');
    const pc = pcInput.value.trim();
    if (!id) {
      // 新增：必填
      if (!pc) { showToast('請填寫活動專案代號（YYYYMM+4碼）'); pcInput.focus(); return; }
    }
    if (pc && !EVENT_ID_RE.test(pc)) {
      showToast('活動專案代號格式錯誤（應為 YYYYMM+4碼，如 2026040001）'); pcInput.focus(); return;
    }

    const payload = {
      name:         form.name.value.trim(),
      description:  form.description.value.trim(),
      status:       form.status.value,
      project_code: pc || undefined,
    };

    showSavingOverlay(id ? '更新系列中...' : '建立系列中...');
    try {
      if (id) {
        await api('PUT', `/api/events/series/${encodeURIComponent(id)}`, payload);
        showToast('系列已更新');
      } else {
        await api('POST', '/api/events/series', payload);
        showToast('系列已建立');
      }
      modal.classList.remove('active');
      state.series = []; // 清快取，下次重載
      loadSeries();
    } catch (err) {
      showToast('儲存失敗：' + err.message);
    } finally {
      hideSavingOverlay();
    }
  });
}

function openSeriesModal(s) {
  const modal   = document.getElementById('series-modal');
  const form    = document.getElementById('series-form');
  const pcInput = document.getElementById('series-project-code-input');
  const pcErr   = document.getElementById('series-project-code-error');
  form.reset();
  if (pcErr) pcErr.style.display = 'none';
  document.getElementById('series-modal-title').textContent = s ? '編輯系列活動' : '新增系列活動';

  if (s) {
    form.id.value          = s.id;
    form.name.value        = s.name || '';
    form.description.value = s.description || '';
    form.status.value      = s.status || 'active';

    // 編輯時可以修改 project_code（例如初建時漏填），但仍允許留空（用 COALESCE 保留原值）
    pcInput.value = s.project_code || '';
    // 若已有 project_code，用唯讀提示（防止誤改），但允許修改
    if (s.project_code) {
      pcInput.readOnly          = true;
      pcInput.title             = '如需更改活動專案代號，請聯絡 superadmin';
      pcInput.style.background  = 'var(--bg-secondary, #f3f4f6)';
      pcInput.style.cursor      = 'not-allowed';
    } else {
      pcInput.readOnly         = false;
      pcInput.title            = '';
      pcInput.style.background = '';
      pcInput.style.cursor     = '';
    }
  } else {
    form.id.value          = '';
    form.status.value      = 'active';
    pcInput.value          = '';
    pcInput.readOnly       = false;
    pcInput.title          = '';
    pcInput.style.background = '';
    pcInput.style.cursor   = '';
  }
  modal.classList.add('active');
}

async function confirmDeleteSeries(id) {
  const s = state.series.find(x => x.id === id);
  if (!confirm(`確定刪除系列「${s?.name}」？\n（底下各場次的系列關聯將清除，活動本身不會刪除）`)) return;
  try {
    await api('DELETE', `/api/events/series/${encodeURIComponent(id)}`);
    showToast('已刪除系列');
    state.series = [];
    loadSeries();
  } catch (err) {
    showToast('刪除失敗：' + err.message);
  }
}

// ------- File Ingest ==================================================
function bindIngestModal() {
  const modal = document.getElementById('ingest-modal');
  const dropZone = document.getElementById('ingest-drop');
  const fileInput = document.getElementById('ingest-file-input');

  document.getElementById('btn-ingest').addEventListener('click', () => openIngestModal());

  // drag & drop
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = e.dataTransfer.files?.[0];
    if (f) runIngest(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) runIngest(f);
  });

  // retry / cancel
  document.getElementById('ingest-retry').addEventListener('click', resetIngestUI);
  document.getElementById('ingest-cancel').addEventListener('click', () => modal.classList.remove('active'));
  document.getElementById('ingest-error-retry').addEventListener('click', resetIngestUI);
  document.getElementById('ingest-error-cancel').addEventListener('click', () => modal.classList.remove('active'));

  // confirm
  document.getElementById('ingest-confirm').addEventListener('click', handleIngestConfirm);

  // click backdrop
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
}

function openIngestModal() {
  const modal = document.getElementById('ingest-modal');
  resetIngestUI();
  modal.classList.add('active');
}

function resetIngestUI() {
  document.getElementById('ingest-drop').style.display = 'block';
  document.getElementById('ingest-loading').style.display = 'none';
  document.getElementById('ingest-preview').style.display = 'none';
  document.getElementById('ingest-error').style.display = 'none';
  document.getElementById('ingest-file-input').value = '';
  state.ingestPreview = null;
}

async function runIngest(file) {
  document.getElementById('ingest-drop').style.display = 'none';
  document.getElementById('ingest-loading').style.display = 'block';
  document.getElementById('ingest-preview').style.display = 'none';
  document.getElementById('ingest-error').style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/events/ingest', {
      method: 'POST',
      headers: { 'X-User-Code': state.userCode },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // 防禦性處理：後端（Gemini）偶爾回傳陣列 [{...}]，取第一個元素
    const preview = Array.isArray(data.preview) ? (data.preview[0] ?? {}) : (data.preview ?? {});
    state.ingestPreview = preview;
    showIngestPreview(preview, data.filename);
    if (data.warning) {
      setTimeout(() => showToast('⚠️ ' + data.warning), 300);
    }

  } catch (err) {
    document.getElementById('ingest-loading').style.display = 'none';
    document.getElementById('ingest-error').style.display = 'block';
    document.getElementById('ingest-error-msg').textContent = '解析失敗：' + err.message;
  }
}

function showIngestPreview(pv, filename) {
  // 防禦性正規化：確保 pv 是物件（不是陣列）
  if (Array.isArray(pv)) pv = pv[0] ?? {};
  if (!pv || typeof pv !== 'object') {
    document.getElementById('ingest-loading').style.display = 'none';
    document.getElementById('ingest-error').style.display = 'block';
    document.getElementById('ingest-error-msg').textContent = '解析結果格式錯誤，請重試';
    return;
  }

  document.getElementById('ingest-loading').style.display = 'none';
  document.getElementById('ingest-preview').style.display = 'block';

  document.getElementById('ingest-filename').textContent = filename || '';
  const badge = document.getElementById('ingest-series-badge');

  if (pv.is_series && pv.sessions?.length > 0) {
    badge.style.display = 'inline-block';
    document.getElementById('ingest-preview-single').style.display = 'none';
    document.getElementById('ingest-preview-series').style.display = 'block';

    document.getElementById('pv-series-name').textContent = pv.series_name || pv.name || '—';

    // project_code 輸入欄（系列層級）
    const seriesNameEl = document.getElementById('pv-series-name');
    // 在系列名稱後插入 project_code 輸入（若不存在則建立）
    let pcRow = document.getElementById('pv-project-code-row');
    if (!pcRow) {
      pcRow = document.createElement('div');
      pcRow.id = 'pv-project-code-row';
      pcRow.className = 'ingest-field-row';
      pcRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
      pcRow.innerHTML = `
        <span>活動專案代號 <span style="color:var(--danger)">*</span></span>
        <input type="text" id="pv-project-code-input"
               maxlength="10" placeholder="2026040001"
               style="font-family:monospace;letter-spacing:1px;font-size:0.85rem;padding:4px 8px;flex:1;max-width:180px;">
        <span id="pv-project-code-err" style="color:var(--danger);font-size:0.75rem;display:none;">格式錯誤（YYYYMM+4碼）</span>`;
      seriesNameEl.closest('.ingest-field-row').insertAdjacentElement('afterend', pcRow);
    }
    const pcInput = document.getElementById('pv-project-code-input');
    pcInput.value = pv.project_code || '';
    pcInput.oninput = function () {
      const err = document.getElementById('pv-project-code-err');
      err.style.display = (this.value && !EVENT_ID_RE.test(this.value)) ? 'inline' : 'none';
    };

    // 場次代號輸入（每場次）+ 地點參考
    const sessionList = document.getElementById('pv-sessions');
    const locationGuide = `
      <details style="margin-top:4px;font-size:0.74rem;color:var(--text-secondary);">
        <summary style="cursor:pointer;">📍 場次代號參考</summary>
        <div style="margin-top:4px;display:grid;grid-template-columns:repeat(3,1fr);gap:2px 12px;padding:6px;background:#f8fafc;border-radius:4px;line-height:1.7;">
          <span>台北 <code>02~02W</code></span><span>桃園 <code>03~03F</code></span><span>新竹 <code>035~035E</code></span>
          <span>台中 <code>04~04S</code></span><span>台南 <code>06~06D</code></span><span>高雄 <code>07~07C</code></span>
          <span>線上 <code>999~999EA</code></span><span>OT <code>OT01~OT99</code></span><span>泰國 <code>TH</code></span>
          <span>馬來西亞 <code>U01</code></span><span>越南 <code>VAJ</code></span><span style="color:#999;">更多見表單</span>
        </div>
      </details>`;

    sessionList.innerHTML = pv.sessions.map((s, i) =>
      `<div class="ingest-session-item">
        <strong>${escapeHtml(s.name || `場次 ${i + 1}`)}</strong>
        <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:6px;">${s.event_date || ''} ${s.event_time || ''} ${s.location ? '📍 ' + escapeHtml(s.location) : ''}</span>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label style="font-size:0.8rem;white-space:nowrap;color:var(--text-secondary);">場次代號 <span style="color:var(--danger)">*</span></label>
          <input type="text"
                 class="session-sc-input"
                 data-idx="${i}"
                 maxlength="10"
                 placeholder="如 02、999A、TH"
                 value="${escapeHtml(s.session_code || '')}"
                 style="font-family:monospace;letter-spacing:1px;font-size:0.85rem;padding:4px 8px;flex:1;max-width:140px;text-transform:uppercase;">
          <span class="session-sc-err" style="color:var(--danger);font-size:0.75rem;display:none;">格式錯誤</span>
        </div>
        ${i === 0 ? locationGuide : ''}
      </div>`
    ).join('');

    // 即時格式驗證
    sessionList.querySelectorAll('.session-sc-input').forEach(inp => {
      inp.addEventListener('input', function () {
        const err = this.closest('.ingest-session-item').querySelector('.session-sc-err');
        const val = this.value.trim().toUpperCase();
        err.style.display = (val && !SESSION_CODE_RE.test(val)) ? 'inline' : 'none';
      });
    });

    const confirmBtn = document.getElementById('ingest-confirm');
    confirmBtn.textContent = `建立系列 + ${pv.sessions.length} 場次`;

  } else {
    badge.style.display = 'none';
    document.getElementById('ingest-preview-single').style.display = 'block';
    document.getElementById('ingest-preview-series').style.display = 'none';

    document.getElementById('pv-name').textContent = pv.name || '—';
    document.getElementById('pv-date').textContent = pv.event_date || '—';
    document.getElementById('pv-time').textContent = pv.event_time || '—';
    document.getElementById('pv-location').textContent = pv.location || '—';
    document.getElementById('pv-desc').textContent = pv.description || '—';
    const ta = pv.target_audience;
    document.getElementById('pv-audience').textContent = ta
      ? [...(ta.functions || []), ...(ta.titles || [])].join('、') || '—'
      : '—';

    document.getElementById('ingest-confirm').textContent = '建立活動';
  }
}

async function handleIngestConfirm() {
  const pv = state.ingestPreview;
  if (!pv) return;
  const modal = document.getElementById('ingest-modal');

  if (pv.is_series && pv.sessions?.length > 0) {
    // ── 驗證活動專案代號（series 層級）────────────────────────────────────
    const pcInput = document.getElementById('pv-project-code-input');
    const pcVal   = (pcInput?.value || '').trim();
    if (!pcVal) {
      document.getElementById('pv-project-code-err').style.display = 'inline';
      showToast('請填寫活動專案代號（YYYYMM+4碼）');
      return;
    }
    if (!EVENT_ID_RE.test(pcVal)) {
      document.getElementById('pv-project-code-err').style.display = 'inline';
      showToast('活動專案代號格式錯誤（應為 YYYYMM+4碼，如 2026040001）');
      return;
    }

    // ── 收集並驗證各場次代號 ──────────────────────────────────────────────
    const scInputs = document.querySelectorAll('#pv-sessions .session-sc-input');
    const sessionCodes = [];
    let hasError = false;

    scInputs.forEach((inp, i) => {
      const val = inp.value.trim().toUpperCase();
      const err = inp.closest('.ingest-session-item').querySelector('.session-sc-err');
      if (!val) {
        err.textContent = '必填'; err.style.display = 'inline'; hasError = true;
      } else if (!SESSION_CODE_RE.test(val)) {
        err.textContent = '格式錯誤'; err.style.display = 'inline'; hasError = true;
      } else {
        err.style.display = 'none';
      }
      sessionCodes[i] = val;
    });

    // 檢查場次代號重複
    const seen = new Set();
    sessionCodes.forEach((sc, i) => {
      if (!sc) return;
      const inp = scInputs[i];
      const err = inp.closest('.ingest-session-item').querySelector('.session-sc-err');
      if (seen.has(sc)) {
        err.textContent = '與其他場次重複'; err.style.display = 'inline'; hasError = true;
      }
      seen.add(sc);
    });

    if (hasError) {
      showToast('請填寫所有場次的場次代號（如 02、999A、TH）');
      return; // 不關 modal，讓使用者修正
    }

    // ── 所有驗證通過 → 呼叫 batch 端點 ───────────────────────────────────
    modal.classList.remove('active');
    showSavingOverlay(`建立系列「${pv.series_name || pv.name}」及 ${pv.sessions.length} 場次中，請勿關閉頁面...`);
    try {
      const { series, events } = await api('POST', '/api/events/batch', {
        series: {
          name:         pv.series_name || pv.name,
          description:  pv.description || null,
          status:       'active',
          project_code: pcVal,
        },
        sessions: pv.sessions.map((s, i) => ({
          session_code: sessionCodes[i],
          name:         s.name,
          description:  s.description || pv.description || null,
          event_date:   s.event_date,
          event_time:   s.event_time || pv.event_time || null,
          location:     s.location || pv.location || null,
          target_audience: pv.target_audience || null,
        })),
      });
      state.series = []; // 清快取
      showToast(`已建立系列「${series.name}」及 ${events.length} 場次`);
      loadEvents();
    } catch (err) {
      showToast('批次建立失敗：' + err.message);
      modal.classList.add('active'); // 重新開啟讓使用者修正
    } finally {
      hideSavingOverlay();
    }

  } else {
    // ── 單一活動 → 開啟 event-modal 預填（讓使用者輸入 ID）────────────────
    modal.classList.remove('active');
    openEventModal(null, {
      name: pv.name,
      description: pv.description,
      event_date: pv.event_date,
      event_time: pv.event_time,
      location: pv.location,
      target_audience: pv.target_audience,
    });
  }
}

// ===================================================================
// ─── P3：資源管理 ──────────────────────────────────────────────────
// ===================================================================

// ── 標籤讀取（快取，所有模組共用）─────────────────────────────────────
async function loadAllTags(force = false) {
  if (!force && state.allTags.length > 0) return state.allTags;
  try {
    const { tags } = await api('GET', '/api/tags');
    state.allTags = tags || [];
  } catch { state.allTags = []; }
  return state.allTags;
}

const TAG_CATEGORY_LABELS = {
  resource_type: '資源類型',
  industry:      '適用產業',
  role:          '目標職務',
  channel:       '通路',
  scale:         '企業規模',
  customer_type: '客戶類型',
  session_pref:  '偏好場次',
  custom:        '自訂',
};

// ── 渲染標籤核取清單（resource modal 用）─────────────────────────────
function renderTagChecklist(tags, selectedIds = []) {
  if (!tags.length) return '<p style="color:var(--text-secondary);font-size:0.85rem;">尚無標籤，請先在「標籤管理」新增</p>';

  const grouped = {};
  for (const t of tags) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  return Object.entries(grouped).map(([cat, catTags]) => `
    <div class="tag-group">
      <div class="tag-group-label">${TAG_CATEGORY_LABELS[cat] || cat}</div>
      <div class="tag-group-items">
        ${catTags.map(t => `
          <label class="tag-check">
            <input type="checkbox" name="tag_ids" value="${escapeHtml(t.id)}"
                   ${selectedIds.includes(t.id) ? 'checked' : ''}>
            ${escapeHtml(t.name)}
          </label>
        `).join('')}
      </div>
    </div>`
  ).join('');
}

// ── 資源列表 ─────────────────────────────────────────────────────────
async function loadResources() {
  const tbody     = document.getElementById('resources-tbody');
  const eventSel  = document.getElementById('resource-filter-event');
  const typeSel   = document.getElementById('resource-filter-type');

  // 填事件篩選下拉
  if (state.events.length === 0) {
    try { const d = await api('GET', '/api/events'); state.events = d.events || []; } catch { /* noop */ }
  }
  const selectedEventId = eventSel.value;
  eventSel.innerHTML = '<option value="">所有活動</option>'
    + state.events.map(e =>
        `<option value="${escapeHtml(e.id)}" ${e.id === selectedEventId ? 'selected' : ''}>${escapeHtml(e.name)}</option>`
      ).join('');

  tbody.innerHTML = '<tr><td colspan="6" class="empty">載入中...</td></tr>';

  const params = new URLSearchParams();
  if (eventSel.value) params.set('event_id', eventSel.value);
  if (typeSel.value)  params.set('type', typeSel.value);

  try {
    const { resources } = await api('GET', `/api/resources?${params}`);
    state.resources = resources || [];
    if (!resources.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">沒有符合的資源</td></tr>';
      return;
    }
    tbody.innerHTML = resources.map(r => renderResourceRow(r)).join('');
    tbody.querySelectorAll('[data-edit-resource]').forEach(b =>
      b.addEventListener('click', () => openResourceModal(state.resources.find(r => r.id === b.dataset.editResource))));
    tbody.querySelectorAll('[data-delete-resource]').forEach(b =>
      b.addEventListener('click', () => confirmDeleteResource(b.dataset.deleteResource)));
    tbody.querySelectorAll('[data-download-resource]').forEach(b =>
      b.addEventListener('click', () => downloadResource(b.dataset.downloadResource)));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">載入失敗：${e.message}</td></tr>`;
  }
}

const RESOURCE_TYPE_LABELS = { slide: '投影片', video: '影片', article: '文章', other: '其他' };
const RESOURCE_TYPE_ICONS  = { slide: '📊', video: '🎬', article: '📄', other: '📦' };

function renderResourceRow(r) {
  const canEdit = state.role === 'superadmin' || (state.managedEventIds || []).includes(r.event_id);
  const storageIcon = r.storage_type === 'r2'
    ? `<span title="上傳檔案" style="cursor:pointer;" data-download-resource="${r.id}">📥 ${escapeHtml(r.file_name || '檔案')}</span>`
    : `<a href="${escapeHtml(r.url || '')}" target="_blank" rel="noopener" style="color:var(--primary);">🔗 連結</a>`;
  const typeLabel = `${RESOURCE_TYPE_ICONS[r.resource_type] || ''}${RESOURCE_TYPE_LABELS[r.resource_type] || r.resource_type}`;
  const tagChips = (r.tags || []).map(t =>
    `<span class="role-badge" style="font-size:0.7rem;padding:1px 6px;">${escapeHtml(t.name)}</span>`
  ).join(' ');

  return `
    <tr>
      <td>
        <strong>${escapeHtml(r.title)}</strong>
        ${tagChips ? `<br>${tagChips}` : ''}
      </td>
      <td>${typeLabel}</td>
      <td>${escapeHtml(r.event_name || r.event_id)}</td>
      <td>${storageIcon}</td>
      <td>${escapeHtml(r.uploaded_by || '—')}</td>
      <td><div class="row-actions">
        ${canEdit ? `<button class="btn-ghost" data-edit-resource="${escapeHtml(r.id)}">編輯</button>` : ''}
        ${canEdit ? `<button class="btn-danger" data-delete-resource="${escapeHtml(r.id)}">刪除</button>` : ''}
      </div></td>
    </tr>`;
}

async function downloadResource(id) {
  const resource = state.resources.find(r => r.id === id);
  if (resource?.storage_type === 'link') {
    window.open(resource.url, '_blank', 'noopener');
    return;
  }
  // R2 檔案：用 fetch 帶 auth header，再轉成 blob URL 觸發下載
  try {
    showToast('準備下載中…');
    const res = await fetch(`/api/resources/${encodeURIComponent(id)}?action=download`, {
      headers: { 'X-User-Code': state.userCode },
    });
    if (!res.ok) { showToast('下載失敗：' + (await res.json().catch(() => ({}))).error || res.status); return; }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = resource?.file_name || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    showToast('下載失敗：' + e.message);
  }
}

async function confirmDeleteResource(id) {
  const r = state.resources.find(x => x.id === id);
  if (!confirm(`確定刪除資源「${r?.title}」？${r?.storage_type === 'r2' ? '\n（R2 上的檔案也會一併刪除）' : ''}`)) return;
  try {
    await api('DELETE', `/api/resources/${encodeURIComponent(id)}`);
    showToast('已刪除資源');
    loadResources();
  } catch (err) {
    showToast('刪除失敗：' + err.message);
  }
}

// ── Resource Modal：綁定 ──────────────────────────────────────────────
function bindResourceModal() {
  const modal   = document.getElementById('resource-modal');
  const dropZone = document.getElementById('resource-drop');
  const fileInput = document.getElementById('resource-file-input');

  document.getElementById('btn-new-resource').addEventListener('click', () => openResourceModal(null));
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

  // storage_type 切換
  document.getElementById('resource-storage-type').addEventListener('change', function () {
    const isFile = this.value === 'r2';
    document.getElementById('resource-url-group').style.display  = isFile ? 'none'  : 'block';
    document.getElementById('resource-file-group').style.display = isFile ? 'block' : 'none';
    document.querySelector('#resource-form input[name=url]').required = !isFile;
  });

  // 篩選器觸發重載
  document.getElementById('resource-filter-event').addEventListener('change', loadResources);
  document.getElementById('resource-filter-type').addEventListener('change', loadResources);

  // 拖曳 & 點擊上傳
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = e.dataTransfer.files?.[0];
    if (f) selectResourceFile(f);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) selectResourceFile(fileInput.files[0]);
  });

  // 表單送出
  document.getElementById('resource-form').addEventListener('submit', handleResourceSubmit);
}

function selectResourceFile(file) {
  state.resourceFile = file;
  const chosen = document.getElementById('resource-file-chosen');
  chosen.textContent = `已選擇：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
  chosen.style.display = 'block';
  document.getElementById('resource-drop-text').innerHTML =
    `<span style="font-size:1.5rem;">✅</span><br>${escapeHtml(file.name)}`;
}

async function openResourceModal(r) {
  const modal = document.getElementById('resource-modal');
  const form  = document.getElementById('resource-form');
  form.reset();
  state.resourceFile = null;
  document.getElementById('resource-file-chosen').style.display = 'none';
  document.getElementById('resource-drop-text').innerHTML = '<span style="font-size:1.5rem;">📎</span><br>拖曳檔案至此，或點擊選擇';
  document.getElementById('resource-file-input').value = '';
  document.getElementById('resource-modal-title').textContent = r ? '編輯資源' : '新增資源';

  // 確保活動清單有資料
  if (state.events.length === 0) {
    try { const d = await api('GET', '/api/events'); state.events = d.events || []; } catch { /* noop */ }
  }
  const eventSel = document.getElementById('resource-event-select');
  eventSel.innerHTML = '<option value="">— 選擇活動 —</option>'
    + state.events.map(e =>
        `<option value="${escapeHtml(e.id)}" ${r?.event_id === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`
      ).join('');

  // 載入標籤
  const tags = await loadAllTags();

  // 預載標籤選取狀態（編輯用）
  let selectedTagIds = [];
  if (r) {
    try {
      const { resource } = await api('GET', `/api/resources/${encodeURIComponent(r.id)}`);
      selectedTagIds = (resource.tags || []).map(t => t.id);
    } catch { /* noop */ }
  }

  document.getElementById('resource-tag-checklist').innerHTML = renderTagChecklist(tags, selectedTagIds);

  // 儲存方式顯示控制
  const storageTypeSel = document.getElementById('resource-storage-type');
  const isFile = storageTypeSel.value === 'r2';
  document.getElementById('resource-url-group').style.display  = isFile ? 'none'  : 'block';
  document.getElementById('resource-file-group').style.display = isFile ? 'block' : 'none';

  if (r) {
    // 編輯模式
    form.id.value          = r.id;
    form.title.value       = r.title || '';
    form.description.value = r.description || '';
    form.resource_type.value = r.resource_type || 'slide';
    storageTypeSel.value   = r.storage_type || 'link';
    storageTypeSel.disabled = true; // 編輯時不允許切換儲存方式

    // 重新觸發顯示邏輯
    const isFileEdit = r.storage_type === 'r2';
    document.getElementById('resource-url-group').style.display  = isFileEdit ? 'none'  : 'block';
    document.getElementById('resource-file-group').style.display = isFileEdit ? 'block' : 'none';
    if (!isFileEdit) form.url.value = r.url || '';

    document.getElementById('resource-submit-btn').textContent = '更新';
  } else {
    form.id.value = '';
    storageTypeSel.disabled = false;
    document.getElementById('resource-submit-btn').textContent = '新增';
  }

  modal.classList.add('active');
}

async function handleResourceSubmit(e) {
  e.preventDefault();
  const form    = document.getElementById('resource-form');
  const isEdit  = !!form.id.value;
  const storageType = document.getElementById('resource-storage-type').value;
  const tagIds = [...document.querySelectorAll('#resource-tag-checklist input[name=tag_ids]:checked')].map(i => i.value);
  const modal = document.getElementById('resource-modal');

  if (isEdit) {
    // ── 編輯（JSON PUT）──────────────────────────────────────────────
    const payload = {
      title:         form.title.value.trim(),
      description:   form.description.value.trim(),
      resource_type: form.resource_type.value,
      tags: tagIds,
    };
    showSavingOverlay('更新資源中...');
    try {
      await api('PUT', `/api/resources/${encodeURIComponent(form.id.value)}`, payload);
      showToast('資源已更新');
      modal.classList.remove('active');
      loadResources();
    } catch (err) {
      showToast('更新失敗：' + err.message);
    } finally {
      hideSavingOverlay();
    }

  } else if (storageType === 'r2') {
    // ── 新增檔案（multipart/form-data）──────────────────────────────
    if (!state.resourceFile) { showToast('請選擇要上傳的檔案'); return; }
    if (!form.event_id.value) { showToast('請選擇所屬活動'); return; }

    const fd = new FormData();
    fd.append('event_id',      form.event_id.value);
    fd.append('title',         form.title.value.trim());
    fd.append('description',   form.description.value.trim());
    fd.append('resource_type', form.resource_type.value);
    fd.append('tags',          tagIds.join(','));
    fd.append('file',          state.resourceFile);

    showSavingOverlay(`上傳「${state.resourceFile.name}」中，請勿關閉頁面...`);
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'X-User-Code': state.userCode },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast('資源已上傳');
      modal.classList.remove('active');
      loadResources();
    } catch (err) {
      showToast('上傳失敗：' + err.message);
    } finally {
      hideSavingOverlay();
    }

  } else {
    // ── 新增連結（JSON POST）─────────────────────────────────────────
    if (!form.event_id.value) { showToast('請選擇所屬活動'); return; }
    const payload = {
      event_id:      form.event_id.value,
      title:         form.title.value.trim(),
      description:   form.description.value.trim(),
      resource_type: form.resource_type.value,
      storage_type:  'link',
      url:           form.url.value.trim(),
      tags: tagIds,
    };
    showSavingOverlay('儲存連結中...');
    try {
      await api('POST', '/api/resources', payload);
      showToast('資源已新增');
      modal.classList.remove('active');
      loadResources();
    } catch (err) {
      showToast('新增失敗：' + err.message);
    } finally {
      hideSavingOverlay();
    }
  }
}

// ===================================================================
// ─── P3：標籤管理（superadmin）──────────────────────────────────────
// ===================================================================

async function loadTagsAdmin() {
  const panel = document.getElementById('tags-panel');
  panel.innerHTML = '<p class="empty">載入中...</p>';
  try {
    const { tags } = await api('GET', '/api/admin/tags');
    state.allTags = tags || []; // 同步更新快取

    if (!tags.length) {
      panel.innerHTML = '<p class="empty">尚無標籤，點右上「新增標籤」建立</p>';
      return;
    }

    // 依 category 分組渲染
    const grouped = {};
    for (const t of tags) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }

    panel.innerHTML = Object.entries(grouped).map(([cat, catTags]) => `
      <div class="tag-category-section">
        <div class="tag-category-header">
          <span>${TAG_CATEGORY_LABELS[cat] || cat}</span>
          <small style="color:var(--text-secondary);">${catTags.length} 個標籤</small>
        </div>
        <div class="tag-chips-admin">
          ${catTags.map(t => `
            <span class="tag-chip-admin">
              ${escapeHtml(t.name)}
              ${state.role === 'superadmin' ? `<button class="tag-chip-del" data-delete-tag="${escapeHtml(t.id)}" title="刪除">×</button>` : ''}
            </span>
          `).join('')}
        </div>
      </div>
    `).join('');

    // 刪除按鈕
    panel.querySelectorAll('[data-delete-tag]').forEach(b =>
      b.addEventListener('click', () => confirmDeleteTag(b.dataset.deleteTag)));

  } catch (e) {
    panel.innerHTML = `<p class="empty">載入失敗：${e.message}</p>`;
  }
}

function bindTagModal() {
  const modal = document.getElementById('tag-modal');
  document.getElementById('btn-new-tag').addEventListener('click', () => {
    document.getElementById('tag-form').reset();
    modal.classList.add('active');
  });
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.remove('active')));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });

  document.getElementById('tag-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const payload = {
      category:   form.category.value,
      name:       form.name.value.trim(),
      sort_order: parseInt(form.sort_order.value, 10) || 0,
    };
    try {
      await api('POST', '/api/admin/tags', payload);
      showToast('標籤已新增');
      modal.classList.remove('active');
      state.allTags = []; // 清快取
      loadTagsAdmin();
    } catch (err) {
      showToast('新增失敗：' + err.message);
    }
  });
}

async function confirmDeleteTag(id) {
  const t = state.allTags.find(x => x.id === id);
  if (!confirm(`確定刪除標籤「${t?.name}」？\n（已關聯的活動/資源標籤也會一併移除）`)) return;
  try {
    await api('DELETE', `/api/admin/tags/${encodeURIComponent(id)}`);
    showToast('標籤已刪除');
    state.allTags = [];
    loadTagsAdmin();
  } catch (err) {
    showToast('刪除失敗：' + err.message);
  }
}

// ------- Helpers -------
function csv(s) { return (s || '').split(',').map(x => x.trim()).filter(Boolean); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 2400);
}
