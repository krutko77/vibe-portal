# Vibe Portal — портал курса (vibe.kiselevgroup.com)

Изолированный sub-портал для платного курса «Vibecoding» от Киселёв Груп.
Каждый ученик работает в своём docker-контейнере, видит только свой workspace,
не имеет доступа к dev-проектам сотрудников или к хостовой ФС.

- URL: https://vibe.kiselevgroup.com
- Сервер: 80.87.104.193 (тот же что dev-portal)
- Аудитория: 5-10 платных учеников курса
- Соседний проект: `/opt/dev-portal/` — портал для сотрудников КГ
  (см. его `CLAUDE.md`). Vibe **не зависит** от dev: своя auth, свои
  сервисы, свои шаблоны.

## Главные правила

1. **После любых изменений в `/opt/vibe-portal/`** — `git add . && git commit
   -m "..."`. Push не нужен — `/opt/dev-portal/scripts/backup-all.sh`
   снапшотит vibe-portal в общий gitflic каждые 4 часа.
2. **Секреты никогда в git.** `.env*` исключены rsync'ом, но если что —
   проверь руками. OAuth-токен Claude для шима лежит в
   `/root/.claude/.credentials.json` (chmod 600, общий с хостовым claude), не здесь.
3. **Изменение auth/контейнерной изоляции — критично.** Прежде чем трогать
   `scripts/setup-iptables.sh`, `panel/lib/students.js` или `shim/server.js` —
   убедись, что понимаешь модель угроз: ученик не должен видеть чужие файлы
   или дотягиваться до серверных сервисов.

## Архитектура

```
vibe.kiselevgroup.com → nginx :80/:443 → vibe-panel :3020
                                          ├── /              SPA (login → app)
                                          ├── /api/*         JSON API
                                          └── /code/<user>/* прокси → 127.0.0.1:820X
                                                                       (контейнер vibe-<user>)
Контейнер vibe-<user>:
  image:   vibe-workspace:dev (Debian 12 + Node 22 + code-server + claude-cli)
  user:    student (uid 1000), no sudo, --cap-drop=ALL, --no-new-privileges
  limits:  mem 1.5G, cpu 1.0
  network: vibe-net (br-vibe, 172.30.0.0/24)
  mounts:
    /data/vibe-students/<user>   → /home/student/workspace   rw
    /opt/vibe-portal/templates   → /home/student/templates   ro   (только курсовые app-*)
  env:
    ANTHROPIC_BASE_URL=http://172.30.0.1:8190        ← шим
    ANTHROPIC_AUTH_TOKEN=sk-vibe-shim-placeholder    ← фейк, реальный токен у шима
```

## Изоляция (iptables — chain VIBE-FILTER в FORWARD, VIBE-INPUT в INPUT)

Контейнеры `vibe-net` могут:
- ходить наружу в интернет (DNS, npm, github, docker hub)
- бить в `172.30.0.1:8190` (anthropic-shim)

И НЕ могут:
- видеть другие контейнеры vibe-net (изоляция между учениками)
- достучаться до 127.0.0.1 хоста, других docker bridges, RFC1918
- хитнуть `80.87.104.193` (публичный IP хоста) → блок NAT-loopback на nginx/sshd
- найти shim через любой IP кроме 172.30.0.1 gateway

Правила в `scripts/setup-iptables.sh`, применяются systemd-юнитом
`vibe-iptables.service` при загрузке.

## Anthropic-shim (`shim/server.js`)

Reverse-proxy на хосте `:8190`, который:
1. Принимает HTTP-запросы из контейнеров (whitelisted 172.30.0.0/24 + 127/8).
2. Стрипает `Authorization`, ставит реальный `Bearer <accessToken>` из
   `CREDENTIALS_PATH=/root/.claude/.credentials.json` — **тот же файл, что
   использует хостовый `claude`** (единый источник истины, см. ниже).
