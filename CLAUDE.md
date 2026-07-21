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
                                          └── /<user>/<project>/* публикация (см. ниже)
Контейнер vibe-<user>:
  image:   vibe-workspace:dev (Debian 12 + Node 22 + code-server + claude-cli + openssh-server + procps)
  user:    student (uid 1000), no sudo, --cap-drop=ALL, --no-new-privileges, --init (tini)
  cmd:     vibe-entrypoint.sh — поднимает sshd (десктопный VS Code) + exec code-server
  limits:  mem 3G, cpu 1.5
  network: vibe-net (br-vibe, 172.30.0.0/24)
  mounts:
    /data/vibe-students/<user>   → HOME ученика   rw   (см. HOME по роли ниже)
    /opt/vibe-portal/templates   → /home/student/templates   ro   (только курсовые app-*)
    /data/config/ssh/<user>/host → /home/student/.sshd        rw   (host-key + authorized_keys)
    /data/config/vscode-server/<user> → /home/student/.vscode-server rw (персист VS Code server)
  env:
    ANTHROPIC_BASE_URL=http://172.30.0.1:8190        ← шим
    ANTHROPIC_AUTH_TOKEN=sk-vibe-shim-placeholder    ← фейк, реальный токен у шима
  ports наружу: 127.0.0.1:820X→8080 (code-server), 0.0.0.0:84XX→2222 (sshd, десктопный VS Code)
```

**HOME по роли (`panel/lib/home-dir.js` → `homeDirFor(role)`).** Один и тот же
образ `vibe-workspace:dev` обслуживает и admin'а, и учеников — их рабочий путь
внутри контейнера **разный**: `role==='admin'` → `/home/my_workspace`, иначе
(ученик) → `/home/student/workspace`. Это единственный источник истины,
подключается везде, где путь раньше был захардкожен: `students.js` (`dockerCreate`
— `WorkingDir`, основной Bind, `Env: HOME=...`; `homeDirForUser()` — lookup по
логину для мест без `role` под рукой), `code-slots.js` (`launchInstance`),
`ssh-access.js` (`sshConfig` → `workspaceUri`/`projectUriBase`), `publish.js`
(`deployApp`/`stopApp` → `cdir`), фронтенд `app.js` (через новое поле `homeDir`
в `/api/me`). **Почему нельзя обойтись одним `useradd -d`:** это атрибут
`/etc/passwd`, общий для ВСЕХ контейнеров одного образа — не даёт развести роли.
Вместо этого HOME передаётся явно через `Env: [\`HOME=${home}\`]` в
`docker create`: `docker exec` **наследует** `Config.Env` контейнера (это
задокументированное поведение Docker), поэтому и CMD-процесс
(`vibe-entrypoint.sh`, использует `$HOME` вместо хардкода), и любой
`docker exec` (панельные lifecycle-хуки) видят правильный путь без доп. флагов.
`useradd -d /home/student/workspace` в Dockerfile — только пассивный
дефолт/фолбэк на случай контейнера без явного `HOME` (не используется в
нормальном потоке, т.к. `dockerCreate` всегда его проставляет).

**Дефолтная модель claude-cli внутри контейнера = `sonnet`.** claude-code 2.1.x
по умолчанию берёт **opus** (×5 дороже sonnet) — а claude в VS Code
(терминал code-server / расширение / десктоп по SSH) запускается **без**
`--model`, в отличие от панельных чатов (project-chat/user-chat прибивают
`--model sonnet` сами). Поэтому пиннимся через user-level
`~/.claude/settings.json` → `{"model":"sonnet"}`: claude читает его при любом
запуске независимо от cwd и способа входа. Это **дефолт, а не замок** — ученик
при желании переключается через `/model`. Единственный источник —
`panel/lib/students.js → ensureClaudeModelDefault()` (рантайм-хук в `dockerStart`:
прописывает при каждом холодном старте; идемпотентно, merge — тему не трогает).
Раньше дублировалось бейком в `workspace-image/Dockerfile`, но с переездом HOME
на `/home/my_workspace` (bind-mount) этот бейк стал невидим контейнеру — убран,
рантайм-хук остался единственным источником. Значение
переопределяется env `STUDENT_DEFAULT_MODEL`. Существующим контейнерам применять
`docker exec -u student vibe-<u> node -e '…settings.json…'` (или они подхватят сами
при следующем старте). Проверка: модель видна в транскрипте шима
(`/api/transcripts`) — должна быть `claude-sonnet-4-6`, а не `claude-opus-4-8`.

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
| GET | `/api/leaderboard` | user | Рейтинг учеников: только агрегаты-числа (без текста сообщений и названий проектов), для `/dashboard.html` |
| GET | `/api/templates` | user | Список из `/opt/vibe-portal/templates/` |
| GET | `/api/projects` | user | Папки в его workspace |
| POST | `/api/projects/from-template` | user | `cp -a` шаблон + `chown 1000:1000` + замена `{{PROJECT_NAME}}` |
| POST | `/api/container/{start,stop}` | user | docker start/stop своего контейнера |
| POST | `/api/touch` | user | heartbeat (idle reaper останавливает через 30 мин) |
| GET | `/api/projects/:name/download` | user | zip своего проекта (через системный `zip`, стрим) |
| GET | `/api/projects/:name/publish` | user | статус публикации проекта |
| POST | `/api/projects/:name/publish` | user | вкл/выкл публикацию (visibility, autosleep) |
| POST | `/api/projects/:name/redeploy` | user | перезапуск приложения |
| ANY | `/<user>/<project>/*` | session (visibility) | прокси в приложение ученика (self-heal) |
| ANY | `/admin-code/*` | admin | прокси в code-server проекта (127.0.0.1:8300), HTTP+WS гейт по isAdmin |
| GET | `/api/template-download/:name` | user | zip базового шаблона (whitelist: `_base`, `_b24-single-php`) |
| GET | `/api/template-claude/:which` | user | `CLAUDE.md` из шаблона отдельным файлом (`base`→`_base`, `b24`→`_b24-single-php`) |
| GET | `/api/ssh-config` | user | данные подключения по SSH (десктопный VS Code): `~/.ssh/config` сниппет, deep-links; лениво провижит ключи/порт |
| GET | `/api/ssh-key` | user | скачать личный приватный ключ (файл для `~/.ssh/`) |
| POST | `/api/ssh-key/regenerate` | user | перевыпуск ключа (старый перестаёт пускать; host-key не меняется) |
| GET / POST / DELETE | `/api/students[/:u]` | admin | CRUD учеников: htpasswd + workspace + docker create |
| GET | `/api/transcripts` | admin | список учеников с датами (аудит диалогов) |
| GET | `/api/transcripts/_feed` | admin | вся лента диалогов (опц. `?user=`), для `/logs.html` |
| GET | `/api/transcripts/:u` | admin | записи ученика за дату (`?date=`) |
| ANY | `/code/<user>/*` | session+match | Прокси в `code-server` слота сессии (vibe-net), авто-старт |

Страница `/logs.html` (admin-only через API-гейт) — вся хронология диалогов
учеников с фильтром-чипами по ученику, как на dev-портале. Источников записей
два, пишут в один стор `TRANSCRIPTS_DIR/<user>/<date>.jsonl`:
- **шим** — `claude-cli` в контейнере (VS Code), см. Anthropic-shim § 7;
- **панельные чаты** — project-chat и user-chat спавнят `claude` на хосте мимо
  шима, поэтому пишут сами через `transcripts.write()` (поле `source`:
  `project-chat`/`user-chat`; без поля = VS Code). В логах источник виден бейджем.
Бэкфилла нет — пишется с момента внедрения, вперёд.

**Автокомпакт project-chat (`lib/project-chat.js`).** `--resume` тащит всю
историю; за 200K модель просит 1M-контекст, которого на OAuth-подписке нет →
API 429 «Usage credits required for 1M context». В headless-режиме автокомпакт
реактивный и не спасает уже-распухшую сессию. Поэтому: размер контекста после
каждого хода пишется в `<sid>.meta.json` (`contextTokens`, оценка по последней
итерации `usage`); перед след. сообщением если `≥ CHAT_COMPACT_AT_TOKENS`
(150K) — гоним `claude -p "/compact" --resume` (пока < 200K компакт проходит,
проверено: сжимает контекст), с индикатором (SSE-событие `status`). Сессии
`≥ CHAT_CONTEXT_CEILING_TOKENS` (185K) уже не сжать (компакт сам не прочитает) —
не воскрешаем, показываем понятное сообщение. Легаси-сессии без `contextTokens`
отсекаем по размеру файла (`CHAT_LEGACY_REFUSE_BYTES`, 1.5 МБ), чтобы не жечь
деньги (каждый неудачный resume ~$1+). Сырую ошибку 1M ловим и в синтетик-блоке,
и в `result` → один дружелюбный `error`-ивент (Part B). user-chat stateless,
контекст не копит — не трогаем.

**Дашборд/рейтинг учеников (`/dashboard.html`, кнопка-трофей в навбаре).**
Доступен ЛЮБОМУ залогиненному ученику (не admin-only) — каждый видит общий
рейтинг и отслеживает своё место. `GET /api/leaderboard` (`lib/leaderboard.js`)
отдаёт **только агрегаты-числа** и имена: сообщений за день / за неделю
(последние 7 дней) / всего, заходы, созданные проекты, опубликованные.
**Приватность критична:** наружу не уходит ни текст сообщений, ни названия
чужих проектов — ничего конфиденциального между учениками не перетекает.
Очки: `заход = 20`, `созданное приложение = 100` (веса — константа `WEIGHTS`
в `leaderboard.js`; сообщения сейчас вес 0, легко поднять). Сообщения считает
`transcripts.dailyCounts()` (только строки JSONL, без `isToolContinuation`),
заходы — поле `loginCount` в `users-vibe.json` (инкремент в `students.recordLogin()`
на каждый успешный `/api/login`; бэкфилла нет, растёт с момента внедрения).
Admin в рейтинг не входит.

**Два вида рейтинга (переключатель на дашборде):** «За всё время» (как описано
выше, по очкам) и «За день» (по умолчанию — сегодня, со стрелками ‹ › и выбором
даты). Дневной вид ранжирует по **числу сообщений за выбранный день**; заходы за
день — доп. колонка. Данные для дней: `leaderboard()` отдаёт на каждого ученика
посуточные карты `dailyMsg` (из `dailyCounts()`) и `dailyLogins` (новое поле в
`users-vibe.json`, инкремент по UTC-дню в `recordLogin()`, бэкфилла нет) + общий
`firstDate` (нижняя граница выбора). Дашборд считает дневной рейтинг на клиенте —
переключение даты мгновенное, без перезапросов. Приватность та же: только числа.

**Материалы/шаблоны (UI).** Секция-грид «Шаблоны» (showcase app-*) в проектах
временно скрыта (`hidden`), но кнопка «+ Из шаблона» (создание из базовых
`_base`/`_b24-single-php` через `modal-create`) работает. Во вкладке Материалы
есть страница «Шаблоны» с кнопками скачивания (`_base`, `_b24-single-php`,
отдельно `CLAUDE.md` из b24). Вкладка «Работа с Клодом» убрана.

**Публикация приложений.** Ученик публикует проект → приложение крутится в его
контейнере на порту 3001+ (как `student`), панель проксирует
`/<user>/<project>/*` → `http://<containerIP>:<port>/` по vibe-net (наружу порты
не светятся). Доступ: `visibility=owner` (владелец+админ), `auth` (любой
залогиненный) или `public` (без входа — внешние пользователи; `public` минует
auth-гейт и в HTTP, и в WS). Конфиг — в `.portal-meta.json` проекта (`publish:{enabled,
visibility,autosleep,port,cmd}`). Self-heal: заход на URL будит контейнер и
переподнимает процесс (`panel/lib/publish.js`, `ensureRunning`). `autosleep=false`
→ idle-reaper не усыпляет ученика. Деплой по умолчанию: Node (`node <entry>` с
`PORT`), PHP (`php -S`), статика (`php -S`). Логи приложения — `.publish/app.log`
в проекте, pid — `.publish/app.pid`. Образ контейнера включает `php-cli`.
Ограничение: приложения должны использовать относительные пути к ассетам
(подпуть `/<user>/<project>/`). Резерв логинов: `api,code,css,js,...` нельзя
завести как ученика. WS-upgrade к опубликованному приложению (как и у `/code/`)
не проходит сессионный auth-гейт — приемлемо: HTML гейтится по HTTP, аудитория
доверенная (5-10 учеников).

Idle reaper: каждые 5 минут проверяет `lastActivityAt` каждого ученика, если
больше 30 минут (`IDLE_STOP_MIN`) — `docker stop`.

Порты контейнеров: 8200-8299, выдаются `allocatePort()`, хранятся в
`users-vibe.json`. nginx → vibe-panel → `127.0.0.1:820X`, без выставки портов
наружу.

**Несколько окон под одной учёткой (`panel/lib/code-slots.js`).** Под одним
логином могут одновременно работать 2-3 человека, и каждому нужно своё окно
VS Code (свои терминалы/вкладки), иначе один code-server = одно общее окно и
люди мешают друг другу. Решение: «слот» окна липнет к сессии
(`req.session.codeSlot`). Первая сессия юзера → slot 0 (PID-1 `code-server` из
CMD контейнера, порт 8080). Каждая конкурентная сессия того же логина →
slot 1, 2, … — **отдельный процесс `code-server` в том же контейнере** на порту
`8080+slot`, поднимается лениво через `docker exec -d` (как в `publish.js`),
со своим `--user-data-dir` (`~/.cs-data/<slot>` → независимые окна/терминалы),
но общий HOME (по роли, см. выше) и общий `--extensions-dir`. Панель проксирует
`/code/<user>/` в нужный инстанс по vibe-net (`http://<containerIP>:<8080+slot>`),
и HTTP, и WS — в один слот (`req._codeTarget`). Образ пересобирать не нужно —
`code-server` уже в нём, доп.инстансы запускаются командой, bind на порт сам
сериализует гонку (второй процесс на занятом порту тихо умирает). Файлы общие
→ при правке одного файла двумя людьми code-server покажет конфликт «файл изменён
на диске» (нормальное поведение, не баг). Лимиты: `MAX_SLOTS=3`,
`CODE_SLOT_TTL_MIN=40` (слот свободен, если сессия не «тыкала» дольше TTL). RAM
контейнера поднята до 3072 МБ / 1.5 CPU (потолок, не резерв; см.
`STUDENT_MEM_LIMIT_MB`/`STUDENT_CPU_LIMIT` в `students.js`) — у живых контейнеров
применить `docker update --memory 3072m --memory-swap 3072m --cpus 1.5 vibe-<u>`,
новые получат при пересоздании.

**Десктопный VS Code по SSH (`lib/ssh-access.js`, `workspace-image/vibe-entrypoint.sh`).**
Ученик может работать в нативном VS Code на своём ноуте (Remote-SSH), а не в
браузере. **sshd живёт ВНУТРИ контейнера** (от `student`, non-root, только pubkey),
порт `2222` контейнера публикуется наружу на `0.0.0.0:84XX` (`sshPort`, аллоцируется
рядом с code-server-портом, хранится в `users-vibe.json`). Почему внутри, а не
шлюзом на хосте: VS Code Remote-SSH обязательно открывает порт-форвардинг к своему
серверу, а при sshd на хосте форвардинг в namespace хоста не дотягивается до server
VS Code в namespace контейнера — проверено, **host-gateway с VS Code не работает**.
Внутри контейнера форвардинг остаётся в его namespace (заперт iptables: только
шим+интернет) — безопасно.

Поток: ученик в панели жмёт «💻 Десктоп VS Code» → скачивает личный ключ
(`GET /api/ssh-key`, панель генерит ed25519, приватник НЕ монтируется в контейнер) +
готовый `~/.ssh/config` (`GET /api/ssh-config`, с `StrictHostKeyChecking accept-new`,
чтобы не упираться в вопрос об отпечатке) → коннектится к `vibe-<user>`. На карточке
проекта кнопка `💻` = deep-link `vscode://vscode-remote/ssh-remote+vibe-<user>/…`.
Перевыпуск: `POST /api/ssh-key/regenerate` (host-key/отпечаток не меняем — персист в
`/data/config/ssh/<user>/host`).

Тонкости (все проверены спайком, см. спеку/план `docs/superpowers/*/2026-06-04-desktop-vscode-ssh*`):
- **`KexAlgorithms curve25519-sha256`** в конфиге sshd обязателен — иначе постквантовый
  KEX виснет между OpenSSH 9.x (контейнер) и свежим macOS-клиентом 10.x.
- **`SetEnv ANTHROPIC_BASE_URL=… ANTHROPIC_AUTH_TOKEN=… CLAUDE_CODE_DISABLE_1M_CONTEXT=1`**
  в конфиге sshd — иначе claude-cli (и расширение) в SSH-сессии не наследуют docker-env
  и лезут напрямую в `api.anthropic.com`. С SetEnv — идут через шим, аудит цел.
- `--init` (tini) как PID 1 — reaping зомби (sshd форкает per-connection дети).
- idle-reaper (`reapIdleContainers`) перед `docker stop` проверяет established-соединения
  на `sshPort` (`ss`) — живая SSH-сессия = активность, не усыпляем.
- code-server (браузер) остаётся параллельно. Образ: `openssh-server`+`procps` (`ps`
  нужен VS Code server; рантайм-`apt` в контейнере невозможен из-за CapDrop=ALL).
- Расширения desktop VS Code хранятся в `.vscode-server/extensions` (НЕ в общем volume
  code-server) — при необходимости предустанавливать отдельно.

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
| `vibe-admin-code.service` | code-server для админа, рут `/opt/vibe-portal` (127.0.0.1:8300, `--auth none`), доступ только через admin-гейт панели на `/admin-code/` |

Юниты живут в `systemd/` репозитория. При изменении — копировать в
`/etc/systemd/system/`, `daemon-reload`, рестарт сервиса.

## Структура файлов

```
/opt/vibe-portal/
├── CLAUDE.md                          этот файл
├── .claude/settings.json              permissions для Claude
├── workspace-image/
│   ├── Dockerfile                     vibe-workspace:dev (+ openssh-server, procps)
│   └── vibe-entrypoint.sh             autostart sshd (curve25519+SetEnv) + code-server
├── shim/
│   ├── server.js                      OAuth swap proxy
│   └── transcript.js                  аудит диалогов (IP→ученик, SSE-парсер, JSONL)
├── panel/
│   ├── server.js                      Express :3020
│   ├── lib/{auth,students,templates,transcripts,publish,leaderboard,code-slots,ssh-access}.js
│   └── public/{index.html,history.html,logs.html,dashboard.html,css/,js/}
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
    ├── transcripts/<user>/<date>.jsonl  аудит диалогов (пишет шим, читает панель)
    ├── ssh/<user>/                    SSH-доступ ученика: id_ed25519 (приватник, для скачивания),
    │     └── host/                    монтируется в контейнер → .sshd: authorized_keys + host-key
    └── vscode-server/<user>/          персист VS Code server (десктопный VS Code по SSH)
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
| 8200-8299 (127.0.0.1) | code-server'ы контейнеров учеников (host-binding слота 0) |
| 8400-8499 (0.0.0.0) | sshd контейнеров учеников (десктопный VS Code по SSH, `sshPort`) |
| 8080+slot (в контейнере) | code-server'ы слотов (multi-window под одной учёткой, vibe-net) |
| 2222 (в контейнере) | sshd ученика (публикуется на 0.0.0.0:84XX) |
| 8300 (127.0.0.1) | admin code-server (root проекта), прокси `/admin-code/` (только admin) |
| 3001-3099 (в контейнере) | приложения учеников (доступ через панель, наружу не торчат) |

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
- `/compact`-аналог для claude-cli внутри контейнера (VS Code) — нет (там
  интерактивный автокомпакт CLI). Для project-chat автокомпакт есть — см. выше.
