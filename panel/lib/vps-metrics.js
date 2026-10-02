// CPU/RAM «нагрузка сервера» (VPS РФ, Brainy Waxwing) — история уже копится самим
// хостингом (Timeweb Cloud), свой сэмплер не нужен: просто забираем нужный диапазон
// из их API в момент открытия модалки. Токен — TIMEWEB_API_TOKEN в
// /data/config/env/vibe-panel.env (EnvironmentFile vibe-panel.service).

const API_BASE = 'https://api.timeweb.cloud/api/v1';
const SERVER_ID = process.env.TIMEWEB_SERVER_ID || '8414777';
const TOKEN = process.env.TIMEWEB_API_TOKEN || '';

const RANGE_HOURS = { '1h': 1, '6h': 6, '24h': 24, week: 24 * 7, '2w': 24 * 14, month: 24 * 30 };
export const VALID_RANGES = Object.keys(RANGE_HOURS);
const MAX_POINTS = 300;
const CACHE_TTL_MS = 60_000;

const cache = new Map(); // range -> { at, data }
let diskCache = null; // { at, data }

function isoNoMs(d) {
  return d.toISOString().slice(0, 19);
}

// Усредняет по бакетам все числовые поля точки, кроме `t` (а не только `v`) —
// у RAM кроме `v` (использовано) есть `vCached` (использовано с кэшем), оба
// должны схлопываться синхронно, индекс-в-индекс, иначе две линии разъедутся.
// `digits` — точность округления (CPU хочет десятые, как в дашборде Timeweb;
// RAM по умолчанию остаётся целыми, как раньше).
function downsample(points, digits = 0) {
  const factor = 10 ** digits;
  if (points.length <= MAX_POINTS) return points;
  const bucketSize = Math.ceil(points.length / MAX_POINTS);
  const keys = Object.keys(points[0]).filter(k => k !== 't');
  const out = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    const chunk = points.slice(i, i + bucketSize);
    const bucket = { t: chunk[Math.floor(chunk.length / 2)].t };
    for (const k of keys) {
      bucket[k] = Math.round(chunk.reduce((a, p) => a + p[k], 0) / chunk.length * factor) / factor;
    }
    out.push(bucket);
  }
  return out;
}

function stats(points, digits = 0) {
  if (!points.length) return { now: 0, avg: 0, max: 0 };
  const factor = 10 ** digits;
  const vals = points.map(p => p.v);
  return {
    now: vals[vals.length - 1],
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * factor) / factor,
    max: Math.max(...vals),
  };
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Timeweb API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

export async function getVpsMetrics(range) {
  const key = RANGE_HOURS[range] ? range : '24h';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  if (!TOKEN) {
    throw new Error('TIMEWEB_API_TOKEN не задан в /data/config/env/vibe-panel.env');
  }

  const hours = RANGE_HOURS[key];
  const now = isoNoMs(new Date());

  // RAM: старый /statistics?date_from&date_to — отдаёт %-занятость памяти
  // напрямую (total/used в Мб), сортировка новое→старое (реверсим ниже).
  const ramUrl = `${API_BASE}/servers/${SERVER_ID}/statistics` +
    `?date_from=${encodeURIComponent(isoNoMs(new Date(Date.now() - hours * 60 * 60 * 1000)))}` +
    `&date_to=${encodeURIComponent(now)}`;

  // CPU: на этом сервере старый endpoint отдаёт пустой cpu[] (проверено),
  // работает только «новый» /statistics/{time_from}/{period}/{keys}.
  // ВАЖНО: time_from — это ПРАВАЯ граница окна, период отсчитывается НАЗАД от
  // неё (т.е. time_from=now, period=hours → данные за последние `hours` часов;
  // если подставить time_from=now-hours, окно уедет на `hours` в прошлое).
  const cpuUrl = `${API_BASE}/servers/${SERVER_ID}/statistics/` +
    `${encodeURIComponent(now)}/${hours}/system.cpu.util`;

  const [ramBody, cpuBody] = await Promise.all([fetchJson(ramUrl), fetchJson(cpuUrl)]);

  // vGb/vCachedGb — абсолютные значения (ГБ) для оси Y в стиле Timeweb-дашборда
  // (там шкала RAM не в %, а в ГБ, до физического потолка сервера — см. totalGb
  // ниже и `renderVpsMemChart` на фронте). total/used/used_cached от API — в МБ.
  const ramRaw = (ramBody.ram || [])
    .map(p => ({
      t: new Date(p.logged_at).getTime(),
      v: p.total ? Math.round((p.used / p.total) * 100) : 0,
      vCached: p.total ? Math.round(Math.max(0, Math.min(p.total, p.used_cached)) / p.total * 100) : 0,
      vGb: Math.round((p.used / 1024) * 100) / 100,
      vCachedGb: Math.round((Math.max(0, Math.min(p.total, p.used_cached)) / 1024) * 100) / 100,
    }))
    .reverse();
  // Самая свежая точка (до .reverse() — первая в ответе API) несёт total
  // сервера; он не меняется в рамках диапазона, хватает одного значения.
  const ramTotalMb = ramBody.ram?.[0]?.total || 0;
  const ramTotalGb = Math.round((ramTotalMb / 1024) * 10) / 10;

  const cpuList = cpuBody.statistics?.[0]?.list || [];
  const cpuRaw = cpuList.map(p => ({
    t: new Date(p.time).getTime(),
    v: Math.round(Math.max(0, Math.min(100, p.value)) * 10) / 10,
  }));

  const data = {
    cpu: { points: downsample(cpuRaw, 1), ...stats(cpuRaw, 1) },
    mem: { points: downsample(ramRaw, 2), ...stats(ramRaw), totalGb: ramTotalGb },
  };

  cache.set(key, { at: Date.now(), data });
  return data;
}

// Диск: берём не локальный statfs(/), а то же, что показывает сам Timeweb Cloud
// (/api/v1/servers/{id} → disks[0].size/used, в МиБ) — у root-раздела statfs()
// меньше реального диска на размер служебных EFI/boot-партиций, и дашборд
// хостинга с ним не совпадал.
export async function getVpsDisk() {
  if (diskCache && Date.now() - diskCache.at < CACHE_TTL_MS) return diskCache.data;

  if (!TOKEN) {
    throw new Error('TIMEWEB_API_TOKEN не задан в /data/config/env/vibe-panel.env');
  }

  const body = await fetchJson(`${API_BASE}/servers/${SERVER_ID}`);
  const disk = body.server?.disks?.[0];
  if (!disk) throw new Error('Timeweb API: нет данных о диске сервера');

  const total = disk.size * 1024 * 1024;
  const used = disk.used * 1024 * 1024;
  const avail = total - used;
  const percent = Math.ceil((used / total) * 100);
  // cpu/cpu_frequency — для подписи «N x X.X ГГц» в карточке нагрузки CPU,
  // как на дашборде Timeweb Cloud. ram — заказанный объём памяти (МБ, ровное
  // число вроде 4096), в отличие от факт. «видимого ОС» total из /statistics
  // (3891 МБ — часть зарезервирована под гипервизор) — для шкалы графика RAM
  // нужен именно заказанный объём, как и на дашборде Timeweb.
  const data = {
    total, used, avail, percent,
    cpuCount: body.server?.cpu ?? null,
    cpuFrequency: body.server?.cpu_frequency ?? null,
    ramMb: body.server?.ram ?? null,
  };

  diskCache = { at: Date.now(), data };
  return data;
}
