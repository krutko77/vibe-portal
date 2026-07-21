// anthropic-shim
//
// Принимает HTTP-запросы от контейнеров учеников (claude-cli/SDK), подставляет
// реальный OAuth-токен из credentials-файла и форвардит в api.anthropic.com.
// Сам токен в контейнер никогда не уходит — ученик видит только адрес шима
// и фейковый ANTHROPIC_AUTH_TOKEN.
//
// Сменить аккаунт Claude:
//   1) Положить новый credentials JSON по CREDENTIALS_PATH
//   2) systemctl restart anthropic-shim
//
// ENV:
//   CREDENTIALS_PATH  — путь к OAuth credentials (формат claude-cli .credentials.json)
//   LISTEN_HOST       — на каком интерфейсе слушать (по умолчанию 127.0.0.1)
//   LISTEN_PORT       — порт (по умолчанию 8090)
//   ALLOWED_CIDRS     — список разрешённых source CIDR через запятую (пусто = все)
//   UPSTREAM_HOST     — куда форвардить (api.anthropic.com)
//   HTTPS_PROXY       — обычный HTTPS_PROXY для outbound
//   OAUTH_CLIENT_ID   — client_id для refresh (default из claude-cli)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ProxyAgent, Agent, fetch as undiciFetch } from 'undici';
import * as transcript from './transcript.js';
import { checkLimit, recordUsage } from './token-limits.js';

const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH
  || '/data/config/auth/claude-vibe.credentials.json';
const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || '8090', 10);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'api.anthropic.com';
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.HTTPS_PROXY_URL || '';
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID
  || '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // claude-code client id
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const ALLOWED_CIDRS = (process.env.ALLOWED_CIDRS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ---------- утилиты IP / CIDR ----------

function ipToInt(ip) {
  // IPv4 only; IPv6 пока пропускаем (docker bridge всегда IPv4)
  const m = ip.replace(/^::ffff:/, '').match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | (+m[4])) >>> 0;
}

function cidrMatch(ip, cidr) {
  const [net, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr || '32', 10);
  const ipi = ipToInt(ip);
  const neti = ipToInt(net);
  if (ipi === null || neti === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipi & mask) === (neti & mask);
}

function isAllowed(ip) {
  if (!ALLOWED_CIDRS.length) return true;
  return ALLOWED_CIDRS.some(c => cidrMatch(ip, c));
}

// ---------- credentials & refresh ----------

let creds = null;
let credsMtime = 0;

function loadCredentials() {
  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
  const json = JSON.parse(raw);
  const o = json.claudeAiOauth || json;
  creds = {
    accessToken: o.accessToken,
    refreshToken: o.refreshToken,
    expiresAt: o.expiresAt, // ms
    raw: json,
  };
  credsMtime = fs.statSync(CREDENTIALS_PATH).mtimeMs;
  log(`creds loaded; expiresAt=${new Date(creds.expiresAt).toISOString()}`);
}

function saveCredentials() {
  // сохраняем обратно в тот же файл, оставляя остальные поля
  const json = creds.raw;
  const o = json.claudeAiOauth || json;
  o.accessToken = creds.accessToken;
  o.refreshToken = creds.refreshToken;
  o.expiresAt = creds.expiresAt;
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(json, null, 2));
  credsMtime = fs.statSync(CREDENTIALS_PATH).mtimeMs;
}

function maybeReloadFromDisk() {
  try {
    const m = fs.statSync(CREDENTIALS_PATH).mtimeMs;
    if (m > credsMtime) {
      log('credentials file changed on disk — reloading');
      loadCredentials();
    }
  } catch (e) {
    log('stat creds failed: ' + e.message);
  }
}

let refreshing = null;

