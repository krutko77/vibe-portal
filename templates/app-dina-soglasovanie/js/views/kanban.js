// Канбан конкретного типа: 3 колонки + фильтр.

const STATUSES = [
  { key: 'draft',  title: 'Черновик',        cssMod: 'draft'  },
  { key: 'review', title: 'На согласовании', cssMod: 'review' },
  { key: 'done',   title: 'Согласован',      cssMod: 'done'   }
];

const SORTS = [
  { key: 'date-desc', title: 'Сначала новые' },
  { key: 'date-asc',  title: 'Сначала старые' },
  { key: 'amount-desc', title: 'По сумме: ↓' },
  { key: 'amount-asc',  title: 'По сумме: ↑' }
];

// Локальное состояние фильтра (живёт в рамках одной сессии)
const state = {
  sort: 'date-desc',
  from: '',
  to: ''
};

export function renderKanban({ type, requests }) {
  const root = document.createElement('div');

  const header = `
    <h1 class="page-title">${type.title}</h1>
    <p class="page-subtitle">Доска заявок на согласование. Всего: ${requests.length}.</p>
  `;

  const toolbar = `
    <div class="toolbar">
      <div class="toolbar__group">
        <span class="toolbar__label">Сортировка</span>
        <select class="select" data-role="sort">
          ${SORTS.map(s => `<option value="${s.key}" ${s.key === state.sort ? 'selected' : ''}>${s.title}</option>`).join('')}
        </select>
      </div>
      <div class="toolbar__group">
        <span class="toolbar__label">Период</span>
        <input class="input" type="date" data-role="from" value="${state.from}">
        <span class="toolbar__label">—</span>
        <input class="input" type="date" data-role="to" value="${state.to}">
      </div>
      <button class="btn btn--ghost" data-role="reset">Сбросить</button>
      <div style="flex:1"></div>
      <button class="btn btn--primary" data-role="create">+ Новая заявка</button>
    </div>
  `;

  root.innerHTML = header + toolbar + `<div data-role="board"></div>`;

  const boardEl = root.querySelector('[data-role="board"]');
  renderBoard(boardEl, requests);

  // Интерактив фильтра
  root.querySelector('[data-role="sort"]').addEventListener('change', e => {
    state.sort = e.target.value;
    renderBoard(boardEl, requests);
  });
  root.querySelector('[data-role="from"]').addEventListener('change', e => {
    state.from = e.target.value;
    renderBoard(boardEl, requests);
  });
  root.querySelector('[data-role="to"]').addEventListener('change', e => {
    state.to = e.target.value;
    renderBoard(boardEl, requests);
  });
  root.querySelector('[data-role="reset"]').addEventListener('click', () => {
    state.sort = 'date-desc';
    state.from = '';
    state.to = '';
    root.querySelector('[data-role="sort"]').value = state.sort;
    root.querySelector('[data-role="from"]').value = '';
    root.querySelector('[data-role="to"]').value = '';
    renderBoard(boardEl, requests);
  });
  root.querySelector('[data-role="create"]').addEventListener('click', () => {
    alert('Создание заявки — следующим шагом. Сначала согласуем поля карточки и маршрут.');
  });

  return root;
}

function renderBoard(boardEl, requests) {
  const filtered = applyFilter(requests);
  boardEl.className = 'kanban';
  boardEl.innerHTML = STATUSES.map(s => {
    const items = filtered.filter(r => r.status === s.key);
    return `
      <section class="column column--${s.cssMod}">
        <header class="column__head">
          <span class="column__title">${s.title}</span>
          <span class="column__count">${items.length}</span>
        </header>
        <div class="column__body">
          ${items.length ? items.map(cardHTML).join('') : emptyHTML(s.key)}
        </div>
      </section>
    `;
  }).join('');
}

function applyFilter(requests) {
  let list = [...requests];

  if (state.from) list = list.filter(r => r.createdAt >= state.from);
  if (state.to)   list = list.filter(r => r.createdAt <= state.to);

  switch (state.sort) {
    case 'date-asc':    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); break;
    case 'amount-desc': list.sort((a, b) => (b.amount || 0) - (a.amount || 0)); break;
    case 'amount-asc':  list.sort((a, b) => (a.amount || 0) - (b.amount || 0)); break;
    case 'date-desc':
    default:            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return list;
}

function cardHTML(r) {
  const amount = r.amount != null ? formatMoney(r.amount) : '';
  const ageCls = ageClass(r);
  const stage  = r.status === 'review' && r.stage
    ? `<span class="card__stage ${ageCls}">⏳ ${r.stage}${r.stageAgeDays != null ? ` · ${r.stageAgeDays}д` : ''}</span>`
    : '';
  const date   = formatDate(r.createdAt);
  return `
    <article class="card ${ageCls === 'stage--red' ? 'card--alert' : ''}" data-id="${r.id}">
      <div class="card__num">${r.num}</div>
      <div class="card__title">${r.title}</div>
      <div class="card__row">
        ${amount ? `<span class="card__amount">${amount}</span>` : '<span class="card__author">&nbsp;</span>'}
        ${stage}
      </div>
      <div class="card__row">
        <span class="card__author">${r.author}</span>
        <span>${date}</span>
      </div>
    </article>
  `;
}

function ageClass(r) {
  if (r.status !== 'review' || r.stageAgeDays == null) return '';
  if (r.stageAgeDays >= 5) return 'stage--red';
  if (r.stageAgeDays >= 2) return 'stage--yellow';
  return 'stage--green';
}

function emptyHTML(status) {
  const hints = {
    draft:  'Пока нет черновиков',
    review: 'Никто не ждёт согласования',
    done:   'Пока нет согласованных'
  };
  return `<div class="empty">${hints[status]}</div>`;
}

function formatMoney(v) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₽';
}
function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
