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
import multer from 'multer';
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
import { listTemplates, listBaseTemplates, instantiateTemplate, createEmptyProject, createUploadedProject } from './lib/templates.js';
import { listUsers as listTranscriptUsers, readUser as readTranscriptUser, feed as transcriptFeed } from './lib/transcripts.js';
import { spawn } from 'node:child_process';
import { buildTree, readFileSafe, resolveSafe } from './lib/explorer.js';
import {
  listSessions as pcListSessions,
  loadSessionHistory as pcLoadHistory,
  sendMessage as pcSendMessage,
  deleteSession as pcDeleteSession,
  ensureProjectCwd as pcEnsureCwd,
} from './lib/project-chat.js';
import * as userChat from './lib/user-chat.js';

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
// API-ответы динамические: запрещаем кэш/ETag, иначе браузер ревалидирует и
// получает 304 с пустым телом → r.json() на фронте падает «Unexpected end of JSON input».
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
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
      lastActivityAt: info.lastActivityAt || null,
      idleStopMinutes: parseInt(process.env.IDLE_STOP_MIN || '30', 10),
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

// Базовые шаблоны (для модалки «+ Шаблон»): _base, _b24-single-php
app.get('/api/templates/base', requireAuth, (req, res) => {
  res.json({ templates: listBaseTemplates() });
});

