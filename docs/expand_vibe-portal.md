# Деплой vibe-portal с нуля на новом сервере

Пошаговый раннбук для установки vibe-portal на чистый сервер (новый физический
хост/VM). Это **отдельный документ от `new-server-setup.md`** — тот описывает
проксмокс/железо/VM-раскладку смартейповского сервера, этот — конкретно
установку приложения vibe-portal, независимо от того, где именно оно крутится
(bare metal, VM, отдельная VM `vm-portals` из плана `new-server-setup.md` — не
важно). Архитектурные детали и назначение каждого куска — в `CLAUDE.md`, здесь —
только последовательность действий.

Не описано и не нужно для этого рантайма: dev-portal (сосед на том же сервере
в проде) — vibe-portal от него не зависит, ставится отдельно.

## 0. Что нужно иметь заранее

- Доменное имя, указывающее на сервер (в проде — `vibe.kiselevgroup.com`).
- OAuth-креды Claude (`.credentials.json` от `claude login` — см. шаг 6).
  Без них шим не сможет проксировать запросы учеников.
- Доступ к внешнему HTTPS-прокси для исходящих запросов к `api.anthropic.com`
  (см. `CLAUDE.md` → Anthropic-shim, п.4) — используется тот же прокси, что и
  у dev-портала, либо любой другой рабочий HTTP(S)-прокси. Взять креды неоткуда
  автоматически — это внешняя зависимость, добыть отдельно.

## 1. Требования к серверу

