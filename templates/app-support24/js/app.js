// Kanban/Table client — fetches /api/tasks, renders two views, handles filters + modal.

const STATE = {
  tasks: [],
  statuses: [],
  chat: [],
  lastSyncedAt: null,
  filters: { search: '', statuses: new Set() },
  chatFilters: { onlyNegative: false, onlyLinked: false, category: null },
  prefs: {
    hideCompleted: loadPref('hideCompleted', false),
    onlyPriority: loadPref('onlyPriority', false),
    showInternal: loadPref('showInternal', false),
    view: loadPref('view', 'dashboard'),
    sort: loadPref('sort', { key: 'id', dir: 'asc' }),
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function loadPref(key, def) {
  try {
    const v = localStorage.getItem('bg.' + key);
    return v === null ? def : JSON.parse(v);
  } catch { return def; }
}
function savePref(key, val) {
  try { localStorage.setItem('bg.' + key, JSON.stringify(val)); } catch {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function highlightText(text, matches) {
  if (!Array.isArray(matches) || matches.length === 0) return escapeHtml(text);
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor) continue;
    out += escapeHtml(text.slice(cursor, m.start));
    out += `<mark class="neg-mark">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    cursor = m.end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

function normalizeSearch(q) {
  const trimmed = String(q || '').trim();
  if (!trimmed) return { type: 'empty' };
  const m = trimmed.match(/^[#№]?(\d+)$/);
  if (m) return { type: 'id', value: m[1] };
  return { type: 'text', value: trimmed.toLowerCase() };
}

function plural(n, forms) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}
const dayWord = (n) => plural(n, ['день', 'дня', 'дней']);

function formatTimeAgo(iso) {
  if (!iso) return 'никогда';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 15_000) return 'только что';
  if (diff < 60_000) return `${Math.round(diff / 1000)} сек назад`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} мин назад`;
  const h = Math.round(diff / 3_600_000);
  return `${h} ч назад`;
}

function statusLabel(key) {
  const s = STATE.statuses.find((x) => x.key === key);
  return s?.label || key;
}

function cardName(t) {
  return `#${t.id} ${t.shortTitle || ''}`.trim();
}

async function loadTasks() {
  const res = await fetch('/api/tasks');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const data = await res.json();
  STATE.tasks = data.tasks || [];
  STATE.statuses = data.statuses || [];
  STATE.lastSyncedAt = data.lastSyncedAt;
  loadChat().catch(() => {});
  render();
}

async function loadChat() {
  try {
    const res = await fetch('/api/chat');
    if (!res.ok) return;
    const data = await res.json();
    STATE.chat = data.messages || [];
    // Re-render after chat arrives: kanban card badges (💬 count) and
    // dashboard KPIs/charts all depend on STATE.chat.
    renderWorkspace();
  } catch {}
}

async function refresh() {
  const btn = $('#refresh-btn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    const data = await res.json();
    STATE.tasks = data.tasks || STATE.tasks;
    STATE.lastSyncedAt = data.lastSyncedAt;
    render();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

// ---------- filtering ----------

function baseList() {
  let list = STATE.tasks;
  if (STATE.prefs.hideCompleted) list = list.filter((t) => t.status !== 'closed');
  if (STATE.prefs.onlyPriority) list = list.filter((t) => t.isPriority);
  return list;
}

function visibleStatuses() {
  return STATE.prefs.hideCompleted
    ? STATE.statuses.filter((s) => s.key !== 'closed')
    : STATE.statuses;
}

function filterTasks() {
  const ns = normalizeSearch(STATE.filters.search);
  const active = STATE.filters.statuses;
  return baseList().filter((t) => {
    if (active.size > 0 && !active.has(t.status)) return false;
    if (ns.type === 'id') return String(t.id) === ns.value;
    if (ns.type === 'text') {
      return (
        String(t.id).includes(ns.value) ||
        (t.shortTitle || '').toLowerCase().includes(ns.value) ||
        (t.description || '').toLowerCase().includes(ns.value) ||
        (t.resolution || '').toLowerCase().includes(ns.value) ||
        (t.comments || '').toLowerCase().includes(ns.value)
      );
    }
    return true; // ns.type === 'empty'
  });
}

// ---------- render root ----------

function render() {
  renderSync();
  renderFilters();
  renderWorkspace();
  renderStats();
  renderViewSwitch();
  renderHideToggle();
}

function renderSync() {
  $('#sync-status').textContent = `Обновлено: ${formatTimeAgo(STATE.lastSyncedAt)}`;
}

function renderViewSwitch() {
  for (const btn of $$('.view-switch-btn')) {
    btn.classList.toggle('is-active', btn.dataset.view === STATE.prefs.view);
  }
}

function renderHideToggle() {
  const cb = $('#hide-completed');
  if (cb) cb.checked = STATE.prefs.hideCompleted;
  const op = $('#only-priority');
  if (op) op.checked = STATE.prefs.onlyPriority;
  const si = $('#show-internal');
  if (si) si.checked = STATE.prefs.showInternal;
}

function renderFilters() {
  const box = $('#status-filters');
  const counts = new Map();
  for (const t of baseList()) counts.set(t.status, (counts.get(t.status) || 0) + 1);

  const all = document.createElement('div');
  all.className = 'status-filter' + (STATE.filters.statuses.size === 0 ? ' is-active' : '');
  all.innerHTML = `<span>Все</span><span class="count">${baseList().length}</span>`;
  all.addEventListener('click', () => { STATE.filters.statuses.clear(); render(); });

  box.replaceChildren(all);
  for (const s of visibleStatuses()) {
    const el = document.createElement('div');
    const isActive = STATE.filters.statuses.has(s.key);
    el.className = 'status-filter' + (isActive ? ' is-active' : '');
    el.innerHTML = `
      <span><span class="dot" style="background:var(--status-${s.key})"></span>${escapeHtml(s.label)}</span>
      <span class="count">${counts.get(s.key) || 0}</span>`;
    el.addEventListener('click', () => {
      if (isActive) STATE.filters.statuses.delete(s.key);
      else STATE.filters.statuses.add(s.key);
      render();
    });
    box.appendChild(el);
  }
}

function renderStats() {
  const box = $('#stats');
  if (!box) return;
  const pool = baseList();
  const total = pool.length;
  const inWork = pool.filter((t) => t.status === 'analysis' || t.status === 'development' || t.status === 'testing').length;
  const errors = pool.filter((t) => t.hasErrors).length;
  const closed = pool.filter((t) => t.status === 'closed').length;
  box.innerHTML = `
    <h3>Сводка</h3>
    <div class="stat-row"><span>Всего</span><strong>${total}</strong></div>
    <div class="stat-row"><span>В работе</span><strong>${inWork}</strong></div>
    <div class="stat-row"><span>С ошибками</span><strong>${errors}</strong></div>
    <div class="stat-row"><span>Закрыто</span><strong>${closed}</strong></div>`;
}

// ---------- workspace ----------

function renderWorkspace() {
  const root = $('#workspace');
  root.className = 'workspace workspace--' + STATE.prefs.view;
  if (STATE.prefs.view === 'dashboard') return renderDashboard(root);
  if (STATE.prefs.view === 'lurv') return renderLurv(root);
  if (STATE.prefs.view === 'table') renderTable(root);
  else if (STATE.prefs.view === 'chat') renderChat(root);
  else renderBoard(root);
}

// ---------- dashboard ----------

function renderDashboard(root) {
  root.className = 'workspace workspace--dashboard';
  const kpis = computeKpis();
  root.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('blue', '📋', kpis.active, 'Активных задач', 'не закрытых', 'active')}
      ${kpiCard('yellow', '⚠️', kpis.errors, 'С ошибками', 'требуют внимания', 'errors')}
      ${kpiCard('red', '🔴', kpis.overdue, 'Просрочено', 'плановый срок прошёл', 'overdue')}
      ${kpiCard('purple', '💬', kpis.negWeek, 'Негатив за 7д', 'жалоб от клиента', 'negWeek')}
    </div>
    <div class="category-row" id="category-row"></div>
    <div class="sentiment-row" id="sentiment-row"></div>
    <div class="charts-row">
      <div class="chart-card"><h3>Распределение по статусам</h3><canvas id="chart-status"></canvas></div>
      <div class="chart-card"><h3>Возраст открытых задач</h3><canvas id="chart-age"></canvas></div>
    </div>
    <div class="chart-card full"><h3>Активность чата за 14 дней</h3><canvas id="chart-activity"></canvas></div>
    <div class="noisy-card">
      <h3>Топ-5 шумных задач</h3>
      <div id="noisy-content"></div>
    </div>
  `;
  renderDashboardCharts();
  renderNoisyTasks();
  renderTopCategories();
  renderSentimentRow();

  const grid = root.querySelector('.kpi-grid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-kpi]');
      if (btn) openDrillForKpi(btn.dataset.kpi);
    });
  }
}

function kpiCard(color, icon, value, label, hint, kpiKey) {
  return `
    <button type="button" class="kpi-card kpi-card--clickable" data-kpi="${escapeHtml(kpiKey || '')}">
      <div class="kpi-icon ${color}">${icon}</div>
      <div>
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-value">${value}</div>
        <div class="kpi-hint">${escapeHtml(hint)}</div>
      </div>
    </button>
  `;
}

function msgIsNegative(m) {
  return !!(m && m.llm && m.llm.sentiment === 'negative');
}

const SENTIMENT_META = {
  negative: { label: 'Негатив',  cls: 'is-negative' },
  positive: { label: 'Позитив',  cls: 'is-positive' },
  neutral:  { label: 'Нейтрал.', cls: 'is-neutral'  },
};

function llmBadges(m) {
  if (!m || !m.llm) return '';
  const parts = [];
  const s = SENTIMENT_META[m.llm.sentiment];
  if (s) parts.push(`<span class="llm-badge llm-badge--sent ${s.cls}">${s.label}</span>`);
  const c = CATEGORY_META[m.llm.category];
  if (c) parts.push(`<span class="llm-badge llm-badge--cat" title="${escapeHtml(m.llm.reason || '')}">${c.emoji} ${escapeHtml(c.label)}</span>`);
  return parts.join('');
}

function isOverdue(t) {
  if (!t || t.status === 'closed') return false;
  if (!t.plannedDeadline) return false;
  const iso = ruDateToSortable(t.plannedDeadline);
  if (!iso) return false;
  const d = +new Date(iso);
  if (isNaN(d)) return false;
  return d < Date.now();
}

function computeKpis() {
  const tasks = STATE.tasks || [];
  const chat = STATE.chat || [];
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;
  const active = tasks.filter((t) => t.status !== 'closed').length;
  const errors = tasks.filter((t) => t.hasErrors).length;
  const overdue = tasks.filter(isOverdue).length;
  const negWeek = chat.filter((m) => msgIsNegative(m) && (m.at || 0) > now - week).length;
  return { active, errors, overdue, negWeek };
}

let _chartInstances = {};
function destroyCharts() {
  for (const k of Object.keys(_chartInstances)) {
    try { _chartInstances[k].destroy(); } catch {}
  }
  _chartInstances = {};
}

function renderDashboardCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded');
    return;
  }
  destroyCharts();
  const tasks = STATE.tasks || [];
  const chat = STATE.chat || [];

  // 1. Donut by status
  const STATUS_ORDER = ['new','analysis','development','testing','paused','closed'];
  const STATUS_COLOR = {
    new: '#6366f1', analysis: '#8b5cf6', development: '#2f6bff',
    testing: '#f59e0b', paused: '#6b7280', closed: '#10b981',
  };
  const counts = STATUS_ORDER.map((s) => tasks.filter((t) => t.status === s).length);
  const labels = STATUS_ORDER.map((s) => statusLabel(s));
  const ctx1 = document.getElementById('chart-status');
  if (ctx1) {
    _chartInstances.status = new Chart(ctx1, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: counts, backgroundColor: STATUS_ORDER.map((s) => STATUS_COLOR[s]), borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } } },
      },
    });
  }

  // 2. Age histogram for open tasks
  const buckets = [
    { label: '0–3 дн', max: 3, count: 0 },
    { label: '4–7 дн', max: 7, count: 0 },
    { label: '8–14 дн', max: 14, count: 0 },
    { label: '15–30 дн', max: 30, count: 0 },
    { label: '30+ дн', max: Infinity, count: 0 },
  ];
  for (const t of tasks) {
    if (t.status === 'closed') continue;
    const d = Number(t.daysElapsed || 0);
    for (const b of buckets) { if (d <= b.max) { b.count++; break; } }
  }
  const ctx2 = document.getElementById('chart-age');
  if (ctx2) {
    _chartInstances.age = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [{
          data: buckets.map((b) => b.count),
          backgroundColor: ['#3b82f6','#2f6bff','#8b5cf6','#f59e0b','#ef4444'],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  // 3. Activity stacked bar — last 14 days
  const days = 14;
  const today = new Date(); today.setHours(0,0,0,0);
  const dayLabels = [];
  const normalCounts = [];
  const negCounts = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(today); start.setDate(today.getDate() - i);
    const end = new Date(start); end.setDate(start.getDate() + 1);
    const inDay = chat.filter((m) => {
      const t = m.at || 0;
      return t >= +start && t < +end;
    });
    dayLabels.push(start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }));
    negCounts.push(inDay.filter((m) => msgIsNegative(m)).length);
    normalCounts.push(inDay.filter((m) => !msgIsNegative(m)).length);
  }
  const ctx3 = document.getElementById('chart-activity');
  if (ctx3) {
    _chartInstances.activity = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [
          { label: 'Обычные', data: normalCounts, backgroundColor: '#94a3b8', stack: 'a', borderRadius: 4 },
          { label: 'Негативные', data: negCounts, backgroundColor: '#ef4444', stack: 'a', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }
}
function renderNoisyTasks() {
  const host = document.getElementById('noisy-content');
  if (!host) return;
  const tasks = STATE.tasks || [];
  const chat = STATE.chat || [];

  const noisy = tasks.map((t) => {
    const linked = chat.filter((m) => Array.isArray(m.linkedTasks) && m.linkedTasks.includes(String(t.id)));
    return { task: t, msgCount: linked.length, negCount: linked.filter((m) => msgIsNegative(m)).length };
  })
  .filter((x) => x.msgCount > 0)
  .sort((a, b) => b.msgCount - a.msgCount)
  .slice(0, 5);

  if (noisy.length === 0) {
    host.innerHTML = '<div class="noisy-empty">Привязанных сообщений ещё нет.</div>';
    return;
  }

  const tableHtml = `
    <table class="noisy-table">
      <thead>
        <tr><th>#</th><th>Задача</th><th>Сообщений</th><th>Негатив</th><th>Статус</th></tr>
      </thead>
      <tbody>
        ${noisy.map(({task: t, msgCount, negCount}) => `
          <tr data-id="${t.id}">
            <td><b>#${t.id}</b></td>
            <td>${escapeHtml((cardName(t) || '').replace(/^#\d+\s*/, ''))}</td>
            <td>${msgCount}</td>
            <td>${negCount > 0 ? `<span class="chat-neg-badge">${negCount}</span>` : '—'}</td>
            <td><span class="status-pill status-${t.status}">${escapeHtml(statusLabel(t.status))}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="noisy-cards">
      ${noisy.map(({task: t, msgCount, negCount}) => `
        <div class="table-card" data-id="${t.id}">
          <div class="table-card-head">
            <span class="table-card-id">#${t.id}</span>
            <span class="status-pill status-${t.status}">${escapeHtml(statusLabel(t.status))}</span>
          </div>
          <div class="table-card-title">${escapeHtml((cardName(t) || '').replace(/^#\d+\s*/, ''))}</div>
          <div class="table-card-row"><span class="k">Сообщений</span><span class="v">${msgCount}</span></div>
          <div class="table-card-row"><span class="k">Негатив</span><span class="v">${negCount}</span></div>
        </div>
      `).join('')}
    </div>
  `;
  host.innerHTML = tableHtml;

  host.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const task = STATE.tasks.find((t) => String(t.id) === id);
      if (task) openModal(task);
    });
  });
}

// ---------- kanban ----------

function shortDateRu(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}`;
}

function renderCard(t) {
  const el = document.createElement('article');
  el.className = `card status-${t.status}` + (t.hasErrors ? ' has-errors' : '') + (t.isPriority ? ' card--priority' : '');

  const lines = [];
  const planned = shortDateRu(t.plannedDeadline);
  if (planned) {
    const overdue = t.daysLeft != null && t.daysLeft < 0 && !t.isClosed;
    const overdueCls = overdue ? ' is-overdue' : '';
    lines.push(`<div class="card-meta-line${overdueCls}">⏱ План: ${escapeHtml(planned)}</div>`);
  }
  if (t.timeSpent) {
    lines.push(`<div class="card-meta-line">🕐 Час: ${escapeHtml(t.timeSpent)}</div>`);
  }
  const msgCount = historyFor(t.id).length;
  if (msgCount > 0) {
    lines.push(`<div class="card-meta-line">💬 Сообщ: ${msgCount}</div>`);
  }
  if (t.internalAssignee) {
    lines.push(`<div class="card-meta-line">👤 ${escapeHtml(t.internalAssignee)}</div>`);
  }

  el.innerHTML = `
    <div class="card-meta">
      <span class="card-id">#${escapeHtml(t.id)}</span>
      ${t.isPriority ? '<span class="priority-pill">ПРИОРИТЕТ</span>' : ''}
    </div>
    <div class="card-title">${escapeHtml(t.shortTitle || '')}</div>
    ${lines.length ? `<div class="card-bottom">${lines.join('')}</div>` : ''}
    ${t.hasErrors ? '<div class="card-footer"><span class="chip is-error">! есть ошибки</span></div>' : ''}`;
  el.addEventListener('click', () => openModal(t));
  return el;
}

function renderBoard(root) {
  root.innerHTML = '<div class="board" id="board"></div>';
  const board = $('#board', root);
  const list = filterTasks();
  const byStatus = new Map(visibleStatuses().map((s) => [s.key, []]));
  for (const t of list) {
    if (!byStatus.has(t.status)) continue;
    byStatus.get(t.status).push(t);
  }
  for (const s of visibleStatuses()) {
    const col = document.createElement('section');
    col.className = 'column';
    const items = byStatus.get(s.key) || [];
    col.innerHTML = `
      <header class="column-header">
        <span class="column-title"><span class="dot" style="background:var(--status-${s.key})"></span>${escapeHtml(s.label)}</span>
        <span class="column-count">${items.length}</span>
      </header>
      <div class="column-body"></div>`;
    const body = $('.column-body', col);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'column-empty';
      empty.textContent = 'Нет задач';
      body.appendChild(empty);
    } else {
      for (const t of items) body.appendChild(renderCard(t));
    }
    board.appendChild(col);
  }
}

// ---------- table ----------

const TABLE_COLS_BASE = [
  { key: 'id',              label: '#',            className: 'col-num',    numeric: true },
  { key: 'isPriority',      label: 'Приоритет',    className: 'col-prio',   bool: true },
  { key: 'description',     label: 'Описание',     className: 'col-desc' },
  { key: 'resolution',      label: 'Решение',      className: 'col-solution' },
  { key: 'comments',        label: 'Комментарий',  className: 'col-comment' },
  { key: 'receivedAt',      label: 'Начало',       className: 'col-date',   dateRu: true },
  { key: 'desiredDeadline', label: 'Желаемый',     className: 'col-date',   dateRu: true },
  { key: 'plannedDeadline', label: 'План',         className: 'col-date',   dateRu: true },
  { key: 'resolvedAt',      label: 'Конец',        className: 'col-date',   dateRu: true },
  { key: 'daysTotal',       label: 'Дней',         className: 'col-days',   numeric: true },
  { key: 'timeSpent',       label: 'Затраты',      className: 'col-hours' },
  { key: 'status',          label: 'Статус',       className: 'col-status' },
];

const TABLE_COLS_INTERNAL = [
  { key: 'internalAssignee', label: 'Ответственный', className: 'col-assignee' },
  { key: 'internalComment',  label: 'Внутр. коммент', className: 'col-internal-comment' },
  { key: 'internalTaskUrl',  label: 'Ссылка',         className: 'col-link',  skipSort: true },
  { key: 'inKnowledgeBase',  label: 'БЗ',             className: 'col-flag',  bool: true },
  { key: 'inMiro',           label: 'Miro',           className: 'col-flag',  bool: true },
];

function currentTableCols() {
  return STATE.prefs.showInternal
    ? TABLE_COLS_BASE.concat(TABLE_COLS_INTERNAL)
    : TABLE_COLS_BASE;
}

function ruDateToSortable(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function sortedForTable(list) {
  const cols = currentTableCols();
  const { key, dir } = STATE.prefs.sort;
  const col = cols.find((c) => c.key === key) || cols[0];
  const mul = dir === 'desc' ? -1 : 1;
  const arr = list.slice();
  arr.sort((a, b) => {
    const av = a[col.key];
    const bv = b[col.key];
    if (col.bool) return ((bv ? 1 : 0) - (av ? 1 : 0)) * mul;
    // empty values always sink to the bottom regardless of direction
    const aEmpty = av === '' || av == null;
    const bEmpty = bv === '' || bv == null;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;
    if (aEmpty && bEmpty) return 0;
    if (col.numeric) return (Number(av) - Number(bv)) * mul;
    if (col.dateRu) return ruDateToSortable(av).localeCompare(ruDateToSortable(bv)) * mul;
    return String(av).localeCompare(String(bv), 'ru') * mul;
  });
  return arr;
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n).trim() + '…' : str;
}

// ---------- lurv (write-off time sheets) ----------

const LURV = { data: null, loading: false, chart: null };

async function loadLurv() {
  if (LURV.data || LURV.loading) return LURV.data;
  LURV.loading = true;
  try {
    const res = await fetch('/api/lurv');
    if (!res.ok) return null;
    LURV.data = await res.json();
    return LURV.data;
  } catch {
    return null;
  } finally {
    LURV.loading = false;
  }
}

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} м`;
  if (h) return `${h} ч`;
  return `${m} м`;
}

function fmtIsoRu(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function renderLurv(root) {
  root.className = 'workspace workspace--lurv';
  if (!LURV.data) {
    root.innerHTML = `<div class="lurv-empty">Загружаю лист учёта рабочего времени…</div>`;
    loadLurv().then((d) => { if (d && STATE.prefs.view === 'lurv') renderLurv(root); });
    return;
  }
  const d = LURV.data;
  const entries = [...(d.entries || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const totalH = fmtHours(d.totalMinutes || 0);
  const linkedCount = entries.filter((e) => e.taskIds && e.taskIds.length).length;
  const firstDate = entries.length ? entries[entries.length - 1].date : null;
  const lastDate = entries.length ? entries[0].date : null;

  const weekly = d.weekly || [];
  const periodsCount = (d.periods || []).length;

  root.innerHTML = `
    <div class="lurv-head">
      <div class="kpi-grid lurv-kpis">
        <div class="kpi-card"><div class="kpi-icon">⏱️</div><div class="kpi-val">${escapeHtml(totalH)}</div><div class="kpi-label">Всего списано</div><div class="kpi-hint">${entries.length} записей</div></div>
        <div class="kpi-card"><div class="kpi-icon">📅</div><div class="kpi-val">${weekly.length}</div><div class="kpi-label">Недель</div><div class="kpi-hint">${fmtIsoRu(firstDate)} — ${fmtIsoRu(lastDate)}</div></div>
        <div class="kpi-card"><div class="kpi-icon">📄</div><div class="kpi-val">${periodsCount}</div><div class="kpi-label">Листов учёта</div><div class="kpi-hint">PDF</div></div>
        <div class="kpi-card"><div class="kpi-icon">🔗</div><div class="kpi-val">${linkedCount}</div><div class="kpi-label">Привязано к задачам</div><div class="kpi-hint">из ${entries.length}</div></div>
      </div>
    </div>
    <div class="chart-card full"><h3>Списания по неделям</h3><canvas id="chart-lurv-weekly"></canvas></div>
    <div class="lurv-table-card">
      <h3>Все записи</h3>
      <div class="table-scroll">
        <table class="data-table lurv-table">
          <thead><tr><th>Дата</th><th>Описание</th><th class="col-num">Время</th><th>Задачи</th></tr></thead>
          <tbody>
            ${entries.map((e) => `
              <tr>
                <td class="col-nowrap">${escapeHtml(fmtIsoRu(e.date))}</td>
                <td>${escapeHtml(e.text || '')}</td>
                <td class="col-num col-nowrap">${escapeHtml(fmtHours(e.minutes || 0))}</td>
                <td>${(e.taskIds || []).map((id) => `<button type="button" class="task-chip" data-task-id="${escapeHtml(id)}">#${escapeHtml(id)}</button>`).join(' ')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderLurvChart(weekly);

  root.querySelectorAll('.task-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.taskId;
      const t = STATE.tasks.find((x) => String(x.id) === String(id));
      if (t) openModal(t);
    });
  });
}

function renderLurvChart(weekly) {
  const canvas = document.getElementById('chart-lurv-weekly');
  if (!canvas || !window.Chart) return;
  if (LURV.chart) { LURV.chart.destroy(); LURV.chart = null; }
  const labels = weekly.map((w) => fmtIsoRu(w.weekStart));
  const data = weekly.map((w) => +(w.minutes / 60).toFixed(2));
  LURV.chart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Часов',
        data,
        backgroundColor: '#6366f1',
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} ч`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => `${v} ч` },
        },
      },
    },
  });
}

function renderTable(root) {
  const cols = currentTableCols();
  const list = sortedForTable(filterTasks());
  const { key: sortKey, dir: sortDir } = STATE.prefs.sort;
  const arrow = (k) => k === sortKey ? `<span class="sort-arrow">${sortDir === 'desc' ? '▼' : '▲'}</span>` : '';

  const headHtml = cols.map((c) => {
    if (c.skipSort) return `<th class="${c.className}">${c.label}</th>`;
    return `<th class="${c.className} is-sortable" data-sort="${c.key}">${c.label}${arrow(c.key)}</th>`;
  }).join('');

  const cellFor = (t, col) => {
    switch (col.key) {
      case 'id': return `<td class="col-num">${escapeHtml(t.id)}</td>`;
      case 'isPriority': return `<td class="col-prio">${t.isPriority ? '🔴' : ''}</td>`;
      case 'description': {
        const errorMark = t.hasErrors ? '<span class="row-error" title="Есть ошибки">!</span>' : '';
        return `<td class="col-desc">${errorMark}<span class="cell-title">${escapeHtml(cardName(t))}</span><div class="cell-sub">${escapeHtml(truncate(t.description, 70))}</div></td>`;
      }
      case 'resolution': return `<td class="col-solution"><div class="cell-clamp2">${escapeHtml(truncate(t.resolution, 70)) || '—'}</div></td>`;
      case 'comments': return `<td class="col-comment"><div class="cell-clamp2">${escapeHtml(truncate(t.comments, 70)) || '—'}</div></td>`;
      case 'receivedAt': return `<td class="col-date">${escapeHtml(t.receivedAt || '—')}</td>`;
      case 'desiredDeadline': return `<td class="col-date">${escapeHtml(t.desiredDeadline || '—')}</td>`;
      case 'plannedDeadline': return `<td class="col-date">${escapeHtml(t.plannedDeadline || '—')}</td>`;
      case 'resolvedAt': return `<td class="col-date">${escapeHtml(t.resolvedAt || '—')}</td>`;
      case 'daysTotal': return `<td class="col-days">${t.daysTotal != null ? t.daysTotal : '—'}</td>`;
      case 'timeSpent': return `<td class="col-hours">${escapeHtml(t.timeSpent || '—')}</td>`;
      case 'status': {
        const pill = `<span class="status-pill" style="background:var(--status-${t.status}-bg);color:var(--status-${t.status})"><span class="dot" style="background:var(--status-${t.status})"></span>${escapeHtml(statusLabel(t.status))}</span>`;
        return `<td class="col-status">${pill}</td>`;
      }
      case 'internalAssignee': return `<td class="col-assignee"><span class="cell-clamp1">${escapeHtml(t.internalAssignee) || '—'}</span></td>`;
      case 'internalComment': return `<td class="col-internal-comment"><div class="cell-clamp2">${escapeHtml(truncate(t.internalComment, 70)) || '—'}</div></td>`;
      case 'internalTaskUrl': return `<td class="col-link">${t.internalTaskUrl ? `<a href="${escapeHtml(t.internalTaskUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>` : '—'}</td>`;
      case 'inKnowledgeBase': return `<td class="col-flag">${t.inKnowledgeBase ? '✅' : ''}</td>`;
      case 'inMiro': return `<td class="col-flag">${t.inMiro ? '✅' : ''}</td>`;
      default: return '<td>—</td>';
    }
  };

  const rows = list.map((t) =>
    `<tr data-id="${escapeHtml(t.id)}">${cols.map((c) => cellFor(t, c)).join('')}</tr>`
  ).join('');

  // Mobile cards
  const cardSortOptions = cols.filter((c) => !c.skipSort).map((c) =>
    `<option value="${c.key}" ${c.key === sortKey ? 'selected' : ''}>${c.label} ${c.key === sortKey ? (sortDir === 'desc' ? '▼' : '▲') : ''}</option>`
  ).join('');

  const mobileCards = list.map((t) => `
    <div class="table-card" data-id="${escapeHtml(t.id)}">
      <div class="table-card-head">
        <span class="table-card-id">#${escapeHtml(t.id)}</span>
        <span class="status-pill" style="background:var(--status-${t.status}-bg);color:var(--status-${t.status})">
          <span class="dot" style="background:var(--status-${t.status})"></span>
          ${escapeHtml(statusLabel(t.status))}
        </span>
      </div>
      <div class="table-card-row"><span class="k">Задача</span><span class="v">${escapeHtml(cardName(t))}</span></div>
      ${t.receivedAt ? `<div class="table-card-row"><span class="k">Начало</span><span class="v">${escapeHtml(t.receivedAt)}</span></div>` : ''}
      ${t.resolvedAt ? `<div class="table-card-row"><span class="k">Конец</span><span class="v">${escapeHtml(t.resolvedAt)}</span></div>` : ''}
      ${t.daysTotal != null ? `<div class="table-card-row"><span class="k">Дней</span><span class="v">${t.daysTotal} ${dayWord(t.daysTotal)}</span></div>` : ''}
    </div>`
  ).join('') || '<div class="table-empty">Нет задач</div>';

  root.innerHTML = `
    <div class="table-sort">
      <span>Сортировка:</span>
      <select id="table-sort-select">${cardSortOptions}</select>
    </div>
    <div class="table-cards">${mobileCards}</div>
    <div class="table-wrap">
      <table class="task-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${cols.length}" class="table-empty">Нет задач</td></tr>`}</tbody>
      </table>
    </div>`;

  root.querySelectorAll('thead th.is-sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (STATE.prefs.sort.key === key) {
        STATE.prefs.sort.dir = STATE.prefs.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        STATE.prefs.sort = { key, dir: 'asc' };
      }
      savePref('sort', STATE.prefs.sort);
      renderWorkspace();
    });
  });
  root.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const t = STATE.tasks.find((x) => x.id === tr.dataset.id);
      if (t) openModal(t);
    });
  });
  root.querySelectorAll('.table-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const t = STATE.tasks.find((x) => x.id === card.dataset.id);
      if (t) openModal(t);
    });
  });
  const sel = root.querySelector('#table-sort-select');
  if (sel) {
    sel.addEventListener('change', () => {
      STATE.prefs.sort = { key: sel.value, dir: 'asc' };
      savePref('sort', STATE.prefs.sort);
      renderWorkspace();
    });
  }
}

