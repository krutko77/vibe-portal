// ipmap.js — сопоставление source-IP контейнера vibe-net → логин ученика.
//
// Копия той же техники, что и shim/transcript.js (docker-лейбл kg.vibe.student,
// IP подменить нельзя — CapDrop=ALL). Не импортируем напрямую из shim/, чтобы
// deploy-service не зависел от чужого node_modules/файлов — это отдельный
// systemd-юнит, должен жить и обновляться независимо от шима.

import Docker from 'dockerode';

const NETWORK = process.env.VIBE_NETWORK || 'vibe-net';
const MAP_TTL_MS = 15_000;

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

let ipMap = new Map();
let ipMapAt = 0;
let refreshing = null;

async function rebuildIpMap() {
  const containers = await docker.listContainers({
    all: false,
    filters: { label: ['kg.vibe.role=workspace'] },
  });
  const next = new Map();
  for (const c of containers) {
    const user = c.Labels?.['kg.vibe.student'];
    if (!user) continue;
    const net = c.NetworkSettings?.Networks?.[NETWORK];
    const ip = net?.IPAddress;
    if (ip) next.set(ip, user);
  }
  ipMap = next;
  ipMapAt = Date.now();
}

export async function resolveUser(ip) {
  if (!ip) return null;
  const stale = Date.now() - ipMapAt > MAP_TTL_MS;
  if (stale || !ipMap.has(ip)) {
    if (!refreshing) {
      refreshing = rebuildIpMap().catch(e => {
        console.log(`[deploy ipmap] rebuild failed: ${e.message}`);
      }).finally(() => { refreshing = null; });
    }
    await refreshing;
  }
  return ipMap.get(ip) || null;
}
