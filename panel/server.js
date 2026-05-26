// vibe-panel — управление учениками платного курса.
// Express :3020 (127.0.0.1). Своя htpasswd-vibe, своя users-vibe.json, сессии.
//
// Эндпоинты:
//   POST   /api/login           { username, password } → сессия
//   POST   /api/logout
//   GET    /api/me              { username, isAdmin, container: {...} }
//   GET    /api/templates       список шаблонов
//   GET    /api/projects        проекты ученика (из его workspace)
//   POST   /api/projects/from-template  { template, name } → копия шаблона в workspace
//   POST   /api/container/start            старт своего контейнера
//   POST   /api/container/stop             стоп
//   POST   /api/touch                      heartbeat (вызывается из /code/ страницы)
//   GET    /api/students        (admin)
//   POST   /api/students        (admin) { username, password, role }
//   DELETE /api/students/:u     (admin)
//   /code/<user>/*              прокси в контейнер ученика (auth-gate на сессию)

import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProxyMiddleware } from 'http-proxy-middleware';

import {
  loadUsers, htpasswdCheck, requireAuth, requireAdmin,
} from './lib/auth.js';
import {
  createStudent, deleteStudent, listStudents,
  dockerStart, dockerStop, containerStatus, workspaceDir,
  touchActivity, startReaper,
} from './lib/students.js';
import { listTemplates, instantiateTemplate } from './lib/templates.js';
import { buildTree, readFileSafe, resolveSafe } from './lib/explorer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3020', 10);
const HOST = process.env.HOST || '127.0.0.1';
const SESSIONS_DIR = process.env.SESSIONS_DIR || '/data/config/sessions-vibe';
const SESSION_SECRET = process.env.SESSION_SECRET
  || (() => { throw new Error('SESSION_SECRET is required'); })();

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const FileStore = FileStoreFactory(session);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, ttl: 30 * 24 * 3600, retries: 1 }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' },
  name: 'vibe.sid',
}));

// ---------- auth ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!htpasswdCheck(username, password)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const state = loadUsers();
  const user = state.users[username];
  if (!user) return res.status(401).json({ error: 'user not registered' });
  req.session.user = username;
  req.session.isAdmin = user.role === 'admin';
  res.json({ ok: true, username, isAdmin: req.session.isAdmin });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
  const u = req.session.user;
  const state = loadUsers();
  const info = state.users[u] || {};
  containerStatus(u).then(cs => {
    res.json({
      username: u,
      isAdmin: !!req.session.isAdmin,
      role: info.role || 'user',
      containerPort: info.containerPort || null,
      container: cs,
    });
  }).catch(e => res.json({
    username: u, isAdmin: !!req.session.isAdmin,
    role: info.role || 'user',
    container: { error: e.message },
  }));
});

// ---------- templates & projects (user) ----------

app.get('/api/templates', requireAuth, (req, res) => {
  res.json({ templates: listTemplates() });
});

app.get('/api/projects', requireAuth, (req, res) => {
  const ws = workspaceDir(req.session.user);
  fs.mkdirSync(ws, { recursive: true });
  const projects = fs.readdirSync(ws, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => {
      const dir = path.join(ws, d.name);
      let st;
      try { st = fs.statSync(dir); } catch { st = null; }
      // .portal-meta.json — опциональный сайдкар (status, siteUrl и т.п.)
      let meta = {};
      try {
        const metaPath = path.join(dir, '.portal-meta.json');
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
      } catch {}
      return {
        name: d.name,
        created: st ? new Date(st.birthtimeMs || st.ctimeMs).toISOString() : null,
        modified: st ? new Date(st.mtimeMs).toISOString() : null,
        owner: req.session.user,
        status: meta.status || 'НОВЫЙ',
        siteUrl: meta.siteUrl || null,
      };
    });
  res.json({ projects });
});

app.delete('/api/projects/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return res.status(400).json({ error: 'invalid project name' });
  }
  const ws = workspaceDir(req.session.user);
  const target = path.join(ws, name);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'no such project' });
  // Архивируем в `.deleted/` внутри workspace ученика (а не сразу rm).
  const archiveDir = path.join(ws, '.deleted');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archive = path.join(archiveDir, `${name}-${Date.now()}`);
  fs.renameSync(target, archive);
  res.json({ ok: true, archivedTo: archive });
});

// ---------- file explorer (user) ----------

function projectRootFor(req, projectName) {
  if (!/^[a-zA-Z0-9._-]+$/.test(projectName || '')) return null;
  const ws = workspaceDir(req.session.user);
  const root = path.join(ws, projectName);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  return root;
}

