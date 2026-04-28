// ========================================================
// Resources Center - Phase 4
// ========================================================

// ── PDF.js 預覽狀態 ────────────────────────────────────────────
const _RPDFJSW = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let _rPdfDoc = null, _rPdfPage = 1, _rPdfTotal = 0, _rPdfBusy = false, _rPdfQueued = null;

async function _rPdfRender(n) {
  if (!_rPdfDoc) return;
  if (_rPdfBusy) { _rPdfQueued = n; return; }
  _rPdfBusy = true;
  _rPdfPage = n;
  const info = document.getElementById('rc-pdf-page-info');
  const prev = document.getElementById('rc-pdf-prev');
  const next = document.getElementById('rc-pdf-next');
  if (info) info.textContent = `${n} / ${_rPdfTotal}`;
  if (prev) prev.disabled = n <= 1;
  if (next) next.disabled = n >= _rPdfTotal;
  const cont   = document.getElementById('rc-pdf-container');
  const canvas = document.getElementById('rc-pdf-canvas');
  const pg     = await _rPdfDoc.getPage(n);
  const dpr    = Math.min(window.devicePixelRatio || 1, 2);
  const w      = (cont.clientWidth || 360) - 16;
  const nat    = pg.getViewport({ scale: 1 });
  const vp     = pg.getViewport({ scale: (w / nat.width) * dpr });
  canvas.width  = vp.width;
  canvas.height = vp.height;
  canvas.style.width  = `${w}px`;
  canvas.style.height = `${Math.round(w * nat.height / nat.width)}px`;
  await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  _rPdfBusy = false;
  if (_rPdfQueued !== null) { const q = _rPdfQueued; _rPdfQueued = null; await _rPdfRender(q); }
}

// ===== Constants =====
const CATEGORY_LABELS = {
  industry:      '產業',
  role:          '職能',
  session_pref:  '場次偏好',
  customer_type: '客戶類型',
  scale:         '公司規模',
  channel:       '管道',
  custom:        '自訂',
};
// 顯示順序（不含 resource_type，因為已有獨立 chip）
const CATEGORY_ORDER = ['industry', 'role', 'session_pref', 'customer_type', 'scale', 'channel', 'custom'];

const TYPE_ICONS = {
  article: '📄',
  slide:   '📊',
  video:   '🎬',
  other:   '📎',
};
const TYPE_LABELS = {
  article: '文章',
  slide:   '簡報',
  video:   '影片',
  other:   '其他',
};

// ===== State =====
const state = {
  userCode: null,
  displayName: '',

  allEvents: [],
  allTags: [],
  tagsByCategory: {},
  resources: [],      // 當前 event/type 下的原始資源（含標籤）

  filters: {
    eventId: '',
    type:    '',
    keyword: '',
    tagIds:  [],
    mode:    'or',
    count:   5,        // 5 / 10 / 20 / 'all'
  },

  visibleEventIds: [], // 依 count 計算出的活動可視範圍
  _fetchSeq: 0,        // 防止競態
};

// ===== Utils =====
function authFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.userCode) headers.set('X-User-Code', state.userCode);
  return fetch(path, { ...options, headers });
}

function showToast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('active');
  setTimeout(() => t.classList.remove('active'), ms);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// 以 |event_date - today| 排序，取前 N 場
function computeVisibleEventIds() {
  const today = Date.now();
  const withDist = state.allEvents
    .map(e => ({ e, dist: Math.abs(new Date(e.event_date).getTime() - today) }))
    .filter(x => !isNaN(x.dist))
    .sort((a, b) => a.dist - b.dist);
  const count = state.filters.count;
  const sliced = count === 'all' ? withDist : withDist.slice(0, Number(count) || 5);
  state.visibleEventIds = sliced.map(x => x.e.id);
}

