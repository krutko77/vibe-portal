# Десктопный VS Code по SSH — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать ученикам открывать свой workspace на сервере в нативном (десктопном) VS Code по SSH (логин/пароль), при полном сохранении изоляции и аудита.

**Architecture:** Отдельный sshd на `:2222` (`AllowGroups vibe-students`, форвардинг выкл) → системный юзер `vibe-<user>` с login-shell-обёрткой → `sudo` к узкому root-хелперу → `docker exec` в собственный контейнер `vibe-<user>`. Контейнеры не меняют посыл безопасности; code-server (браузер) остаётся параллельно.

**Tech Stack:** OpenSSH (отдельный инстанс), Debian system users + PAM, sudo, docker/dockerode, systemd, fail2ban, Node/Express (панель), vanilla JS (UI).

**Spec:** [docs/superpowers/specs/2026-06-04-desktop-vscode-ssh-design.md](../specs/2026-06-04-desktop-vscode-ssh-design.md)

**Среда исполнения:** боевой сервер `80.87.104.193`. Исполняется **in-place** в `/opt/vibe-portal` (не worktree). Админский sshd на `:22` НЕ трогаем. После каждого блока — коммит (`git add … && git commit`, push не нужен).

---

## Структура файлов

Новые (в репо):
- `ssh/vibe-sshd_config` — конфиг отдельного sshd.
- `systemd/vibe-sshd.service` — юнит отдельного sshd.
- `scripts/vibe-ssh-enter` — login-shell ученика (обёртка).
- `scripts/vibe-docker-enter` — root-хелпер (через sudo), вход в свой контейнер.
- `scripts/sudoers-vibe-ssh` — правило sudoers.
- `scripts/setup-ssh-access.sh` — one-time установщик на хосте (группа, шелл, копирование файлов, host-ключи, fail2ban, юнит).
- `scripts/migrate-ssh-students.sh` — бэкфилл хост-юзеров для существующих учеников.
- `panel/lib/ssh-access.js` — управление хост-юзерами из панели (ensure/setpw/remove/config).

Изменяемые:
- `workspace-image/Dockerfile` — добавить `procps`.
- `panel/lib/students.js` — вызовы `ssh-access` в create/setpw/delete + bind `.vscode-server`.
- `panel/server.js` — роут `GET /api/ssh-config`.
- `panel/public/js/app.js` — UI: раздел «Подключение по SSH» + кнопки deep-link на проектах.
- `panel/public/index.html` (+ css) — разметка раздела SSH (по факту того, где живёт навигация).
- `CLAUDE.md` — описать новый доступ (порт 2222, сервис `vibe-sshd`, поток).

---

## Phase 0 — Спайк: Remote-SSH ↔ docker exec (риск №1)

Цель: до основной работы доказать на одном тестовом ученике, что десктопный VS Code Remote-SSH ставит свой server внутрь контейнера через обёртку. Если нет — переключаемся на запасной путь (ForceCommand + `SSH_ORIGINAL_COMMAND`) ещё до Phase 1.

### Task 0: Прототип на тестовом ученике

**Files:** временные (вне репо), удаляются в конце таска.

- [ ] **Step 1: Создать тестового ученика через панель/скрипт**

Если есть админ-доступ к панели — создать ученика `sshtest` с паролем `Test123456`.
Иначе вручную:
```bash
/opt/vibe-portal/scripts/create-admin.sh sshtest Test123456 || true
# убедиться что контейнер есть:
docker ps -a --filter "name=vibe-sshtest" --format '{{.Names}} {{.Status}}'
docker start vibe-sshtest
```
Expected: `vibe-sshtest` существует и запущен.

- [ ] **Step 2: procps в тестовый контейнер (без пересборки образа, временно)**

```bash
docker exec -u root vibe-sshtest bash -lc 'apt-get update && apt-get install -y procps' \
  || echo "нет интернета/прав — учесть в Phase 2"
docker exec vibe-sshtest bash -lc 'command -v ps && echo ps-ok'
```
Expected: `ps-ok`.

- [ ] **Step 3: Положить временные обёртки и sudoers**

