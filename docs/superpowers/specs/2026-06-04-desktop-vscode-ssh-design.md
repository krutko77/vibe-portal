# Десктопный VS Code по SSH (Remote-SSH) — дизайн

**Дата:** 2026-06-04
**Проект:** vibe-portal
**Статус:** дизайн согласован, готов к плану реализации

## 1. Цель

Дать ученикам курса возможность работать в **нативном (десктопном) VS Code**
на своём компьютере, подключаясь по **SSH (логин/пароль)** прямо в свой
workspace на сервере. Окно/редактор — у ученика на ноуте; файлы, терминал,
запуск кода и Claude — по-прежнему на сервере, внутри его docker-контейнера
`vibe-<user>`. Это прямая альтернатива «браузерному» code-server, а не замена.

Подзадачи из запроса:
- каждый **проект** открывается своей ссылкой (deep link) сразу в нужной папке;
- есть ссылка на **весь workspace**;
- вход **по тому же логину/паролю**, что в панели;
- **контейнеры безопасны: ученик видит и читает только своё.**

## 2. Не-цели (YAGNI)

- НЕ заменяем code-server (браузер) — он остаётся как запасной вход.
- НЕ делаем SSH-ключи — вход по паролю (по требованию заказчика).
- НЕ используем встроенный проброс портов VS Code (форвардинг намеренно
  выключен ради безопасности; превью приложений — через существующую
  публикацию `/<user>/<project>/`).
- НЕ выносим компиляцию/запуск на ноут ученика — всё исполняется на сервере.

## 3. Модель угроз и гарантии изоляции (ключевое)

Требование: **ученик читает только своё, контейнеры безопасны.** Обеспечивается
тремя независимыми барьерами — даже при отказе одного остальные держат:

1. **Привязка к собственному контейнеру.** Хелпер `vibe-docker-enter`
   определяет целевой контейнер из `$SUDO_USER` (его проставляет root при
   `sudo`, ученик подменить не может), а НЕ из аргументов, которые передаёт
   клиент. Указать чужой контейнер невозможно в принципе.
2. **Контейнер монтирует только свой workspace.** `vibe-<user>` биндит
   `/data/vibe-students/<user>` (rw), шаблоны и расширения — read-only. Чужих
   файлов в ФС контейнера физически нет. Это свойство уже существует и не
   меняется.
3. **Сетевая изоляция.** iptables (VIBE-FILTER/VIBE-INPUT) + выключенный
   SSH-форвардинг: с ноута нельзя туннелировать в хост-сеть, в шим, в чужой
   контейнер или в RFC1918.

Дополнительно:
- Системный юзер ученика на хосте — **без интерактивного шелла** (login-shell =
  скрипт-обёртка), **без `sudo`** (кроме одной строго ограниченной команды),
  **не в группе `docker`** (иначе доступ к docker-сокету = root на хосте).
- Контейнер **не меняет посыл безопасности**: остаётся `User=student`,
  `CapDrop=ALL`, `no-new-privileges` (CLAUDE.md прямо требует это не ослаблять).
- Аудит диалогов сохраняется: `claude-cli` внутри контейнера по-прежнему ходит
  через шим (`ANTHROPIC_BASE_URL`), запись в transcripts не меняется.

## 4. Поток входа

```
ноут ученика (VS Code + расширение Remote-SSH)
  └─ ssh vibe-<user>@vibe.kiselevgroup.com -p 2222   (пароль = пароль панели)
       └─ vibe-sshd :2222  (отдельный sshd: AllowGroups vibe-students, форвардинг ВЫКЛ)
            └─ PAM проверяет пароль системного юзера vibe-<user>
                 └─ login-shell = /usr/local/sbin/vibe-ssh-enter
                      └─ exec sudo -n /usr/local/sbin/vibe-docker-enter [CMD]
                           └─ (root) docker exec -u student -w /home/student/workspace vibe-<user>
                                └─ VS Code server ставится ВНУТРИ контейнера
                                   терминал / файлы / claude-cli → всё на сервере
```

## 5. Компоненты

### 5.1. `vibe-sshd` — отдельный sshd на `:2222`

Отдельный инстанс (не трогаем админский sshd на `:22`), свой `systemd`-юнит и
конфиг в репозитории. Ключевые директивы конфига:

```
Port 2222
Protocol 2
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication yes        # на будущее, но основной путь — пароль
AllowGroups vibe-students       # пускаем только учеников
AllowTcpForwarding no           # ← закрывает туннель в хост/шим/чужие контейнеры
AllowAgentForwarding no
AllowStreamLocalForwarding no
GatewayPorts no
PermitTunnel no
X11Forwarding no
PermitUserEnvironment no
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 120
HostKey /etc/ssh/vibe_ssh_host_ed25519_key   # свои host-ключи
PidFile /run/vibe-sshd.pid
```