// ===== Auth & Init =====
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token     = urlParams.get('token');
  const overlay   = document.getElementById('auth-overlay');
  const appC      = document.getElementById('app-container');
  const authMsg   = document.getElementById('auth-message');

  async function runAuthByToken(tok) {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '驗證失敗');
    localStorage.setItem('user_code', data.UserCode);
    localStorage.setItem('ad_name', data.UserName);
    localStorage.setItem('custom_nickname', data.custom_nickname || '');
    localStorage.setItem('display_name', data.display_name);
    localStorage.setItem('role', data.role || '');
    localStorage.setItem('managed_event_ids', JSON.stringify(data.managed_event_ids || []));
    // 移除 token 保留其他 query（event/type/...）
    urlParams.delete('token');
    const qs = urlParams.toString();
    window.history.replaceState({}, document.title, window.location.pathname + (qs ? '?' + qs : ''));
  }

  try {
    if (token) {
      await runAuthByToken(token);
    }
    let userCode = localStorage.getItem('user_code');
    if (!userCode && isLocalDev()) {
      const ok = await tryDevLogin();
      if (ok) userCode = localStorage.getItem('user_code');
    }
    if (!userCode) {
      authMsg.innerHTML = '請由數智入口&gt;諾瓦Nova 進入活動邀約快手';
      authMsg.style.color = 'red';
      document.querySelector('.spinner').style.display = 'none';
      document.querySelector('#auth-overlay h2').textContent = '驗證失敗';
      return;
    }
    state.userCode    = userCode;
    state.displayName = localStorage.getItem('display_name')
                    || localStorage.getItem('custom_nickname')
                    || localStorage.getItem('ad_name') || '';
    overlay.style.display = 'none';
    appC.style.display    = 'block';
    await initApp();
  } catch (err) {
    authMsg.innerHTML = '驗證失敗：' + escapeHtml(err.message);
    authMsg.style.color = 'red';
    document.querySelector('.spinner').style.display = 'none';
    document.querySelector('#auth-overlay h2').textContent = '驗證失敗';
  }
});

async function initApp() {
  // 顯示使用者
  const userEl = document.getElementById('rc-user');
  if (userEl) userEl.textContent = state.displayName;

  // 本地開發 badge
  if (isLocalDev() && localStorage.getItem('dev_user_code')) {
    showDevBadge(localStorage.getItem('dev_user_code'), localStorage.getItem('role'));
  }

  bindUI();

  // 同時載入活動、標籤
  await Promise.all([loadEvents(), loadTags()]);

  // 從 URL 還原篩選
  applyFiltersFromURL();

  // 首次載入資源
  await loadResources();
}