// Создать пустой проект (без шаблона)
app.post('/api/projects/empty', requireAuth, (req, res) => {
  const { name } = req.body || {};
  try {
    const ws = workspaceDir(req.session.user);
    fs.mkdirSync(ws, { recursive: true });
    const out = createEmptyProject({ workspaceDir: ws, projectName: name });
    res.json({ ok: true, project: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Создать проект из загруженной папки (webkitdirectory).
// Каждый файл приходит с originalname = его относительный путь (см. клиент).
const projectUpload = multer({
  limits: { fileSize: 25 * 1024 * 1024, files: 4000 },
  storage: multer.memoryStorage(),
});

app.post('/api/projects/upload', requireAuth, projectUpload.array('files'), (req, res) => {
  const { name } = req.body || {};
  try {
    const ws = workspaceDir(req.session.user);
    fs.mkdirSync(ws, { recursive: true });
    const files = (req.files || []).map(f => ({ relPath: f.originalname, buffer: f.buffer }));
    const out = createUploadedProject({ workspaceDir: ws, projectName: name, files });
    res.json({ ok: true, project: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/opt/vibe-portal/templates';

// Возвращает абсолютный путь к корню для просмотра.
// kind=project — workspace залогиненного юзера; kind=template — общий каталог.
function exploreRoot(req, kind, name) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name || '')) return null;
  let base;
  if (kind === 'template') base = path.join(TEMPLATES_DIR, name);
  else base = path.join(workspaceDir(req.session.user), name);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return null;
  return base;
}

// ---------- project-chat (claude по проекту) ----------

function requireOwnProject(req, res, next) {
  const slug = req.query.project || req.body?.project;
  if (!slug || !/^[a-zA-Z0-9._-]+$/.test(slug)) {
    return res.status(400).json({ error: 'invalid project' });
  }
  // Ученик имеет доступ только к своим проектам; admin — ко всем (передаётся
  // ?asUser=<other> для доступа к чужому проекту).
  const asUser = req.session.isAdmin && req.query.asUser
    ? req.query.asUser : req.session.user;
  if (!/^[a-zA-Z0-9._-]+$/.test(asUser)) return res.status(400).json({ error: 'invalid user' });
  const ws = workspaceDir(asUser);
  const dir = path.join(ws, slug);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return res.status(404).json({ error: 'no such project' });
  }
  req.pc = { username: asUser, slug };
  next();
}

app.get('/api/project-chat/sessions', requireAuth, requireOwnProject, async (req, res) => {
  try {
    const sessions = await pcListSessions(req.pc.username, req.pc.slug);
    res.json({ sessions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/project-chat/session/:id', requireAuth, requireOwnProject, async (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9-]{8,}$/i.test(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const blocks = await pcLoadHistory(req.pc.username, req.pc.slug, id);
    res.json({ sessionId: id, blocks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/project-chat/send', requireAuth, requireOwnProject, async (req, res) => {
  const { text, sessionId, model } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }
  if (sessionId && !/^[a-f0-9-]{8,}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  try {
    await pcEnsureCwd(req.pc.username, req.pc.slug);
    await pcSendMessage(res, {
      username: req.pc.username,
      projectSlug: req.pc.slug,
      sessionId: sessionId || null,
      text: text.trim(),
      model: model || 'sonnet',
    });
  } catch (e) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
      res.end();
    } catch {}
  }
});

// Upload файла для следующего сообщения. Файл попадает в workspace ученика
// (внутри проекта в подпапку `.chat-uploads/`), чтобы claude-cli мог его прочитать.
const chatUpload = multer({
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  storage: multer.memoryStorage(),
});

app.post('/api/project-chat/upload', requireAuth, requireOwnProject, chatUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const ws = workspaceDir(req.pc.username);
    const sid = (req.body?.sessionId && /^[a-f0-9-]{8,}$/i.test(req.body.sessionId))
      ? req.body.sessionId : 'pending';
    const safe = (req.file.originalname || 'file').split(/[/\\]/).pop()
      .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file';
    const name = `${Date.now()}-${safe}`;
    const dir = path.join(ws, req.pc.slug, '.chat-uploads', sid);
    fs.mkdirSync(dir, { recursive: true });
    fs.chownSync(dir, 1000, 1000);
    const dst = path.join(dir, name);
    fs.writeFileSync(dst, req.file.buffer);
    fs.chownSync(dst, 1000, 1000);
    res.json({ path: dst, size: req.file.size, mime: req.file.mimetype, name: safe });
  }
);

app.delete('/api/project-chat/session/:id', requireAuth, requireOwnProject, async (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9-]{8,}$/i.test(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    await pcDeleteSession(req.pc.username, req.pc.slug, id);
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: e.message }); }
});

// ---------- user-chat (общий помощник в /data/vibe-students/<user>/) ----------

app.post('/api/chat', requireAuth, (req, res) => userChat.send(req, res));
app.get('/api/chat/history', requireAuth, (req, res) => {
  res.json(userChat.getHistory(req.session.user));
});
app.delete('/api/chat', requireAuth, (req, res) => {
  userChat.clearHistory(req.session.user);
  res.json({ ok: true });
});

// ---------- file explorer (user) ----------

app.get('/api/explore/tree', requireAuth, (req, res) => {
  const kind = req.query.kind === 'template' ? 'template' : 'project';
  const name = req.query.project || req.query.template;
  const root = exploreRoot(req, kind, name);
  if (!root) return res.status(404).json({ error: 'no such ' + kind });
  res.json({ tree: buildTree(root) });
});

app.get('/api/explore/file', requireAuth, (req, res) => {
  const kind = req.query.kind === 'template' ? 'template' : 'project';
  const name = req.query.project || req.query.template;
  const root = exploreRoot(req, kind, name);
  if (!root) return res.status(404).json({ error: 'no such ' + kind });
  const rel = req.query.path || '';
  if (!resolveSafe(root, rel)) return res.status(400).json({ error: 'invalid path' });
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

// ---------- downloads (zip проектов и шаблонов) ----------

// Стримит zip каталога <parentDir>/<entry> в ответ как attachment.
// Архивируем через системный zip (пишет в stdout), исключая мусор.
function streamZip(res, parentDir, entry, filename) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
  const zip = spawn('zip', [
    '-r', '-q', '-',
    entry,
    '-x', '*/node_modules/*', '*/.git/*', '*/.deleted/*',
  ], { cwd: parentDir });
  zip.stdout.pipe(res);
  zip.stderr.on('data', d => console.error('[zip]', d.toString().slice(0, 200)));
  zip.on('error', (e) => {
    if (!res.headersSent) res.status(500);
    res.end();
    console.error('[zip] spawn failed:', e.message);
  });
  res.on('close', () => { try { zip.kill(); } catch {} });
}

// Скачать свой проект zip'ом.
app.get('/api/projects/:name/download', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return res.status(400).json({ error: 'invalid project name' });
  const ws = workspaceDir(req.session.user);
  const dir = path.join(ws, name);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return res.status(404).json({ error: 'no such project' });
  }
  streamZip(res, ws, name, `${name}.zip`);
});

// Скачать базовый шаблон zip'ом (whitelisted). Доступно любому залогиненному.
const DOWNLOADABLE_TEMPLATES = new Set(['_base', '_b24-single-php']);

app.get('/api/template-download/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!DOWNLOADABLE_TEMPLATES.has(name)) return res.status(404).json({ error: 'no such template' });
  const dir = path.join(TEMPLATES_DIR, name);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no such template' });
  const nice = name.replace(/^_/, '') + '.zip';
  streamZip(res, TEMPLATES_DIR, name, nice);
});

// Скачать CLAUDE.md из b24-vibe-шаблона отдельным файлом.
app.get('/api/template-claude/b24', requireAuth, (req, res) => {
  const file = path.join(TEMPLATES_DIR, '_b24-single-php', 'CLAUDE.md');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="CLAUDE-b24.md"');
  fs.createReadStream(file).pipe(res);
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

// ---------- transcripts (admin): аудит диалогов ученик↔Claude ----------

app.get('/api/transcripts', requireAdmin, (req, res) => {
  res.json({ users: listTranscriptUsers() });
});

// Вся лента диалогов (опц. ?user=). Зарегистрирована ДО /:u, иначе "_feed"
// сматчится как username.
app.get('/api/transcripts/_feed', requireAdmin, (req, res) => {
  const user = req.query.user && /^[a-zA-Z0-9._-]+$/.test(req.query.user)
    ? req.query.user : null;
  res.json(transcriptFeed({ user }));
});

app.get('/api/transcripts/:u', requireAdmin, (req, res) => {
  const u = req.params.u;
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return res.status(400).json({ error: 'invalid user' });
  try {
    res.json(readTranscriptUser(u, req.query.date));
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
