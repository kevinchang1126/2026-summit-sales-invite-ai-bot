// ===== Admin Console =====

const state = {
  userCode: localStorage.getItem('user_code') || '',
  role: null,
  events: [],
  series: [],
  roles: [],
  userSearchTimer: null,
  selectedUser: null,
  ingestPreview: null,   // 最近一次 Gemini 解析結果
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
      if (v === 'roles') loadRoles();
      if (v === 'events') loadEvents();
      if (v === 'series') loadSeries();
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
  return `
    <tr>
      <td>
        <strong>${escapeHtml(e.name)}</strong>
        ${e.series_name ? `<span style="font-size:0.75rem;background:#eff6ff;color:#1d4ed8;padding:1px 7px;border-radius:999px;margin-left:6px;">📋 ${escapeHtml(e.series_name)}</span>` : ''}
        <br><small style="color:var(--text-secondary);">${e.id}</small>
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

// ─── 活動 ID 格式驗證 ────────────────────────────────────────────────────────
// 活動專案代號由外部系統指派（YYYYMM+4碼），本平台只做格式卡控，不自動產生
const EVENT_ID_RE = /^20\d{2}(0[1-9]|1[0-2])\d{4}$/;

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

  document.getElementById('event-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value.trim();

    // 新增時 ID 必填且格式正確
    const isNew = !form.dataset.editId;
    if (isNew) {
      if (!id) { showToast('請填寫活動專案代號（YYYYMM+4碼）'); return; }
      if (!EVENT_ID_RE.test(id)) { showToast('活動 ID 格式錯誤，應為 10 碼數字（如 2026040001）'); return; }
    }

    const payload = {
      name: form.name.value.trim(),
      description: form.description.value.trim(),
      event_date: form.event_date.value,
      event_time: form.event_time.value.trim(),
      location: form.location.value.trim(),
      status: form.status.value,
      series_id: form.series_id.value || null,
      series_order: form.series_order.value ? parseInt(form.series_order.value, 10) : null,
      target_audience: {
        functions: csv(form.audience_functions.value),
        titles: csv(form.audience_titles.value),
      },
    };
    if (isNew) payload.id = id;

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
  const form = document.getElementById('event-form');
  form.reset();
  document.getElementById('event-modal-title').textContent = e ? '編輯活動' : '新增活動';

  // 填入 series 下拉
  await populateSeriesSelect(e?.series_id);

  const idInput = document.getElementById('event-id-input');
  const idErr   = document.getElementById('event-id-error');
  if (idErr) idErr.style.display = 'none';

  if (e) {
    // 編輯模式：ID 唯讀（不可更改）
    form.dataset.editId  = e.id;
    idInput.value        = e.id;
    idInput.readOnly     = true;
    idInput.style.background = 'var(--bg-secondary, #f3f4f6)';
    idInput.style.cursor = 'not-allowed';

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
    // 新增模式：ID 必填，人工輸入
    delete form.dataset.editId;
    idInput.value        = '';
    idInput.readOnly     = false;
    idInput.style.background = '';
    idInput.style.cursor = '';
    idInput.placeholder  = '請輸入活動專案代號（如 2026040001）';
    form.status.value    = 'upcoming';
  }

  // 來自 ingest 的預填值覆蓋
  if (prefill) {
    if (prefill.name)        form.name.value = prefill.name;
    if (prefill.description) form.description.value = prefill.description;
    if (prefill.event_date) form.event_date.value = prefill.event_date;
    if (prefill.event_time)  form.event_time.value = prefill.event_time;
    if (prefill.location)    form.location.value = prefill.location;
    if (prefill.target_audience) {
      const ta = prefill.target_audience;
      form.audience_functions.value = (ta.functions || []).join(',');
      form.audience_titles.value    = (ta.titles || []).join(',');
    }
    if (prefill.series_id)    form.series_id.value    = prefill.series_id;
    if (prefill.series_order) form.series_order.value = prefill.series_order;
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
  return `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong><br><small style="color:var(--text-secondary);">${s.id}</small></td>
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

  document.getElementById('series-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value;
    const payload = {
      name: form.name.value.trim(),
      description: form.description.value.trim(),
      status: form.status.value,
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
  const modal = document.getElementById('series-modal');
  const form = document.getElementById('series-form');
  form.reset();
  document.getElementById('series-modal-title').textContent = s ? '編輯系列活動' : '新增系列活動';
  if (s) {
    form.id.value = s.id;
    form.name.value = s.name || '';
    form.description.value = s.description || '';
    form.status.value = s.status || 'active';
  } else {
    form.id.value = '';
    form.status.value = 'active';
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

    const sessionList = document.getElementById('pv-sessions');
    sessionList.innerHTML = pv.sessions.map((s, i) =>
      `<div class="ingest-session-item">
        <strong>${escapeHtml(s.name || `場次 ${i + 1}`)}</strong>
        <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:6px;">${s.event_date || ''} ${s.event_time || ''} ${s.location ? '📍 ' + escapeHtml(s.location) : ''}</span>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
          <label style="font-size:0.8rem;white-space:nowrap;color:var(--text-secondary);">專案代號 <span style="color:var(--danger)">*</span></label>
          <input type="text"
                 class="session-id-input"
                 data-idx="${i}"
                 maxlength="10"
                 placeholder="2026040001"
                 value="${escapeHtml(s.id || '')}"
                 style="font-family:monospace;letter-spacing:1px;font-size:0.85rem;padding:4px 8px;flex:1;max-width:160px;">
          <span class="session-id-err" style="color:var(--danger);font-size:0.75rem;display:none;">格式錯誤</span>
        </div>
      </div>`
    ).join('');

    // 即時格式驗證
    sessionList.querySelectorAll('.session-id-input').forEach(inp => {
      inp.addEventListener('input', function () {
        const err = this.closest('.ingest-session-item').querySelector('.session-id-err');
        err.style.display = (this.value && !EVENT_ID_RE.test(this.value)) ? 'inline' : 'none';
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
    // ── 收集並驗證各場次 ID ───────────────────────────────────────────────
    const idInputs = document.querySelectorAll('#pv-sessions .session-id-input');
    const sessionIds = [];
    let hasError = false;

    idInputs.forEach((inp, i) => {
      const val = inp.value.trim();
      const err = inp.closest('.ingest-session-item').querySelector('.session-id-err');
      if (!val) {
        err.textContent = '必填'; err.style.display = 'inline'; hasError = true;
      } else if (!EVENT_ID_RE.test(val)) {
        err.textContent = '格式錯誤'; err.style.display = 'inline'; hasError = true;
      } else {
        err.style.display = 'none';
      }
      sessionIds[i] = val;
    });

    // 檢查重複 ID
    const seen = new Set();
    sessionIds.forEach((id, i) => {
      if (!id) return;
      const inp = idInputs[i];
      const err = inp.closest('.ingest-session-item').querySelector('.session-id-err');
      if (seen.has(id)) {
        err.textContent = '與其他場次重複'; err.style.display = 'inline'; hasError = true;
      }
      seen.add(id);
    });

    if (hasError) {
      showToast('請填寫所有場次的活動專案代號（格式：YYYYMM+4碼）');
      return; // 不關 modal，讓使用者修正
    }

    // ── 所有 ID 驗證通過 → 呼叫 batch 端點 ──────────────────────────────
    modal.classList.remove('active');
    showSavingOverlay(`建立系列「${pv.series_name || pv.name}」及 ${pv.sessions.length} 場次中，請勿關閉頁面...`);
    try {
      const { series, events } = await api('POST', '/api/events/batch', {
        series: {
          name: pv.series_name || pv.name,
          description: pv.description || null,
          status: 'active',
        },
        sessions: pv.sessions.map((s, i) => ({
          id: sessionIds[i],
          name: s.name,
          description: s.description || pv.description || null,
          event_date: s.event_date,
          event_time: s.event_time || pv.event_time || null,
          location: s.location || pv.location || null,
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
