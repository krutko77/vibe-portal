# Десктопный VS Code по SSH (Remote-SSH) — дизайн

**Дата:** 2026-06-04 (переписано после спайка)
**Проект:** vibe-portal
**Статус:** архитектура подтверждена спайком (реальный VS Code подключается), готов к реализации

## 1. Цель

Ученики работают в **нативном (десктопном) VS Code** на своём компьютере,
подключаясь по **SSH** прямо в свой workspace на сервере (Remote-SSH), вместо
браузерного code-server. Окно/редактор у ученика на ноуте; файлы, терминал,
запуск кода и Claude — на сервере, в его контейнере. code-server (браузер)
остаётся как запасной вход.

Подзадачи: каждый **проект** открывается своей ссылкой (deep link); есть ссылка
на весь **workspace**; вход безопасный; **ученик видит/читает только своё**.

## 2. Главный вывод спайка (почему НЕ host-gateway)

Первая версия дизайна — «SSH-шлюз на хосте → `docker exec` в контейнер» —
**не работает с VS Code Remote-SSH**. VS Code обязательно открывает
порт-форвардинг (`direct-tcpip`) к своему серверу. При sshd на хосте форвардинг
резолвится в сетевом namespace **хоста**, а server VS Code живёт в namespace
**контейнера** — туннель физически не дотягивается. Никакие клиентские настройки
(`useLocalServer`/`useExecServer`/`enableDynamicForwarding`) это не лечат
(проверено: VS Code всё равно открывает `direct-tcpip`, который `AllowTcpForwarding no`
рубит → `ECONNRESET`).

**Вывод:** sshd должен жить в том же namespace, что и server VS Code — то есть
**внутри контейнера**. Тогда форвардинг VS Code остаётся внутри контейнера и
работает нативно, без клиентских настроек.

## 3. Итоговая архитектура: sshd ВНУТРИ контейнера + SSH-ключ

```
ноут (VS Code + Remote-SSH)
  └─ ssh -i <ключ> student@vibe.kiselevgroup.com -p <sshPort>
       └─ docker port <sshPort> → контейнер vibe-<user> :2222
            └─ sshd ВНУТРИ контейнера (от student, non-root, pubkey)
                 └─ сразу /home/student/workspace; VS Code server тут же,
                    форвардинг в namespace контейнера → работает.
                    claude-cli → шим (через SetEnv) → аудит цел.
```

### Почему ключ, а не пароль
sshd внутри контейнера для **пароля** требует root (PAM/shadow/privsep) →
ослабление изоляции (CapDrop=ALL/no-root). По **ключу** sshd работает от
`student` (non-root), изоляция полностью сохраняется. Заказчик выбрал ключ.
Ученику ключ генерит **панель** (он скачивает готовый файл), сам `ssh-keygen`
не запускает — для него это «скачал файл один раз», на коннекте пароль не
вводит.

## 4. Модель угроз / изоляция (ученик читает только своё)

Тремя барьерами, как и раньше:
1. **Свой контейнер.** Ученик коннектится на свой `sshPort` → свой контейнер
   `vibe-<user>`, в котором примонтирован только его workspace
   (`/data/vibe-students/<user>`). Чужих файлов в ФС контейнера нет.
2. **Свой ключ.** В `authorized_keys` контейнера лежит только публичный ключ
   этого ученика (кладёт панель). Чужим ключом не зайти.
3. **Сетевая изоляция (без изменений).** iptables: контейнер видит только
   шим + интернет, не видит хост/чужие контейнеры/RFC1918.

Дополнительно:
- sshd работает **от `student`, non-root**; `CapDrop=ALL`/`no-new-privileges`
  сохраняются — посыл безопасности контейнера не меняется (важно по CLAUDE.md).
- `AllowTcpForwarding yes` внутри контейнера **безопасен**: форвардинг ограничен
  namespace контейнера, который и так заперт iptables (только шим+интернет —
  ровно то, что ученик уже имеет через терминал). В хост/чужие контейнеры не
  дотянуться.
- Аудит: `claude-cli` (и расширение Claude Code) идут через шим благодаря
  `SetEnv ANTHROPIC_BASE_URL` в sshd — запись в transcripts как сейчас.

