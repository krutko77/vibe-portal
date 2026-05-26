// src/public/js/app.js

// ─── Client-side auth (localStorage, works in cross-site iframe) ───
const AUTH_KEY = 'shtab_auth_v1';
const AUTH_OK  = 'authenticated_1425';

function checkAuth() {
  try { return localStorage.getItem(AUTH_KEY) === AUTH_OK; } catch { return false; }
}

function loginSubmit() {
  const pw = document.getElementById('login-pw').value;
  if (pw === '1425') {
    try { localStorage.setItem(AUTH_KEY, AUTH_OK); } catch {}
    document.getElementById('login-overlay').classList.add('hidden');
  } else {
    document.getElementById('login-err').style.display = 'block';
    document.getElementById('login-pw').value = '';
  }
}

if (!checkAuth()) {
  document.getElementById('login-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('login-pw')?.focus(), 50);
} else {
  document.getElementById('login-overlay').classList.add('hidden');
}

const charts = {};

// ─── Consistent analyst colors ───
const CHART_PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#14b8a6','#f97316','#6366f1','#06b6d4',
  '#84cc16','#e11d48','#7c3aed','#0d9488','#b45309',
];
const ANALYST_ORDER = [
  20363, 22889, 23001, 24777, 24835, 25299,
  19909, 19553,
  7887, 21, 3065,
  16689, 22577,
];
const ANALYST_COLOR = {};
ANALYST_ORDER.forEach((id, i) => { ANALYST_COLOR[id] = CHART_PALETTE[i % CHART_PALETTE.length]; });
function analystColor(id) {
  return ANALYST_COLOR[id] || CHART_PALETTE[Math.abs(id) % CHART_PALETTE.length];
}

function formatRub(n) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
  }).format(n);
}

function barLabel(v) {
  if (!v) return '';
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + ' млн';
  if (v >= 1000)    return Math.round(v / 1000) + ' тыс';
  return String(v);
}

// ─── Month filter helpers ───
function setDefaultMonths() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  ['1','2'].forEach(tab => {
    const el = document.getElementById(`month-${tab}`);
    if (el) el.value = ym;
  });
}

function getMonthRange(tab) {
  const val = document.getElementById(`month-${tab}`)?.value;
  const now = new Date();
  const ym = val || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, '0')}`,
  };
}

function setChartTotal(elId, total) {
  const el = document.getElementById(elId);
  if (el) el.textContent = total != null ? formatRub(total) : '';
}

// ─── График "Объём продаж" ───
async function loadChart(tab) {
  const { from, to } = getMonthRange(tab);
  const loading = document.getElementById(`chart-${tab}-loading`);
  const canvas  = document.getElementById(`chart-${tab}`);
  loading.textContent = 'Загрузка...';
  loading.style.display = 'block';
  canvas.style.display  = 'none';
  setChartTotal(`money-total-${tab}`, null);

  try {
    const qs  = new URLSearchParams({ tab, from, to });
    const res = await fetch(`/api/money?${qs}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { analysts, total } = await res.json();

    loading.style.display = 'none';
    canvas.style.display  = 'block';
    setChartTotal(`money-total-${tab}`, total);

    if (charts[tab]) charts[tab].destroy();
    charts[tab] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      plugins: [ChartDataLabels],
      data: {
        labels: analysts.map(a => a.name),
        datasets: [{
          label: 'Валовая прибыль, ₽',
          data: analysts.map(a => a.total),
          backgroundColor: analysts.map(a => analystColor(a.id)),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => formatRub(ctx.parsed.y),
              afterBody: (tooltipItems) => {
                const items = analysts[tooltipItems[0].dataIndex]?.items || [];
                if (!items.length) return [];
                return ['─────────────────────', ...items.slice(0, 12).map(it => `  ${it.name}: ${formatRub(it.amount)}`)];
              },
            },
          },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: v => barLabel(v),
            font: { size: 11, weight: '700' },
            color: '#334155',
            offset: 2,
          },
        },
        scales: {
          y: { beginAtZero: true, grace: '15%', ticks: { callback: v => formatRub(v) } },
        },
      },
    });
  } catch (err) {
    loading.textContent = 'Ошибка загрузки данных: ' + err.message;
  }
}