// ---------- chat view ----------

function formatChatTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatChatDayHeader(ms) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'Сегодня';
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function filterChat() {
  const q = STATE.filters.search.trim().toLowerCase();
  const { onlyNegative, onlyLinked, category } = STATE.chatFilters;
  const priorityIds = STATE.prefs.onlyPriority
    ? new Set(STATE.tasks.filter((t) => t.isPriority).map((t) => t.id))
    : null;
  return STATE.chat.filter((m) => {
    if (onlyNegative && !msgIsNegative(m)) return false;
    if (category && m.llm?.category !== category) return false;
    if (onlyLinked && (!m.linkedTasks || m.linkedTasks.length === 0)) return false;
    if (priorityIds) {
      const linked = m.linkedTasks || [];
      if (!linked.some((id) => priorityIds.has(id))) return false;
    }
    if (!q) return true;
    const hay = `${m.author} ${m.text} ${(m.linkedTasks || []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderChat(root) {
  const list = filterChat().sort((a, b) => (a.at || 0) - (b.at || 0));
  const { onlyNegative, onlyLinked, category } = STATE.chatFilters;

  const catOrder = ['bug', 'complaint', 'question', 'info', 'other'];
  const catCounts = new Map();
  for (const m of STATE.chat) {
    const c = m.llm?.category;
    if (c) catCounts.set(c, (catCounts.get(c) || 0) + 1);
  }
  const catChips = [
    `<button type="button" class="cat-chip${category === null ? ' is-active' : ''}" data-cat="">Все <span class="cat-chip-count">${STATE.chat.length}</span></button>`,
    ...catOrder.map((key) => {
      const meta = CATEGORY_META[key];
      const count = catCounts.get(key) || 0;
      const active = category === key ? ' is-active' : '';
      return `<button type="button" class="cat-chip${active}" data-cat="${key}">${meta.emoji} ${escapeHtml(meta.label)} <span class="cat-chip-count">${count}</span></button>`;
    }),
  ].join('');

  const toolbar = `
    <div class="chat-toolbar">
      <div class="chat-cat-row">${catChips}</div>
      <div class="chat-filter-row">
        <label class="chat-filter">
          <input type="checkbox" id="chat-only-negative" ${onlyNegative ? 'checked' : ''}>
          <span>Только негативные</span>
        </label>
        <label class="chat-filter">
          <input type="checkbox" id="chat-only-linked" ${onlyLinked ? 'checked' : ''}>
          <span>Только с привязкой</span>
        </label>
        <span class="chat-count">${list.length} ${plural(list.length, ['сообщение','сообщения','сообщений'])}</span>
      </div>
    </div>`;

  if (list.length === 0) {
    root.innerHTML = `${toolbar}<div class="chat-empty">Нет сообщений. Бот собирает сообщения из группы Telegram.</div>`;
    wireChatToolbar(root);
    return;
  }

  let html = `${toolbar}<div class="chat-stream">`;
  let lastDay = null;
  for (const m of list) {
    const dk = dayKey(m.at);
    if (dk !== lastDay) {
      html += `<div class="chat-day">${escapeHtml(formatChatDayHeader(m.at))}</div>`;
      lastDay = dk;
    }
    const chips = (m.linkedTasks || []).map((id) => {
      const t = STATE.tasks.find((x) => x.id === id);
      const label = t ? `#${id} ${escapeHtml(t.shortTitle || '')}` : `#${id}`;
      return `<button type="button" class="chat-task-chip" data-task="${escapeHtml(id)}">${label}</button>`;
    }).join('');
    const neg = msgIsNegative(m);
    html += `
      <div class="chat-msg ${neg ? 'is-negative' : ''}">
        <div class="chat-msg-head">
          <span class="chat-author">${escapeHtml(m.author)}</span>
          <span class="chat-time">${formatChatTime(m.at)}</span>
          ${llmBadges(m)}
        </div>
        <div class="chat-msg-text">${escapeHtml(m.text)}</div>
        ${chips ? `<div class="chat-msg-tasks">${chips}</div>` : ''}
      </div>`;
  }
  html += '</div>';
  root.innerHTML = html;
  wireChatToolbar(root);

  root.querySelectorAll('.chat-task-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = STATE.tasks.find((x) => x.id === btn.dataset.task);
      if (t) openModal(t);
    });
  });
}

