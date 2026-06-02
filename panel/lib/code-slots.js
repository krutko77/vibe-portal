// code-slots.js — несколько окон VS Code под ОДНОЙ учёткой.
//
// Зачем. 2-3 человека заходят одним логином и работают одновременно. Один
// code-server = одно общее окно (общие терминалы/вкладки/курсор-контекст) —
// они мешают друг другу. Поэтому каждой КОНКУРЕНТНОЙ сессии выдаём свой "слот":
// отдельный процесс code-server в ТОМ ЖЕ контейнере на порту 8080+slot со своим
// --user-data-dir (независимые окна/терминалы/вкладки), но общий workspace на
// диске и общие расширения. Файлы общие → при одновременной правке одного файла
// двумя людьми code-server покажет обычный конфликт "файл изменён на диске".
//
// Слот липнет к сессии (req.session.codeSlot). Распределение — по карте живости
// в памяти: слот считается свободным, если его сессия не "тыкала" дольше TTL.
// Соло-ученик всегда получает слот 0 (PID-1 code-server из CMD контейнера) —
// никаких лишних процессов, нулевой оверхед. Дополнительные инстансы поднимаются
// лениво, через docker exec (тот же приём, что в publish.js).

import { execFile } from 'node:child_process';
import { containerName, dockerStart } from './students.js';
import { containerIp, appAlive } from './publish.js';

const MAX_SLOTS = parseInt(process.env.CODE_MAX_SLOTS || '3', 10);
const SLOT_TTL_MS = parseInt(process.env.CODE_SLOT_TTL_MIN || '40', 10) * 60_000;
const BASE_PORT = 8080;

// user -> Map<slot, lastSeenMs>
const live = new Map();

function slotsOf(user) {
  let m = live.get(user);
  if (!m) { m = new Map(); live.set(user, m); }
  const now = Date.now();
  for (const [slot, at] of m) if (now - at > SLOT_TTL_MS) m.delete(slot); // prune stale
  return m;
}

export function touchSlot(user, slot) {
  slotsOf(user).set(slot, Date.now());
}

// Выдать слот новой сессии: наименьший свободный в [0, MAX). Если все заняты —
// наименее недавно виденный (graceful degrade: эта пара делит одно окно).
export function allocateSlot(user) {
  const m = slotsOf(user);
  for (let s = 0; s < MAX_SLOTS; s++) {
    if (!m.has(s)) { m.set(s, Date.now()); return s; }
  }
  let lru = 0, lruAt = Infinity;
  for (const [slot, at] of m) if (at < lruAt) { lruAt = at; lru = slot; }
  m.set(lru, Date.now());
  return lru;
}

export function releaseSlot(user, slot) {
  const m = live.get(user);
  if (m) m.delete(slot);
}

export function portForSlot(slot) { return BASE_PORT + slot; }

function execP(args, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout));
  });
}

async function launchInstance(user, slot, port) {
  const dataDir = `/home/student/.cs-data/${slot}`;
  const cmd =
    `mkdir -p ${dataDir}; ` +
    `code-server --bind-addr 0.0.0.0:${port} --auth none ` +
    `--disable-telemetry --disable-update-check ` +
    `--user-data-dir ${dataDir} ` +
    `--extensions-dir /home/student/.local/share/code-server/extensions ` +
    `/home/student/workspace`;
  // -d: детач. Если порт уже занят (гонка двух одновременных запросов на слот) —
  // второй процесс не сможет забиндиться и тихо умрёт, первый останется живым.
  // Поэтому отдельный lock не нужен: bind на порт сам сериализует. sh -lc — как
  // в publish.js, чтобы login-shell выставил HOME (auth/конфиг + сидинг).
  await execP(['exec', '-d', '-u', 'student', '-w', '/home/student/workspace',
    containerName(user), 'sh', '-lc', cmd]);
}

// Убедиться, что инстанс code-server для (user, slot) поднят. Возвращает target
// URL `http://<containerIP>:<port>` для прокси (по vibe-net, наружу не торчит).
// slot 0 — PID-1 code-server из CMD контейнера (отдельно не запускаем, только
// ждём готовности после dockerStart).
export async function ensureCodeInstance(user, slot) {
  const port = portForSlot(slot);
  await dockerStart(user);
  let ip = await containerIp(user);
  if (ip && await appAlive(ip, port)) return `http://${ip}:${port}`;
  if (slot !== 0) await launchInstance(user, slot, port);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    ip = await containerIp(user);
    if (ip && await appAlive(ip, port)) return `http://${ip}:${port}`;
  }
  throw new Error(`code-server slot ${slot} did not come up`);
}
