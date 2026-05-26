// src/public/js/timesheet.js

let tsData = { analysts: [], workDays: [], marks: {} };
let tsMonthOffset = 0;
let tsDropdown = null;

function getTsMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + tsMonthOffset, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function updateTsLabel() {
  const ym = getTsMonth();
  const [y, m] = ym.split('-').map(Number);
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const el = document.getElementById('ts-month-label');
  if (el) el.textContent = `${names[m-1]} ${y}`;
}

function tsPrevMonth() { tsMonthOffset--; updateTsLabel(); loadTimesheet(); }
function tsNextMonth() { tsMonthOffset++; updateTsLabel(); loadTimesheet(); }

async function loadTimesheet() {
  const wrap = document.getElementById('ts-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const res = await fetch(`/api/timesheet?month=${getTsMonth()}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    tsData = await res.json();
    renderTsTable();
  } catch (err) {
    wrap.innerHTML = `<div class="error-msg">Ошибка: ${err.message}</div>`;
  }
}

const DOW_RU = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

function getTsClass(v) {
  if (v === 'Б') return 'ts-sick';
  if (v === 'Н') return 'ts-absent';
  if (v && !isNaN(Number(v))) return Number(v) === 8 ? 'ts-hours ts-hours-full' : 'ts-hours ts-hours-part';
  return '';
}

function calcTotal(analystId) {
  let t = 0;
  tsData.workDays.forEach(d => {
    const v = tsData.marks[`${analystId}_${d}`] || '';
    const n = Number(v);
    if (v !== '' && !isNaN(n)) t += n;
  });
  return t;
}

function avatarColorTs(name) {
  const palette = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
  let h = 0;
  for (const c of (name || '')) h = ((h << 5) - h) + c.charCodeAt(0);
  return palette[Math.abs(h) % palette.length];
}

