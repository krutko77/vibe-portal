// Vibe panel SPA — структура и поведение в стиле dev-портала.

const $  = (q, ctx = document) => ctx.querySelector(q);
const $$ = (q, ctx = document) => [...ctx.querySelectorAll(q)];

let ME = null;

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { ME = null; renderAuth(); throw new Error('unauthorized'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// GET с защитой от транзиентных пустых ответов nginx (HTTP/2 + активный SSE
// иногда даёт 4xx с пустым телом). Настоящая ошибка Express всегда несёт JSON
// {error}; пустое тело при !ok → ретраим. Возвращает { ok, status, data }.
async function getJsonWithRetry(url, tries = 3) {
  let last = { ok: false, status: 0, data: {} };
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      last = { ok: false, status: 0, data: {} };
      await new Promise(res => setTimeout(res, 250 * (i + 1)));
      continue;
    }
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    last = { ok: r.ok, status: r.status, data };
    // успех или настоящая ошибка с телом — не ретраим
    if (r.ok || (data && data.error)) return last;
    // !ok и пустое/непарсимое тело — транзиент, пробуем ещё
    await new Promise(res => setTimeout(res, 250 * (i + 1)));
  }
  return last;
}

const openModal  = (id) => $('#' + id).classList.remove('hidden');
const closeModal = (id) => $('#' + id).classList.add('hidden');

// ── SSH-доступ (десктопный VS Code) ──────────────────────────
let _sshCfg = null;
async function loadSshCfg(force) {
  if (!_sshCfg || force) _sshCfg = await api('/api/ssh-config');
  return _sshCfg;
}
async function openSshModal() {
  try {
    const cfg = await loadSshCfg();
    $('#ssh-config-text').value = cfg.configSnippet;
    const k = cfg.keyFileName;
    const mv = $('#ssh-mv-cmd');
    if (mv) mv.textContent = `mv ~/Downloads/${k} ~/.ssh/${k}\nchmod 600 ~/.ssh/${k}`;
    const al = $('#ssh-alias-hint');
    if (al) al.textContent = cfg.alias;
    const hh = $('#ssh-home-hint');
    if (hh && ME?.homeDir) hh.textContent = ME.homeDir;
    openModal('modal-ssh');
  } catch (e) { alert('SSH: ' + e.message); }
}
async function doRegenSshKey() {
  if (!confirm('Перевыпустить ключ? Старый ключ перестанет пускать — после этого скачай новый.')) return;
  try {
    _sshCfg = await api('/api/ssh-key/regenerate', { method: 'POST' });
    $('#ssh-config-text').value = _sshCfg.configSnippet;
    window.location.href = '/api/ssh-key'; // сразу отдать новый ключ на скачивание
  } catch (e) { alert(e.message); }
}
let _pvUri = '', _pvPath = '';
async function openDesktopVsCode(projectName) {
  try {
    const cfg = await loadSshCfg();
    _pvUri = cfg.projectUriBase + encodeURIComponent(projectName);
    _pvPath = ME.homeDir + '/' + projectName;
    $('#pv-name').textContent = projectName;
    $('#pv-path').textContent = _pvPath;
    // Заранее будим контейнер (SSH сам уснувший не поднимает).
    api('/api/container/start', { method: 'POST' }).catch(() => {});
    openModal('modal-proj-vscode');
  } catch (e) { alert('SSH: ' + e.message); }
}

const escapeHtml = (s) => (s || '').replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
})[c]);

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtBytesGb(bytes) {
  return (bytes / (1024 ** 3)).toFixed(1) + ' ГБ';
}

// Общие хелперы графиков CPU/RAM (SVG-отрисовка без внешних библиотек).
const VPS_CHART_NS = 'http://www.w3.org/2000/svg';
function vpsFmtTooltipTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
}

// ── График «Нагрузка на процессор» — раскладка 1:1 с дашбордом Timeweb
// Cloud: подписи по Y слева (фикс. 0-100% либо авто под фактический
// максимум — переключатель «Показывать …») и несколько подписей по X.
// Геометрия и X-тайм-хелперы (vpsCpuX/vpsCpuY/vpsCpuFmtAxisTime/vpsCpuBuildTicks)
// домен-агностичны (Y-домен передаётся параметром) и переиспользуются ниже
// графиком RAM (renderVpsMemChart) — своя у него только шкала Y (ГБ, не %)
// и две серии вместо одной.
const VPS_CPU_PLOT_W = 600, VPS_CPU_PLOT_H = 118;
const VPS_CPU_LEFT = 36, VPS_CPU_TOP = 4, VPS_CPU_BOTTOM = 18;
const VPS_CPU_W = VPS_CPU_LEFT + VPS_CPU_PLOT_W;
const VPS_CPU_H = VPS_CPU_TOP + VPS_CPU_PLOT_H + VPS_CPU_BOTTOM;
const VPS_CPU_COLOR = 'hsl(217 91% 60%)';

let vpsCpuScaleMode = 'fixed';
let vpsCpuLastPoints = [];
let vpsCpuLastRange = '24h';

// Верхняя граница шкалы для режима «динамическая»: с запасом ~15% над
// фактическим максимумом, округлённая до «красивого» числа (1/2/2.5/5/10 × 10^n),
// но не выше 100% (ось нагрузки не должна уходить за физический предел).
function vpsCpuNiceMax(max) {
  if (max <= 0) return 10;
  const rough = max * 1.15;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= rough) return Math.min(100, candidate);
  }
  return Math.min(100, 10 * magnitude);
}

function vpsCpuX(i, n) {
  return VPS_CPU_LEFT + (i / (n - 1)) * VPS_CPU_PLOT_W;
}
function vpsCpuY(v, domainMax) {
  return VPS_CPU_TOP + VPS_CPU_PLOT_H - (Math.max(0, Math.min(domainMax, v)) / domainMax) * VPS_CPU_PLOT_H;
}
function vpsCpuFmtAxisTime(ts, range) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (range === 'week' || range === '2w' || range === 'month') {
    const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    return `${date} ${time}`;
  }
  return time;
}

// ── «Красивые» тики по оси X — как в дашборде Timeweb: шаг подбирается из
// стандартного набора (минуты/часы/дни) под количество подписей, ожидаемое
// для периода, и привязывается к круглой границе (минуте/часу/местной
// полуночи), а не к позиции точки в массиве данных — иначе при даунсэмплинге
// подписи «плавают» и их всегда одинаковое число штук независимо от длины
// периода.
const VPS_CPU_TICK_TARGETS = { '1h': 7, '6h': 7, '24h': 8, week: 4, '2w': 5, month: 6 };
const VPS_CPU_STEP_CANDIDATES_MS = [1, 2, 5, 10, 15, 30].map(m => m * 60_000)
  .concat([1, 2, 3, 4, 6, 12].map(h => h * 3_600_000))
  .concat([1, 2, 3, 6, 7, 14, 30].map(d => d * 86_400_000));

function vpsCpuNiceStepMs(spanMs, targetCount) {
  const ideal = spanMs / Math.max(1, targetCount - 1);
  let best = VPS_CPU_STEP_CANDIDATES_MS[0];
  let bestDiff = Infinity;
  for (const step of VPS_CPU_STEP_CANDIDATES_MS) {
    const diff = Math.abs(step - ideal);
    if (diff < bestDiff) { best = step; bestDiff = diff; }
  }
  return best;
}

// Округляет вниз к круглой границе: для шага короче суток — к началу текущих
// местных суток + кратное шагу число минут/часов; для шага от суток и
// длиннее — к местной полуночи, кратной шагу дней от эпохи (чтобы сетка не
// «плавала» между перерисовками).
function vpsCpuFloorToStep(ts, stepMs) {
  const DAY_MS = 86_400_000;
  if (stepMs < DAY_MS) {
    const d = new Date(ts);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return dayStart + Math.floor((ts - dayStart) / stepMs) * stepMs;
  }
  const days = Math.round(stepMs / DAY_MS);
  const midnight = new Date(ts);
  midnight.setHours(0, 0, 0, 0);
  const epochDay = Math.floor(midnight.getTime() / DAY_MS);
  const rem = ((epochDay % days) + days) % days;
  midnight.setDate(midnight.getDate() - rem);
  return midnight.getTime();
}

// Таймстемпы тиков от первой до последней точки графика, с шагом,
// подобранным под ожидаемое число подписей для периода.
function vpsCpuBuildTicks(firstT, lastT, range) {
  const target = VPS_CPU_TICK_TARGETS[range] || 6;
  if (lastT <= firstT) return [firstT];
  const stepMs = vpsCpuNiceStepMs(lastT - firstT, target);
  const ticks = [];
  for (let t = vpsCpuFloorToStep(lastT, stepMs); t >= firstT; t -= stepMs) ticks.unshift(t);
  return ticks.length ? ticks : [firstT];
}

function renderVpsCpuChart(points, range) {
  const svg = $('#vpsCpuChart');
  const tooltipEl = $('#vpsCpuTooltip');
  svg.setAttribute('viewBox', `0 0 ${VPS_CPU_W} ${VPS_CPU_H}`);
  svg.innerHTML = '';
  svg.__vpsCpu = null;
  svg.onmousemove = null; svg.onmouseleave = null;
  vpsCpuLastPoints = points;
  vpsCpuLastRange = range;

  if (points.length < 2) {
    const text = document.createElementNS(VPS_CHART_NS, 'text');
    text.setAttribute('x', VPS_CPU_W / 2);
    text.setAttribute('y', VPS_CPU_H / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'vps-chart-empty');
    text.textContent = 'нет данных за период';
    svg.appendChild(text);
    tooltipEl.classList.add('hidden');
    return;
  }

  const n = points.length;
  const domainMax = vpsCpuScaleMode === 'auto'
    ? vpsCpuNiceMax(Math.max(...points.map(p => p.v)))
    : 100;

  for (let i = 0; i <= 5; i++) {
    const v = domainMax * i / 5;
    const y = vpsCpuY(v, domainMax);
    const grid = document.createElementNS(VPS_CHART_NS, 'line');
    grid.setAttribute('x1', VPS_CPU_LEFT); grid.setAttribute('x2', VPS_CPU_W);
    grid.setAttribute('y1', y); grid.setAttribute('y2', y);
    grid.setAttribute('class', 'vps-chart-grid');
    svg.appendChild(grid);

    const label = document.createElementNS(VPS_CHART_NS, 'text');
    label.setAttribute('x', VPS_CPU_LEFT - 6);
    label.setAttribute('y', y + 3);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'vps-chart-axis-label');
    label.textContent = (Math.round(v * 10) / 10) + ' %';
    svg.appendChild(label);
  }

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${vpsCpuX(i, n).toFixed(1)},${vpsCpuY(p.v, domainMax).toFixed(1)}`)
    .join(' ');
  const area = document.createElementNS(VPS_CHART_NS, 'path');
  area.setAttribute('d', `${path} L ${VPS_CPU_W},${VPS_CPU_TOP + VPS_CPU_PLOT_H} L ${VPS_CPU_LEFT},${VPS_CPU_TOP + VPS_CPU_PLOT_H} Z`);
  area.setAttribute('class', 'vps-chart-area cpu-area');
  svg.appendChild(area);
  const line = document.createElementNS(VPS_CHART_NS, 'path');
  line.setAttribute('d', path);
  line.setAttribute('class', 'vps-chart-line cpu-line');
  svg.appendChild(line);

  const firstT = points[0].t, lastT = points[n - 1].t;
  const ticks = vpsCpuBuildTicks(firstT, lastT, range);
  const EDGE_PX = 24;
  ticks.forEach(t => {
    const frac = lastT === firstT ? 0 : (t - firstT) / (lastT - firstT);
    const x = VPS_CPU_LEFT + frac * VPS_CPU_PLOT_W;
    const anchor = x <= VPS_CPU_LEFT + EDGE_PX ? 'start' : x >= VPS_CPU_W - EDGE_PX ? 'end' : 'middle';
    const label = document.createElementNS(VPS_CHART_NS, 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', VPS_CPU_H - 4);
    label.setAttribute('text-anchor', anchor);
    label.setAttribute('class', 'vps-chart-axis-label');
    label.textContent = vpsCpuFmtAxisTime(t, range);
    svg.appendChild(label);
  });

  const crosshair = document.createElementNS(VPS_CHART_NS, 'line');
  crosshair.setAttribute('y1', VPS_CPU_TOP); crosshair.setAttribute('y2', VPS_CPU_TOP + VPS_CPU_PLOT_H);
  crosshair.setAttribute('class', 'vps-chart-crosshair hidden');
  svg.appendChild(crosshair);

  const dot = document.createElementNS(VPS_CHART_NS, 'circle');
  dot.setAttribute('r', 3);
  dot.setAttribute('class', 'vps-chart-dot hidden');
  dot.style.fill = VPS_CPU_COLOR;
  svg.appendChild(dot);

  svg.__vpsCpu = { points, n, domainMax, crosshair, dot, tooltipEl };
  svg.onmousemove = vpsCpuHandleHover;
  svg.onmouseleave = vpsCpuHideHover;
}

function vpsCpuHandleHover(ev) {
  const svg = ev.currentTarget;
  const ctx = svg.__vpsCpu;
  if (!ctx) return;
  const rect = svg.getBoundingClientRect();
  const plotLeftPx = (VPS_CPU_LEFT / VPS_CPU_W) * rect.width;
  const plotWidthPx = rect.width - plotLeftPx;
  const relX = Math.max(0, Math.min(1, (ev.clientX - rect.left - plotLeftPx) / plotWidthPx));
  const idx = Math.round(relX * (ctx.n - 1));
  const x = vpsCpuX(idx, ctx.n);
  const v = ctx.points[idx].v;

  ctx.crosshair.setAttribute('x1', x); ctx.crosshair.setAttribute('x2', x);
  ctx.crosshair.classList.remove('hidden');
  ctx.dot.setAttribute('cx', x);
  ctx.dot.setAttribute('cy', vpsCpuY(v, ctx.domainMax));
  ctx.dot.classList.remove('hidden');

  ctx.tooltipEl.innerHTML =
    `<div class="vps-tooltip-time">${vpsFmtTooltipTime(ctx.points[idx].t)}</div>` +
    `<div class="vps-tooltip-row"><i style="background:${VPS_CPU_COLOR}"></i>Нагрузка: <b>${v} %</b></div>`;
  ctx.tooltipEl.classList.remove('hidden');

  const left = (x / VPS_CPU_W) * rect.width;
  const clamped = Math.max(50, Math.min(rect.width - 50, left));
  ctx.tooltipEl.style.left = clamped + 'px';
}

function vpsCpuHideHover(ev) {
  const ctx = ev.currentTarget.__vpsCpu;
  if (!ctx) return;
  ctx.crosshair.classList.add('hidden');
  ctx.dot.classList.add('hidden');
  ctx.tooltipEl.classList.add('hidden');
}

// ── График «Оперативная память» — та же раскладка, что у CPU (см. выше),
// но шкала Y — ГБ до физического потолка сервера (totalGb — «нельзя больше
// установленной памяти», по аналогии с CPU-потолком в 100%, см. vpsCpuNiceMax)
// и две серии (использовано / использовано с кэшем) вместо одной.
const VPS_MEM_GRID_STEPS_GB = [0.25, 0.5, 1, 2, 4, 5, 8, 10, 16, 20, 32, 50, 64, 100, 128];
function vpsMemGridStep(domainMax) {
  for (const step of VPS_MEM_GRID_STEPS_GB) {
    if (domainMax / step <= 6) return step;
  }
  return VPS_MEM_GRID_STEPS_GB[VPS_MEM_GRID_STEPS_GB.length - 1];
}
function vpsMemFmtGb(v) {
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? r : r.toFixed(1)) + ' ГБ';
}

const VPS_MEM_SERIES = [
  { key: 'vCachedGb', lineClass: 'ram-cached-line', areaClass: 'ram-cached-area', label: 'Использовано с кэшем', color: 'hsl(160 60% 45%)' },
  { key: 'vGb', lineClass: 'ram-used-line', areaClass: null, label: 'Использовано', color: 'hsl(280 75% 65%)' },
];

function renderVpsMemChart(points, range, totalGb) {
  const svg = $('#vpsMemChart');
  const tooltipEl = $('#vpsMemTooltip');
  svg.setAttribute('viewBox', `0 0 ${VPS_CPU_W} ${VPS_CPU_H}`);
  svg.innerHTML = '';
  svg.__vpsMem = null;
  svg.onmousemove = null; svg.onmouseleave = null;

  if (points.length < 2) {
    const text = document.createElementNS(VPS_CHART_NS, 'text');
    text.setAttribute('x', VPS_CPU_W / 2);
    text.setAttribute('y', VPS_CPU_H / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'vps-chart-empty');
    text.textContent = 'нет данных за период';
    svg.appendChild(text);
    tooltipEl.classList.add('hidden');
    return;
  }

  const n = points.length;
  const domainMax = totalGb > 0
    ? totalGb
    : Math.max(1, Math.ceil(Math.max(...points.map(p => Math.max(p.vGb, p.vCachedGb))) * 1.15));
  const step = vpsMemGridStep(domainMax);

  for (let v = 0; v <= domainMax + 1e-9; v += step) {
    const y = vpsCpuY(v, domainMax);
    const grid = document.createElementNS(VPS_CHART_NS, 'line');
    grid.setAttribute('x1', VPS_CPU_LEFT); grid.setAttribute('x2', VPS_CPU_W);
    grid.setAttribute('y1', y); grid.setAttribute('y2', y);
    grid.setAttribute('class', 'vps-chart-grid');
    svg.appendChild(grid);

    const label = document.createElementNS(VPS_CHART_NS, 'text');
    label.setAttribute('x', VPS_CPU_LEFT - 6);
    label.setAttribute('y', y + 3);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'vps-chart-axis-label');
    label.textContent = vpsMemFmtGb(v);
    svg.appendChild(label);
  }

  VPS_MEM_SERIES.forEach(s => {
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${vpsCpuX(i, n).toFixed(1)},${vpsCpuY(p[s.key], domainMax).toFixed(1)}`)
      .join(' ');
    if (s.areaClass) {
      const area = document.createElementNS(VPS_CHART_NS, 'path');
      area.setAttribute('d', `${path} L ${VPS_CPU_W},${VPS_CPU_TOP + VPS_CPU_PLOT_H} L ${VPS_CPU_LEFT},${VPS_CPU_TOP + VPS_CPU_PLOT_H} Z`);
      area.setAttribute('class', 'vps-chart-area ' + s.areaClass);
      svg.appendChild(area);
    }
    const line = document.createElementNS(VPS_CHART_NS, 'path');
    line.setAttribute('d', path);
    line.setAttribute('class', 'vps-chart-line ' + s.lineClass);
    svg.appendChild(line);
  });

  const firstT = points[0].t, lastT = points[n - 1].t;
  const ticks = vpsCpuBuildTicks(firstT, lastT, range);
  const EDGE_PX = 24;
  ticks.forEach(t => {
    const frac = lastT === firstT ? 0 : (t - firstT) / (lastT - firstT);
    const x = VPS_CPU_LEFT + frac * VPS_CPU_PLOT_W;
    const anchor = x <= VPS_CPU_LEFT + EDGE_PX ? 'start' : x >= VPS_CPU_W - EDGE_PX ? 'end' : 'middle';
    const label = document.createElementNS(VPS_CHART_NS, 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', VPS_CPU_H - 4);
    label.setAttribute('text-anchor', anchor);
    label.setAttribute('class', 'vps-chart-axis-label');
    label.textContent = vpsCpuFmtAxisTime(t, range);
    svg.appendChild(label);
  });

  const crosshair = document.createElementNS(VPS_CHART_NS, 'line');
  crosshair.setAttribute('y1', VPS_CPU_TOP); crosshair.setAttribute('y2', VPS_CPU_TOP + VPS_CPU_PLOT_H);
  crosshair.setAttribute('class', 'vps-chart-crosshair hidden');
  svg.appendChild(crosshair);

  const dots = VPS_MEM_SERIES.map(s => {
    const dot = document.createElementNS(VPS_CHART_NS, 'circle');
    dot.setAttribute('r', 3);
    dot.setAttribute('class', 'vps-chart-dot hidden');
    dot.style.fill = s.color;
    svg.appendChild(dot);
    return dot;
  });

  svg.__vpsMem = { points, n, domainMax, crosshair, dots, tooltipEl };
  svg.onmousemove = vpsMemHandleHover;
  svg.onmouseleave = vpsMemHideHover;
}

