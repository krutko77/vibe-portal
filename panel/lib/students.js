// CRUD учеников: htpasswd + users-vibe.json + workspace папка + docker контейнер.

import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';
import {
  loadUsers, saveUsers,
  htpasswdSet, htpasswdDelete,
} from './auth.js';
import { hasKeepAlive } from './publish.js';
import { ensureKeys, removeKeys, sshMountDir } from './ssh-access.js';
import { spawnSync } from 'node:child_process';

const STUDENTS_ROOT = process.env.STUDENTS_ROOT || '/data/vibe-students';
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/opt/vibe-portal/templates';
const IMAGE = process.env.VIBE_IMAGE || 'vibe-workspace:dev';
const NETWORK = process.env.VIBE_NETWORK || 'vibe-net';
const EXTENSIONS_VOLUME = process.env.VIBE_EXTENSIONS_VOLUME || 'vibe-extensions';
const SKILLS_VOLUME = process.env.VIBE_SKILLS_VOLUME || 'vibe-claude-skills';
const SHIM_BASE_URL = process.env.SHIM_BASE_URL || 'http://172.30.0.1:8190';
// Лимит — потолок, а не резерв: соло-ученик столько не съест. Поднят с 1536/1.0,
// т.к. под одной учёткой может работать 2-3 человека (каждый — свой code-server
// + свой claude в том же контейнере, см. lib/code-slots.js).
const MEM_LIMIT_MB = parseInt(process.env.STUDENT_MEM_LIMIT_MB || '3072', 10);
const CPU_LIMIT = parseFloat(process.env.STUDENT_CPU_LIMIT || '1.5');

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

// SSH-порт контейнерного sshd (8400+), публикуется наружу (десктопный VS Code).
function allocateSshPort(state) {
  const used = new Set();
  for (const u of Object.values(state.users)) {
    if (u.sshPort) used.add(u.sshPort);
  }
  let p = state.ports.nextFreeSsh || 8400;
  while (used.has(p)) p++;
  state.ports.nextFreeSsh = p + 1;
  return p;
}

// Гарантирует SSH-провижн ученика: sshPort в state (если нет — аллоцирует),
// ключи (panel-generated) и папку .vscode-server. state НЕ сохраняет — вызывающий
// делает saveUsers сам. Возвращает sshPort. Идемпотентно (для lazy-миграции).
function ensureSshProvision(username, state) {
  const u = state.users[username];
  if (!u.sshPort) u.sshPort = allocateSshPort(state);
  ensureKeys(username);
  const vsdir = `/data/config/vscode-server/${username}`;
  fs.mkdirSync(vsdir, { recursive: true });
  fs.chownSync(vsdir, 1000, 1000);
  return u.sshPort;
}

export async function createStudent({ username, password, role = 'user' }) {
  const state = loadUsers();
  const RESERVED = new Set(['api', 'code', 'assets', 'css', 'js', 'img', 'public', 'well-known', 'logs', 'history', 'help', 'security', 'dashboard', 'leaderboard', 'rating']);
  if (RESERVED.has(username)) {
    throw new Error(`reserved username: ${username}`);
  }
  if (state.users[username]) {
    throw new Error(`student already exists: ${username}`);
  }

  htpasswdSet(username, password);

  const ws = workspaceDir(username);
  fs.mkdirSync(ws, { recursive: true });
  // uid=1000 — это user student внутри контейнера
  fs.chownSync(ws, 1000, 1000);

  // Workspace-level CLAUDE.md: Claude поднимется по dir-tree и прочитает.
  // Учим его сразу что это курс, какие скиллы и где память.
  writeWorkspaceClaudeMd(ws, username);

  const port = allocatePort(state);
  state.users[username] = {
    role,
    createdAt: new Date().toISOString(),
    containerPort: port,
    lastActivityAt: null,
  };
  const sshPort = ensureSshProvision(username, state); // sshPort + ключи + .vscode-server
  saveUsers(state);

  await dockerCreate(username, port, sshPort);
  return state.users[username];
}