function wireChatToolbar(root) {
  const neg = root.querySelector('#chat-only-negative');
  const lnk = root.querySelector('#chat-only-linked');
  if (neg) neg.addEventListener('change', (e) => { STATE.chatFilters.onlyNegative = e.target.checked; renderWorkspace(); });
  if (lnk) lnk.addEventListener('change', (e) => { STATE.chatFilters.onlyLinked = e.target.checked; renderWorkspace(); });
  root.querySelectorAll('.cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat || null;
      STATE.chatFilters.category = cat;
      renderWorkspace();
    });
  });
}

// ---------- modal ----------

function infoItem(label, value) {
  if (value == null || value === '' || value === '—') return '';
  return `<div class="info-item"><label>${escapeHtml(label)}</label><span>${value}</span></div>`;
}

function timingLine(t) {
  if (t.isClosed) return null;
  const parts = [];
  if (t.daysElapsed != null) parts.push(`прошло ${t.daysElapsed} ${dayWord(t.daysElapsed)}`);
  if (t.daysLeft != null) {
    if (t.daysLeft >= 0) parts.push(`осталось ${t.daysLeft} ${dayWord(t.daysLeft)}`);
    else {
      const n = -t.daysLeft;
      parts.push(`<span class="overdue">просрочено ${n} ${dayWord(n)}</span>`);
    }
  }
  return parts.length ? parts.join(' • ') : null;
}

