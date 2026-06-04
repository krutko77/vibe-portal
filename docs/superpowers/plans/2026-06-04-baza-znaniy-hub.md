# План: хаб «База знаний» (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Объединить вкладки «Курс» и «Материалы» в один хаб «База знаний» с сайдбаром из 4 групп (База знаний / Справочник / Материалы уроков / По модулям), переиспользуя весь существующий контент.

**Architecture:** Новый view `view-kb` = сайдбар (рендерит `kb.js`) + общая область контента. Сайдбар строится из двух статических реестров: `window.COURSE` (структура курса, уже в app.js) и нового `window.KB_REFERENCE` (`content/reference.js` — внемодульные материалы). Контент НЕ переписываем: модули/уроки рендерит существующий `renderCourseContent()`, а справочные материалы — это уже существующие блоки `.materials-page`, которые хаб просто показывает/прячет. Никакого нового API и папки `content/<id>/` на этом этапе — тела уже лежат инлайн (как в спеке: вынос тел в файлы — отдельный поздний шаг).

**Tech Stack:** Vanilla JS (ES modules на бэке, классический скрипт на фронте), Express, существующие CSS-классы портала. Тестов в проекте нет → верификация: `node --check` синтаксиса, `curl` отдачи, ручная проверка в браузере по live-URL.

---

## Важно перед стартом

- Портал **живой** и обслуживается из `/opt/vibe-portal` (не worktree). Правки видны сразу на https://vibe.kiselevgroup.com. Файлы `index.html`/`app.js` активно росли — **перед каждой правкой перечитывай актуальные строки** (номера строк ниже — ориентир, не догма; находи блоки по содержимому).
- После каждой задачи — коммит (правило проекта). Push не нужен.
- `KB_REFERENCE` — это «одно аккуратное место»: чтобы добавить справочный материал, дописываем объект сюда + (если нужна страница) добавляем блок `.materials-page` с тем же `data-sub`.

## Карта файлов

| Файл | Что делает | Действие |
|------|-----------|----------|
| `content/reference.js` | Реестр внемодульных материалов (Старт+Справочник) → `window.KB_REFERENCE` | Создать |
| `panel/public/js/kb.js` | Рендер хаба: сайдбар (4 группы), маршрутизация контента, поиск | Создать |
| `panel/public/index.html` | Навбар (1 таб вместо 2), новая секция `view-kb`, подключить `reference.js`+`kb.js` | Изменить |
| `panel/public/js/app.js` | `setActiveView`: `kb` вместо `course`/`materials`; `window.COURSE`; вызвать `renderKb()` | Изменить |
| `panel/public/css/style.css` | Стили хаба (`.kb-*`) — портировать из прототипа | Изменить |

Маппинг «материал → существующий блок `.materials-page[data-sub]`»:
`how-to`,`publish` → группа **Старт**; `cheatsheet`→Шпаргалки; `claude-md`,`claude-folder`→**Примеры**; `templates-dl`→Шаблоны; `skills`→Скиллы; `links`→Ссылки; `faq`→FAQ.

---

### Task 1: Реестр `content/reference.js`

**Files:**
- Create: `content/reference.js`

- [ ] **Step 1: Создать файл реестра**

Содержит метаданные внемодульных материалов; каждый указывает `sub` = `data-sub` существующего блока `.materials-page`.