function vpsMemHandleHover(ev) {
  const svg = ev.currentTarget;
  const ctx = svg.__vpsMem;
  if (!ctx) return;
  const rect = svg.getBoundingClientRect();
  const plotLeftPx = (VPS_CPU_LEFT / VPS_CPU_W) * rect.width;
  const plotWidthPx = rect.width - plotLeftPx;
  const relX = Math.max(0, Math.min(1, (ev.clientX - rect.left - plotLeftPx) / plotWidthPx));
  const idx = Math.round(relX * (ctx.n - 1));
  const x = vpsCpuX(idx, ctx.n);

  ctx.crosshair.setAttribute('x1', x); ctx.crosshair.setAttribute('x2', x);
  ctx.crosshair.classList.remove('hidden');

  const rows = [];
  VPS_MEM_SERIES.forEach((s, i) => {
    const v = ctx.points[idx][s.key];
    ctx.dots[i].setAttribute('cx', x);
    ctx.dots[i].setAttribute('cy', vpsCpuY(v, ctx.domainMax));
    ctx.dots[i].classList.remove('hidden');
    rows.push(`<div class="vps-tooltip-row"><i style="background:${s.color}"></i>${s.label}: <b>${vpsMemFmtGb(v)}</b></div>`);
  });

  ctx.tooltipEl.innerHTML = `<div class="vps-tooltip-time">${vpsFmtTooltipTime(ctx.points[idx].t)}</div>` + rows.join('');
  ctx.tooltipEl.classList.remove('hidden');

  const left = (x / VPS_CPU_W) * rect.width;
  const clamped = Math.max(50, Math.min(rect.width - 50, left));
  ctx.tooltipEl.style.left = clamped + 'px';
}

function vpsMemHideHover(ev) {
  const ctx = ev.currentTarget.__vpsMem;
  if (!ctx) return;
  ctx.crosshair.classList.add('hidden');
  ctx.dots.forEach(d => d.classList.add('hidden'));
  ctx.tooltipEl.classList.add('hidden');
}

// ── Инлайн-дропдаун («Статистика за …», «Показывать …») — кликабельный текст
// со стрелкой вместо нативного <select>, попап со списком ниже.
function wireInlineSelect(id, onChange) {
  const root = document.getElementById(id);
  const btn = root.querySelector('.vps-inline-select-btn');
  const label = root.querySelector('.vps-inline-select-label');
  const items = [...root.querySelectorAll('.vps-inline-select-menu button')];
  const close = () => root.classList.remove('open');

  function setValue(value, { silent } = {}) {
    const item = items.find(it => it.dataset.value === value) || items[0];
    items.forEach(it => it.classList.toggle('active', it === item));
    label.textContent = item.textContent;
    if (!silent) onChange(item.dataset.value);
  }

  items.forEach(it => {
    it.onclick = () => { setValue(it.dataset.value); close(); };
  });
  btn.onclick = (e) => { e.stopPropagation(); root.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });

  const def = items.find(it => it.dataset.default === '1') || items[0];
  setValue(def.dataset.value, { silent: true });
  return { setValue };
}

let vpsMetricsRange = 'month';
// Заказанный объём RAM сервера (целое число ГБ, из /api/vps-disk → ramMb) —
// потолок шкалы графика «Оперативная память». Обновляется при каждом
// открытии модалки (см. vpsDiskBtn), т.е. подхватывает смену конфигурации
// сервера без релиза панели.
let vpsRamTotalGb = 0;

async function loadVpsMetrics(range) {
  vpsMetricsRange = range;
  $('#vpsMetricsHint').textContent = '';
  try {
    const { cpu, mem } = await api('/api/vps-metrics?range=' + range);
    const totalGb = vpsRamTotalGb || mem.totalGb;
    $('#vpsMemTotal').textContent = totalGb ? totalGb + ' ГБ' : '';

    renderVpsCpuChart(cpu.points, range);
    renderVpsMemChart(mem.points, range, totalGb);
  } catch (e) {
    $('#vpsMetricsHint').textContent = 'Не удалось загрузить нагрузку: ' + e.message;
    renderVpsCpuChart([], range);
    renderVpsMemChart([], range, 0);
  }
}

// ── Кастомный select (вместо системного, в нашей теме) ─────
// Прогрессивное улучшение: прячем нативный <select>, строим дропдаун в дизайне
// портала и синхронизируем через события 'change' (внешний код читает .value
// как обычно). Программная установка value → dispatchEvent('change') обновит UI.
function enhanceSelect(sel) {
  if (!sel || sel.dataset.kg) return;
  sel.dataset.kg = '1';
  sel.classList.add('kg-select-native');
  const wrap = document.createElement('div');
  wrap.className = 'kg-select';
  const chevron = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
  wrap.innerHTML =
    '<button type="button" class="kg-select-btn"><span class="kg-select-label"></span>' + chevron + '</button>' +
    '<div class="kg-select-menu"></div>';
  const btn = wrap.querySelector('.kg-select-btn');
  const label = wrap.querySelector('.kg-select-label');
  const menu = wrap.querySelector('.kg-select-menu');
  const close = () => wrap.classList.remove('open');

  function buildItems() {
    menu.innerHTML = '';
    [...sel.options].forEach(opt => {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'kg-select-item' + (opt.value === sel.value ? ' active' : '');
      it.textContent = opt.textContent;
      it.dataset.value = opt.value;
      it.onclick = () => {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      };
      menu.appendChild(it);
    });
  }
  function syncLabel() {
    const opt = sel.options[sel.selectedIndex];
    label.textContent = opt ? opt.textContent : '';
    [...menu.children].forEach(it => it.classList.toggle('active', it.dataset.value === sel.value));
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (wrap.classList.contains('open')) { close(); return; }
    buildItems(); syncLabel(); wrap.classList.add('open');
  };
  sel.addEventListener('change', syncLabel);
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });

  sel.parentNode.insertBefore(wrap, sel.nextSibling);
  buildItems();
  syncLabel();
}
function enhanceAllSelects(root = document) {
  [...root.querySelectorAll('select.form-input')].forEach(enhanceSelect);
}

// ── Auth rendering ─────────────────────────────────────────

function renderAuth() {
  const isAuth = !!ME;
  document.body.classList.toggle('is-auth', isAuth);
  document.body.classList.toggle('is-admin', !!ME?.isAdmin);
  $('#welcome').classList.toggle('hidden', isAuth);
  $('#main-layout').classList.toggle('hidden', !isAuth);
  if (isAuth) {
    $('#authUsername').textContent = ME.username + (ME.isAdmin ? ' (admin)' : '');
    setActiveView(localStorage.getItem('vibe.view') || 'projects');
    refreshAll();
  }
}

