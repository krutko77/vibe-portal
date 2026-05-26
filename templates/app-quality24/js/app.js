(function () {
  const { KG, PALETTE, render, destroy, colorFor, weekColor, commonScales } = window.KGCharts;

  const $ = (id) => document.getElementById(id);
  const loading = $('loading');
  const toast = $('toast');
  let loadingDepth = 0;

  function startLoading() { loadingDepth++; loading.classList.add('on'); }
  function stopLoading() { loadingDepth = Math.max(0, loadingDepth - 1); if (!loadingDepth) loading.classList.remove('on'); }

  let toastTimer = null;
  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.classList.toggle('toast--error', !!isError);
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 3500);
  }

  async function api(path) {
    startLoading();
    try {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.href = '/login'; throw new Error('auth'); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally { stopLoading(); }
  }

  function fmtPct(v) { return v === null || v === undefined ? '—' : `${Math.round(v)}%`; }
  function fmtPct1(v) { return v === null || v === undefined ? '—' : `${v.toFixed(1)}%`; }
  function fmtInt(v) { return v === null || v === undefined ? '—' : String(v); }

  // Карта weekKey → {weekStart, weekEnd} (понедельник/воскресенье). Заполняется после overview.
  const WEEKS = new Map();

  // Берёт значение недели из select-а и переводит в диапазон дат [weekStart, weekEnd].
  function weekRange(weekFromId, weekToId) {
    const kFrom = $(weekFromId)?.value || '';
    const kTo = $(weekToId)?.value || kFrom;
    if (!kFrom) return { from: null, to: null };
    // Неделя "с" может быть позже чем "по" — упорядочим по фактическим датам
    const wf = WEEKS.get(kFrom);
    const wt = WEEKS.get(kTo) || wf;
    if (!wf) return { from: null, to: null };
    let from, to;
    if (wt && wt.weekStart < wf.weekStart) {
      from = wt.weekStart; to = wf.weekEnd;
    } else {
      from = wf.weekStart; to = (wt || wf).weekEnd;
    }
    return { from, to };
  }

  function currentFilter() {
    const q = new URLSearchParams();
    const { from, to } = weekRange('weekFrom', 'weekTo');
    const manager = $('manager').value;
    const type = $('type').value;
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (manager) q.set('manager', manager);
    if (type) q.set('type', type);
    return q.toString();
  }

  function populateSelect(selectEl, values, placeholder) {
    const current = selectEl.value;
    selectEl.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    selectEl.appendChild(first);
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    }
    if (current && values.includes(current)) selectEl.value = current;
  }

  const CHART_IDS = [
    'chart-okk-mgr', 'chart-okk-trend', 'chart-crm-mgr', 'chart-crm-trend',
    'chart-okk-type', 'chart-criteria', 'chart-min-mgr', 'chart-min-trend',
    'chart-hub-okk', 'chart-hub-count', 'chart-sec-mgr', 'chart-sec-obj',
  ];

  function tagChartWraps() {
    for (const id of CHART_IDS) {
      const c = document.getElementById(id);
      if (c && c.parentElement) c.parentElement.dataset.chartId = id;
    }
  }

  function getOrRestoreCanvas(id) {
    const existing = document.getElementById(id);
    if (existing) return existing;
    const wrap = document.querySelector(`.chart-wrap[data-chart-id="${id}"]`);
    if (!wrap) return null;
    wrap.innerHTML = `<canvas id="${id}"></canvas>`;
    return document.getElementById(id);
  }

  function setEmpty(id, message) {
    const canvas = document.getElementById(id);
    if (!canvas) {
      const wrap = document.querySelector(`.chart-wrap[data-chart-id="${id}"]`);
      if (wrap) wrap.innerHTML = `<div class="empty">${message}</div>`;
      return;
    }
    destroy(id);
    canvas.parentElement.innerHTML = `<div class="empty">${message}</div>`;
  }

  // -------- overview & filters --------

  async function loadOverviewAndFilters() {
    const data = await api('/api/overview?' + currentFilter());

    $('kpi-calls').textContent = fmtInt(data.summary.totalCalls);
    $('kpi-calls-hint').textContent = data.totalAll ? `всего в таблице: ${data.totalAll}` : '';
    $('kpi-pct-call').textContent = fmtPct1(data.summary.pctCallAvg);
    $('kpi-pct-crm').textContent = fmtPct1(data.summary.pctCrmAvg);
    $('kpi-minutes').textContent = fmtInt(data.summary.totalMinutes);

    if ($('manager').options.length <= 1 && data.managers?.length) {
      populateSelect($('manager'), data.managers, 'Все');
    }
    if ($('type').options.length <= 1 && data.types?.length) {
      populateSelect($('type'), data.types, 'Все');
    }

    // Заполняем список недель один раз (если пришёл).
    if (data.weeksList?.length && WEEKS.size === 0) {
      for (const w of data.weeksList) WEEKS.set(w.key, w);
      fillWeekSelect($('weekFrom'), data.weeksList, '');
      fillWeekSelect($('weekTo'), data.weeksList, '');

      // Дефолт основного периода — последние 4 недели в данных.
      const lastN = data.weeksList.slice(-4);
      if (lastN.length && !$('weekFrom').value) {
        $('weekFrom').value = lastN[0].key;
        $('weekTo').value = lastN[lastN.length - 1].key;
      }
    }

    return data;
  }

  function fmtShortDate(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    return `${d}.${m}`;
  }

  function fillWeekSelect(selectEl, weeks, placeholder) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';
    if (placeholder) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = placeholder;
      selectEl.appendChild(opt);
    }
    for (const w of weeks) {
      const opt = document.createElement('option');
      opt.value = w.key;
      opt.textContent = `${w.weekNum} неделя · ${fmtShortDate(w.weekStart)}–${fmtShortDate(w.weekEnd)}`;
      selectEl.appendChild(opt);
    }
    if (current) selectEl.value = current;
  }

  // -------- charts --------

  // Общие опции для grouped-bar (недели как серии).
  // Подписи значений — вертикальные (rotation -90), вынесены над столбиком.
  // Иначе при 4+ неделях × 8 менеджерах бары узкие и горизонтальные подписи налезают.
  function groupedBarOptions({ percent = true, showLegend = true } = {}) {
    return {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 28 } }, // место под вертикальные подписи
      plugins: {
        legend: showLegend ? { position: 'bottom', labels: { color: KG.chartText, padding: 14 } } : { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => percent
              ? ` ${ctx.dataset.label}: ${ctx.parsed.y === null ? '—' : ctx.parsed.y + '%'}`
              : ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
          },
        },
        datalabels: {
          display: (ctx) => ctx.dataset.data[ctx.dataIndex] !== null && ctx.dataset.data[ctx.dataIndex] !== undefined,
          anchor: 'end',
          align: 'end',
          offset: 4,
          rotation: -90,
          color: KG.chartValue,
          font: { weight: '700', size: 11 },
          formatter: (v) => v === null ? '' : percent ? `${v}%` : String(v),
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: KG.chartText, font: { size: 12 } } },
        y: percent
          ? { beginAtZero: true, max: 100, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, callback: (v) => v + '%' } }
          : { beginAtZero: true, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText } },
      },
    };
  }

  function groupedBarData({ labels, weeks, cells, field }) {
    const datasets = weeks.map((w, i) => ({
      label: w.label,
      data: labels.map((k) => {
        const v = cells[k]?.[w.key]?.[field];
        if (v === null || v === undefined) return null;
        return Math.round(v);
      }),
      backgroundColor: weekColor(i, weeks.length),
      borderRadius: 6,
      borderSkipped: false,
    }));
    return { labels, datasets };
  }

  function trendLine({ weeks, series, color, percent = true, labelText }) {
    const labels = weeks.map((w) => w.label);
    const data = weeks.map((w) => {
      const v = series[w.key];
      return v === null || v === undefined ? null : Math.round(v);
    });
    return {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: labelText,
          data,
          borderColor: color,
          backgroundColor: color,
          tension: 0.3,
          pointRadius: 5,
          pointBackgroundColor: color,
          pointBorderColor: color,
          spanGaps: true,
          borderWidth: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 28, right: 16, left: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${labelText}: ${ctx.parsed.y === null ? '—' : percent ? ctx.parsed.y + '%' : ctx.parsed.y}` } },
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'top',
            offset: 10,
            clip: false,
            color: color,
            font: { weight: '700', size: 13 },
            formatter: (v) => v === null ? '' : percent ? `${v}%` : String(v),
          },
        },
        scales: percent ? {
          x: { grid: { display: false }, ticks: { color: KG.chartText } },
          y: { beginAtZero: true, max: 105, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, callback: (v) => v > 100 ? '' : v + '%', stepSize: 10 } },
        } : {
          x: { grid: { display: false }, ticks: { color: KG.chartText } },
          y: { beginAtZero: true, grace: '10%', grid: { color: KG.chartGrid }, ticks: { color: KG.chartText } },
        },
      },
    };
  }

  function renderOKKByManager(d) {
    if (!d.managers.length || !d.weeks.length) return setEmpty('chart-okk-mgr', 'Нет данных в выборке');
    getOrRestoreCanvas('chart-okk-mgr');
    render('chart-okk-mgr', {
      type: 'bar',
      data: groupedBarData({ labels: d.managers, weeks: d.weeks, cells: d.byWeekManager, field: 'pctCall' }),
      options: groupedBarOptions({ percent: true }),
    });
  }

  function renderCRMByManager(d) {
    if (!d.managers.length || !d.weeks.length) return setEmpty('chart-crm-mgr', 'Нет данных в выборке');
    getOrRestoreCanvas('chart-crm-mgr');
    render('chart-crm-mgr', {
      type: 'bar',
      data: groupedBarData({ labels: d.managers, weeks: d.weeks, cells: d.byWeekManager, field: 'pctCrm' }),
      options: groupedBarOptions({ percent: true }),
    });
  }

  function renderOKKByType(d) {
    if (!d.types.length || !d.weeks.length) return setEmpty('chart-okk-type', 'Нет данных в выборке');
    getOrRestoreCanvas('chart-okk-type');
    render('chart-okk-type', {
      type: 'bar',
      data: groupedBarData({ labels: d.types, weeks: d.weeks, cells: d.byWeekType, field: 'pctCall' }),
      options: groupedBarOptions({ percent: true }),
    });
  }

  function renderMinutesByManager(d) {
    if (!d.managers.length || !d.weeks.length) return setEmpty('chart-min-mgr', 'Нет данных в выборке');
    getOrRestoreCanvas('chart-min-mgr');
    render('chart-min-mgr', {
      type: 'bar',
      data: groupedBarData({ labels: d.managers, weeks: d.weeks, cells: d.byWeekManager, field: 'minutes' }),
      options: groupedBarOptions({ percent: false }),
    });
  }

  function renderOKKTrend(d) {
    if (!d.weeks.length) return setEmpty('chart-okk-trend', 'Нет данных');
    getOrRestoreCanvas('chart-okk-trend');
    const series = {};
    for (const w of d.weeks) series[w.key] = d.byWeekTotal[w.key]?.pctCall ?? null;
    render('chart-okk-trend', trendLine({ weeks: d.weeks, series, color: KG.yellowStrong, labelText: '% ОКК' }));
  }

  function renderCRMTrend(d) {
    if (!d.weeks.length) return setEmpty('chart-crm-trend', 'Нет данных');
    getOrRestoreCanvas('chart-crm-trend');
    const series = {};
    for (const w of d.weeks) series[w.key] = d.byWeekTotal[w.key]?.pctCrm ?? null;
    render('chart-crm-trend', trendLine({ weeks: d.weeks, series, color: '#8a9fd1', labelText: '% CRM' }));
  }

  function renderMinutesTrend(d) {
    if (!d.weeks.length) return setEmpty('chart-min-trend', 'Нет данных');
    getOrRestoreCanvas('chart-min-trend');
    const series = {};
    for (const w of d.weeks) series[w.key] = d.byWeekTotal[w.key]?.minutes ?? null;
    render('chart-min-trend', trendLine({ weeks: d.weeks, series, color: KG.yellowStrong, percent: false, labelText: 'минут' }));
  }

  function renderCriteriaChart(d) {
    if (!d.criteria?.length || !d.weeks.length) {
      return setEmpty('chart-criteria', 'Критерии не распознаны или нет данных');
    }
    getOrRestoreCanvas('chart-criteria');
    const datasets = d.weeks.map((w, i) => ({
      label: w.label,
      data: d.criteria.map((name) => {
        const v = d.byWeekCriterion[name]?.[w.key];
        return v === null || v === undefined ? null : v;
      }),
      borderColor: weekColor(i, d.weeks.length),
      backgroundColor: weekColor(i, d.weeks.length),
      tension: 0.2,
      pointRadius: 4,
      spanGaps: true,
      borderWidth: 2,
    }));
    render('chart-criteria', {
      type: 'line',
      data: { labels: d.criteria, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 16, bottom: 8 } },
        plugins: {
          legend: { position: 'bottom', labels: { color: KG.chartText, padding: 14 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y === null ? '—' : ctx.parsed.y + '%'}` } },
          datalabels: {
            display: (ctx) => {
              const v = ctx.dataset.data[ctx.dataIndex];
              return v !== null && v !== undefined && v < 100;
            },
            align: 'bottom',
            offset: 6,
            color: (ctx) => ctx.dataset.borderColor,
            font: { weight: '700', size: 11 },
            formatter: (v) => v === null ? '' : `${v}%`,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: KG.chartText, autoSkip: false, maxRotation: 40, minRotation: 30 } },
          y: { beginAtZero: true, max: 100, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, callback: (v) => v + '%' } },
        },
      },
    });
  }

  // Мини-график для карточки менеджера: 3-4 столбика (по одному на неделю).
  function miniBarConfig({ weeks, weekValues, percent = true }) {
    const datasets = weeks.map((w, i) => ({
      label: w.label,
      data: [weekValues[w.key] === null || weekValues[w.key] === undefined ? null : Math.round(weekValues[w.key])],
      backgroundColor: weekColor(i, weeks.length),
      borderRadius: 6,
      borderSkipped: false,
    }));
    return {
      type: 'bar',
      data: { labels: [''], datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { position: 'bottom', labels: { color: KG.chartText, padding: 8, boxWidth: 8, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y === null ? '—' : percent ? ctx.parsed.y + '%' : ctx.parsed.y}`,
            },
          },
          datalabels: {
            display: (ctx) => {
              const v = ctx.dataset.data[ctx.dataIndex];
              return v !== null && v !== undefined;
            },
            anchor: 'end',
            align: 'end',
            offset: 2,
            color: KG.chartValue,
            font: { weight: '700', size: 13 },
            formatter: (v) => v === null ? '' : percent ? `${v}%` : String(v),
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { display: false } },
          y: percent
            ? { beginAtZero: true, max: 100, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, callback: (v) => v + '%', stepSize: 25 } }
            : { beginAtZero: true, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText } },
        },
      },
    };
  }

  function renderPerManager(d) {
    const container = document.getElementById('managers-grid');
    if (!container) return;

    // Сначала гасим предыдущие инстансы мини-чартов, чтобы не утекали.
    for (const id of Array.from(document.querySelectorAll('#managers-grid canvas')).map((c) => c.id)) {
      destroy(id);
    }
    container.innerHTML = '';

    if (!d.managers?.length || !d.weeks?.length) {
      container.innerHTML = `<div class="empty" style="padding:24px">Нет данных</div>`;
      return;
    }

    d.managers.forEach((mgr, idx) => {
      // Суммы за весь выбранный период.
      let totalCalls = 0;
      let totalMinutes = 0;
      for (const w of d.weeks) {
        const cell = d.byWeekManager[mgr]?.[w.key];
        if (cell) {
          totalCalls += cell.count || 0;
          if (cell.minutes) totalMinutes += cell.minutes;
        }
      }

      const okkId = `mgr-okk-${idx}`;
      const crmId = `mgr-crm-${idx}`;

      const card = document.createElement('div');
      card.className = 'mgr-card card';
      card.innerHTML = `
        <div class="mgr-card__title">${mgr}</div>
        <div class="mgr-card__hint">${totalCalls} звонков, вошедших в оценку · ${totalMinutes} мин.</div>
        <div class="mgr-card__charts">
          <div class="mgr-mini">
            <div class="mgr-mini__label">% ОКК по неделям</div>
            <div class="mgr-mini__chart"><canvas id="${okkId}"></canvas></div>
          </div>
          <div class="mgr-mini">
            <div class="mgr-mini__label">% CRM по неделям</div>
            <div class="mgr-mini__chart"><canvas id="${crmId}"></canvas></div>
          </div>
        </div>
      `;
      container.appendChild(card);

      const okkValues = {};
      const crmValues = {};
      for (const w of d.weeks) {
        okkValues[w.key] = d.byWeekManager[mgr]?.[w.key]?.pctCall ?? null;
        crmValues[w.key] = d.byWeekManager[mgr]?.[w.key]?.pctCrm ?? null;
      }

      render(okkId, miniBarConfig({ weeks: d.weeks, weekValues: okkValues, percent: true }));
      render(crmId, miniBarConfig({ weeks: d.weeks, weekValues: crmValues, percent: true }));
    });
  }

  function renderCriteriaTable(d) {
    const wrap = document.getElementById('crit-table');
    if (!wrap) return;
    if (!d.criteria?.length || !d.weeks.length) {
      wrap.innerHTML = `<div class="empty">Нет данных</div>`;
      return;
    }
    const rows = [];
    rows.push(`<tr><th class="crit-table__first">Неделя</th>${d.criteria.map((c) => `<th>${c}</th>`).join('')}</tr>`);
    for (const w of d.weeks) {
      const cells = d.criteria.map((c) => {
        const v = d.byWeekCriterion[c]?.[w.key];
        if (v === null || v === undefined) return `<td class="crit--empty">—</td>`;
        let cls = '';
        if (v < 50) cls = 'crit--bad';
        else if (v < 80) cls = 'crit--warn';
        return `<td class="${cls}">${v}%</td>`;
      }).join('');
      rows.push(`<tr><td class="crit-table__first">${w.label}</td>${cells}</tr>`);
    }
    wrap.innerHTML = `<table class="crit-table"><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`;
  }

  // -------- секция «Секретарь» --------

  function renderSecretaryByManager(data) {
    const id = 'chart-sec-mgr';
    if (!data.byManager.length) return setEmpty(id, 'Нет звонков «Секретарь» в выборке');
    getOrRestoreCanvas(id);
    const labels = data.byManager.map((r) => r.manager);
    render(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Звонков',
            data: data.byManager.map((r) => r.count),
            backgroundColor: KG.yellow,
            borderRadius: 6,
            borderSkipped: false,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: '% отработки возражений',
            data: data.byManager.map((r) => r.pctObj),
            borderColor: '#b9d9a1',
            backgroundColor: '#b9d9a1',
            tension: 0.3,
            pointRadius: 4,
            spanGaps: true,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 28 } },
        plugins: {
          legend: { position: 'bottom', labels: { color: KG.chartText, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.yAxisID === 'y1'
                ? ` ${ctx.dataset.label}: ${ctx.parsed.y === null ? '—' : ctx.parsed.y + '%'}`
                : ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
            },
          },
          datalabels: {
            display: (ctx) => ctx.dataset.type !== 'line',
            anchor: 'end',
            align: 'end',
            offset: 4,
            color: KG.chartValue,
            font: { weight: '700', size: 12 },
            formatter: (v) => v === null ? '' : String(v),
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: KG.chartText } },
          y: { beginAtZero: true, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, precision: 0 }, title: { display: true, text: 'звонков', color: KG.chartText } },
          y1: { beginAtZero: true, max: 100, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: KG.chartText, callback: (v) => v + '%' }, title: { display: true, text: '% возражения', color: KG.chartText } },
        },
      },
    });
  }

  function renderSecretaryByObjection(data) {
    const id = 'chart-sec-obj';
    if (!data.byObjection.length) return setEmpty(id, 'Нет возражений в выборке');
    getOrRestoreCanvas(id);
    const labels = data.byObjection.map((r) => r.objection);
    render(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Звонков',
          data: data.byObjection.map((r) => r.count),
          backgroundColor: labels.map((_, i) => colorFor(i + 3)),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 30 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` Звонков: ${ctx.parsed.x}` } },
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'end',
            offset: 4,
            color: KG.chartValue,
            font: { weight: '700', size: 12 },
            formatter: (v) => String(v),
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: KG.chartText, font: { size: 12 } } },
        },
      },
    });
  }

  function renderSecretaryTable(data) {
    const wrap = document.getElementById('sec-table');
    if (!wrap) return;
    if (!data.calls.length) {
      wrap.innerHTML = `<div class="empty" style="padding:24px; color:var(--kg-muted)">Нет звонков «Секретарь» в выборке</div>`;
      return;
    }
    const cls = (v) => {
      if (v === null || v === undefined) return '';
      if (v < 50) return 'sec-pct--bad';
      if (v < 80) return 'sec-pct--warn';
      return '';
    };
    const fmt = (v) => v === null || v === undefined ? '—' : `${Math.round(v)}%`;
    const esc = (s) => (s === null || s === undefined ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmtDuration = (sec) => {
      if (!Number.isFinite(sec)) return '—';
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    };
    const scoreClass = (v) => {
      if (v === null || v === undefined) return 'v-null';
      if (v === 1) return 'v-1';
      if (v === 0) return 'v-0';
      if (v > 0 && v < 1) return 'v-half';
      return '';
    };
    const scoreText = (v) => v === null || v === undefined ? '—' : (v === 1 ? '✓' : v === 0 ? '✗' : String(v));

    function detailsHTML(c, idx) {
      const objRows = (c.objCriteria || []).map((v, i) => `
        <div><span>Возражение ${i + 1}</span><span class="val ${scoreClass(v)}">${scoreText(v)}</span></div>
      `).join('');
      const critRows = (data.criteriaNames || []).map((name) => {
        const v = c.criteria?.[name];
        return `<div><span>${esc(name)}</span><span class="val ${scoreClass(v)}">${scoreText(v)}</span></div>`;
      }).join('');

      return `
        <tr class="sec-details" id="sec-details-${idx}">
          <td colspan="8">
            <div class="sec-details__grid">
              <div><strong>Направление</strong>${esc(c.direction) || '—'}</div>
              <div><strong>Длина</strong>${fmtDuration(c.duration)}</div>
              <div><strong>Вид</strong>${esc(c.view) || '—'}</div>
              <div><strong>Аудитор</strong>${esc(c.auditor) || '—'}</div>
              <div><strong>Оценка (текст)</strong>${esc(c.score) || '—'}</div>
              <div><strong>% заполнения CRM</strong>${fmt(c.pctCrm)}</div>
              <div><strong>Ссылка на запись</strong>${c.recordLink ? `<a href="${esc(c.recordLink)}" target="_blank" rel="noopener">открыть</a>` : '—'}</div>
              <div><strong>Сделка</strong>${c.dealLink ? `<a href="${esc(c.dealLink)}" target="_blank" rel="noopener">карточка</a>` : '—'}</div>
            </div>
            <div class="sec-details__block">
              <h4>Оценки по возражению</h4>
              <div class="sec-details__crit">${objRows || '<div class="v-null">Нет оценок</div>'}</div>
            </div>
            <div class="sec-details__block">
              <h4>Оценки по критериям (теплота)</h4>
              <div class="sec-details__crit">${critRows || '<div class="v-null">Нет оценок</div>'}</div>
            </div>
          </td>
        </tr>
      `;
    }

    const rows = data.calls.map((c, idx) => `
      <tr class="sec-row" data-idx="${idx}">
        <td class="sec-toggle">▸</td>
        <td class="sec-num">${esc(c.date)} ${esc(c.time)}</td>
        <td>${esc(c.manager) || '—'}</td>
        <td class="sec-obj">${esc(c.objection) || '— без текста —'}</td>
        <td class="sec-num ${cls(c.pctCall)}">${fmt(c.pctCall)}</td>
        <td class="sec-num ${cls(c.pctObj)}">${fmt(c.pctObj)}</td>
        <td class="sec-comment">${esc(c.comment)}</td>
        <td class="sec-link">${c.recordLink ? `<a href="${esc(c.recordLink)}" target="_blank" rel="noopener">Запись</a>` : ''}${c.dealLink ? ` · <a href="${esc(c.dealLink)}" target="_blank" rel="noopener">Сделка</a>` : ''}</td>
      </tr>
      ${detailsHTML(c, idx)}
    `).join('');

    wrap.innerHTML = `
      <table class="sec-table">
        <thead>
          <tr>
            <th style="width:24px"></th>
            <th>Дата</th>
            <th>Менеджер</th>
            <th>Возражение</th>
            <th>% качества</th>
            <th>% возражений</th>
            <th>Комментарий</th>
            <th>Ссылки</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Кликабельность строк: тогл раскрытия деталей.
    wrap.querySelectorAll('tr.sec-row').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        // не мешаем клику по ссылке
        if (e.target.closest('a')) return;
        const idx = tr.dataset.idx;
        const details = wrap.querySelector(`#sec-details-${idx}`);
        if (!details) return;
        const open = tr.classList.toggle('is-open');
        details.classList.toggle('is-open', open);
      });
    });
  }

  // -------- «Контактный хаб» (08:50–10:10) --------

  async function loadHubCall() {
    const data = await api('/api/hub-call?' + currentFilter());
    $('hub-total').textContent = `${data.total} звонков`;

    const idOkk = 'chart-hub-okk';
    const idCnt = 'chart-hub-count';
    if (!data.byManager.length) {
      setEmpty(idOkk, 'Нет звонков в окне 08:50–10:10');
      setEmpty(idCnt, 'Нет звонков в окне 08:50–10:10');
      return;
    }

    const labels = data.byManager.map((r) => r.manager);
    const pctData = data.byManager.map((r) => r.pctCall);
    const cntData = data.byManager.map((r) => r.count);

    getOrRestoreCanvas(idOkk);
    render(idOkk, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '% ОКК',
          data: pctData,
          backgroundColor: KG.yellow,
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` % ОКК: ${ctx.parsed.y === null ? '—' : ctx.parsed.y + '%'}` } },
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] !== null,
            anchor: 'end', align: 'end', offset: 4,
            color: KG.chartValue, font: { weight: '700', size: 12 },
            formatter: (v) => v === null ? '' : `${v}%`,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: KG.chartText } },
          y: { beginAtZero: true, max: 100, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, callback: (v) => v + '%' } },
        },
      },
    });

    getOrRestoreCanvas(idCnt);
    render(idCnt, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Звонков',
          data: cntData,
          backgroundColor: '#b9d9a1',
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` Звонков: ${ctx.parsed.y}` } },
          datalabels: {
            display: true,
            anchor: 'end', align: 'end', offset: 4,
            color: KG.chartValue, font: { weight: '700', size: 12 },
            formatter: (v) => String(v),
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: KG.chartText } },
          y: { beginAtZero: true, grid: { color: KG.chartGrid }, ticks: { color: KG.chartText, precision: 0 } },
        },
      },
    });
  }

  async function loadSecretary() {
    const data = await api('/api/secretary?' + currentFilter());
    $('sec-total').textContent = `${data.total} звонков`;
    renderSecretaryByManager(data);
    renderSecretaryByObjection(data);
    renderSecretaryTable(data);
  }

  async function refreshAll() {
    try {
      await loadOverviewAndFilters();
      const d = await api('/api/dashboard?' + currentFilter());

      $('kpi-calls').textContent = fmtInt(d.summary.totalCalls);
      $('kpi-pct-call').textContent = fmtPct1(d.summary.pctCallAvg);
      $('kpi-pct-crm').textContent = fmtPct1(d.summary.pctCrmAvg);
      $('kpi-minutes').textContent = fmtInt(d.summary.totalMinutes);

      renderOKKByManager(d);
      renderOKKTrend(d);
      renderCRMByManager(d);
      renderCRMTrend(d);
      renderOKKByType(d);
      renderCriteriaChart(d);
      renderCriteriaTable(d);
      renderMinutesByManager(d);
      renderMinutesTrend(d);
      renderPerManager(d);
      await loadHubCall();
      await loadSecretary();
    } catch (e) {
      if (e.message !== 'auth') showToast(e.message || 'Ошибка загрузки', true);
    }
  }

  // -------- events --------

  document.addEventListener('DOMContentLoaded', () => {
    tagChartWraps();

    $('apply').addEventListener('click', refreshAll);
    $('weekFrom').addEventListener('change', refreshAll);
    $('weekTo').addEventListener('change', refreshAll);
    $('manager').addEventListener('change', refreshAll);
    $('type').addEventListener('change', refreshAll);

    $('refresh').addEventListener('click', async () => {
      try {
        await fetch('/api/refresh', { method: 'POST' });
        showToast('Кеш сброшен, перечитываю таблицу...');
        await refreshAll();
      } catch (e) { showToast('Не удалось обновить', true); }
    });

    $('logout').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });

    refreshAll();
  });
})();