Юнит `vibe-sshd.service` (в `systemd/`): `ExecStart=/usr/sbin/sshd -D -f
/etc/ssh/vibe-sshd_config`. Host-ключи генерятся при установке (не в git).

**Firewall:** убедиться, что хостовый INPUT пускает tcp/2222 (на текущем сервере
host INPUT, похоже, открыт — проверить при реализации; при необходимости добавить
ACCEPT). Контейнеры до `:2222` хоста не дотянутся — VIBE-INPUT и так дропает
всё контейнер→хост, кроме шима.

### 5.2. Системные юзеры `vibe-<user>` на хосте

Заводит панель при создании ученика:

```
useradd --no-create-home --home-dir /var/lib/vibe-ssh/<user> \
        --shell /usr/local/sbin/vibe-ssh-enter \
        --groups vibe-students <hostuser>
# пароль = пароль панели:
echo "<hostuser>:<password>" | chpasswd
```

- Имя хост-юзера = имя контейнера = `vibe-<user>` (одно к одному, удобно для
  обёртки). Префикс `vibe-` исключает коллизии с системными юзерами.
- Home `/var/lib/vibe-ssh/<user>` (root:root, 0750, пустой) — нужен формально;
  ученик туда не попадает (обёртка сразу `exec`-ает в контейнер).
- Группа `vibe-students` создаётся один раз при установке.
- login-shell `vibe-ssh-enter` нужно добавить в `/etc/shells`, иначе sshd
  отвергнет сессию.

### 5.3. Скрипты-обёртки + sudoers (в репо, версионируются)

**`/usr/local/sbin/vibe-ssh-enter`** — login-shell ученика. sshd зовёт его как
`vibe-ssh-enter` (интерактив) или `vibe-ssh-enter -c "<команда>"`
(не-интерактив; VS Code шлёт свои bootstrap-команды именно так — это НЕ
`SSH_ORIGINAL_COMMAND`, т.к. ForceCommand не используется):

```sh
#!/bin/sh
# login-shell ученика. Без прямого доступа к docker (только через sudo-хелпер).
if [ "${1:-}" = "-c" ]; then
    exec sudo -n /usr/local/sbin/vibe-docker-enter "$2"
else
    exec sudo -n /usr/local/sbin/vibe-docker-enter
fi
```

**`/usr/local/sbin/vibe-docker-enter`** — запускается ТОЛЬКО от root через sudo
(см. правило ниже). Контейнер берётся из `$SUDO_USER`, не из аргументов:

```sh
#!/bin/sh
set -eu
user="${SUDO_USER:?no SUDO_USER}"        # vibe-<student>, проставлен root, не подделать
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

**sudoers drop-in** `/etc/sudoers.d/vibe-ssh` (в репо как `scripts/sudoers-vibe-ssh`):

```
%vibe-students ALL=(root) NOPASSWD: /usr/local/sbin/vibe-docker-enter
Defaults!/usr/local/sbin/vibe-docker-enter !requiretty
```

Так ученик НЕ в группе `docker`, прямого доступа к сокету нет; единственная
доступная привилегированная операция — войти в **свой** контейнер.

### 5.4. Образ `vibe-workspace`

- Добавить пакет **`procps`** (нужен `ps` для VS Code server). `tar`, `gzip`,
  `bash`, `curl` уже есть.
- Пересобрать образ; существующие контейнеры пересоздать (`.vscode-server`
  вынесен в bind — см. 5.5 — поэтому пересоздание безопасно). Новые получат при
  создании.

### 5.5. Персист `.vscode-server`

Добавить в `dockerCreate` bind:

```
/data/config/vscode-server/<user> : /home/student/.vscode-server : rw
```

Папку создаёт панель при создании ученика (chown 1000:1000). Сохраняет
установленный VS Code server между пересозданиями контейнера → быстрые
переподключения, не качает сервер заново.

### 5.6. Панель (`panel/lib/students.js` + API + UI)

**`students.js`:**
- `createStudent` → дополнительно: `useradd` + `chpasswd` + создать
  `/var/lib/vibe-ssh/<user>` и `/data/config/vscode-server/<user>`; в
  `dockerCreate` добавить bind `.vscode-server`.
- `setStudentPassword` → дополнительно `chpasswd` для `vibe-<user>` (держим
  пароль SSH в синхроне с панелью).
- `deleteStudent` → `userdel <hostuser>` + удалить bind-папку и
  `/var/lib/vibe-ssh/<user>`.
- Все вызовы идут от root (vibe-panel.service уже `User=root`) через
  `spawnSync`/`execFile`, аргументы — массивом (без shell-инъекций).

**Новый API:**
- `GET /api/ssh-config` (user) → отдаёт ученику данные подключения и готовый
  сниппет `~/.ssh/config`:
  ```
  Host vibe-<user>
      HostName vibe.kiselevgroup.com
      Port 2222
      User vibe-<user>
  ```

**UI:**
- Раздел/модалка **«Подключение по SSH (десктопный VS Code)»**:
  1) поставить VS Code + расширение «Remote - SSH» (один раз);
  2) кнопка «копировать» — сниппет `~/.ssh/config`;
  3) deep-link кнопки (см. ниже).
- На карточке каждого проекта — кнопка **«Открыть в VS Code (десктоп)»**:
  `vscode://vscode-remote/ssh-remote+vibe-<user>/home/student/workspace/<project>`