// ── COURSE: данные программы Vibecoding (M1-M6) ─────────────
const COURSE = [
  {
    id: 'm1', title: 'Старт: Claude, проекты и безопасный фундамент',
    lessons: [
      { id: 'l1', title: 'Что такое Claude и почему именно он · отличие от GPT, Cursor, Codex, DeepSeek' },
      { id: 'l2', title: 'Где и как работать с Claude · лайфхаки и типовые ошибки' },
      { id: 'l3', title: 'В чём волшебство проектов · чаты vs проекты' },
      { id: 'l4', title: 'Как правильно организовать проект, чтобы он подошёл под любую модель' },
      { id: 'l5', title: 'CLAUDE.md — что это, в чём его магия и как написать свой' },
      { id: 'l6', title: 'Skills — зачем нужны и как использовать' },
      { id: 'l7', title: 'Как работать с Claude эффективно и не бояться потерять контекст' },
      { id: 'l8', title: 'Полезные промпты и команды для работы с Claude' },
    ],
    materials: 'Готовый шаблон идеального проекта · CLAUDE.md и системные файлы · список Skills, которые реально работают · подборка полезных промптов.',
    homework: 'Создать первый проект на нашем dev-портале и запустить первый сайт-лендинг.',
    meetup: { date: 'чт 28.05', title: 'Мастер-класс МК-1', desc: 'Три способа начать работу с проектом, как выстроить процесс для команды.' },
  },
  {
    id: 'm2', title: 'Свой dev-портал + Claude в Б24',
    lessons: [
      { id: 'l1', title: 'В чём особенность работы Claude в России и как обеспечить максимальную безопасность' },
      { id: 'l2', title: 'Детальный обзор нашего dev-портала · как мы используем Claude из Битрикс24 и ушли от ChatGPT в браузере' },
      { id: 'l3', title: 'Как мы сделали проекты и файл-опросник для аналитиков и интеграторов, которые в вайбкодинг не уходили' },
      { id: 'l4', title: 'Как оплачивать, регистрировать и обойти блокировку РФ для Claude (или альтернативы)' },
      { id: 'l5', title: 'Достойные альтернативы «без танцев с бубном» — используем структуру Claude, меняем модель «под капотом»' },
      { id: 'l6', title: 'Как я «хитрю» с Claude — лайфхаки для не-программистов' },
    ],
    materials: 'Шаблон проектов для Битрикс24 со Skills и инструкциями · системные файлы для готового dev-портала · 8 шаблонов рабочих проектов · список проверенных площадок для оплаты/SMS/регистрации/«КВН».',
    homework: 'Создать свой dev-портал и получить свой Claude.',
    meetup: { date: 'вт 02.06', title: 'Мастер-класс МК-2', desc: 'Создаю удобное приложение для учеников через dev-портал, в режиме live для вас.' },
  },
  {
    id: 'm3', title: 'Платформа Vibe Code и сравнение инструментов',
    lessons: [
      { id: 'l1', title: 'Платформа vibecode.bitrix24.tech — что даёт и зачем (можно и без неё)' },
      { id: 'l2', title: 'Шаблоны проектов и Skills под Б24-задачи · персональный пресет' },
      { id: 'l3', title: 'Cursor, Codex и DeepSeek для vibecode — как использовать и настроить' },
      { id: 'l4', title: 'Сравнение моделей на одной задаче для Битрикс24 · выводы' },
      { id: 'l5', title: 'Ответ на главный вопрос: а зачем мне вообще платформа vibecode?' },
      { id: 'l6', title: 'Как писать приложения, вообще не используя vibecode' },
      { id: 'l7', title: 'Что такое .env и как «безопасно» хранить API-ключи' },
    ],
    materials: 'Готовый Skill для vibecode от Битрикс24 · 8 шаблонов рабочих проектов на vibecode · бенчмарк Claude/Cursor/Codex/DeepSeek · шаблон .env.',
    homework: 'Создать локальное приложение для Битрикс24 и разместить на своём портале через серверы vibecode.',
    meetup: { date: 'чт 04.06', title: 'Мастер-класс МК-3', desc: 'Делаю «пульт собственника» и публикую его на своём портале.' },
  },
  {
    id: 'm4', title: 'Приложения и дашборды на Битрикс24',
    lessons: [
      { id: 'l1', title: 'REST Битрикс24 для не-программистов · webhook, OAuth, методы' },
      { id: 'l2', title: 'Локальное приложение Б24 · Hello World в карточке сделки' },
      { id: 'l3', title: 'Дашборд: визуализация данных портала · базовый шаблон из apps.kiselevgroup.com' },
      { id: 'l4', title: 'Деплой на свой VPS · SSH, Nginx, домен, SSL' },
      { id: 'l5', title: 'Базы данных без боли · SQLite/Supabase, когда хватает Б24' },
      { id: 'l6', title: 'Внешние интеграции · Telegram-бот → Б24, AI-функции в карточке' },
    ],
    materials: 'Список запросов и файлов, которые нужно скормить Б24-проекту · скрипты деплоя на VPS · Postman-коллекция для REST Б24 · свой дашборд из шаблона apps.kiselevgroup.com.',
    homework: 'Собрать приложение для своей компании (дадим несколько идей).',
    meetup: { date: 'вт 09.06', title: 'Встреча 4', desc: 'Отвечаю на вопросы, разбираем «секретную задачу» онлайн.' },
  },
  {
    id: 'm5', title: 'Как это продавать клиентам',
    lessons: [
      { id: 'l1', title: 'Безопасная работа с клиентскими порталами' },
      { id: 'l2', title: 'Эффект «вау» за 30 минут · сценарий пресейл-встречи в zoom' },
      { id: 'l3', title: 'Цены, рынок, развенчание иллюзий · куда движется рынок и что будет через полгода' },
      { id: 'l4', title: 'Как подготовить спич для клиента на 5 минут' },
      { id: 'l5', title: 'Что реально покупают, а что — только иллюзия' },
      { id: 'l6', title: 'Почему мы не продаём новым клиентам, а только старым и текущим' },
      { id: 'l7', title: 'Почему PDF-презентации — это прошлый век · две стратегии' },
    ],
    materials: 'Примеры наших презентаций клиентам — реальные zoom-встречи · сценарий пресейл-встречи на 30 минут · чек-лист безопасности · готовый спич на 5 минут.',
    homework: 'Составить список 10 идей для приложений + спич для своего приложения на 5 минут.',
    meetup: { date: 'чт 02.07', title: 'Выпускной · Встреча 5', desc: 'Приложение себе на портал, защита live demo.' },
  },
  {
    id: 'm6', title: 'ИИ-инструменты вокруг бизнеса',
    lessons: [
      { id: 'l1', title: 'Что такое n8n · как применять, обзор инструмента' },
      { id: 'l2', title: 'Что такое OpenClaw — плюсы и минусы · как я использую и раскатал на руководителей' },
      { id: 'l3', title: 'Как сделать свою базу знаний — wiki, статьи, графы — и держать её актуальной' },
      { id: 'l4', title: 'RAG и векторные базы знаний · кейс KISELEV GROUP — плюсы и минусы' },
      { id: 'l5', title: 'Что ещё важно знать, чего мне не сказали на обучениях, которые я проходил' },
    ],
    materials: 'Карта применимых ИИ-инструментов вокруг Б24-практики · кейс RAG/wiki из KG · диплом · бонусный урок «одна фраза» после защиты.',
    homework: 'Провести 3 встречи и совершить 1 продажу — отбить стоимость курса.',
    meetup: { date: 'чт 09.07', title: 'Финал · Встреча 6', desc: 'Инсайды KISELEV GROUP, что мы делаем сейчас и куда движемся.' },
    bonus: { title: 'БОНУС-урок', desc: 'Одна фраза, которая заменит всё обучение — открывается только после сдачи выпускной работы.' },
  },
];

window.COURSE = COURSE;  // хаб «База знаний» (kb.js) читает структуру курса отсюда

// Текущий выбранный пункт. Форматы: "m1.l3" (урок), "m1.materials", "m1.homework", "m1.meetup", "m6.bonus", "intro" (welcome)
let courseSelected = localStorage.getItem('vibe.course.sel') || 'intro';
const courseExpanded = new Set(JSON.parse(localStorage.getItem('vibe.course.exp') || '["m1"]'));

function renderCourse() {
  renderCourseContent();   // дерево курса заменено сайдбаром хаба (renderCourseTree больше не нужно)
}

// Выбор пункта курса из сайдбара хаба «База знаний» ('m1' | 'm1.materials' | 'm1.l3' | …)
window.courseSelect = function (sel) {
  courseSelected = sel;
  localStorage.setItem('vibe.course.sel', sel);
  renderCourseContent();   // рендерит в #course-content (теперь внутри #kb-course-host)
};

function renderCourseTree() {
  const tree = $('#course-tree');
  if (!tree) return;
  let html = `
    <button class="course-tree-intro${courseSelected === 'intro' ? ' active' : ''}" data-sel="intro">
      <span class="course-tree-intro-no">★</span>
      <span class="course-tree-intro-title">О курсе</span>
    </button>
  `;
  for (const mod of COURSE) {
    const isOpen = courseExpanded.has(mod.id);
    const modSelected = courseSelected === mod.id;
    html += `
      <div class="course-tree-module${isOpen ? ' is-open' : ''}">
        <button class="course-tree-mod-head${modSelected ? ' active' : ''}" data-mod="${mod.id}">
          <span class="course-tree-caret">▸</span>
          <span class="course-tree-mod-no">${mod.id.toUpperCase()}</span>
          <span class="course-tree-mod-title">${escapeHtml(mod.title)}</span>
        </button>
        <div class="course-tree-mod-body">
          ${mod.lessons.map((lsn, i) => `
            <button class="course-tree-lesson${courseSelected === mod.id + '.' + lsn.id ? ' active' : ''}" data-sel="${mod.id}.${lsn.id}">
              <span class="course-tree-lesson-no">${i + 1}</span>
              <span class="course-tree-lesson-title">${escapeHtml(lsn.title)}</span>
            </button>
          `).join('')}
          <button class="course-tree-card course-tree-card-materials${courseSelected === mod.id + '.materials' ? ' active' : ''}" data-sel="${mod.id}.materials">
            <span class="course-tree-card-icon">📦</span>
            <span>Материалы модуля</span>
          </button>
          <button class="course-tree-card course-tree-card-hw${courseSelected === mod.id + '.homework' ? ' active' : ''}" data-sel="${mod.id}.homework">
            <span class="course-tree-card-icon">✓</span>
            <span>Домашка</span>
          </button>
          ${mod.meetup ? `
            <button class="course-tree-card course-tree-card-mk${courseSelected === mod.id + '.meetup' ? ' active' : ''}" data-sel="${mod.id}.meetup">
              <span class="course-tree-card-icon">★</span>
              <span>${escapeHtml(mod.meetup.title)} · ${escapeHtml(mod.meetup.date)}</span>
            </button>
          ` : ''}
          ${mod.bonus ? `
            <button class="course-tree-card course-tree-card-bonus${courseSelected === mod.id + '.bonus' ? ' active' : ''}" data-sel="${mod.id}.bonus">
              <span class="course-tree-card-icon">🎁</span>
              <span>${escapeHtml(mod.bonus.title)}</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }
  tree.innerHTML = html;
  // bindings
  $$('.course-tree-mod-head', tree).forEach(b => {
    b.onclick = () => {
      const id = b.dataset.mod;
      // Раскрыть если свёрнут + перейти на оверью модуля
      if (!courseExpanded.has(id)) courseExpanded.add(id);
      else if (courseSelected === id) courseExpanded.delete(id);  // повторный клик на уже открытом — свернуть
      localStorage.setItem('vibe.course.exp', JSON.stringify([...courseExpanded]));
      courseSelected = id;
      localStorage.setItem('vibe.course.sel', courseSelected);
      renderCourse();
    };
  });
  $$('[data-sel]', tree).forEach(b => {
    b.onclick = () => {
      courseSelected = b.dataset.sel;
      localStorage.setItem('vibe.course.sel', courseSelected);
      renderCourse();
    };
  });
}

function renderCourseContent() {
  const root = $('#course-content');
  if (!root) return;
  if (courseSelected === 'intro') {
    root.innerHTML = `
      <div class="page-meta">VIBE PORTAL · КУРС</div>
      <h1 class="page-h1">Программа курса <em>Vibecoding</em></h1>
      <p class="page-lead">
        6 модулей: от первого проекта до продажи клиенту. К каждому уроку — конспект,
        к каждому модулю — материалы, домашка и мастер-класс.
        Полная программа: <a href="https://analitik.kiselevgroup.com/vibecoding" target="_blank">analitik.kiselevgroup.com/vibecoding ↗</a>
      </p>
      <div class="course-intro-grid">
        ${COURSE.map(m => `
          <button class="course-intro-card" data-sel="${m.id}" type="button">
            <div class="course-intro-card-no">${m.id.toUpperCase()}</div>
            <div class="course-intro-card-title">${escapeHtml(m.title)}</div>
            <div class="course-intro-card-meta">${m.lessons.length} уроков · ${m.meetup ? escapeHtml(m.meetup.date) : '—'}</div>
            <div class="course-intro-card-cta">Открыть модуль →</div>
          </button>
        `).join('')}
      </div>
    `;
    $$('[data-sel]', root).forEach(b => {
      b.onclick = () => {
        courseSelected = b.dataset.sel;
        localStorage.setItem('vibe.course.sel', courseSelected);
        if (!courseExpanded.has(courseSelected)) {
          courseExpanded.add(courseSelected);
          localStorage.setItem('vibe.course.exp', JSON.stringify([...courseExpanded]));
        }
        renderCourse();
      };
    });
    return;
  }
  const [mId, partRaw] = courseSelected.split('.');
  const mod = COURSE.find(m => m.id === mId);
  if (!mod) { root.innerHTML = '<div class="empty">не найдено</div>'; return; }

  // Модуль (без выбранного урока/карточки) — overview
  if (!partRaw) {
    root.innerHTML = `
      <div class="page-meta">${mod.id.toUpperCase()} · МОДУЛЬ</div>
      <h1 class="page-h1">${escapeHtml(mod.title)}</h1>
      <div class="module-actions">
        <button class="module-action-btn module-action-hw" data-sel="${mod.id}.homework">
          <span class="module-action-icon">✓</span>
          <span class="module-action-body">
            <span class="module-action-label">Домашнее задание</span>
            <span class="module-action-sub">${escapeHtml(mod.homework.slice(0, 90))}${mod.homework.length > 90 ? '…' : ''}</span>
          </span>
        </button>
        <button class="module-action-btn module-action-mat" data-sel="${mod.id}.materials">
          <span class="module-action-icon">📦</span>
          <span class="module-action-body">
            <span class="module-action-label">Материалы модуля</span>
            <span class="module-action-sub">${escapeHtml(mod.materials.slice(0, 90))}${mod.materials.length > 90 ? '…' : ''}</span>
          </span>
        </button>
      </div>
      <h2 class="page-h2">Уроки · ${mod.lessons.length}</h2>
      <div class="module-lessons">
        ${mod.lessons.map((lsn, i) => `
          <button class="module-lesson" data-sel="${mod.id}.${lsn.id}" type="button">
            <span class="module-lesson-no">${i + 1}</span>
            <span class="module-lesson-title">${escapeHtml(lsn.title)}</span>
            <span class="module-lesson-cta">→</span>
          </button>
        `).join('')}
      </div>
      ${mod.meetup ? `
        <h2 class="page-h2">Мастер-класс / встреча</h2>
        <button class="module-action-btn module-action-mk" data-sel="${mod.id}.meetup">
          <span class="module-action-icon">★</span>
          <span class="module-action-body">
            <span class="module-action-label">${escapeHtml(mod.meetup.title)} · ${escapeHtml(mod.meetup.date)}</span>
            <span class="module-action-sub">${escapeHtml(mod.meetup.desc)}</span>
          </span>
        </button>
      ` : ''}
      ${mod.bonus ? `
        <button class="module-action-btn module-action-bonus" data-sel="${mod.id}.bonus" style="margin-top:10px">
          <span class="module-action-icon">🎁</span>
          <span class="module-action-body">
            <span class="module-action-label">${escapeHtml(mod.bonus.title)}</span>
            <span class="module-action-sub">${escapeHtml(mod.bonus.desc)}</span>
          </span>
        </button>
      ` : ''}
    `;
    $$('[data-sel]', root).forEach(b => {
      b.onclick = () => {
        courseSelected = b.dataset.sel;
        localStorage.setItem('vibe.course.sel', courseSelected);
        renderCourse();
      };
    });
    return;
  }

  // Урок
  if (partRaw && partRaw.startsWith('l')) {
    const idx = mod.lessons.findIndex(l => l.id === partRaw);
    if (idx < 0) { root.innerHTML = '<div class="empty">урок не найден</div>'; return; }
    const lsn = mod.lessons[idx];
    const prev = idx > 0 ? mod.lessons[idx - 1] : null;
    const next = idx < mod.lessons.length - 1 ? mod.lessons[idx + 1] : null;
    const note = (window.LESSON_NOTES || {})[courseSelected];
    const body = note
      ? `<div class="lesson-note">${note}</div>`
      : `<div class="course-placeholder">
        <div class="course-placeholder-icon">📝</div>
        <div class="course-placeholder-title">Конспект готовится</div>
        <div class="course-placeholder-desc">Текстовый конспект и видео появятся здесь после записи мастер-класса. Полная программа — на <a href="https://analitik.kiselevgroup.com/vibecoding" target="_blank">analitik.kiselevgroup.com/vibecoding</a>.</div>
      </div>`;
    root.innerHTML = `
      <div class="page-meta">${mod.id.toUpperCase()} · УРОК ${idx + 1}</div>
      <h1 class="page-h1">${escapeHtml(lsn.title)}</h1>
      ${body}
      <div class="course-nav">
        ${prev ? `<button class="course-nav-prev" data-sel="${mod.id}.${prev.id}">← ${escapeHtml(prev.title.slice(0, 50))}${prev.title.length > 50 ? '…' : ''}</button>` : '<span></span>'}
        ${next ? `<button class="course-nav-next" data-sel="${mod.id}.${next.id}">${escapeHtml(next.title.slice(0, 50))}${next.title.length > 50 ? '…' : ''} →</button>` : '<span></span>'}
      </div>
    `;
    $$('[data-sel]', root).forEach(b => {
      b.onclick = () => {
        courseSelected = b.dataset.sel;
        localStorage.setItem('vibe.course.sel', courseSelected);
        renderCourse();
      };
    });
    return;
  }

  // Карточки: материалы / домашка / встреча / бонус
  const PARTS = {
    materials: { meta: 'МАТЕРИАЛЫ МОДУЛЯ', title: 'Материалы', icon: '📦', body: mod.materials },
    homework:  { meta: 'ДОМАШНЕЕ ЗАДАНИЕ',  title: 'Домашка',   icon: '✓', body: mod.homework },
    meetup:    { meta: 'МАСТЕР-КЛАСС',      title: mod.meetup?.title || 'Встреча', icon: '★', body: mod.meetup ? `${mod.meetup.desc} · <strong>${mod.meetup.date}</strong>` : '' },
    bonus:     { meta: 'БОНУС',             title: mod.bonus?.title || 'Бонус', icon: '🎁', body: mod.bonus?.desc || '' },
  };
  const p = PARTS[partRaw];
  if (!p) { root.innerHTML = '<div class="empty">не найдено</div>'; return; }
  root.innerHTML = `
    <div class="page-meta">${mod.id.toUpperCase()} · ${p.meta}</div>
    <h1 class="page-h1">${p.icon} ${escapeHtml(p.title)}</h1>
    <div class="page-lead">${p.body || '—'}</div>
    <div class="course-placeholder">
      <div class="course-placeholder-icon">📝</div>
      <div class="course-placeholder-title">Файлы и материалы готовятся</div>
      <div class="course-placeholder-desc">Полная подборка появится здесь после старта модуля. Следи за обновлениями на <a href="https://analitik.kiselevgroup.com/vibecoding" target="_blank">analitik.kiselevgroup.com/vibecoding</a>.</div>
    </div>
  `;
}

