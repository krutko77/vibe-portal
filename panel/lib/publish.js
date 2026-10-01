// publish.js — раздел проекта (группировка в «Мои проекты») и IP/проба
// контейнера ученика в vibe-net. Конфиг раздела хранится в .portal-meta.json
// проекта (источник истины).

import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import { containerName, workspaceDir } from './students.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const NETWORK = process.env.VIBE_NETWORK || 'vibe-net';

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

// Раздел проекта для группировки в таблице «Мои проекты» (см. server.js
// /api/projects и /api/projects/:name/section). Свободное имя, не отдельный
// реестр — переименование раздела = смена значения у всех его проектов.
export function readSection(user, project) {
  return readMeta(user, project).section || null;
}

export function writeSection(user, project, section) {
  const meta = readMeta(user, project);
  if (section) meta.section = section;
  else delete meta.section;
  writeMeta(user, project, meta);
  return meta.section || null;
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

// Жив ли процесс приложения (HTTP-проба, любой ответ = жив). Используется
// code-slots.js для проверки живости инстансов code-server.
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
