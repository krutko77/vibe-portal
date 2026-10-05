// Официальный статус сервисов Claude (status.claude.com, Atlassian Statuspage).
//
// Ходим НАПРЯМУЮ, без HTTPS_PROXY: прокси из proxy.env отвечает 403 на CONNECT к
// status.claude.com, а с хоста он доступен и так. Node fetch прокси из env сам
// не подхватывает — так и нужно.
//
// Кэш 60 с (статус-страница обновляется не чаще), при ошибке апстрима отдаём
// последнее известное с stale:true — как /_shim/usage.
//
// ВЫКЛЮЧЕНО по умолчанию (2026-10-05): прямые запросы с портала к
// status.claude.com временно запрещены — ждём, пока прокси разрешат этот хост.
// Пока CLAUDE_STATUS_ENABLED != '1', наружу не уходит ни одного запроса,
// API отвечает { disabled: true }, чип в навбаре серый.

export const CLAUDE_STATUS_ENABLED = process.env.CLAUDE_STATUS_ENABLED === '1';
const SUMMARY_URL = process.env.CLAUDE_STATUS_URL || 'https://status.claude.com/api/v2/summary.json';
const PAGE_URL = 'https://status.claude.com';
const CACHE_MS = 60_000;

let cache = null;      // { data, at }
let inflight = null;

function normalize(raw) {
  const components = (raw.components || [])
    .filter(c => !c.group)              // группы-контейнеры не показываем
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(c => ({ id: c.id, name: c.name, status: c.status }));
  const nameById = Object.fromEntries(components.map(c => [c.id, c.name]));

  const incidents = (raw.incidents || []).map(i => ({
    id: i.id,
    name: i.name,
    status: i.status,          // investigating | identified | monitoring | ...
    impact: i.impact,          // none | minor | major | critical
    url: i.shortlink || `${PAGE_URL}/incidents/${i.id}`,
    updatedAt: i.updated_at,
    components: (i.components || []).map(c => nameById[c.id] || c.name),
    updates: (i.incident_updates || []).map(u => ({
      status: u.status,
      body: u.body,
      at: u.display_at || u.created_at,
    })),
  }));

  const maintenances = (raw.scheduled_maintenances || []).map(m => ({
    id: m.id,
    name: m.name,
    status: m.status,
    url: m.shortlink || `${PAGE_URL}/incidents/${m.id}`,
    scheduledFor: m.scheduled_for,
    scheduledUntil: m.scheduled_until,
  }));

  return {
    indicator: raw.status?.indicator || 'none',   // none | minor | major | critical | maintenance
    description: raw.status?.description || '',
    pageUrl: PAGE_URL,
    updatedAt: raw.page?.updated_at || null,
    components,
    incidents,
    maintenances,
  };
}

async function load() {
  const r = await fetch(SUMMARY_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`status.claude.com ${r.status}`);
  return normalize(await r.json());
}

export async function getClaudeStatus({ force = false } = {}) {
  if (!CLAUDE_STATUS_ENABLED) return { disabled: true };
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.data, fetchedAt: new Date(cache.at).toISOString(), stale: false };
  }
  if (!inflight) {
    inflight = load()
      .then(data => { cache = { data, at: Date.now() }; })
      .finally(() => { inflight = null; });
  }
  try {
    await inflight;
    return { ...cache.data, fetchedAt: new Date(cache.at).toISOString(), stale: false };
  } catch (e) {
    if (cache) return { ...cache.data, fetchedAt: new Date(cache.at).toISOString(), stale: true };
    throw e;
  }
}
