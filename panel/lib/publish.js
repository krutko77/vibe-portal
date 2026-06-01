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
