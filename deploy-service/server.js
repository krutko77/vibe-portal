// vibe-deploy-service
//
// Проблема: агенты (claude-cli) внутри контейнеров vibe-net хотят деплоить
// проекты из /home/my_workspace на этот же хост (nginx+certbot+pm2, реальные
// поддомены *.es-trans.ru), но контейнеры намеренно изолированы от хоста
// (см. CLAUDE.md → «Изоляция»): не видят 127.0.0.1, RFC1918, публичный IP.
// Давать им root/sudo на хосте нельзя — это тот же хост, что держит весь
// vibe-portal/dev-portal и чужие клиентские сайты (см. docs/decisions.md D-004).
//
// Решение — по образцу anthropic-shim: узкий сервис, слушает ТОЛЬКО
// 172.30.0.1:8191 (gateway vibe-net, тот же адрес, что и шим), доступен
// исключительно из vibe-net (iptables ACCEPT только на этот порт, см.
// scripts/setup-iptables.sh). Владельца определяем по source-IP контейнера
// (см. ipmap.js) — агент физически не может задеплоить чужой проект, даже
// если попытается подставить чужое имя папки.
//
// Контракт для агента:
//   1) положить .vibe-deploy.json в корень проекта:
//        { "domain": "myapp.es-trans.ru", "entry": "src/server.js" }
//      (entry по умолчанию "src/server.js"; install_cmd по умолчанию
//      "npm install --omit=dev", разрешены только npm/yarn/pnpm install|ci)
//   2) POST http://172.30.0.1:8191/deploy  { "project": "<имя папки>" }
//
// Первый деплой нового домена сам заводит nginx-vhost + Let's Encrypt +
// pm2-процесс. Повторные — rsync кода + restart. Существующие (до этого
// сервиса) продакшн-деплои зарегистрированы вручную в registry.json —
// для них nginx/certbot не трогаются, только rsync+restart.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveUser } from './ipmap.js';

const execFileP = promisify(execFile);

const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || '8191', 10);
const ALLOWED_CIDRS = (process.env.ALLOWED_CIDRS || '172.30.0.0/24,127.0.0.0/8')
  .split(',').map(s => s.trim()).filter(Boolean);

const STUDENTS_ROOT = process.env.STUDENTS_ROOT || '/data/vibe-students';
const DEPLOY_BASE = process.env.DEPLOY_BASE || '/opt/vibe-deploys';
const REGISTRY_PATH = process.env.REGISTRY_PATH || '/etc/vibe-deploy/registry.json';
const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX || '.es-trans.ru';
const PORT_MIN = parseInt(process.env.DEPLOY_PORT_MIN || '3100', 10);
const PORT_MAX = parseInt(process.env.DEPLOY_PORT_MAX || '3199', 10);
const CERTBOT_EMAIL = process.env.CERTBOT_EMAIL || 'admin@kiselevgroup.com';

const RESERVED_SLUGS = new Set([
  'vibe-panel', 'anthropic-shim', 'vibe-deploy-service', 'vibe-admin-code',
  'www', 'api', 'admin', 'nginx', 'root',
]);

function log(msg) {
  console.log(`[deploy] ${new Date().toISOString()} ${msg}`);
}

// ---------- IP allowlist (то же, что у шима: iptables — первая линия,
// это — вторая, на случай сервиса, поднятого не так) ----------

function ipToInt(ip) {
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

// ---------- registry: /etc/vibe-deploy/registry.json ----------
// Ключ — "<owner>::<project-folder>", не slug, чтобы легаси-проекты можно
// было вручную примаппить на уже существующие домен/порт/каталог, даже если
// имя папки в /home/my_workspace не совпадает с именем pm2-процесса.

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
}
function allocatePort(reg) {
  const used = new Set(Object.values(reg).map(e => e.port));
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error('no free port in range');
}

// ---------- валидация входа (всё это — данные от ученика/агента) ----------

