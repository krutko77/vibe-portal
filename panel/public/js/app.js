// Vibe panel SPA — структура и поведение в стиле dev-портала.

const $  = (q, ctx = document) => ctx.querySelector(q);
const $$ = (q, ctx = document) => [...ctx.querySelectorAll(q)];

let ME = null;

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { ME = null; renderAuth(); throw new Error('unauthorized'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// GET с защитой от транзиентных пустых ответов nginx (HTTP/2 + активный SSE
// иногда даёт 4xx с пустым телом). Настоящая ошибка Express всегда несёт JSON
// {error}; пустое тело при !ok → ретраим. Возвращает { ok, status, data }.
async function getJsonWithRetry(url, tries = 3) {
  let last = { ok: false, status: 0, data: {} };
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      last = { ok: false, status: 0, data: {} };
      await new Promise(res => setTimeout(res, 250 * (i + 1)));
      continue;
    }
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    last = { ok: r.ok, status: r.status, data };
    // успех или настоящая ошибка с телом — не ретраим
    if (r.ok || (data && data.error)) return last;
    // !ok и пустое/непарсимое тело — транзиент, пробуем ещё
    await new Promise(res => setTimeout(res, 250 * (i + 1)));
  }
  return last;
}

const openModal  = (id) => $('#' + id).classList.remove('hidden');
const closeModal = (id) => $('#' + id).classList.add('hidden');

const escapeHtml = (s) => (s || '').replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
})[c]);

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Кастомный select (вместо системного, в нашей теме) ─────
// Прогрессивное улучшение: прячем нативный <select>, строим дропдаун в дизайне
// портала и синхронизируем через события 'change' (внешний код читает .value
// как обычно). Программная установка value → dispatchEvent('change') обновит UI.
function enhanceSelect(sel) {
  if (!sel || sel.dataset.kg) return;
  sel.dataset.kg = '1';
  sel.classList.add('kg-select-native');
  const wrap = document.createElement('div');
  wrap.className = 'kg-select';
  const chevron = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
  wrap.innerHTML =
    '<button type="button" class="kg-select-btn"><span class="kg-select-label"></span>' + chevron + '</button>' +
    '<div class="kg-select-menu"></div>';
  const btn = wrap.querySelector('.kg-select-btn');
  const label = wrap.querySelector('.kg-select-label');
  const menu = wrap.querySelector('.kg-select-menu');
  const close = () => wrap.classList.remove('open');

  function buildItems() {
    menu.innerHTML = '';
    [...sel.options].forEach(opt => {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'kg-select-item' + (opt.value === sel.value ? ' active' : '');
      it.textContent = opt.textContent;
      it.dataset.value = opt.value;
      it.onclick = () => {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      };
      menu.appendChild(it);
    });
  }
  function syncLabel() {
    const opt = sel.options[sel.selectedIndex];
    label.textContent = opt ? opt.textContent : '';
    [...menu.children].forEach(it => it.classList.toggle('active', it.dataset.value === sel.value));
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (wrap.classList.contains('open')) { close(); return; }
    buildItems(); syncLabel(); wrap.classList.add('open');
  };
  sel.addEventListener('change', syncLabel);
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });

  sel.parentNode.insertBefore(wrap, sel.nextSibling);
  buildItems();
  syncLabel();
}
function enhanceAllSelects(root = document) {
  [...root.querySelectorAll('select.form-input')].forEach(enhanceSelect);
}

// ── Auth rendering ─────────────────────────────────────────

function renderAuth() {
  const isAuth = !!ME;
  document.body.classList.toggle('is-auth', isAuth);
  document.body.classList.toggle('is-admin', !!ME?.isAdmin);
  $('#welcome').classList.toggle('hidden', isAuth);
  $('#main-layout').classList.toggle('hidden', !isAuth);
  if (isAuth) {
    $('#authUsername').textContent = ME.username + (ME.isAdmin ? ' (admin)' : '');
    setActiveView(localStorage.getItem('vibe.view') || 'vscode');
    refreshAll();
  }
}

// ── COURSE: данные программы Vibecoding (M1-M6) ─────────────
const COURSE = [
  {
    id: 'm1', title: 'Старт: Claude, проекты и безопасный фундамент',
    lessons: [
      { id: 'l1', title: 'Что такое Claude и почему именно он · отличие от GPT, Cursor, Codex, DeepSeek' },
      { id: 'l2', title: 'Где и как работать с Claude · лайфхаки и типовые ошибки' },
      { id: 'l3', title: 'В чём волшебство проектов · чаты vs проекты' },
      { id: 'l4', title: 'Как правильно организовать проект, чтобы он подошёл под любую модель' },
      { id: 'l5', title: 'CLAUDE.md — что это, в чём его магия и как написать свой' },
      { id: 'l6', title: 'Skills — зачем нужны и как использовать' },
      { id: 'l7', title: 'Как работать с Claude эффективно и не бояться потерять контекст' },
      { id: 'l8', title: 'Полезные промпты и команды для работы с Claude' },
    ],
    materials: 'Готовый шаблон идеального проекта · CLAUDE.md и системные файлы · список Skills, которые реально работают · подборка полезных промптов.',
    homework: 'Создать первый проект на нашем dev-портале и запустить первый сайт-лендинг.',
    meetup: { date: 'чт 28.05', title: 'Мастер-класс МК-1', desc: 'Три способа начать работу с проектом, как выстроить процесс для команды.' },
  },
  {
    id: 'm2', title: 'Свой dev-портал + Claude в Б24',
    lessons: [
      { id: 'l1', title: 'В чём особенность работы Claude в России и как обеспечить максимальную безопасность' },
      { id: 'l2', title: 'Детальный обзор нашего dev-портала · как мы используем Claude из Битрикс24 и ушли от ChatGPT в браузере' },
      { id: 'l3', title: 'Как мы сделали проекты и файл-опросник для аналитиков и интеграторов, которые в вайбкодинг не уходили' },
      { id: 'l4', title: 'Как оплачивать, регистрировать и обойти блокировку РФ для Claude (или альтернативы)' },
      { id: 'l5', title: 'Достойные альтернативы «без танцев с бубном» — используем структуру Claude, меняем модель «под капотом»' },
      { id: 'l6', title: 'Как я «хитрю» с Claude — лайфхаки для не-программистов' },
    ],
    materials: 'Шаблон проектов для Битрикс24 со Skills и инструкциями · системные файлы для готового dev-портала · 8 шаблонов рабочих проектов · список проверенных площадок для оплаты/SMS/регистрации/«КВН».',
    homework: 'Создать свой dev-портал и получить свой Claude.',
    meetup: { date: 'вт 02.06', title: 'Мастер-класс МК-2', desc: 'Создаю удобное приложение для учеников через dev-портал, в режиме live для вас.' },
  },
  {
    id: 'm3', title: 'Платформа Vibe Code и сравнение инструментов',
    lessons: [
      { id: 'l1', title: 'Платформа vibecode.bitrix24.tech — что даёт и зачем (можно и без неё)' },
      { id: 'l2', title: 'Шаблоны проектов и Skills под Б24-задачи · персональный пресет' },
      { id: 'l3', title: 'Cursor, Codex и DeepSeek для vibecode — как использовать и настроить' },
      { id: 'l4', title: 'Сравнение моделей на одной задаче для Битрикс24 · выводы' },
      { id: 'l5', title: 'Ответ на главный вопрос: а зачем мне вообще платформа vibecode?' },
      { id: 'l6', title: 'Как писать приложения, вообще не используя vibecode' },
      { id: 'l7', title: 'Что такое .env и как «безопасно» хранить API-ключи' },
    ],
    materials: 'Готовый Skill для vibecode от Битрикс24 · 8 шаблонов рабочих проектов на vibecode · бенчмарк Claude/Cursor/Codex/DeepSeek · шаблон .env.',
    homework: 'Создать локальное приложение для Битрикс24 и разместить на своём портале через серверы vibecode.',
    meetup: { date: 'чт 04.06', title: 'Мастер-класс МК-3', desc: 'Делаю «пульт собственника» и публикую его на своём портале.' },
  },
  {
    id: 'm4', title: 'Приложения и дашборды на Битрикс24',
    lessons: [
      { id: 'l1', title: 'REST Битрикс24 для не-программистов · webhook, OAuth, методы' },
      { id: 'l2', title: 'Локальное приложение Б24 · Hello World в карточке сделки' },
      { id: 'l3', title: 'Дашборд: визуализация данных портала · базовый шаблон из apps.kiselevgroup.com' },
      { id: 'l4', title: 'Деплой на свой VPS · SSH, Nginx, домен, SSL' },
      { id: 'l5', title: 'Базы данных без боли · SQLite/Supabase, когда хватает Б24' },
      { id: 'l6', title: 'Внешние интеграции · Telegram-бот → Б24, AI-функции в карточке' },
    ],
    materials: 'Список запросов и файлов, которые нужно скормить Б24-проекту · скрипты деплоя на VPS · Postman-коллекция для REST Б24 · свой дашборд из шаблона apps.kiselevgroup.com.',
    homework: 'Собрать приложение для своей компании (дадим несколько идей).',
    meetup: { date: 'вт 09.06', title: 'Встреча 4', desc: 'Отвечаю на вопросы, разбираем «секретную задачу» онлайн.' },
  },
  {
    id: 'm5', title: 'Как это продавать клиентам',
    lessons: [
      { id: 'l1', title: 'Безопасная работа с клиентскими порталами' },
      { id: 'l2', title: 'Эффект «вау» за 30 минут · сценарий пресейл-встречи в zoom' },
      { id: 'l3', title: 'Цены, рынок, развенчание иллюзий · куда движется рынок и что будет через полгода' },
      { id: 'l4', title: 'Как подготовить спич для клиента на 5 минут' },
      { id: 'l5', title: 'Что реально покупают, а что — только иллюзия' },
      { id: 'l6', title: 'Почему мы не продаём новым клиентам, а только старым и текущим' },
      { id: 'l7', title: 'Почему PDF-презентации — это прошлый век · две стратегии' },
    ],
    materials: 'Примеры наших презентаций клиентам — реальные zoom-встречи · сценарий пресейл-встречи на 30 минут · чек-лист безопасности · готовый спич на 5 минут.',
    homework: 'Составить список 10 идей для приложений + спич для своего приложения на 5 минут.',
    meetup: { date: 'чт 02.07', title: 'Выпускной · Встреча 5', desc: 'Приложение себе на портал, защита live demo.' },
  },
  {
    id: 'm6', title: 'ИИ-инструменты вокруг бизнеса',
    lessons: [
      { id: 'l1', title: 'Что такое n8n · как применять, обзор инструмента' },
      { id: 'l2', title: 'Что такое OpenClaw — плюсы и минусы · как я использую и раскатал на руководителей' },
      { id: 'l3', title: 'Как сделать свою базу знаний — wiki, статьи, графы — и держать её актуальной' },
      { id: 'l4', title: 'RAG и векторные базы знаний · кейс KISELEV GROUP — плюсы и минусы' },
      { id: 'l5', title: 'Что ещё важно знать, чего мне не сказали на обучениях, которые я проходил' },
    ],
    materials: 'Карта применимых ИИ-инструментов вокруг Б24-практики · кейс RAG/wiki из KG · диплом · бонусный урок «одна фраза» после защиты.',
    homework: 'Провести 3 встречи и совершить 1 продажу — отбить стоимость курса.',
    meetup: { date: 'чт 09.07', title: 'Финал · Встреча 6', desc: 'Инсайды KISELEV GROUP, что мы делаем сейчас и куда движемся.' },
    bonus: { title: 'БОНУС-урок', desc: 'Одна фраза, которая заменит всё обучение — открывается только после сдачи выпускной работы.' },
  },
];