// ── View tab switcher (VS CODE / Проекты / Курс / Материалы) ──
function setActiveView(view) {
  const allowed = ['projects', 'kb', 'myvibe', 'claude-pay'];
  if (!allowed.includes(view)) view = 'projects';
  localStorage.setItem('vibe.view', view);
  $$('.btn-nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(s => s.classList.toggle('hidden', s.dataset.view !== view));
  // подгрузка контента view-зависимо
  if (view === 'kb') window.renderKb && window.renderKb();
}

async function refreshAll() {
  await Promise.all([
    refreshContainerStatus(),
    refreshProjects(),
    refreshTemplates(),
    ME?.isAdmin ? refreshUsers() : Promise.resolve(),
    ME?.isAdmin ? refreshClaudeUsage() : Promise.resolve(),
    refreshClaudeStatus(),
  ]);
}

// ── Виджет «Лимиты Claude» (admin) ─────────────────────────
// Проценты лимитов подписки общего аккаунта (то же, что «Account & Usage» в
// расширении VS Code). Данные — /api/claude-usage → шим (кэш 60с на его стороне).

function fmtResetIn(iso) {
  if (!iso) return '';
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return 'сброс скоро';
  const min = Math.round(ms / 60000);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const left = d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
  const at = new Date(iso).toLocaleString('ru-RU', d
    ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
  return `сброс через ${left} · ${at}`;
}

let usageLoading = false;
async function refreshClaudeUsage() {
  const body = $('#usageBody');
  if (!body || usageLoading) return;
  usageLoading = true;
  $('#usageRefresh')?.classList.add('spin');
  try {
    const u = await api('/api/claude-usage');
    $('#usagePlan').textContent = u.subscriptionType || '';
    body.innerHTML = u.limits?.length ? u.limits.map(l => {
      const pct = Math.max(0, Math.min(100, Math.round(l.percent)));
      const cls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';
      return `<div class="usage-row">
        <div class="usage-row-top">
          <span class="usage-row-label">${escapeHtml(l.label)}</span>
          <span class="usage-row-pct">${pct}%</span>
        </div>
        <div class="usage-bar"><div class="usage-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="usage-row-reset">${escapeHtml(fmtResetIn(l.resetsAt))}</div>
      </div>`;
    }).join('') : '<div class="usage-widget-hint">Нет данных о лимитах</div>';
    const t = new Date(u.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    $('#usageFoot').textContent = `обновлено ${t}${u.stale ? ' · устарело, Anthropic не ответил' : ''}`;
  } catch (e) {
    if (e.message === 'unauthorized') return;
    body.innerHTML = `<div class="usage-widget-hint error">Не удалось загрузить: ${escapeHtml(e.message)}</div>`;
  } finally {
    usageLoading = false;
    $('#usageRefresh')?.classList.remove('spin');
  }
}

$('#usageRefresh')?.addEventListener('click', refreshClaudeUsage);
// раз в минуту, только пока админ смотрит на вкладку «Проекты»
setInterval(() => {
  if (ME?.isAdmin && document.visibilityState === 'visible'
      && !$('.view-projects')?.classList.contains('hidden')) refreshClaudeUsage();
}, 60_000);

// ── Статус Claude (status.claude.com) ──────────────────────
// Чип в навбаре + модалка с сервисами и активными инцидентами. Видят все
// залогиненные. Данные — /api/claude-status (кэш 60с на стороне панели).

const CS_COMPONENT_LABEL = {
  operational: 'работает',
  degraded_performance: 'деградация',
  partial_outage: 'частичный сбой',
  major_outage: 'серьёзный сбой',
  under_maintenance: 'обслуживание',
};
const CS_INDICATOR_LABEL = {
  none: 'Всё работает',
  minor: 'Есть проблемы',
  major: 'Серьёзный сбой',
  critical: 'Критический сбой',
  maintenance: 'Обслуживание',
};
// уровень компонента → класс цвета (ok / warn / bad / maint)
const csLevel = (st) => st === 'operational' ? 'ok'
  : st === 'under_maintenance' ? 'maint'
  : st === 'major_outage' ? 'bad' : 'warn';
const csIndLevel = (ind) => ind === 'none' ? 'ok'
  : ind === 'maintenance' ? 'maint'
  : ind === 'major' || ind === 'critical' ? 'bad' : 'warn';

const fmtDt = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '';

let CLAUDE_STATUS = null;
let csLoading = false;

function renderClaudeStatusChip(err) {
  const btn = $('#claudeStatusBtn');
  if (!btn) return;
  if (err && !CLAUDE_STATUS) {
    btn.dataset.ind = 'unknown';
    btn.title = 'Статус Claude: не удалось получить (' + err + ')';
    return;
  }
  const s = CLAUDE_STATUS;
  const bad = s.components.filter(c => c.status !== 'operational');
  const lvl = s.incidents.length && s.indicator === 'none' ? 'warn' : csIndLevel(s.indicator);
  btn.dataset.ind = lvl;
  btn.title = `Статус Claude: ${CS_INDICATOR_LABEL[s.indicator] || s.description}`
    + (bad.length ? ` — ${bad.map(c => c.name).join(', ')}` : '');
}

function renderClaudeStatusModal(err) {
  const body = $('#csBody');
  if (!body) return;
  const s = CLAUDE_STATUS;
  if (!s) {
    body.innerHTML = err
      ? `<div class="usage-widget-hint error">Не удалось загрузить: ${escapeHtml(err)}</div>`
      : '<div class="usage-widget-hint">Загрузка…</div>';
    return;
  }
  $('#csChecked').textContent = `Проверено: ${fmtDt(s.fetchedAt)}${s.stale ? ' · устарело, status.claude.com не ответил' : ''}`;

  const bad = s.components.filter(c => c.status !== 'operational');
  const ok = s.components.filter(c => c.status === 'operational');
  const lvl = s.incidents.length && s.indicator === 'none' ? 'warn' : csIndLevel(s.indicator);
  const row = (c) => `<div class="cs-comp" data-lvl="${csLevel(c.status)}">
      <span class="cs-ico"></span><span class="cs-comp-name">${escapeHtml(c.name)}</span>
      ${c.status !== 'operational' ? `<span class="cs-comp-st">${escapeHtml(CS_COMPONENT_LABEL[c.status] || c.status)}</span>` : ''}
    </div>`;

  const summary = bad.length
    ? `${bad.length} ${bad.length === 1 ? 'служба' : bad.length < 5 ? 'службы' : 'служб'} с проблемой из ${s.components.length}`
    : `все ${s.components.length} служб работают`;

  const incidents = s.incidents.map(i => `
    <div class="cs-inc" data-lvl="${i.impact === 'major' || i.impact === 'critical' ? 'bad' : 'warn'}">
      <div class="cs-inc-head">
        <span class="cs-ico"></span>
        <div class="cs-inc-title">
          <div class="cs-inc-name">${escapeHtml(i.name)}</div>
          <div class="cs-sub">Обновлено ${fmtDt(i.updatedAt)}</div>
        </div>
        <a class="cs-link" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">Источник ↗</a>
      </div>
      ${i.components.length ? `<div class="cs-inc-aff"><b>Затронуто:</b> ${escapeHtml(i.components.join(', '))}</div>` : ''}
      ${i.updates.map(u => `<div class="cs-upd">
        <div class="cs-sub">${fmtDt(u.at)} · ${escapeHtml(u.status)}</div>
        <div class="cs-upd-body">${escapeHtml(u.body)}</div>
      </div>`).join('')}
    </div>`).join('');

  const maint = s.maintenances.map(m => `<div class="cs-comp" data-lvl="maint">
      <span class="cs-ico"></span>
      <a class="cs-comp-name cs-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.name)}</a>
      <span class="cs-comp-st">${fmtDt(m.scheduledFor)} – ${fmtDt(m.scheduledUntil)}</span>
    </div>`).join('');

  body.innerHTML = `
    <div class="cs-card" data-lvl="${lvl}">
      <div class="cs-card-head">
        <span class="cs-logo">✻</span>
        <div class="cs-card-title">
          <div class="cs-card-name">Claude</div>
          <div class="cs-sub">${summary} · обновлено ${fmtDt(s.updatedAt)}</div>
        </div>
        <span class="cs-badge" data-lvl="${lvl}"><span class="cs-ico"></span>${escapeHtml(CS_INDICATOR_LABEL[s.indicator] || s.description)}</span>
        <a class="cs-link" href="${escapeHtml(s.pageUrl)}" target="_blank" rel="noopener">Официальный статус ↗</a>
      </div>
      ${bad.length ? `<div class="cs-grid">${bad.map(row).join('')}</div>` : ''}
      ${ok.length ? (bad.length
        ? `<details class="cs-rest"><summary>Остальные службы (${ok.length})</summary><div class="cs-grid">${ok.map(row).join('')}</div></details>`
        : `<div class="cs-grid">${ok.map(row).join('')}</div>`) : ''}
      ${s.incidents.length ? `<div class="cs-section">${s.incidents.length > 1 ? 'Активные инциденты' : 'Активный инцидент'}</div>${incidents}` : ''}
      ${s.maintenances.length ? `<div class="cs-section">Плановое обслуживание</div><div class="cs-grid cs-grid-1">${maint}</div>` : ''}
    </div>`;
}

async function refreshClaudeStatus() {
  if (csLoading || !ME) return;
  csLoading = true;
  let err = null;
  try {
    CLAUDE_STATUS = await api('/api/claude-status');
  } catch (e) {
    if (e.message === 'unauthorized') { csLoading = false; return; }
    err = e.message;
  } finally {
    csLoading = false;
  }
  renderClaudeStatusChip(err);
  if (!$('#modal-claude-status')?.classList.contains('hidden')) renderClaudeStatusModal(err);
}

$('#claudeStatusBtn')?.addEventListener('click', () => {
  renderClaudeStatusModal();
  openModal('modal-claude-status');
  refreshClaudeStatus();
});
// раз в 2 минуты, пока вкладка видима
setInterval(() => {
  if (ME && document.visibilityState === 'visible') refreshClaudeStatus();
}, 120_000);

// ── Container ──────────────────────────────────────────────

async function refreshContainerStatus() {
  try {
    const me = await api('/api/me');
    ME = { ...ME, ...me };
  } catch {}
}

// Открыть VS Code: если контейнер не running — показать модалку, запустить,
// дождаться, потом открыть в новой вкладке. Это убирает «открылось но недоступно».
async function openVsCodeFor(username, folder = null) {
  const url = `/code/${encodeURIComponent(username)}/`
    + (folder ? `?folder=${encodeURIComponent(folder)}` : '');
  const isOwn = ME && ME.username === username;
  const needsStart = isOwn && ME.container && !ME.container.running;
  if (!needsStart) {
    window.open(url, '_blank');
    return;
  }
  $('#container-start-error').classList.add('hidden');
  openModal('modal-container-starting');
  try {
    // Docker создаёт/запускает контейнер. На холодный create — пару секунд.
    await api('/api/container/start', { method: 'POST' });
    // Опросим статус пару раз чтобы убедиться что точно running
    for (let i = 0; i < 10; i++) {
      const me = await api('/api/me');
      if (me.container?.running) { ME = { ...ME, ...me }; break; }
      await new Promise(r => setTimeout(r, 400));
    }
    // Доп. пауза — code-server иногда лезет на TCP не сразу после docker start
    await new Promise(r => setTimeout(r, 600));
    closeModal('modal-container-starting');
    refreshContainerStatus();
    window.open(url, '_blank');
  } catch (e) {
    const err = $('#container-start-error');
    err.textContent = 'Не удалось запустить контейнер: ' + e.message;
    err.classList.remove('hidden');
    setTimeout(() => closeModal('modal-container-starting'), 3000);
  }
}

// ── Projects / templates ───────────────────────────────────

async function refreshProjects() {
  try {
    const { projects } = await api('/api/projects');
    $('#projectsCount').textContent = projects.length;
    const wrap = $('#projectsList');
    if (!projects.length) {
      wrap.innerHTML = '<div class="empty">пока пусто — создай проект из шаблона</div>';
      return;
    }
    // Сортируем по дате создания (новые сверху).
    projects.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));

    const folderInVs = (name) => `/code/${encodeURIComponent(ME.username)}/?folder=${encodeURIComponent(ME.homeDir + '/' + name)}`;
    const statusClass = (s) => /боёвой|рабочий/i.test(s) ? 'status-prod' : (s === 'НОВЫЙ' ? 'status-new' : 'status-other');
    const typeClass = (t) => t === 'АГЕНТ' ? 'type-agent' : (t === 'ПРОЕКТ' ? 'type-project' : '');

    // Группировка по разделам (.portal-meta.json → section). Разделы — заголовки-
    // разделители, всегда развёрнуты; без раздела — плоский список без заголовка
    // (или с приглушённым «Без раздела», если разделы вообще есть).
    const NEW_SECTION = '__new_section__';
    const sectionNames = [...new Set(projects.map(p => p.section).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const groups = sectionNames.map(name => ({ name, items: projects.filter(p => p.section === name) }));
    const rest = projects.filter(p => !p.section);
    if (rest.length) groups.push({ name: null, items: rest });

    const rowHtml = (p) => `
      <tr data-project="${escapeHtml(p.name)}">
        <td><span class="pill pill-type ${typeClass(p.type)}">${escapeHtml(p.type)}</span></td>
        <td><span class="pill ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
        <td class="td-name">${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.owner)}</td>
        <td>${fmtDate(p.modified)}</td>
        <td class="td-section">
          <select class="section-select" data-project="${escapeHtml(p.name)}">
            <option value="">— без раздела —</option>
            ${sectionNames.map(s => `<option value="${escapeHtml(s)}" ${p.section === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            <option value="${NEW_SECTION}">+ новый раздел…</option>
          </select>
        </td>
        <td class="td-actions">
          <div class="actions">
          <button class="btn btn-sm" data-action="files" title="Файлы">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="btn btn-sm" data-action="claude" title="Claude">CLAUDE</button>
          <button class="btn btn-sm" data-action="vscode">VS Code →</button>
          <button class="btn btn-sm" data-action="vscode-desktop" title="Открыть в десктопном VS Code (по SSH)">💻</button>
          <button class="btn btn-sm" data-action="download" title="Скачать проект (.zip)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="btn btn-sm btn-danger" data-action="delete" title="Удалить">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          </button>
          </div>
        </td>
      </tr>`;

    const groupHtml = (g) => {
      let header = '';
      if (g.name !== null) {
        header = `
          <tr class="section-header-row">
            <td colspan="7">
              <span class="section-header" data-section="${escapeHtml(g.name)}">${escapeHtml(g.name)}</span>
              <button class="btn btn-sm section-rename" data-section="${escapeHtml(g.name)}" title="Переименовать раздел">✎</button>
            </td>
          </tr>`;
      } else if (sectionNames.length) {
        header = `
          <tr class="section-header-row">
            <td colspan="7"><span class="section-header section-header-muted">Без раздела</span></td>
          </tr>`;
      }
      return header + g.items.map(rowHtml).join('');
    };

    wrap.innerHTML = `
      <table class="projects-table">
        <thead>
          <tr>
            <th class="th-type">Тип</th>
            <th class="th-status">Статус</th>
            <th class="th-name">Название</th>
            <th class="th-owner">Автор</th>
            <th class="th-date">Дата</th>
            <th class="th-section">Раздел</th>
            <th class="th-actions">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${groups.map(groupHtml).join('')}
        </tbody>
      </table>
    `;
    const setSection = async (name, section) => {
      try {
        await api('/api/projects/' + encodeURIComponent(name) + '/section', {
          method: 'POST', body: { section },
        });
        refreshProjects();
      } catch (e) { alert(e.message); refreshProjects(); }
    };
    $$('.section-select', wrap).forEach(sel => {
      sel.onchange = () => {
        const name = sel.dataset.project;
        if (sel.value === NEW_SECTION) {
          const title = prompt('Название нового раздела:');
          if (title && title.trim()) setSection(name, title.trim());
          else refreshProjects();
          return;
        }
        setSection(name, sel.value || null);
      };
    });
    $$('.section-rename', wrap).forEach(btn => {
      btn.onclick = async () => {
        const oldName = btn.dataset.section;
        const title = prompt('Новое название раздела:', oldName);
        if (!title || !title.trim() || title.trim() === oldName) return;
        const members = projects.filter(p => p.section === oldName).map(p => p.name);
        try {
          await Promise.all(members.map(name =>
            api('/api/projects/' + encodeURIComponent(name) + '/section', {
              method: 'POST', body: { section: title.trim() },
            })
          ));
        } catch (e) { alert(e.message); }
        refreshProjects();
      };
    });
    $$('tbody tr', wrap).forEach(tr => {
      const name = tr.dataset.project;
      if (!name) return;
      $('[data-action="files"]', tr).onclick = () => openExplorer(name);
      $('[data-action="claude"]', tr).onclick = () => openProjectChat(name);
      $('[data-action="vscode"]', tr).onclick = () =>
        openVsCodeFor(ME.username, ME.homeDir + '/' + name);
      $('[data-action="vscode-desktop"]', tr).onclick = () => openDesktopVsCode(name);
      $('[data-action="download"]', tr).onclick = () => {
        window.location.href = '/api/projects/' + encodeURIComponent(name) + '/download';
      };
      $('[data-action="delete"]', tr).onclick = async () => {
        if (!confirm(`Удалить проект «${name}»? Он переедет в Корзину (🗑 Корзина сверху) на 30 дней, потом будет стёрт навсегда.`)) return;
        try {
          await api('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' });
          refreshProjects();
        } catch (e) { alert(e.message); }
      };
    });
  } catch {}
}

// ── Корзина (удалённые проекты) ─────────────────────────────

async function refreshTrash() {
  const wrap = $('#trash-list');
  wrap.innerHTML = '<div class="empty">загрузка…</div>';
  $('#trash-purge-all').disabled = true;
  try {
    const { items, retentionDays } = await api('/api/trash');
    $('#trash-retention-days').textContent = retentionDays;
    $('#trash-purge-all').disabled = !items.length;
    if (!items.length) {
      wrap.innerHTML = '<div class="empty">корзина пуста</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="projects-table">
        <thead>
          <tr>
            <th class="th-name">Проект</th>
            <th>Удалён</th>
            <th>Осталось</th>
            <th class="th-actions">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr data-id="${escapeHtml(it.id)}">
              <td class="td-name">${escapeHtml(it.name)}</td>
              <td>${fmtDate(it.deletedAt)}</td>
              <td>${it.daysLeft} дн.</td>
              <td class="td-actions">
                <div class="actions">
                  <button class="btn btn-sm" data-action="restore">Восстановить</button>
                  <button class="btn btn-sm btn-danger" data-action="purge">Удалить навсегда</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    $$('tbody tr', wrap).forEach(row => {
      const id = row.dataset.id;
      $('[data-action="restore"]', row).onclick = async () => {
        try {
          await api('/api/trash/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
          refreshTrash();
          refreshProjects();
        } catch (e) { alert(e.message); }
      };
      $('[data-action="purge"]', row).onclick = async () => {
        if (!confirm('Удалить проект из корзины навсегда? Это нельзя отменить.')) return;
        try {
          await api('/api/trash/' + encodeURIComponent(id), { method: 'DELETE' });
          refreshTrash();
        } catch (e) { alert(e.message); }
      };
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty">не удалось загрузить: ${escapeHtml(e.message)}</div>`;
  }
}


// ── File explorer ──────────────────────────────────────────

// kind = 'project' | 'template'
async function openExplorer(name, kind = 'project') {
  const overlay = $('#explorer-overlay');
  overlay.dataset.name = name;
  overlay.dataset.kind = kind;

  const isTpl = kind === 'template';
  const folderInside = isTpl
    ? `/home/student/templates/${name}`
    : `${ME.homeDir}/${name}`;
  $('#explorer-path').textContent = folderInside + '/';
  // VS Code открывает контейнер залогиненного юзера, для шаблонов — read-only mount.
  $('#explorer-open-vscode').href =
    `/code/${encodeURIComponent(ME.username)}/?folder=${encodeURIComponent(folderInside)}`;

  $('#explorer-tree').innerHTML = '<div class="explorer-loading">загрузка…</div>';
  $('#explorer-view-path').textContent = '← Выберите файл';
  $('#explorer-view-size').textContent = '';
  $('#explorer-view-pre').textContent = '';
  overlay.classList.remove('hidden');
  document.body.classList.add('has-explorer');

  const treeUrl = isTpl
    ? '/api/explore/tree?kind=template&template=' + encodeURIComponent(name)
    : '/api/explore/tree?project=' + encodeURIComponent(name);
  try {
    const { tree } = await api(treeUrl);
    $('#explorer-tree').innerHTML = renderTree(tree, '', true);
    $$('.explorer-node-file', $('#explorer-tree')).forEach(el => {
      el.onclick = () => loadFile(el.dataset.path);
    });
    $$('.explorer-node-dir', $('#explorer-tree')).forEach(el => {
      el.onclick = () => el.parentElement.classList.toggle('collapsed');
    });
  } catch (e) {
    $('#explorer-tree').innerHTML = `<div class="empty">ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

function renderTree(nodes, parentPath, isRoot = false) {
  if (!nodes.length) return isRoot ? '<div class="empty">пусто</div>' : '';
  return '<ul class="explorer-tree-list">' + nodes.map(n => {
    const p = parentPath ? `${parentPath}/${n.name}` : n.name;
    if (n.type === 'dir') {
      return `
        <li class="explorer-tree-item collapsed">
          <div class="explorer-node-dir" data-path="${escapeHtml(p)}">
            <span class="explorer-icon-caret">▸</span>
            <span class="explorer-name">${escapeHtml(n.name)}/</span>
          </div>
          ${renderTree(n.children || [], p)}
        </li>
      `;
    }
    return `
      <li class="explorer-tree-item">
        <div class="explorer-node-file" data-path="${escapeHtml(p)}">
          <span class="explorer-name">${escapeHtml(n.name)}</span>
        </div>
      </li>
    `;
  }).join('') + '</ul>';
}

async function loadFile(relPath) {
  const overlay = $('#explorer-overlay');
  const name = overlay.dataset.name;
  const kind = overlay.dataset.kind || 'project';
  $('#explorer-view-path').textContent = relPath;
  $('#explorer-view-size').textContent = '…';
  $('#explorer-view-pre').textContent = '';
  $$('.explorer-node-file.active', $('#explorer-tree')).forEach(el => el.classList.remove('active'));
  const node = $(`.explorer-node-file[data-path="${CSS.escape(relPath)}"]`, $('#explorer-tree'));
  if (node) node.classList.add('active');
  const fileUrl = kind === 'template'
    ? '/api/explore/file?kind=template&template=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(relPath)
    : '/api/explore/file?project=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(relPath);
  try {
    const data = await api(fileUrl);
    const sizeKb = (data.size / 1024).toFixed(1);
    if (data.binary) {
      $('#explorer-view-size').textContent = `бинарь, ${sizeKb} КБ`;
      $('#explorer-view-pre').textContent = '— бинарный файл, не отображаем —';
    } else if (data.truncated) {
      $('#explorer-view-size').textContent = `${sizeKb} КБ (>200 КБ, не показано)`;
      $('#explorer-view-pre').textContent = '— файл слишком большой, не отображаем —';
    } else {
      $('#explorer-view-size').textContent = `${sizeKb} КБ`;
      $('#explorer-view-pre').textContent = data.content;
    }
  } catch (e) {
    $('#explorer-view-size').textContent = '';
    $('#explorer-view-pre').textContent = 'ошибка: ' + e.message;
  }
}

async function refreshTemplates() {
  try {
    const { templates } = await api('/api/templates');
    const grid = $('#templatesList');
    if (!templates.length) {
      grid.innerHTML = '<div class="empty">шаблоны пока не загружены</div>';
      return;
    }
    grid.innerHTML = templates.map(t => `
      <div class="template-card">
        <div class="t-name">${escapeHtml(t.name)}</div>
        <div class="t-desc">${escapeHtml(t.description) || ' '}</div>
        <div class="t-actions">
          <button class="btn btn-sm" data-tpl-files="${escapeHtml(t.name)}">Файлы</button>
          <button class="btn btn-primary btn-sm" data-tpl="${escapeHtml(t.name)}">Создать проект →</button>
        </div>
      </div>
    `).join('');
    $$('[data-tpl]', grid).forEach(b => {
      b.onclick = () => {
        $('#newproject-tpl').value = b.dataset.tpl;
        $('#newproject-name').value = '';
        $('#newproject-error').classList.add('hidden');
        openModal('modal-newproject');
        setTimeout(() => $('#newproject-name').focus(), 30);
      };
    });
    $$('[data-tpl-files]', grid).forEach(b => {
      b.onclick = () => openExplorer(b.dataset.tplFiles, 'template');
    });
  } catch {}
}

// ── Users (admin) ──────────────────────────────────────────

async function refreshUsers() {
  try {
    const { students } = await api('/api/students');
    const list = $('#users-list');
    if (!students.length) {
      list.innerHTML = '<div class="user-row-empty">учеников ещё нет — нажми «+ Добавить»</div>';
      return;
    }
    list.innerHTML = students.map(s => {
      const hasLimit   = s.spendLimitUsd > 0;
      const totalUsed  = s.spendUsedUsd    || 0;
      const dayUsed    = s.spendUsedDayUsd || 0;
      const isDay      = s.tokenPeriod === 'day';
      const usedForPeriod = isDay ? dayUsed : totalUsed;
      const over       = hasLimit && usedForPeriod >= s.spendLimitUsd;
      let spendChip    = '';
      if (hasLimit) {
        const pct   = Math.min(100, Math.round(usedForPeriod / s.spendLimitUsd * 100));
        const color = over ? 'var(--destructive)' : '#3b82f6';
        spendChip = `<span class="spend-chip" style="color:${color}" title="${isDay ? 'в день' : 'всего'}: $${usedForPeriod.toFixed(4)} / $${s.spendLimitUsd}">$${usedForPeriod.toFixed(2)}/$${s.spendLimitUsd} (${pct}%)</span>`;
      } else if (totalUsed > 0) {
        spendChip = `<span class="spend-chip" style="color:hsl(var(--muted-foreground))" title="нет лимита · потрачено всего: $${totalUsed.toFixed(4)}">$${totalUsed.toFixed(4)}</span>`;
      }
      return `
      <div class="user-row">
        <div class="user-row-name">
          ${escapeHtml(s.username)}${spendChip}
          <div class="user-row-meta">
            создан ${fmtDate(s.createdAt)} · порт ${s.containerPort || '—'}
            · активность ${fmtDate(s.lastActivityAt)}
          </div>
        </div>
        <div class="user-row-actions">
          <span class="user-role-pill ${s.role === 'admin' ? 'role-admin' : ''}">${escapeHtml(s.role)}</span>
          <button class="user-row-limit" data-limit="${escapeHtml(s.username)}"
            data-limit-usd="${s.spendLimitUsd || ''}"
            data-limit-period="${s.tokenPeriod || 'total'}"
            data-limit-used="${totalUsed.toFixed(6)}"
            data-limit-used-day="${dayUsed.toFixed(6)}">Лимит</button>
          <button class="user-row-pwd" data-pwd="${escapeHtml(s.username)}">Пароль</button>
          ${s.username !== ME.username
            ? `<button class="user-row-del" data-del="${escapeHtml(s.username)}">Удалить</button>`
            : ''}
        </div>
      </div>`;
    }).join('');
    $$('[data-del]', list).forEach(b => {
      b.onclick = () => openDeleteStudentModal(b.dataset.del);
    });
    $$('[data-pwd]', list).forEach(b => {
      b.onclick = () => openResetPasswordModal(b.dataset.pwd);
    });
    $$('[data-limit]', list).forEach(b => {
      b.onclick = () => openSpendLimitModal(b.dataset.limit, {
        limitUsd: b.dataset.limitUsd,
        period:   b.dataset.limitPeriod,
        usedTotal: parseFloat(b.dataset.limitUsed   || '0'),
        usedDay:   parseFloat(b.dataset.limitUsedDay || '0'),
      });
    });
  } catch {}
}

// ── Theme toggle ───────────────────────────────────────────

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('aif-theme', isDark ? 'dark' : 'light');
}

// ── Login flow ─────────────────────────────────────────────

async function doLogin() {
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const err = $('#login-error');
  err.classList.add('hidden');
  try {
    await api('/api/login', { method: 'POST', body: { username, password } });
    ME = await api('/api/me');
    closeModal('modal-login');
    $('#login-password').value = '';
    renderAuth();
  } catch (e) {
    err.textContent = e.message === 'unauthorized' || /invalid/i.test(e.message)
      ? 'Неверный логин или пароль' : e.message;
    err.classList.remove('hidden');
  }
}

function openSpendLimitModal(username, { limitUsd, period, usedTotal, usedDay }) {
  $('#sl-student-name').textContent = username;
  $('#sl-limit').value  = limitUsd || '';
  $('#sl-period').value = period   || 'total';
  const usedEl = $('#sl-used-info');
  usedEl.textContent = `Потрачено: всего $${(usedTotal || 0).toFixed(4)} · сегодня $${(usedDay || 0).toFixed(4)}`;
  $('#sl-error').classList.add('hidden');
  $('#sl-success').classList.add('hidden');
  $('#modal-spend-limit').dataset.target = username;
  openModal('modal-spend-limit');
}

async function doSetSpendLimit() {
  const username = $('#modal-spend-limit').dataset.target;
  const err = $('#sl-error');
  err.classList.add('hidden');
  $('#sl-success').classList.add('hidden');
  const limitVal  = $('#sl-limit').value.trim();
  const periodVal = $('#sl-period').value;
  const body = {
    spendLimitUsd: limitVal === '' ? 0 : parseFloat(limitVal),
    tokenPeriod:   periodVal,
  };
  if (limitVal !== '' && (isNaN(body.spendLimitUsd) || body.spendLimitUsd < 0)) {
    err.textContent = 'Введите корректную сумму в $';
    err.classList.remove('hidden');
    return;
  }
  try {
    await api('/api/students/' + encodeURIComponent(username), { method: 'PATCH', body });
    $('#sl-success').classList.remove('hidden');
    refreshUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

async function doResetSpendLimit() {
  const username = $('#modal-spend-limit').dataset.target;
  const err = $('#sl-error');
  err.classList.add('hidden');
  try {
    await api('/api/students/' + encodeURIComponent(username) + '/token-usage/reset', { method: 'POST' });
    $('#sl-used-info').textContent = 'Потрачено: всего $0.0000 · сегодня $0.0000';
    $('#sl-success').textContent = 'Счётчик сброшен.';
    $('#sl-success').classList.remove('hidden');
    refreshUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

function openDeleteStudentModal(username) {
  $('#del-student-name').textContent = username;
  $('#del-student-error').classList.add('hidden');
  $('#modal-delete-student').dataset.target = username;
  openModal('modal-delete-student');
}

async function doDeleteStudent() {
  const username = $('#modal-delete-student').dataset.target;
  const err = $('#del-student-error');
  err.classList.add('hidden');
  if (!username) return;
  try {
    await api('/api/students/' + encodeURIComponent(username), { method: 'DELETE' });
    closeModal('modal-delete-student');
    refreshUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

function openResetPasswordModal(username) {
  $('#rp-student-name').textContent = username;
  $('#modal-reset-password').dataset.target = username;
  $('#rp-password').value = generatePassword();
  $('#rp-error').classList.add('hidden');
  $('#rp-success-group').classList.add('hidden');
  openModal('modal-reset-password');
  setTimeout(() => $('#rp-password').focus(), 30);
}

async function doResetPassword() {
  const username = $('#modal-reset-password').dataset.target;
  const password = $('#rp-password').value;
  const err = $('#rp-error');
  err.classList.add('hidden');
  $('#rp-success-group').classList.add('hidden');
  if (!username) return;
  try {
    await api('/api/students/' + encodeURIComponent(username) + '/password',
      { method: 'POST', body: { password } });
    // Модалку не закрываем — пароль виден в поле, чтобы admin его передал.
    $('#rp-success-group').classList.remove('hidden');
  } catch (e) {
    err.textContent = e.message === 'password too short'
      ? 'Пароль слишком короткий (минимум 6 символов)' : e.message;
    err.classList.remove('hidden');
  }
}

async function doAddUser() {
  const username = $('#new-username').value.trim();
  const password = $('#new-password').value;
  const role     = $('#new-role').value;
  const err = $('#add-user-error');
  err.classList.add('hidden');
  try {
    await api('/api/students', { method: 'POST', body: { username, password, role } });
    closeModal('modal-add-user');
    $('#new-username').value = '';
    $('#new-password').value = '';
    refreshUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

async function doCreateEmpty() {
  const name = $('#empty-name').value.trim();
  const err = $('#empty-error');
  err.classList.add('hidden');
  try {
    await api('/api/projects/empty', { method: 'POST', body: { name } });
    closeModal('modal-empty');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

// ── «+ Свой проект»: загрузка папки с компа (webkitdirectory) ──
const UPLOAD_SKIP = (rel) => /(^|\/)(node_modules|\.git)(\/|$)/.test(rel);

function pickedUploadFiles() {
  const inp = $('#upload-folder');
  return Array.from(inp.files || []).filter(f => !UPLOAD_SKIP(f.webkitRelativePath || f.name));
}

function updateUploadInfo() {
  const files = pickedUploadFiles();
  const info = $('#upload-info');
  if (!files.length) {
    info.textContent = 'node_modules и .git не загружаются — сделай npm install внутри VS Code.';
    return;
  }
  // Автоподстановка имени проекта из имени выбранной папки
  const nameInp = $('#upload-name');
  const top = (files[0].webkitRelativePath || '').split('/')[0];
  if (!nameInp.value && top) {
    const slug = top.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    if (/^[a-z]/.test(slug)) nameInp.value = slug;
  }
  const bytes = files.reduce((a, f) => a + f.size, 0);
  info.textContent = `${files.length} файлов · ${pcFmtSize(bytes)} (без node_modules/.git)`;
}

async function doUploadProject() {
  const name = $('#upload-name').value.trim();
  const err = $('#upload-error');
  err.classList.add('hidden');
  const files = pickedUploadFiles();
  if (!/^[a-z][a-z0-9_-]{1,50}$/i.test(name)) {
    err.textContent = 'Имя: a-z, 0-9, дефис, подчёркивание (с буквы).';
    err.classList.remove('hidden'); return;
  }
  if (!files.length) {
    err.textContent = 'Выбери папку с файлами.';
    err.classList.remove('hidden'); return;
  }
  const MAX = 90 * 1024 * 1024;
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX) {
    err.textContent = `Слишком большой объём (${pcFmtSize(total)}). Лимит 90 MB — убери лишнее.`;
    err.classList.remove('hidden'); return;
  }
  const btn = $('#upload-submit');
  const oldLabel = btn.textContent;
  const wrap = $('#upload-progress-wrap');
  const fill = $('#upload-progress-fill');
  const label = $('#upload-progress-label');
  btn.disabled = true; btn.textContent = 'Загрузка…';
  fill.style.width = '0%';
  label.textContent = '0%';
  wrap.classList.remove('hidden');
  try {
    const fd = new FormData();
    fd.append('name', name);
    // Путь передаём отдельным полем — браузеры срезают слеши из filename в Content-Disposition.
    for (const f of files) {
      fd.append('files', f);
      fd.append('paths', f.webkitRelativePath || f.name);
    }
    // fetch не отдаёт событий прогресса загрузки тела запроса — только XHR даёт upload.onprogress.
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/projects/upload');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        const pct = Math.round((ev.loaded / ev.total) * 100);
        fill.style.width = pct + '%';
        label.textContent = pct + '%';
      };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Ошибка сети'));
      xhr.send(fd);
    });
    void data;
    closeModal('modal-upload');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = oldLabel;
    wrap.classList.add('hidden');
  }
}

let createSelectedTemplate = null;
async function openCreateModal() {
  createSelectedTemplate = null;
  $('#create-name').value = '';
  $('#create-error').classList.add('hidden');
  const wrap = $('#create-templates');
  wrap.innerHTML = '<div class="empty">загрузка…</div>';
  openModal('modal-create');
  try {
    const { templates } = await api('/api/templates/base');
    if (!templates.length) {
      wrap.innerHTML = '<div class="empty">базовые шаблоны не найдены</div>';
      return;
    }
    wrap.innerHTML = templates.map((t, i) => `
      <button class="template-card-pick${i === 0 ? ' active' : ''}" data-name="${escapeHtml(t.name)}" type="button">
        <div class="t-pick-title">${escapeHtml(t.title || t.name)}</div>
        <div class="t-pick-desc">${escapeHtml(t.description || '')}</div>
        <div class="t-pick-folder">${escapeHtml(t.name)}/</div>
      </button>
    `).join('');
    createSelectedTemplate = templates[0].name;
    $$('.template-card-pick', wrap).forEach(b => {
      b.onclick = () => {
        createSelectedTemplate = b.dataset.name;
        $$('.template-card-pick', wrap).forEach(x => x.classList.toggle('active', x === b));
      };
    });
    setTimeout(() => $('#create-name').focus(), 30);
  } catch (e) {
    wrap.innerHTML = `<div class="empty">ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

async function doCreateFromBase() {
  const name = $('#create-name').value.trim();
  const err = $('#create-error');
  err.classList.add('hidden');
  if (!createSelectedTemplate) {
    err.textContent = 'Выбери шаблон';
    err.classList.remove('hidden');
    return;
  }
  try {
    await api('/api/projects/from-template', {
      method: 'POST',
      body: { template: createSelectedTemplate, name },
    });
    closeModal('modal-create');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

async function doCreateProject() {
  const template = $('#newproject-tpl').value;
  const name = $('#newproject-name').value.trim();
  const err = $('#newproject-error');
  err.classList.add('hidden');
  try {
    await api('/api/projects/from-template', {
      method: 'POST', body: { template, name },
    });
    closeModal('modal-newproject');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  $('#themeToggle').onclick = toggleTheme;

  // Modal close
  $$('[data-close]').forEach(b => {
    b.onclick = () => closeModal(b.dataset.close);
  });
  // Модалы закрываются ТОЛЬКО кнопкой «✕» / «Отмена» — не по клику на фон и не по ESC.
  // (Settings-panel закрывается своим крестиком; ESC тоже не трогаем чтобы не
  //  ловить случайное закрытие при редактировании.)

  // Welcome → open login
  $('#welcomeLoginBtn').onclick = () => {
    $('#login-error').classList.add('hidden');
    $('#login-username').value = '';
    $('#login-password').value = '';
    openModal('modal-login');
    setTimeout(() => $('#login-username').focus(), 30);
  };

  // Login submit (кнопкой + Enter)
  $('#login-submit').onclick = doLogin;
  $('#login-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#login-password').focus(); }
  });
  $('#login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
  });

  // Auth-group → logout
  $('#authBox').onclick = async () => {
    if (!confirm('Выйти?')) return;
    await api('/api/logout', { method: 'POST' });
    ME = null;
    $('#settings-panel').classList.remove('open');
    renderAuth();
  };

  // Settings panel toggle
  $('#settingsBtn').onclick = () => {
    $('#settings-panel').classList.toggle('open');
    if ($('#settings-panel').classList.contains('open')) refreshUsers();
  };
  $('#settings-close').onclick = () => {
    $('#settings-panel').classList.remove('open');
  };

  // VPS РФ — диск сервера (Brainy Waxwing)
  $('#vpsDiskBtn').onclick = async () => {
    openModal('modal-vps-disk');
    $('#vpsDiskFill').style.width = '0%';
    $('#vpsDiskUsed').textContent = '…';
    $('#vpsDiskAvail').textContent = '…';
    $('#vpsDiskTotal').textContent = '…';
    $('#vpsDiskPct').textContent = '…';
    try {
      const { total, used, avail, percent, cpuCount, cpuFrequency, ramMb } = await api('/api/vps-disk');
      const fill = $('#vpsDiskFill');
      fill.style.width = percent + '%';
      fill.classList.toggle('warn', percent >= 80 && percent < 90);
      fill.classList.toggle('danger', percent >= 90);
      $('#vpsDiskUsed').textContent = fmtBytesGb(used);
      $('#vpsDiskAvail').textContent = fmtBytesGb(avail);
      $('#vpsDiskTotal').textContent = fmtBytesGb(total);
      $('#vpsDiskPct').textContent = percent + '%';
      $('#vpsCpuSpec').textContent = cpuCount && cpuFrequency ? `${cpuCount} x ${cpuFrequency} ГГц` : '';
      vpsRamTotalGb = ramMb ? Math.round(ramMb / 1024) : 0;
    } catch (e) {
      $('#vpsDiskUsed').textContent = 'ошибка';
      $('#vpsDiskPct').textContent = e.message;
    }
    loadVpsMetrics(vpsMetricsRange);
  };
  wireInlineSelect('vpsRangeSelect', (value) => loadVpsMetrics(value));
  wireInlineSelect('vpsCpuScaleSelect', (value) => {
    vpsCpuScaleMode = value;
    renderVpsCpuChart(vpsCpuLastPoints, vpsCpuLastRange);
  });

  // Add user
  $('#btn-add-user').onclick = () => {
    $('#new-username').value = '';
    $('#new-password').value = generatePassword();
    $('#new-role').value = 'user';
    $('#add-user-error').classList.add('hidden');
    openModal('modal-add-user');
    setTimeout(() => $('#new-username').focus(), 30);
  };
  $('#add-user-submit').onclick = doAddUser;
  $('#del-student-confirm').onclick = doDeleteStudent;
  $('#sl-submit').onclick = doSetSpendLimit;
  $('#sl-reset').onclick  = doResetSpendLimit;
  $('#rp-submit').onclick = doResetPassword;
  $('#rp-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doResetPassword(); }
  });
  ['new-username', 'new-password'].forEach(id => {
    $('#' + id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doAddUser(); }
    });
  });

  // New project (старая модалка — для секции «Шаблоны» app-*)
  $('#newproject-submit').onclick = doCreateProject;
  $('#newproject-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateProject(); }
  });

  // «+ Свой проект»
  $('#btn-upload').onclick = () => {
    $('#upload-name').value = '';
    $('#upload-folder').value = '';
    $('#upload-error').classList.add('hidden');
    $('#upload-progress-wrap').classList.add('hidden');
    updateUploadInfo();
    openModal('modal-upload');
    setTimeout(() => $('#upload-name').focus(), 30);
  };
  $('#upload-folder').addEventListener('change', updateUploadInfo);
  $('#upload-submit').onclick = doUploadProject;

  // «+ Пустой»
  $('#btn-empty').onclick = () => {
    $('#empty-name').value = '';
    $('#empty-error').classList.add('hidden');
    openModal('modal-empty');
    setTimeout(() => $('#empty-name').focus(), 30);
  };
  $('#empty-submit').onclick = doCreateEmpty;
  $('#empty-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateEmpty(); }
  });

  // «+ Шаблон»
  $('#btn-create').onclick = openCreateModal;
  $('#create-submit').onclick = doCreateFromBase;

  // SSH-доступ (десктопный VS Code)
  $('#btn-ssh')?.addEventListener('click', openSshModal);
  $('#ssh-dl-key')?.addEventListener('click', () => { window.location.href = '/api/ssh-key'; });
  $('#ssh-copy-config')?.addEventListener('click', () => {
    const t = $('#ssh-config-text'); t.select();
    navigator.clipboard?.writeText(t.value).catch(() => {});
  });
  $('#ssh-regen')?.addEventListener('click', doRegenSshKey);

  // Корзина
  $('#btn-trash')?.addEventListener('click', () => { openModal('modal-trash'); refreshTrash(); });
  $('#trash-purge-all')?.addEventListener('click', async () => {
    if (!confirm('Удалить из корзины навсегда ВСЕ проекты? Это нельзя отменить.')) return;
    try {
      await api('/api/trash', { method: 'DELETE' });
      refreshTrash();
    } catch (e) { alert(e.message); }
  });

  // Поп-ап «Открыть проект в VS Code» (кнопка 💻 на проекте)
  $('#pv-open')?.addEventListener('click', () => { if (_pvUri) window.location.href = _pvUri; });
  $('#pv-copy')?.addEventListener('click', (e) => {
    navigator.clipboard?.writeText(_pvPath).catch(() => {});
    const b = e.currentTarget, t = b.textContent;
    b.textContent = '✓ Скопировано'; setTimeout(() => { b.textContent = t; }, 1200);
  });
  // Кастомные дропдауны вместо системных <select> (вся всплывающая часть UI)
  enhanceAllSelects();
  $('#create-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateFromBase(); }
  });

  // Explorer close — скрываем панель и убираем body class чтобы dashboard вернулся
  const closeExplorer = () => {
    $('#explorer-overlay').classList.add('hidden');
    document.body.classList.remove('has-explorer');
  };
  $('#explorer-close').onclick = closeExplorer;

  // Tab switcher (view-таб'ы в centre)
  $$('.btn-nav').forEach(b => {
    b.onclick = () => { closeExplorer(); setActiveView(b.dataset.view); };
  });
  // (подвкладки «Материалов» заменены сайдбаром хаба «База знаний» — см. kb.js)

  // Project chat (left pane)
  $('#btn-close-left').onclick = pcCloseLeft;
  // mode-seg КРАТКО/ПОЛНО
  document.body.classList.toggle('pc-mode-compact', pcState.mode === 'compact');
  $$('.pc-mode-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.mode === pcState.mode);
    b.onclick = () => {
      pcState.mode = b.dataset.mode;
      localStorage.setItem('vibe.pcMode', pcState.mode);
      document.body.classList.toggle('pc-mode-compact', pcState.mode === 'compact');
      $$('.pc-mode-btn').forEach(x => x.classList.toggle('is-active', x.dataset.mode === pcState.mode));
    };
  });
  // Fullscreen toggle
  $('#btn-pc-fullscreen').onclick = () => {
    document.body.classList.toggle('pc-fullscreen');
  };
  // Model dropdown
  $('#pc-model-label').textContent = pcState.model;
  $$('#pc-model-menu .pc-dd-item').forEach(el => {
    el.classList.toggle('active', el.dataset.value === pcState.model);
    el.onclick = () => {
      pcState.model = el.dataset.value;
      localStorage.setItem('vibe.pcModel', pcState.model);
      $('#pc-model-label').textContent = pcState.model;
      $$('#pc-model-menu .pc-dd-item').forEach(x => x.classList.toggle('active', x === el));
      $('#pc-model-dd').classList.remove('open');
    };
  });
  $('#pc-model-btn').onclick = (e) => {
    e.stopPropagation();
    $('#pc-sessions-dd').classList.remove('open');
    $('#pc-model-dd').classList.toggle('open');
  };
  // Attachments
  $('#pc-attach').onclick = () => $('#pc-file-input').click();
  $('#pc-file-input').addEventListener('change', (e) => {
    for (const f of e.target.files) pcUploadFile(f);
    e.target.value = '';
  });
  $('#pc-sessions-btn').onclick = (e) => {
    e.stopPropagation();
    $('#pc-sessions-dd').classList.toggle('open');
  };
  document.addEventListener('click', (e) => {
    if (!$('#pc-sessions-dd').contains(e.target)) $('#pc-sessions-dd').classList.remove('open');
  });
  $('#pc-new-session').onclick = () => {
    pcState.sessionId = null;
    $('#pc-sessions-label').textContent = '— новая —';
    pcClearMessages();
    pcShowEmpty('Новая сессия — напиши первое сообщение.');
    pcEls.input().focus();
  };
  $('#pc-delete-session').onclick = async () => {
    if (!pcState.sessionId) return;
    if (!confirm('Удалить эту сессию? История чата будет потеряна.')) return;
    try {
      const r = await fetch(`/api/project-chat/session/${encodeURIComponent(pcState.sessionId)}?project=${encodeURIComponent(pcState.slug)}`,
        { method: 'DELETE', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'delete failed');
      pcState.sessionId = null;
      await pcLoadSessions();
      pcClearMessages();
      pcShowEmpty('Сессия удалена. Напиши сообщение чтобы начать новую.');
    } catch (e) { alert(e.message); }
  };
  $('#pc-send').onclick = pcSend;
  $('#pc-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pcSend(); }
  });
  $('#pc-input').addEventListener('input', () => {
    const ta = $('#pc-input'); ta.style.height = '';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
  // Вставка картинки/файла из буфера обмена (Ctrl/Cmd+V)
  $('#pc-input').addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) { pcUploadFile(f); e.preventDefault(); break; }
      }
    }
  });

  // Resizers — тяни чтобы изменить ширину левой/правой панелей
  initResizer('#resizer-left', 'left');
  initResizer('#resizer-right', 'right');

  // User chat (right pane)
  $('#btn-toggle-chat').onclick = () => toggleUserChat();
  $('#btn-close-chat').onclick = () => toggleUserChat(true);
  $('#btn-clear-chat').onclick = async () => {
    try {
      await fetch('/api/chat', { method: 'DELETE', credentials: 'same-origin' });
      $('#chat-messages').innerHTML = '';
    } catch {}
  };
  $('#chat-send').onclick = sendChat;
  $('#uc-attach').onclick = () => $('#uc-file-input').click();
  $('#uc-file-input').addEventListener('change', (e) => {
    for (const f of e.target.files) ucUploadFile(f);
    e.target.value = '';
  });
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  // Вставка картинки/файла из буфера обмена (Ctrl/Cmd+V)
  $('#chat-input').addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) { ucUploadFile(f); e.preventDefault(); break; }
      }
    }
  });
  $('#chat-input').addEventListener('input', () => {
    const ta = $('#chat-input'); ta.style.height = '';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });

  // Init session
  try { ME = await api('/api/me'); } catch { ME = null; }
  renderAuth();
});