// ===== UI Binding =====
function bindUI() {
  // 活動下拉
  document.getElementById('filter-event').addEventListener('change', (e) => {
    state.filters.eventId = e.target.value;
    syncURL();
    loadResources();
  });

  // 活動數量範圍
  document.getElementById('filter-event-count').addEventListener('change', (e) => {
    const v = e.target.value;
    state.filters.count = v === 'all' ? 'all' : Number(v);
    computeVisibleEventIds();
    renderEventSelect();
    // 若目前選的活動不在範圍內，清除
    if (state.filters.eventId && !state.visibleEventIds.includes(state.filters.eventId)) {
      state.filters.eventId = '';
      document.getElementById('filter-event').value = '';
      syncURL();
      loadResources();
    } else {
      syncURL();
      render();
    }
  });

  // 資源類型 chips
  document.querySelectorAll('#filter-type .rc-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filter-type .rc-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.type = btn.dataset.type || '';
      syncURL();
      loadResources();
    });
  });

  // 關鍵字（防抖）
  let kwTimer;
  document.getElementById('filter-keyword').addEventListener('input', (e) => {
    clearTimeout(kwTimer);
    const val = e.target.value;
    kwTimer = setTimeout(() => {
      state.filters.keyword = val.trim().toLowerCase();
      syncURL();
      render();
    }, 200);
  });

  // AND/OR 切換
  document.getElementById('mode-or').addEventListener('click',  () => setMode('or'));
  document.getElementById('mode-and').addEventListener('click', () => setMode('and'));

  // 清除篩選
  document.getElementById('btn-clear-filters').addEventListener('click', clearAllFilters);

  // ── 篩選欄 scroll 收合 ──────────────────────────────────────────────────
  const filterEl   = document.querySelector('.rc-filter');
  const filterBar  = document.getElementById('rc-filter-bar');
  const barSummary = document.getElementById('rc-filter-bar-summary');
  const barExpand  = document.getElementById('rc-filter-bar-expand');

  function getFilterSummary() {
    const parts = [];
    const f = state.filters;
    if (f.type)          parts.push({ article:'文章', slide:'簡報', video:'影片', other:'其他' }[f.type] || f.type);
    if (f.keyword)       parts.push(`「${f.keyword}」`);
    if (f.tagIds.length) parts.push(`標籤 ×${f.tagIds.length}`);
    const countLabel = f.count === 'all' ? '全部活動' : `最近 ${f.count} 場`;
    return parts.length ? `${countLabel} · ${parts.join(' · ')}` : countLabel;
  }

  // ── 架構說明 ────────────────────────────────────────────────────────────
  // filter 永遠保持原始高度在 document flow 中，不做任何 collapse 動畫。
  // 只用 IntersectionObserver 觀察 filter 是否還在 viewport 內：
  //   - 不在 → 顯示固定提示列（不改變任何 DOM 高度，scrollY 不受影響）
  //   - 在   → 隱藏提示列
  // 完全消除收合/展開造成的 layout shift → scrollY 變化 → 再觸發的振盪迴圈。

  const headerEl = document.querySelector('.rc-header');

  function getHeaderH() {
    return headerEl ? headerEl.getBoundingClientRect().height : 0;
  }

  function positionFilterBar() {
    filterBar.style.top = `${getHeaderH()}px`;
  }
  positionFilterBar();
  window.addEventListener('resize', positionFilterBar, { passive: true });

  function showFilterBar() {
    barSummary.textContent = getFilterSummary();
    filterBar.style.display = 'flex';
  }
  function hideFilterBar() {
    filterBar.style.display = 'none';
  }

  // 觀察 filter 元素本身是否還在 viewport（扣除 header 高度）
  let filterObserver = null;
  function setupFilterObserver() {
    if (filterObserver) filterObserver.disconnect();
    const hh = Math.ceil(getHeaderH());
    filterObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          hideFilterBar();
        } else {
          showFilterBar();
        }
      },
      { threshold: 0, rootMargin: `-${hh}px 0px 0px 0px` }
    );
    filterObserver.observe(filterEl);
  }
  setupFilterObserver();
  // resize 時 header 高度可能改變，重建 observer
  window.addEventListener('resize', setupFilterObserver, { passive: true });

  barExpand?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── 預覽 Modal ──────────────────────────────────────────────────────────
  const previewOverlay  = document.getElementById('rc-preview-modal');
  const previewClose    = document.getElementById('rc-preview-close');
  const previewDownload = document.getElementById('rc-preview-download');
  let _previewResourceId = null;

  function closePreview() {
    previewOverlay.style.display = 'none';
    const iframe   = document.getElementById('rc-preview-iframe');
    const img      = document.getElementById('rc-preview-img');
    const video    = document.getElementById('rc-preview-video');
    const pdfCont  = document.getElementById('rc-pdf-container');
    const pdfCtrl  = document.getElementById('rc-pdf-controls');
    const body     = document.getElementById('rc-preview-body');
    iframe.src = ''; img.src = ''; video.src = '';
    iframe.style.display = img.style.display = video.style.display = 'none';
    if (pdfCont) pdfCont.style.display = 'none';
    if (pdfCtrl) pdfCtrl.style.display = 'none';
    if (body)    body.classList.remove('pdf-active');
    document.getElementById('rc-preview-loading').style.display    = 'flex';
    document.getElementById('rc-preview-unsupported').style.display = 'none';
    _previewResourceId = null;
    _rPdfDoc = null; _rPdfBusy = false; _rPdfQueued = null;
  }

  previewClose?.addEventListener('click', closePreview);
  previewOverlay?.addEventListener('click', (e) => { if (e.target === previewOverlay) closePreview(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreview(); });

  // PDF 頁面切換
  document.getElementById('rc-pdf-prev')?.addEventListener('click', async () => {
    if (_rPdfPage > 1) await _rPdfRender(_rPdfPage - 1);
  });
  document.getElementById('rc-pdf-next')?.addEventListener('click', async () => {
    if (_rPdfPage < _rPdfTotal) await _rPdfRender(_rPdfPage + 1);
  });

  previewDownload?.addEventListener('click', () => {
    if (_previewResourceId) downloadResource(_previewResourceId);
  });

  window._openPreview = async function(id) {
    const r = state.resources.find(x => x.id === id);
    if (!r) return;
    _previewResourceId = id;
    previewOverlay.style.display = 'flex';
    document.getElementById('rc-preview-title').textContent = r.title || r.file_name || '';

    // 連結類型 → 直接新分頁開啟，不做 modal
    if (r.storage_type === 'link') {
      closePreview();
      window.open(r.url, '_blank', 'noopener');
      return;
    }

    // 重置 loading 狀態
    document.getElementById('rc-preview-loading').style.display    = 'flex';
    document.getElementById('rc-preview-unsupported').style.display = 'none';
    const iframe = document.getElementById('rc-preview-iframe');
    const img    = document.getElementById('rc-preview-img');
    const video  = document.getElementById('rc-preview-video');
    iframe.style.display = img.style.display = video.style.display = 'none';

    const mime = r.mime_type || '';
    const uc = encodeURIComponent(state.userCode || '');
    const previewUrl = `/api/resources/${encodeURIComponent(id)}?action=preview&uc=${uc}`;

    if (mime === 'application/pdf') {
      // PDF → PDF.js（支援 iOS Safari）
      const pdfCont = document.getElementById('rc-pdf-container');
      const pdfCtrl = document.getElementById('rc-pdf-controls');
      const body    = document.getElementById('rc-preview-body');
      _rPdfDoc = null; _rPdfBusy = false; _rPdfQueued = null;
      if (window.pdfjsLib) {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = _RPDFJSW;
          const task = window.pdfjsLib.getDocument({ url: previewUrl });
          _rPdfDoc   = await task.promise;
          _rPdfTotal = _rPdfDoc.numPages;
          document.getElementById('rc-preview-loading').style.display = 'none';
          pdfCont.style.display = 'block';
          body.classList.add('pdf-active');
          if (_rPdfTotal > 1) pdfCtrl.style.display = 'flex';
          await _rPdfRender(1);
        } catch (e) {
          console.warn('PDF.js failed, iframe fallback:', e);
          document.getElementById('rc-preview-loading').style.display = 'none';
          iframe.src = previewUrl;
          iframe.style.display = 'block';
        }
      } else {
        // PDF.js 未載入 → iframe fallback
        iframe.onload = () => { document.getElementById('rc-preview-loading').style.display = 'none'; };
        iframe.src = previewUrl;
        iframe.style.display = 'block';
      }
    } else if (mime.startsWith('text/')) {
      // 純文字 → iframe
      iframe.onload = () => { document.getElementById('rc-preview-loading').style.display = 'none'; };
      iframe.src = previewUrl;
      iframe.style.display = 'block';
    } else if (mime.startsWith('image/')) {
      img.onload = () => { document.getElementById('rc-preview-loading').style.display = 'none'; };
      img.src = previewUrl;
      img.style.display = 'block';
    } else if (mime.startsWith('video/')) {
      video.src = previewUrl;
      video.style.display = 'block';
      document.getElementById('rc-preview-loading').style.display = 'none';
    } else {
      // 不支援預覽格式
      document.getElementById('rc-preview-loading').style.display    = 'none';
      document.getElementById('rc-preview-unsupported').style.display = 'flex';
    }
  };
}

