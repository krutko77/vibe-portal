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
    .map(d => ({ name: d.name }));
  res.json({ projects });
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

  // Авто-старт контейнера, если выключен
  dockerStart(wantUser)
    .then(() => touchActivity(wantUser))
    .catch(e => console.error('autostart failed:', e.message));

  // Прокси на 127.0.0.1:<port>
  req._vibePort = u.containerPort;
  next();
}, createProxyMiddleware({
  router: (req) => `http://127.0.0.1:${req._vibePort}`,
  changeOrigin: true,
  ws: true,
  pathRewrite: (path, req) => path.replace(/^\/code\/[^/]+/, ''),
  on: {
    error: (err, req, res) => {
      if (res && !res.headersSent) {
        try { res.writeHead(502); res.end('container not ready'); } catch {}
      }
    },
  },
}));

// ---------- статика ----------

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

const server = app.listen(PORT, HOST, () => {
  console.log(`[vibe-panel] listening on http://${HOST}:${PORT}`);
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
