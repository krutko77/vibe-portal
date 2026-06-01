// publish.js — публикация приложений учеников.
// Конфиг публикации хранится в .portal-meta.json проекта (источник истины).
// Приложение крутится в контейнере ученика на выделенном порту; панель
// проксирует /<user>/<project>/ → http://<containerIP>:<port>/.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Docker from 'dockerode';
import { containerName, workspaceDir, dockerStart } from './students.js';

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
export async function ensureRunning(user, project) {
  const pub = readPublish(user, project);
  if (!pub || !pub.enabled) throw new Error('not published');
  await dockerStart(user);
  let ip = await containerIp(user);
  if (await appAlive(ip, pub.port)) return { ip, port: pub.port };
  await deployApp(user, project, pub.port);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    ip = await containerIp(user);
    if (await appAlive(ip, pub.port)) return { ip, port: pub.port };
  }
  throw new Error('app did not come up');
}

export { docker, NETWORK, NAME_RE, execFile };