function setMode(mode) {
  state.filters.mode = mode;
  document.getElementById('mode-or').classList.toggle('active',  mode === 'or');
  document.getElementById('mode-and').classList.toggle('active', mode === 'and');
  syncURL();
  render();
}

function clearAllFilters() {
  state.filters = {
    eventId: '', type: '', keyword: '', tagIds: [], mode: 'or', count: 5,
  };
  document.getElementById('filter-event-count').value = '5';
  computeVisibleEventIds();
  renderEventSelect();
  document.getElementById('filter-event').value = '';
  document.getElementById('filter-keyword').value = '';
  document.querySelectorAll('#filter-type .rc-chip').forEach(b => {
    b.classList.toggle('active', !b.dataset.type);
  });
  document.querySelectorAll('#filter-tags input[type=checkbox]').forEach(cb => cb.checked = false);
  setMode('or');
  syncURL();
  loadResources();
}

// ===== Loaders =====
async function loadEvents() {
  try {
    const res = await authFetch('/api/events');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '載入活動失敗');
    state.allEvents = data.events || [];
    computeVisibleEventIds();
    renderEventSelect();
  } catch (err) {
    showToast('載入活動失敗：' + err.message);
  }
}

async function loadTags() {
  try {
    const res = await authFetch('/api/tags');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '載入標籤失敗');
    state.allTags        = data.tags || [];
    state.tagsByCategory = data.grouped || {};
    renderTagFilter();
  } catch (err) {
    const el = document.getElementById('filter-tags');
    if (el) el.innerHTML = '<div class="loading-placeholder" style="color:var(--danger);">標籤載入失敗</div>';
  }
}