// Текущий выбранный пункт. Форматы: "m1.l3" (урок), "m1.materials", "m1.homework", "m1.meetup", "m6.bonus", "intro" (welcome)
let courseSelected = localStorage.getItem('vibe.course.sel') || 'intro';
const courseExpanded = new Set(JSON.parse(localStorage.getItem('vibe.course.exp') || '["m1"]'));

function renderCourse() {
  renderCourseTree();
  renderCourseContent();
}

function renderCourseTree() {
  const tree = $('#course-tree');
  if (!tree) return;
  let html = `
    <button class="course-tree-intro${courseSelected === 'intro' ? ' active' : ''}" data-sel="intro">
      <span class="course-tree-intro-no">★</span>
      <span class="course-tree-intro-title">О курсе</span>
    </button>
  `;
  for (const mod of COURSE) {
    const isOpen = courseExpanded.has(mod.id);
    const modSelected = courseSelected === mod.id;
    html += `
      <div class="course-tree-module${isOpen ? ' is-open' : ''}">
        <button class="course-tree-mod-head${modSelected ? ' active' : ''}" data-mod="${mod.id}">
          <span class="course-tree-caret">▸</span>
          <span class="course-tree-mod-no">${mod.id.toUpperCase()}</span>
          <span class="course-tree-mod-title">${escapeHtml(mod.title)}</span>
        </button>
        <div class="course-tree-mod-body">
          ${mod.lessons.map((lsn, i) => `
            <button class="course-tree-lesson${courseSelected === mod.id + '.' + lsn.id ? ' active' : ''}" data-sel="${mod.id}.${lsn.id}">
              <span class="course-tree-lesson-no">${i + 1}</span>
              <span class="course-tree-lesson-title">${escapeHtml(lsn.title)}</span>
            </button>
          `).join('')}
          <button class="course-tree-card course-tree-card-materials${courseSelected === mod.id + '.materials' ? ' active' : ''}" data-sel="${mod.id}.materials">
            <span class="course-tree-card-icon">📦</span>
            <span>Материалы модуля</span>
          </button>
          <button class="course-tree-card course-tree-card-hw${courseSelected === mod.id + '.homework' ? ' active' : ''}" data-sel="${mod.id}.homework">
            <span class="course-tree-card-icon">✓</span>
            <span>Домашка</span>
          </button>
          ${mod.meetup ? `
            <button class="course-tree-card course-tree-card-mk${courseSelected === mod.id + '.meetup' ? ' active' : ''}" data-sel="${mod.id}.meetup">
              <span class="course-tree-card-icon">★</span>
              <span>${escapeHtml(mod.meetup.title)} · ${escapeHtml(mod.meetup.date)}</span>
            </button>
          ` : ''}
          ${mod.bonus ? `
            <button class="course-tree-card course-tree-card-bonus${courseSelected === mod.id + '.bonus' ? ' active' : ''}" data-sel="${mod.id}.bonus">
              <span class="course-tree-card-icon">🎁</span>
              <span>${escapeHtml(mod.bonus.title)}</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }
  tree.innerHTML = html;
  // bindings
  $$('.course-tree-mod-head', tree).forEach(b => {
    b.onclick = () => {
      const id = b.dataset.mod;
      // Раскрыть если свёрнут + перейти на оверью модуля
      if (!courseExpanded.has(id)) courseExpanded.add(id);
      else if (courseSelected === id) courseExpanded.delete(id);  // повторный клик на уже открытом — свернуть
      localStorage.setItem('vibe.course.exp', JSON.stringify([...courseExpanded]));
      courseSelected = id;
      localStorage.setItem('vibe.course.sel', courseSelected);
      renderCourse();
    };
  });
  $$('[data-sel]', tree).forEach(b => {
    b.onclick = () => {
      courseSelected = b.dataset.sel;
      localStorage.setItem('vibe.course.sel', courseSelected);
      renderCourse();
    };
  });
}