function historyFor(taskId) {
  const id = String(taskId);
  return (STATE.chat || []).filter((m) => Array.isArray(m.linkedTasks) && m.linkedTasks.includes(id));
}

function renderModalHistory(t) {
  const hist = historyFor(t.id).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  if (hist.length === 0) {
    return `
      <div class="modal-history">
        <h3 class="modal-block-label">История коммуникации</h3>
        <div class="modal-info-empty">Нет сообщений из чата</div>
      </div>`;
  }
  const items = hist.map((m) => {
    const neg = msgIsNegative(m);
    return `
    <div class="hist-msg ${neg ? 'is-negative' : ''}">
      <div class="hist-head">
        <span class="hist-author">${escapeHtml(m.author)}</span>
        <span class="hist-time">${escapeHtml(new Date(m.at).toLocaleString('ru-RU'))}</span>
        ${llmBadges(m)}
      </div>
      <div class="hist-text">${escapeHtml(m.text)}</div>
    </div>`;
  }).join('');
  return `
    <div class="modal-history">
      <h3 class="modal-block-label">История коммуникации (${hist.length})</h3>
      <div class="hist-stream">${items}</div>
    </div>`;
}

function renderInternalNotes(t) {
  const hasAny =
    t.internalAssignee ||
    t.internalComment ||
    t.internalTaskUrl ||
    t.inKnowledgeBase ||
    t.inMiro;
  if (!hasAny) return '';

  const parts = [];
  if (t.internalAssignee) {
    parts.push(`<div class="internal-row"><span class="internal-key">👤 Ответственный:</span> ${escapeHtml(t.internalAssignee)}</div>`);
  }
  if (t.internalComment) {
    parts.push(`<div class="internal-comment">${escapeHtml(t.internalComment)}</div>`);
  }
  if (t.internalTaskUrl) {
    parts.push(`<div class="internal-row"><a href="${escapeHtml(t.internalTaskUrl)}" target="_blank" rel="noopener">🔗 Внутренняя задача ↗</a></div>`);
  }
  const chips = [];
  if (t.inKnowledgeBase) chips.push('<span class="internal-chip">📚 в Базе Знаний</span>');
  if (t.inMiro) chips.push('<span class="internal-chip">🎨 в Miro</span>');
  if (chips.length) parts.push(`<div class="internal-chips">${chips.join('')}</div>`);

  return `
    <section class="internal-notes">
      <h3 class="modal-block-label">Внутренние заметки</h3>
      <div class="internal-body">${parts.join('')}</div>
    </section>`;
}