- Кнопка **«Открыть весь workspace»**:
  `vscode://vscode-remote/ssh-remote+vibe-<user>/home/student/workspace`

Важно по онбордингу: сначала сниппет в `~/.ssh/config`, потом ссылки (иначе
VS Code не разрешит alias `vibe-<user>`).

### 5.7. fail2ban

Поставить `fail2ban`, jail на `vibe-sshd` (или общий sshd-jail с учётом
журнала `vibe-sshd`). Публичный парольный порт без rate-limit оставлять нельзя.

## 6. Онбординг ученика (итог)

1. Установить VS Code + расширение «Remote - SSH» (один раз).
2. В панели → «Подключение по SSH» → скопировать сниппет в `~/.ssh/config`.
3. Нажать на ссылку проекта → VS Code открывается → ввод пароля (как в панели)
   → ученик в папке проекта на сервере.

## 7. Список изменяемых/новых файлов

Новые:
- `systemd/vibe-sshd.service`
- `ssh/vibe-sshd_config` (или `config/vibe-sshd_config`)
- `scripts/vibe-ssh-enter`
- `scripts/vibe-docker-enter`
- `scripts/sudoers-vibe-ssh`
- (опц.) `scripts/setup-ssh-access.sh` — установщик: группа, шелл в
  `/etc/shells`, копирование скриптов/sudoers/юнита, host-ключи, fail2ban.

Изменяемые:
- `workspace-image/Dockerfile` — `procps`.
- `panel/lib/students.js` — useradd/chpasswd/userdel, bind `.vscode-server`.
- `panel/server.js` — роут `GET /api/ssh-config`.
- `panel/public/*` — UI (раздел SSH, кнопки deep-link на проектах).
- `CLAUDE.md` — описать новый способ доступа, порт 2222, сервис `vibe-sshd`.

## 8. Риски и открытые вопросы

1. **(Главный риск) Remote-SSH через `docker exec` как login-shell.** Нужен
   ранний прототип: проверить, что VS Code Remote-SSH успешно ставит и
   запускает свой server внутри контейнера через обёртку (semantics `-c CMD`,
   tty, sudo сбрасывает env — bootstrap идёт строкой команды, не через env).
   Если всплывут проблемы — запасной путь: ForceCommand + `SSH_ORIGINAL_COMMAND`
   вместо login-shell.
2. **Бэкфилл существующих учеников.** Для уже заведённых нужно один раз создать
   хост-юзеров (скрипт-миграция, проходит по `users-vibe.json`). Пароли у
   существующих в открытом виде недоступны (только bcrypt в htpasswd) → им
   придётся задать пароль заново через `setStudentPassword`, либо принять, что
   SSH-доступ включается при следующей смене пароля. Решить при планировании.
3. **Firewall 2222** — проверить хостовый INPUT, при необходимости открыть.
4. **Бэкап:** `/data/config/vscode-server/*` может быть объёмным — убедиться,
   что не раздувает rsync-снапшот (при необходимости добавить в исключения, как
   `node_modules`).

## 9. Приёмка (E2E)

- Ученик с ноута по сниппету `~/.ssh/config` + паролю панели открывает проект в
  десктопном VS Code; виден только его workspace; терминал работает; `claude`
  внутри отвечает и пишется в аудит.
- Проверка изоляции: попытка указать чужой контейнер/туннелировать в шим/хост —
  отбивается (барьеры из §3).
- code-server (браузер) продолжает работать параллельно.
- Смена пароля в панели → новый пароль работает и в SSH; удаление ученика →
  хост-юзер и папки удалены.

## 10. Откат

Способ аддитивный: выключить `vibe-sshd.service` (и закрыть 2222) — ученики
возвращаются к браузерному code-server без потерь. Контейнеры и workspace не
затронуты.
