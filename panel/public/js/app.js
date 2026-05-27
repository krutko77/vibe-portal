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

// ── Auth rendering ─────────────────────────────────────────

function renderAuth() {
  const isAuth = !!ME;
  document.body.classList.toggle('is-auth', isAuth);
  document.body.classList.toggle('is-admin', !!ME?.isAdmin);
  $('#welcome').classList.toggle('hidden', isAuth);
  $('#main-layout').classList.toggle('hidden', !isAuth);
  if (isAuth) {
    $('#authUsername').textContent = ME.username + (ME.isAdmin ? ' (admin)' : '');
    refreshAll();
  }
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
            <tr data-project="${escapeHtml(p.name)}">
              <td><span class="pill pill-type">ПРОЕКТ</span></td>
              <td><span class="pill ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
              <td class="td-name">${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.owner)}</td>
              <td>${fmtDate(p.modified)}</td>
              <td class="td-actions">
                <button class="btn btn-sm" data-action="files" title="Файлы">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button class="btn btn-sm" data-action="claude" title="Claude">CLAUDE</button>
                <button class="btn btn-sm" data-action="vscode">VS Code →</button>
                <button class="btn btn-sm btn-danger" data-action="delete" title="Удалить">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                </button>
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
    $('#explorer-tree').innerHTML = renderTree(tree, '');
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

function renderTree(nodes, parentPath) {
  if (!nodes.length) return '<div class="empty">пусто</div>';
  return '<ul class="explorer-tree-list">' + nodes.map(n => {
    const p = parentPath ? `${parentPath}/${n.name}` : n.name;
    if (n.type === 'dir') {
      return `
        <li class="explorer-tree-item">
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
          ${s.username !== ME.username
            ? `<button class="btn btn-danger btn-sm" data-del="${escapeHtml(s.username)}">Удалить</button>`
            : ''}
        </div>
      </div>
    `).join('');
    $$('[data-del]', list).forEach(b => {
      b.onclick = async () => {
        if (!confirm(`Удалить ученика ${b.dataset.del}? Workspace будет архивирован.`)) return;
        try {
          await api('/api/students/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        } catch (e) { alert(e.message); }
        refreshUsers();
      };
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
  $('#create-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateFromBase(); }
  });

  // Explorer close — скрываем панель и убираем body class чтобы dashboard вернулся
  const closeExplorer = () => {
    $('#explorer-overlay').classList.add('hidden');
    document.body.classList.remove('has-explorer');
  };
  $('#explorer-close').onclick = closeExplorer;

  // Open VS Code button (header dashboard)
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
  const cur = sessions.find(s => s.sessionId === pcState.sessionId);
  pcEls.sessionsLabel().textContent = cur
    ? (cur.title || cur.sessionId.slice(0, 8)) + (cur.lockedBy ? ' 🔒' : '')
    : '— новая —';
  for (const s of sessions) {
    const item = document.createElement('button');
    item.className = 'pc-dd-item' + (s.sessionId === pcState.sessionId ? ' active' : '');
    item.type = 'button';
    const title = escapeHtml(s.title || s.sessionId.slice(0, 8));
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
    const r = await fetch(`/api/project-chat/sessions?project=${encodeURIComponent(pcState.slug)}`, { credentials: 'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'sessions load failed');
    pcRenderSessionList(d.sessions || []);
    return d.sessions || [];
  } catch (e) {
    pcShowEmpty('Не удалось загрузить сессии: ' + e.message);
    return [];
  }
}

async function pcLoadHistory(sessionId) {
  pcClearMessages();
  if (!sessionId) { pcShowEmpty('Напиши первое сообщение — сессия создастся.'); return; }
  try {
    const r = await fetch(`/api/project-chat/session/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(pcState.slug)}`, { credentials: 'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'history load failed');
    if (!d.blocks?.length) pcShowEmpty('Пустая сессия — напиши сообщение.');
    else d.blocks.forEach(pcRenderBlock);
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