## 5. Компоненты

### 5.1. Образ `vibe-workspace:dev`
- Добавлены **`openssh-server`** (sshd) и **`procps`** (`ps`, нужен VS Code
  server). Рантайм-`apt` в контейнере невозможен (`CapDrop=ALL` ломает sandbox
  `_apt`) — всё только через образ. **СДЕЛАНО** (Dockerfile правлен, пересобран).
- Новый **entrypoint** (`/usr/local/bin/vibe-entrypoint.sh`): при старте
  готовит sshd-конфиг, запускает sshd (фон) и `exec code-server` (как сейчас).
  Контейнер запускается с docker `--init` (tini) → reaping зомби.

### 5.2. sshd внутри контейнера (конфиг — генерит entrypoint)
```
Port 2222
HostKey /home/student/.sshd/ssh_host_ed25519_key      # персист (mount)
PidFile /home/student/.sshd/sshd.pid
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile /home/student/.sshd/authorized_keys # панель пишет (mount)
UsePAM no
StrictModes no
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256
AllowTcpForwarding yes
X11Forwarding no
PermitTunnel no
AllowAgentForwarding no
Subsystem sftp internal-sftp
SetEnv ANTHROPIC_BASE_URL=http://172.30.0.1:8190 ANTHROPIC_AUTH_TOKEN=sk-vibe-shim-placeholder CLAUDE_CODE_DISABLE_1M_CONTEXT=1
```
- **`KexAlgorithms` curve25519 обязателен**: иначе OpenSSH 9.x (сервер) ↔
  OpenSSH 10.x (свежий macOS клиент) виснет на постквантовом KEX
  (`sntrup761x25519-sha512`) на `expecting NEWKEYS`.
- **`SetEnv`** доносит переменные шима до ВСЕХ сессий (терминал + VS Code server
  + расширение Claude Code) — иначе claude не наследует docker-env (sshd-сессия
  стартует с чистым окружением) и лезет напрямую в `api.anthropic.com`.

### 5.3. Персист `.sshd` и `.vscode-server`
Mount'ы в контейнер (панель создаёт папки, chown 1000):
- `/data/config/ssh/<user>` → `/home/student/.sshd` (host-key + authorized_keys;
  host-key персистит → у ученика не «меняется отпечаток» при пересоздании).
- `/data/config/vscode-server/<user>` → `/home/student/.vscode-server` (server
  VS Code не переустанавливается при пересоздании).

### 5.4. Публикация SSH-порта
Контейнерный `2222` публикуется на хост-порт `0.0.0.0:<sshPort>` (наружу, чтобы
ноут ученика дотянулся). Диапазон `8400-8499`, аллоцируется как `containerPort`,
хранится в `users-vibe.json` (`sshPort`). Firewall: host INPUT = ACCEPT (порт
открыт). Аналогия с code-server 820X, но code-server остаётся на 127.0.0.1, а
SSH — публично.

### 5.5. Ключи (панель)
- При создании ученика (и по кнопке «перевыпустить») панель генерит ed25519
  пару: приватный `→ /data/config/ssh/<user>/id_ed25519` (600, root), публичный
  `→ /data/config/ssh/<user>/authorized_keys` (600, uid 1000). Host-key тоже
  генерит панель один раз.
- `GET /api/ssh-key` (user) → отдаёт ученику приватный ключ файлом + сниппет
  `~/.ssh/config` + строку `known_hosts` (чтобы не было вопроса об отпечатке).
- Хранение приватника на сервере приемлемо: сервер и так полный владелец
  контейнера; зато ученику «скачал и работаешь».

### 5.6. Панель UI
- Раздел «Подключение по SSH (десктоп VS Code)»: поставить VS Code + Remote-SSH;
  кнопки «Скачать ключ» и «Скачать конфиг»; готовый блок `~/.ssh/config`:
  ```
  Host vibe-<user>
      HostName vibe.kiselevgroup.com
      Port <sshPort>
      User student
      IdentityFile ~/.ssh/vibe-<user>
  ```
- Deep-links: проект → `vscode://vscode-remote/ssh-remote+vibe-<user>/home/student/workspace/<project>`;
  весь workspace → `…/home/student/workspace`.