```js
/* Реестр внемодульных материалов «Базы знаний» (Старт + Справочник).
 * Чтобы добавить материал: допиши объект сюда + блок .materials-page с тем же data-sub в index.html.
 *   group: 'start' | 'reference'
 *   kind:  start|cheatsheet|example|template|link|skill|faq  (иконка/ярлык + подгруппа Справочника)
 *   sub:   значение data-sub существующего блока .materials-page
 */
window.KB_REFERENCE = [
  { id:'how-to',        group:'start',     kind:'start',      icon:'🧭', sub:'how-to',        title:'Как работать с порталом',        desc:'Вход, навбар, VS Code, проект, чат с Claude, файлы, контейнер.' },
  { id:'publish',       group:'start',     kind:'start',      icon:'🚀', sub:'publish',       title:'Как опубликовать приложение',     desc:'Публикация, кто видит, деплой, относительные пути.' },
  { id:'cheatsheet',    group:'reference', kind:'cheatsheet', icon:'📋', sub:'cheatsheet',    title:'Шпаргалка по Claude Code',        desc:'Горячие клавиши, slash-команды, флаги CLI.' },
  { id:'claude-md',     group:'reference', kind:'example',    icon:'📝', sub:'claude-md',     title:'.md и CLAUDE.md — что это',       desc:'Учебная мини-страница про Markdown и CLAUDE.md.' },
  { id:'claude-folder', group:'reference', kind:'example',    icon:'🧩', sub:'claude-folder', title:'Структура папки .claude',         desc:'Из чего состоит .claude и за что отвечает.' },
  { id:'templates-dl',  group:'reference', kind:'template',   icon:'📦', sub:'templates-dl',  title:'Шаблоны проектов',                desc:'Скачать _base и _b24-single-php.' },
  { id:'skills',        group:'reference', kind:'skill',      icon:'✨', sub:'skills',        title:'Установленные скиллы',            desc:'superpowers, ui-ux-pro-max, claude-memory.' },
  { id:'links',         group:'reference', kind:'link',       icon:'🔗', sub:'links',         title:'Полезные ссылки',                 desc:'claude.ai, VS Code, Vibecode и альтернативы.' },
  { id:'faq',           group:'reference', kind:'faq',        icon:'⚠',  sub:'faq',           title:'FAQ — частые проблемы',           desc:'«Вылетает / не пускает» и другое.' },
];
```

> ⚠ Перед написанием: `grep -n 'data-sub=' panel/public/index.html` — сверить, что список `data-sub` совпадает с актуальным index.html (мог измениться). Лишние блоки добавить в реестр, отсутствующие — убрать.

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check content/reference.js`
Expected: без вывода (OK).

- [ ] **Step 3: Commit**

```bash
git add content/reference.js
git commit -m "kb: реестр внемодульных материалов (Старт + Справочник)"
```

---

### Task 2: CSS хаба (`.kb-*`)

**Files:**
- Modify: `panel/public/css/style.css` (добавить в конец)

- [ ] **Step 1: Добавить стили хаба**

Портировать из прототипа [proto-materials.html](../../../panel/public/proto-materials.html) блоки `.hub`, `.hub-side`, `.hub-group-h`, `.hub-item`, `.ms-search`, плюс адаптацию под классы сетки модулей. Префикс заменить `hub` → `kb` во избежание коллизий. Минимальный набор:

```css
/* ── База знаний (хаб) ── */
.kb-layout { display: grid; grid-template-columns: 234px 1fr; gap: 20px; align-items: start; }
.kb-side { border: 1px solid hsl(var(--border)); background: hsl(var(--smui-surface-1)); position: sticky; top: 70px; }
.kb-group-h { padding: 11px 13px 6px; font-size: 10px; letter-spacing: .13em; text-transform: uppercase; color: hsl(var(--muted-foreground)); opacity: .8; }
.kb-group-h:not(:first-child) { border-top: 1px solid hsl(var(--border)); margin-top: 4px; }
.kb-item { display: flex; align-items: center; gap: 9px; padding: 8px 13px; cursor: pointer; font-size: 13px; color: hsl(var(--muted-foreground)); border-left: 2px solid transparent; }
.kb-item:hover { background: hsl(var(--smui-surface-2)); }
.kb-item.active { color: hsl(var(--foreground)); border-left-color: hsl(var(--primary)); background: hsl(var(--accent)); }
.kb-item .n { margin-left: auto; font-size: 11px; opacity: .55; }
.kb-search { display: flex; align-items: center; gap: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--smui-surface-1)); padding: 9px 13px; margin-bottom: 16px; }
.kb-search input { flex: 1; background: transparent; border: none; outline: none; color: hsl(var(--foreground)); font-family: var(--font-mono); font-size: 13px; }
@media (max-width: 760px) { .kb-layout { grid-template-columns: 1fr; } .kb-side { position: static; } }
```

- [ ] **Step 2: Проверить отдачу CSS**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/css/style.css`
Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add panel/public/css/style.css
git commit -m "kb: стили хаба База знаний (.kb-*)"
```

---

### Task 3: Разметка `view-kb` в index.html + навбар

**Files:**
- Modify: `panel/public/index.html`

- [ ] **Step 1: Навбар — один таб вместо двух**

Найти кнопки `<button class="btn-nav" data-view="course">` и `data-view="materials">` (около строк 40–51, **перечитать**). Заменить ОБЕ на одну:

```html
<button class="btn-nav" data-view="kb" title="База знаний">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
  <span class="btn-nav-text">База знаний</span>
