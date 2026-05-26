// src/public/js/load-board.js

function getLoadClass(percent) {
  if (percent >= 120) return 'load-danger';
  if (percent >= 100) return 'load-over';
  if (percent >= 80)  return 'load-warn';
  if (percent >= 50)  return 'load-ok';
  return 'load-low';
}

function avatarColor(name) {
  const palette = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
  let h = 0;
  for (const c of (name || '')) h = ((h << 5) - h) + c.charCodeAt(0);
  return palette[Math.abs(h) % palette.length];
}

function renderAnalystGrid(containerId, analysts, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  analysts.forEach(a => {
    const cls = getLoadClass(a.percent);
    const fillWidth = Math.min(a.percent, 100);
    const initials = (a.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const color = avatarColor(a.name);

    const card = document.createElement('div');
    card.className = 'analyst-card';
    card.dataset.id = a.id;

    const avatarHtml = a.photoUrl
      ? `<img src="${a.photoUrl}" alt="${a.name}"
             onerror="this.style.display='none';this.nextSibling.style.display='flex'"
         ><div class="avatar-initials" style="background:${color};display:none">${initials}</div>`
      : `<div class="avatar-initials" style="background:${color}">${initials}</div>`;

    const gradeHtml = a.grade
      ? `<div class="analyst-grade">${a.grade}</div>`
      : '';

    const foulsVal = a.foulsCount || 0;
    const thanksVal = a.thanksCount || 0;
    const metricsHtml = `
      <div class="analyst-metrics">
        <div class="analyst-metric fouls-metric">
          <span class="m-val">${foulsVal || '—'}</span>
          <span class="m-lbl">Фолы</span>
        </div>
        <div class="analyst-metric thanks-metric">
          <span class="m-val">${thanksVal || '—'}</span>
          <span class="m-lbl">Благодарность</span>
        </div>
      </div>`;

    card.innerHTML = `
      <div class="analyst-avatar">${avatarHtml}</div>
      <div class="analyst-name">${a.name}</div>
      ${gradeHtml}
      <div class="percent-bar-wrap">
        <div class="percent-bar-fill ${cls}" style="width:${fillWidth}%"></div>
      </div>
      <div class="percent-label ${cls}">${a.percent}%</div>
      ${metricsHtml}
    `;

    card.addEventListener('click', () => onSelect(a, card));
    container.appendChild(card);
  });
}

function renderLoadStages(panelId, analyst) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const STAGE_ORDER = ['ТЗ', 'Ждем оплату', 'В настройке', 'Активные задачи', 'Мелкие задачи'];
  const grouped = {};
  STAGE_ORDER.forEach(s => { grouped[s] = []; });
  (analyst.projects || []).forEach(p => {
    if (grouped[p.stage] !== undefined) grouped[p.stage].push(p);
  });

  panel.innerHTML = `
    <h4>${analyst.name} — ${analyst.percent}% загрузки</h4>
    <div class="load-stages-board">
      ${STAGE_ORDER.map(stage => `
        <div class="load-stage-col">
          <div class="load-stage-header">
            <span>${stage}</span>
            <span class="stage-count">${grouped[stage].length}</span>
          </div>
          <div class="load-stage-projects">
            ${grouped[stage].length
              ? grouped[stage].map(p => `<div class="load-project-card">${p.title}</div>`).join('')
              : '<div class="no-projects">Нет проектов</div>'
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;
  panel.style.display = 'block';
}