function validateProjectArg(project) {
  if (typeof project !== 'string' || project === '' ||
      !/^[A-Za-z0-9._-]+$/.test(project) || project === '.' || project === '..') {
    throw new Error('invalid project name');
  }
}

const DOMAIN_RE = new RegExp(`^[a-z0-9-]+${DOMAIN_SUFFIX.replace(/\./g, '\\.')}$`);
const INSTALL_CMD_RE = /^(npm|yarn|pnpm) (install|ci)( --[a-zA-Z0-9=_-]+)*$/;

function validateConfig(conf) {
  const domain = conf.domain;
  if (typeof domain !== 'string' || !DOMAIN_RE.test(domain)) {
    throw new Error(`domain must match *${DOMAIN_SUFFIX}`);
  }
  const entry = typeof conf.entry === 'string' ? conf.entry : 'src/server.js';
  if (entry.startsWith('/') || entry.split('/').includes('..')) {
    throw new Error('invalid entry path');
  }
  const installCmd = typeof conf.install_cmd === 'string' ? conf.install_cmd : 'npm install --omit=dev';
  if (!INSTALL_CMD_RE.test(installCmd)) {
    throw new Error('install_cmd must be a plain npm/yarn/pnpm install|ci command');
  }
  return { domain, entry, installCmd };
}