function generatePassword() {
  // 10 знаков, без визуально схожих символов (0/O, 1/l/I)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (const b of arr) p += alphabet[b % alphabet.length];
  return p;
}

// ── Project chat (left pane) ────────────────────────────────

const pcEls = {
  pane: () => $('#pane-left'),
  title: () => $('#pc-title'),
  sessionsDd: () => $('#pc-sessions-dd'),
  sessionsBtn: () => $('#pc-sessions-btn'),
  sessionsLabel: () => $('#pc-sessions-label'),
  sessionsMenu: () => $('#pc-sessions-menu'),
  newBtn: () => $('#pc-new-session'),
  delBtn: () => $('#pc-delete-session'),
  messages: () => $('#pc-messages'),
  input: () => $('#pc-input'),
  send: () => $('#pc-send'),
};

const pcState = {
  slug: null,
  sessionId: null,
  streaming: false,
  abort: null,
  toolUseNodes: new Map(),
  attachments: [],  // [{ path, size, mime, name, _uploading? }]
  model: localStorage.getItem('vibe.pcModel') || 'sonnet',
  mode: localStorage.getItem('vibe.pcMode') || 'full',
};

function pcClearMessages() {
  pcEls.messages().innerHTML = '';
  pcState.toolUseNodes.clear();
}

