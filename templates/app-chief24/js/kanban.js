// src/public/js/kanban.js

const PRIORITY_ORDER = { '💎 VIP-клиент': 0, '⭐ Перспективный': 1, '🏳️ Стандарт': 2 };

function sortByPriority(projects) {
  return [...projects].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    return pa - pb;
  });
}

function renderKanban(containerId, columns) {
  const el = document.getElementById(containerId);
  if (!columns || columns.length === 0) {
    el.innerHTML = '<div class="loading">Нет данных</div>';
    return;
  }
  el.innerHTML = columns.map(col => {
    const sorted = sortByPriority(col.projects);
    const cards = sorted.length === 0
      ? '<div class="kanban-card" style="color:#999;font-style:italic">Нет проектов</div>'
      : sorted.map(p => {
          const prioHtml = p.priority ? `<span class="kc-priority">${p.priority}</span>` : '';
          return `<div class="kanban-card">${prioHtml}${p.title}</div>`;
        }).join('');
    return `
    <div class="kanban-col">
      <div class="kanban-col-header">
        <span>${col.name}</span>
        <span class="count">${col.projects.length}</span>
      </div>
      <div class="kanban-cards">${cards}</div>
    </div>`;
  }).join('');
}

function toggleKanban(tab) {
  const board = document.getElementById(`kanban-${tab}`);
  const btn   = document.getElementById(`kanban-toggle-${tab}`);
  if (!board) return;
  const collapsed = board.classList.toggle('kanban-collapsed');
  if (btn) btn.textContent = collapsed ? '▶' : '▼';
}