async function refreshIfNeeded() {
  maybeReloadFromDisk();
  const skewMs = 60_000; // обновляем за 1 мин до истечения
  if (creds.expiresAt && creds.expiresAt - Date.now() > skewMs) return;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    log('refreshing OAuth token…');
    const dispatcher = HTTPS_PROXY ? new ProxyAgent(HTTPS_PROXY) : new Agent();
    const resp = await undiciFetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      dispatcher,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`refresh failed: ${resp.status} ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    creds.accessToken = data.access_token;
    if (data.refresh_token) creds.refreshToken = data.refresh_token;
    creds.expiresAt = Date.now() + (data.expires_in * 1000);
    saveCredentials();
    log(`refresh ok; new expiresAt=${new Date(creds.expiresAt).toISOString()}`);
  })().finally(() => { refreshing = null; });

  return refreshing;
}

// ---------- proxy логика ----------

const upstreamDispatcher = HTTPS_PROXY ? new ProxyAgent(HTTPS_PROXY) : new Agent();

const STRIP_REQ_HEADERS = new Set([
  'host', 'connection', 'authorization', 'x-api-key',
  'content-length', 'accept-encoding', // undici сам выставит
]);

const STRIP_RESP_HEADERS = new Set([
  'connection', 'transfer-encoding', 'content-encoding',
]);

// Запрос подлежит аудиту, если это обращение к Messages API (сам диалог).
// count_tokens и прочую служебку не пишем.
function isLoggable(req) {
  return req.method === 'POST'
    && req.url.startsWith('/v1/messages')
    && !req.url.includes('count_tokens');
}

// Лимит на буферизацию тела запроса для аудита (защита от OOM на аномалии).
const REQ_BUFFER_CAP = 64 * 1024 * 1024;

async function forward(req, res, ip) {
  const url = `https://${UPSTREAM_HOST}${req.url}`;

  // собираем заголовки
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const low = k.toLowerCase();
    if (STRIP_REQ_HEADERS.has(low)) continue;
    headers[low] = Array.isArray(v) ? v.join(',') : v;
  }
  headers['authorization'] = `Bearer ${creds.accessToken}`;
  // claude-cli OAuth требует этот beta-header; некоторые клиенты его уже шлют —
  // тогда оставляем что прислали. Если нет — выставляем дефолт.
  if (!headers['anthropic-beta']) {
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  }
  headers['host'] = UPSTREAM_HOST;

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const loggable = hasBody && isLoggable(req);

  // Для аудируемых запросов: определяем пользователя заранее и проверяем лимит.
  let shimUser = null;
  if (loggable) {
    shimUser = await transcript.resolveUser(ip);
    if (shimUser) {
      const over = checkLimit(shimUser);
      if (over) {
        const label = over.period === 'day' ? 'сегодня' : 'всего';
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: `Лимит расходов исчерпан (${label}: $${over.spent.toFixed(4)} из $${over.limitUsd})`,
          },
        }));
        log(`limit exceeded ${shimUser}: $${over.spent.toFixed(4)}/$${over.limitUsd} (${over.period})`);
        return;
      }
    }
  }

  // тело: для аудируемых запросов буферизуем целиком (нужно распарсить + всё
  // равно это завершённый JSON), иначе стримим как раньше. undici принимает и
  // Buffer, и async-generator.
  let body;
  let reqBuf = null;
  if (hasBody && loggable) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= REQ_BUFFER_CAP) chunks.push(chunk);
    }
    reqBuf = size <= REQ_BUFFER_CAP ? Buffer.concat(chunks) : null;
    body = reqBuf || Buffer.alloc(0);
  } else if (hasBody) {
    body = (async function*() {
      for await (const chunk of req) yield chunk;
    })();
  }

  let upstream;
  try {
    upstream = await undiciFetch(url, {
      method: req.method,
      headers,
      body,
      duplex: 'half',
      dispatcher: upstreamDispatcher,
    });
  } catch (e) {
    log(`upstream error: ${e.message}`);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'shim_upstream_error', message: e.message }));
    return;
  }

  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RESP_HEADERS.has(k.toLowerCase())) outHeaders[k] = v;
  });
  res.writeHead(upstream.status, outHeaders);

  // Аудит: накапливаем ответ по мере проксирования (без задержки клиенту).
  const acc = loggable ? new transcript.ResponseAccumulator() : null;

  if (upstream.body) {
    for await (const chunk of upstream.body) {
      if (acc) { try { acc.push(chunk); } catch {} }
      if (!res.write(chunk)) {
        await new Promise(r => res.once('drain', r));
      }
    }
  }
  res.end();

  // Запись транскрипта и учёт расходов — после ответа, чтобы не влиять на латентность.
  if (loggable) {
    try {
      const user = shimUser || await transcript.resolveUser(ip);
      const reqInfo = reqBuf
        ? transcript.parseRequest(reqBuf)
        : { model: null, numMessages: 0, userText: '(request too large to log)', isToolContinuation: false };
      const out = acc.finalize();
      const effectiveModel = out.model || reqInfo.model;
      if (user) recordUsage(user, effectiveModel, out.usage.input, out.usage.output);
      transcript.write({
        ts: new Date().toISOString(),
        user: user || `unknown-${(ip || 'noip').replace(/[^a-zA-Z0-9]/g, '-')}`,
        ip,
        status: upstream.status,
        model: effectiveModel,
        numMessages: reqInfo.numMessages,
        userText: reqInfo.userText,
        isToolContinuation: reqInfo.isToolContinuation,
        assistantText: out.text,
        toolCalls: out.tools,
        stopReason: out.stopReason,
        usage: out.usage,
      });
    } catch (e) {
      log(`transcript record failed: ${e.message}`);
    }
  }
}

// ---------- сервер ----------

function log(msg) {
  console.log(`[shim ${new Date().toISOString()}] ${msg}`);
}

function clientIp(req) {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

async function handle(req, res) {
  const ip = clientIp(req);

  // health
  if (req.url === '/_shim/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      expiresAt: creds?.expiresAt || null,
      now: Date.now(),
      validForMs: creds ? (creds.expiresAt - Date.now()) : null,
    }));
    return;
  }

  if (!isAllowed(ip)) {
    log(`denied ${ip} ${req.method} ${req.url}`);
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'shim_forbidden_source', ip }));
    return;
  }

  try {
    await refreshIfNeeded();
  } catch (e) {
    log(`refresh failed: ${e.message}`);
    // RT мог быть уже ротирован хостовым claude (общий файл) — перечитаем
    // с диска принудительно: там может лежать свежий токен.
    try {
      loadCredentials();
    } catch (e2) {
      log(`reload after refresh failure failed: ${e2.message}`);
    }
    // продолжим с тем, что есть — токен на диске может быть ещё валиден
  }

  const t0 = Date.now();
  await forward(req, res, ip);
  log(`${ip} ${req.method} ${req.url} → ${res.statusCode} ${Date.now() - t0}ms`);
}

loadCredentials();

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    log(`unhandled: ${err.stack || err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
    }
    try { res.end(JSON.stringify({ error: 'shim_internal', message: err.message })); }
    catch {}
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  log(`upstream: https://${UPSTREAM_HOST}`);
  log(`proxy: ${HTTPS_PROXY || '(direct)'}`);
  log(`allowed cidrs: ${ALLOWED_CIDRS.join(', ') || '(any)'}`);
});

// прогрев — попробуем обновить заранее
refreshIfNeeded().catch(e => log(`startup refresh: ${e.message}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`got ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