3. Добавляет `anthropic-beta: oauth-2025-04-20` если клиент не прислал.
4. Форвардит в `api.anthropic.com` через `HTTPS_PROXY` (внешний HTTP-прокси
   `151.243.152.6:9894`, креды в `/data/config/env/proxy.env`).
5. Авто-рефрешит OAuth-токен через `POST https://platform.claude.com/v1/oauth/token`
   за минуту до истечения. Сохраняет обновлённые токены обратно в файл.
   Перечитывает файл с диска по `mtime` перед каждым refresh и при ошибке
   refresh (если хостовый claude уже ротировал общий RT — подхватит свежий).
6. Логирует source IP, метод, URL, статус, ms в journald.
7. **Аудит диалогов** (`shim/transcript.js`). На каждый `POST /v1/messages`
   пишет JSONL-запись в `/data/config/transcripts/<user>/<YYYY-MM-DD>.jsonl`:
   промпт ученика, ответ Claude, модель, tool-calls, usage, stop_reason.
   Ученика определяет по source-IP контейнера → docker-лейбл `kg.vibe.student`
   (IP подменить нельзя: `CAP_DROP=ALL`). Тело запроса буферизуется, ответ
   tee'ится без влияния на латентность, запись после `res.end()`. undici отдаёт
   чанки `Uint8Array` — декодим потоковым `TextDecoder`. Просмотр — только admin
   (см. `/api/transcripts/*` и страницу `/logs.html`).

Health: `curl http://127.0.0.1:8190/_shim/health`.

**Единый OAuth-файл (важно).** Раньше шим читал отдельную копию
`/data/config/auth/claude-vibe.credentials.json`, которую таймер
`sync-claude-creds` копировал из хостовой. Но OAuth refresh-токен
**одноразовый**: когда хостовый `claude` (или `keepalive-claude`) обновлялся,
RT в копии шима «осиротевал» → `invalid_grant`, и до следующего sync (раз в
5 мин) ученики ловили экран логина. Поэтому шим переведён на **общий файл**
`/root/.claude/.credentials.json`: одна RT-цепочка, разъезда копий нет.
Таймер `sync-claude-creds` отключён (`systemctl disable --now`).

**Смена аккаунта Claude (vibe → новый):**
```bash
cp /tmp/new-credentials.json /root/.claude/.credentials.json
chmod 600 /root/.claude/.credentials.json
systemctl restart anthropic-shim
# Контейнеры учеников НЕ рестартуют — следующий запрос пойдёт с новым токеном.
# Внимание: это тот же файл, что у хостового claude — меняешь сразу обоим.
```

## vibe-panel (`panel/`, Express :3020)

