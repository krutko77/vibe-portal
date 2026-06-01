# Публикация приложений учеников — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать ученикам публиковать приложения по `https://vibe.kiselevgroup.com/<user>/<project>/`, доступные только авторизованным (владелец+админ или все залогиненные), с авто-подъёмом и «деплоем по умолчанию».

**Architecture:** Приложение крутится в контейнере ученика на выделенном порту (3001+). Панель (хост, шлюз vibe-net) проксирует `/<user>/<project>/*` → `http://<containerIP>:<port>/` с auth-гейтом и self-heal (будит контейнер + переподнимает процесс). Конфиг публикации — в `.portal-meta.json` проекта. nginx не меняется.

**Tech Stack:** Node 22 / Express, `http-proxy-middleware` (уже есть), `dockerode` (уже есть), docker CLI (`docker exec -d`), Node 22 global `fetch`. PHP добавляется в образ контейнера.

**Замечание о верификации:** в репозитории нет юнит-тест-харнесса. Проверка каждой задачи — командами (curl/docker/node) с ожидаемым результатом. Коммитим часто, прямо в `master` (как принято в этой сессии).

**Спека:** `docs/superpowers/specs/2026-06-01-publish-apps-design.md`

---

## Карта файлов

- **Создать** `panel/lib/publish.js` — ядро: чтение/запись конфига публикации, аллокация портов, детект стека, деплой/стоп/проба/ensureRunning, IP контейнера, keepAlive.
- **Изменить** `panel/server.js` — API публикации, публичный прокси-роут + auth-гейт + ws-upgrade.
- **Изменить** `panel/lib/students.js` — блоклист логинов в `createStudent`, пропуск reaper'ом при `autosleep=off`.
- **Изменить** `panel/public/index.html` — модалка `modal-publish`.
- **Изменить** `panel/public/js/app.js` — иконки 🔗/«Публ.» в строке проекта, логика модалки.
- **Изменить** `panel/public/css/style.css` — стили модалки публикации.
- **Изменить** `workspace-image/Dockerfile` — добавить `php-cli` + `psmisc`.
- **Изменить** `templates/_base/src/public/index.html` — относительные пути к ассетам.
- **Изменить** `CLAUDE.md` — документация публикации.

---

## Task 1: PHP в образе контейнера

**Files:**
- Modify: `workspace-image/Dockerfile`

- [ ] **Step 1: Найти строку установки пакетов в Dockerfile**

Run: `grep -n "apt-get install\|apt install" /opt/vibe-portal/workspace-image/Dockerfile`
Expected: одна-две строки `apt-get install ... ` с системными пакетами.

- [ ] **Step 2: Добавить php-cli и psmisc**