export async function deleteStudent(username) {
  const state = loadUsers();
  if (!state.users[username]) throw new Error('no such student');

  await dockerRemove(username).catch(() => {});
  htpasswdDelete(username);
  removeKeys(username);
  fs.rmSync(`/data/config/vscode-server/${username}`, { recursive: true, force: true });

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

// Смена пароля существующего ученика. htpasswd -bB перезаписывает запись,
// контейнер/сессии не трогаем — следующий вход пойдёт с новым паролем.
// htpasswdSet валидирует логин и длину пароля (>= 6).
export function setStudentPassword(username, password) {
  const state = loadUsers();
  if (!state.users[username]) throw new Error('no such student');
  htpasswdSet(username, password);
}

// Гарантирует SSH-провижн (порт+ключи) и сохраняет state. Возвращает sshPort.
// Зовётся из API, если ученик открыл раздел SSH до старта контейнера.
export function provisionSsh(username) {
  const state = loadUsers();
  if (!state.users[username]) throw new Error('no such student');
  const sshPort = ensureSshProvision(username, state);
  saveUsers(state);
  return sshPort;
}

// Workspace-level CLAUDE.md — раскатывается при создании ученика
// и при первом dockerCreate. Идемпотентно — если файл уже есть, не трогаем.
export function writeWorkspaceClaudeMd(ws, username) {
  const file = path.join(ws, 'CLAUDE.md');
  if (fs.existsSync(file)) return;
  const body = `# Workspace ученика курса VibeCoding

Это твой личный workspace на портале \`vibe.kiselevgroup.com\`.

- **Ученик:** \`${username}\`
- **Расположение:** \`/home/student/workspace/\` (внутри твоего Docker-контейнера)
- **Шаблоны курса (read-only):** \`/home/student/templates/\`

## Что важно для Claude

- **Память.** Для длительного контекста по проекту используй skill \`claude-memory\` —
  он структурно ведёт \`.claude/memory/\` (что было сделано, какие решения приняты).
- **Скиллы.** Под рукой: \`superpowers\` (общие практики), \`ui-ux-pro-max\` (frontend/UI),
  \`claude-memory\` (память). Все лежат в \`~/.claude/skills/\` (read-only volume).
- **Правила работы:**
  - Общайся и думай по-русски, код и имена файлов — латиницей.
  - Сначала действуй, потом коротко отчитайся (без длинных преамбул).
  - Деплой проектов — только когда явно попросили.

## Структура

\`\`\`
/home/student/
├── workspace/            ← здесь твои проекты (видна только тебе)
│   ├── CLAUDE.md         ← этот файл
│   └── <проект>/
│       ├── .claude/      ← локальная память и настройки проекта
│       └── CLAUDE.md     ← инструкции конкретного проекта
├── templates/            ← курсовые шаблоны (read-only)
└── .claude/
    └── skills/           ← общие скиллы (superpowers / ui-ux-pro-max / claude-memory)
\`\`\`
`;
  fs.writeFileSync(file, body, 'utf-8');
  try { fs.chownSync(file, 1000, 1000); } catch {}
}

export function listStudents() {
  const state = loadUsers();
  return Object.entries(state.users).map(([username, u]) => ({
    username, ...u,
  }));
}

// ---------- docker lifecycle ----------

async function dockerCreate(username, port, sshPort) {
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
      // Отключаем авто-1M-контекст: на OAuth-подписке он требует usage credits
      // → ошибка у ученика. CLI вместо этого компактит в рамках 200K.
      'CLAUDE_CODE_DISABLE_1M_CONTEXT=1',
    ],
    // entrypoint поднимает sshd (десктопный VS Code) + exec code-server.
    Cmd: ['/usr/local/bin/vibe-entrypoint.sh'],
    Labels: {
      'kg.vibe.student': username,
      'kg.vibe.role': 'workspace',
    },
    HostConfig: {
      NetworkMode: NETWORK,
      Binds: [
        `${workspaceDir(username)}:/home/student/workspace:rw`,
        `${TEMPLATES_DIR}:/home/student/templates:ro`,
        // Общий volume для расширений code-server: ставишь раз — у всех есть.
        // User-settings/keybindings/state у каждого свои (не маунтятся).
        `${EXTENSIONS_VOLUME}:/home/student/.local/share/code-server/extensions:rw`,
        // Общие Claude-скиллы (superpowers / ui-ux-pro-max / claude-memory)
        // — read-only, чтобы клод-внутри-контейнера их видел в ~/.claude/skills.
        `${SKILLS_VOLUME}:/home/student/.claude/skills:ro`,
        // SSH (десктопный VS Code): host-key + authorized_keys (только публичный
        // ключ ученика; приватник в контейнер НЕ монтируется — см. ssh-access.js).
        `${sshMountDir(username)}:/home/student/.sshd:rw`,
        // Персист VS Code server между пересозданиями контейнера.
        `/data/config/vscode-server/${username}:/home/student/.vscode-server:rw`,
      ],
      PortBindings: {
        '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }],
        // sshd контейнера наружу (ноут ученика дотягивается); только pubkey.
        '2222/tcp': [{ HostIp: '0.0.0.0', HostPort: String(sshPort) }],
      },
      // tini как PID 1 — reaping зомби (sshd форкает per-connection дети).
      Init: true,
      Memory: MEM_LIMIT_MB * 1024 * 1024,
      MemorySwap: MEM_LIMIT_MB * 1024 * 1024,
      NanoCpus: Math.round(CPU_LIMIT * 1e9),
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    ExposedPorts: { '8080/tcp': {}, '2222/tcp': {} },
  });
  return c.id;
}