Своя auth (отдельно от dev-портала): `.htpasswd-vibe`, `users-vibe.json`,
`sessions-vibe/`. SPA на vanilla JS, тёмная тема IBM Plex Mono, UI 1:1
с dev-порталом (общие визуальные правила).

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/api/login` | — | htpasswd-vibe + users-vibe.json → сессия |
| POST | `/api/logout` | — | |
| GET | `/api/me` | — | username, isAdmin, статус контейнера |
| GET | `/api/templates` | user | Список из `/opt/vibe-portal/templates/` |
| GET | `/api/projects` | user | Папки в его workspace |
| POST | `/api/projects/from-template` | user | `cp -a` шаблон + `chown 1000:1000` + замена `{{PROJECT_NAME}}` |
| POST | `/api/container/{start,stop}` | user | docker start/stop своего контейнера |
| POST | `/api/touch` | user | heartbeat (idle reaper останавливает через 30 мин) |
| GET | `/api/projects/:name/download` | user | zip своего проекта (через системный `zip`, стрим) |
| GET | `/api/template-download/:name` | user | zip базового шаблона (whitelist: `_base`, `_b24-single-php`) |
| GET | `/api/template-claude/b24` | user | `CLAUDE.md` из `_b24-single-php` отдельным файлом |
| GET / POST / DELETE | `/api/students[/:u]` | admin | CRUD учеников: htpasswd + workspace + docker create |
| GET | `/api/transcripts` | admin | список учеников с датами (аудит диалогов) |
| GET | `/api/transcripts/_feed` | admin | вся лента диалогов (опц. `?user=`), для `/logs.html` |
| GET | `/api/transcripts/:u` | admin | записи ученика за дату (`?date=`) |
| ANY | `/code/<user>/*` | session+match | Прокси на 127.0.0.1:<containerPort>, авто-старт |

Страница `/logs.html` (admin-only через API-гейт) — вся хронология диалогов
учеников с фильтром-чипами по ученику, как на dev-портале. Источник данных —
транскрипты, которые пишет шим (см. Anthropic-shim § 7).

**Материалы/шаблоны (UI).** Секция-грид «Шаблоны» (showcase app-*) в проектах
временно скрыта (`hidden`), но кнопка «+ Из шаблона» (создание из базовых
`_base`/`_b24-single-php` через `modal-create`) работает. Во вкладке Материалы
есть страница «Шаблоны» с кнопками скачивания (`_base`, `_b24-single-php`,
отдельно `CLAUDE.md` из b24). Вкладка «Работа с Клодом» убрана.

Idle reaper: каждые 5 минут проверяет `lastActivityAt` каждого ученика, если
больше 30 минут (`IDLE_STOP_MIN`) — `docker stop`.

Порты контейнеров: 8200-8299, выдаются `allocatePort()`, хранятся в
`users-vibe.json`. nginx → vibe-panel → `127.0.0.1:820X`, без выставки портов
наружу.

## Бутстрап первого admin'а

```bash
/opt/vibe-portal/scripts/create-admin.sh <login> <password>
# Это делает: htpasswd-vibe, users-vibe.json (role=admin), workspace папка,
# docker create vibe-<login> (создан, не запущен).
```

После — залогиниться в UI: https://vibe.kiselevgroup.com и добавлять учеников.

## Системные сервисы

| Сервис | Назначение |
|--------|-----------|
| `anthropic-shim.service` | Reverse-proxy с OAuth swap (:8190), WD `/opt/vibe-portal/shim` |
| `vibe-panel.service` | Express :3020, WD `/opt/vibe-portal/panel`, EnvFile=`/data/config/env/vibe-panel.env` |
| `vibe-iptables.service` | oneshot, применяет VIBE-FILTER/VIBE-INPUT при boot |

Юниты живут в `systemd/` репозитория. При изменении — копировать в
`/etc/systemd/system/`, `daemon-reload`, рестарт сервиса.

## Структура файлов

```
/opt/vibe-portal/
├── CLAUDE.md                          этот файл
├── .claude/settings.json              permissions для Claude
├── workspace-image/Dockerfile         vibe-workspace:dev
├── shim/
│   ├── server.js                      OAuth swap proxy
│   └── transcript.js                  аудит диалогов (IP→ученик, SSE-парсер, JSONL)
├── panel/
│   ├── server.js                      Express :3020
│   ├── lib/{auth,students,templates,transcripts}.js
│   └── public/{index.html,history.html,logs.html,css/,js/}
├── scripts/
│   ├── setup-iptables.sh              VIBE-FILTER/VIBE-INPUT chains
│   └── create-admin.sh                бутстрап первого admin'а
├── systemd/{anthropic-shim,vibe-panel,vibe-iptables}.service
├── nginx/vibe.kiselevgroup.com
└── templates/                         курсовые app-* (из showcase demo-app)
    ├── app-ai-helper/
    ├── app-chief24/
    ├── app-contacts24/
    ├── app-dina-soglasovanie/
    ├── app-fieldsmap24/
    ├── app-parser1c/
    ├── app-pult24/
    ├── app-quality24/
    ├── app-support24/
    └── app-timepay24/

Внешние зависимости (вне репо):
/data/
├── vibe-students/<user>/              workspace ученика (uid 1000)
└── config/
    ├── auth/{.htpasswd-vibe,users-vibe.json}
    │     (claude-vibe.credentials.json — legacy, шим читает /root/.claude/.credentials.json)
    ├── env/vibe-panel.env             SESSION_SECRET
    ├── sessions-vibe/                 session-file-store
    └── transcripts/<user>/<date>.jsonl  аудит диалогов (пишет шим, читает панель)
```

## Откуда обновляются шаблоны

Скрипт `/opt/dev-portal/scripts/make-showcase-templates.py` берёт демо-приложения
из dev-portal'овского showcase'а (`/opt/dev-portal/showcase/catalog/<slug>/demo-app/`),
чистит трекеры (Yandex.Metrika, Top.Mail.Ru), парсит frontmatter `app.md`
(tagline / features / hours), генерит `CLAUDE.md` + `README.md`,
кладёт в `/opt/vibe-portal/templates/app-<slug>/`.

```bash
# Перегенерить все 10 шаблонов:
python3 /opt/dev-portal/scripts/make-showcase-templates.py --all --clean

# Один конкретный:
python3 /opt/dev-portal/scripts/make-showcase-templates.py chief24
```

WHITELIST в скрипте: ai-helper, chief24, contacts24, dina-soglasovanie,
fieldsmap24, parser1c, pult24, quality24, support24, timepay24.

## Порты

| Порт | Сервис |
|------|--------|
| 3020 (127.0.0.1) | vibe-panel |
| 8190 (0.0.0.0) | anthropic-shim (фильтр через iptables на 172.30.0.0/24 + 127/8) |
| 8200-8299 (127.0.0.1) | code-server'ы контейнеров учеников |

## Бэкап

Покрывается общим `/opt/dev-portal/scripts/backup-all.sh` — rsync
`/opt/vibe-portal/ → /srv/server-backup/vibe-portal/`, потом git
push в `git@gitflic.ru:kiselevke/dev-portal.git` (тот же репозиторий, что
для dev-портала; vibe лежит в подпапке `vibe-portal/`). Снапшот каждые
4 часа + при завершении Claude-сессии.

Исключения те же что у dev: `node_modules`, `.git`, `.env*`, `*.log`,
`*.sqlite*`, `*.db`, `__pycache__`, `.DS_Store`, `.playwright-mcp`,
`.claude/settings.local.json`, `.portal-meta.json`.

## Известные ограничения / TODO

- Rate-limit по токенам на ученика — нет (мониторим через journald shim).
- `/compact`-аналог для claude-cli внутри контейнера — нет.
- Шаги «зайти под учеником и удалить чужие файлы» исключены: workspace bind-mount
  только своего юзера, шаблоны read-only, ICC отключён через iptables.

## Важные команды

```bash
# Статус всех vibe-сервисов
systemctl status anthropic-shim vibe-panel vibe-iptables

# Логи
journalctl -u vibe-panel -f
journalctl -u anthropic-shim -f
journalctl -u vibe-iptables --no-pager

# Health шима
curl http://127.0.0.1:8190/_shim/health

# Список контейнеров учеников
docker ps -a --filter "label=kg.vibe.role=workspace"

# Применить iptables (ручной запуск)
/opt/vibe-portal/scripts/setup-iptables.sh

# Перечитать nginx после правки vibe.kiselevgroup.com
nginx -t && nginx -s reload

# Сбросить контейнер ученика (он пересоздастся при следующем входе)
docker rm -f vibe-<username>
```

## История

- **2026-05-26** — vibe вынесен в отдельный проект `/opt/vibe-portal/`,
  раньше жил в `/opt/dev-portal/vibe/`. Шаблоны переехали из
  `/opt/dev-portal/templates/vibe/` в `/opt/vibe-portal/templates/`.
  Сервисы (`anthropic-shim`, `vibe-panel`, `vibe-iptables`) обновили
  `WorkingDirectory` и `ExecStart`, `TEMPLATES_DIR` тоже.
- **2026-05-26** — стартовал портал, E2E проверен:
  admin создаёт ученика → ученик из VS Code зовёт claude → шим подменяет
  токен → ответ приходит. Изоляция iptables проверена.