function pcShowEmpty(msg) {
  pcEls.messages().innerHTML = `<div class="pc-empty">${escapeHtml(msg)}</div>`;
}

function pcScrollToBottom() {
  const m = pcEls.messages();
  m.scrollTop = m.scrollHeight;
}

function pcToolArgSummary(tool, input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['file_path', 'path', 'pattern', 'command', 'url', 'query']) {
    if (input[k]) return String(input[k]);
  }
  try { return JSON.stringify(input).slice(0, 120); } catch { return ''; }
}

// Простой markdown → HTML (заголовки, **bold**, *italic*, `code`, ``` fenced, списки, ссылки)
function pcRenderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).split('\n');
  const out = [];
  let i = 0;
  let listType = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const inline = (s) => {
    let t = escapeHtml(s);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (m, txt, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(txt)}</a>`);
    t = t.replace(/`([^`\n]+)`/g, (m, c) => `<code class="md-inline-code">${escapeHtml(c)}</code>`);
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return t;
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] || '';
      const codeLines = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="md-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) { closeList(); out.push(`<h${h[1].length + 2} class="md-h md-h${h[1].length}">${inline(h[2])}</h${h[1].length + 2}>`); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { closeList(); out.push('<hr class="md-hr">'); i++; continue; }
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) { if (listType !== 'ol') { closeList(); out.push('<ol class="md-list">'); listType = 'ol'; } out.push(`<li>${inline(ol[1])}</li>`); i++; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) { if (listType !== 'ul') { closeList(); out.push('<ul class="md-list">'); listType = 'ul'; } out.push(`<li>${inline(ul[1])}</li>`); i++; continue; }
    if (/^\s*$/.test(line)) { closeList(); out.push(''); i++; continue; }
    closeList();
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|\s*---+|\s*\d+\.\s|\s*[-*+]\s)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  closeList();
  return out.join('\n');
}