```bash
install -m 0755 /dev/stdin /usr/local/sbin/vibe-ssh-enter <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-c" ]; then exec sudo -n /usr/local/sbin/vibe-docker-enter "$2"
else exec sudo -n /usr/local/sbin/vibe-docker-enter; fi
EOF

install -m 0755 /dev/stdin /usr/local/sbin/vibe-docker-enter <<'EOF'
#!/bin/sh
set -eu
user="${SUDO_USER:?no SUDO_USER}"
case "$user" in vibe-*) ;; *) echo "denied" >&2; exit 1 ;; esac
container="$user"
state="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo missing)"
[ "$state" = missing ] && { echo "no such container" >&2; exit 1; }
[ "$state" = true ] || docker start "$container" >/dev/null
tty=""; [ -t 0 ] && tty="-t"
if [ "$#" -ge 1 ] && [ -n "${1:-}" ]; then
  exec docker exec -i $tty -u student -w /home/student/workspace "$container" /bin/bash -lc "$1"
else
  exec docker exec -i $tty -u student -w /home/student/workspace "$container" /bin/bash -l
fi
EOF

cat > /etc/sudoers.d/vibe-ssh <<'EOF'
%vibe-students ALL=(root) NOPASSWD: /usr/local/sbin/vibe-docker-enter
Defaults!/usr/local/sbin/vibe-docker-enter !requiretty
EOF
chmod 0440 /etc/sudoers.d/vibe-ssh
visudo -cf /etc/sudoers.d/vibe-ssh
```
Expected: `parsed OK`.

- [ ] **Step 4: Завести хост-юзера `vibe-sshtest` и группу**

```bash
groupadd -f vibe-students
grep -qx /usr/local/sbin/vibe-ssh-enter /etc/shells || echo /usr/local/sbin/vibe-ssh-enter >> /etc/shells
install -d -m 0750 /var/lib/vibe-ssh/vibe-sshtest
useradd --no-create-home --home-dir /var/lib/vibe-ssh/vibe-sshtest \
        --shell /usr/local/sbin/vibe-ssh-enter --groups vibe-students vibe-sshtest 2>/dev/null \
  || usermod --shell /usr/local/sbin/vibe-ssh-enter --groups vibe-students vibe-sshtest
echo 'vibe-sshtest:Test123456' | chpasswd
id vibe-sshtest
```
Expected: юзер в группе `vibe-students`, shell = обёртка.

- [ ] **Step 5: Поднять временный vibe-sshd на :2222**

```bash
ssh-keygen -t ed25519 -f /etc/ssh/vibe_ssh_host_ed25519_key -N '' <<<y >/dev/null
cat > /etc/ssh/vibe-sshd_config <<'EOF'
Port 2222
PermitRootLogin no
PasswordAuthentication yes
AllowGroups vibe-students
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
GatewayPorts no
MaxAuthTries 3
HostKey /etc/ssh/vibe_ssh_host_ed25519_key
PidFile /run/vibe-sshd-test.pid
EOF
/usr/sbin/sshd -t -f /etc/ssh/vibe-sshd_config && echo cfg-ok
/usr/sbin/sshd -f /etc/ssh/vibe-sshd_config
ss -ltnp | grep ':2222' && echo listening
```
Expected: `cfg-ok`, `listening`.

- [ ] **Step 6: Проверить серверную механику обычным ssh (как делает VS Code)**

```bash
export SSHPASS=Test123456
# не-интерактив (как bootstrap-команды VS Code):
sshpass -e ssh -p 2222 -o StrictHostKeyChecking=no vibe-sshtest@127.0.0.1 'whoami; pwd; hostname; uname -m; ls -a ~'
```
Expected: `whoami=student`, `pwd=/home/student/workspace`, `hostname` = id контейнера (НЕ хост), без чужих файлов.
Если `sshpass` нет: `apt-get install -y sshpass` или проверить интерактивно вручную.

- [ ] **Step 7: Проверить, что форвардинг заблокирован**

```bash
sshpass -e ssh -p 2222 -o StrictHostKeyChecking=no -L 9999:172.30.0.1:8190 \
  vibe-sshtest@127.0.0.1 'echo should-not-forward' 2>&1 | grep -iE 'forwarding|refused|administratively' \
  && echo "forward-blocked-OK"
```
Expected: `forward-blocked-OK` (туннель запрещён).

- [ ] **Step 8: РУЧНОЙ чекпоинт — реальный VS Code**

Заказчик (или исполнитель с GUI) на своём ноуте:
1. VS Code → расширение «Remote - SSH».
2. `~/.ssh/config`:
   ```
   Host vibe-sshtest
       HostName 80.87.104.193
       Port 2222
       User vibe-sshtest
   ```
3. Remote-SSH: Connect to Host → `vibe-sshtest` → пароль `Test123456`.
4. Open Folder → `/home/student/workspace`.

Критерий: окно открылось, виден workspace, терминал внутри = `student@<container>`, `claude` отвечает.
**Если шаг провалился** — зафиксировать ошибку, перейти на ForceCommand-вариант (см. спеку §8.1) и повторить Steps 5–8.

- [ ] **Step 9: Снести временный прототип**