function renderCourseContent() {
  const root = $('#course-content');
  if (!root) return;
  if (courseSelected === 'intro') {
    root.innerHTML = `
      <div class="page-meta">VIBE PORTAL · КУРС</div>
      <h1 class="page-h1">Программа курса <em>Vibecoding</em></h1>
      <p class="page-lead">
        6 модулей: от первого проекта до продажи клиенту. К каждому уроку — конспект,
        к каждому модулю — материалы, домашка и мастер-класс.
        Полная программа: <a href="https://analitik.kiselevgroup.com/vibecoding" target="_blank">analitik.kiselevgroup.com/vibecoding ↗</a>
      </p>
      <div class="course-intro-grid">
        ${COURSE.map(m => `
          <button class="course-intro-card" data-sel="${m.id}" type="button">
            <div class="course-intro-card-no">${m.id.toUpperCase()}</div>
            <div class="course-intro-card-title">${escapeHtml(m.title)}</div>
            <div class="course-intro-card-meta">${m.lessons.length} уроков · ${m.meetup ? escapeHtml(m.meetup.date) : '—'}</div>
            <div class="course-intro-card-cta">Открыть модуль →</div>
          </button>
        `).join('')}
      </div>
    `;
    $$('[data-sel]', root).forEach(b => {
      b.onclick = () => {
        courseSelected = b.dataset.sel;
        localStorage.setItem('vibe.course.sel', courseSelected);
        if (!courseExpanded.has(courseSelected)) {
          courseExpanded.add(courseSelected);
          localStorage.setItem('vibe.course.exp', JSON.stringify([...courseExpanded]));
        }
        renderCourse();
      };
    });
    return;
  }
  const [mId, partRaw] = courseSelected.split('.');
  const mod = COURSE.find(m => m.id === mId);
  if (!mod) { root.innerHTML = '<div class="empty">не найдено</div>'; return; }

  // Модуль (без выбранного урока/карточки) — overview
  if (!partRaw) {
    root.innerHTML = `
      <div class="page-meta">${mod.id.toUpperCase()} · МОДУЛЬ</div>
      <h1 class="page-h1">${escapeHtml(mod.title)}</h1>
      <div class="module-actions">
        <button class="module-action-btn module-action-hw" data-sel="${mod.id}.homework">
          <span class="module-action-icon">✓</span>
          <span class="module-action-body">
            <span class="module-action-label">Домашнее задание</span>
            <span class="module-action-sub">${escapeHtml(mod.homework.slice(0, 90))}${mod.homework.length > 90 ? '…' : ''}</span>
          </span>
        </button>
        <button class="module-action-btn module-action-mat" data-sel="${mod.id}.materials">
          <span class="module-action-icon">📦</span>
          <span class="module-action-body">
            <span class="module-action-label">Материалы модуля</span>
            <span class="module-action-sub">${escapeHtml(mod.materials.slice(0, 90))}${mod.materials.length > 90 ? '…' : ''}</span>
          </span>
        </button>
      </div>
      <h2 class="page-h2">Уроки · ${mod.lessons.length}</h2>
      <div class="module-lessons">
        ${mod.lessons.map((lsn, i) => `
          <button class="module-lesson" data-sel="${mod.id}.${lsn.id}" type="button">
            <span class="module-lesson-no">${i + 1}</span>
            <span class="module-lesson-title">${escapeHtml(lsn.title)}</span>
            <span class="module-lesson-cta">→</span>
          </button>
        `).join('')}
      </div>
      ${mod.meetup ? `
        <h2 class="page-h2">Мастер-класс / встреча</h2>
        <button class="module-action-btn module-action-mk" data-sel="${mod.id}.meetup">
          <span class="module-action-icon">★</span>
          <span class="module-action-body">
            <span class="module-action-label">${escapeHtml(mod.meetup.title)} · ${escapeHtml(mod.meetup.date)}</span>
            <span class="module-action-sub">${escapeHtml(mod.meetup.desc)}</span>
          </span>
        </button>
      ` : ''}
      ${mod.bonus ? `
        <button class="module-action-btn module-action-bonus" data-sel="${mod.id}.bonus" style="margin-top:10px">
          <span class="module-action-icon">🎁</span>
          <span class="module-action-body">
            <span class="module-action-label">${escapeHtml(mod.bonus.title)}</span>
            <span class="module-action-sub">${escapeHtml(mod.bonus.desc)}</span>
          </span>
        </button>
      ` : ''}
    `;
    $$('[data-sel]', root).forEach(b => {
      b.onclick = () => {
        courseSelected = b.dataset.sel;
        localStorage.setItem('vibe.course.sel', courseSelected);
        renderCourse();
      };
    });
    return;
  }

  // Урок
  if (partRaw && partRaw.startsWith('l')) {
    const idx = mod.lessons.findIndex(l => l.id === partRaw);
    if (idx < 0) { root.innerHTML = '<div class="empty">урок не найден</div>'; return; }
    const lsn = mod.lessons[idx];
    const prev = idx > 0 ? mod.lessons[idx - 1] : null;
    const next = idx < mod.lessons.length - 1 ? mod.lessons[idx + 1] : null;
    const note = (window.LESSON_NOTES || {})[courseSelected];
    const body = note
      ? `<div class="lesson-note">${note}</div>`
      : `<div class="course-placeholder">
        <div class="course-placeholder-icon">📝</div>
        <div class="course-placeholder-title">Конспект готовится</div>
        <div class="course-placeholder-desc">Текстовый конспект и видео появятся здесь после записи мастер-класса. Полная программа — на <a href="https://analitik.kiselevgroup.com/vibecoding" target="_blank">analitik.kiselevgroup.com/vibecoding</a>.</div>
      </div>`;
    root.innerHTML = `
      <div class="page-meta">${mod.id.toUpperCase()} · УРОК ${idx + 1}</div>
      <h1 class="page-h1">${escapeHtml(lsn.title)}</h1>
      ${body}
      <div class="course-nav">
        ${prev ? `<button class="course-nav-prev" data-sel="${mod.id}.${prev.id}">← ${escapeHtml(prev.title.slice(0, 50))}${prev.title.length > 50 ? '…' : ''}</button>` : '<span></span>'}
        ${next ? `<button class="course-nav-next" data-sel="${mod.id}.${next.id}">${escapeHtml(next.title.slice(0, 50))}${next.title.length > 50 ? '…' : ''} →</button>` : '<span></span>'}
      </div>
    `;
    $$('[data-sel]', root).forEach(b => {
      b.onclick = () => {
        courseSelected = b.dataset.sel;
        localStorage.setItem('vibe.course.sel', courseSelected);
        renderCourse();
      };
    });
    return;
  }

  // Карточки: материалы / домашка / встреча / бонус
  const PARTS = {
    materials: { meta: 'МАТЕРИАЛЫ МОДУЛЯ', title: 'Материалы', icon: '📦', body: mod.materials },
    homework:  { meta: 'ДОМАШНЕЕ ЗАДАНИЕ',  title: 'Домашка',   icon: '✓', body: mod.homework },
    meetup:    { meta: 'МАСТЕР-КЛАСС',      title: mod.meetup?.title || 'Встреча', icon: '★', body: mod.meetup ? `${mod.meetup.desc} · <strong>${mod.meetup.date}</strong>` : '' },
    bonus:     { meta: 'БОНУС',             title: mod.bonus?.title || 'Бонус', icon: '🎁', body: mod.bonus?.desc || '' },
  };
  const p = PARTS[partRaw];
  if (!p) { root.innerHTML = '<div class="empty">не найдено</div>'; return; }
  root.innerHTML = `
    <div class="page-meta">${mod.id.toUpperCase()} · ${p.meta}</div>
    <h1 class="page-h1">${p.icon} ${escapeHtml(p.title)}</h1>
    <div class="page-lead">${p.body || '—'}</div>
    <div class="course-placeholder">
      <div class="course-placeholder-icon">📝</div>
      <div class="course-placeholder-title">Файлы и материалы готовятся</div>
      <div class="course-placeholder-desc">Полная подборка появится здесь после старта модуля. Следи за обновлениями на <a href="https://analitik.kiselevgroup.com/vibecoding" target="_blank">analitik.kiselevgroup.com/vibecoding</a>.</div>
    </div>
  `;
}

// ── View tab switcher (VS CODE / Проекты / Курс / Материалы) ──
function setActiveView(view) {
  const allowed = ['vscode', 'projects', 'course', 'materials'];
  if (!allowed.includes(view)) view = 'vscode';
  localStorage.setItem('vibe.view', view);
  $$('.btn-nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(s => s.classList.toggle('hidden', s.dataset.view !== view));
  // подгрузка контента view-зависимо
  if (view === 'vscode') refreshRecentProjects();
  if (view === 'course') renderCourse();
}

function setActiveMaterialsTab(sub) {
  $$('.materials-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  $$('.materials-page').forEach(p => p.classList.toggle('hidden', p.dataset.sub !== sub));
}

async function refreshAll() {
  await Promise.all([
    refreshContainerStatus(),
    refreshProjects(),
    refreshTemplates(),
    ME?.isAdmin ? refreshUsers() : Promise.resolve(),
  ]);
}

// ── Container ──────────────────────────────────────────────

async function refreshContainerStatus() {
  try {
    const me = await api('/api/me');
    ME = { ...ME, ...me };
    const toggle = $('#containerToggleBtn');
    const open = $('#openCodeBtn');
    open.dataset.user = me.username;
    open.dataset.running = me.container?.running ? '1' : '0';
    if (!me.containerPort) {
      toggle.classList.remove('running');
      toggle.classList.add('disabled');
      $('.nav-btn-container-label', toggle).textContent = 'Не создан';
      $('#containerTimerLabel').textContent = '';
      toggle.title = 'Контейнер не создан — обратись к админу';
    } else if (me.container?.running) {
      toggle.classList.add('running');
      toggle.classList.remove('disabled');
      $('.nav-btn-container-label', toggle).textContent = 'Вкл';
      toggle.title = `Запущен ${fmtDate(me.container.startedAt)} · клик → остановить`;
    } else {
      toggle.classList.remove('running', 'disabled');
      $('.nav-btn-container-label', toggle).textContent = 'Выкл';
      $('#containerTimerLabel').textContent = '';
      toggle.title = 'Контейнер остановлен · клик → запустить';
    }
    updateContainerTimer();
  } catch {}
}

// Обновление лейбла «осталось мин:сек до автозакрытия» (idle reaper)
function updateContainerTimer() {
  if (!ME?.container?.running || !ME?.lastActivityAt || !ME?.idleStopMinutes) {
    $('#containerTimerLabel').textContent = '';
    return;
  }
  const last = Date.parse(ME.lastActivityAt);
  const deadline = last + ME.idleStopMinutes * 60 * 1000;
  const ms = deadline - Date.now();
  if (ms <= 0) { $('#containerTimerLabel').textContent = '0:00'; return; }
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  $('#containerTimerLabel').textContent = m + ':' + String(s).padStart(2, '0');
}
setInterval(updateContainerTimer, 1000);

// Открыть VS Code: если контейнер не running — показать модалку, запустить,
// дождаться, потом открыть в новой вкладке. Это убирает «открылось но недоступно».
async function openVsCodeFor(username, folder = null) {
  const url = `/code/${encodeURIComponent(username)}/`
    + (folder ? `?folder=${encodeURIComponent(folder)}` : '');
  const isOwn = ME && ME.username === username;
  const needsStart = isOwn && ME.container && !ME.container.running;
  if (!needsStart) {
    window.open(url, '_blank');
    return;
  }
  $('#container-start-error').classList.add('hidden');
  openModal('modal-container-starting');
  try {
    // Docker создаёт/запускает контейнер. На холодный create — пару секунд.
    await api('/api/container/start', { method: 'POST' });
    // Опросим статус пару раз чтобы убедиться что точно running
    for (let i = 0; i < 10; i++) {
      const me = await api('/api/me');
      if (me.container?.running) { ME = { ...ME, ...me }; break; }
      await new Promise(r => setTimeout(r, 400));
    }
    // Доп. пауза — code-server иногда лезет на TCP не сразу после docker start
    await new Promise(r => setTimeout(r, 600));
    closeModal('modal-container-starting');
    refreshContainerStatus();
    window.open(url, '_blank');
  } catch (e) {
    const err = $('#container-start-error');
    err.textContent = 'Не удалось запустить контейнер: ' + e.message;
    err.classList.remove('hidden');
    setTimeout(() => closeModal('modal-container-starting'), 3000);
  }
}

// ── Projects / templates ───────────────────────────────────

// «Недавние проекты» в VS CODE view — 3 самых свежих по mtime
async function refreshRecentProjects() {
  if (!ME?.username) return;
  try {
    const { projects } = await api('/api/projects');
    projects.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
    const top = projects.slice(0, 3);
    const recentCount = $('#vscodeRecentCount');
    recentCount.textContent = projects.length + ' всего →';
    recentCount.style.cursor = 'pointer';
    recentCount.onclick = () => setActiveView('projects');
    const wrap = $('#vscodeRecentList');
    if (!top.length) {
      wrap.innerHTML = '<div class="empty">пока нет проектов — открой таб «Проекты» чтобы создать</div>';
      return;
    }
    const folderInVs = (n) => `/code/${encodeURIComponent(ME.username)}/?folder=${encodeURIComponent('/home/student/workspace/' + n)}`;
    wrap.innerHTML = `
      <table class="projects-table">
        <thead><tr><th class="th-name">Название</th><th class="th-date">Изменён</th><th class="th-actions">Действия</th></tr></thead>
        <tbody>
          ${top.map(p => `
            <tr data-project="${escapeHtml(p.name)}">
              <td class="td-name">${escapeHtml(p.name)}</td>
              <td>${fmtDate(p.modified)}</td>
              <td class="td-actions">
                <div class="actions">
                <button class="btn btn-sm" data-action="files">📁</button>
                <button class="btn btn-sm" data-action="claude">CLAUDE</button>
                <a class="btn btn-sm" target="_blank" href="${folderInVs(p.name)}">VS Code →</a>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    $$('tbody tr', wrap).forEach(tr => {
      const name = tr.dataset.project;
      $('[data-action="files"]', tr).onclick = () => openExplorer(name);
      $('[data-action="claude"]', tr).onclick = () => openProjectChat(name);
    });
  } catch {}
}

async function refreshProjects() {
  try {
    const { projects } = await api('/api/projects');
    $('#projectsCount').textContent = projects.length;
    const wrap = $('#projectsList');
    if (!projects.length) {
      wrap.innerHTML = '<div class="empty">пока пусто — создай проект из шаблона</div>';
      return;
    }
    // Сортируем по дате создания (новые сверху).
    projects.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));

    const folderInVs = (name) => `/code/${encodeURIComponent(ME.username)}/?folder=${encodeURIComponent('/home/student/workspace/' + name)}`;
    const statusClass = (s) => /боёвой/i.test(s) ? 'status-prod' : (s === 'НОВЫЙ' ? 'status-new' : 'status-other');

    wrap.innerHTML = `
      <table class="projects-table">
        <thead>
          <tr>
            <th class="th-type">Тип</th>
            <th class="th-status">Статус</th>
            <th class="th-name">Название</th>
            <th class="th-owner">Автор</th>
            <th class="th-date">Дата</th>
            <th class="th-actions">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(p => `
            <tr data-project="${escapeHtml(p.name)}" data-published="${p.published ? '1' : ''}" data-pub-url="${escapeHtml(p.publishUrl || '')}">
              <td><span class="pill pill-type">ПРОЕКТ</span></td>
              <td><span class="pill ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
              <td class="td-name">${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.owner)}</td>
              <td>${fmtDate(p.modified)}</td>
              <td class="td-actions">
                <div class="actions">
                <button class="btn btn-sm" data-action="files" title="Файлы">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button class="btn btn-sm" data-action="claude" title="Claude">CLAUDE</button>
                <button class="btn btn-sm" data-action="vscode">VS Code →</button>
                <button class="btn btn-sm" data-action="download" title="Скачать проект (.zip)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="btn btn-sm" data-action="link" title="Открыть приложение">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
                <button class="btn btn-sm" data-action="publish" title="Публикация">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13"/><path d="M5 9l7-7 7 7"/><path d="M5 22h14"/></svg>
                </button>
                <button class="btn btn-sm btn-danger" data-action="delete" title="Удалить">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                </button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    $$('tbody tr', wrap).forEach(tr => {
      const name = tr.dataset.project;
      $('[data-action="files"]', tr).onclick = () => openExplorer(name);
      $('[data-action="claude"]', tr).onclick = () => openProjectChat(name);
      $('[data-action="vscode"]', tr).onclick = () =>
        openVsCodeFor(ME.username, '/home/student/workspace/' + name);
      $('[data-action="download"]', tr).onclick = () => {
        window.location.href = '/api/projects/' + encodeURIComponent(name) + '/download';
      };
      $('[data-action="link"]', tr).onclick = () => {
        if (tr.dataset.published && tr.dataset.pubUrl) window.open(tr.dataset.pubUrl, '_blank');
        else openPublishModal(name);
      };
      $('[data-action="publish"]', tr).onclick = () => openPublishModal(name);
      $('[data-action="delete"]', tr).onclick = async () => {
        if (!confirm(`Удалить проект «${name}»? Он будет перемещён в .deleted/ внутри workspace.`)) return;
        try {
          await api('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' });
          refreshProjects();
        } catch (e) { alert(e.message); }
      };
    });
  } catch {}
}