function pcRenderBlock(b) {
  const messages = pcEls.messages();
  const empty = messages.querySelector('.pc-empty');
  if (empty) empty.remove();

  if (b.type === 'text' && b.role === 'user') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-user';
    el.textContent = b.text;
    messages.appendChild(el);
  } else if (b.type === 'text' && b.role === 'assistant') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-assistant md';
    el.innerHTML = pcRenderMarkdown(b.text);
    messages.appendChild(el);
  } else if (b.type === 'thinking') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-thinking';
    el.textContent = b.text;
    messages.appendChild(el);
  } else if (b.type === 'tool_use') {
    const details = document.createElement('details');
    details.className = 'pc-block pc-block-tool';
    const arg = pcToolArgSummary(b.tool, b.input);
    details.innerHTML = `
      <summary>
        <span class="pc-tool-name">🔧 ${escapeHtml(b.tool || '?')}</span>
        <span class="pc-tool-arg">${escapeHtml(arg)}</span>
      </summary>
      <pre class="pc-tool-input">${escapeHtml(JSON.stringify(b.input, null, 2))}</pre>
    `;
    messages.appendChild(details);
    if (b.toolUseId) pcState.toolUseNodes.set(b.toolUseId, details);
  } else if (b.type === 'tool_result') {
    const parent = b.toolUseId && pcState.toolUseNodes.get(b.toolUseId);
    if (parent) {
      if (b.isError) parent.classList.add('is-error');
      const pre = document.createElement('pre');
      pre.textContent = b.content || '(empty)';
      parent.appendChild(pre);
    } else {
      const el = document.createElement('details');
      el.className = 'pc-block pc-block-tool' + (b.isError ? ' is-error' : '');
      el.innerHTML = `<summary><span class="pc-tool-name">← result</span></summary><pre>${escapeHtml(b.content || '')}</pre>`;
      messages.appendChild(el);
    }
  } else if (b.type === 'error') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-error';
    el.textContent = b.message || 'Ошибка';
    messages.appendChild(el);
  }
  pcScrollToBottom();
}