</button>
```

- [ ] **Step 2: Обернуть существующий контент в `view-kb`**

Найти `<section class="view view-course ...">` … и `<section class="view view-materials ...">` … (строки ~263–конец materials, **перечитать границы**). Преобразовать так:
- Создать новую обёртку `<section class="view view-kb hidden" data-view="kb">` с разметкой хаба:

```html
<section class="view view-kb hidden" data-view="kb">
  <div class="kb-search">
    <span>🔎</span>
    <input id="kb-search" placeholder="Поиск по материалам…" />
    <span class="k">/</span>
  </div>
  <div class="kb-layout">
    <aside class="kb-side" id="kb-side"></aside>
    <main class="kb-content" id="kb-content">
      <!-- область курса (переиспользуем существующий рендер) -->
      <div class="course-layout" id="kb-course-host">
        <main class="course-content" id="course-content"></main>
      </div>
      <!-- ниже сюда ПЕРЕНОСЯТСЯ все существующие блоки .materials-page как есть -->
    </main>
  </div>
</section>
```
- Перенести ВСЕ блоки `<div class="materials-page" data-sub="...">…</div>` внутрь `#kb-content` (после `#kb-course-host`), **не меняя их содержимого**.
- Удалить старую обёртку `view-materials` и её `.materials-subnav` (сайдбар хаба заменяет подвкладки).
- Удалить старую `view-course` обёртку и её `.course-side` (`#course-tree`) — дерево заменяется сайдбаром хаба; оставить только `#course-content` (перенесён в `#kb-course-host`).

- [ ] **Step 3: Подключить скрипты**

Найти (хвост, ~1425) `<script src="/js/lessons-m1.js"></script>` и `<script src="/js/app.js"></script>`. Между ними добавить:

```html
<script src="/content/reference.js"></script>
<script src="/js/kb.js"></script>
```

> `content/` ещё не отдаётся статикой — это чинит Task 5. Пока скрипт даст 404, это ок до Task 5.

