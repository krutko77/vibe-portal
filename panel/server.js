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
//   POST   /api/students/:u/password (admin) { password } — смена пароля ученика
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
  loadUsers, saveUsers, htpasswdCheck, requireAuth, requireAdmin,
} from './lib/auth.js';
import {
  createStudent, deleteStudent, setStudentPassword, listStudents,
  dockerStart, dockerStop, containerStatus, workspaceDir,
  touchActivity, recordLogin, startReaper, provisionSsh,
} from './lib/students.js';
import { sshConfig, privateKey, regenerateKeys } from './lib/ssh-access.js';
import { homeDirFor } from './lib/home-dir.js';
import { leaderboard } from './lib/leaderboard.js';
import { listTemplates, listBaseTemplates, instantiateTemplate, createEmptyProject, createUploadedProject } from './lib/templates.js';
import { listUsers as listTranscriptUsers, readUser as readTranscriptUser, feed as transcriptFeed } from './lib/transcripts.js';
import {
  readPublish, writePublish, allocatePort, ensureRunning,
  deployApp, stopApp, containerIp, appAlive,
} from './lib/publish.js';
import {
  allocateSlot, touchSlot, releaseSlot, ensureCodeInstance, portForSlot,
} from './lib/code-slots.js';
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

const USAGE_FILE = process.env.TOKEN_USAGE_FILE || '/data/config/env/token-usage.json';

function readTokenUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); } catch { return {}; }
}

function saveTokenUsage(data) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

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
const sessionParser = session({
  store: new FileStore({ path: SESSIONS_DIR, ttl: 30 * 24 * 3600, retries: 1 }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' },
  name: 'vibe.sid',
});
app.use(sessionParser);

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
  recordLogin(username); // учёт заходов для дашборда/рейтинга
  res.json({ ok: true, username, isAdmin: req.session.isAdmin });
});

app.post('/api/logout', (req, res) => {
  // освобождаем слот окна VS Code этой сессии (иначе подождёт TTL)
  const u = req.session?.user, slot = req.session?.codeSlot;
  if (u && Number.isInteger(slot)) releaseSlot(u, slot);
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
  const u = req.session.user;
  const state = loadUsers();
  const info = state.users[u] || {};

  // бюджет
  const usageData = readTokenUsage();
  const today = new Date().toISOString().slice(0, 10);
  const period = info.tokenPeriod || 'total';
  const limitUsd = info.spendLimitUsd || null;
  const monthKey = today.slice(0, 7);
  const spentUsd = period === 'day'
    ? (usageData[u]?.days?.[today] || 0)
    : period === 'month'
      ? Object.entries(usageData[u]?.days || {}).filter(([d]) => d.startsWith(monthKey)).reduce((s, [, v]) => s + v, 0)
      : (usageData[u]?.totalUsd || 0);
  let resetInMs = null;
  if (period === 'day') {
    const endOfDay = new Date(today + 'T00:00:00.000Z');
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
    resetInMs = endOfDay.getTime() - Date.now();
  } else if (period === 'month') {
    const [y, m] = today.split('-').map(Number);
    const endOfMonth = new Date(Date.UTC(y, m, 1));
    resetInMs = endOfMonth.getTime() - Date.now();
  }
  const budget = { limitUsd, spentUsd, period, resetInMs };

  // количество сессий project-chat
  let sessionCount = 0;
  const prefix = `-data-vibe-students-${u}-`;
  try {
    const claudeProjects = '/root/.claude/projects';
    const dirs = fs.readdirSync(claudeProjects, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith(prefix));
    for (const d of dirs) {
      const files = fs.readdirSync(path.join(claudeProjects, d.name))
        .filter(f => f.endsWith('.jsonl'));
      sessionCount += files.length;
    }
  } catch {}

  const homeDir = homeDirFor(info.role || 'user');
  containerStatus(u).then(cs => {
    res.json({
      username: u,
      isAdmin: !!req.session.isAdmin,
      role: info.role || 'user',
      homeDir,
      containerPort: info.containerPort || null,
      container: cs,
      lastActivityAt: info.lastActivityAt || null,
      idleStopMinutes: parseInt(process.env.IDLE_STOP_MIN || '30', 10),
      budget,
      sessionCount,
    });
  }).catch(e => res.json({
    username: u, isAdmin: !!req.session.isAdmin,
    role: info.role || 'user',
    homeDir,
    container: { error: e.message },
    budget,
    sessionCount,
  }));
});