function pcRenderSessionList(sessions) {
  const menu = pcEls.sessionsMenu();
  menu.innerHTML = '';
  if (!sessions.length) {
    pcEls.sessionsLabel().textContent = '— новая —';
    const item = document.createElement('div');
    item.className = 'pc-dd-item is-empty';
    item.textContent = 'Сессий пока нет';
    menu.appendChild(item);
    return;
  }
  const shortId = (id) => (id || '').slice(0, 8) || '—';
  const cur = sessions.find(s => s.sessionId === pcState.sessionId);
  pcEls.sessionsLabel().textContent = cur
    ? (cur.title || shortId(cur.sessionId)) + (cur.lockedBy ? ' 🔒' : '')
    : '— новая —';
  for (const s of sessions) {
    const item = document.createElement('button');
    item.className = 'pc-dd-item' + (s.sessionId === pcState.sessionId ? ' active' : '');
    item.type = 'button';
    const title = escapeHtml(s.title || shortId(s.sessionId));
    const lockLabel = s.lockedBy ? ' · 🔒 ' + escapeHtml(s.lockedBy) : '';
    item.innerHTML = `<span class="pc-dd-item-title">${title}</span><span class="pc-dd-item-meta">${escapeHtml(s.createdBy || '')}${lockLabel}</span>`;
    item.addEventListener('click', async () => {
      pcEls.sessionsDd().classList.remove('open');
      if (s.sessionId === pcState.sessionId) return;
      pcState.sessionId = s.sessionId;
      await pcLoadHistory(s.sessionId);
      pcRenderSessionList(sessions);
    });
    menu.appendChild(item);
  }
}

async function pcLoadSessions() {
  try {
    const { ok, status, data } = await getJsonWithRetry(`/api/project-chat/sessions?project=${encodeURIComponent(pcState.slug)}`);
    if (!ok) throw new Error(data.error || `sessions load failed (${status})`);
    pcRenderSessionList(data.sessions || []);
    return data.sessions || [];
  } catch (e) {
    pcShowEmpty('Не удалось загрузить сессии: ' + e.message);
    return [];
  }
}

async function pcLoadHistory(sessionId) {
  pcClearMessages();
  if (!sessionId) { pcShowEmpty('Напиши первое сообщение — сессия создастся.'); return; }
  try {
    const { ok, status, data } = await getJsonWithRetry(`/api/project-chat/session/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(pcState.slug)}`);
    if (!ok) throw new Error(data.error || `history load failed (${status})`);
    if (!data.blocks?.length) pcShowEmpty('Пустая сессия — напиши сообщение.');
    else data.blocks.forEach(pcRenderBlock);
  } catch (e) {
    pcShowEmpty('Не удалось загрузить историю: ' + e.message);
  }
}

async function openProjectChat(slug) {
  pcState.slug = slug;
  pcState.sessionId = null;
  if (pcState.abort) { try { pcState.abort.abort(); } catch {} pcState.abort = null; }
  pcEls.pane().classList.remove('hidden');
  document.body.classList.add('has-left-chat');
  pcEls.title().textContent = 'Чат · ' + slug;
  pcShowEmpty('Загрузка сессий…');
  const sessions = await pcLoadSessions();
  if (sessions.length) {
    pcState.sessionId = sessions[0].sessionId;
    pcRenderSessionList(sessions);
    await pcLoadHistory(pcState.sessionId);
  } else {
    pcShowEmpty('Нет сессий. Напиши первое сообщение — сессия создастся.');
  }
  pcEls.input().focus();
}

function pcCloseLeft() {
  pcEls.pane().classList.add('hidden');
  document.body.classList.remove('has-left-chat');
}

async function pcSend() {
  if (pcState.streaming) return;
  const ta = pcEls.input();
  const text = ta.value.trim();
  if (!text || !pcState.slug) return;

  ta.value = '';
  ta.style.height = '';
  pcState.streaming = true;
  pcEls.send().disabled = true;

  pcRenderBlock({ role: 'user', type: 'text', text });

  const typingEl = document.createElement('div');
  typingEl.className = 'pc-typing';
  typingEl.innerHTML = `<span class="pc-typing-dot">▋</span><span>Claude думает</span><span class="pc-typing-elapsed">0s</span>`;
  pcEls.messages().appendChild(typingEl);
  pcScrollToBottom();

  const startTs = Date.now();
  const elapsedEl = typingEl.querySelector('.pc-typing-elapsed');
  const elapsedTimer = setInterval(() => {
    if (!elapsedEl.isConnected) { clearInterval(elapsedTimer); return; }
    const s = Math.floor((Date.now() - startTs) / 1000);
    elapsedEl.textContent = s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
  }, 1000);

  const ctrl = new AbortController();
  pcState.abort = ctrl;

  try {
    // Прикрепляем пути загруженных файлов в начало текста (claude увидит их по абс. пути)
    const attachLines = pcState.attachments.map(a => `Прикреплён файл: ${a.path}`).join('\n');
    const fullText = attachLines ? `${attachLines}\n\n${text}` : text;
    pcState.attachments = [];
    pcRenderAttachments();
    const resp = await fetch('/api/project-chat/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ project: pcState.slug, sessionId: pcState.sessionId, text: fullText, model: pcState.model }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); errMsg = j.error || errMsg; } catch {}
      typingEl.remove();
      pcRenderBlock({ type: 'error', message: errMsg });
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let typingRemoved = false;
    const removeTyping = () => { if (!typingRemoved) { typingEl.remove(); typingRemoved = true; } };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, sep); buf = buf.slice(sep + 2);
        handlePcSseEvent(raw, removeTyping);
      }
    }
    removeTyping();
    clearInterval(elapsedTimer);
    await pcLoadSessions();
  } catch (e) {
    typingEl.remove();
    clearInterval(elapsedTimer);
    if (e.name !== 'AbortError') pcRenderBlock({ type: 'error', message: 'Сетевая ошибка: ' + e.message });
  } finally {
    pcState.streaming = false;
    pcEls.send().disabled = false;
    pcState.abort = null;
    pcEls.input().focus();
  }
}

function pcFmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function pcRenderAttachments() {
  const el = $('#pc-attachments');
  if (!pcState.attachments.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = pcState.attachments.map((a, i) => `
    <span class="pc-attach-chip">
      📎 ${escapeHtml(a.name)} <span class="pc-attach-size">${pcFmtSize(a.size)}</span>
      ${a._uploading ? '<span class="pc-attach-up">…</span>' : `<button class="pc-attach-x" data-idx="${i}" title="Убрать">✕</button>`}
    </span>
  `).join('');
  $$('.pc-attach-x', el).forEach(b => {
    b.onclick = () => { pcState.attachments.splice(+b.dataset.idx, 1); pcRenderAttachments(); };
  });
}

async function pcUploadFile(file) {
  if (!pcState.slug) return;
  if (file.size > 10 * 1024 * 1024) { alert('Файл слишком большой (>10MB)'); return; }
  const placeholder = { path: '', size: file.size, mime: file.type || 'application/octet-stream',
                        name: file.name || 'paste.png', _uploading: true };
  pcState.attachments.push(placeholder);
  pcRenderAttachments();
  try {
    const fd = new FormData();
    fd.append('file', file);
    if (pcState.sessionId) fd.append('sessionId', pcState.sessionId);
    const r = await fetch('/api/project-chat/upload?project=' + encodeURIComponent(pcState.slug),
      { method: 'POST', credentials: 'same-origin', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'upload failed');
    Object.assign(placeholder, d, { _uploading: false });
    pcRenderAttachments();
  } catch (e) {
    pcState.attachments = pcState.attachments.filter(x => x !== placeholder);
    pcRenderAttachments();
    alert('Загрузка не удалась: ' + e.message);
  }
}

function handlePcSseEvent(raw, removeTyping) {
  let event = 'message', data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  if (!data) return;
  let obj; try { obj = JSON.parse(data); } catch { return; }
  if (event === 'session') {
    pcState.sessionId = obj.sessionId;
  } else if (event === 'block') {
    removeTyping();
    pcRenderBlock(obj);
  } else if (event === 'summary') {
    const el = document.createElement('div');
    el.className = 'pc-block-summary';
    const cost = typeof obj.costUsd === 'number' ? ` · $${obj.costUsd.toFixed(4)}` : '';
    const dur = typeof obj.durationMs === 'number' ? ` · ${(obj.durationMs / 1000).toFixed(1)}s` : '';
    el.textContent = `${obj.tokenInput ?? 0} in / ${obj.tokenOutput ?? 0} out${cost}${dur}`;
    pcEls.messages().appendChild(el);
    pcScrollToBottom();
  } else if (event === 'status') {
    // Транзиентный индикатор (напр. «Сжимаю историю диалога…»). Не убирает
    // «Claude думает» — после сжатия ход продолжится в той же сессии.
    const el = document.createElement('div');
    el.className = 'pc-block-summary';
    el.textContent = obj.message || '';
    pcEls.messages().appendChild(el);
    pcScrollToBottom();
  } else if (event === 'error') {
    removeTyping();
    pcRenderBlock({ type: 'error', message: obj.message || 'stream error' });
  }
}

// ── User chat (right pane, общий помощник) ──────────────────

const ucState = { attachments: [] };  // [{ path, size, mime, name, _uploading? }]

function ucRenderAttachments() {
  const el = $('#uc-attachments');
  if (!ucState.attachments.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = ucState.attachments.map((a, i) => `
    <span class="pc-attach-chip">
      📎 ${escapeHtml(a.name)} <span class="pc-attach-size">${pcFmtSize(a.size)}</span>
      ${a._uploading ? '<span class="pc-attach-up">…</span>' : `<button class="pc-attach-x" data-idx="${i}" title="Убрать">✕</button>`}
    </span>
  `).join('');
  $$('.pc-attach-x', el).forEach(b => {
    b.onclick = () => { ucState.attachments.splice(+b.dataset.idx, 1); ucRenderAttachments(); };
  });
}

async function ucUploadFile(file) {
  if (file.size > 10 * 1024 * 1024) { alert('Файл слишком большой (>10MB)'); return; }
  const placeholder = { path: '', size: file.size, mime: file.type || 'application/octet-stream',
                        name: file.name || 'paste.png', _uploading: true };
  ucState.attachments.push(placeholder);
  ucRenderAttachments();
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/chat/upload', { method: 'POST', credentials: 'same-origin', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'upload failed');
    Object.assign(placeholder, d, { _uploading: false });
    ucRenderAttachments();
  } catch (e) {
    ucState.attachments = ucState.attachments.filter(x => x !== placeholder);
    ucRenderAttachments();
    alert('Загрузка не удалась: ' + e.message);
  }
}

function chatAppendBubble(type, text) {
  const div = document.createElement('div');
  if      (type === 'user')      div.className = 'chat-bubble chat-bubble-user';
  else if (type === 'assistant') div.className = 'chat-bubble chat-bubble-assistant';
  else if (type === 'thinking')  div.className = 'chat-bubble chat-bubble-thinking';
  else if (type === 'error')     div.className = 'chat-bubble chat-bubble-error';
  div.textContent = text;
  const c = $('#chat-messages');
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
  return div;
}

async function loadChatHistory() {
  try {
    const r = await fetch('/api/chat/history', { credentials: 'same-origin' });
    if (!r.ok) return;
    const history = await r.json();
    $('#chat-messages').innerHTML = '';
    history.forEach(m => chatAppendBubble(m.role === 'user' ? 'user' : 'assistant', m.content));
  } catch {}
}

async function sendChat() {
  const input = $('#chat-input');
  const message = input.value.trim();
  if ((!message && !ucState.attachments.length) || $('#chat-send').disabled) return;
  if (ucState.attachments.some(a => a._uploading)) { alert('Дождись загрузки файла'); return; }

  // Пути приложенных файлов уходят в начало сообщения (claude увидит их по абс. пути).
  const attachLines = ucState.attachments.map(a => `Прикреплён файл: ${a.path}`).join('\n');
  const fullMessage = attachLines ? (message ? `${attachLines}\n\n${message}` : attachLines) : message;
  const hasAttach = ucState.attachments.length > 0;
  const attachNames = ucState.attachments.map(a => `📎 ${a.name}`).join('  ');
  ucState.attachments = [];
  ucRenderAttachments();

  chatAppendBubble('user', [attachNames, message].filter(Boolean).join('\n'));
  input.value = '';
  input.style.height = '';
  $('#chat-send').disabled = true;
  const thinkingEl = chatAppendBubble('thinking', 'Думаю...');
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullMessage, attach: hasAttach }),
    });
    const d = await r.json();
    thinkingEl.remove();
    if (r.ok) {
      chatAppendBubble('assistant', d.response);
      if (d.createProject) {
        $('#newproject-tpl').value = d.createProject.template;
        $('#newproject-name').value = d.createProject.name;
        $('#newproject-error').classList.add('hidden');
        openModal('modal-newproject');
      }
    } else {
      chatAppendBubble('error', d.error || 'Ошибка');
    }
  } catch {
    thinkingEl.remove();
    chatAppendBubble('error', 'Сетевая ошибка');
  }
  $('#chat-send').disabled = false;
}

function initResizer(selector, side) {
  const r = $(selector);
  if (!r) return;
  const storageKey = `vibe.chatW.${side}`;
  const saved = parseInt(localStorage.getItem(storageKey) || '0', 10);
  if (saved >= 280 && saved <= 800) {
    document.documentElement.style.setProperty(`--${side === 'left' ? 'left' : 'right'}-chat-w`, saved + 'px');
  }
  r.addEventListener('mousedown', (e) => {
    e.preventDefault();
    r.classList.add('dragging');
    const startX = e.clientX;
    const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--${side}-chat-w`) || '420', 10) || 420;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      let w = side === 'left' ? startW + dx : startW - dx;
      w = Math.max(280, Math.min(800, w));
      document.documentElement.style.setProperty(`--${side}-chat-w`, w + 'px');
    };
    const onUp = () => {
      r.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--${side}-chat-w`), 10);
      if (cur) localStorage.setItem(storageKey, cur);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function toggleUserChat(forceClose = false) {
  const pane = $('#chat-pane');
  const isHidden = pane.classList.contains('hidden');
  if (forceClose || !isHidden) {
    pane.classList.add('hidden');
    document.body.classList.remove('has-right-chat');
  } else {
    pane.classList.remove('hidden');
    document.body.classList.add('has-right-chat');
    loadChatHistory();
    setTimeout(() => $('#chat-input').focus(), 30);
  }
}

// Heartbeat (для idle reaper)
setInterval(() => {
  if (ME) fetch('/api/touch', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}, 60_000);

// Кросс-вкладочная синхра темы (dev/wiki/vibe)
window.addEventListener('storage', (e) => {
  if (e.key === 'aif-theme') {
    const t = localStorage.getItem('aif-theme');
    document.documentElement.classList.toggle('dark', t !== 'light');
  }
});