function openModal(t) {
  const body = $('#modal-body');
  const status = t.status;
  const timing = timingLine(t);
  const info = [
    infoItem('Получена', escapeHtml(t.receivedAt)),
    infoItem('Решена', escapeHtml(t.resolvedAt)),
    infoItem('Желаемый срок', escapeHtml(t.desiredDeadline)),
    infoItem('Плановый срок', escapeHtml(t.plannedDeadline)),
    infoItem('Затраты', escapeHtml(t.timeSpent)),
    timing ? infoItem('Сроки', timing) : '',
  ].filter(Boolean).join('');

  body.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${escapeHtml(cardName(t))}</div>
      <div class="modal-status">
        <span class="status-pill" style="background:var(--status-${status}-bg);color:var(--status-${status})">
          <span class="dot" style="background:var(--status-${status})"></span>
          ${escapeHtml(statusLabel(status))}
        </span>
        ${t.hasErrors ? '<span class="status-pill error-pill">! есть ошибки</span>' : ''}
      </div>
    </div>

    <div class="modal-main">
      <section class="modal-desc">
        <h3 class="modal-block-label">Описание задачи</h3>
        <div class="modal-block-body">${escapeHtml(t.description || '—')}</div>
      </section>
      <div class="modal-side">
        <section>
          <h3 class="modal-block-label">Решение</h3>
          <div class="modal-block-body">${escapeHtml(t.resolution || '—')}</div>
        </section>
        <section>
          <h3 class="modal-block-label">Комментарий</h3>
          <div class="modal-block-body">${escapeHtml(t.comments || '—')}</div>
        </section>
      </div>
    </div>

    <div class="modal-details">
      <h3 class="modal-block-label">Детали</h3>
      <div class="modal-details-grid">
        ${info || '<div class="modal-info-empty">—</div>'}
      </div>
    </div>

    ${renderInternalNotes(t)}
    ${renderModalHistory(t)}
  `;
  $('#task-modal').hidden = false;
}

function closeModal() { $('#task-modal').hidden = true; }

// ---------- drill-through panel ----------

function openDrill({ title, subtitle, items, kind }) {
  const root = $('#drill');
  if (!root) return;
  closeModal();
  $('#drill-title').textContent = title;
  $('#drill-sub').textContent = subtitle || '';
  const list = $('#drill-list');
  if (!items || items.length === 0) {
    list.innerHTML = '<div class="drill-empty">Ничего не найдено.</div>';
  } else if (kind === 'message') {
    list.innerHTML = items.map(renderDrillMessageItem).join('');
  } else {
    list.innerHTML = items.map(renderDrillTaskItem).join('');
  }
  root.hidden = false;
  list.scrollTop = 0;

  list.querySelectorAll('[data-task-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-task-id');
      const task = STATE.tasks.find((t) => String(t.id) === id);
      if (task) {
        closeDrill();
        openModal(task);
      }
    });
  });
}

function closeDrill() {
  const root = $('#drill');
  if (root) root.hidden = true;
}

function renderDrillTaskItem(t) {
  const planned = shortDateRu(t.plannedDeadline);
  const parts = [];
  if (planned) parts.push(`⏱ ${escapeHtml(planned)}`);
  if (t.daysTotal != null) parts.push(`${t.daysTotal} ${dayWord(t.daysTotal)}`);
  const meta = parts.join(' · ');
  const titleText = t.shortTitle || (cardName(t) || '').replace(/^#\d+\s*/, '') || '';
  return `
    <button type="button" class="drill-item" data-task-id="${escapeHtml(t.id)}">
      <div class="drill-item-head">
        <span class="drill-item-id">#${escapeHtml(t.id)}</span>
        ${t.isPriority ? '<span class="priority-pill">ПРИОРИТЕТ</span>' : ''}
        <span class="status-pill" style="background:var(--status-${t.status}-bg);color:var(--status-${t.status})">
          <span class="dot" style="background:var(--status-${t.status})"></span>
          ${escapeHtml(statusLabel(t.status))}
        </span>
      </div>
      <div class="drill-item-title">${escapeHtml(titleText)}</div>
      ${meta ? `<div class="drill-item-meta">${meta}</div>` : ''}
    </button>`;
}

function renderDrillMessageItem(m) {
  const taskId = Array.isArray(m.linkedTasks) && m.linkedTasks[0] ? m.linkedTasks[0] : '';
  const text = escapeHtml(String(m.text || '').slice(0, 280));
  const when = m.at ? formatTimeAgo(new Date(m.at).toISOString()) : '';
  const footer = taskId ? `Связано с #${escapeHtml(taskId)}` : 'Без задачи';
  return `
    <button type="button" class="drill-item drill-item--msg"${taskId ? ` data-task-id="${escapeHtml(taskId)}"` : ''}>
      <div class="drill-item-head">
        <span class="drill-item-author">${escapeHtml(m.author || 'Неизвестно')}</span>
        <span class="drill-item-date">${escapeHtml(when)}</span>
      </div>
      <div class="drill-item-text">${text}</div>
      <div class="drill-item-footer">${footer}</div>
    </button>`;
}