async function loadResources() {
  const seq = ++state._fetchSeq;
  const listEl = document.getElementById('rc-list');
  listEl.innerHTML = renderSkeletons(3);

  try {
    const params = new URLSearchParams();
    if (state.filters.eventId) params.set('event_id', state.filters.eventId);
    if (state.filters.type)    params.set('type',     state.filters.type);
    const qs = params.toString();
    const res = await authFetch('/api/resources' + (qs ? '?' + qs : ''));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '載入資源失敗');
    if (seq !== state._fetchSeq) return; // 競態保護
    state.resources = data.resources || [];
    render();
  } catch (err) {
    if (seq !== state._fetchSeq) return;
    listEl.innerHTML = `<div class="rc-empty">
      <div class="rc-empty-icon">⚠️</div>
      <div class="rc-empty-title">載入失敗</div>
      <div class="rc-empty-hint">${escapeHtml(err.message)}</div>
    </div>`;
  }
}

// ===== Render: Event Select =====
function renderEventSelect() {
  const sel = document.getElementById('filter-event');
  const current = state.filters.eventId;
  const visibleMap = new Map(state.visibleEventIds.map((id, i) => [id, i]));
  // 依 event_date desc 排序要顯示的活動
  const visibleEvents = state.allEvents
    .filter(e => visibleMap.has(e.id))
    .sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));

  let html = '<option value="">全部顯示中活動</option>';
  for (const e of visibleEvents) {
    const date = formatDate(e.event_date);
    const prefix = e.series_name ? `[${escapeHtml(e.series_name)}] ` : '';
    html += `<option value="${escapeHtml(e.id)}">${date} · ${prefix}${escapeHtml(e.name)}</option>`;
  }
  sel.innerHTML = html;
  // 保留選擇
  if (current && visibleMap.has(current)) sel.value = current;
  else sel.value = '';
}

// ===== Render: Tag Filter =====
function renderTagFilter() {
  const el = document.getElementById('filter-tags');
  const groups = state.tagsByCategory || {};
  const availableCategories = CATEGORY_ORDER.filter(cat => Array.isArray(groups[cat]) && groups[cat].length);

  if (!availableCategories.length) {
    el.innerHTML = '<div class="loading-placeholder" style="padding:12px;">尚無標籤可篩選</div>';
    return;
  }

  let html = '';
  for (const cat of availableCategories) {
    const label = CATEGORY_LABELS[cat] || cat;
    html += `<div class="rc-tag-category">
      <div class="rc-tag-category-label">${escapeHtml(label)}</div>
      <div class="rc-tag-category-items">`;
    for (const tag of groups[cat]) {
      const checked = state.filters.tagIds.includes(tag.id) ? 'checked' : '';
      html += `<label class="rc-tag-chip">
        <input type="checkbox" value="${escapeHtml(tag.id)}" ${checked}>
        ${escapeHtml(tag.name)}
      </label>`;
    }
    html += '</div></div>';
  }
  el.innerHTML = html;

  // 綁定
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.value;
      if (cb.checked) {
        if (!state.filters.tagIds.includes(id)) state.filters.tagIds.push(id);
      } else {
        state.filters.tagIds = state.filters.tagIds.filter(x => x !== id);
      }
      syncURL();
      render();
    });
  });
}

