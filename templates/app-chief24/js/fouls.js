// src/public/js/fouls.js

let foulsData = { analysts: [], marks: {}, monthlyFouls: {}, monthlyChart: {} };
let foulsWeekOffset = 0;
let foulsChart = null;

function getWeekDays(offset) {
  const now = new Date();
  const day = now.getDay() || 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - day + 1 + offset * 7);
  const days = [];
  for (let i = 0; i < 5; i++) { // Mon-Fri only
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push(d);
  }
  return days;
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isToday(d) {
  const t = new Date();
  return d.getDate()===t.getDate() && d.getMonth()===t.getMonth() && d.getFullYear()===t.getFullYear();
}

function fmtDayShort(d) {
  const w = ['Пн','Вт','Ср','Чт','Пт'];
  const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return `${w[d.getDay()-1]}<br>${d.getDate()} ${m[d.getMonth()]}`;
}

async function loadFouls() {
  const days = getWeekDays(foulsWeekOffset);
  const from = fmtDate(days[0]);
  const to   = fmtDate(days[4]);
  try {
    const res = await fetch(`/api/fouls?from=${from}&to=${to}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    foulsData = await res.json();
    renderFoulsTable(days);
    renderFoulsChart();
  } catch (err) {
    const w = document.getElementById('fouls-table-wrap');
    if (w) w.innerHTML = `<div class="error-msg">Ошибка: ${err.message}</div>`;
  }
}

function renderFoulsChart() {
  const canvas = document.getElementById('fouls-month-chart');
  if (!canvas) return;
  const { monthlyChart, analysts } = foulsData;
  if (!monthlyChart || !analysts || analysts.length === 0) return;
  const months = Object.keys(monthlyChart).sort();
  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    const names = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    return `${names[parseInt(mo)-1]} ${y}`;
  });

  const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'];
  const datasets = analysts.map((a, i) => ({
    label: a.name,
    data: months.map(m => monthlyChart[m]?.[String(a.id)] || 0),
    backgroundColor: colors[i % colors.length],
    borderRadius: 4,
  }));

  if (foulsChart) foulsChart.destroy();
  foulsChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: { title: ctx => `${ctx[0].dataset.label} — ${ctx[0].label}` } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { stacked: false },
      },
    },
  });
}

const DAY_COLS = [
  ['plan','План'],['fact','Факт'],['lurv','ЛУРВ'],['resume','Резюме'],
];
const DAY_COLS_SHORT = [
  ['plan','План'],['fact','Факт'],['resume','Резюме'],
];

function getCols(dayIndex) {
  return dayIndex === 0 ? DAY_COLS : DAY_COLS_SHORT;
}

function avatarColorF(name) {
  const palette = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
  let h = 0;
  for (const c of (name||'')) h = ((h<<5)-h)+c.charCodeAt(0);
  return palette[Math.abs(h)%palette.length];
}

function renderFoulsTable(days) {
  const wrap = document.getElementById('fouls-table-wrap');
  if (!wrap) return;
  const { analysts, marks, monthlyFouls } = foulsData;

  // Build header
  let headRow1 = `<th rowspan="2" class="ft-th ft-name-h">Аналитик</th>
    <th rowspan="2" class="ft-th ft-dept-h">Отдел</th>
    <th rowspan="2" class="ft-th ft-cnt-h">Фолы<br>мес.</th>`;
  let headRow2 = '';

  days.forEach((d, i) => {
    const cols = getCols(i);
    const today = isToday(d) ? ' ft-today-group' : '';
    headRow1 += `<th colspan="${cols.length}" class="ft-th ft-day-h${today}">${fmtDayShort(d)}</th>`;
    cols.forEach(([col, label]) => {
      headRow2 += `<th class="ft-th ft-sub${today}">${label}</th>`;
    });
  });

  let rows = '';
  let lastDept = null;
  for (const a of analysts) {
    if (a.dept !== lastDept) {
      const totalCols = 3 + days.reduce((s,_,i) => s + getCols(i).length, 0);
      rows += `<tr class="ft-dept-sep"><td colspan="${totalCols}">${a.dept}</td></tr>`;
      lastDept = a.dept;
    }
    const foulsCount = monthlyFouls[String(a.id)] || 0;
    const initials = (a.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const color = avatarColorF(a.name);
    const avatarHtml = a.photoUrl
      ? `<img src="${a.photoUrl}" alt="${a.name}" class="ft-avatar-img" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><div class="ft-avatar-init" style="background:${color};display:none">${initials}</div>`
      : `<div class="ft-avatar-init" style="background:${color}">${initials}</div>`;

    rows += `<tr class="ft-row">
      <td class="ft-name-cell">
        <div class="ft-analyst">
          <div class="ft-avatar">${avatarHtml}</div>
          <div>
            <div class="ft-aname">${a.name}</div>
            ${a.grade ? `<div class="ft-agrade">${a.grade}</div>` : ''}
          </div>
        </div>
      </td>
      <td class="ft-dept-cell">${a.dept}</td>
      <td class="ft-cnt-cell ${foulsCount>0?'has-fouls':''}">${foulsCount||'—'}</td>`;

    days.forEach((d, di) => {
      const cols = getCols(di);
      const dateStr = fmtDate(d);
      const todayCls = isToday(d) ? ' ft-today-col' : '';
      cols.forEach(([col]) => {
        const key = `${dateStr}_${a.id}_${col}`;
        const mark = marks[key] || {};
        const val = mark.value || '';
        const comment = mark.comment || '';
        const isOk   = val === '✓' || val === '✅';
        const isFoul = val === '✗' || val === '❌';
        let cls = `ft-cell${todayCls}`;
        if (isOk)   cls += ' ft-cell-ok';
        if (isFoul) cls += ' ft-cell-foul';
        const titleAttr = (isFoul && comment) ? ` title="${comment.replace(/"/g, '&quot;')}"` : '';
        rows += `<td class="${cls}" data-key="${key}" data-col="${col}"${titleAttr} onclick="foulsEditCell(this)">${val}</td>`;
      });
    });

    rows += `</tr>`;
  }

  wrap.innerHTML = `
    <table class="fouls-table">
      <thead>
        <tr>${headRow1}</tr>
        <tr>${headRow2}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function foulsEditCell(td) {
  const key = td.dataset.key;
  const col = td.dataset.col;
  const mark = foulsData.marks[key] || {};
  const current = mark.value || '';
  const isOk   = current === '✓' || current === '✅';
  const isFoul = current === '✗' || current === '❌';

  if (!current) {
    await saveFoulMark(key, col, '✅', '');
    loadFouls();
  } else if (isOk) {
    showCommentPopup(td, {
      hint: 'Комментарий к нарушению (обязательно):',
      placeholder: 'Напишите что произошло...',
      required: true,
      async onSave(comment) {
        await saveFoulMark(key, col, '❌', comment.trim());
        loadFouls();
      },
    });
  } else if (isFoul) {
    await deleteFoulMark(key);
    loadFouls();
  }
}

async function saveFoulMark(key, col, value, comment) {
  const parts = key.split('_');
  await fetch('/api/fouls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: parts[0], analystId: Number(parts[1]), column: col, value, comment }),
  });
}

async function deleteFoulMark(key) {
  await fetch(`/api/fouls/${key.replace(/_/g, '/')}`, { method: 'DELETE' });
}

function foulsNextWeek() { foulsWeekOffset++; updateWeekLabel(); loadFouls(); }
function foulsPrevWeek() { foulsWeekOffset--; updateWeekLabel(); loadFouls(); }

function updateWeekLabel() {
  const days = getWeekDays(foulsWeekOffset);
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const f = days[0], t = days[4];
  const label = f.getMonth()===t.getMonth()
    ? `${f.getDate()}–${t.getDate()} ${months[f.getMonth()]} ${f.getFullYear()}`
    : `${f.getDate()} ${months[f.getMonth()]} – ${t.getDate()} ${months[t.getMonth()]} ${t.getFullYear()}`;
  const el = document.getElementById('fouls-week-label');
  if (el) el.textContent = label;
}