- **Предустановка расширений**: code-server и desktop VS Code хранят расширения
  в РАЗНЫХ папках, общий volume расширений на desktop не распространяется. Нужные
  расширения (Claude Code и курсовые) предустановить в `.vscode-server/extensions`
  контейнера (или через `remote.SSH.defaultExtensions` в выдаваемом конфиге).

### 5.7. idle-reaper учитывает SSH
Сейчас reaper душит контейнер по `lastActivityAt` из панели (browser heartbeat).
SSH-сессия heartbeat не шлёт → контейнер уснёт под живой сессией. Решение: reaper
перед `docker stop` проверяет наличие установленных соединений на `<sshPort>`
контейнера (`ss` на хосте по host-порту) и не усыпляет, если есть активный SSH.

## 6. Онбординг ученика
1. Поставить VS Code + расширение Remote-SSH (один раз).
2. В панели: «Скачать ключ» + «Скачать конфиг» → положить 2 файла в `~/.ssh/`.
3. Жмёт ссылку проекта → VS Code открывает его папку. Без пароля, без спец-настроек.

## 7. Файлы (новые/изменяемые)
Новые:
- `workspace-image/vibe-entrypoint.sh` (autostart sshd + code-server).
- `panel/lib/ssh-access.js` (генерация ключей, authorized_keys, ssh-config) —
  переписан с нуля под ключи (старая host-user-версия выброшена).
Изменяемые:
- `workspace-image/Dockerfile` — `openssh-server`,`procps` (СДЕЛАНО), COPY entrypoint, CMD.
- `panel/lib/students.js` — allocate sshPort, PortBindings 2222, mounts `.sshd`/`.vscode-server`, `Init:true`, вызовы ssh-access в create/delete.
- `panel/lib/` (reaper, где он живёт) — SSH-aware стоп.
- `panel/server.js` — `GET /api/ssh-key`, `GET /api/ssh-config`, deep-links данные.
- `panel/public/*` — UI раздел + кнопки.
- `CLAUDE.md` — новый способ доступа, порты 8400-8499, sshd в контейнере, KEX, SetEnv.

Удаляемое (мёртвый host-gateway из первой попытки, уже лежит на сервере):
- temp `vibe-sshd` :2222, `/usr/local/sbin/vibe-ssh-enter`, `vibe-docker-enter`,
  `/etc/sudoers.d/vibe-ssh`, host-user `vibe-sshtest`, `/var/lib/vibe-ssh`,
  `/etc/ssh/vibe-sshd_config` + host-key. План `*-desktop-vscode-ssh.md` (host-gateway) переписать.

## 8. Открытые вопросы
1. **Расширение Claude Code и авторизация.** Через `SetEnv` claude-CLI работает.
   Нужно проверить, что и расширение через тот же шим заходит БЕЗ личного логина
   (иначе — у учеников оставить CLI-only, расширение прятать). Запрет на личный
   вход критичен (иначе обход шима/аудита).
2. **Host-key trust.** Чтобы убрать вопрос об отпечатке у ученика — выдавать
   `known_hosts`-строку в бандле (панель знает host-key) или `StrictHostKeyChecking
   accept-new` в конфиге.
3. **Перевыпуск ключа / отзыв.** Кнопка перегенерации (старый ключ инвалидируется
   перезаписью authorized_keys).

## 9. Приёмка (E2E) — спайком уже подтверждено по сути
- Ученик скачивает ключ+конфиг из панели → desktop VS Code открывает его проект
  без пароля; виден только его workspace; терминал `student@<container>`; `claude`
  отвечает через шим и пишется в аудит.
- Изоляция: чужой контейнер/ключ — нельзя; форвардинг заперт namespace контейнера.
- code-server (браузер) работает параллельно.
- Смена/перевыпуск ключа в панели → старый перестаёт пускать; удаление ученика →
  ключи и порт освобождены.

## 10. Откат
Аддитивно: SSH — дополнительный вход. Не публиковать `sshPort` / не стартовать
sshd в entrypoint → ученики на браузерном code-server. Контейнеры/workspace целы.