// ── Publish modal ──────────────────────────────────────────

let PUB_PROJECT = null;

async function openPublishModal(name) {
  PUB_PROJECT = name;
  $('#pub-project').textContent = name;
  $('#pub-error').classList.add('hidden');
  openModal('modal-publish');
  try {
    const s = await api('/api/projects/' + encodeURIComponent(name) + '/publish');
    $('#pub-enabled').checked = s.enabled;
    $('#pub-visibility').value = s.visibility || 'owner';
    $('#pub-visibility').dispatchEvent(new Event('change')); // обновить кастомный дропдаун
    $('#pub-autosleep').checked = s.autosleep !== false;
    renderPubUrl(s);
  } catch (e) { showPubError(e.message); }
}

function renderPubUrl(s) {
  const box = $('#pub-url-box');
  if (s.enabled && s.url) {
    box.classList.remove('hidden');
    $('#pub-url').textContent = location.origin + s.url;
    $('#pub-open').href = s.url;
    $('#pub-status').textContent = s.running ? '● запущено · порт ' + s.port : '○ спит (поднимется при заходе)';
  } else {
    box.classList.add('hidden');
    $('#pub-status').textContent = '';
  }
}

function showPubError(m) { const e = $('#pub-error'); e.textContent = m; e.classList.remove('hidden'); }

async function savePublish() {
  if (!PUB_PROJECT) return;
  $('#pub-error').classList.add('hidden');
  try {
    const body = {
      enabled: $('#pub-enabled').checked,
      visibility: $('#pub-visibility').value,
      autosleep: $('#pub-autosleep').checked,
    };
    await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/publish', { method: 'POST', body });
    const s = await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/publish');
    renderPubUrl(s);
    refreshProjects();
  } catch (e) { showPubError(e.message); }
}

async function redeployPublish() {
  if (!PUB_PROJECT) return;
  $('#pub-error').classList.add('hidden');
  if (!$('#pub-enabled').checked) {
    showPubError('Сначала включи «Опубликовать приложение», потом жми «Деплой».');
    return;
  }
  const btn = $('#pub-redeploy');
  const prev = btn.textContent;
  btn.disabled = true; btn.textContent = 'Деплой…';
  try {
    // 1) сохранить текущие настройки (включит публикацию и поднимет приложение)
    await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/publish', {
      method: 'POST',
      body: {
        enabled: true,
        visibility: $('#pub-visibility').value,
        autosleep: $('#pub-autosleep').checked,
      },
    });
    // 2) форс-рестарт под свежий код
    await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/redeploy', { method: 'POST' });
    const s = await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/publish');
    renderPubUrl(s);
    refreshProjects();
  } catch (e) { showPubError(e.message); }
  finally { btn.disabled = false; btn.textContent = prev; }
}

// ── File explorer ──────────────────────────────────────────