const CATEGORY_META = {
  bug:       { label: 'Баги',        emoji: '🐞' },
  complaint: { label: 'Жалобы',      emoji: '😠' },
  question:  { label: 'Вопросы',     emoji: '❓' },
  info:      { label: 'Инфо',        emoji: 'ℹ️' },
  other:     { label: 'Прочее',      emoji: '•'  },
};

function computeTopCategories(days = 14) {
  const chat = STATE.chat || [];
  const since = Date.now() - days * 24 * 3600 * 1000;
  const counts = new Map();
  let classified = 0;
  for (const m of chat) {
    if ((m.at || 0) < since) continue;
    if (!m.llm || !m.llm.category) continue;
    classified++;
    const cat = m.llm.category;
    if (cat === 'info' || cat === 'other') continue;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => ({ key, count, ...CATEGORY_META[key] }));
  return { top, classified };
}

function renderTopCategories() {
  const host = $('#category-row');
  if (!host) return;
  const { top, classified } = computeTopCategories(14);
  if (classified === 0) {
    host.innerHTML = '<div class="category-empty">LLM-классификатор ещё не обработал сообщения. Запусти <code>node scripts/classify-backfill.js</code>.</div>';
    return;
  }
  if (top.length === 0) {
    host.innerHTML = '<div class="category-empty">За последние 14 дней баги/жалобы/вопросы не зафиксированы.</div>';
    return;
  }
  host.innerHTML = `
    <div class="category-label">Топ-3 категории проблем за 14 дней</div>
    <div class="category-chips">
      ${top.map((c) => `
        <button type="button" class="category-chip" data-cat="${escapeHtml(c.key)}">
          <span class="category-chip-emoji">${c.emoji}</span>
          <span class="category-chip-label">${escapeHtml(c.label)}</span>
          <span class="category-chip-count">${c.count}</span>
        </button>
      `).join('')}
    </div>`;
  host.querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', () => openDrillForCategory(el.dataset.cat));
  });
}