В существующую `apt-get install`-строку (или добавить новый слой рядом) включить
`php-cli` (для `php -S`) и `psmisc` (даёт `fuser`, резерв для kill по порту).
Например, если строка вида:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git ca-certificates ... \
 && rm -rf /var/lib/apt/lists/*
```
добавить в список пакетов `php-cli psmisc` (перед `&& rm -rf`).

- [ ] **Step 3: Пересобрать образ**

Run: `docker build -t vibe-workspace:dev /opt/vibe-portal/workspace-image/ 2>&1 | tail -5`
Expected: `naming to docker.io/library/vibe-workspace:dev ... done` без ошибок.

- [ ] **Step 4: Проверить php в новом образе**

Run: `docker run --rm vibe-workspace:dev sh -c 'php -v | head -1; node -v'`
Expected: строка `PHP 8.x ...` и `v22.x`.

- [ ] **Step 5: Пересоздать контейнеры учеников (workspace сохраняется — bind-mount)**

Run:
```bash
for c in $(docker ps -aq --filter "label=kg.vibe.role=workspace"); do docker rm -f "$c"; done
echo "контейнеры удалены; пересоздадутся при следующем входе ученика (dockerStart)"
```
Expected: список удалённых id. Контейнеры пересоздаются автоматически при заходе (см. `dockerStart` в students.js). Активные сессии прервутся — допустимо.

- [ ] **Step 6: Commit**

```bash
cd /opt/vibe-portal && git add workspace-image/Dockerfile
git commit -m "workspace-image: добавить php-cli и psmisc для публикации приложений"
```

---

## Task 2: publish.js — конфиг и аллокация портов

**Files:**
- Create: `panel/lib/publish.js`

- [ ] **Step 1: Создать модуль с чтением/записью конфига и аллокацией портов**

Create `panel/lib/publish.js`:
```js
// publish.js — публикация приложений учеников.
// Конфиг публикации хранится в .portal-meta.json проекта (источник истины).
// Приложение крутится в контейнере ученика на выделенном порту; панель
// проксирует /<user>/<project>/ → http://<containerIP>:<port>/.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Docker from 'dockerode';
import { containerName, workspaceDir } from './students.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const NETWORK = process.env.VIBE_NETWORK || 'vibe-net';
const PORT_BASE = 3001;
const PORT_MAX = 3099;
const NAME_RE = /^[a-zA-Z0-9._-]+$/;

function metaPath(user, project) {
  return path.join(workspaceDir(user), project, '.portal-meta.json');
}

function readMeta(user, project) {
  try { return JSON.parse(fs.readFileSync(metaPath(user, project), 'utf8')); }
  catch { return {}; }
}

function writeMeta(user, project, meta) {
  const file = metaPath(user, project);
  fs.writeFileSync(file, JSON.stringify(meta, null, 2));
  try { fs.chownSync(file, 1000, 1000); } catch {}
}

// Конфиг публикации проекта (или дефолт-выключенный).
export function readPublish(user, project) {
  const p = readMeta(user, project).publish;
  return p && typeof p === 'object' ? p : null;
}

// Слить patch в publish и сохранить. Возвращает итоговый publish.
export function writePublish(user, project, patch) {
  const meta = readMeta(user, project);
  meta.publish = { ...(meta.publish || {}), ...patch };
  writeMeta(user, project, meta);
  return meta.publish;
}

// Минимальный свободный порт >= 3001 среди опубликованных проектов ученика.
export function allocatePort(user, project) {
  const ws = workspaceDir(user);
  const used = new Set();
  let dirs = [];
  try { dirs = fs.readdirSync(ws, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch {}
  for (const d of dirs) {
    if (d === project) continue;
    const p = readPublish(user, d);
    if (p && p.port) used.add(p.port);
  }
  for (let port = PORT_BASE; port <= PORT_MAX; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error('no free app port');
}

// Есть ли у ученика проект, который держит контейнер живым (enabled && !autosleep).
export function hasKeepAlive(user) {
  const ws = workspaceDir(user);
  let dirs = [];
  try { dirs = fs.readdirSync(ws, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return false; }
  return dirs.some(d => {
    const p = readPublish(user, d);
    return p && p.enabled && p.autosleep === false;
  });
}

export { docker, NETWORK, NAME_RE, execFile };
```

- [ ] **Step 2: Проверить синтаксис и базовую логику аллокации**

Run:
```bash
cd /opt/vibe-portal/panel && node --check lib/publish.js && node --input-type=module -e '
import { allocatePort, readPublish } from "./lib/publish.js";
// для несуществующего ученика вернёт 3001 (нет занятых)
console.log("alloc(no projects):", allocatePort("__nouser__", "x"));
console.log("readPublish(none):", readPublish("__nouser__", "x"));
'
```
Expected: `lib/publish.js` без ошибок; `alloc(no projects): 3001`; `readPublish(none): null`.

- [ ] **Step 3: Commit**

```bash
cd /opt/vibe-portal && git add panel/lib/publish.js
git commit -m "panel/publish: конфиг публикации + аллокация портов"
```

---

## Task 3: publish.js — детект стека, деплой, проба, ensureRunning

**Files:**
- Modify: `panel/lib/publish.js`

- [ ] **Step 1: Добавить containerIp, detectCmd, appAlive, deployApp, stopApp, ensureRunning**

Дописать в конец `panel/lib/publish.js` (перед строкой `export { docker, ... }` — переместить её в самый низ файла):
```js
// IP контейнера ученика в vibe-net (с коротким кэшем).
const ipCache = new Map(); // user -> { ip, at }
export async function containerIp(user) {
  const c = ipCache.get(user);
  if (c && Date.now() - c.at < 10_000) return c.ip;
  let ip = null;
  try {
    const info = await docker.getContainer(containerName(user)).inspect();
    ip = info?.NetworkSettings?.Networks?.[NETWORK]?.IPAddress || null;
  } catch {}
  ipCache.set(user, { ip, at: Date.now() });
  return ip;
}

// Команда старта по стеку проекта. host-dir = workspaceDir(user)/project.
export function detectCmd(user, project, port) {
  const dir = path.join(workspaceDir(user), project);
  const custom = readPublish(user, project)?.cmd;
  if (custom) return custom;
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('package.json')) {
    let entry = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.main && has(pkg.main)) entry = pkg.main;
      const s = pkg.scripts?.start;
      if (!entry && s) { const m = s.match(/node\s+(\S+)/); if (m && has(m[1])) entry = m[1]; }
    } catch {}
    if (!entry) entry = ['src/server.js', 'server.js', 'index.js', 'app.js'].find(has) || 'index.js';
    return `env PORT=${port} node ${entry}`;
  }
  if (fs.existsSync(path.join(dir, 'www'))) return `php -S 0.0.0.0:${port} -t www`;
  if (has('index.php')) return `php -S 0.0.0.0:${port}`;
  return `php -S 0.0.0.0:${port}`; // статика из корня
}

// Жив ли процесс приложения (HTTP-проба, любой ответ = жив).
export async function appAlive(ip, port) {
  if (!ip) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    await fetch(`http://${ip}:${port}/`, { signal: ctrl.signal });
    return true;
  } catch { return false; }
  finally { clearTimeout(t); }
}

function dockerExecDetached(user, args) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// Запустить приложение в контейнере (детач). pid сервера → .publish/app.pid.
export async function deployApp(user, project, port) {
  const cmd = detectCmd(user, project, port);
  const cdir = `/home/student/workspace/${project}`;
  const wrapper =
    `mkdir -p .publish; ` +
    `[ -f package.json ] && [ ! -d node_modules ] && npm install --no-audit --no-fund >> .publish/app.log 2>&1; ` +
    `nohup ${cmd} >> .publish/app.log 2>&1 & echo $! > .publish/app.pid`;
  await stopApp(user, project); // на случай старого процесса на этом порту
  await dockerExecDetached(user, ['exec', '-d', '-u', 'student', '-w', cdir, containerName(user), 'sh', '-lc', wrapper]);
}

// Остановить приложение (kill pid из .publish/app.pid).
export async function stopApp(user, project) {
  const cdir = `/home/student/workspace/${project}`;
  const kill = `kill $(cat .publish/app.pid) 2>/dev/null; rm -f .publish/app.pid`;
  try {
    await dockerExecDetached(user, ['exec', '-u', 'student', '-w', cdir, containerName(user), 'sh', '-lc', kill]);
  } catch {}
}

// Убедиться, что контейнер запущен и приложение живо. Возвращает {ip, port}.
import { dockerStart } from './students.js';
export async function ensureRunning(user, project) {
  const pub = readPublish(user, project);
  if (!pub || !pub.enabled) throw new Error('not published');
  await dockerStart(user);
  let ip = await containerIp(user);
  if (await appAlive(ip, pub.port)) return { ip, port: pub.port };
  await deployApp(user, project, pub.port);
  // поллинг до ~6 c
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    ip = await containerIp(user);
    if (await appAlive(ip, pub.port)) return { ip, port: pub.port };
  }
  throw new Error('app did not come up');
}
```

Переместить строку `export { docker, NETWORK, NAME_RE, execFile };` в самый конец файла (после новых функций). Удалить дублирующий `import { containerName, workspaceDir } from './students.js';` если конфликтует — оставить один импорт сверху, а `dockerStart` импортировать там же сверху (объединить импорты students.js в одну строку вверху файла; убрать локальный `import { dockerStart }`).

- [ ] **Step 2: Объединить импорты students.js вверху файла**

В шапке `publish.js` заменить
`import { containerName, workspaceDir } from './students.js';`
на
`import { containerName, workspaceDir, dockerStart } from './students.js';`
и удалить локальный `import { dockerStart } from './students.js';` из тела ensureRunning.

- [ ] **Step 3: Проверить синтаксис и детект стека**

Run:
```bash
cd /opt/vibe-portal/panel && node --check lib/publish.js && node --input-type=module -e '
import { detectCmd } from "./lib/publish.js";
// _base — node, но он в /opt/vibe-portal/templates; проверим на реальном проекте если есть,
// иначе просто на отсутствующем (вернёт php-статику)
console.log("cmd(none):", detectCmd("__nouser__","x",3001));
'
```
Expected: без ошибок; `cmd(none): php -S 0.0.0.0:3001` (нет package.json → статика).

- [ ] **Step 4: Commit**

```bash
cd /opt/vibe-portal && git add panel/lib/publish.js
git commit -m "panel/publish: детект стека, деплой/стоп/проба, ensureRunning"
```

---

## Task 4: API публикации + расширение /api/projects

**Files:**
- Modify: `panel/server.js`

- [ ] **Step 1: Импортировать publish.js**

После строки импорта transcripts (`import { listUsers as listTranscriptUsers, ... }`) добавить:
```js
import {
  readPublish, writePublish, allocatePort, ensureRunning,
  deployApp, stopApp, containerIp, hasKeepAlive, appAlive,
} from './lib/publish.js';
```

- [ ] **Step 2: В GET /api/projects добавить признак публикации**

В `panel/server.js` в обработчике `app.get('/api/projects', ...)` в объект, возвращаемый из `.map`, рядом с `siteUrl` добавить:
```js
        published: !!(meta.publish && meta.publish.enabled),
        publishUrl: (meta.publish && meta.publish.enabled)
          ? `/${req.session.user}/${d.name}/` : null,
```

- [ ] **Step 3: Добавить роуты публикации (после блока projects, до контейнерных)**

Вставить перед `// ---------- container lifecycle (user) ----------`:
```js
// ---------- публикация приложений ----------

// Хелпер: проверка владения проектом (или админ через ?asUser=).
function resolvePublishTarget(req) {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
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
        visibility: visibility === 'auth' ? 'auth' : 'owner',
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
```

- [ ] **Step 4: Проверить синтаксис и роуты**

Run:
```bash
cd /opt/vibe-portal/panel && node --check server.js && echo OK
systemctl restart vibe-panel && sleep 1
for p in "/api/projects/x/publish" "/api/projects/x/redeploy"; do echo -n "$p -> "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3020$p"; done
```
Expected: `OK`; оба пути `401` (requireAuth-гейт; маршрут существует).

- [ ] **Step 5: Commit**

```bash
cd /opt/vibe-portal && git add panel/server.js
git commit -m "panel: API публикации (publish/redeploy) + признак published в /api/projects"
```

---

## Task 5: Публичный прокси-роут + auth-гейт + ws + резерв логинов + reaper

**Files:**
- Modify: `panel/server.js`
- Modify: `panel/lib/students.js`

- [ ] **Step 1: Блоклист логинов в createStudent**

В `panel/lib/students.js` в начале `createStudent` (после `const state = loadUsers();`) добавить:
```js
  const RESERVED = new Set(['api', 'code', 'assets', 'css', 'js', 'img', 'public', 'well-known', 'logs', 'history', 'help', 'security']);
  if (RESERVED.has(username)) {
    throw new Error(`reserved username: ${username}`);
  }
```

- [ ] **Step 2: Пропуск reaper'ом учеников с keepAlive**

В `panel/lib/students.js`:
- добавить импорт сверху: `import { hasKeepAlive } from './publish.js';`
- в `reapIdleContainers`, внутри цикла, после вычисления `last` и до `dockerStop`, добавить:
```js
    if (hasKeepAlive(username)) continue; // опубликовано с autosleep=off — не усыпляем
```

ВНИМАНИЕ циклический импорт: publish.js импортирует из students.js (`containerName, workspaceDir, dockerStart`), а students.js — `hasKeepAlive` из publish.js. ES-модули это допускают (ленивое связывание), т.к. `hasKeepAlive` вызывается во время выполнения, а не на этапе загрузки. Проверить, что панель стартует (Step 6).

- [ ] **Step 3: Добавить публичный прокси-роут в server.js (после блока /code/, до static)**

В `panel/server.js` найти блок `app.use((req, res, next) => { if (req.url.startsWith('/code/')) return codeProxy(req, res, next); next(); });`. Сразу ПОСЛЕ него вставить:
```js
// ---------- публичный прокси приложений /<user>/<project>/ ----------

const RESERVED_SEG = new Set(['api', 'code', 'assets', 'css', 'js', 'img', 'public', '.well-known']);

function parsePublishPath(url) {
  const m = url.match(/^\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\/([a-zA-Z0-9._-]+)(\/.*|)$/);
  if (!m) return null;
  if (RESERVED_SEG.has(m[1])) return null;
  return { user: m[1], project: m[2] };
}

// можно ли смотреть: visibility owner → владелец+админ; auth → любой залогиненный
function canView(req, user, pub) {
  if (!req.session?.user) return false;
  if (req.session.isAdmin) return true;
  if (pub.visibility === 'auth') return true;
  return req.session.user === user; // owner
}

const appProxy = createProxyMiddleware({
  router: (req) => req._appTarget,
  changeOrigin: true,
  ws: true,
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

  // auth-гейт
  if (!req.session?.user) {
    // неавторизован → на логин (для GET-навигации)
    return res.redirect(302, '/');
  }
  if (!canView(req, parsed.user, pub)) {
    return res.status(403).send('forbidden');
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
```

- [ ] **Step 4: WebSocket-upgrade для приложений**

В `panel/server.js` найти `server.on('upgrade', ...)` (для /code/). Дополнить его: ПЕРЕД проверкой `/code/` добавить ветку публикации:
```js
server.on('upgrade', (req, socket, head) => {
  const parsed = parsePublishPath(req.url || '');
  if (parsed) {
    const state = loadUsers();
    const pub = state.users[parsed.user] ? readPublish(parsed.user, parsed.project) : null;
    if (pub && pub.enabled) {
      containerIp(parsed.user).then(ip => {
        if (!ip) { try { socket.destroy(); } catch {} return; }
        req._appTarget = `http://${ip}:${pub.port}`;
        req._appPrefix = `/${parsed.user}/${parsed.project}`;
        appProxy.upgrade(req, socket, head);
      }).catch(() => { try { socket.destroy(); } catch {} });
      return;
    }
  }
  if (req.url && req.url.startsWith('/code/')) {
    codeProxy.upgrade(req, socket, head);
  }
});
```
(Заменить существующий обработчик upgrade целиком на этот вариант.)

- [ ] **Step 5: Проверить, что нужные функции импортированы**

Убедиться, что в server.js доступны `readPublish, ensureRunning, containerIp` (импортированы в Task 4) и `touchActivity, loadUsers` (уже импортированы). `createProxyMiddleware` уже импортирован (для codeProxy).

- [ ] **Step 6: Проверить старт панели и что обычные пути не сломались**

Run:
```bash
cd /opt/vibe-portal/panel && node --check server.js && node --check lib/students.js && node --check lib/publish.js
systemctl restart vibe-panel && sleep 1
echo -n "SPA / -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/
echo -n "css -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/css/style.css
echo -n "logs.html -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/logs.html
echo -n "api/me -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/api/me
echo -n "несуществующий /test/nope/ -> "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3020/test/nope/
```
Expected: `/`=200, css=200, logs.html=200, api/me=401, `/test/nope/`=404 (не опубликовано → next → static 404). Панель должна стартовать без ошибок циклического импорта.

- [ ] **Step 7: Commit**

```bash
cd /opt/vibe-portal && git add panel/server.js panel/lib/students.js
git commit -m "panel: публичный прокси /<user>/<project>/ + auth-гейт, ws, резерв логинов, reaper keepAlive"
```

---

## Task 6: UI — модалка публикации + иконки в таблице

**Files:**
- Modify: `panel/public/index.html`
- Modify: `panel/public/js/app.js`
- Modify: `panel/public/css/style.css`

- [ ] **Step 1: Добавить модалку в index.html**

Перед `<!-- ── Modal: Create project from template ...` вставить:
```html
  <!-- ── Modal: Публикация приложения ─────────────────────── -->
  <div class="modal-overlay hidden" id="modal-publish" role="dialog" aria-modal="true">
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <span class="modal-title">Публикация · <span id="pub-project"></span></span>
        <button class="modal-close" data-close="modal-publish" aria-label="Закрыть">✕</button>
      </div>
      <label class="pub-row">
        <input type="checkbox" id="pub-enabled" />
        <span>Опубликовать приложение</span>
      </label>
      <div class="form-group">
        <label class="form-label">Кто может смотреть</label>
        <select id="pub-visibility" class="form-input">
          <option value="owner">Только я и админ</option>
          <option value="auth">Все залогиненные ученики</option>
        </select>
      </div>
      <label class="pub-row">
        <input type="checkbox" id="pub-autosleep" checked />
        <span>Авто-засыпание (засыпает с контейнером через 30 мин простоя)</span>
      </label>
      <div class="pub-url-box hidden" id="pub-url-box">
        <span class="pub-url" id="pub-url"></span>
        <button class="btn btn-sm" id="pub-copy">Копировать</button>
        <a class="btn btn-sm" id="pub-open" target="_blank">Открыть →</a>
      </div>
      <div class="pub-status" id="pub-status"></div>
      <div class="form-error hidden" id="pub-error"></div>
      <div class="modal-footer">
        <button class="btn btn-sm" id="pub-redeploy">Передеплоить</button>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" data-close="modal-publish">Закрыть</button>
        <button class="btn btn-primary" id="pub-save">Сохранить</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Добавить иконки в строку проекта (app.js)**

В `panel/public/js/app.js` в шаблоне строки (`refreshProjects`), в `<td class="td-actions">` после кнопки `data-action="download"` добавить:
```js
                <button class="btn btn-sm" data-action="link" title="Открыть приложение">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
                <button class="btn btn-sm" data-action="publish" title="Публикация">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13"/><path d="M5 9l7-7 7 7"/><path d="M5 22h14"/></svg>
                </button>
```

- [ ] **Step 3: Пометить опубликованные строки и навесить обработчики**

В `refreshProjects`, в `.map(p => ...)` у `<tr ...>` добавить data-атрибут `data-published="${p.published ? '1' : ''}"` и `data-pub-url="${escapeHtml(p.publishUrl || '')}"`.
В блоке навешивания обработчиков (`$$('tbody tr', wrap).forEach(tr => {...})`) добавить:
```js
      $('[data-action="link"]', tr).onclick = () => {
        if (tr.dataset.published && tr.dataset.pubUrl) window.open(tr.dataset.pubUrl, '_blank');
        else openPublishModal(name);
      };
      $('[data-action="publish"]', tr).onclick = () => openPublishModal(name);
```

- [ ] **Step 4: Логика модалки (app.js)**

Добавить функции (например, рядом с `refreshProjects`):
```js
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
  try {
    await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/redeploy', { method: 'POST' });
    const s = await api('/api/projects/' + encodeURIComponent(PUB_PROJECT) + '/publish');
    renderPubUrl(s);
  } catch (e) { showPubError(e.message); }
}
```

- [ ] **Step 5: Привязать кнопки модалки (в блоке init, где навешиваются onclick)**

Рядом с `$('#btn-create').onclick = openCreateModal;` добавить:
```js
  $('#pub-save').onclick = savePublish;
  $('#pub-redeploy').onclick = redeployPublish;
  $('#pub-copy').onclick = () => {
    navigator.clipboard?.writeText($('#pub-url').textContent).catch(() => {});
  };
```

- [ ] **Step 6: Стили модалки (style.css)**

Дописать в конец `panel/public/css/style.css`:
```css
/* ── Публикация приложений ─────────────────────────────────── */
.pub-row { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; font-size: 13px; cursor: pointer; }
.pub-row input { margin-top: 2px; }
.pub-url-box {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: hsl(var(--accent) / .4); border: 1px solid hsl(var(--border));
  border-radius: 6px; padding: 8px 10px; margin: 10px 0;
}
.pub-url { font-family: var(--font-mono); font-size: 12px; color: hsl(var(--foreground)); word-break: break-all; flex: 1; }
.pub-status { font-family: var(--font-mono); font-size: 11px; color: hsl(var(--muted-foreground)); margin: 6px 0; }
```

- [ ] **Step 7: Проверить синтаксис фронта и раздачу**

Run:
```bash
cd /opt/vibe-portal/panel/public && node --check js/app.js && echo "app.js OK"
curl -s http://127.0.0.1:3020/index.html | grep -c "modal-publish"
```
Expected: `app.js OK`; счётчик `modal-publish` ≥ 1.

- [ ] **Step 8: Commit**

```bash
cd /opt/vibe-portal && git add panel/public/index.html panel/public/js/app.js panel/public/css/style.css
git commit -m "panel UI: модалка публикации + иконки ссылка/публикация в таблице проектов"
```

---

## Task 7: Относительные пути в шаблоне _base

**Files:**
- Modify: `templates/_base/src/public/index.html`

- [ ] **Step 1: Посмотреть текущие ссылки**

Run: `grep -n 'href="/\|src="/\|fetch("/\|fetch(\x27/' /opt/vibe-portal/templates/_base/src/public/index.html`
Expected: список абсолютных ссылок (`/css/...`, `/js/...`, `/api/...`) — если есть.

- [ ] **Step 2: Сделать пути относительными**

В `templates/_base/src/public/index.html` заменить ведущие `/` на относительные в ссылках на ассеты: `href="/css/x"` → `href="css/x"`, `src="/js/x"` → `src="js/x"`. Для fetch к API заменить `fetch('/api/...')` → `fetch('api/...')` (относительно текущего пути приложения). Если абсолютных ссылок нет — задача сводится к проверке Step 1 (пропустить замену).

- [ ] **Step 3: Проверить, что не осталось ведущих слэшей в ассетах**

Run: `grep -n 'href="/\|src="/' /opt/vibe-portal/templates/_base/src/public/index.html || echo "относительные пути — OK"`
Expected: `относительные пути — OK` (или только внешние http(s)-ссылки).

- [ ] **Step 4: Commit**

```bash
cd /opt/vibe-portal && git add templates/_base/src/public/index.html
git commit -m "templates/_base: относительные пути ассетов (для подпути публикации)"
```

---

## Task 8: Документация в CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Добавить раздел про публикацию в API-таблицу и описание**

В `CLAUDE.md` в таблицу API (рядом с `/api/projects/:name/download`) добавить строки:
```
| GET | `/api/projects/:name/publish` | user | статус публикации проекта |
| POST | `/api/projects/:name/publish` | user | вкл/выкл публикацию (visibility, autosleep) |
| POST | `/api/projects/:name/redeploy` | user | перезапуск приложения |
| ANY | `/<user>/<project>/*` | session (visibility) | прокси в приложение ученика (self-heal) |
```

- [ ] **Step 2: Добавить абзац-описание после таблицы**

Вставить после таблицы API:
```
**Публикация приложений.** Ученик публикует проект → приложение крутится в его
контейнере на порту 3001+ (как `student`), панель проксирует
`/<user>/<project>/*` → `http://<containerIP>:<port>/` по vibe-net (наружу порты
не светятся). Доступ по сессии: `visibility=owner` (владелец+админ) или `auth`
(любой залогиненный). Конфиг — в `.portal-meta.json` проекта (`publish:{enabled,
visibility,autosleep,port,cmd}`). Self-heal: заход на URL будит контейнер и
переподнимает процесс (`panel/lib/publish.js`, `ensureRunning`). `autosleep=false`
→ idle-reaper не усыпляет ученика. Деплой по умолчанию: Node (`node <entry>` с
`PORT`), PHP (`php -S`), статика (`php -S`). Логи приложения — `.publish/app.log`
в проекте, pid — `.publish/app.pid`. Образ контейнера включает `php-cli`.
Ограничение: приложения должны использовать относительные пути к ассетам
(подпуть `/<user>/<project>/`). Резерв логинов: `api,code,css,js,...` нельзя
завести как ученика.
```

- [ ] **Step 3: Обновить структуру файлов и порты**

В разделе «Структура файлов» добавить `│   ├── lib/{...,publish}.js`. В таблицу портов добавить строку: `| 3001-3099 (в контейнере) | приложения учеников (доступ через панель, наружу не торчат) |`.

- [ ] **Step 4: Commit**

```bash
cd /opt/vibe-portal && git add CLAUDE.md
git commit -m "docs: публикация приложений в CLAUDE.md"
```

---

## Task 9: End-to-end проверка

**Files:** нет (только запуск/проверка)

- [ ] **Step 1: Подготовить тестовый Node-проект у ученика test**

Run:
```bash
mkdir -p /data/vibe-students/test/pubdemo/src/public
cat > /data/vibe-students/test/pubdemo/package.json <<'JSON'
{ "name":"pubdemo","type":"module","scripts":{"start":"node src/server.js"},"dependencies":{} }
JSON
cat > /data/vibe-students/test/pubdemo/src/server.js <<'JS'
import http from 'node:http';
const PORT = process.env.PORT || 3000;
http.createServer((q,r)=>r.end('PUBDEMO OK '+q.url)).listen(PORT,'0.0.0.0');
JS
chown -R 1000:1000 /data/vibe-students/test/pubdemo
echo "ready"
```
Expected: `ready`.

- [ ] **Step 2: Включить публикацию напрямую через lib (имитация POST) и поднять**

Run:
```bash
cd /opt/vibe-portal/panel && node --input-type=module -e '
import { writePublish, allocatePort, ensureRunning } from "./lib/publish.js";
const port = allocatePort("test","pubdemo");
writePublish("test","pubdemo",{enabled:true,visibility:"owner",autosleep:true,port});
const r = await ensureRunning("test","pubdemo");
console.log("ensureRunning:", JSON.stringify(r));
' 2>&1
```
Expected: `ensureRunning: {"ip":"172.30.0.x","port":3001}` (контейнер поднялся, npm install прошёл, node стартовал).

- [ ] **Step 3: Проверить прокси напрямую в контейнер**

Run:
```bash
IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "vibe-net").IPAddress}}' vibe-test)
curl -s --max-time 5 "http://$IP:3001/" && echo "  <- приложение отвечает"
```
Expected: `PUBDEMO OK /  <- приложение отвечает`.

- [ ] **Step 4: Проверить auth-гейт публичного URL (без сессии → редирект, не 200)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3020/test/pubdemo/"`
Expected: `302` (нет сессии → редирект на `/`). Это подтверждает auth-гейт.