- Linux (Debian/Ubuntu; ниже команды — под `apt`).
- Docker Engine (`docker`, `docker network`, `docker.service` в systemd).
- Node.js 22.x на хосте (панель и шим — обычные node-процессы, не в контейнере).
- nginx + certbot (Let's Encrypt).
- Пакеты для панели: `apache2-utils` (даёт `htpasswd`), `zip`, `openssh-client`
  (даёт `ssh-keygen` — панель генерит per-student ed25519-ключи для десктопного
  VS Code).
- `iptables` (legacy или nf_tables-совместимый — скрипт изоляции зовёт `iptables`
  напрямую).

```bash
apt-get update
apt-get install -y docker.io nginx certbot python3-certbot-nginx \
    apache2-utils zip openssh-client iptables

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

systemctl enable --now docker
```

## 2. Клонировать репозиторий

```bash
git clone <адрес-репозитория> /opt/vibe-portal
cd /opt/vibe-portal
npm --prefix panel install
npm --prefix shim install
```

## 3. Внешняя структура данных (`/data/`)

Всё, что не должно ехать в git (workspace'ы учеников, секреты, сессии,
транскрипты) — вне `/opt/vibe-portal/`, в `/data/`:

```bash
mkdir -p /data/vibe-students
mkdir -p /data/config/{auth,env,sessions-vibe,transcripts,ssh,vscode-server}
chmod 700 /data/config/auth /data/config/env
```

Ничего внутри `/data/config/auth/*` и `/data/config/env/*` не коммитится в git
(секреты и учётки) — см. `CLAUDE.md` п.2 «Секреты никогда в git».

## 4. Docker-образ ученика (`vibe-workspace:dev`)

```bash
cd /opt/vibe-portal/workspace-image
docker build -t vibe-workspace:dev .
```

Образ = Debian 12 + Node 22 + code-server + `@anthropic-ai/claude-code` +
`openssh-server` + `php-cli` (см. `Dockerfile` — комментарии там объясняют,
почему `HOME` не бейкается, а передаётся явно при `docker create`).

Пересобирать после `git pull`, если менялся `workspace-image/Dockerfile`.

## 5. Docker-сеть `vibe-net`

```bash
docker network create vibe-net --subnet 172.30.0.0/24
```

Важно: **имя bridge-интерфейса, который создаст docker для этой сети, заранее
неизвестно** (`br-<первые 12 hex network ID>`, генерится в момент создания сети,
не персистентно между хостами/ребутами). `scripts/setup-iptables.sh` вычисляет
его сам через `docker network inspect vibe-net` при каждом запуске — ничего
хардкодить не нужно, но сеть **обязательно должна существовать до первого
запуска `vibe-iptables.service`** (иначе `docker network inspect` в скрипте
упадёт).

## 6. Секреты

### 6.1 OAuth-креды Claude

```bash
mkdir -p /root/.claude
cp /path/to/your/claude-credentials.json /root/.claude/.credentials.json
chmod 600 /root/.claude/.credentials.json
```

Это тот же файл, которым пользуется хостовый `claude` CLI (единый источник —
см. `CLAUDE.md` → Anthropic-shim, «Единый OAuth-файл»). Проще всего получить
его — выполнить `claude login` на этом же сервере и он появится тут сам.

### 6.2 Прокси для внешних запросов к Anthropic

`/data/config/env/proxy.env`:
```
HTTPS_PROXY=http://user:pass@host:port
```

### 6.3 Секрет сессий панели

`/data/config/env/vibe-panel.env`:
```
SESSION_SECRET=<случайная длинная строка>
SSH_PUBLIC_HOST=vibe.kiselevgroup.com
```

`SESSION_SECRET` — обязателен, панель падает при старте без него
(`panel/server.js`). `SSH_PUBLIC_HOST` — хост, который панель подставляет в
сниппет `~/.ssh/config` для десктопного VS Code (по умолчанию —
`vibe.kiselevgroup.com`, на другом домене — переопределить).

Сгенерировать секрет:
```bash
openssl rand -hex 32
```

## 7. systemd-юниты

Скопировать юниты и включить (порядок важен: сеть уже должна существовать —
см. шаг 5):

```bash
cp /opt/vibe-portal/systemd/vibe-iptables.service /etc/systemd/system/
cp /opt/vibe-portal/systemd/anthropic-shim.service /etc/systemd/system/
cp /opt/vibe-portal/systemd/vibe-panel.service /etc/systemd/system/
cp /opt/vibe-portal/systemd/vibe-admin-code.service /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now vibe-iptables.service
systemctl enable --now anthropic-shim.service
systemctl enable --now vibe-panel.service
systemctl enable --now vibe-admin-code.service
```

Проверка:
```bash
systemctl status vibe-iptables anthropic-shim vibe-panel vibe-admin-code
curl http://127.0.0.1:8190/_shim/health
iptables -nL VIBE-FILTER --line-numbers   # правила должны быть, счётчики появятся после первого трафика
```

Не копировать/не включать: `systemd/sync-claude-creds.service` — легаси,
отключён в проде (см. `CLAUDE.md` → «Единый OAuth-файл»), не нужен при
установке с нуля. `systemd/keepalive-claude.service` — опционален (поддержание
живости OAuth-токена хостового `claude`, не строго обязателен для работы шима).

## 8. nginx + TLS

```bash
cp /opt/vibe-portal/nginx/vibe.kiselevgroup.com /etc/nginx/sites-available/
ln -s /etc/nginx/sites-available/vibe.kiselevgroup.com /etc/nginx/sites-enabled/
mkdir -p /var/www/letsencrypt
nginx -t && systemctl reload nginx
```

В конфиге уже вписан ваш домен как `vibe.kiselevgroup.com` — при другом домене
поправить `server_name` и путь к сертификатам на все вхождения в файле.
Сертификат — первым запуском certbot (до этого конфиг с `listen 443 ssl` не
взлетит — либо временно закомментировать TLS-блок, либо сразу гнать через
`certbot --nginx`):

```bash
certbot --nginx -d vibe.kiselevgroup.com
```

## 8b. (Опционально) HTTPS на голом IP без домена — самоподписанный сертификат

Если домена нет и есть только публичный IP (Let's Encrypt не подойдёт —
ему нужен домен для ACME-валидации), а браузер должен перестать ругаться
"insecure context" на `/admin-code/` (code-server требует secure context для
части функциональности, включая доступ к буферу обмена и WebSocket из
https-страницы) — поднимаем самоподписанный сертификат.

Сертификат — **вне git**, генерится прямо на сервере:

```bash
mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/vibe-selfsigned.key \
  -out    /etc/nginx/ssl/vibe-selfsigned.crt \
  -subj "/CN=<ваш IP>" \
  -addext "subjectAltName=IP:<ваш IP>"
chmod 600 /etc/nginx/ssl/vibe-selfsigned.key
```

Конфиг — готовый шаблон `nginx/201.51.4.183` в репозитории (назван по IP,
на котором обкатан; при другом IP — скопировать под новым именем и заменить
`<ваш IP>` во всех вхождениях `server_name`/`-subj`/`-addext` выше и в самом
файле):

```bash
cp /opt/vibe-portal/nginx/201.51.4.183 /etc/nginx/sites-available/vibe
ln -sf /etc/nginx/sites-available/vibe /etc/nginx/sites-enabled/vibe
nginx -t && systemctl reload nginx
```

Конфиг делает: `:80` → постоянный редирект на `:443`; `:443` — тот же
проксинг на `vibe_panel` (`127.0.0.1:3020`), что и в `vibe.kiselevgroup.com`,
с полным пробросом `Upgrade`/`Connection $connection_upgrade` — это важно
для `/code/<user>/*` и `/admin-code/` (оба идут через WS к code-server);
без этого проброса — обрыв соединения 1006. Отдельный nginx-`location
/admin-code/` не нужен: этот путь роутится не в nginx, а внутри
`panel/server.js` (гейт по `req.session.isAdmin`, проксирование на
`127.0.0.1:8300`) — существующий catch-all `location /` уже его покрывает.

Смоук-тест:
```bash
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://<ваш IP>/    # 301 -> https://...
curl -k -sS -o /dev/null -w '%{http_code}\n' https://<ваш IP>/                   # 200
curl -k -sS -o /dev/null -w '%{http_code}\n' https://<ваш IP>/admin-code/        # 302 (редирект внутрь code-server, если залогинены как admin)
```

Браузер один раз спросит подтверждение самоподписанного сертификата
(«небезопасно») — это ожидаемо и не чинится без реального домена + CA.
Если нужен полноценный сертификат без предупреждений — единственный путь:
завести домен, направить его на IP, и использовать `certbot` как в разделе 8.

## 9. Бутстрап первого admin'а

```bash
/opt/vibe-portal/scripts/create-admin.sh <login> <password>
```

Скрипт создаёт htpasswd-запись, `users-vibe.json` (`role: admin`), папку
workspace'а и docker-контейнер `vibe-<login>` (created, не started).

**Важная особенность:** докер-контейнер, который создаёт сам
`create-admin.sh`, — упрощённый и **устарел** относительно того, что реально
собирает панель (`panel/lib/students.js → dockerCreate()`): в нём нет общих
volume'ов (`vibe-claude-skills`, `vibe-extensions`), нет SSH-маунтов для
десктопного VS Code, нет персиста `.vscode-server`, лимиты памяти/CPU —
старые (1.5G/1.0 вместо актуальных 3G/1.5), путь к шаблонам — из
`/opt/dev-portal/templates` (устаревший, актуальный —
`/opt/vibe-portal/templates`, уже задан env-переменной `TEMPLATES_DIR` в
`vibe-panel.service`, но `create-admin.sh` его не использует). Панель это
не чинит сама — `dockerStart()` пересоздаёт контейнер по актуальному
`dockerCreate()` только если контейнера **нет вообще** (404 от докера), а не
если он просто устаревший.

Поэтому после `create-admin.sh` — снести созданный им контейнер и дать панели
создать правильный при первом старте:

```bash
docker rm -f vibe-<login>
```

Дальше — либо залогиниться в UI (первый вход стартует контейнер через панель,
которая создаст его актуальной функцией), либо руками:

```bash
curl -s -X POST http://127.0.0.1:3020/api/container/start \
  --cookie "<сессионная кука после логина>"
```

(проще просто зайти в браузере: `https://<домен>` → логин → панель сама
запустит контейнер по актуальной конфигурации).

## 10. Смоук-тест

```bash
# 1. Все сервисы живы
systemctl is-active vibe-iptables anthropic-shim vibe-panel vibe-admin-code

# 2. Шим отвечает
curl http://127.0.0.1:8190/_shim/health

# 3. Логин через UI: https://<домен> → залогиниться под admin'ом,
#    дождаться поднятия контейнера, открыть VS Code в браузере.

# 4. В терминале VS Code внутри контейнера:
claude --version
echo hi | claude -p "просто скажи привет"
#    Ответ должен прийти — значит шим подменяет OAuth-токен и достаёт до
#    api.anthropic.com через прокси.

# 5. Изоляция (см. CLAUDE.md → «Изоляция»):
docker exec -u student vibe-<login> curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://172.30.0.1:8190/_shim/health   # 200 — шим доступен
docker exec -u student vibe-<login> curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/ ; echo          # таймаут/ошибка — хостовые порты задроплены
docker exec -u student vibe-<login> curl -s -m 3 -o /dev/null -w '%{http_code}\n' https://ya.ru ; echo                   # 200 — внешний интернет доступен
```

Если пункт 5 не проходит (контейнер видит хостовые порты) — см. `CLAUDE.md` →
«История», запись про баг `br-vibe`/динамическое имя моста: убедиться, что
`vibe-net` создана **до** первого запуска `vibe-iptables.service`, и что в
`DOCKER-USER`/`INPUT` есть hook-правило на актуальное имя моста
(`iptables -nL DOCKER-USER -v | grep VIBE`).

## 11. Дальше

- Добавлять учеников — через UI (Admin → добавить ученика), не через
  `create-admin.sh` (тот только для самого первого admin'а; обычные ученики
  заводятся панелью с полностью актуальной конфигурацией контейнера).
- Шаблоны курса (`templates/app-*`) — уже в репозитории, ничего дополнительно
  разворачивать не нужно. Регенерация — см. `CLAUDE.md` → «Откуда обновляются
  шаблоны» (требует соседний `/opt/dev-portal` с showcase-каталогом; для
  установки только vibe-portal — не нужно).
- Бэкап — не настроен этим раннбуком, **и в текущем проде его тоже нет**
  (проверено 2026-08-17: скрипта `backup-all.sh` не существует, `/srv/` пуст,
  таймера/крона нет — см. `CLAUDE.md` § «Бэкап»; раньше здесь стояла ссылка на
  этот скрипт как на работающий, это было неверно). На новом сервере — завести
  с нуля: `git commit` + `git push` (см. `CLAUDE.md` п.1) для `/opt/vibe-portal`
  и **отдельно снапшоты `/data/config/`** (учётки, ssh-ключи учеников,
  секреты, транскрипты; без `vscode-server/` это ~4 МБ).

## 12. deploy-service — решённые проблемы этой сессии (опционально, не часть базовой установки курса)

Компонент появился не из плана, а из конкретного инцидента: агент внутри
курсового проекта `es-trans_repairs` (личный, не курсовой — деплой на реальный
`repairs.es-trans.ru`) уткнулся в отсутствие root на сервере `201.51.4.183` и
попросил пользователя выдать пароль root / `NOPASSWD:ALL` в sudoers. Разбор
поднял три отдельные проблемы — фиксы ниже, подробности и альтернативы,
которые отвергли, см. `docs/decisions.md` D-004/D-005.

**Проблема 1 — сервер деплоя оказался тем же хостом, что держит сам
vibe-portal.** `201.51.4.183` — не отдельная клиентская машина, а тот же
физический сервер (или VM), на котором крутится весь курс. На нём уже жила
production-инфраструктура (5 Node/pm2-сайтов + 1 PHP/php-fpm) для личных
проектов admin'а из `/home/my_workspace`, развёрнутая руками до появления
этого сервиса. **Вывод для новой установки:** если на сервере vibe-portal
будут ещё и личные production-деплои admin'а (а не только курсовые
контейнеры) — заранее решить, нужен ли `deploy-service`, до того как раздавать
root/sudo агентам «руками» на скорую руку.