function computeSentimentStats(days = 14) {
  const since = Date.now() - days * 24 * 3600 * 1000;
  const counts = { negative: 0, neutral: 0, positive: 0 };
  let total = 0;
  for (const m of STATE.chat || []) {
    if ((m.at || 0) < since) continue;
    const s = m.llm?.sentiment;
    if (!s || !(s in counts)) continue;
    counts[s]++;
    total++;
  }
  return { counts, total };
}

function renderSentimentRow() {
  const host = $('#sentiment-row');
  if (!host) return;
  const { counts, total } = computeSentimentStats(14);
  if (total === 0) {
    host.innerHTML = '';
    return;
  }
  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  const items = [
    { key: 'negative', label: 'Негатив',   cls: 'is-negative', count: counts.negative },
    { key: 'neutral',  label: 'Нейтральные', cls: 'is-neutral',  count: counts.neutral  },
    { key: 'positive', label: 'Позитив',   cls: 'is-positive', count: counts.positive },
  ];
  host.innerHTML = `
    <div class="sentiment-label">Тональность чата за 14 дней (${total} сообщ.)</div>
    <div class="sentiment-bar">
      ${items.map((it) => it.count > 0 ? `<div class="sentiment-seg ${it.cls}" style="flex:${it.count}" title="${it.label}: ${it.count} (${pct(it.count)}%)"></div>` : '').join('')}
    </div>
    <div class="sentiment-chips">
      ${items.map((it) => `
        <div class="sentiment-chip ${it.cls}">
          <span class="sentiment-chip-label">${it.label}</span>
          <span class="sentiment-chip-count">${it.count}</span>
          <span class="sentiment-chip-pct">${pct(it.count)}%</span>
        </div>
      `).join('')}
    </div>`;
}