async function dockerRemove(username) {
  const c = docker.getContainer(containerName(username));
  await c.remove({ force: true });
}

export async function dockerStart(username) {
  const state = loadUsers();
  const u = state.users[username];
  if (!u) throw new Error(`no such student: ${username}`);

  let c = docker.getContainer(containerName(username));
  let info;
  try {
    info = await c.inspect();
  } catch (e) {
    if (e.statusCode !== 404) throw e;
    if (!u.containerPort) throw new Error(`no port assigned for ${username}`);
    const sshPort = ensureSshProvision(username, state); // lazy-миграция: sshPort+ключи существующим
    saveUsers(state);
    await dockerCreate(username, u.containerPort, sshPort);
    c = docker.getContainer(containerName(username));
    info = await c.inspect();
  }
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

// Учёт заходов (для дашборда/рейтинга). Инкремент при каждом успешном логине.
// Бэкфилла нет — счётчик растёт с момента внедрения, как и аудит диалогов.
export function recordLogin(username) {
  const state = loadUsers();
  if (!state.users[username]) return;
  const u = state.users[username];
  u.loginCount = (u.loginCount || 0) + 1;
  u.lastLoginAt = new Date().toISOString();
  // Посуточный счётчик заходов — для дневного рейтинга на дашборде. Бэкфилла нет,
  // растёт с момента внедрения. День в UTC — как у транскриптов/leaderboard.
  const day = new Date().toISOString().slice(0, 10);
  u.dailyLogins = u.dailyLogins || {};
  u.dailyLogins[day] = (u.dailyLogins[day] || 0) + 1;
  saveUsers(state);
}

// Бэкграунд-задача: останавливаем idle > IDLE_STOP_MIN минут
const IDLE_STOP_MIN = parseInt(process.env.IDLE_STOP_MIN || '30', 10);

// Есть ли живая SSH-сессия к контейнеру ученика — established-соединение на
// его published sshPort (десктопный VS Code держит соединение открытым).
function hasActiveSsh(sshPort) {
  if (!sshPort) return false;
  const r = spawnSync('ss', ['-tnH', 'state', 'established', `sport = :${sshPort}`],
    { encoding: 'utf8' });
  if (r.status !== 0) return false;
  return r.stdout.trim().length > 0;
}

export async function reapIdleContainers() {
  const state = loadUsers();
  const now = Date.now();
  let dirty = false;
  for (const [username, u] of Object.entries(state.users)) {
    const last = u.lastActivityAt ? Date.parse(u.lastActivityAt) : 0;
    if (now - last < IDLE_STOP_MIN * 60 * 1000) continue;
    if (hasKeepAlive(username)) continue; // опубликовано с autosleep=off — не усыпляем
    // Живая SSH-сессия (десктопный VS Code) = активность: не усыпляем, обновляем метку.
    if (hasActiveSsh(u.sshPort)) {
      u.lastActivityAt = new Date().toISOString();
      dirty = true;
      continue;
    }
    const status = await containerStatus(username);
    if (status.running) {
      await dockerStop(username).catch(() => {});
      console.log(`[reaper] stopped ${username} (idle)`);
    }
  }
  if (dirty) saveUsers(state);
}

export function startReaper() {
  setInterval(() => {
    reapIdleContainers().catch(e => console.error('[reaper]', e.message));
  }, 5 * 60 * 1000);
}