function renderTsTable() {
  const wrap = document.getElementById('ts-wrap');
  if (!wrap) return;
  const { analysts, workDays, marks } = tsData;

  let head = '<tr>'
    + '<th class="ts-th ts-name-h">Аналитик</th>'
    + '<th class="ts-th ts-sched-h">График МСК</th>';
  workDays.forEach(d => {
    const date = new Date(d + 'T00:00:00');
    head += `<th class="ts-th ts-day-h" title="Поставить 8 всем за этот день">`
      + `${DOW_RU[date.getDay()]}<br><b>${date.getDate()}</b>`
      + `<button class="ts-col-fill-btn" onclick="tsColFill(event,'${d}')">↓8</button>`
      + `</th>`;
  });
  head += '<th class="ts-th ts-total-h">Итого</th></tr>';

  let rows = '';
  let lastDept = null;
  for (const a of analysts) {
    if (a.dept !== lastDept) {
      rows += `<tr class="ts-dept-sep"><td colspan="${2 + workDays.length + 1}">${a.dept}</td></tr>`;
      lastDept = a.dept;
    }
    const sched = marks[`sched_${a.id}`] ?? a.schedule ?? '';
    const initials = (a.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const color = avatarColorTs(a.name);
    const avatarHtml = a.photoUrl
      ? `<img src="${a.photoUrl}" class="ts-avatar-img" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><div class="ts-avatar-init" style="background:${color};display:none">${initials}</div>`
      : `<div class="ts-avatar-init" style="background:${color}">${initials}</div>`;

    let cells = '';
    workDays.forEach(d => {
      const key = `${a.id}_${d}`;
      const val = marks[key] || '';
      const comment = marks[`${key}_c`] || '';
      const titleAttr = comment ? ` title="${comment.replace(/"/g,'&quot;')}"` : '';
      cells += `<td class="ts-cell ${getTsClass(val)}" data-id="${a.id}" data-date="${d}"${titleAttr} onclick="tsCellClick(event,this)">${val}</td>`;
    });
    const total = calcTotal(a.id);
    rows += `<tr class="ts-row">
      <td class="ts-name-cell">
        <div class="ts-analyst">
          <div class="ts-avatar">${avatarHtml}</div>
          <span>${a.name}</span>
        </div>
      </td>
      <td class="ts-sched-cell" data-id="${a.id}" onclick="tsSchedClick(event,this)" title="Нажмите для редактирования">${sched || '<span style="color:#94a3b8">—</span>'}</td>
      ${cells}
      <td class="ts-total-cell" id="ts-total-${a.id}">${total > 0 ? total + ' ч' : '—'}</td>
    </tr>`;
  }

  wrap.innerHTML = `<div class="ts-scroll">
    <table class="ts-table">
      <thead>${head}</thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

const TS_OPTIONS = ['Б', 'Н', '1', '2', '3', '4', '5', '6', '7', '8'];

function tsCellClick(event, td) {
  event.stopPropagation();
  closeTsDropdown();

  const menu = document.createElement('div');
  menu.className = 'ts-dropdown';
  menu.id = 'ts-dropdown-el';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'ts-opt ts-opt-clear';
  clearBtn.textContent = '✕ очистить';
  clearBtn.onclick = e => { e.stopPropagation(); saveTsCell(td, '', ''); closeTsDropdown(); };
  menu.appendChild(clearBtn);

  const currentVal = tsData.marks[`${td.dataset.id}_${td.dataset.date}`] || '';

  TS_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'ts-opt' + (opt === 'Б' ? ' ts-opt-sick' : opt === 'Н' ? ' ts-opt-absent' : ' ts-opt-hour');
    if (opt === currentVal) btn.classList.add('ts-opt-current');
    btn.textContent = opt;
    btn.onclick = e => {
      e.stopPropagation();
      closeTsDropdown();

      if (opt === '8') {
        saveTsCell(td, '8', '');
        return;
      }

      // Для всех значений кроме 8 — запрашиваем комментарий
      const isLeave = opt === 'Б' || opt === 'Н';
      const existingComment = (opt === currentVal)
        ? (tsData.marks[`${td.dataset.id}_${td.dataset.date}_c`] || '')
        : '';

      showCommentPopup(td, {
        hint: isLeave
          ? `${opt === 'Б' ? 'Больничный' : 'Отсутствие'} — укажите причину:`
          : `${opt} ч — причина (необязательно):`,
        placeholder: isLeave ? 'Причина...' : 'Например: сокращённый день, отгул...',
        value: existingComment,
        required: isLeave,
        async onSave(comment) {
          saveTsCell(td, opt, comment.trim());
        },
      });
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  tsDropdown = menu;
  const rect = td.getBoundingClientRect();
  menu.style.position = 'fixed';
  const menuH = 10 * 34 + 40;
  const top = (rect.bottom + 4 + menuH > window.innerHeight)
    ? Math.max(4, rect.top - menuH - 4)
    : rect.bottom + 4;
  menu.style.top  = top + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 100) + 'px';
  menu.style.zIndex = '9998';
}

// Поставить 8 всем пустым ячейкам в колонке дня
async function tsColFill(event, date) {
  event.stopPropagation();
  const saves = [];
  for (const a of tsData.analysts) {
    const key = `${a.id}_${date}`;
    if (!tsData.marks[key]) {
      const td = document.querySelector(`td[data-id="${a.id}"][data-date="${date}"]`);
      if (td) saves.push(saveTsCell(td, '8', ''));
    }
  }
  await Promise.all(saves);
}

function tsSchedClick(event, td) {
  event.stopPropagation();
  const id = td.dataset.id;
  const current = tsData.marks[`sched_${id}`] ?? tsData.analysts.find(a => String(a.id) === id)?.schedule ?? '';
  showCommentPopup(td, {
    hint: 'График работы МСК:',
    placeholder: '08:00 - 17:00',
    value: current,
    required: false,
    async onSave(newVal) {
      await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analystId: Number(id), schedule: newVal }),
      });
      tsData.marks[`sched_${id}`] = newVal;
      td.innerHTML = newVal || '<span style="color:#94a3b8">—</span>';
    },
  });
}

function closeTsDropdown() {
  if (tsDropdown) { tsDropdown.remove(); tsDropdown = null; }
}
document.addEventListener('click', closeTsDropdown);

async function saveTsCell(td, value, comment) {
  const analystId = td.dataset.id;
  const date = td.dataset.date;
  await fetch('/api/timesheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analystId: Number(analystId), date, value, comment }),
  });
  const key = `${analystId}_${date}`;
  if (value === '') {
    delete tsData.marks[key];
    delete tsData.marks[`${key}_c`];
  } else {
    tsData.marks[key] = value;
    if (comment) tsData.marks[`${key}_c`] = comment;
    else delete tsData.marks[`${key}_c`];
  }
  td.textContent = value;
  td.className = `ts-cell ${getTsClass(value)}`;
  if (comment) td.title = comment; else td.removeAttribute('title');
  const total = calcTotal(analystId);
  const el = document.getElementById(`ts-total-${analystId}`);
  if (el) el.textContent = total > 0 ? total + ' ч' : '—';
}