```bash
kill "$(cat /run/vibe-sshd-test.pid)" 2>/dev/null || pkill -f 'vibe-sshd_config'
userdel vibe-sshtest 2>/dev/null; rm -rf /var/lib/vibe-ssh/vibe-sshtest
rm -f /etc/sudoers.d/vibe-ssh /etc/ssh/vibe-sshd_config /etc/ssh/vibe_ssh_host_ed25519_key*
rm -f /usr/local/sbin/vibe-ssh-enter /usr/local/sbin/vibe-docker-enter
# тестового ученика sshtest можно оставить для дальнейших тестов или удалить через панель
echo "spike cleaned"
```
Expected: `spike cleaned`. Группу `vibe-students` и запись в `/etc/shells` можно оставить — пригодятся в Phase 1.

> **Чекпоинт фазы:** спайк прошёл (Step 8 OK) → продолжаем. Иначе — стоп, переключение на ForceCommand до Phase 1.

---

## Phase 1 — Инфраструктура SSH-шлюза (host, без панели)

Все файлы кладутся в репо и копируются на хост установщиком. Каждый таск завершается коммитом.

### Task 1: Скрипты-обёртки + sudoers (в репо)

**Files:**
- Create: `scripts/vibe-ssh-enter`
- Create: `scripts/vibe-docker-enter`
- Create: `scripts/sudoers-vibe-ssh`

- [ ] **Step 1: `scripts/vibe-ssh-enter`**

```sh
#!/bin/sh
# login-shell ученика на vibe-sshd. Прямого доступа к docker НЕ имеет —
# только через sudo-хелпер vibe-docker-enter (см. sudoers-vibe-ssh).
# sshd зовёт: `vibe-ssh-enter`  или  `vibe-ssh-enter -c "<команда>"`.
if [ "${1:-}" = "-c" ]; then
    exec sudo -n /usr/local/sbin/vibe-docker-enter "$2"
else
    exec sudo -n /usr/local/sbin/vibe-docker-enter
fi
```

- [ ] **Step 2: `scripts/vibe-docker-enter`**

```sh
#!/bin/sh
# Запускается ТОЛЬКО от root через sudo (правило в sudoers-vibe-ssh).
# Контейнер берётся из $SUDO_USER (проставлен root, не подделать), не из аргументов.
set -eu
user="${SUDO_USER:?no SUDO_USER}"
case "$user" in vibe-*) ;; *) echo "denied" >&2; exit 1 ;; esac
container="$user"
state="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo missing)"
[ "$state" = missing ] && { echo "no such container" >&2; exit 1; }
[ "$state" = true ] || docker start "$container" >/dev/null
tty=""; [ -t 0 ] && tty="-t"
if [ "$#" -ge 1 ] && [ -n "${1:-}" ]; then
    exec docker exec -i $tty -u student -w /home/student/workspace "$container" /bin/bash -lc "$1"
else
    exec docker exec -i $tty -u student -w /home/student/workspace "$container" /bin/bash -l
fi
```

- [ ] **Step 3: `scripts/sudoers-vibe-ssh`**

```
# Ученики (группа vibe-students) могут войти ТОЛЬКО в свой контейнер
# через узкий root-хелпер. В группе docker они НЕ состоят.
%vibe-students ALL=(root) NOPASSWD: /usr/local/sbin/vibe-docker-enter
Defaults!/usr/local/sbin/vibe-docker-enter !requiretty
```

- [ ] **Step 4: Локальная проверка синтаксиса**

Run:
```bash
sh -n scripts/vibe-ssh-enter && sh -n scripts/vibe-docker-enter && echo "sh-ok"
visudo -cf scripts/sudoers-vibe-ssh
```
Expected: `sh-ok`, `parsed OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/vibe-ssh-enter scripts/vibe-docker-enter scripts/sudoers-vibe-ssh
git commit -m "ssh: обёртки login-shell + root-хелпер + sudoers для vibe-students"
```

### Task 2: Конфиг и юнит отдельного sshd (в репо)

**Files:**
- Create: `ssh/vibe-sshd_config`
- Create: `systemd/vibe-sshd.service`

- [ ] **Step 1: `ssh/vibe-sshd_config`**

```
# Отдельный sshd для учеников. НЕ трогает админский sshd на :22.
Port 2222
Protocol 2
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication yes
KbdInteractiveAuthentication no
UsePAM yes
AllowGroups vibe-students
# Форвардинг полностью выключен — нельзя туннелировать в хост/шим/чужие контейнеры:
AllowTcpForwarding no
AllowAgentForwarding no
AllowStreamLocalForwarding no
GatewayPorts no
PermitTunnel no
X11Forwarding no
PermitUserEnvironment no
MaxAuthTries 3
MaxSessions 10
LoginGraceTime 20
ClientAliveInterval 120
ClientAliveCountMax 2
HostKey /etc/ssh/vibe_ssh_host_ed25519_key
PidFile /run/vibe-sshd.pid
Subsystem sftp internal-sftp
```