app.get('/api/explore/tree', requireAuth, (req, res) => {
  const root = projectRootFor(req, req.query.project);
  if (!root) return res.status(404).json({ error: 'no such project' });
  res.json({ tree: buildTree(root) });
});

app.get('/api/explore/file', requireAuth, (req, res) => {
  const root = projectRootFor(req, req.query.project);
  if (!root) return res.status(404).json({ error: 'no such project' });
  const rel = req.query.path || '';
  const abs = resolveSafe(root, rel);
  if (!abs) return res.status(400).json({ error: 'invalid path' });
  try {
    res.json(readFileSafe(root, rel));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/from-template', requireAuth, (req, res) => {
  const { template, name } = req.body || {};
  try {
    const out = instantiateTemplate({
      templateName: template,
      workspaceDir: workspaceDir(req.session.user),
      projectName: name,
    });
    res.json({ ok: true, project: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- container lifecycle (user) ----------

app.post('/api/container/start', requireAuth, async (req, res) => {
  try {
    await dockerStart(req.session.user);
    touchActivity(req.session.user);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/container/stop', requireAuth, async (req, res) => {
  try {
    await dockerStop(req.session.user);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/touch', requireAuth, (req, res) => {
  touchActivity(req.session.user);
  res.json({ ok: true });
});

// ---------- admin ----------

app.get('/api/students', requireAdmin, (req, res) => {
  res.json({ students: listStudents() });
});

app.post('/api/students', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  try {
    const s = await createStudent({ username, password, role });
    res.json({ ok: true, student: { username, ...s } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/students/:u', requireAdmin, async (req, res) => {
  try {
    await deleteStudent(req.params.u);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- /code/<user>/ прокси в контейнер ----------
//
// nginx за нами делает auth_request на /api/me, и проксирует /code/ сюда.
// Здесь мы доп. сверяем что user из URL совпадает с сессией, и шлём в нужный контейнер.

// Прокси /code/<user>/* → 127.0.0.1:<port>.
// router вычисляется по URL, чтобы работало в т.ч. для WebSocket upgrade
// (он обходит Express-цепочку и до auth-middleware ниже не доходит).
// HTTP-цепочка делает сессионную проверку и авто-старт контейнера; WS-апгрейд
// идёт уже после первого HTTP-запроса (code-server грузит HTML по GET до WS).
const codeProxy = createProxyMiddleware({
  router: (req) => {
    const m = req.url.match(/^\/code\/([^/]+)/);
    if (!m) return null;
    const state = loadUsers();
    const u = state.users[m[1]];
    if (!u || !u.containerPort) return null;
    return `http://127.0.0.1:${u.containerPort}`;
  },
  changeOrigin: true,
  ws: true,
  pathRewrite: (p) => p.replace(/^\/code\/[^/]+/, ''),
  on: {
    error: (err, req, res) => {
      if (res && !res.headersSent) {
        try { res.writeHead(502); res.end('container not ready'); } catch {}
      }
    },
  },
});

// HTTP: проверка сессии + авто-старт контейнера. После next() — прокси.
app.use('/code/:user', (req, res, next) => {
  const wantUser = req.params.user;
  if (!req.session?.user) return res.status(401).send('login required');
  if (req.session.user !== wantUser && !req.session.isAdmin) {
    return res.status(403).send('forbidden');
  }
  const state = loadUsers();
  const u = state.users[wantUser];
  if (!u) return res.status(404).send('no such student');
  if (!u.containerPort) return res.status(500).send('no port assigned');

  dockerStart(wantUser)
    .then(() => touchActivity(wantUser))
    .catch(e => console.error('autostart failed:', e.message));

  next();
});

// Прокси без mount-префикса — иначе Express режет `/code` из req.url
// и router/pathRewrite не сматчат. Фильтруем по префиксу руками.
// Регистрация через app.use(mw) важна для подписки на upgrade-события сервера.
app.use((req, res, next) => {
  if (req.url.startsWith('/code/')) return codeProxy(req, res, next);
  next();
});

// ---------- статика ----------

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

const server = app.listen(PORT, HOST, () => {
  console.log(`[vibe-panel] listening on http://${HOST}:${PORT}`);
});

// WebSocket upgrade для /code/<user>/* (code-server поднимает ws).
// http-proxy-middleware v3 экспортирует .upgrade на инстансе прокси.
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/code/')) {
    codeProxy.upgrade(req, socket, head);
  }
});

// Reaper для idle контейнеров
startReaper();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[vibe-panel] got ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