// kind = 'project' | 'template'
async function openExplorer(name, kind = 'project') {
  const overlay = $('#explorer-overlay');
  overlay.dataset.name = name;
  overlay.dataset.kind = kind;

  const isTpl = kind === 'template';
  const folderInside = isTpl
    ? `/home/student/templates/${name}`
    : `/home/student/workspace/${name}`;
  $('#explorer-path').textContent = folderInside + '/';
  // VS Code открывает контейнер залогиненного юзера, для шаблонов — read-only mount.
  $('#explorer-open-vscode').href =
    `/code/${encodeURIComponent(ME.username)}/?folder=${encodeURIComponent(folderInside)}`;

  $('#explorer-tree').innerHTML = '<div class="explorer-loading">загрузка…</div>';
  $('#explorer-view-path').textContent = '← Выберите файл';
  $('#explorer-view-size').textContent = '';
  $('#explorer-view-pre').textContent = '';
  overlay.classList.remove('hidden');
  document.body.classList.add('has-explorer');

  const treeUrl = isTpl
    ? '/api/explore/tree?kind=template&template=' + encodeURIComponent(name)
    : '/api/explore/tree?project=' + encodeURIComponent(name);
  try {
    const { tree } = await api(treeUrl);
    $('#explorer-tree').innerHTML = renderTree(tree, '', true);
    $$('.explorer-node-file', $('#explorer-tree')).forEach(el => {
      el.onclick = () => loadFile(el.dataset.path);
    });
    $$('.explorer-node-dir', $('#explorer-tree')).forEach(el => {
      el.onclick = () => el.parentElement.classList.toggle('collapsed');
    });
  } catch (e) {
    $('#explorer-tree').innerHTML = `<div class="empty">ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

function renderTree(nodes, parentPath, isRoot = false) {
  if (!nodes.length) return isRoot ? '<div class="empty">пусто</div>' : '';
  return '<ul class="explorer-tree-list">' + nodes.map(n => {
    const p = parentPath ? `${parentPath}/${n.name}` : n.name;
    if (n.type === 'dir') {
      return `
        <li class="explorer-tree-item collapsed">
          <div class="explorer-node-dir" data-path="${escapeHtml(p)}">
            <span class="explorer-icon-caret">▸</span>
            <span class="explorer-name">${escapeHtml(n.name)}/</span>
          </div>
          ${renderTree(n.children || [], p)}
        </li>
      `;
    }
    return `
      <li class="explorer-tree-item">
        <div class="explorer-node-file" data-path="${escapeHtml(p)}">
          <span class="explorer-name">${escapeHtml(n.name)}</span>
        </div>
      </li>
    `;
  }).join('') + '</ul>';
}

async function loadFile(relPath) {
  const overlay = $('#explorer-overlay');
  const name = overlay.dataset.name;
  const kind = overlay.dataset.kind || 'project';
  $('#explorer-view-path').textContent = relPath;
  $('#explorer-view-size').textContent = '…';
  $('#explorer-view-pre').textContent = '';
  $$('.explorer-node-file.active', $('#explorer-tree')).forEach(el => el.classList.remove('active'));
  const node = $(`.explorer-node-file[data-path="${CSS.escape(relPath)}"]`, $('#explorer-tree'));
  if (node) node.classList.add('active');
  const fileUrl = kind === 'template'
    ? '/api/explore/file?kind=template&template=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(relPath)
    : '/api/explore/file?project=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(relPath);
  try {
    const data = await api(fileUrl);
    const sizeKb = (data.size / 1024).toFixed(1);
    if (data.binary) {
      $('#explorer-view-size').textContent = `бинарь, ${sizeKb} КБ`;
      $('#explorer-view-pre').textContent = '— бинарный файл, не отображаем —';
    } else if (data.truncated) {
      $('#explorer-view-size').textContent = `${sizeKb} КБ (>200 КБ, не показано)`;
      $('#explorer-view-pre').textContent = '— файл слишком большой, не отображаем —';
    } else {
      $('#explorer-view-size').textContent = `${sizeKb} КБ`;
      $('#explorer-view-pre').textContent = data.content;
    }
  } catch (e) {
    $('#explorer-view-size').textContent = '';
    $('#explorer-view-pre').textContent = 'ошибка: ' + e.message;
  }
}

async function refreshTemplates() {
  try {
    const { templates } = await api('/api/templates');
    const grid = $('#templatesList');
    if (!templates.length) {
      grid.innerHTML = '<div class="empty">шаблоны пока не загружены</div>';
      return;
    }
    grid.innerHTML = templates.map(t => `
      <div class="template-card">
        <div class="t-name">${escapeHtml(t.name)}</div>
        <div class="t-desc">${escapeHtml(t.description) || ' '}</div>
        <div class="t-actions">
          <button class="btn btn-sm" data-tpl-files="${escapeHtml(t.name)}">Файлы</button>
          <button class="btn btn-primary btn-sm" data-tpl="${escapeHtml(t.name)}">Создать проект →</button>
        </div>
      </div>
    `).join('');
    $$('[data-tpl]', grid).forEach(b => {
      b.onclick = () => {
        $('#newproject-tpl').value = b.dataset.tpl;
        $('#newproject-name').value = '';
        $('#newproject-error').classList.add('hidden');
        openModal('modal-newproject');
        setTimeout(() => $('#newproject-name').focus(), 30);
      };
    });
    $$('[data-tpl-files]', grid).forEach(b => {
      b.onclick = () => openExplorer(b.dataset.tplFiles, 'template');
    });
  } catch {}
}

// ── Users (admin) ──────────────────────────────────────────

async function refreshUsers() {
  try {
    const { students } = await api('/api/students');
    const list = $('#users-list');
    if (!students.length) {
      list.innerHTML = '<div class="user-row-empty">учеников ещё нет — нажми «+ Добавить»</div>';
      return;
    }
    list.innerHTML = students.map(s => `
      <div class="user-row">
        <div class="user-row-name">
          ${escapeHtml(s.username)}
          <div class="user-row-meta">
            создан ${fmtDate(s.createdAt)} · порт ${s.containerPort || '—'}
            · активность ${fmtDate(s.lastActivityAt)}
          </div>
        </div>
        <div class="user-row-actions">
          <span class="user-role-pill ${s.role === 'admin' ? 'role-admin' : ''}">${escapeHtml(s.role)}</span>
          <button class="user-row-pwd" data-pwd="${escapeHtml(s.username)}">Пароль</button>
          ${s.username !== ME.username
            ? `<button class="user-row-del" data-del="${escapeHtml(s.username)}">Удалить</button>`
            : ''}
        </div>
      </div>
    `).join('');
    $$('[data-del]', list).forEach(b => {
      b.onclick = () => openDeleteStudentModal(b.dataset.del);
    });
    $$('[data-pwd]', list).forEach(b => {
      b.onclick = () => openResetPasswordModal(b.dataset.pwd);
    });
  } catch {}
}

// ── Theme toggle ───────────────────────────────────────────

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('aif-theme', isDark ? 'dark' : 'light');
}

// ── Login flow ─────────────────────────────────────────────

async function doLogin() {
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const err = $('#login-error');
  err.classList.add('hidden');
  try {
    await api('/api/login', { method: 'POST', body: { username, password } });
    ME = await api('/api/me');
    closeModal('modal-login');
    $('#login-password').value = '';
    renderAuth();
  } catch (e) {
    err.textContent = e.message === 'unauthorized' || /invalid/i.test(e.message)
      ? 'Неверный логин или пароль' : e.message;
    err.classList.remove('hidden');
  }
}

function openDeleteStudentModal(username) {
  $('#del-student-name').textContent = username;
  $('#del-student-error').classList.add('hidden');
  $('#modal-delete-student').dataset.target = username;
  openModal('modal-delete-student');
}

async function doDeleteStudent() {
  const username = $('#modal-delete-student').dataset.target;
  const err = $('#del-student-error');
  err.classList.add('hidden');
  if (!username) return;
  try {
    await api('/api/students/' + encodeURIComponent(username), { method: 'DELETE' });
    closeModal('modal-delete-student');
    refreshUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

function openResetPasswordModal(username) {
  $('#rp-student-name').textContent = username;
  $('#modal-reset-password').dataset.target = username;
  $('#rp-password').value = generatePassword();
  $('#rp-error').classList.add('hidden');
  $('#rp-success-group').classList.add('hidden');
  openModal('modal-reset-password');
  setTimeout(() => $('#rp-password').focus(), 30);
}

async function doResetPassword() {
  const username = $('#modal-reset-password').dataset.target;
  const password = $('#rp-password').value;
  const err = $('#rp-error');
  err.classList.add('hidden');
  $('#rp-success-group').classList.add('hidden');
  if (!username) return;
  try {
    await api('/api/students/' + encodeURIComponent(username) + '/password',
      { method: 'POST', body: { password } });
    // Модалку не закрываем — пароль виден в поле, чтобы admin его передал.
    $('#rp-success-group').classList.remove('hidden');
  } catch (e) {
    err.textContent = e.message === 'password too short'
      ? 'Пароль слишком короткий (минимум 6 символов)' : e.message;
    err.classList.remove('hidden');
  }
}

async function doAddUser() {
  const username = $('#new-username').value.trim();
  const password = $('#new-password').value;
  const role     = $('#new-role').value;
  const err = $('#add-user-error');
  err.classList.add('hidden');
  try {
    await api('/api/students', { method: 'POST', body: { username, password, role } });
    closeModal('modal-add-user');
    $('#new-username').value = '';
    $('#new-password').value = '';
    refreshUsers();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

async function doCreateEmpty() {
  const name = $('#empty-name').value.trim();
  const err = $('#empty-error');
  err.classList.add('hidden');
  try {
    await api('/api/projects/empty', { method: 'POST', body: { name } });
    closeModal('modal-empty');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

// ── «+ Свой проект»: загрузка папки с компа (webkitdirectory) ──
const UPLOAD_SKIP = (rel) => /(^|\/)(node_modules|\.git)(\/|$)/.test(rel);

function pickedUploadFiles() {
  const inp = $('#upload-folder');
  return Array.from(inp.files || []).filter(f => !UPLOAD_SKIP(f.webkitRelativePath || f.name));
}

function updateUploadInfo() {
  const files = pickedUploadFiles();
  const info = $('#upload-info');
  if (!files.length) {
    info.textContent = 'node_modules и .git не загружаются — сделай npm install внутри VS Code.';
    return;
  }
  // Автоподстановка имени проекта из имени выбранной папки
  const nameInp = $('#upload-name');
  const top = (files[0].webkitRelativePath || '').split('/')[0];
  if (!nameInp.value && top) {
    const slug = top.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    if (/^[a-z]/.test(slug)) nameInp.value = slug;
  }
  const bytes = files.reduce((a, f) => a + f.size, 0);
  info.textContent = `${files.length} файлов · ${pcFmtSize(bytes)} (без node_modules/.git)`;
}

async function doUploadProject() {
  const name = $('#upload-name').value.trim();
  const err = $('#upload-error');
  err.classList.add('hidden');
  const files = pickedUploadFiles();
  if (!/^[a-z][a-z0-9_-]{1,50}$/i.test(name)) {
    err.textContent = 'Имя: a-z, 0-9, дефис, подчёркивание (с буквы).';
    err.classList.remove('hidden'); return;
  }
  if (!files.length) {
    err.textContent = 'Выбери папку с файлами.';
    err.classList.remove('hidden'); return;
  }
  const MAX = 90 * 1024 * 1024;
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX) {
    err.textContent = `Слишком большой объём (${pcFmtSize(total)}). Лимит 90 MB — убери лишнее.`;
    err.classList.remove('hidden'); return;
  }
  const btn = $('#upload-submit');
  const oldLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Загрузка…';
  try {
    const fd = new FormData();
    fd.append('name', name);
    for (const f of files) fd.append('files', f, f.webkitRelativePath || f.name);
    const r = await fetch('/api/projects/upload', { method: 'POST', credentials: 'same-origin', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    closeModal('modal-upload');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = oldLabel;
  }
}

let createSelectedTemplate = null;
async function openCreateModal() {
  createSelectedTemplate = null;
  $('#create-name').value = '';
  $('#create-error').classList.add('hidden');
  const wrap = $('#create-templates');
  wrap.innerHTML = '<div class="empty">загрузка…</div>';
  openModal('modal-create');
  try {
    const { templates } = await api('/api/templates/base');
    if (!templates.length) {
      wrap.innerHTML = '<div class="empty">базовые шаблоны не найдены</div>';
      return;
    }
    wrap.innerHTML = templates.map((t, i) => `
      <button class="template-card-pick${i === 0 ? ' active' : ''}" data-name="${escapeHtml(t.name)}" type="button">
        <div class="t-pick-title">${escapeHtml(t.title || t.name)}</div>
        <div class="t-pick-desc">${escapeHtml(t.description || '')}</div>
        <div class="t-pick-folder">${escapeHtml(t.name)}/</div>
      </button>
    `).join('');
    createSelectedTemplate = templates[0].name;
    $$('.template-card-pick', wrap).forEach(b => {
      b.onclick = () => {
        createSelectedTemplate = b.dataset.name;
        $$('.template-card-pick', wrap).forEach(x => x.classList.toggle('active', x === b));
      };
    });
    setTimeout(() => $('#create-name').focus(), 30);
  } catch (e) {
    wrap.innerHTML = `<div class="empty">ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

async function doCreateFromBase() {
  const name = $('#create-name').value.trim();
  const err = $('#create-error');
  err.classList.add('hidden');
  if (!createSelectedTemplate) {
    err.textContent = 'Выбери шаблон';
    err.classList.remove('hidden');
    return;
  }
  try {
    await api('/api/projects/from-template', {
      method: 'POST',
      body: { template: createSelectedTemplate, name },
    });
    closeModal('modal-create');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

async function doCreateProject() {
  const template = $('#newproject-tpl').value;
  const name = $('#newproject-name').value.trim();
  const err = $('#newproject-error');
  err.classList.add('hidden');
  try {
    await api('/api/projects/from-template', {
      method: 'POST', body: { template, name },
    });
    closeModal('modal-newproject');
    refreshProjects();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  $('#themeToggle').onclick = toggleTheme;

  // Modal close
  $$('[data-close]').forEach(b => {
    b.onclick = () => closeModal(b.dataset.close);
  });
  // Модалы закрываются ТОЛЬКО кнопкой «✕» / «Отмена» — не по клику на фон и не по ESC.
  // (Settings-panel закрывается своим крестиком; ESC тоже не трогаем чтобы не
  //  ловить случайное закрытие при редактировании.)

  // Welcome → open login
  $('#welcomeLoginBtn').onclick = () => {
    $('#login-error').classList.add('hidden');
    $('#login-username').value = '';
    $('#login-password').value = '';
    openModal('modal-login');
    setTimeout(() => $('#login-username').focus(), 30);
  };

  // Login submit (кнопкой + Enter)
  $('#login-submit').onclick = doLogin;
  $('#login-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#login-password').focus(); }
  });
  $('#login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
  });

  // Auth-group → logout
  $('#authBox').onclick = async () => {
    if (!confirm('Выйти?')) return;
    await api('/api/logout', { method: 'POST' });
    ME = null;
    $('#settings-panel').classList.remove('open');
    renderAuth();
  };

  // Container toggle (вкл/выкл)
  $('#containerToggleBtn').onclick = async () => {
    const btn = $('#containerToggleBtn');
    if (btn.classList.contains('disabled')) return;
    const running = btn.classList.contains('running');
    const label = $('.nav-btn-container-label', btn);
    label.textContent = running ? 'остановка…' : 'запуск…';
    try {
      await api(running ? '/api/container/stop' : '/api/container/start', { method: 'POST' });
      // дать docker 1-2 сек чтобы статус успел переключиться
      await new Promise(r => setTimeout(r, 800));
      refreshContainerStatus();
    } catch (e) {
      alert(e.message);
      refreshContainerStatus();
    }
  };

  // Settings panel toggle
  $('#settingsBtn').onclick = () => {
    $('#settings-panel').classList.toggle('open');
    if ($('#settings-panel').classList.contains('open')) refreshUsers();
  };
  $('#settings-close').onclick = () => {
    $('#settings-panel').classList.remove('open');
  };

  // Add user
  $('#btn-add-user').onclick = () => {
    $('#new-username').value = '';
    $('#new-password').value = generatePassword();
    $('#new-role').value = 'user';
    $('#add-user-error').classList.add('hidden');
    openModal('modal-add-user');
    setTimeout(() => $('#new-username').focus(), 30);
  };
  $('#add-user-submit').onclick = doAddUser;
  $('#del-student-confirm').onclick = doDeleteStudent;
  $('#rp-submit').onclick = doResetPassword;
  $('#rp-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doResetPassword(); }
  });
  ['new-username', 'new-password'].forEach(id => {
    $('#' + id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doAddUser(); }
    });
  });

  // New project (старая модалка — для секции «Шаблоны» app-*)
  $('#newproject-submit').onclick = doCreateProject;
  $('#newproject-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateProject(); }
  });

  // «+ Свой проект»
  $('#btn-upload').onclick = () => {
    $('#upload-name').value = '';
    $('#upload-folder').value = '';
    $('#upload-error').classList.add('hidden');
    updateUploadInfo();
    openModal('modal-upload');
    setTimeout(() => $('#upload-name').focus(), 30);
  };
  $('#upload-folder').addEventListener('change', updateUploadInfo);
  $('#upload-submit').onclick = doUploadProject;

  // «+ Пустой»
  $('#btn-empty').onclick = () => {
    $('#empty-name').value = '';
    $('#empty-error').classList.add('hidden');
    openModal('modal-empty');
    setTimeout(() => $('#empty-name').focus(), 30);
  };
  $('#empty-submit').onclick = doCreateEmpty;
  $('#empty-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateEmpty(); }
  });

  // «+ Шаблон»
  $('#btn-create').onclick = openCreateModal;
  $('#create-submit').onclick = doCreateFromBase;
  // Publish modal
  $('#pub-save').onclick = savePublish;
  $('#pub-redeploy').onclick = redeployPublish;
  $('#pub-copy').onclick = () => {
    navigator.clipboard?.writeText($('#pub-url').textContent).catch(() => {});
  };
  // Кастомные дропдауны вместо системных <select> (вся всплывающая часть UI)
  enhanceAllSelects();
  $('#create-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateFromBase(); }
  });

  // Explorer close — скрываем панель и убираем body class чтобы dashboard вернулся
  const closeExplorer = () => {
    $('#explorer-overlay').classList.add('hidden');
    document.body.classList.remove('has-explorer');
  };
  $('#explorer-close').onclick = closeExplorer;

  // Tab switcher (view-таб'ы в centre)
  $$('.btn-nav').forEach(b => {
    b.onclick = () => setActiveView(b.dataset.view);
  });
  // Materials sub-tabs
  $$('.materials-tab').forEach(b => {
    b.onclick = () => setActiveMaterialsTab(b.dataset.sub);
  });

  // Open VS Code button (на VS CODE view)
  $('#openCodeBtn').onclick = () => {
    if (!ME) return;
    openVsCodeFor(ME.username);
  };

  // Project chat (left pane)
  $('#btn-close-left').onclick = pcCloseLeft;
  // mode-seg КРАТКО/ПОЛНО
  document.body.classList.toggle('pc-mode-compact', pcState.mode === 'compact');
  $$('.pc-mode-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.mode === pcState.mode);
    b.onclick = () => {
      pcState.mode = b.dataset.mode;
      localStorage.setItem('vibe.pcMode', pcState.mode);
      document.body.classList.toggle('pc-mode-compact', pcState.mode === 'compact');
      $$('.pc-mode-btn').forEach(x => x.classList.toggle('is-active', x.dataset.mode === pcState.mode));
    };
  });
  // Fullscreen toggle
  $('#btn-pc-fullscreen').onclick = () => {
    document.body.classList.toggle('pc-fullscreen');
  };
  // Model dropdown
  $('#pc-model-label').textContent = pcState.model;
  $$('#pc-model-menu .pc-dd-item').forEach(el => {
    el.classList.toggle('active', el.dataset.value === pcState.model);
    el.onclick = () => {
      pcState.model = el.dataset.value;
      localStorage.setItem('vibe.pcModel', pcState.model);
      $('#pc-model-label').textContent = pcState.model;
      $$('#pc-model-menu .pc-dd-item').forEach(x => x.classList.toggle('active', x === el));
      $('#pc-model-dd').classList.remove('open');
    };
  });
  $('#pc-model-btn').onclick = (e) => {
    e.stopPropagation();
    $('#pc-sessions-dd').classList.remove('open');
    $('#pc-model-dd').classList.toggle('open');
  };
  // Attachments
  $('#pc-attach').onclick = () => $('#pc-file-input').click();
  $('#pc-file-input').addEventListener('change', (e) => {
    for (const f of e.target.files) pcUploadFile(f);
    e.target.value = '';
  });
  $('#pc-sessions-btn').onclick = (e) => {
    e.stopPropagation();
    $('#pc-sessions-dd').classList.toggle('open');
  };
  document.addEventListener('click', (e) => {
    if (!$('#pc-sessions-dd').contains(e.target)) $('#pc-sessions-dd').classList.remove('open');
  });
  $('#pc-new-session').onclick = () => {
    pcState.sessionId = null;
    $('#pc-sessions-label').textContent = '— новая —';
    pcClearMessages();
    pcShowEmpty('Новая сессия — напиши первое сообщение.');
    pcEls.input().focus();
  };
  $('#pc-delete-session').onclick = async () => {
    if (!pcState.sessionId) return;
    if (!confirm('Удалить эту сессию? История чата будет потеряна.')) return;
    try {
      const r = await fetch(`/api/project-chat/session/${encodeURIComponent(pcState.sessionId)}?project=${encodeURIComponent(pcState.slug)}`,
        { method: 'DELETE', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'delete failed');
      pcState.sessionId = null;
      await pcLoadSessions();
      pcClearMessages();
      pcShowEmpty('Сессия удалена. Напиши сообщение чтобы начать новую.');
    } catch (e) { alert(e.message); }
  };
  $('#pc-send').onclick = pcSend;
  $('#pc-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pcSend(); }
  });
  $('#pc-input').addEventListener('input', () => {
    const ta = $('#pc-input'); ta.style.height = '';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });

  // Resizers — тяни чтобы изменить ширину левой/правой панелей
  initResizer('#resizer-left', 'left');
  initResizer('#resizer-right', 'right');

  // User chat (right pane)
  $('#btn-toggle-chat').onclick = () => toggleUserChat();
  $('#btn-close-chat').onclick = () => toggleUserChat(true);
  $('#btn-clear-chat').onclick = async () => {
    try {
      await fetch('/api/chat', { method: 'DELETE', credentials: 'same-origin' });
      $('#chat-messages').innerHTML = '';
    } catch {}
  };
  $('#chat-send').onclick = sendChat;
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $('#chat-input').addEventListener('input', () => {
    const ta = $('#chat-input'); ta.style.height = '';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });

  // Init session
  try { ME = await api('/api/me'); } catch { ME = null; }
  renderAuth();
});