- [ ] **Step 2: `systemd/vibe-sshd.service`**

```ini
[Unit]
Description=vibe-portal SSH gateway (students :2222 -> own container)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
ExecStartPre=/usr/sbin/sshd -t -f /etc/ssh/vibe-sshd_config
ExecStart=/usr/sbin/sshd -D -f /etc/ssh/vibe-sshd_config
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Commit**

```bash
git add ssh/vibe-sshd_config systemd/vibe-sshd.service
git commit -m "ssh: конфиг и systemd-юнит отдельного vibe-sshd на :2222"
```

### Task 3: Установщик на хосте

**Files:**
- Create: `scripts/setup-ssh-access.sh`

- [ ] **Step 1: `scripts/setup-ssh-access.sh`**

```bash
#!/usr/bin/env bash
# One-time установка SSH-шлюза для учеников. Идемпотентно.
set -euo pipefail
REPO="/opt/vibe-portal"

echo "[1/6] группа vibe-students + /etc/shells"
groupadd -f vibe-students
grep -qx /usr/local/sbin/vibe-ssh-enter /etc/shells \
  || echo /usr/local/sbin/vibe-ssh-enter >> /etc/shells
install -d -m 0755 /var/lib/vibe-ssh
install -d -m 0755 /data/config/vscode-server

echo "[2/6] скрипты-обёртки"
install -m 0755 "$REPO/scripts/vibe-ssh-enter"   /usr/local/sbin/vibe-ssh-enter
install -m 0755 "$REPO/scripts/vibe-docker-enter" /usr/local/sbin/vibe-docker-enter

echo "[3/6] sudoers"
install -m 0440 "$REPO/scripts/sudoers-vibe-ssh" /etc/sudoers.d/vibe-ssh
visudo -cf /etc/sudoers.d/vibe-ssh

echo "[4/6] host-key + конфиг sshd"
[ -f /etc/ssh/vibe_ssh_host_ed25519_key ] \
  || ssh-keygen -t ed25519 -f /etc/ssh/vibe_ssh_host_ed25519_key -N '' >/dev/null
install -m 0644 "$REPO/ssh/vibe-sshd_config" /etc/ssh/vibe-sshd_config
/usr/sbin/sshd -t -f /etc/ssh/vibe-sshd_config

echo "[5/6] systemd-юнит"
install -m 0644 "$REPO/systemd/vibe-sshd.service" /etc/systemd/system/vibe-sshd.service
systemctl daemon-reload
systemctl enable --now vibe-sshd.service

echo "[6/6] fail2ban (если установлен)"
if command -v fail2ban-client >/dev/null; then
  cat > /etc/fail2ban/jail.d/vibe-sshd.conf <<'EOF'
[vibe-sshd]
enabled = true
port    = 2222
filter  = sshd
backend = systemd
journalmatch = _SYSTEMD_UNIT=vibe-sshd.service
maxretry = 4
bantime  = 1h
EOF
  systemctl restart fail2ban || true
else
  echo "  fail2ban не установлен — поставить: apt-get install -y fail2ban (см. Task 5)"
fi
echo "setup-ssh-access: done"
```

- [ ] **Step 2: Прогнать установщик на сервере**

Run:
```bash
chmod +x scripts/setup-ssh-access.sh
bash scripts/setup-ssh-access.sh
systemctl is-active vibe-sshd && ss -ltnp | grep ':2222' && echo OK
```
Expected: `active`, слушает `:2222`, `OK`. Админский sshd на `:22` не затронут (`systemctl is-active ssh` → active).

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-ssh-access.sh
git commit -m "ssh: установщик setup-ssh-access.sh (группа, обёртки, sudoers, vibe-sshd, fail2ban)"
```

### Task 4: Firewall и проверка доступности :2222

**Files:** проверка хостового INPUT (правки в репо — только если нужен явный ACCEPT).

- [ ] **Step 1: Проверить, доступен ли порт снаружи**

Run:
```bash
iptables -S INPUT | grep -E "2222|DROP|ACCEPT" | head
ss -ltn | grep ':2222'
```
Expected: `:2222` слушается; политика INPUT не дропает новые tcp (на этом сервере host INPUT открыт). Если есть явный host-firewall с default DROP — добавить `iptables -I INPUT -p tcp --dport 2222 -j ACCEPT` и вынести правило в `scripts/setup-iptables.sh` рядом с существующими (тогда — отдельный коммит).

- [ ] **Step 2: Проверить, что контейнеры до :2222 хоста НЕ дотянутся**

Run:
```bash
docker exec vibe-sshtest sh -lc 'timeout 3 bash -c "</dev/tcp/172.30.0.1/2222" 2>&1 || echo blocked'
```
Expected: `blocked` (VIBE-INPUT дропает контейнер→хост, кроме шима).