- [ ] **Step 4: Проверить, что страница отдаётся**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/`
Expected: `200`

- [ ] **Step 5: Commit**

```bash
git add panel/public/index.html
git commit -m "kb: разметка view-kb (сайдбар+контент), 1 таб База знаний, перенос materials-page"
```

---

### Task 4: Логика хаба `kb.js`

**Files:**
- Create: `panel/public/js/kb.js`

- [ ] **Step 1: Написать рендер хаба**

Опирается на `window.COURSE`, `window.KB_REFERENCE`, существующие `window.renderCourseContent`/`courseSelected` (см. Task 6 — их надо экспонировать) и блоки `.materials-page`.

```js
/* Хаб «База знаний»: сайдбар (4 группы) + маршрутизация контента. */
(function () {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const REF = () => window.KB_REFERENCE || [];
  const COURSE = () => window.COURSE || [];
  const refByGroup = (g) => REF().filter(r => r.group === g);

  // активный пункт: 'ref:<id>' | 'mod:<mid>' | 'mod:<mid>.<part>' | 'all:materials|homework|meetup'
  let active = localStorage.getItem('vibe.kb.sel') || ('ref:' + (REF()[0] && REF()[0].id));

  function moduleCount(mid) {
    const m = COURSE().find(x => x.id === mid); if (!m) return 0;
    return (m.lessons?.length||0) + (m.materials?1:0) + (m.homework?1:0) + (m.meetup?1:0) + (m.bonus?1:0);
  }

  function renderSide() {
    const item = (id, icon, label, n) =>
      `<div class="kb-item${active===id?' active':''}" data-id="${id}">
         <span>${icon}</span><span>${esc(label)}</span>${n!=null?`<span class="n">${n}</span>`:''}</div>`;
    let h = '';
    h += '<div class="kb-group-h">База знаний</div>';
    refByGroup('start').forEach(r => h += item('ref:'+r.id, r.icon, r.title, null));
    h += '<div class="kb-group-h">Справочник</div>';
    refByGroup('reference').forEach(r => h += item('ref:'+r.id, r.icon, r.title, null));
    h += '<div class="kb-group-h">Материалы уроков</div>';
    h += item('all:materials', '📚', 'Все материалы', COURSE().filter(m=>m.materials).length);
    h += item('all:homework',  '📝', 'Все домашние задания', COURSE().filter(m=>m.homework).length);
    h += item('all:meetup',    '🎥', 'Все мастер-классы', COURSE().filter(m=>m.meetup).length);
    h += '<div class="kb-group-h">По модулям</div>';
    COURSE().forEach(m => h += item('mod:'+m.id, '📦', m.id.toUpperCase()+' · '+m.title, moduleCount(m.id)));
    $('#kb-side').innerHTML = h;
    $$('#kb-side .kb-item').forEach(el => el.onclick = () => select(el.dataset.id));
  }

  function showMaterialsPage(sub) {
    $('#kb-course-host').style.display = 'none';
    $$('#kb-content .materials-page').forEach(p => p.classList.toggle('hidden', p.dataset.sub !== sub));
  }
  function showCourse() {
    $$('#kb-content .materials-page').forEach(p => p.classList.add('hidden'));
    $('#kb-course-host').style.display = '';
  }

  function renderAll(part) {
    // сквозной вид: карточки по модулям, ведут на mod:<id>.<part>
    showCourse();
    const label = {materials:'Все материалы', homework:'Все домашние задания', meetup:'Все мастер-классы'}[part];
    let h = `<div class="page-meta">БАЗА ЗНАНИЙ · СКВОЗНОЙ ВИД</div><h1 class="page-h1">${label}</h1>
             <p class="page-lead">Один список по всем модулям сразу.</p><div class="course-modules">`;
    COURSE().forEach(m => {
      if (!m[part]) return;
      const txt = part==='meetup' ? (m.meetup.title+' · '+m.meetup.date) : m[part];
      h += `<a class="course-module" data-go="mod:${m.id}.${part}">
              <div class="course-module-no">${m.id.toUpperCase()}</div>
              <div class="course-module-body"><div class="course-module-title">${esc(m.title)}</div>
              <div class="course-module-desc">${esc(typeof txt==='string'?txt:'')}</div></div>
              <div class="course-module-cta">открыть →</div></a>`;
    });
    h += '</div>';
    $('#course-content').innerHTML = h;
    $$('#course-content [data-go]').forEach(a => a.onclick = () => select(a.dataset.go));
  }

  function select(id) {
    active = id;
    localStorage.setItem('vibe.kb.sel', id);
    renderSide();
    $('#kb-search').value = '';
    if (id.startsWith('ref:')) {
      const r = REF().find(x => 'ref:'+x.id === id);
      if (r) showMaterialsPage(r.sub);
    } else if (id.startsWith('all:')) {
      renderAll(id.split(':')[1]);
    } else if (id.startsWith('mod:')) {
      showCourse();
      window.courseSelect(id.split(':')[1]);  // 'm1' | 'm1.materials' | ...
    }
  }

  function search(q) {
    q = (q||'').trim().toLowerCase();
    if (!q) { select(active); return; }
    showCourse();
    const hits = [];
    REF().forEach(r => { if ((r.title+r.desc).toLowerCase().includes(q)) hits.push({id:'ref:'+r.id, t:r.title, ic:r.icon}); });
    COURSE().forEach(m => {
      m.lessons?.forEach(l => { if (l.title.toLowerCase().includes(q)) hits.push({id:'mod:'+m.id+'.'+l.id, t:m.id.toUpperCase()+' · '+l.title, ic:'📖'}); });
      if (m.title.toLowerCase().includes(q)) hits.push({id:'mod:'+m.id, t:m.id.toUpperCase()+' · '+m.title, ic:'📦'});
    });
    let h = `<div class="page-meta">ПОИСК · «${esc(q)}»</div><h1 class="page-h1">Найдено: ${hits.length}</h1><div class="course-modules">`;
    hits.forEach(x => h += `<a class="course-module" data-go="${x.id}"><div class="course-module-no">${x.ic}</div>
      <div class="course-module-body"><div class="course-module-title">${esc(x.t)}</div></div>
      <div class="course-module-cta">открыть →</div></a>`);
    $('#course-content').innerHTML = h + '</div>';
    $$('#course-content [data-go]').forEach(a => a.onclick = () => select(a.dataset.go));
  }

  window.renderKb = function () {
    if (!$('#kb-side')) return;
    renderSide();
    select(active);
    const s = $('#kb-search'); if (s && !s._wired) { s._wired = true; s.oninput = e => search(e.target.value); }
  };
})();
```

- [ ] **Step 2: Проверить синтаксис**

Run: `node --check panel/public/js/kb.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add panel/public/js/kb.js
git commit -m "kb: логика хаба — сайдбар, маршрутизация контента, поиск, сквозные виды"
```

---

### Task 5: Отдавать `content/` статикой

**Files:**
- Modify: `panel/server.js`

- [ ] **Step 1: Добавить статику для content/**

Перед основной статикой (`express.static(.../public)`, ~строка 782) добавить:

```js
app.use('/content', express.static(path.join(__dirname, '..', 'content'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
```

- [ ] **Step 2: Перезапустить панель и проверить отдачу реестра**

```bash
systemctl restart vibe-panel
sleep 1
curl -s -o /dev/null -w "reference.js: %{http_code}\n" http://127.0.0.1:3020/content/reference.js
```
Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add panel/server.js
git commit -m "kb: отдавать /content статикой (реестр reference.js)"
```

---

### Task 6: Подключить хаб в app.js

**Files:**
- Modify: `panel/public/js/app.js`

- [ ] **Step 1: Экспонировать COURSE и хелперы курса**

После объявления `const COURSE = [ … ];` (после строки ~222) добавить:
```js
window.COURSE = COURSE;
```
Найти `let courseSelected = …`. Заменить чтение/запись на использование общего ключа и добавить публичный хелпер выбора пункта курса (используется из kb.js). После функции `renderCourseContent()` добавить:
```js
// Выбор пункта курса из хаба «База знаний» ('m1' | 'm1.materials' | 'm1.l3' | …)
window.courseSelect = function (sel) {
  courseSelected = sel;
  localStorage.setItem('vibe.course.sel', sel);
  renderCourseContent();   // рендерит в #course-content (теперь внутри #kb-course-host)
};
window.renderCourseContent = renderCourseContent;
```
> Дерево курса (`renderCourseTree`) больше не используется (его заменил сайдбар хаба) — вызов из `renderCourse()` можно удалить или оставить безвредным (нет `#course-tree` → ранний `return`). Предпочтительно: в `renderCourse()` убрать `renderCourseTree()`.

- [ ] **Step 2: Переключатель view — kb вместо course/materials**

Найти `function setActiveView(view)` (~462). Заменить тело:
```js
function setActiveView(view) {
  const allowed = ['vscode', 'projects', 'kb'];
  if (!allowed.includes(view)) view = 'vscode';
  localStorage.setItem('vibe.view', view);
  $$('.btn-nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(s => s.classList.toggle('hidden', s.dataset.view !== view));
  if (view === 'vscode') refreshRecentProjects();
  if (view === 'kb') window.renderKb && window.renderKb();
}
```
Проверить дефолт во `initAuth` (~127): `setActiveView(localStorage.getItem('vibe.view') || 'vscode')` — старое значение `'course'`/`'materials'` отфильтруется в `vscode`. Допустимо.

- [ ] **Step 3: Убрать мёртвый вызов materials-tab**

Найти, где вешается обработчик `.materials-tab` (~1345) и вызов `setActiveMaterialsTab`. Удалить (подвкладок больше нет). Саму функцию `setActiveMaterialsTab` удалить.

- [ ] **Step 4: Проверить синтаксис**

Run: `node --check panel/public/js/app.js`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add panel/public/js/app.js
git commit -m "kb: app.js — view kb вместо course/materials, courseSelect/renderKb хуки"
```

---

### Task 7: E2E проверка и чистка

**Files:** —

- [ ] **Step 1: Перезапуск и smoke-проверки**

```bash
systemctl restart vibe-panel && sleep 1
curl -s -o /dev/null -w "index: %{http_code}\n" http://127.0.0.1:3020/
curl -s -o /dev/null -w "kb.js: %{http_code}\n"  http://127.0.0.1:3020/js/kb.js
curl -s -o /dev/null -w "ref:   %{http_code}\n"  http://127.0.0.1:3020/content/reference.js
curl -sk -o /dev/null -w "nginx: %{http_code}\n" --resolve vibe.kiselevgroup.com:443:127.0.0.1 https://vibe.kiselevgroup.com/
```
Expected: все `200`.

- [ ] **Step 2: Ручная проверка в браузере (залогиниться)**

Чек-лист на https://vibe.kiselevgroup.com:
- В навбаре один таб «База знаний» (нет «Курс»/«Материалы»).
- Сайдбар: 4 группы в порядке База знаний / Справочник / Материалы уроков / По модулям.
- Клик по «Справочник → Шпаргалка» показывает соответствующую страницу.
- Клик по «Модуль 1» показывает овервью модуля; уроки/материалы/домашка/мит-ап открываются.
- «Все материалы» / «Все домашки» / «Все мастер-классы» → карточки по модулям, клик ведёт внутрь.
- Поиск находит и справочные, и уроки.
- Открывается по умолчанию первый пункт «С чего начать».

- [ ] **Step 3: Удалить прототип и папку uroki/ (по желанию пользователя)**

```bash
# прототип больше не нужен после внедрения:
git rm panel/public/proto-materials.html
# uroki/ уже перенесены в materials-page (claude-md/claude-folder) — убрать из корня:
git rm -r uroki/
git commit -m "kb: убрать прототип и папку uroki (контент уехал в Базу знаний)"
```
> ⚠ Перед `git rm -r uroki/` — убедиться, что весь контент uroki действительно есть в блоках `.materials-page` (claude-md/claude-folder). Если нет — сначала перенести.

- [ ] **Step 4: Финальный коммит-проверка**

```bash
git status   # working tree clean
git log --oneline -8
```

---

## Self-Review

- **Покрытие спека:** Меню/4 группы (Task 3,4) ✓; единый реестр `reference.js`+`COURSE` (Task 1,6) ✓; «По модулям» с материалы/домашки/мастер-классы (Task 4 reuse `renderCourseContent`) ✓; сквозной «Материалы уроков» (Task 4 `renderAll`) ✓; «Справочник» с «Примеры» (Task 1: kind=example для claude-md/claude-folder) ✓; объединение в 1 таб (Task 3,6) ✓; uroki переезд (Task 7, уже в materials-page) ✓. Отложено по спеку: вынос тел уроков/материалов в `content/<id>/body.html` + API `/api/kb/*` — НЕ в этом stage (тела остаются инлайн), консистентно с «решением 2».
- **Плейсхолдеры:** нет TODO/TBD; все шаги с кодом или точными командами.
- **Согласованность имён:** `window.COURSE`, `window.courseSelect`, `window.renderCourseContent`, `window.renderKb`, `window.KB_REFERENCE`, id-формат `ref:`/`mod:`/`all:` — едины в Task 1/3/4/6.
- **Риск live-портала:** строки index.html/app.js — ориентир; перед правкой перечитывать.