function generatePassword() {
  // 10 знаков, без визуально схожих символов (0/O, 1/l/I)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (const b of arr) p += alphabet[b % alphabet.length];
  return p;
}

// ── Project chat (left pane) ────────────────────────────────

const pcEls = {
  pane: () => $('#pane-left'),
  title: () => $('#pc-title'),
  sessionsDd: () => $('#pc-sessions-dd'),
  sessionsBtn: () => $('#pc-sessions-btn'),
  sessionsLabel: () => $('#pc-sessions-label'),
  sessionsMenu: () => $('#pc-sessions-menu'),
  newBtn: () => $('#pc-new-session'),
  delBtn: () => $('#pc-delete-session'),
  messages: () => $('#pc-messages'),
  input: () => $('#pc-input'),
  send: () => $('#pc-send'),
};

const pcState = {
  slug: null,
  sessionId: null,
  streaming: false,
  abort: null,
  toolUseNodes: new Map(),
  attachments: [],  // [{ path, size, mime, name, _uploading? }]
  model: localStorage.getItem('vibe.pcModel') || 'sonnet',
  mode: localStorage.getItem('vibe.pcMode') || 'full',
};

function pcClearMessages() {
  pcEls.messages().innerHTML = '';
  pcState.toolUseNodes.clear();
}

