// KG: Пульт24 — демо-логика рендера. Никакого реального API, только DATA_BY_PERIOD.

const STATE = { period: 'month', view: 'overview' };
const charts = { weekly: null, funnel: null, sources: null, funnelSolo: null, sourcesSolo: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmtTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderKPI(period) {
  const k = DATA_BY_PERIOD[period].kpi;
  $('#kpi-deals').textContent      = k.deals.val;
  $('#kpi-revenue').textContent    = k.revenue.val;
  $('#kpi-conversion').textContent = k.conversion.val;
  $('#kpi-avg').textContent        = k.avg.val;

  for (const id of ['deals', 'revenue', 'conversion', 'avg']) {
    const el = $(`#kpi-${id}-trend`);
    el.textContent = (k[id].cls === 'up' ? '↑ ' : k[id].cls === 'down' ? '↓ ' : '→ ') + k[id].trend;
    el.className = 'kpi-trend ' + k[id].cls;
  }
}

function renderWeeklyChart(period) {
  const d = DATA_BY_PERIOD[period].weekly;
  const ctx = $('#weeklyChart').getContext('2d');
  if (charts.weekly) charts.weekly.destroy();

  charts.weekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.labels,
      datasets: [
        {
          label: 'Прошлый период',
          data: d.prev,
          backgroundColor: '#d1d5db',
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'Текущий период',
          data: d.deals,
          backgroundColor: d.deals.map((v, i) =>
            v === Math.max(...d.deals) ? '#2563eb' : '#fde7cc'
          ),
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { boxPadding: 4 } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#9ca3af' } },
        y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 9 }, color: '#9ca3af' }, beginAtZero: true },
      },
    },
  });
}

function renderFunnelChart(period) {
  const d = DATA_BY_PERIOD[period].funnel;
  const ctx = $('#funnelChart').getContext('2d');
  if (charts.funnel) charts.funnel.destroy();

  charts.funnel = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.labels,
      datasets: [{
        data: d.values,
        backgroundColor: ['#fde0c4','#f7c49a','#f0a86a','#2563eb','#10b981'],
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 9 }, color: '#9ca3af' } },
        y: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#374151' } },
      },
    },
  });
}

function renderSourcesChart(period) {
  const d = DATA_BY_PERIOD[period].sources;
  const ctx = $('#sourcesChart').getContext('2d');
  if (charts.sources) charts.sources.destroy();

  charts.sources = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: d.labels,
      datasets: [{
        data: d.values,
        backgroundColor: ['#2563eb','#f7c49a','#fdd6b3','#fde7cc','#eff6ff'],
        borderColor: '#fff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 8, boxHeight: 8, font: { size: 10 }, color: '#6b7280', padding: 6 },
        },
      },
    },
  });
}

function buildSpark(pattern) {
  const max = Math.max(...pattern);
  return pattern.map((v) => {
    const h = Math.round((v / max) * 18);
    const cls = v === max ? 'spark-bar peak' : (v < max * 0.5 ? 'spark-bar down' : 'spark-bar');
    return `<span class="${cls}" style="height:${h}px"></span>`;
  }).join('');
}