// ---------- дашборд: рейтинг учеников (любой залогиненный) ----------
// Отдаёт ТОЛЬКО агрегаты-числа + имена (см. lib/leaderboard.js). Без текста
// сообщений и без названий чужих проектов — ничего конфиденциального между
// учениками не утекает.

app.get('/api/leaderboard', requireAuth, (req, res) => {
  try {
    res.json(leaderboard());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- SSH-доступ: десктопный VS Code (user) ----------
// Ключи/порт провижатся лениво при первом обращении (provisionSsh идемпотентен),
// чтобы ученик мог скачать доступ даже до первого старта контейнера.
app.get('/api/ssh-config', requireAuth, (req, res) => {
  const u = req.session.user;
  try {
    const sshPort = provisionSsh(u);
    // Пробуждаем контейнер (SSH-вход сам уснувший не будит — порт не опубликован).
    // Fire-and-forget: пока ученик читает инструкцию/копирует ключ, контейнер встаёт.
    dockerStart(u).catch(() => {});
    res.json(sshConfig(u, sshPort, req.session.isAdmin ? 'admin' : 'user'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Скачать личный приватный ключ ученика (файл для ~/.ssh/).
app.get('/api/ssh-key', requireAuth, (req, res) => {
  const u = req.session.user;
  try {
    provisionSsh(u);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="vibe-${u}"`);
    res.send(privateKey(u));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Перевыпуск ключа (старый перестаёт пускать; host-key/отпечаток не меняется).
app.post('/api/ssh-key/regenerate', requireAuth, (req, res) => {
  const u = req.session.user;
  try {
    const sshPort = provisionSsh(u);
    regenerateKeys(u);
    res.json(sshConfig(u, sshPort, req.session.isAdmin ? 'admin' : 'user'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    const rawPaths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.paths].filter(Boolean);
    const files = (req.files || []).map((f, i) => ({ relPath: rawPaths[i] || f.originalname, buffer: f.buffer }));
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
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== '_vibe-setup')
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
        published: !!(meta.publish && meta.publish.enabled),
        publishUrl: (meta.publish && meta.publish.enabled)
          ? `/${req.session.user}/${d.name}/` : null,
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

// Картинки из буфера обмена приходят без имени/расширения (originalname='blob'),
// а Read у claude-cli распознаёт изображение по расширению. Достраиваем его из MIME.
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'application/pdf': 'pdf', 'text/plain': 'txt',
};
function safeUploadName(originalname, mime) {
  let safe = (originalname || 'file').split(/[/\\]/).pop()
    .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file';
  if (!/\.[a-zA-Z0-9]{1,8}$/.test(safe) && MIME_EXT[mime]) safe += '.' + MIME_EXT[mime];
  return safe;
}

app.post('/api/project-chat/upload', requireAuth, requireOwnProject, chatUpload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const ws = workspaceDir(req.pc.username);
    const sid = (req.body?.sessionId && /^[a-f0-9-]{8,}$/i.test(req.body.sessionId))
      ? req.body.sessionId : 'pending';
    const safe = safeUploadName(req.file.originalname, req.file.mimetype);
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

// ---------- vibe-setup: скрытый проект-ассистент для настройки своего портала ----------

const VIBE_SETUP_CLAUDE_MD = fs.readFileSync(new URL('./vibe-setup-claude.md', import.meta.url), 'utf8');

// Скачать исходный код Vibe Portal (без секретов и node_modules).
app.get('/api/vibe-setup/download-portal', requireAuth, (req, res) => {
  const portalDir = '/opt/vibe-portal';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="vibe-portal-src.zip"');
  const zip = spawn('zip', [
    '-r', '-q', '-', '.',
    '-x', '*/node_modules/*', '*/.git/*', '*/.env*', '*.credentials.json',
    '*/sessions-vibe/*', '*.log', '*/.portal-meta.json', '*/.claude/settings.local.json',
    '*/transcripts/*', '*/ssh/*', '*/vscode-server/*',
  ], { cwd: portalDir });
  zip.stdout.pipe(res);
  zip.stderr.on('data', d => console.error('[zip-portal]', d.toString().slice(0, 200)));
  zip.on('error', e => { if (!res.headersSent) res.status(500); res.end(); });
  res.on('close', () => { try { zip.kill(); } catch {} });
});

// Скачать базу знаний: контент уроков + шаблоны курса.
app.get('/api/vibe-setup/download-kb', requireAuth, (req, res) => {
  const portalDir = '/opt/vibe-portal';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="vibe-kb.zip"');
  const zip = spawn('zip', [
    '-r', '-q', '-',
    'content',
    'templates',
    'panel/public/js/lessons-m1.js',
    'panel/public/js/kb.js',
  ], { cwd: portalDir });
  zip.stdout.pipe(res);
  zip.stderr.on('data', d => console.error('[zip-kb]', d.toString().slice(0, 200)));
  zip.on('error', e => { if (!res.headersSent) res.status(500); res.end(); });
  res.on('close', () => { try { zip.kill(); } catch {} });
});

app.post('/api/vibe-setup/ensure', requireAuth, (req, res) => {
  const ws = workspaceDir(req.session.user);
  const dir = path.join(ws, '_vibe-setup');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const claudeMd = path.join(dir, 'CLAUDE.md');
    // Обновляем CLAUDE.md при каждом вызове — контент актуализируется
    fs.writeFileSync(claudeMd, VIBE_SETUP_CLAUDE_MD, 'utf8');
    res.json({ ok: true, project: '_vibe-setup' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// Upload файла для user-chat. Кладём в домашний `.chat-uploads/` ученика (не
// в проект — user-chat работает на уровне всего workspace), чтобы claude-cli
// мог прочитать его по абсолютному пути (Read включается, см. user-chat.js).
app.post('/api/chat/upload', requireAuth, chatUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const ws = workspaceDir(req.session.user);
  const safe = safeUploadName(req.file.originalname, req.file.mimetype);
  const name = `${Date.now()}-${safe}`;
  const dir = path.join(ws, '.chat-uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.chownSync(dir, 1000, 1000);
  const dst = path.join(dir, name);
  fs.writeFileSync(dst, req.file.buffer);
  fs.chownSync(dst, 1000, 1000);
  res.json({ path: dst, size: req.file.size, mime: req.file.mimetype, name: safe });
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

// Скачать весь workspace zip'ом.
app.get('/api/workspace/download', requireAuth, (req, res) => {
  const user = req.session.user;
  const ws = workspaceDir(user);
  if (!fs.existsSync(ws)) return res.status(404).json({ error: 'workspace not found' });
  const wsParent = path.dirname(ws);
  streamZip(res, wsParent, path.basename(ws), `workspace-${user}.zip`);
});

// Скачать базовый шаблон zip'ом (whitelisted). Доступно любому залогиненному.
const DOWNLOADABLE_TEMPLATES = new Set(['_base', '_b24-single-php', '_base_universal']);

app.get('/api/template-download/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!DOWNLOADABLE_TEMPLATES.has(name)) return res.status(404).json({ error: 'no such template' });
  const dir = path.join(TEMPLATES_DIR, name);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no such template' });
  const nice = name.replace(/^_/, '') + '.zip';
  streamZip(res, TEMPLATES_DIR, name, nice);
});

// Скачать CLAUDE.md из шаблона отдельным файлом (base | b24).
const TEMPLATE_CLAUDE = { base: '_base', b24: '_b24-single-php', universal: '_base_universal' };

app.get('/api/template-claude/:which', requireAuth, (req, res) => {
  const dir = TEMPLATE_CLAUDE[req.params.which];
  if (!dir) return res.status(404).json({ error: 'no such template' });
  const file = path.join(TEMPLATES_DIR, dir, 'CLAUDE.md');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="CLAUDE-${req.params.which}.md"`);
  fs.createReadStream(file).pipe(res);
});

// ---------- публикация приложений ----------

// Хелпер: проверка владения проектом (или админ через ?asUser=).
function resolvePublishTarget(req) {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  if (name.startsWith('.') || name === '.' || name === '..') return null;
  const asUser = req.session.isAdmin && req.query.asUser ? req.query.asUser : req.session.user;
  if (!/^[a-zA-Z0-9._-]+$/.test(asUser)) return null;
  const dir = path.join(workspaceDir(asUser), name);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  return { user: asUser, project: name };
}

app.get('/api/projects/:name/publish', requireAuth, async (req, res) => {
  const t = resolvePublishTarget(req);
  if (!t) return res.status(404).json({ error: 'no such project' });
  const pub = readPublish(t.user, t.project) || { enabled: false };
  let running = false;
  if (pub.enabled) {
    try { running = await appAlive(await containerIp(t.user), pub.port); } catch {}
  }
  res.json({
    enabled: !!pub.enabled,
    visibility: pub.visibility || 'owner',
    autosleep: pub.autosleep !== false,
    port: pub.port || null,
    url: pub.enabled ? `/${t.user}/${t.project}/` : null,
    running,
  });
});

app.post('/api/projects/:name/publish', requireAuth, async (req, res) => {
  const t = resolvePublishTarget(req);
  if (!t) return res.status(404).json({ error: 'no such project' });
  const { enabled, visibility, autosleep } = req.body || {};
  try {
    if (enabled) {
      let pub = readPublish(t.user, t.project) || {};
      const port = pub.port || allocatePort(t.user, t.project);
      pub = writePublish(t.user, t.project, {
        enabled: true,
        visibility: ['auth', 'public'].includes(visibility) ? visibility : 'owner',
        autosleep: autosleep !== false,
        port,
      });
      await ensureRunning(t.user, t.project).catch(e => console.error('[publish] deploy:', e.message));
      return res.json({ ok: true, url: `/${t.user}/${t.project}/`, port });
    } else {
      await stopApp(t.user, t.project);
      writePublish(t.user, t.project, { enabled: false });
      return res.json({ ok: true });
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:name/redeploy', requireAuth, async (req, res) => {
  const t = resolvePublishTarget(req);
  if (!t) return res.status(404).json({ error: 'no such project' });
  const pub = readPublish(t.user, t.project);
  if (!pub || !pub.enabled) return res.status(400).json({ error: 'not published' });
  try {
    await deployApp(t.user, t.project, pub.port);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  const students = listStudents();
  const usage = readTokenUsage();
  const today = new Date().toISOString().slice(0, 10);
  const enriched = students.map(s => ({
    ...s,
    spendUsedUsd:    usage[s.username]?.totalUsd          || 0,
    spendUsedDayUsd: usage[s.username]?.days?.[today]     || 0,
  }));
  res.json({ students: enriched });
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

app.post('/api/students/:u/password', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  try {
    setStudentPassword(req.params.u, password);
    res.json({ ok: true });
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

app.patch('/api/students/:u', requireAdmin, (req, res) => {
  const u = req.params.u;
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return res.status(400).json({ error: 'invalid user' });
  const { spendLimitUsd, tokenPeriod } = req.body || {};
  try {
    const state = loadUsers();
    const user  = state.users[u];
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (spendLimitUsd !== undefined) {
      const v = parseFloat(spendLimitUsd);
      user.spendLimitUsd = (!v || v <= 0) ? null : v;
    }
    if (tokenPeriod !== undefined) {
      user.tokenPeriod = ['day', 'total', 'month'].includes(tokenPeriod) ? tokenPeriod : 'total';
    }
    saveUsers(state);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/students/:u/token-usage/reset', requireAdmin, (req, res) => {
  const u = req.params.u;
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return res.status(400).json({ error: 'invalid user' });
  try {
    const usage = readTokenUsage();
    delete usage[u];
    saveTokenUsage(usage);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// Прокси /code/<user>/* → http://<containerIP>:<8080+slot> по vibe-net.
// target вычисляется в HTTP-гейте/WS-апгрейде (req._codeTarget) с учётом слота
// окна: первая сессия юзера → slot 0, конкурентные → 1,2,… (свои code-server в
// том же контейнере). router только возвращает уже посчитанный target — так
// одинаково работает и HTTP, и WebSocket upgrade.
const codeProxy = createProxyMiddleware({
  router: (req) => req._codeTarget || null,
  changeOrigin: true,
  // НЕ ws:true. Иначе http-proxy-middleware сам подпишется на server 'upgrade'
  // (catchUpgradeRequest) и его внутренний обработчик отработает СИНХРОННО — до
  // того как наш server.on('upgrade') в .then() (containerIp) выставит
  // req._codeTarget. Гонка → router отдаёт target=null → WS рвётся, окно белое.
  // Гоним апгрейд только вручную из server.on('upgrade'), когда target готов.
  ws: false,
  pathRewrite: (p) => p.replace(/^\/code\/[^/]+/, ''),
  on: {
    error: (err, req, res) => {
      console.log('[codeProxy error]', err.message, 'url:', req?.url);
      if (res && !res.headersSent) {
        try { res.writeHead(502); res.end('container not ready'); } catch {}
      } else if (res && res.destroy) {
        try { res.destroy(); } catch {}
      }
    },
  },
});

// HTTP: проверка сессии + слот окна + подъём инстанса code-server. После
// next() — прокси на req._codeTarget.
app.use('/code/:user', async (req, res, next) => {
  const wantUser = req.params.user;
  if (!req.session?.user) return res.status(401).send('login required');
  if (req.session.user !== wantUser && !req.session.isAdmin) {
    return res.status(403).send('forbidden');
  }
  const state = loadUsers();
  const u = state.users[wantUser];
  if (!u) return res.status(404).send('no such student');

  // Слот окна липнет к сессии: первая сессия юзера → slot 0 (PID-1 code-server),
  // конкурентные сессии того же логина → 1,2,… (свои процессы в том же контейнере).
  if (!Number.isInteger(req.session.codeSlot)) {
    req.session.codeSlot = allocateSlot(wantUser);
  }
  const slot = req.session.codeSlot;
  touchSlot(wantUser, slot);

  try {
    req._codeTarget = await ensureCodeInstance(wantUser, slot);
    touchActivity(wantUser);
    next();
  } catch (e) {
    console.error('[code] ensure slot failed:', e.message);
    if (!res.headersSent) res.status(502).send('editor not ready: ' + e.message);
  }
});

// Прокси без mount-префикса — иначе Express режет `/code` из req.url
// и router/pathRewrite не сматчат. Фильтруем по префиксу руками.
// Регистрация через app.use(mw) важна для подписки на upgrade-события сервера.
app.use((req, res, next) => {
  if (req.url.startsWith('/code/')) return codeProxy(req, res, next);
  next();
});

// ---------- /admin-code/ — code-server проекта для админа (root /opt/vibe-portal) ----------
//
// Отдельный code-server (systemd vibe-admin-code, 127.0.0.1:8300, --auth none,
// рут /opt/vibe-portal) — админ работает с claude как в CLI, но в браузере.
// Доступ закрывает ТОЛЬКО admin-гейт здесь (HTTP) + в upgrade-обработчике (WS):
// code-server без своей авторизации, поэтому гейт обязателен на обоих путях.
const ADMIN_CODE_TARGET = process.env.ADMIN_CODE_URL || 'http://127.0.0.1:8300';
const adminCodeProxy = createProxyMiddleware({
  target: ADMIN_CODE_TARGET,
  changeOrigin: true,
  ws: false, // апгрейд гоним вручную из server.on('upgrade') — см. codeProxy
  pathRewrite: (p) => p.replace(/^\/admin-code/, '') || '/',
  on: {
    error: (err, req, res) => {
      if (res && !res.headersSent) {
        try { res.writeHead(502); res.end('admin code-server not ready'); } catch {}
      }
    },
  },
});

app.use((req, res, next) => {
  if (!req.url.startsWith('/admin-code')) return next();
  if (!req.session?.user) return res.redirect(302, '/');
  if (!req.session.isAdmin) return res.status(403).send('forbidden');
  if (req.url === '/admin-code') return res.redirect(302, '/admin-code/');
  return adminCodeProxy(req, res, next);
});

// ---------- публичный прокси приложений /<user>/<project>/ ----------

const RESERVED_SEG = new Set(['api', 'code', 'admin-code', 'assets', 'css', 'js', 'img', 'public', '.well-known']);

function parsePublishPath(url) {
  const m = url.match(/^\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\/([a-zA-Z0-9][a-zA-Z0-9._-]*)(\/.*|)$/);
  if (!m) return null;
  if (RESERVED_SEG.has(m[1])) return null;
  return { user: m[1], project: m[2] };
}

// можно ли смотреть: public → кто угодно; owner → владелец+админ; auth → любой залогиненный
function canView(req, user, pub) {
  if (pub.visibility === 'public') return true;
  if (!req.session?.user) return false;
  if (req.session.isAdmin) return true;
  if (pub.visibility === 'auth') return true;
  return req.session.user === user; // owner
}

const appProxy = createProxyMiddleware({
  router: (req) => req._appTarget,
  changeOrigin: true,
  ws: false, // апгрейд гоним вручную из server.on('upgrade') — см. codeProxy
  pathRewrite: (p, req) => {
    const rewritten = p.replace(req._appPrefix, '');
    return rewritten || '/';
  },
  on: {
    error: (err, req, res) => {
      if (res && !res.headersSent) { try { res.writeHead(502); res.end('app not ready'); } catch {} }
    },
  },
});

async function publishMiddleware(req, res, next) {
  const parsed = parsePublishPath(req.url);
  if (!parsed) return next();
  const state = loadUsers();
  if (!state.users[parsed.user]) return next(); // не ученик — отдаём дальше (статика/404)
  const pub = readPublish(parsed.user, parsed.project);
  if (!pub || !pub.enabled) return next();

  // auth-гейт (public — без логина; иначе нужна сессия + право)
  if (pub.visibility !== 'public') {
    if (!req.session?.user) {
      return res.redirect(302, '/');
    }
    if (!canView(req, parsed.user, pub)) {
      return res.status(403).send('forbidden');
    }
  }

  try {
    const { ip, port } = await ensureRunning(parsed.user, parsed.project);
    touchActivity(parsed.user);
    req._appTarget = `http://${ip}:${port}`;
    req._appPrefix = `/${parsed.user}/${parsed.project}`;
    return appProxy(req, res, next);
  } catch (e) {
    if (!res.headersSent) res.status(502).send('app not ready: ' + e.message);
  }
}

app.use((req, res, next) => {
  if (parsePublishPath(req.url)) return publishMiddleware(req, res, next);
  next();
});

// ---------- статика ----------

// Реестр и контент «Базы знаний» (content/reference.js и пр.).
app.use('/content', express.static(path.join(__dirname, '..', 'content'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

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
  // admin code-server (root проекта) — строгий admin-гейт и на WS
  if (req.url && req.url.startsWith('/admin-code')) {
    sessionParser(req, {}, () => {
      if (!req.session?.isAdmin) { try { socket.destroy(); } catch {} return; }
      adminCodeProxy.upgrade(req, socket, head);
    });
    return;
  }
  const parsed = parsePublishPath(req.url || '');
  if (parsed) {
    const state = loadUsers();
    const pub = state.users[parsed.user] ? readPublish(parsed.user, parsed.project) : null;
    if (pub && pub.enabled) {
      sessionParser(req, {}, () => {
        // public → без сессии; иначе нужна сессия + право
        if (pub.visibility !== 'public' && (!req.session?.user || !canView(req, parsed.user, pub))) {
          try { socket.destroy(); } catch {}
          return;
        }
        containerIp(parsed.user).then(ip => {
          if (!ip) { try { socket.destroy(); } catch {} return; }
          req._appTarget = `http://${ip}:${pub.port}`;
          req._appPrefix = `/${parsed.user}/${parsed.project}`;
          appProxy.upgrade(req, socket, head);
        }).catch(() => { try { socket.destroy(); } catch {} });
      });
      return;
    }
  }
  if (req.url && req.url.startsWith('/code/')) {
    const m = req.url.match(/^\/code\/([^/]+)/);
    const wantUser = m && m[1];
    if (!wantUser) { try { socket.destroy(); } catch {} return; }
    // Слот берём из сессии (HTTP-гейт уже его выставил и сохранил) → тот же
    // инстанс code-server, что отдал HTML. Заодно гейтим WS по сессии.
    sessionParser(req, {}, () => {
      if (!req.session?.user) { try { socket.destroy(); } catch {} return; }
      if (req.session.user !== wantUser && !req.session.isAdmin) {
        try { socket.destroy(); } catch {} return;
      }
      const slot = Number.isInteger(req.session.codeSlot) ? req.session.codeSlot : 0;
      touchSlot(wantUser, slot);
      containerIp(wantUser).then(ip => {
        if (!ip) { try { socket.destroy(); } catch {} return; }
        req._codeTarget = `http://${ip}:${portForSlot(slot)}`;
        codeProxy.upgrade(req, socket, head);
      }).catch(() => { try { socket.destroy(); } catch {} });
    });
    return;
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