- Уже-распухшие (> 200K) сессии project-chat задним числом не восстановить:
  компакт сам должен прочитать всю историю → снова упрётся в 1M. Только новый чат.
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
- **2026-07-21** — HOME разведён по ролям: admin остаётся на
  `/home/my_workspace`, ученики переведены на `/home/student/workspace`
  (см. «HOME по роли» выше). Заодно найдены и починены два бага из вчерашней
  миграции на `/home/my_workspace`: устаревший код `vibe-panel.service`
  (не был перезапущен после правок `students.js`) и code-server, стартующий
  с `auth: password`/`bind-addr 127.0.0.1` из-за bind-mount, перекрывающего
  бейк-конфиг образа (конфиг перенесён из Dockerfile в `vibe-entrypoint.sh`,
  пишется в рантайме через `$HOME`). Отдельно обнаружен и **не устранён**
  (по решению пользователя) баг изоляции: bridge-интерфейс `vibe-net`
  на деле называется `br-92be0fc90d9e`, а не `br-vibe`, который ожидает
  `scripts/setup-iptables.sh` — правила `VIBE-FILTER`/`VIBE-INPUT` из
  `DOCKER-USER`/`INPUT` ни разу не матчатся (0 pkts), т.е. изоляция между
  контейнерами учеников и блок доступа к хосту сейчас **не работают**.
  Фикс: переименовать bridge в `br-vibe` (`ip link set br-92be0fc90d9e name
  br-vibe`) и перезапустить `vibe-iptables.service` — ждёт явного решения.