function renderManagers(period) {
  const cfg = DATA_BY_PERIOD[period];
  const total = cfg.kpi.deals.val;
  // Распределяем сделки по weight (base) с округлением
  const totalWeight = MANAGERS_BASE.reduce((s, m) => s + m.base, 0);
  const list = MANAGERS_BASE.slice(0, cfg.managers).map((m) => {
    const deals = Math.round((m.base / totalWeight) * total);
    const revenue = deals * (24000 + (m.base % 7) * 800);
    return { ...m, deals, revenue };
  });

  const sparkPatterns = ['up', 'up', 'flat', 'up', 'spike', 'flat', 'down', 'flat', 'down', 'flat'];
  const medals = ['🥇', '🥈', '🥉'];
  const badgeClasses = ['badge-gold', 'badge-silver', 'badge-bronze'];

  const tbody = $('#managersBody');
  tbody.innerHTML = '';

  list.forEach((m, i) => {
    const tr = document.createElement('tr');
    const medal = i < 3 ? medals[i] : (i + 1);
    const badgeCls = i < 3 ? badgeClasses[i] : 'badge-grey';

    tr.innerHTML = `
      <td><span class="badge ${badgeCls}">${medal}</span></td>
      <td>${m.name}</td>
      <td class="td-mono${i === 0 ? ' td-ac' : ''}">${m.deals}</td>
      <td class="td-mono td-green">${m.revenue.toLocaleString('ru-RU')} ₽</td>
      <td class="td-mono">${m.conv}%</td>
      <td><span class="spark">${buildSpark(SPARK_PATTERNS[sparkPatterns[i]])}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDeals(period) {
  const cfg = DATA_BY_PERIOD[period];
  const list = $('#dealsList');
  list.innerHTML = '';

  const labels = { won: 'Победа', progress: 'В работе', new: 'Новая' };

  DEAL_TEMPLATES.slice(0, cfg.deals_count).forEach((d) => {
    // Чуть скейлим суммы под период (чтобы не было «полный квартал = 1 сделка на 124К»)
    const factor = period === 'day' ? 0.7 : period === 'week' ? 0.95 : period === 'month' ? 1 : 1.1;
    const amt = Math.round(d.amount * factor / 1000) * 1000;
    const li = document.createElement('li');
    li.className = 'deal-item';
    li.innerHTML = `
      <div class="deal-title">${d.title}<span class="deal-status status-${d.status}">${labels[d.status]}</span></div>
      <div class="deal-meta">${d.client} · ${d.mgr}</div>
      <div class="deal-amount">${amt.toLocaleString('ru-RU')} ₽</div>
    `;
    list.appendChild(li);
  });
}

// ── Соло-чарты для отдельных табов ──
function renderFunnelSolo(period) {
  const d = DATA_BY_PERIOD[period].funnel;
  const ctx = $('#funnelSolo').getContext('2d');
  if (charts.funnelSolo) charts.funnelSolo.destroy();
  charts.funnelSolo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: d.labels,
      datasets: [{
        data: d.values,
        backgroundColor: ['#fde0c4','#f7c49a','#f0a86a','#2563eb','#10b981'],
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { boxPadding: 6 } },
      scales: {
        x: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 11 }, color: '#6b7280' } },
        y: { grid: { display: false }, ticks: { font: { size: 13 }, color: '#1f2937' } },
      },
    },
  });

  const tbody = $('#funnelStatsBody');
  tbody.innerHTML = '';
  const top = d.values[0];
  d.labels.forEach((label, i) => {
    const v = d.values[i];
    const conv = ((v / top) * 100).toFixed(1);
    const drop = i === 0 ? '—' : (((d.values[i - 1] - v) / d.values[i - 1]) * 100).toFixed(1) + '%';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td class="td-mono">${v.toLocaleString('ru-RU')}</td>
      <td class="td-mono${i === d.labels.length - 1 ? ' td-green' : ''}">${conv}%</td>
      <td class="td-mono" style="color:${i === 0 ? 'var(--muted)' : 'var(--red)'}">${drop}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSourcesSolo(period) {
  const d = DATA_BY_PERIOD[period].sources;
  const ctx = $('#sourcesSolo').getContext('2d');
  if (charts.sourcesSolo) charts.sourcesSolo.destroy();
  charts.sourcesSolo = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: d.labels,
      datasets: [{
        data: d.values,
        backgroundColor: ['#2563eb','#f7c49a','#fdd6b3','#fde7cc','#eff6ff'],
        borderColor: '#fff',
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 12 }, color: '#374151', padding: 10 },
        },
      },
    },
  });

  const tbody = $('#sourcesStatsBody');
  tbody.innerHTML = '';
  const total = d.values.reduce((s, v) => s + v, 0);
  // Имитация эффективности: реклама = высокая стоимость лида и средняя конверсия,
  // сарафан = низкая стоимость и высокая конверсия. Числа реалистичные.
  const meta = [
    { conv: '34%', cost: '480 ₽' },     // Сайт
    { conv: '22%', cost: '1 250 ₽' },   // Реклама
    { conv: '18%', cost: '380 ₽' },     // Холодные
    { conv: '52%', cost: '0 ₽' },       // Сарафан
    { conv: '41%', cost: '120 ₽' },     // Реф.прог.
  ];
  d.labels.forEach((label, i) => {
    const v = d.values[i];
    const share = ((v / total) * 100).toFixed(1);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td class="td-mono">${v.toLocaleString('ru-RU')}</td>
      <td class="td-mono">${share}%</td>
      <td class="td-mono">${meta[i]?.conv || '—'}</td>
      <td class="td-mono">${meta[i]?.cost || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderManagersSolo(period) {
  const cfg = DATA_BY_PERIOD[period];
  const total = cfg.kpi.deals.val;
  const totalWeight = MANAGERS_BASE.reduce((s, m) => s + m.base, 0);
  const list = MANAGERS_BASE.map((m) => {
    const deals = Math.round((m.base / totalWeight) * total);
    const revenue = deals * (24000 + (m.base % 7) * 800);
    const avgCheck = deals > 0 ? Math.round(revenue / deals) : 0;
    return { ...m, deals, revenue, avgCheck };
  });

  const sparkPatterns = ['up', 'up', 'flat', 'up', 'spike', 'flat', 'down', 'flat', 'down', 'flat'];
  const bestDays = ['пт 18 апр', 'ср 16 апр', 'чт 17 апр', 'вт 22 апр', 'пн 21 апр', 'пт 18 апр', 'чт 17 апр', 'вт 15 апр', 'пн 14 апр', 'ср 16 апр'];
  const medals = ['🥇', '🥈', '🥉'];
  const badgeClasses = ['badge-gold', 'badge-silver', 'badge-bronze'];

  const tbody = $('#managersSoloBody');
  tbody.innerHTML = '';
  list.forEach((m, i) => {
    const tr = document.createElement('tr');
    const medal = i < 3 ? medals[i] : (i + 1);
    const badgeCls = i < 3 ? badgeClasses[i] : 'badge-grey';
    tr.innerHTML = `
      <td><span class="badge ${badgeCls}">${medal}</span></td>
      <td>${m.name}</td>
      <td class="td-mono${i === 0 ? ' td-ac' : ''}">${m.deals}</td>
      <td class="td-mono td-green">${m.revenue.toLocaleString('ru-RU')} ₽</td>
      <td class="td-mono">${m.conv}%</td>
      <td class="td-mono">${m.avgCheck.toLocaleString('ru-RU')} ₽</td>
      <td style="color:var(--muted);font-size:11px">${bestDays[i]}</td>
      <td><span class="spark">${buildSpark(SPARK_PATTERNS[sparkPatterns[i]])}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function setView(view) {
  STATE.view = view;
  document.body.dataset.view = view;
  $$('[data-views]').forEach((el) => {
    const visible = el.dataset.views.split(' ').includes(view);
    el.style.display = visible ? '' : 'none';
  });
  $$('.dash-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  // Чарты для скрытых контейнеров chart.js не считает — рендерим по запросу
  if (view === 'funnel') renderFunnelSolo(STATE.period);
  if (view === 'sources') renderSourcesSolo(STATE.period);
  if (view === 'managers') renderManagersSolo(STATE.period);
}

function renderAll(period) {
  renderKPI(period);
  // Соло-блоки — только если они сейчас видны
  if (STATE.view === 'overview') {
    renderWeeklyChart(period);
    renderFunnelChart(period);
    renderSourcesChart(period);
    renderManagers(period);
    renderDeals(period);
  } else if (STATE.view === 'funnel') {
    renderFunnelSolo(period);
  } else if (STATE.view === 'sources') {
    renderSourcesSolo(period);
  } else if (STATE.view === 'managers') {
    renderManagersSolo(period);
  }
  $('#lastUpdated').textContent = 'Обновлено в ' + fmtTime();
}

function bindControls() {
  $$('#periodSwitch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#periodSwitch button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.period = btn.dataset.period;
      renderAll(STATE.period);
    });
  });

  $$('.dash-tab').forEach((t) => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      setView(t.dataset.view);
    });
  });

  $$('.chip-x').forEach((x) => {
    x.addEventListener('click', (e) => e.target.closest('.filter-chip').remove());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindControls();
  setView(STATE.view);   // выставляем начальный вид + скрываем соло-секции
  renderAll(STATE.period);
  // Маленький live-tick: обновляем только метку времени (без дёрганья цифр)
  setInterval(() => {
    $('#lastUpdated').textContent = 'Обновлено в ' + fmtTime();
  }, 30_000);
});
