// Главная: KPI-полоса + сетка типов + лента активности.

import { MOCK_ACTIVITY } from '../data/mock.js';

export function renderHome({ types, requests }) {
  const root = document.createElement('div');

  // ── Подсчёты для тайлов и KPI ──
  const counts = {};
  const reviewCounts = {};
  const stuckCounts = {};   // в review > 5 дней
  for (const r of requests) {
    counts[r.typeSlug] = (counts[r.typeSlug] || 0) + 1;
    if (r.status === 'review') {
      reviewCounts[r.typeSlug] = (reviewCounts[r.typeSlug] || 0) + 1;
      if ((r.stageAgeDays || 0) >= 5) {
        stuckCounts[r.typeSlug] = (stuckCounts[r.typeSlug] || 0) + 1;
      }
    }
  }

  const onReview = requests.filter(r => r.status === 'review');
  const totalReview = onReview.length;
  const totalDrafts = requests.filter(r => r.status === 'draft').length;
  const totalDone = requests.filter(r => r.status === 'done').length;
  const reviewSum = onReview.reduce((s, r) => s + (r.amount || 0), 0);
  const stuckTotal = onReview.filter(r => (r.stageAgeDays || 0) >= 5).length;
  const avgAge = onReview.length
    ? (onReview.reduce((s, r) => s + (r.stageAgeDays || 0), 0) / onReview.length).toFixed(1)
    : '0';

  // ── KPI-полоса ──
  const kpis = `
    <div class="kpi-strip">
      <div class="kpi">
        <div class="kpi__label">На согласовании</div>
        <div class="kpi__val">${totalReview}</div>
        <div class="kpi__sub">${totalDrafts} в черновиках · ${totalDone} согласовано</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Сумма в работе</div>
        <div class="kpi__val">${formatShortMoney(reviewSum)}</div>
        <div class="kpi__sub">по доходным/расходным/хоз. договорам</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Среднее время на стадии</div>
        <div class="kpi__val">${avgAge} <span class="kpi__unit">дн.</span></div>
        <div class="kpi__sub">по всем заявкам в работе</div>
      </div>
      <div class="kpi ${stuckTotal > 0 ? 'kpi--alert' : ''}">
        <div class="kpi__label">Зависшие (&gt;5 дней)</div>
        <div class="kpi__val">${stuckTotal}</div>
        <div class="kpi__sub">${stuckTotal > 0 ? 'требуют вашего внимания' : 'всё в порядке'}</div>
      </div>
    </div>
  `;

  // ── Тайлы типов с бейджами «зависших» ──
  const tiles = types.map(t => {
    const total = counts[t.slug] || 0;
    const review = reviewCounts[t.slug] || 0;
    const stuck = stuckCounts[t.slug] || 0;
    const stuckBadge = stuck > 0
      ? `<span class="tile__stuck" title="Зависших > 5 дней">⚠ ${stuck}</span>`
      : '';
    return `
      <a class="tile" href="#/type/${t.slug}">
        <div class="tile__head">
          <span class="tile__icon">${t.icon}</span>
          ${stuckBadge}
        </div>
        <span class="tile__title">${t.title}</span>
        <span class="tile__desc">${t.desc}</span>
        <div class="tile__stats">
          <span><b>${total}</b> всего</span>
          <span class="tile__review">${review} на согл.</span>
        </div>
      </a>
    `;
  }).join('');

  // ── Лента активности ──
  const activityIcons = { ok: '✓', reject: '↺', send: '→', draft: '✎' };
  const activity = MOCK_ACTIVITY.map(a => `
    <li class="act act--${a.kind}">
      <span class="act__icon">${activityIcons[a.kind]}</span>
      <div class="act__body">
        <div class="act__line"><b>${escapeHtml(a.who)}</b> ${escapeHtml(a.action)}</div>
        <div class="act__target">${escapeHtml(a.target)}</div>
      </div>
      <div class="act__time">${escapeHtml(a.ts)}</div>
    </li>
  `).join('');

  root.innerHTML = `
    <h1 class="page-title">Пульт согласований</h1>
    <p class="page-subtitle">Все типы документов в одном месте. Демо · данные синтетические.</p>

    ${kpis}

    <div class="home-grid">
      <div>
        <div class="section-label">Типы документов</div>
        <div class="tiles">${tiles}</div>
      </div>
      <aside class="activity-card">
        <div class="activity-head">
          <span>Лента активности</span>
          <span class="activity-live"><span class="dot"></span>обновляется</span>
        </div>
        <ul class="activity-list">${activity}</ul>
      </aside>
    </div>
  `;

  return root;
}

function formatShortMoney(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.0', '') + ' млн ₽';
  if (v >= 1_000)     return Math.round(v / 1_000) + ' тыс ₽';
  return v + ' ₽';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