function openDrillForCategory(cat) {
  const since = Date.now() - 14 * 24 * 3600 * 1000;
  const items = (STATE.chat || [])
    .filter((m) => (m.at || 0) >= since && m.llm && m.llm.category === cat)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const meta = CATEGORY_META[cat] || { label: cat, emoji: '' };
  const mForm = (n) => plural(n, ['сообщение', 'сообщения', 'сообщений']);
  openDrill({
    title: `${meta.emoji} ${meta.label} · 14 дней`,
    subtitle: `${items.length} ${mForm(items.length)}`,
    items,
    kind: 'message',
  });
}

function openDrillForKpi(key) {
  const tasks = STATE.tasks || [];
  const chat = STATE.chat || [];
  const priorityFirst = (a, b) => Number(!!b.isPriority) - Number(!!a.isPriority);
  const tForm = (n) => plural(n, ['задача', 'задачи', 'задач']);
  const mForm = (n) => plural(n, ['сообщение', 'сообщения', 'сообщений']);

  if (key === 'active') {
    const items = tasks.filter((t) => t.status !== 'closed')
      .sort((a, b) => priorityFirst(a, b) || (b.daysTotal || 0) - (a.daysTotal || 0));
    openDrill({ title: 'Активные задачи', subtitle: `${items.length} ${tForm(items.length)}`, items, kind: 'task' });
    return;
  }
  if (key === 'errors') {
    const items = tasks.filter((t) => t.hasErrors)
      .sort((a, b) => priorityFirst(a, b) || Number(a.id) - Number(b.id));
    openDrill({ title: 'Задачи с ошибками', subtitle: `${items.length} ${tForm(items.length)}`, items, kind: 'task' });
    return;
  }
  if (key === 'overdue') {
    const items = tasks.filter(isOverdue)
      .sort((a, b) => priorityFirst(a, b) || ruDateToSortable(a.plannedDeadline).localeCompare(ruDateToSortable(b.plannedDeadline)));
    openDrill({ title: 'Просроченные задачи', subtitle: `${items.length} ${tForm(items.length)}`, items, kind: 'task' });
    return;
  }
  if (key === 'negWeek') {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const items = chat.filter((m) => msgIsNegative(m) && (m.at || 0) > weekAgo)
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    openDrill({ title: 'Негативные сообщения за 7 дней', subtitle: `${items.length} ${mForm(items.length)}`, items, kind: 'message' });
    return;
  }
}

// ---------- events ----------

function wireDrawer() {
  const menuBtn = document.getElementById('menu-btn');
  const sidebar = document.getElementById('sidebar');
  if (!menuBtn || !sidebar) return;

  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  function open() {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-open');
  }
  function close() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
  }

  menuBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) close(); else open();
  });
  backdrop.addEventListener('click', close);
}

function wireEvents() {
  $('#refresh-btn').addEventListener('click', refresh);
  $('#logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
  $('#search-input').addEventListener('input', (e) => {
    STATE.filters.search = e.target.value;
    renderWorkspace();
  });
  $('#hide-completed').addEventListener('change', (e) => {
    STATE.prefs.hideCompleted = e.target.checked;
    savePref('hideCompleted', STATE.prefs.hideCompleted);
    render();
  });
  $('#only-priority')?.addEventListener('change', (e) => {
    STATE.prefs.onlyPriority = e.target.checked;
    savePref('onlyPriority', STATE.prefs.onlyPriority);
    render();
  });
  $('#show-internal')?.addEventListener('change', (e) => {
    STATE.prefs.showInternal = e.target.checked;
    savePref('showInternal', STATE.prefs.showInternal);
    render();
  });
  for (const btn of $$('.view-switch-btn')) {
    btn.addEventListener('click', () => {
      STATE.prefs.view = btn.dataset.view;
      savePref('view', STATE.prefs.view);
      render();
    });
  }
  $('#task-modal').addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal();
  });
  $('#drill')?.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeDrill();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrill(); closeModal(); }
  });
  wireDrawer();

  fetch('/auth/me').then((r) => r.ok ? r.json() : null).then((me) => {
    if (me) $('#user-chip').textContent = me.name || me.login;
  });

  setInterval(renderSync, 15_000);
  setInterval(loadTasks, 60_000);
}

wireEvents();
loadTasks().catch((e) => console.error(e));
