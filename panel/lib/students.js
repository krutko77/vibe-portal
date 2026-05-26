// CRUD учеников: htpasswd + users-vibe.json + workspace папка + docker контейнер.

import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import {
  loadUsers, saveUsers,
  htpasswdSet, htpasswdDelete,
} from './auth.js';

const STUDENTS_ROOT = process.env.STUDENTS_ROOT || '/data/vibe-students';
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/opt/dev-portal/templates/vibe';
const IMAGE = process.env.VIBE_IMAGE || 'vibe-workspace:dev';
const NETWORK = process.env.VIBE_NETWORK || 'vibe-net';
const SHIM_BASE_URL = process.env.SHIM_BASE_URL || 'http://172.30.0.1:8190';
const MEM_LIMIT_MB = parseInt(process.env.STUDENT_MEM_LIMIT_MB || '1536', 10);
const CPU_LIMIT = parseFloat(process.env.STUDENT_CPU_LIMIT || '1.0');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export function containerName(username) {
  return `vibe-${username}`;
}

export function workspaceDir(username) {
  return path.join(STUDENTS_ROOT, username);
}

function allocatePort(state) {
  const used = new Set();
  for (const u of Object.values(state.users)) {
    if (u.containerPort) used.add(u.containerPort);
  }
  let p = state.ports.nextFree || 8200;
  while (used.has(p)) p++;
  state.ports.nextFree = p + 1;
  return p;
}

export async function createStudent({ username, password, role = 'user' }) {
  const state = loadUsers();
  if (state.users[username]) {
    throw new Error(`student already exists: ${username}`);
  }

  htpasswdSet(username, password);

  const ws = workspaceDir(username);
  fs.mkdirSync(ws, { recursive: true });
  // uid=1000 — это user student внутри контейнера
  fs.chownSync(ws, 1000, 1000);

  const port = allocatePort(state);
  state.users[username] = {
    role,
    createdAt: new Date().toISOString(),
    containerPort: port,
    lastActivityAt: null,
  };
  saveUsers(state);

  await dockerCreate(username, port);
  return state.users[username];
}

export async function deleteStudent(username) {
  const state = loadUsers();
  if (!state.users[username]) throw new Error('no such student');

  await dockerRemove(username).catch(() => {});
  htpasswdDelete(username);

  // workspace в архив, не удаляем
  const ws = workspaceDir(username);
  const archive = path.join(STUDENTS_ROOT, '.deleted',
    `${username}-${Date.now()}`);
  if (fs.existsSync(ws)) {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.renameSync(ws, archive);
  }

  delete state.users[username];
  saveUsers(state);
}

export function listStudents() {
  const state = loadUsers();
  return Object.entries(state.users).map(([username, u]) => ({
    username, ...u,
  }));
}

// ---------- docker lifecycle ----------

async function dockerCreate(username, port) {
  const name = containerName(username);

  // если уже есть — удаляем
  try {
    const c = docker.getContainer(name);
    await c.remove({ force: true });
  } catch {}

  const c = await docker.createContainer({
    name,
    Image: IMAGE,
    User: 'student',
    WorkingDir: '/home/student/workspace',
    Env: [
      `ANTHROPIC_BASE_URL=${SHIM_BASE_URL}`,
      'ANTHROPIC_AUTH_TOKEN=sk-vibe-shim-placeholder',
      `STUDENT_USERNAME=${username}`,
    ],
    Cmd: ['code-server', '/home/student/workspace'],
    Labels: {
      'kg.vibe.student': username,
      'kg.vibe.role': 'workspace',
    },
    HostConfig: {
      NetworkMode: NETWORK,
      Binds: [
        `${workspaceDir(username)}:/home/student/workspace:rw`,
        `${TEMPLATES_DIR}:/home/student/templates:ro`,
      ],
      PortBindings: {
        '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }],
      },
      Memory: MEM_LIMIT_MB * 1024 * 1024,
      MemorySwap: MEM_LIMIT_MB * 1024 * 1024,
      NanoCpus: Math.round(CPU_LIMIT * 1e9),
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    ExposedPorts: { '8080/tcp': {} },
  });
  return c.id;
}

async function dockerRemove(username) {
  const c = docker.getContainer(containerName(username));
  await c.remove({ force: true });
}

export async function dockerStart(username) {
  const c = docker.getContainer(containerName(username));
  const info = await c.inspect();
  if (info.State.Running) return info;
  await c.start();
  return await c.inspect();
}

export async function dockerStop(username) {
  const c = docker.getContainer(containerName(username));
  const info = await c.inspect();
  if (!info.State.Running) return info;
  await c.stop({ t: 5 });
  return await c.inspect();
}

export async function containerStatus(username) {
  try {
    const c = docker.getContainer(containerName(username));
    const info = await c.inspect();
    return {
      exists: true,
      running: info.State.Running,
      startedAt: info.State.StartedAt,
      finishedAt: info.State.FinishedAt,
    };
  } catch {
    return { exists: false, running: false };
  }
}

export function touchActivity(username) {
  const state = loadUsers();
  if (!state.users[username]) return;
  state.users[username].lastActivityAt = new Date().toISOString();
  saveUsers(state);
}

// Бэкграунд-задача: останавливаем idle > IDLE_STOP_MIN минут
const IDLE_STOP_MIN = parseInt(process.env.IDLE_STOP_MIN || '30', 10);

export async function reapIdleContainers() {
  const state = loadUsers();
  const now = Date.now();
  for (const [username, u] of Object.entries(state.users)) {
    const last = u.lastActivityAt ? Date.parse(u.lastActivityAt) : 0;
    if (now - last < IDLE_STOP_MIN * 60 * 1000) continue;
    const status = await containerStatus(username);
    if (status.running) {
      await dockerStop(username).catch(() => {});
      console.log(`[reaper] stopped ${username} (idle)`);
    }
  }
}

export function startReaper() {
  setInterval(() => {
    reapIdleContainers().catch(e => console.error('[reaper]', e.message));
  }, 5 * 60 * 1000);
}