**Проблема 2 — устаревший `HOST_PUBLIC_IP` в `scripts/setup-iptables.sh`
молчал.** Хардкод старого публичного IP хоста означал, что анти-NAT-loopback
DROP-правило (см. п.5 внутри `setup-iptables.sh`) не матчило ни один пакет —
изоляция `vibe-net → публичный IP хоста` была тихо сломана (тот же класс
бага, что и хардкод имени bridge-интерфейса, см. «История» в `CLAUDE.md`).
Фикс уже в текущей версии скрипта репозитория — `HOST_PUBLIC_IPS` вычисляется
динамически (`ip -4 -o addr show scope global`) при каждом запуске, ничего
дополнительно настраивать для новой установки не нужно. **Но:** после
установки стоит один раз проверить `iptables -nL VIBE-FILTER -v | grep DROP`
и убедиться, что реальный публичный IP сервера в списке — на случай, если
DHCP/провайдер сменит адрес уже после установки, правило подхватит его само
при следующем запуске `vibe-iptables.service` (перезапуск сервиса =
`/opt/vibe-portal/scripts/setup-iptables.sh` вручную, без ребута).

**Проблема 3 — root/sudo контейнерам не дали, вместо этого — узкий
сервис.** Если на новом сервере тоже понадобится деплоить личные
(не курсовые) проекты admin'а на этот же хост — не выдавать root/sudo
контейнерам и не переводить контейнер на `--privileged`/`--network host`
(ломает всю модель изоляции курса). Поднять `deploy-service` по тому же
образцу, что и `anthropic-shim`:

```bash
npm --prefix /opt/vibe-portal/deploy-service install
cp /opt/vibe-portal/systemd/vibe-deploy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now vibe-deploy
mkdir -p /etc/vibe-deploy
# зарегистрировать существующие production-деплои вручную —
# см. /etc/vibe-deploy/registry.json на текущем проде как пример формата
# (type:"node" — Node+pm2; type:"php" — php-fpm/статика, поля
# src_subdir/exclude — см. CLAUDE.md § deploy-service).
```

`setup-iptables.sh` уже открывает `DEPLOY_PORT` (по умолчанию 8191) на
`SHIM_IP` — отдельно ничего добавлять не нужно, юнит сам слушает
`172.30.0.1:8191`.

**Главный урок при ручной регистрации легаси-сайтов в `registry.json`:**
сопоставлять домен ↔ каталог ↔ процесс **по факту** (`pm2 jlist` → `pid`,
`ss -ltnp` → какой `pid` слушает какой порт), а не по похожести имён — на
этом проде домены `test-1`/`test-2.es-trans.ru` оказались проксированы на
процессы с «противоположными» по интуиции именами, и наивный `diff` файлов
исходного кода тоже не помог бы отличить их (код обоих деплоев совпал
побайтово).

## 13. Донастройка проектов admin'а после переезда/установки (пути, hooks, лимиты)