// ─── График "Объём актов" ───
async function loadActs(tab) {
  const { from, to } = getMonthRange(tab);
  const loading = document.getElementById(`acts-${tab}-loading`);
  const canvas  = document.getElementById(`acts-chart-${tab}`);
  if (!loading || !canvas) return;

  loading.textContent = 'Загрузка...';
  loading.style.display = 'block';
  canvas.style.display  = 'none';
  setChartTotal(`acts-total-${tab}`, null);

  try {
    const qs  = new URLSearchParams({ tab, from, to });
    const res = await fetch(`/api/acts?${qs}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { analysts, total } = await res.json();

    loading.style.display = 'none';
    canvas.style.display  = 'block';
    setChartTotal(`acts-total-${tab}`, total);

    const key = `acts-${tab}`;
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      plugins: [ChartDataLabels],
      data: {
        labels: analysts.map(a => a.name),
        datasets: [{
          label: 'Объём актов, ₽',
          data: analysts.map(a => a.total),
          backgroundColor: analysts.map(a => analystColor(a.id)),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => formatRub(ctx.parsed.y),
              afterBody: (tooltipItems) => {
                const items = analysts[tooltipItems[0].dataIndex]?.items || [];
                if (!items.length) return [];
                return ['─────────────────────', ...items.slice(0, 12).map(it => `  ${it.title}: ${formatRub(it.amount)}`)];
              },
            },
          },
          datalabels: {
            anchor: 'end', align: 'end',
            formatter: v => barLabel(v),
            font: { size: 11, weight: '700' },
            color: '#334155',
            offset: 2,
          },
        },
        scales: {
          y: { beginAtZero: true, grace: '15%', ticks: { callback: v => formatRub(v) } },
        },
      },
    });
  } catch (err) {
    loading.textContent = 'Ошибка: ' + err.message;
  }
}

// ─── Блок "Загрузка аналитиков" ───
async function loadLoad(tab) {
  const gridId  = `analyst-grid-${tab}`;
  const panelId = `load-stages-${tab}`;
  const grid = document.getElementById(gridId);
  if (!grid) return;

  grid.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/load?tab=${tab}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { analysts } = await res.json();

    renderAnalystGrid(gridId, analysts, (analyst, card) => {
      document.querySelectorAll(`#${gridId} .analyst-card`).forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      renderLoadStages(panelId, analyst);
    });
  } catch (err) {
    grid.innerHTML = `<div class="error-msg">Ошибка: ${err.message}</div>`;
  }
}

