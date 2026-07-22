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
- Бэкап — не настроен этим раннбуком (в проде используется общий
  `/opt/dev-portal/scripts/backup-all.sh`, специфичный для текущего сервера).
  На новом сервере — настроить `git commit` (см. `CLAUDE.md` п.1) и снапшоты
  `/data/` отдельно.