Заготовка правок, которые понадобились при настройке личного проекта admin'а
`website-customizer` (правки на сайты, скиллы `superpowers` + `playwright`).
**Два пункта исходной заготовки были ошибочны и здесь исправлены** — читай
пометки ⚠️, прежде чем копипастить. Дата разбора: 2026-08-17.

### 13.1. Пути в `.claude/settings.json` — НЕ заменять на хостовые ⚠️

Исходная заготовка предлагала:

```bash
# ⚠️ НЕ ДЕЛАТЬ — это сломает проект:
sed -i 's|/home/my_workspace/|/data/vibe-students/krutko77/|g' \
  /data/vibe-students/krutko77/website-customizer/.claude/settings.json
```

**Почему нельзя.** `/home/my_workspace` — путь **внутри контейнера** (HOME
admin'а, см. CLAUDE.md § «HOME по роли»); `/data/vibe-students/<user>` —
**хостовый** путь, который в этот HOME бинд-маунтится. Claude в VS Code
(браузерный code-server и десктопный по SSH) работает **внутри** контейнера,
где `/data/vibe-students/` не смонтирован вообще — в контейнере видны только
6 бинд-маунтов (`docker inspect <c> --format '{{range .Mounts}}...'`). После
такой замены абсолютные пути в `settings.json` (permission-глобы, путь к
`.git`, пути к скиллам) начнут указывать в никуда.

Правильно: внутри `.claude/settings.json` проекта, который открывают
**в контейнере**, оставлять внутриконтейнерные пути (`/home/my_workspace/...`
для admin'а, `/home/student/workspace/...` для ученика). Хостовые пути нужны
только тем командам, которые запускаются **с хоста** (панельные чаты
project-chat/user-chat спавнят `claude` на хосте — см. CLAUDE.md).

Проверка «какой путь правильный» — одной командой:

```bash
docker exec -u student vibe-<user> sh -lc 'echo $HOME; ls $HOME'
```

### 13.2. Замена Windows-hook на Linux (это корректно)

Скиллы `superpowers` приходят с полиглот-хуками: `run-hook.cmd` (Windows) и
`session-start` (POSIX). На Linux-хосте нужен второй. Заменить в трёх файлах
(`hooks.json` проекта + `hooks.json`/`hooks-cursor.json` скилла):

```bash
P=/data/vibe-students/krutko77/website-customizer
HOOK_JSON='{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          { "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/session-start\"",
            "async": false }
        ]
      }
    ]
  }
}'
printf '%s\n' "$HOOK_JSON" > "$P/hooks.json"
printf '%s\n' "$HOOK_JSON" > "$P/.claude/skills/superpowers-main/hooks/hooks.json"
printf '%s\n' "$HOOK_JSON" > "$P/.claude/skills/superpowers-main/hooks/hooks-cursor.json"
chmod +x "$P/.claude/skills/superpowers-main/hooks/session-start"
```

Найти такие места в других проектах:

```bash
find /data/vibe-students -name "hooks.json" -exec grep -l "run-hook.cmd" {} \;
```

### 13.3. Лимиты расходов при развёртывании НЕ настраиваются ⚠️

**Никакого шага «отключить лимиты» в развёртывании нет.** Лимитов по умолчанию
не существует: `shim/token-limits.js` начинается с
`if (!user || !user.spendLimitUsd) return null;` — нет поля, нет лимита;
глобального дефолта или env-переменной нет ни в `anthropic-shim.service`, ни в
`/data/config/env/`, а `panel/lib/students.js` при создании ученика поле
`spendLimitUsd` вообще не проставляет. На чистой установке отключать нечего.

Лимит появляется **только** если админ осознанно выставил его через панель
(карточка ученика) — это инструмент на потом, когда кто-то из учеников начнёт
жечь токены, а не часть первичной настройки.

Исходная заготовка требовала обратного — шаг «**ОТКЛЮЧЕНИЕ ЛИМИТОВ
(обязательно!)**» через `cat > /data/config/auth/users-vibe.json` со
«заглушкой» из полей `spendLimitUsd`/`tokenPeriod` (или вообще
`{"users":{}}`). Шаг был не только лишним, но и разрушительным: на этом проде
он уже привёл к потере данных 2026-08-17. Оставлено здесь как
предупреждение — если увидишь такой пункт в чьей-то инструкции, не выполняй.

**Почему нельзя.** `users-vibe.json` — не файл настроек лимитов, а **реестр
учёток портала**. Панель хранит в записи каждого пользователя:

| Поле | Зачем | Что будет при потере |
|------|-------|----------------------|
| `role` | `server.js` → `isAdmin = role === 'admin'`; `homeDirFor(role)` | admin теряет админку (CRUD учеников, `/api/transcripts`, `/logs.html`, `/admin-code/`); HOME контейнера при пересоздании уезжает с `/home/my_workspace` на `/home/student/workspace` |
| `containerPort` | порт code-server слота 0 (820X) | `dockerStart` бросит `no port assigned`, либо переаллокация |
| `sshPort` | published-порт sshd (84XX) | новый порт → готовый `~/.ssh/config` на ноуте перестаёт подключать |
| `loginCount`, `dailyLogins` | счётчики рейтинга (`/api/leaderboard`) | **безвозвратно** — бэкфилла нет by design |
| `spendLimitUsd`, `tokenPeriod` | лимиты расходов (`shim/token-limits.js`) | — |

Восстановить `role`/`containerPort`/`sshPort` постфактум можно из живого
контейнера (`docker port vibe-<u>`, `docker inspect` → `HOME`), счётчики
логинов — нельзя.

Если лимит действительно нужно снять (его кто-то ставил раньше) — правильный
способ, сохраняющий остальные поля:

```bash
# через панель: карточка ученика → поле лимита пустое/0 → сохранить
# или API (нужна admin-сессия):
curl -X POST http://127.0.0.1:3020/api/students/<user> \
  -H 'Content-Type: application/json' \
  -b <cookie-admin-сессии> \
  -d '{"spendLimitUsd": 0, "tokenPeriod": "total"}'
# server.js сам приводит 0/пустое к null (= лимит выключен),
# shim/token-limits.js трактует любое falsy-значение как «без лимита»
```

Если правка файла всё же неизбежна — **точечно, с бэкапом**, не перезаписью:

```bash
cp -a /data/config/auth/users-vibe.json \
      /data/config/auth/users-vibe.json.bak-$(date +%F-%H%M%S)
python3 - << 'PY'
import json
p = '/data/config/auth/users-vibe.json'
d = json.load(open(p))
d['users']['krutko77']['spendLimitUsd'] = None      # None = без лимита
json.dump(d, open(p, 'w'), indent=2, ensure_ascii=False)
PY
systemctl restart vibe-panel     # шим перечитывает файл сам, но рестарт не мешает
```

**Отдельно про бэкап этого файла.** `/data/config/` лежит **вне** git-репо, а
никакого бэкапа на этом хосте не существует вовсе — ни скрипта
`backup-all.sh`, ни каталога `/srv/server-backup/`, ни таймера/крона
(проверено 2026-08-17, см. CLAUDE.md § «Бэкап»). То есть восстанавливать
`users-vibe.json`/`.htpasswd-vibe` было бы неоткуда.
При развёртывании нового сервера **заведи отдельный бэкап `/data/config/`**
(там же `.htpasswd-vibe`, ssh-ключи учеников, транскрипты) — иначе одна
неудачная команда стоит всех учёток курса.

### 13.4. Что проверить после правок

```bash
# 1. JSON цел и поля на месте (role/containerPort/sshPort обязательны!)
python3 -m json.tool /data/config/auth/users-vibe.json
# 2. Порты в реестре совпадают с живым контейнером
docker port vibe-<user>
# 3. Сервисы живы
systemctl restart vibe-panel && systemctl is-active vibe-panel anthropic-shim
# 4. В UI: залогиниться и убедиться, что админские разделы видны
#    (если role потерян — админки не будет, а 403 легко списать на «баг»)
# 5. В VS Code внутри контейнера: claude запускается, нет Permission denied
#    и нет 429 от шима (429 = превышен spendLimitUsd, см. shim/server.js:196)
```

## 14. UI-доработки таблицы «Мои проекты» (2026-09-18) — уже в коде, но есть ручные шаги

Изменения этой сессии (навбар, реальные статусы, группировка по разделам) —
это правки `panel/public/*` и `panel/server.js`/`panel/lib/publish.js`,
которые едут в репозитории. На новом сервере они появятся **сами собой** при
обычном `git clone` из §2 — отдельно разворачивать нечего. Ниже — только то,
что важно знать/сделать руками при первой настройке, плюс грабли, на которые
уже наступали.

### 14.1. Статус проекта — реальный, не бутафорский

`GET /api/projects` (`panel/server.js`) сам вычисляет статус:
- **«НОВЫЙ»** — проект нигде не опубликован и не задеплоен;
- **«РАБОЧИЙ»** — проект опубликован через панель (`.portal-meta.json` →
  `publish.enabled`) **или** задеплоен через `deploy-service`
  (есть ключ `<owner>::<папка>` в `/etc/vibe-deploy/registry.json`, см. §12).

Переопределяется вручную полем `status` в `.portal-meta.json` проекта —
используется для служебных/утилитных проектов admin'а, которые крутятся без
деплоя (например, инструменты для работы с самим сервером) и которым не
подходит бинарная логика НОВЫЙ/РАБОЧИЙ:

```bash
cat > /data/vibe-students/<owner>/<project>/.portal-meta.json <<'EOF'
{ "status": "АГЕНТ" }
EOF
chown 1000:1000 /data/vibe-students/<owner>/<project>/.portal-meta.json
```

⚠️ **Грабля, на которую уже наступали:** ключ в `registry.json` обязан
**дословно** совпадать с именем папки проекта (`<owner>::<имя-папки>`, не
слаг и не произвольное имя) — иначе панель не увидит деплой и покажет
«НОВЫЙ» у реально работающего сайта. Легаси-запись `test-transport-logistics`
не совпадала с фактической папкой `es-trans_test_transport_logistics` — статус
молчал, пока не проверили `ls` папки против ключей реестра. При ручной
регистрации любого проекта в `registry.json` — сверять имя папки командой,
а не полагаться на память/интуицию (см. тот же урок про `test-1`/`test-2` в
§12 — там наивное сопоставление по имени тоже подвело).

### 14.2. Группировка проектов по разделам

В таблице «Мои проекты» у каждого проекта есть необязательное поле `section`
(тоже в `.portal-meta.json`, рядом с `status`/`publish`). Ничего донастраивать
не нужно — поле пустое по умолчанию, все проекты просто в одном списке без
заголовков. Ученик/admin назначает раздел прямо в UI (выпадающий список в
строке таблицы, колонка «Раздел»), переименование раздела — кнопкой ✎ у
заголовка-разделителя (переименовывает у всех проектов группы разом). Ничего
через API/бэкфилл на новом сервере заводить не требуется — фича полностью
самообслуживаемая через интерфейс.

Если нужно предустановить разделы программно (например, при массовом
переносе проектов со старого сервера) — эндпоинт:

```bash
curl -X POST http://127.0.0.1:3020/api/projects/<project>/section \
  -H 'Content-Type: application/json' \
  -b <cookie-сессии-владельца-или-admin> \
  -d '{"section": "Курсовые"}'
```

### 14.3. Косметика

- Навбар: блок бюджета/счётчика сессий (`.navbar-budget`) убран из шапки
  панели — если в старых заметках/скриншотах встречается «индикатор
  бюджета», это устаревшее описание интерфейса.
- Ширина таблицы «Мои проекты» — `max-width:1200px` (было 972px по умолчанию
  у `.section-block`), задано инлайн-стилем в `panel/public/index.html`, а не
  правкой общего класса — если понадобится ещё расширить, менять там же.