// ─── Канбан ───
async function loadKanban(tab) {
  try {
    const res = await fetch(`/api/projects?tab=${tab}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { columns } = await res.json();
    renderKanban(`kanban-${tab}`, columns);
  } catch (err) {
    const el = document.getElementById(`kanban-${tab}`);
    if (el) el.innerHTML = `<div class="error-msg">Ошибка: ${err.message}</div>`;
  }
}

function toggleKanban(tab) {
  const board = document.getElementById(`kanban-${tab}`);
  const btn   = document.getElementById(`kanban-toggle-${tab}`);
  if (!board) return;
  const collapsed = board.classList.toggle('kanban-collapsed');
  if (btn) btn.textContent = collapsed ? '▶' : '▼';
}

// ─── Stats ───
async function loadStats(tab) {
  try {
    const res = await fetch(`/api/stats?tab=${tab}`);
    if (!res.ok) return;
    const { grades, projectsInWork, projectsOnTP, projectsOnPause } = await res.json();

    const gradeStr = Object.entries(grades)
      .sort((a,b) => { const o=['Intern','Junior','Middle','Senior']; return o.indexOf(a[0])-o.indexOf(b[0]); })
      .map(([g,n]) => `${g}: ${n}`)
      .join(' · ') || '—';

    const gv = document.getElementById(`grades-val-${tab}`);
    const wv = document.getElementById(`work-val-${tab}`);
    const tv = document.getElementById(`tp-val-${tab}`);
    const pv = document.getElementById(`pause-val-${tab}`);
    if (gv) gv.textContent = gradeStr;
    if (wv) wv.textContent = projectsInWork;
    if (tv) tv.textContent = projectsOnTP;
    if (pv) pv.textContent = projectsOnPause;
  } catch {}
}

// ─── Показатели текущего месяца ───
const _potentialItems = {};

async function loadMonthly(tab) {
  try {
    const res = await fetch(`/api/monthly?tab=${tab}`);
    if (!res.ok) return;
    const { monthName, plan, potential, fact, potentialItems } = await res.json();

    const title = document.getElementById(`monthly-title-${tab}`);
    if (title) title.textContent = `Показатели ${monthName}`;

    const planEl = document.getElementById(`monthly-plan-${tab}`);
    const potEl  = document.getElementById(`monthly-potential-${tab}`);
    const factEl = document.getElementById(`monthly-fact-${tab}`);
    if (planEl) planEl.textContent = formatRub(plan);
    if (potEl)  potEl.textContent  = formatRub(potential);
    if (factEl) factEl.textContent = formatRub(fact);

    _potentialItems[tab] = potentialItems || [];
    const listEl = document.getElementById(`potential-list-${tab}`);
    if (listEl) listEl.style.display = 'none';
  } catch {}
}

function togglePotentialList(tab) {
  const listEl = document.getElementById(`potential-list-${tab}`);
  if (!listEl) return;
  if (listEl.style.display !== 'none') { listEl.style.display = 'none'; return; }
  const items = _potentialItems[tab] || [];
  if (!items.length) { listEl.innerHTML = '<div class="pot-empty">Нет данных</div>'; }
  else {
    listEl.innerHTML = `<table class="pot-table">
      <thead><tr><th>Название</th><th>Стадия</th><th>Сколько ждем</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td>${it.name}</td>
        <td class="pot-stage">${it.stage}</td>
        <td class="pot-amount">${formatRub(it.amount)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  listEl.style.display = 'block';
}

// ─── Остаток часов ───
async function loadHours() {
  const wrap = document.getElementById('hours-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const res = await fetch('/api/hours');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { items } = await res.json();
    if (!items.length) {
      wrap.innerHTML = '<div class="loading">Нет проектов с остатком менее 5 часов</div>';
      return;
    }
    wrap.innerHTML = `<table class="hours-table">
      <thead><tr>
        <th class="ht-num">#</th>
        <th class="ht-name">Название проекта</th>
        <th class="ht-hours">Остаток</th>
      </tr></thead>
      <tbody>${items.map((it, i) => {
        const cls = it.hours < 0 ? 'ht-negative' : it.hours < 2 ? 'ht-critical' : 'ht-warn';
        return `<tr>
          <td class="ht-num">${i + 1}</td>
          <td class="ht-name"><a href="${it.url}" target="_blank" class="ht-link">${it.title}</a></td>
          <td class="ht-hours ${cls}">${it.hoursLabel}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch (err) {
    wrap.innerHTML = `<div class="error-msg">Ошибка: ${err.message}</div>`;
  }
}

// ─── Аналитика диалогов ───
async function loadDialogs(forceRefresh) {
  const wrap = document.getElementById('dialogs-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">Загрузка диалогов... Это может занять 30–60 секунд</div>';

  try {
    const url = '/api/dialogs' + (forceRefresh ? '?refresh=1' : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { total, analysts, updatedAt } = await res.json();

    const updatedStr = updatedAt
      ? new Date(updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';

    const activeAnalysts = analysts.filter(a => a.count > 0).length;

    let html = `
      <div class="dialogs-header-bar">
        <div class="info-card">
          <div class="label">Диалогов в контакт-центре</div>
          <div class="value">${total}</div>
        </div>
        <div class="info-card" style="background:linear-gradient(135deg,#059669 0%,#10b981 100%)">
          <div class="label">Аналитиков в диалогах</div>
          <div class="value">${activeAnalysts} из ${analysts.length}</div>
        </div>
        <div class="dialogs-refresh-card">
          <div>
            <div class="label">Данные актуальны на</div>
            <div class="value">${updatedStr}</div>
          </div>
          <button class="btn-refresh" onclick="loadDialogs(true)" style="margin-left:auto">↻ Обновить</button>
        </div>
      </div>
    `;

    for (const analyst of analysts) {
      const bestBadge  = analyst.best  ? `<span class="dt-badge dt-badge-best">🏆 Лучший: ${analyst.best}</span>`  : '';
      const worstBadge = analyst.worst ? `<span class="dt-badge dt-badge-worst">⚠️ Худший: ${analyst.worst}</span>` : '';

      html += `<div class="analyst-dialog-section">
        <div class="analyst-dialog-header">
          <span class="adh-name">${analyst.name}</span>
          <span class="adh-badges">${bestBadge}${worstBadge}</span>
          <span class="analyst-dialog-count">${analyst.count} ${pluralDialogs(analyst.count)}</span>
        </div>`;

      if (!analyst.dialogs.length) {
        html += `<div class="no-dialogs-msg">Нет открытых диалогов</div>`;
      } else {
        html += `<table class="dialog-table">
          <thead><tr>
            <th class="dt-num">#</th>
            <th>Название диалога</th>
            <th class="dt-time-h">Среднее время ответа</th>
          </tr></thead>
          <tbody>${analyst.dialogs.map((d, i) => {
            const cls = d.avgMs === null ? 'dt-empty'
              : d.avgMs < 5 * 60000 ? 'dt-fast'
              : d.avgMs < 30 * 60000 ? 'dt-medium'
              : 'dt-slow';
            const titleCell = d.url
              ? `<a href="${d.url}" target="_blank" class="dt-link">${d.title}</a>`
              : d.title;
            return `<tr>
              <td class="dt-num">${i + 1}</td>
              <td>${titleCell}</td>
              <td class="dt-time ${cls}">${d.avg}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;
      }
      html += `</div>`;
    }

    wrap.innerHTML = html;
  } catch (err) {
    wrap.innerHTML = `<div class="error-msg">Ошибка загрузки: ${err.message}</div>`;
  }
}

function pluralDialogs(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'диалог';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'диалога';
  return 'диалогов';
}

// ─── Tab loaders ───
function loadTab1() {
  loadMonthly('1');
  loadChart('1');
  loadActs('1');
  loadKanban('1');
  loadLoad('1');
  loadStats('1');
}

function loadTab2() {
  loadMonthly('2');
  loadChart('2');
  loadActs('2');
  loadKanban('2');
  loadLoad('2');
  loadStats('2');
}

function applyTab1() { loadChart('1'); loadActs('1'); }
function applyTab2() { loadChart('2'); loadActs('2'); }

// ─── Tab switching ───
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    const t = btn.dataset.tab;
    if (t === '2' && !charts['2']) loadTab2();
    if (t === '3') { updateWeekLabel(); loadFouls(); }
    if (t === '4') { updateThanksLabel(); loadThanks(); }
    if (t === '5') { updateTsLabel(); loadTimesheet(); }
    if (t === '6') loadHours();
    if (t === '7') loadDialogs();
  });
});

// ─── Inline comment popup ───
let _icpCallback = null;
let _icpRequired = false;

function showCommentPopup(anchorEl, { hint = '', placeholder = '', value = '', required = false, onSave }) {
  const popup  = document.getElementById('icp-popup');
  const hintEl = document.getElementById('icp-hint');
  const input  = document.getElementById('icp-input');

  _icpCallback = onSave;
  _icpRequired = required;

  hintEl.textContent = hint;
  hintEl.style.display = hint ? '' : 'none';
  input.placeholder = placeholder;
  input.value = value;
  input.classList.remove('icp-error');

  // Position near anchor, staying within viewport
  const rect = anchorEl.getBoundingClientRect();
  popup.style.display = 'block';
  const popH = popup.offsetHeight || 80;
  const top = (rect.bottom + 6 + popH > window.innerHeight)
    ? Math.max(4, rect.top - popH - 6)
    : rect.bottom + 6;
  const left = Math.min(rect.left, window.innerWidth - 360);
  popup.style.top  = top  + 'px';
  popup.style.left = Math.max(4, left) + 'px';

  requestAnimationFrame(() => input.focus());
}

async function _icpConfirm() {
  const input   = document.getElementById('icp-input');
  const comment = input.value;
  if (_icpRequired && !comment.trim()) {
    input.classList.add('icp-error');
    setTimeout(() => input.classList.remove('icp-error'), 600);
    return;
  }
  if (_icpCallback) await _icpCallback(comment);
  _icpClose();
}

function _icpClose() {
  document.getElementById('icp-popup').style.display = 'none';
  _icpCallback = null;
}

document.getElementById('icp-save-btn').addEventListener('click', _icpConfirm);
document.getElementById('icp-cancel-btn').addEventListener('click', _icpClose);
document.getElementById('icp-input').addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); _icpConfirm(); }
  if (e.key === 'Escape') _icpClose();
});
document.addEventListener('mousedown', e => {
  const popup = document.getElementById('icp-popup');
  if (popup.style.display !== 'none' && !popup.contains(e.target)) _icpClose();
});

// ─── Init ───
setDefaultMonths();
loadTab1();
