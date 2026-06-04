/* Хаб «База знаний»: сайдбар (4 группы) + маршрутизация контента + поиск.
 * Источники: window.COURSE (структура курса, app.js) и window.KB_REFERENCE
 * (content/reference.js). Контент курса рендерит window.courseSelect (app.js),
 * справочные материалы — существующие блоки .materials-page (показ/скрытие). */
(function () {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const REF = () => window.KB_REFERENCE || [];
  const COURSE = () => window.COURSE || [];
  const refByGroup = (g) => REF().filter(r => r.group === g);

  // активный пункт: 'ref:<id>' | 'mod:<mid>[.<part>]' | 'all:materials|homework|meetup'
  let active = localStorage.getItem('vibe.kb.sel') || ('ref:' + ((REF()[0] || {}).id || 'how-to'));

  function moduleCount(mid) {
    const m = COURSE().find(x => x.id === mid); if (!m) return 0;
    return (m.lessons ? m.lessons.length : 0) + (m.materials ? 1 : 0) +
           (m.homework ? 1 : 0) + (m.meetup ? 1 : 0) + (m.bonus ? 1 : 0);
  }

  function renderSide() {
    const item = (id, icon, label, n) =>
      `<div class="kb-item${active === id ? ' active' : ''}" data-id="${id}">
         <span>${icon}</span><span>${esc(label)}</span>${n != null ? `<span class="n">${n}</span>` : ''}</div>`;
    let h = '';
    h += '<div class="kb-group-h">База знаний</div>';
    refByGroup('start').forEach(r => h += item('ref:' + r.id, r.icon, r.title, null));
    h += '<div class="kb-group-h">Справочник</div>';
    refByGroup('reference').forEach(r => h += item('ref:' + r.id, r.icon, r.title, null));
    h += '<div class="kb-group-h">Материалы уроков</div>';
    h += item('all:materials', '📚', 'Все материалы', COURSE().filter(m => m.materials).length);
    h += item('all:homework',  '📝', 'Все домашние задания', COURSE().filter(m => m.homework).length);
    h += item('all:meetup',    '🎥', 'Все мастер-классы', COURSE().filter(m => m.meetup).length);
    h += '<div class="kb-group-h">По модулям</div>';
    COURSE().forEach(m => h += item('mod:' + m.id, '📦', m.id.toUpperCase() + ' · ' + m.title, moduleCount(m.id)));
    $('#kb-side').innerHTML = h;
    $$('#kb-side .kb-item').forEach(el => el.onclick = () => select(el.dataset.id));
  }

  function showMaterialsPage(sub) {
    const host = $('#kb-course-host'); if (host) host.style.display = 'none';
    $$('#kb-content .materials-page').forEach(p => p.classList.toggle('hidden', p.dataset.sub !== sub));
  }
  function showCourse() {
    $$('#kb-content .materials-page').forEach(p => p.classList.add('hidden'));
    const host = $('#kb-course-host'); if (host) host.style.display = '';
  }

  function cards(list) {
    let h = '<div class="course-modules">';
    list.forEach(x => h += `<a class="course-module" data-go="${x.id}">
        <div class="course-module-no">${x.no}</div>
        <div class="course-module-body"><div class="course-module-title">${esc(x.title)}</div>
        ${x.desc ? `<div class="course-module-desc">${esc(x.desc)}</div>` : ''}</div>
        <div class="course-module-cta">открыть →</div></a>`);
    h += '</div>';
    return h;
  }
  function wireGo() {
    $$('#course-content [data-go]').forEach(a => a.onclick = () => select(a.dataset.go));
  }

  function renderAll(part) {
    showCourse();
    const label = { materials: 'Все материалы', homework: 'Все домашние задания', meetup: 'Все мастер-классы' }[part];
    const list = [];
    COURSE().forEach(m => {
      if (!m[part]) return;
      const txt = part === 'meetup' ? (m.meetup.title + ' · ' + m.meetup.date) : m[part];
      list.push({ id: 'mod:' + m.id + '.' + part, no: m.id.toUpperCase(), title: m.title, desc: typeof txt === 'string' ? txt : '' });
    });
    $('#course-content').innerHTML =
      `<div class="page-meta">БАЗА ЗНАНИЙ · СКВОЗНОЙ ВИД</div><h1 class="page-h1">${label}</h1>
       <p class="page-lead">Один список по всем модулям сразу.</p>` +
      (list.length ? cards(list) : '<p class="page-lead">Пока пусто.</p>');
    wireGo();
  }

  function select(id) {
    active = id;
    localStorage.setItem('vibe.kb.sel', id);
    renderSide();
    const s = $('#kb-search'); if (s) s.value = '';
    if (id.startsWith('ref:')) {
      const r = REF().find(x => 'ref:' + x.id === id);
      if (r) showMaterialsPage(r.sub);
    } else if (id.startsWith('all:')) {
      renderAll(id.split(':')[1]);
    } else if (id.startsWith('mod:')) {
      showCourse();
      if (window.courseSelect) window.courseSelect(id.slice(4));  // 'm1' | 'm1.materials' | 'm1.l3'
    }
  }

  function search(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) { select(active); return; }
    showCourse();
    const hits = [];
    REF().forEach(r => { if ((r.title + r.desc).toLowerCase().includes(q)) hits.push({ id: 'ref:' + r.id, no: r.icon, title: r.title }); });
    COURSE().forEach(m => {
      (m.lessons || []).forEach(l => { if (l.title.toLowerCase().includes(q)) hits.push({ id: 'mod:' + m.id + '.' + l.id, no: '📖', title: m.id.toUpperCase() + ' · ' + l.title }); });
      if (m.title.toLowerCase().includes(q)) hits.push({ id: 'mod:' + m.id, no: '📦', title: m.id.toUpperCase() + ' · ' + m.title });
    });
    $('#course-content').innerHTML =
      `<div class="page-meta">ПОИСК · «${esc(q)}»</div><h1 class="page-h1">Найдено: ${hits.length}</h1>` +
      (hits.length ? cards(hits) : '<p class="page-lead">Ничего не найдено.</p>');
    wireGo();
  }

  window.renderKb = function () {
    if (!$('#kb-side')) return;
    renderSide();
    select(active);
    const s = $('#kb-search');
    if (s && !s._wired) { s._wired = true; s.oninput = (e) => search(e.target.value); }
  };
})();