function pcShowEmpty(msg) {
  pcEls.messages().innerHTML = `<div class="pc-empty">${escapeHtml(msg)}</div>`;
}

function pcScrollToBottom() {
  const m = pcEls.messages();
  m.scrollTop = m.scrollHeight;
}

function pcToolArgSummary(tool, input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['file_path', 'path', 'pattern', 'command', 'url', 'query']) {
    if (input[k]) return String(input[k]);
  }
  try { return JSON.stringify(input).slice(0, 120); } catch { return ''; }
}

// Простой markdown → HTML (заголовки, **bold**, *italic*, `code`, ``` fenced, списки, ссылки)
function pcRenderMarkdown(src) {
  if (!src) return '';
  const lines = String(src).split('\n');
  const out = [];
  let i = 0;
  let listType = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const inline = (s) => {
    let t = escapeHtml(s);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (m, txt, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(txt)}</a>`);
    t = t.replace(/`([^`\n]+)`/g, (m, c) => `<code class="md-inline-code">${escapeHtml(c)}</code>`);
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return t;
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] || '';
      const codeLines = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="md-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (h) { closeList(); out.push(`<h${h[1].length + 2} class="md-h md-h${h[1].length}">${inline(h[2])}</h${h[1].length + 2}>`); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { closeList(); out.push('<hr class="md-hr">'); i++; continue; }
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) { if (listType !== 'ol') { closeList(); out.push('<ol class="md-list">'); listType = 'ol'; } out.push(`<li>${inline(ol[1])}</li>`); i++; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) { if (listType !== 'ul') { closeList(); out.push('<ul class="md-list">'); listType = 'ul'; } out.push(`<li>${inline(ul[1])}</li>`); i++; continue; }
    if (/^\s*$/.test(line)) { closeList(); out.push(''); i++; continue; }
    closeList();
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|\s*---+|\s*\d+\.\s|\s*[-*+]\s)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  closeList();
  return out.join('\n');
}

function pcRenderBlock(b) {
  const messages = pcEls.messages();
  const empty = messages.querySelector('.pc-empty');
  if (empty) empty.remove();

  if (b.type === 'text' && b.role === 'user') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-user';
    el.textContent = b.text;
    messages.appendChild(el);
  } else if (b.type === 'text' && b.role === 'assistant') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-assistant md';
    el.innerHTML = pcRenderMarkdown(b.text);
    messages.appendChild(el);
  } else if (b.type === 'thinking') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-thinking';
    el.textContent = b.text;
    messages.appendChild(el);
  } else if (b.type === 'tool_use') {
    const details = document.createElement('details');
    details.className = 'pc-block pc-block-tool';
    const arg = pcToolArgSummary(b.tool, b.input);
    details.innerHTML = `
      <summary>
        <span class="pc-tool-name">🔧 ${escapeHtml(b.tool || '?')}</span>
        <span class="pc-tool-arg">${escapeHtml(arg)}</span>
      </summary>
      <pre class="pc-tool-input">${escapeHtml(JSON.stringify(b.input, null, 2))}</pre>
    `;
    messages.appendChild(details);
    if (b.toolUseId) pcState.toolUseNodes.set(b.toolUseId, details);
  } else if (b.type === 'tool_result') {
    const parent = b.toolUseId && pcState.toolUseNodes.get(b.toolUseId);
    if (parent) {
      if (b.isError) parent.classList.add('is-error');
      const pre = document.createElement('pre');
      pre.textContent = b.content || '(empty)';
      parent.appendChild(pre);
    } else {
      const el = document.createElement('details');
      el.className = 'pc-block pc-block-tool' + (b.isError ? ' is-error' : '');
      el.innerHTML = `<summary><span class="pc-tool-name">← result</span></summary><pre>${escapeHtml(b.content || '')}</pre>`;
      messages.appendChild(el);
    }
  } else if (b.type === 'error') {
    const el = document.createElement('div');
    el.className = 'pc-block pc-block-error';
    el.textContent = b.message || 'Ошибка';
    messages.appendChild(el);
  }
  pcScrollToBottom();
}

function pcRenderSessionList(sessions) {
  const menu = pcEls.sessionsMenu();
  menu.innerHTML = '';
  if (!sessions.length) {
    pcEls.sessionsLabel().textContent = '— новая —';
    const item = document.createElement('div');
    item.className = 'pc-dd-item is-empty';
    item.textContent = 'Сессий пока нет';
    menu.appendChild(item);
    return;
  }
  const shortId = (id) => (id || '').slice(0, 8) || '—';
  const cur = sessions.find(s => s.sessionId === pcState.sessionId);
  pcEls.sessionsLabel().textContent = cur
    ? (cur.title || shortId(cur.sessionId)) + (cur.lockedBy ? ' 🔒' : '')
    : '— новая —';
  for (const s of sessions) {
    const item = document.createElement('button');
    item.className = 'pc-dd-item' + (s.sessionId === pcState.sessionId ? ' active' : '');
    item.type = 'button';
    const title = escapeHtml(s.title || shortId(s.sessionId));
    const lockLabel = s.lockedBy ? ' · 🔒 ' + escapeHtml(s.lockedBy) : '';
    item.innerHTML = `<span class="pc-dd-item-title">${title}</span><span class="pc-dd-item-meta">${escapeHtml(s.createdBy || '')}${lockLabel}</span>`;
    item.addEventListener('click', async () => {
      pcEls.sessionsDd().classList.remove('open');
      if (s.sessionId === pcState.sessionId) return;
      pcState.sessionId = s.sessionId;
      await pcLoadHistory(s.sessionId);
      pcRenderSessionList(sessions);
    });
    menu.appendChild(item);
  }
}

async function pcLoadSessions() {
  try {
    const { ok, status, data } = await getJsonWithRetry(`/api/project-chat/sessions?project=${encodeURIComponent(pcState.slug)}`);
    if (!ok) throw new Error(data.error || `sessions load failed (${status})`);
    pcRenderSessionList(data.sessions || []);
    return data.sessions || [];
  } catch (e) {
    pcShowEmpty('Не удалось загрузить сессии: ' + e.message);
    return [];
  }
}

async function pcLoadHistory(sessionId) {
  pcClearMessages();
  if (!sessionId) { pcShowEmpty('Напиши первое сообщение — сессия создастся.'); return; }
  try {
    const { ok, status, data } = await getJsonWithRetry(`/api/project-chat/session/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(pcState.slug)}`);
    if (!ok) throw new Error(data.error || `history load failed (${status})`);
    if (!data.blocks?.length) pcShowEmpty('Пустая сессия — напиши сообщение.');
    else data.blocks.forEach(pcRenderBlock);
  } catch (e) {
    pcShowEmpty('Не удалось загрузить историю: ' + e.message);
  }
}