> Если в Step 1 правка iptables понадобилась — `git add scripts/setup-iptables.sh && git commit -m "iptables: ACCEPT tcp/2222 для vibe-sshd"`.

### Task 5: fail2ban

**Files:** установка пакета (вне репо) + jail уже кладёт установщик (Task 3 Step 1 [6/6]).

- [ ] **Step 1: Поставить fail2ban и применить jail**

Run:
```bash
apt-get update && apt-get install -y fail2ban
bash scripts/setup-ssh-access.sh   # повторный прогон допишет jail (идемпотентно)
fail2ban-client status vibe-sshd
```
Expected: jail `vibe-sshd` активен.

> Коммита нет (пакет ставится вне репо; jail генерит установщик). Зафиксировать факт установки в CLAUDE.md (Task 13).

---

## Phase 2 — Образ и монтирование

### Task 6: `procps` в образ

**Files:**
- Modify: `workspace-image/Dockerfile:11-20`

- [ ] **Step 1: Добавить `procps` в apt-набор**

В `workspace-image/Dockerfile` в списке `apt-get install` (строки 11–20) добавить `procps` рядом с `psmisc`:
```dockerfile
        sqlite3 \
        php-cli \
        psmisc \
        procps \
        locales \
```

- [ ] **Step 2: Пересобрать образ**

Run:
```bash
docker build -t vibe-workspace:dev /opt/vibe-portal/workspace-image
docker run --rm --entrypoint sh vibe-workspace:dev -c 'command -v ps && echo ps-ok'
```
Expected: `ps-ok`.

- [ ] **Step 3: Commit**

```bash
git add workspace-image/Dockerfile
git commit -m "image: добавлен procps (нужен ps для VS Code server по SSH)"
```

### Task 7: Bind `.vscode-server` в dockerCreate

**Files:**
- Modify: `panel/lib/students.js:189-198` (массив `Binds`)

- [ ] **Step 1: Добавить bind в `dockerCreate`**

В `panel/lib/students.js`, в `HostConfig.Binds` добавить строку (после bind скиллов):
```javascript
        `${SKILLS_VOLUME}:/home/student/.claude/skills:ro`,
        // Персист VS Code server (Remote-SSH) между пересозданиями контейнера:
        `/data/config/vscode-server/${username}:/home/student/.vscode-server:rw`,
```

- [ ] **Step 2: Гарантировать существование папки перед create**

В `dockerCreate` (или в `createStudent` до вызова `dockerCreate`) добавить создание папки с владельцем 1000:
```javascript
  fs.mkdirSync(`/data/config/vscode-server/${username}`, { recursive: true });
  fs.chownSync(`/data/config/vscode-server/${username}`, 1000, 1000);
```
(Убедиться, что `fs` импортирован в начале файла — если нет, добавить `import fs from 'node:fs';`.)

- [ ] **Step 3: Проверка на тестовом ученике**

Run:
```bash
docker rm -f vibe-sshtest
# заново создаст через панель/скрипт, либо вручную dockerStart('sshtest')
node -e "import('/opt/vibe-portal/panel/lib/students.js').then(m=>m.dockerStart('sshtest')).then(()=>console.log('started'))"
docker inspect vibe-sshtest -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' | grep vscode-server
```
Expected: bind `…/vscode-server/sshtest -> /home/student/.vscode-server` присутствует.

- [ ] **Step 4: Commit**

```bash
git add panel/lib/students.js
git commit -m "panel: bind .vscode-server в контейнер ученика (персист Remote-SSH)"
```

- [ ] **Step 5: Раскатка на существующие контейнеры**