- [ ] **Step 5: Проверить self-heal: убить процесс, заход должен переподнять**

Run:
```bash
docker exec -u student -w /home/student/workspace/pubdemo vibe-test sh -lc 'kill $(cat .publish/app.pid) 2>/dev/null; rm -f .publish/app.pid'
cd /opt/vibe-portal/panel && node --input-type=module -e '
import { ensureRunning } from "./lib/publish.js";
console.log("re-ensure:", JSON.stringify(await ensureRunning("test","pubdemo")));
'
IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "vibe-net").IPAddress}}' vibe-test)
curl -s --max-time 5 "http://$IP:3001/" && echo "  <- self-heal сработал"
```
Expected: `re-ensure: {...}` и `PUBDEMO OK / <- self-heal сработал`.

- [ ] **Step 6: Очистить тестовые данные**

Run:
```bash
docker exec -u student -w /home/student/workspace/pubdemo vibe-test sh -lc 'kill $(cat .publish/app.pid) 2>/dev/null' 2>/dev/null
docker stop vibe-test >/dev/null 2>&1
rm -rf /data/vibe-students/test/pubdemo
echo "cleaned"
```
Expected: `cleaned`.

- [ ] **Step 7: Финальный коммит (если остались правки) и сводка**

```bash
cd /opt/vibe-portal && git status --short && git log --oneline -9
```
Expected: чистый рабочий каталог, 8-9 коммитов задачи.

---

## Замечания по реализации

- **Циклический импорт** students.js ↔ publish.js безопасен (вызовы во время выполнения). Если панель не стартует с ошибкой импорта — вынести `hasKeepAlive` в проверку через динамический `import()` в reaper.
- **Ручная проверка UI** (модалка, иконки, копирование URL, открытие приложения под реальной сессией) — отдельно в браузере под админом/учеником; автоматических средств в репозитории нет.
- **Безопасность:** порты 3001+ наружу не публикуются; доступ только через панель с auth-гейтом. Код ученика исполняется в его песочнице (cap-drop all). Принятый риск общего cookie-домена — в спеке/CLAUDE.md.
