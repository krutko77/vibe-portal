// src/public/js/thanks.js

let thanksData = { analysts: [], marks: {}, totalThanks: {}, monthThanks: {}, displayMonth: '' };
let thanksMonthOffset = 0;

function getYearMonth(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatThanksMonth(ym) {
  const [y, m] = ym.split('-');
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${names[parseInt(m) - 1]} ${y}`;
}

function updateThanksLabel() {
  const ym = getYearMonth(thanksMonthOffset);
  const el = document.getElementById('thanks-month-label');
  if (el) el.textContent = formatThanksMonth(ym);
}

async function loadThanks() {
  const ym = getYearMonth(thanksMonthOffset);
  try {
    const res = await fetch(`/api/thanks?month=${ym}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    thanksData = await res.json();
    renderThanksTable();
  } catch (err) {
    const w = document.getElementById('thanks-table-wrap');
    if (w) w.innerHTML = `<div class="error-msg">Ошибка: ${err.message}</div>`;
  }
}

function avatarColorT(name) {
  const palette = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
  let h = 0;
  for (const c of (name || '')) h = ((h << 5) - h) + c.charCodeAt(0);
  return palette[Math.abs(h) % palette.length];
}

function renderThanksTable() {
  const wrap = document.getElementById('thanks-table-wrap');
  if (!wrap) return;
  const { analysts, marks, totalThanks, monthThanks, displayMonth } = thanksData;
  const ym = displayMonth || getYearMonth(thanksMonthOffset);
  const weeks = [1, 2, 3, 4];

  // Header
  let headHtml = `
    <th rowspan="1" class="ft-th ft-name-h">Аналитик</th>
    <th rowspan="1" class="ft-th ft-dept-h">Отдел</th>
    <th rowspan="1" class="ft-th ft-cnt-h">За месяц</th>
    <th rowspan="1" class="ft-th ft-cnt-h">Всего</th>
    ${weeks.map(w => `<th class="ft-th">Неделя ${w}</th>`).join('')}
  `;

  let rows = '';
  let lastDept = null;
  for (const a of analysts) {
    if (a.dept !== lastDept) {
      rows += `<tr class="ft-dept-sep"><td colspan="${4 + weeks.length}">${a.dept}</td></tr>`;
      lastDept = a.dept;
    }
    const total = totalThanks[String(a.id)] || 0;
    const month = monthThanks[String(a.id)] || 0;
    const initials = (a.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const color = avatarColorT(a.name);
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
      <td class="ft-cnt-cell ${month > 0 ? 'has-thanks' : ''}">${month || '—'}</td>
      <td class="ft-cnt-cell ${total > 0 ? 'has-thanks' : ''}">${total || '—'}</td>`;

    for (const w of weeks) {
      const key = `${ym}_${w}_${a.id}`;
      const entry = marks[key];
      const hasStar = !!entry;
      const comment = entry?.comment || '';
      let cls = 'ft-cell';
      if (hasStar) cls += ' ft-cell-thanks';
      const commentHint = comment ? ` title="${comment.replace(/"/g, '&quot;')}"` : '';
      const content = hasStar ? `⭐${comment ? '<span class="ft-comment" title="' + comment.replace(/"/g, '&quot;') + '">🗨️</span>' : ''}` : '';
      rows += `<td class="${cls}" data-key="${key}" data-ym="${ym}" data-week="${w}" data-analyst="${a.id}" onclick="thanksEditCell(this)"${commentHint}>${content}</td>`;
    }
    rows += `</tr>`;
  }

  wrap.innerHTML = `
    <table class="fouls-table thanks-table">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function thanksEditCell(td) {
  const ym = td.dataset.ym;
  const weekNum = td.dataset.week;
  const analystId = td.dataset.analyst;
  const key = td.dataset.key;
  const existing = thanksData.marks[key];

  if (existing) {
    showCommentPopup(td, {
      hint: 'Редактировать (пусто — удалить ⭐):',
      placeholder: 'За что?',
      value: existing.comment || '',
      required: false,
      async onSave(comment) {
        if (!comment.trim()) {
          await fetch(`/api/thanks/${ym}/${weekNum}/${analystId}`, { method: 'DELETE' });
        } else {
          await fetch('/api/thanks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yearMonth: ym, weekNum: Number(weekNum), analystId: Number(analystId), comment }),
          });
        }
        loadThanks();
      },
    });
  } else {
    showCommentPopup(td, {
      hint: 'Благодарность — за что? (необязательно)',
      placeholder: 'Оставьте пустым для просто ⭐',
      required: false,
      async onSave(comment) {
        await fetch('/api/thanks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yearMonth: ym, weekNum: Number(weekNum), analystId: Number(analystId), comment }),
        });
        loadThanks();
      },
    });
  }
}

function thanksPrevMonth() { thanksMonthOffset--; updateThanksLabel(); loadThanks(); }
function thanksNextMonth() { thanksMonthOffset++; updateThanksLabel(); loadThanks(); }