Новый образ (procps, Task 6) и новый bind подхватятся только при пересоздании контейнера. Для существующих учеников — пересоздать (workspace и `.vscode-server` на mount'ах, не теряются). Делать в спокойное время (рвёт активные браузерные сессии code-server).

Run:
```bash
for c in $(docker ps -a --filter "label=kg.vibe.role=workspace" --format '{{.Names}}'); do
  echo "recreate $c"; docker rm -f "$c"
done
# контейнеры пересоздадутся при следующем входе ученика (dockerStart→dockerCreate);
# либо проактивно поднять каждому: node -e "import('./lib/students.js').then(m=>m.dockerStart('<user>'))"
```
Expected: контейнеры удалены; при следующем входе создаются с procps + bind `.vscode-server`.

---

## Phase 3 — Интеграция в панель

### Task 8: Модуль `lib/ssh-access.js`

**Files:**
- Create: `panel/lib/ssh-access.js`

- [ ] **Step 1: Написать модуль управления хост-юзерами**

```javascript
// Управление системными юзерами vibe-<user> для SSH-доступа учеников.
// Запускается из vibe-panel (User=root), поэтому useradd/chpasswd/userdel напрямую.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const SHELL = '/usr/local/sbin/vibe-ssh-enter';
const HOME_BASE = '/var/lib/vibe-ssh';
const SSH_HOST = 'vibe.kiselevgroup.com';
const SSH_PORT = 2222;

function hostUser(username) { return `vibe-${username}`; }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return r;
}

function userExists(hu) {
  return spawnSync('id', ['-u', hu], { encoding: 'utf8' }).status === 0;
}

// Идемпотентно: создаёт хост-юзера (заблокированного, без пароля). SSH заработает
// после setHostPassword. Безопасно звать повторно.
export function ensureHostUser(username) {
  const hu = hostUser(username);
  fs.mkdirSync(`${HOME_BASE}/${hu}`, { recursive: true });
  if (!userExists(hu)) {
    run('useradd', ['--no-create-home', '--home-dir', `${HOME_BASE}/${hu}`,
      '--shell', SHELL, '--groups', 'vibe-students', hu]);
    run('usermod', ['-L', hu]); // заблокирован, пока не задан пароль
  } else {
    run('usermod', ['--shell', SHELL, '--groups', 'vibe-students', hu]);
  }
}

// Ставит пароль (= пароль панели) и разблокирует учётку.
export function setHostPassword(username, password) {
  ensureHostUser(username);
  const hu = hostUser(username);
  const r = spawnSync('chpasswd', [], { input: `${hu}:${password}\n`, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`chpasswd failed: ${r.stderr}`);
}

export function removeHostUser(username) {
  const hu = hostUser(username);
  if (userExists(hu)) spawnSync('userdel', [hu]);
  fs.rmSync(`${HOME_BASE}/${hu}`, { recursive: true, force: true });
}

// Данные для UI: готовый ~/.ssh/config сниппет + deep-link базы.
export function sshConfig(username) {
  const hu = hostUser(username);
  return {
    host: SSH_HOST,
    port: SSH_PORT,
    user: hu,
    alias: hu,
    configSnippet:
      `Host ${hu}\n    HostName ${SSH_HOST}\n    Port ${SSH_PORT}\n    User ${hu}\n`,
    workspaceUri: `vscode://vscode-remote/ssh-remote+${hu}/home/student/workspace`,
    projectUriBase: `vscode://vscode-remote/ssh-remote+${hu}/home/student/workspace/`,
  };
}
```

- [ ] **Step 2: Smoke-проверка модуля**

Run:
```bash
cd /opt/vibe-portal/panel
node -e "import('./lib/ssh-access.js').then(m=>{m.ensureHostUser('sshtest'); m.setHostPassword('sshtest','Test123456'); console.log(JSON.stringify(m.sshConfig('sshtest'),null,2));})"
id vibe-sshtest && passwd -S vibe-sshtest
```
Expected: юзер `vibe-sshtest` в группе `vibe-students`, статус пароля `P` (password set), JSON с `configSnippet`/`workspaceUri`.

- [ ] **Step 3: Commit**

```bash
git add panel/lib/ssh-access.js
git commit -m "panel: lib/ssh-access — управление хост-юзерами SSH-доступа"
```

### Task 9: Подключить ssh-access в lifecycle ученика

**Files:**
- Modify: `panel/lib/students.js` (import + createStudent + setStudentPassword + deleteStudent)

- [ ] **Step 1: Импорт**

В начало `panel/lib/students.js` добавить:
```javascript
import { ensureHostUser, setHostPassword, removeHostUser } from './ssh-access.js';
```

- [ ] **Step 2: createStudent — завести хост-юзера с паролем**

В `createStudent` (после `htpasswdSet(username, password);`, до/после `dockerCreate`) добавить:
```javascript
  setHostPassword(username, password); // хост-юзер vibe-<user> + пароль = пароль панели
```

- [ ] **Step 3: setStudentPassword — синхронизировать пароль**

В `setStudentPassword` (после `htpasswdSet(username, password);`) добавить:
```javascript
  setHostPassword(username, password); // держим SSH-пароль в синхроне с панелью
```

- [ ] **Step 4: deleteStudent — удалить хост-юзера**

В `deleteStudent` (рядом с `htpasswdDelete(username)` / `dockerRemove`) добавить:
```javascript
  removeHostUser(username);
  fs.rmSync(`/data/config/vscode-server/${username}`, { recursive: true, force: true });
