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
  $('#app').classList.toggle('hidden', !isAuth);
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
    const el = $('#containerStatus');
    const text = $('.banner-text', el);
    const open = $('#openCodeBtn');
    open.href = `/code/${me.username}/`;
    if (!me.containerPort) {
      text.textContent = 'Контейнер ещё не создан — обратись к админу.';
      el.classList.remove('running');
    } else if (me.container?.running) {
      text.textContent = `Контейнер запущен с ${fmtDate(me.container.startedAt)}.`;
      el.classList.add('running');
    } else {
      text.textContent = 'Контейнер остановлен — запустится при клике на «Открыть VS Code».';
      el.classList.remove('running');
    }
  } catch {}
}

// ── Projects / templates ───────────────────────────────────

async function refreshProjects() {
  try {
    const { projects } = await api('/api/projects');
    $('#projectsCount').textContent = projects.length;
    const grid = $('#projectsList');
    if (!projects.length) {
      grid.innerHTML = '<div class="empty">пока пусто — создай проект из шаблона</div>';
      return;
    }
    grid.innerHTML = projects.map(p => `
      <div class="template-card">
        <div class="t-name">${escapeHtml(p.name)}</div>
        <div class="t-meta">/home/student/workspace/${escapeHtml(p.name)}</div>
        <div class="t-actions">
          <a class="btn btn-sm" href="/code/${escapeHtml(ME.username)}/?folder=${encodeURIComponent('/home/student/workspace/' + p.name)}" target="_blank">VS Code →</a>
        </div>
      </div>
    `).join('');
  } catch {}
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

  // Stop container
  $('#stopContainerBtn').onclick = async () => {
    try {
      await api('/api/container/stop', { method: 'POST' });
      refreshContainerStatus();
    } catch (e) { alert(e.message); }
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

  // New project
  $('#newproject-submit').onclick = doCreateProject;
  $('#newproject-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCreateProject(); }
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