async function openProjectChat(slug) {
  pcState.slug = slug;
  pcState.sessionId = null;
  if (pcState.abort) { try { pcState.abort.abort(); } catch {} pcState.abort = null; }
  pcEls.pane().classList.remove('hidden');
  document.body.classList.add('has-left-chat');
  pcEls.title().textContent = 'Чат · ' + slug;
  pcShowEmpty('Загрузка сессий…');
  const sessions = await pcLoadSessions();
  if (sessions.length) {
    pcState.sessionId = sessions[0].sessionId;
    pcRenderSessionList(sessions);
    await pcLoadHistory(pcState.sessionId);
  } else {
    pcShowEmpty('Нет сессий. Напиши первое сообщение — сессия создастся.');
  }
  pcEls.input().focus();
}

function pcCloseLeft() {
  pcEls.pane().classList.add('hidden');
  document.body.classList.remove('has-left-chat');
}

async function pcSend() {
  if (pcState.streaming) return;
  const ta = pcEls.input();
  const text = ta.value.trim();
  if (!text || !pcState.slug) return;

  ta.value = '';
  ta.style.height = '';
  pcState.streaming = true;
  pcEls.send().disabled = true;

  pcRenderBlock({ role: 'user', type: 'text', text });

  const typingEl = document.createElement('div');
  typingEl.className = 'pc-typing';
  typingEl.innerHTML = `<span class="pc-typing-dot">▋</span><span>Claude думает</span><span class="pc-typing-elapsed">0s</span>`;
  pcEls.messages().appendChild(typingEl);
  pcScrollToBottom();

  const startTs = Date.now();
  const elapsedEl = typingEl.querySelector('.pc-typing-elapsed');
  const elapsedTimer = setInterval(() => {
    if (!elapsedEl.isConnected) { clearInterval(elapsedTimer); return; }
    const s = Math.floor((Date.now() - startTs) / 1000);
    elapsedEl.textContent = s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
  }, 1000);

  const ctrl = new AbortController();
  pcState.abort = ctrl;

  try {
    // Прикрепляем пути загруженных файлов в начало текста (claude увидит их по абс. пути)
    const attachLines = pcState.attachments.map(a => `Прикреплён файл: ${a.path}`).join('\n');
    const fullText = attachLines ? `${attachLines}\n\n${text}` : text;
    pcState.attachments = [];
    pcRenderAttachments();
    const resp = await fetch('/api/project-chat/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ project: pcState.slug, sessionId: pcState.sessionId, text: fullText, model: pcState.model }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); errMsg = j.error || errMsg; } catch {}
      typingEl.remove();
      pcRenderBlock({ type: 'error', message: errMsg });
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let typingRemoved = false;
    const removeTyping = () => { if (!typingRemoved) { typingEl.remove(); typingRemoved = true; } };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, sep); buf = buf.slice(sep + 2);
        handlePcSseEvent(raw, removeTyping);
      }
    }
    removeTyping();
    clearInterval(elapsedTimer);
    await pcLoadSessions();
  } catch (e) {
    typingEl.remove();
    clearInterval(elapsedTimer);
    if (e.name !== 'AbortError') pcRenderBlock({ type: 'error', message: 'Сетевая ошибка: ' + e.message });
  } finally {
    pcState.streaming = false;
    pcEls.send().disabled = false;
    pcState.abort = null;
    pcEls.input().focus();
  }
}

function pcFmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function pcRenderAttachments() {
  const el = $('#pc-attachments');
  if (!pcState.attachments.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = pcState.attachments.map((a, i) => `
    <span class="pc-attach-chip">
      📎 ${escapeHtml(a.name)} <span class="pc-attach-size">${pcFmtSize(a.size)}</span>
      ${a._uploading ? '<span class="pc-attach-up">…</span>' : `<button class="pc-attach-x" data-idx="${i}" title="Убрать">✕</button>`}
    </span>
  `).join('');
  $$('.pc-attach-x', el).forEach(b => {
    b.onclick = () => { pcState.attachments.splice(+b.dataset.idx, 1); pcRenderAttachments(); };
  });
}

async function pcUploadFile(file) {
  if (!pcState.slug) return;
  if (file.size > 10 * 1024 * 1024) { alert('Файл слишком большой (>10MB)'); return; }
  const placeholder = { path: '', size: file.size, mime: file.type || 'application/octet-stream',
                        name: file.name, _uploading: true };
  pcState.attachments.push(placeholder);
  pcRenderAttachments();
  try {
    const fd = new FormData();
    fd.append('file', file);
    if (pcState.sessionId) fd.append('sessionId', pcState.sessionId);
    const r = await fetch('/api/project-chat/upload?project=' + encodeURIComponent(pcState.slug),
      { method: 'POST', credentials: 'same-origin', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'upload failed');
    Object.assign(placeholder, d, { _uploading: false });
    pcRenderAttachments();
  } catch (e) {
    pcState.attachments = pcState.attachments.filter(x => x !== placeholder);
    pcRenderAttachments();
    alert('Загрузка не удалась: ' + e.message);
  }
}

function handlePcSseEvent(raw, removeTyping) {
  let event = 'message', data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  if (!data) return;
  let obj; try { obj = JSON.parse(data); } catch { return; }
  if (event === 'session') {
    pcState.sessionId = obj.sessionId;
  } else if (event === 'block') {
    removeTyping();
    pcRenderBlock(obj);
  } else if (event === 'summary') {
    const el = document.createElement('div');
    el.className = 'pc-block-summary';
    const cost = typeof obj.costUsd === 'number' ? ` · $${obj.costUsd.toFixed(4)}` : '';
    const dur = typeof obj.durationMs === 'number' ? ` · ${(obj.durationMs / 1000).toFixed(1)}s` : '';
    el.textContent = `${obj.tokenInput ?? 0} in / ${obj.tokenOutput ?? 0} out${cost}${dur}`;
    pcEls.messages().appendChild(el);
    pcScrollToBottom();
  } else if (event === 'status') {
    // Транзиентный индикатор (напр. «Сжимаю историю диалога…»). Не убирает
    // «Claude думает» — после сжатия ход продолжится в той же сессии.
    const el = document.createElement('div');
    el.className = 'pc-block-summary';
    el.textContent = obj.message || '';
    pcEls.messages().appendChild(el);
    pcScrollToBottom();
  } else if (event === 'error') {
    removeTyping();
    pcRenderBlock({ type: 'error', message: obj.message || 'stream error' });
  }
}

// ── User chat (right pane, общий помощник) ──────────────────

function chatAppendBubble(type, text) {
  const div = document.createElement('div');
  if      (type === 'user')      div.className = 'chat-bubble chat-bubble-user';
  else if (type === 'assistant') div.className = 'chat-bubble chat-bubble-assistant';
  else if (type === 'thinking')  div.className = 'chat-bubble chat-bubble-thinking';
  else if (type === 'error')     div.className = 'chat-bubble chat-bubble-error';
  div.textContent = text;
  const c = $('#chat-messages');
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
  return div;
}

async function loadChatHistory() {
  try {
    const r = await fetch('/api/chat/history', { credentials: 'same-origin' });
    if (!r.ok) return;
    const history = await r.json();
    $('#chat-messages').innerHTML = '';
    history.forEach(m => chatAppendBubble(m.role === 'user' ? 'user' : 'assistant', m.content));
  } catch {}
}

async function sendChat() {
  const input = $('#chat-input');
  const message = input.value.trim();
  if (!message || $('#chat-send').disabled) return;

  chatAppendBubble('user', message);
  input.value = '';
  input.style.height = '';
  $('#chat-send').disabled = true;
  const thinkingEl = chatAppendBubble('thinking', 'Думаю...');
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const d = await r.json();
    thinkingEl.remove();
    if (r.ok) {
      chatAppendBubble('assistant', d.response);
      if (d.createProject) {
        $('#newproject-tpl').value = d.createProject.template;
        $('#newproject-name').value = d.createProject.name;
        $('#newproject-error').classList.add('hidden');
        openModal('modal-newproject');
      }
    } else {
      chatAppendBubble('error', d.error || 'Ошибка');
    }
  } catch {
    thinkingEl.remove();
    chatAppendBubble('error', 'Сетевая ошибка');
  }
  $('#chat-send').disabled = false;
}

function initResizer(selector, side) {
  const r = $(selector);
  if (!r) return;
  const storageKey = `vibe.chatW.${side}`;
  const saved = parseInt(localStorage.getItem(storageKey) || '0', 10);
  if (saved >= 280 && saved <= 800) {
    document.documentElement.style.setProperty(`--${side === 'left' ? 'left' : 'right'}-chat-w`, saved + 'px');
  }
  r.addEventListener('mousedown', (e) => {
    e.preventDefault();
    r.classList.add('dragging');
    const startX = e.clientX;
    const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--${side}-chat-w`) || '420', 10) || 420;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      let w = side === 'left' ? startW + dx : startW - dx;
      w = Math.max(280, Math.min(800, w));
      document.documentElement.style.setProperty(`--${side}-chat-w`, w + 'px');
    };
    const onUp = () => {
      r.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--${side}-chat-w`), 10);
      if (cur) localStorage.setItem(storageKey, cur);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function toggleUserChat(forceClose = false) {
  const pane = $('#chat-pane');
  const isHidden = pane.classList.contains('hidden');
  if (forceClose || !isHidden) {
    pane.classList.add('hidden');
    document.body.classList.remove('has-right-chat');
  } else {
    pane.classList.remove('hidden');
    document.body.classList.add('has-right-chat');
    loadChatHistory();
    setTimeout(() => $('#chat-input').focus(), 30);
  }
}

// Heartbeat (для idle reaper)
setInterval(() => {
  if (ME) fetch('/api/touch', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}, 60_000);

// Кросс-вкладочная синхра темы (dev/wiki/vibe)
window.addEventListener('storage', (e) => {
  if (e.key === 'aif-theme') {
    const t = localStorage.getItem('aif-theme');
    document.documentElement.classList.toggle('dark', t !== 'light');
  }
});