```

- [ ] **Step 5: Проверка полного цикла**

Run:
```bash
cd /opt/vibe-portal/panel
node -e "import('./lib/students.js').then(async m=>{await m.createStudent({username:'sshtmp',password:'Test123456'}); console.log('created'); m.setStudentPassword('sshtmp','New1234567'); console.log('pw-set'); await m.deleteStudent('sshtmp'); console.log('deleted');})"
id vibe-sshtmp 2>&1 | grep -q 'no such user' && echo "cleanup-ok"
```
Expected: `created`, `pw-set`, `deleted`, `cleanup-ok`.

- [ ] **Step 6: Commit**

```bash
git add panel/lib/students.js
git commit -m "panel: SSH-хост-юзер в create/setpw/delete ученика"
```

### Task 10: Роут `GET /api/ssh-config`

**Files:**
- Modify: `panel/server.js` (рядом с прочими `requireAuth`-роутами, напр. после `/api/me` или `/api/projects`)

- [ ] **Step 1: Импорт и роут**

В `panel/server.js` добавить импорт:
```javascript
import { sshConfig } from './lib/ssh-access.js';
```
И роут (user-gated):
```javascript
app.get('/api/ssh-config', requireAuth, (req, res) => {
  res.json(sshConfig(req.session.user));
});
```

- [ ] **Step 2: Проверка endpoint**

Run (через залогиненную сессию; либо временно дёрнуть функцию напрямую):
```bash
systemctl restart vibe-panel
curl -s -b /tmp/ck -c /tmp/ck -X POST http://127.0.0.1:3020/api/login \
  -H 'content-type: application/json' -d '{"username":"sshtest","password":"Test123456"}' >/dev/null