// ===== Render: Skeletons =====
function renderSkeletons(n) {
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<div class="rc-skeleton">
      <div class="rc-skeleton-icon"></div>
      <div class="rc-skeleton-body">
        <div class="rc-skeleton-line w60"></div>
        <div class="rc-skeleton-line w40"></div>
        <div class="rc-skeleton-line w80"></div>
      </div>
    </div>`;
  }
  return html;
}

// ===== Render: Main List =====
function render() {
  const listEl = document.getElementById('rc-list');
  const countEl = document.getElementById('rc-result-count');
  const filtered = applyClientFilters(state.resources);

  // 結果計數
  countEl.innerHTML = `共 <strong>${filtered.length}</strong> 筆資源`;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="rc-empty">
      <div class="rc-empty-icon">📭</div>
      <div class="rc-empty-title">找不到符合條件的資源</div>
      <div class="rc-empty-hint">試著調整篩選條件或清除篩選</div>
    </div>`;
    return;
  }

  listEl.innerHTML = filtered.map(renderResourceCard).join('');

  // 綁定卡片按鈕
  listEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'view')     window._openPreview(id);
      if (action === 'download') downloadResource(id);
    });
  });
}

function applyClientFilters(list) {
  const { keyword, tagIds, mode, eventId } = state.filters;

  return list.filter(r => {
    // 活動範圍（若未指定單一活動，則限制在 visibleEventIds 內）
    if (!eventId && state.visibleEventIds.length && !state.visibleEventIds.includes(r.event_id)) {
      return false;
    }

    // 關鍵字
    if (keyword) {
      const hay = `${r.title || ''} ${r.description || ''}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }

    // 標籤
    if (tagIds.length) {
      const resourceTagIds = new Set((r.tags || []).map(t => t.id));
      if (mode === 'and') {
        // 必須包含所有選中的標籤
        for (const id of tagIds) if (!resourceTagIds.has(id)) return false;
      } else {
        // OR：只要有任一個
        let hit = false;
        for (const id of tagIds) if (resourceTagIds.has(id)) { hit = true; break; }
        if (!hit) return false;
      }
    }

    return true;
  });
}

function renderResourceCard(r) {
  const type = r.resource_type || 'other';
  const icon = TYPE_ICONS[type] || '📎';
  const typeLabel = TYPE_LABELS[type] || '其他';

  const eventMeta = r.event_name
    ? `<span class="meta-event">📅 ${escapeHtml(r.event_name)}</span>` : '';
  const storageMeta = r.storage_type === 'link'
    ? '<span class="meta-dot">🔗 外部連結</span>'
    : `<span class="meta-dot">📦 ${escapeHtml(formatBytes(r.file_size) || 'R2')}</span>`;
  const typeMeta = `<span class="meta-dot">${escapeHtml(typeLabel)}</span>`;

  const tagsHtml = (r.tags || []).slice(0, 5).map(t =>
    `<span class="rc-card-tag">#${escapeHtml(t.name)}</span>`
  ).join('');
  const moreTags = (r.tags || []).length > 5 ? `<span class="rc-card-tag">+${r.tags.length - 5}</span>` : '';

  const desc = r.description ? `<div class="rc-card-desc">${escapeHtml(r.description)}</div>` : '';

  // 動作按鈕：連結只需「開啟」，R2 給「查看」+「下載」
  let actions;
  if (r.storage_type === 'link') {
    actions = `<button class="rc-card-btn primary" data-action="view" data-id="${escapeHtml(r.id)}">
      🔗 開啟連結
    </button>`;
  } else {
    const canPreview = canInlinePreview(r.mime_type);
    actions = `
      ${canPreview ? `<button class="rc-card-btn" data-action="view" data-id="${escapeHtml(r.id)}">👁 查看</button>` : ''}
      <button class="rc-card-btn primary" data-action="download" data-id="${escapeHtml(r.id)}">⬇ 下載</button>
    `;
  }

  return `<article class="rc-resource-card type-${type}">
    <div class="rc-card-icon type-${type}">${icon}</div>
    <div class="rc-card-body">
      <div class="rc-card-title">${escapeHtml(r.title)}</div>
      <div class="rc-card-meta">
        ${eventMeta}${typeMeta}${storageMeta}
      </div>
      ${desc}
      ${tagsHtml ? `<div class="rc-card-tags">${tagsHtml}${moreTags}</div>` : ''}
      <div class="rc-card-actions">${actions}</div>
    </div>
  </article>`;
}

function canInlinePreview(mime) {
  if (!mime) return false;
  return mime.startsWith('image/')
      || mime.startsWith('video/')
      || mime.startsWith('audio/')
      || mime === 'application/pdf'
      || mime.startsWith('text/');
}

// ===== Resource Actions =====
async function viewResource(id) {
  const r = state.resources.find(x => x.id === id);
  if (!r) return;
  if (r.storage_type === 'link') {
    window.open(r.url, '_blank', 'noopener');
    return;
  }
  // R2：fetch with auth → blob → 新分頁開啟
  const btn = document.querySelector(`[data-action="view"][data-id="${CSS.escape(id)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '載入中...'; }
  try {
    const res = await authFetch(`/api/resources/${encodeURIComponent(id)}?action=download`);
    if (!res.ok) throw new Error('無法載入檔案');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const newWin = window.open(blobUrl, '_blank', 'noopener');
    if (!newWin) {
      // 瀏覽器封鎖彈窗 → 改為下載
      triggerBlobDownload(blobUrl, r.file_name || r.title);
      showToast('已切換為下載模式（彈窗被瀏覽器封鎖）');
    }
    // 5 分鐘後釋放
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
  } catch (err) {
    showToast('開啟失敗：' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '👁 查看'; }
  }
}

async function downloadResource(id) {
  const r = state.resources.find(x => x.id === id);
  if (!r) return;
  if (r.storage_type === 'link') {
    window.open(r.url, '_blank', 'noopener');
    return;
  }
  const btn = document.querySelector(`[data-action="download"][data-id="${CSS.escape(id)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '下載中...'; }
  try {
    const res = await authFetch(`/api/resources/${encodeURIComponent(id)}?action=download`);
    if (!res.ok) throw new Error('下載失敗');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    triggerBlobDownload(blobUrl, r.file_name || r.title || 'download');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60 * 1000);
    showToast('已開始下載');
  } catch (err) {
    showToast('下載失敗：' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '⬇ 下載'; }
  }
}

function triggerBlobDownload(blobUrl, filename) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== URL Sync =====
function syncURL() {
  const params = new URLSearchParams();
  const f = state.filters;
  if (f.eventId)     params.set('event', f.eventId);
  if (f.type)        params.set('type',  f.type);
  if (f.keyword)     params.set('q',     f.keyword);
  if (f.tagIds.length) params.set('tags', f.tagIds.join(','));
  if (f.mode !== 'or') params.set('mode', f.mode);
  if (f.count !== 5)   params.set('count', String(f.count));
  const qs = params.toString();
  const newUrl = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState({}, document.title, newUrl);
}

function applyFiltersFromURL() {
  const p = new URLSearchParams(window.location.search);

  const count = p.get('count');
  if (count) {
    state.filters.count = count === 'all' ? 'all' : (Number(count) || 5);
    const sel = document.getElementById('filter-event-count');
    if (sel) sel.value = state.filters.count === 'all' ? 'all' : String(state.filters.count);
    computeVisibleEventIds();
    renderEventSelect();
  }

  const eventId = p.get('event');
  if (eventId && state.visibleEventIds.includes(eventId)) {
    state.filters.eventId = eventId;
    document.getElementById('filter-event').value = eventId;
  }

  const type = p.get('type');
  if (type) {
    state.filters.type = type;
    document.querySelectorAll('#filter-type .rc-chip').forEach(b => {
      b.classList.toggle('active', (b.dataset.type || '') === type);
    });
  }

  const q = p.get('q');
  if (q) {
    state.filters.keyword = q.toLowerCase();
    document.getElementById('filter-keyword').value = q;
  }

  const tags = p.get('tags');
  if (tags) {
    state.filters.tagIds = tags.split(',').filter(Boolean);
    // 勾選對應 checkbox
    document.querySelectorAll('#filter-tags input[type=checkbox]').forEach(cb => {
      cb.checked = state.filters.tagIds.includes(cb.value);
    });
  }

  const mode = p.get('mode');
  if (mode === 'and') setMode('and');
}

// ===== Local Dev Login =====
function isLocalDev() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

async function tryDevLogin() {
  const saved = localStorage.getItem('dev_user_code') || '';
  const input = prompt(
    '🛠 本地開發登入\n\n請輸入欲模擬的 user_code（AD 帳號）',
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
  ].join(';');
  badge.addEventListener('click', () => {
    if (!confirm('🛠 清除登入資訊並重新整理？')) return;
    ['user_code','ad_name','custom_nickname','display_name','role','managed_event_ids','dev_user_code']
      .forEach(k => localStorage.removeItem(k));
    location.reload();
  });
  document.body.appendChild(badge);
}