function slugify(owner, project) {
  const base = `${owner}-${project}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'app';
}

async function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const { stdout, stderr } = await execFileP(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts });
  if (stdout?.trim()) log(stdout.trim());
  if (stderr?.trim()) log(stderr.trim());
  return stdout;
}

async function provisionNginxAndCert(domain, port) {
  const sitePath = `/etc/nginx/sites-available/${domain}`;
  if (fs.existsSync(sitePath)) return; // легаси-сайт уже есть — не трогаем
  const conf = `server {
    server_name ${domain};
    listen 80;
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;
  fs.writeFileSync(sitePath, conf);
  fs.symlinkSync(sitePath, `/etc/nginx/sites-enabled/${domain}`);
  await run('nginx', ['-t']);
  await run('systemctl', ['reload', 'nginx']);
  try {
    await run('certbot', ['--nginx', '-d', domain, '--non-interactive', '--agree-tos',
      '-m', CERTBOT_EMAIL, '--redirect']);
  } catch (e) {
    log(`certbot failed for ${domain}: ${e.message} — проверь DNS, сайт пока работает по HTTP`);
  }
}

async function deployPm2(e) {
  try {
    await run('pm2', ['describe', e.slug]);
    await run('pm2', ['restart', e.slug, '--update-env']);
  } catch {
    await run('pm2', ['start', e.entry, '--name', e.slug, '--cwd', e.deploy_dir], {
      env: { ...process.env, PORT: String(e.port) },
    });
    await run('pm2', ['save']);
  }
}

async function handleDeploy(owner, project) {
  validateProjectArg(project);

  const ownerBase = fs.realpathSync(path.join(STUDENTS_ROOT, owner));
  const src = path.join(STUDENTS_ROOT, owner, project);
  let realSrc;
  try {
    realSrc = fs.realpathSync(src);
  } catch {
    throw new Error(`no such project: ${project}`);
  }
  if (!(realSrc + path.sep).startsWith(ownerBase + path.sep)) {
    throw new Error('path escape detected');
  }
  if (!fs.statSync(realSrc).isDirectory()) {
    throw new Error('not a directory');
  }

  const confPath = path.join(realSrc, '.vibe-deploy.json');
  if (!fs.existsSync(confPath)) {
    throw new Error('missing .vibe-deploy.json in project root — см. CLAUDE.md § deploy-service');
  }
  const rawConf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  const { domain, entry, installCmd } = validateConfig(rawConf);

  const regKey = `${owner}::${project}`;
  const reg = loadRegistry();
  let e = reg[regKey];

  if (e && e.domain !== domain) {
    throw new Error(`${regKey} уже зарегистрирован на ${e.domain}, не на ${domain} — смена домена только через admin`);
  }
  for (const [k, v] of Object.entries(reg)) {
    if (k !== regKey && v.domain === domain) {
      throw new Error(`domain ${domain} уже занят проектом ${k} — обратись к admin`);
    }
  }

  let firstRun = false;
  if (!e) {
    firstRun = true;
    const slug = slugify(owner, project);
    if (RESERVED_SLUGS.has(slug)) throw new Error('reserved project name');
    const port = allocatePort(reg);
    e = {
      slug, domain, port,
      deploy_dir: path.join(DEPLOY_BASE, slug),
      entry, install_cmd: installCmd,
      type: 'node',
    };
    reg[regKey] = e;
    saveRegistry(reg);
  }

  // type:'php' — легаси-сайты вроде a1track (php-fpm, статика на диске, без
  // pm2/порта). Исходник может лежать в подпапке проекта (src_subdir, напр.
  // "www"), а не в корне — .vibe-deploy.json при этом всё равно в корне
  // проекта, чтобы владелец мог его найти. Свои файлы с прод-состоянием
  // (секреты/рантайм-данные типа env.php, data/) исключаются полем `exclude`
  // в registry — деплой их никогда не трогает.
  const srcDir = path.join(realSrc, e.src_subdir || '.');
  if (!fs.existsSync(srcDir)) {
    throw new Error(`src_subdir not found: ${e.src_subdir}`);
  }

  fs.mkdirSync(e.deploy_dir, { recursive: true });
  // .env — часть конфигурации node-проекта (dotenv/config грузит его из cwd
  // при старте), поэтому для type:"node" он синхронизируется как обычный
  // файл проекта: воркспейс — единственный источник правды. Для type:"php"
  // (легаси-сайты вроде a1track) .env по-прежнему не трогаем — там прод-
  // секреты живут отдельно на сервере (env.php защищается через свой
  // `exclude` в registry), а не в workspace.
  const excludes = e.type === 'php'
    ? ['node_modules', '.git', '.env', ...(e.exclude || [])]
    : ['node_modules', '.git', ...(e.exclude || [])];
  await run('rsync', [
    '-a', '--delete',
    ...excludes.flatMap(x => ['--exclude', x]),
    `${srcDir}/`, `${e.deploy_dir}/`,
  ]);

  if (e.type === 'php') {
    if (firstRun) {
      throw new Error('первый деплой нового php-проекта через deploy-service не поддержан — зарегистрируй вручную в registry.json (nginx/php-fpm заводится руками)');
    }
    await run('chown', ['-R', 'www-data:www-data', e.deploy_dir]);
  } else {
    if (firstRun) {
      await provisionNginxAndCert(e.domain, e.port);
    }
    const [cmd, ...cmdArgs] = e.install_cmd.split(/\s+/);
    await run(cmd, cmdArgs, { cwd: e.deploy_dir });
    await deployPm2(e);
  }

  return { domain: e.domain, url: `https://${e.domain}/`, slug: e.slug, port: e.port ?? null, firstRun };
}

const server = http.createServer((req, res) => {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!isAllowed(ip)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/deploy') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const owner = await resolveUser(ip);
        if (!owner) {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unknown container (not a registered vibe-net workspace)' }));
          return;
        }
        let project;
        try {
          ({ project } = JSON.parse(body || '{}'));
        } catch {
          throw new Error('invalid JSON body');
        }
        const result = await handleDeploy(owner, project);
        log(`${owner}/${project} -> ${result.url} (pm2:${result.slug} port:${result.port}${result.firstRun ? ' NEW' : ''})`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        log(`error from ${ip}: ${err.message}`);
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  log(`allowed cidrs: ${ALLOWED_CIDRS.join(', ')}`);
  log(`registry: ${REGISTRY_PATH}`);
});