curl -s -b /tmp/ck http://127.0.0.1:3020/api/ssh-config | head
```
Expected: JSON с `configSnippet`, `workspaceUri`, `projectUriBase`.

- [ ] **Step 3: Commit**

```bash
git add panel/server.js
git commit -m "panel: GET /api/ssh-config — данные подключения по SSH"
```

### Task 11: UI — раздел «Подключение по SSH» + кнопки на проектах

**Files:**
- Modify: `panel/public/js/app.js` (рендер проектов ~`:580` + новый раздел)
- Modify: `panel/public/index.html` (пункт навигации/кнопка, по факту структуры)
- Modify: `panel/public/css/*` (минимальные стили, по факту)

- [ ] **Step 1: Загрузка ssh-config на старте приложения**

В `app.js`, где грузится `/api/me`/проекты, добавить однократный фетч и кэш:
```javascript
let sshCfg = null;
async function loadSshCfg() {
  if (!sshCfg) sshCfg = await api('/api/ssh-config');
  return sshCfg;
}
```

- [ ] **Step 2: Кнопка «Открыть в VS Code (десктоп)» на карточке проекта**

В функции рендера карточки проекта (около `app.js:580`, где формируется список `projects`) для каждого проекта `p` добавить кнопку-ссылку:
```javascript
// sshCfg.projectUriBase = vscode://vscode-remote/ssh-remote+vibe-<user>/home/student/workspace/
const vscodeUri = sshCfg
  ? sshCfg.projectUriBase + encodeURIComponent(p.name)
  : null;
// в HTML карточки:
//   ${vscodeUri ? `<a class="btn-vscode" href="${vscodeUri}">Открыть в VS Code (десктоп)</a>` : ''}
```
(Встроить в существующий шаблон карточки рядом с кнопками download/publish, следуя текущей разметке.)

- [ ] **Step 3: Раздел «Подключение по SSH»**

Добавить отдельный экран/модалку (по образцу существующих разделов «Материалы»/«Шаблоны») с содержимым:
```javascript
function renderSshHelp(cfg) {
  return `
    <h2>Подключение по SSH (десктопный VS Code)</h2>
    <ol class="ssh-steps">
      <li>Установите <b>VS Code</b> и расширение <b>«Remote - SSH»</b> (один раз).</li>
      <li>Вставьте это в файл <code>~/.ssh/config</code>:
        <pre id="ssh-snippet">${escapeHtml(cfg.configSnippet)}</pre>
        <button id="ssh-copy">Копировать</button>
      </li>
      <li>Нажмите «Открыть в VS Code» на нужном проекте или
        <a href="${cfg.workspaceUri}">открыть весь workspace</a>.
        Пароль — тот же, что для входа в портал.</li>
    </ol>`;
}
// обработчик #ssh-copy → navigator.clipboard.writeText(cfg.configSnippet)
```

- [ ] **Step 4: Кнопка «Открыть весь workspace»**

В том же разделе/в шапке списка проектов добавить ссылку `cfg.workspaceUri` (см. Step 3).

- [ ] **Step 5: Минимальные стили**

В css добавить классы `.btn-vscode`, `.ssh-steps`, `#ssh-snippet` в стиле существующих кнопок/блоков (тёмная тема IBM Plex Mono — переиспользовать существующие переменные/классы, не вводить новый визуальный язык).

- [ ] **Step 6: Ручная проверка в браузере**

Run: открыть https://vibe.kiselevgroup.com под `sshtest`, проверить:
- раздел «Подключение по SSH» показывает корректный сниппет с `vibe-sshtest`;
- кнопка «Копировать» работает;
- на карточке проекта есть «Открыть в VS Code (десктоп)» с корректным `vscode://…` URI;
- ссылка «весь workspace» корректна.

- [ ] **Step 7: Commit**

```bash
git add panel/public/js/app.js panel/public/index.html panel/public/css
git commit -m "panel UI: раздел «Подключение по SSH» + кнопки deep-link на проектах"
```

---

## Phase 4 — Бэкфилл существующих учеников и документация

### Task 12: Миграция существующих учеников

**Files:**
- Create: `scripts/migrate-ssh-students.sh`

- [ ] **Step 1: Скрипт миграции**

Структура `users-vibe.json` (сверено): `{ "users": { "<name>": { "role": "admin"|"user", ... } }, "ports": {...} }`. Миграция DRY — переиспользует `ensureHostUser` из `panel/lib/ssh-access.js` (создаёт заблокированного хост-юзера + базовую папку). Доп. создаём `.vscode-server`-папку.

```bash
#!/usr/bin/env bash
# Для каждого существующего ученика создаёт заблокированного хост-юзера vibe-<user>
# и папку .vscode-server. SSH заработает после того как админ задаст пароль через
# панель (POST /api/students/:u/password → setHostPassword разблокирует). Идемпотентно.
set -euo pipefail
node --input-type=module -e '
import { ensureHostUser } from "/opt/vibe-portal/panel/lib/ssh-access.js";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const u = require("/data/config/auth/users-vibe.json");
for (const name of Object.keys(u.users || {})) {
  if (u.users[name].role === "admin") continue;
  ensureHostUser(name);                       // useradd (locked) + /var/lib/vibe-ssh/vibe-<name>
  const vs = `/data/config/vscode-server/${name}`;
  fs.mkdirSync(vs, { recursive: true });
  fs.chownSync(vs, 1000, 1000);
  console.log("ensured vibe-" + name);
}
'
echo "migrate-ssh-students: done (задайте пароли через панель, чтобы включить вход)"
```

- [ ] **Step 2: Прогнать миграцию**

Run:
```bash
chmod +x scripts/migrate-ssh-students.sh
bash scripts/migrate-ssh-students.sh
getent group vibe-students
```
Expected: для каждого ученика есть `vibe-<user>` (заблокирован), папка `.vscode-server`.

- [ ] **Step 3: Включить одного реального ученика и проверить**

Через панель (admin) задать пароль ученику → проверить вход по SSH (как в Task 0 Step 8, но реальным учеником).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-ssh-students.sh
git commit -m "ssh: миграция хост-юзеров для существующих учеников (включение по смене пароля)"
```

### Task 13: Документация

**Files:**
- Modify: `CLAUDE.md` (раздел сервисов/портов/архитектуры)

- [ ] **Step 1: Описать новый доступ в CLAUDE.md**

Добавить:
- в таблицу сервисов — `vibe-sshd.service` (отдельный sshd :2222, вход учеников в свой контейнер);
- в таблицу портов — `2222 (0.0.0.0) — vibe-sshd, AllowGroups vibe-students, форвардинг выкл`;
- короткий раздел «Десктопный VS Code по SSH»: поток входа, три барьера изоляции, что пароль = пароль панели, что fail2ban на 2222, ссылку на спеку/план;
- упомянуть `procps` в образе и bind `.vscode-server`;
- отметить, что `fail2ban` установлен (вне репо);
- бэкап: `/data/config/vscode-server/*` лежит вне `/opt/vibe-portal`, в снапшот vibe-portal не попадает (раздувания нет); зафиксировать это как осознанное решение.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — десктопный VS Code по SSH (vibe-sshd :2222, изоляция, онбординг)"
```

---

## Финальная приёмка (E2E)

- [ ] Реальный ученик с ноута: `~/.ssh/config` из панели + пароль панели → десктопный VS Code открывает проект; виден только его workspace; терминал = `student@<container>`; `claude` отвечает и пишется в аудит (проверить `/logs.html`).
- [ ] Изоляция: попытка `-L` форварда → отбита; контейнер→хост:2222 → blocked; чужой контейнер указать нельзя.
- [ ] code-server (браузер) работает параллельно.
- [ ] Смена пароля в панели → новый пароль работает в SSH; удаление ученика → хост-юзер и `.vscode-server` удалены.
- [ ] Админский sshd `:22` не затронут на всём протяжении.

## Откат

```bash
systemctl disable --now vibe-sshd.service        # закрыть :2222
# ученики возвращаются к браузерному code-server без потерь;
# контейнеры/workspace не затронуты. Хост-юзеры можно оставить (заблокированы).
```
