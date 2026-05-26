// Пульт согласований — фронт
// SPA с hash-роутингом: работает и в iframe Б24, и как отдельная страница.

import { TYPES, getTypeBySlug } from './data/types.js';
import { MOCK_REQUESTS } from './data/mock.js';
import { renderHome } from './views/home.js';
import { renderKanban } from './views/kanban.js';

const app = document.getElementById('app');
const crumbs = document.getElementById('crumbs');

function parseHash() {
  const hash = (location.hash || '#/').replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean); // ['type', 'income']
  return { parts };
}

function setCrumbs(items) {
  crumbs.innerHTML = items
    .map((item, i) => {
      const sep = i > 0 ? '<span class="sep">›</span>' : '';
      if (item.href) {
        return `${sep}<a href="${item.href}">${item.title}</a>`;
      }
      return `${sep}<span>${item.title}</span>`;
    })
    .join('');
}

function router() {
  const { parts } = parseHash();

  if (parts.length === 0) {
    setCrumbs([]);
    app.innerHTML = '';
    app.appendChild(renderHome({ types: TYPES, requests: MOCK_REQUESTS }));
    return;
  }

  if (parts[0] === 'type' && parts[1]) {
    const type = getTypeBySlug(parts[1]);
    if (!type) return renderNotFound();
    setCrumbs([
      { title: 'Главная', href: '#/' },
      { title: type.title }
    ]);
    app.innerHTML = '';
    app.appendChild(renderKanban({ type, requests: MOCK_REQUESTS.filter(r => r.typeSlug === type.slug) }));
    return;
  }

  renderNotFound();
}

function renderNotFound() {
  setCrumbs([{ title: 'Главная', href: '#/' }, { title: 'Не найдено' }]);
  app.innerHTML = `<h1 class="page-title">Страница не найдена</h1>
    <p class="page-subtitle">Проверь ссылку или вернись <a href="#/">на главную</a>.</p>`;
}

window.addEventListener('hashchange', router);
router();
