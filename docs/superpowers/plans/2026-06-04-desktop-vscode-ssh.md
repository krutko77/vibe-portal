# Десктопный VS Code по SSH — План реализации (v2: sshd-in-container + ключ)

> Переписан после спайка. Старая версия (host-gateway) — нерабочая, см. спеку §2.
> Спека: [../specs/2026-06-04-desktop-vscode-ssh-design.md](../specs/2026-06-04-desktop-vscode-ssh-design.md)

**Goal:** Ученик открывает свой workspace в десктопном VS Code по SSH-ключу; sshd живёт внутри его контейнера; claude через шим; изоляция сохранена.

**Среда:** боевой сервер, in-place в `/opt/vibe-portal`. Тестовый стенд `vibe-sshtest` (контейнер с sshd, порт 8422, ключ заказчика) — проверяем на нём. Коммит после каждого блока.

**Уже сделано спайком:** `openssh-server`+`procps` в образе (Dockerfile правлен, пересобран); подтверждено, что VS Code заходит по ключу, curve25519 обязателен, SetEnv нужен для claude.

---

## Task 1: Entrypoint контейнера (автостарт sshd + code-server)

**Files:** Create `workspace-image/vibe-entrypoint.sh`; Modify `workspace-image/Dockerfile` (COPY + CMD).

`vibe-entrypoint.sh` (PID 1 при `--init`):
```sh
#!/bin/sh
set -e
SSHD_DIR=/home/student/.sshd
mkdir -p "$SSHD_DIR"
# host-key: если персист-mount пуст — сгенерить (обычно панель кладёт заранее)
[ -f "$SSHD_DIR/ssh_host_ed25519_key" ] || ssh-keygen -q -t ed25519 -f "$SSHD_DIR/ssh_host_ed25519_key" -N ''
[ -f "$SSHD_DIR/authorized_keys" ] || : > "$SSHD_DIR/authorized_keys"
chmod 700 "$SSHD_DIR"; chmod 600 "$SSHD_DIR/ssh_host_ed25519_key" "$SSHD_DIR/authorized_keys" 2>/dev/null || true
cat > "$SSHD_DIR/sshd_config" <<EOF
Port 2222
HostKey $SSHD_DIR/ssh_host_ed25519_key
PidFile $SSHD_DIR/sshd.pid
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile $SSHD_DIR/authorized_keys
UsePAM no
StrictModes no
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256
AllowTcpForwarding yes
X11Forwarding no
PermitTunnel no
AllowAgentForwarding no
Subsystem sftp internal-sftp
SetEnv ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-http://172.30.0.1:8190} ANTHROPIC_AUTH_TOKEN=${ANTHROPIC_AUTH_TOKEN:-sk-vibe-shim-placeholder} CLAUDE_CODE_DISABLE_1M_CONTEXT=1
EOF
/usr/sbin/sshd -f "$SSHD_DIR/sshd_config" || echo "sshd start failed (non-fatal)" >&2
exec code-server /home/student/workspace
```
Dockerfile: `COPY vibe-entrypoint.sh /usr/local/bin/` (chmod +x), `CMD ["/usr/local/bin/vibe-entrypoint.sh"]`.

**Verify (на стенде):** пересобрать образ; запустить контейнер с `--init` и mount `.sshd`; `docker exec` → `pgrep sshd`=1, `grep curve25519 ~/.sshd/sshd_config`. Зомби не копятся при живом sshd.

**Commit:** `image: entrypoint — автостарт sshd (curve25519+SetEnv) внутри контейнера`.

## Task 2: `panel/lib/ssh-access.js` (ключи, заново под pubkey)

**Files:** Create `panel/lib/ssh-access.js` (старую host-user-версию НЕ используем).

Функции (всё от root, панель уже root):
- `sshDir(user)` = `/data/config/ssh/<user>`.
- `ensureKeys(user)`: idempotent — если нет, `ssh-keygen -t ed25519 -f <dir>/id_ed25519 -N ''` (приватный+публичный), `ssh-keygen -t ed25519 -f <dir>/ssh_host_ed25519_key -N ''` (host-key); записать `<dir>/authorized_keys` = содержимое `id_ed25519.pub`; `chown -R 1000:1000 <dir>` (sshd в контейнере = uid1000 читает); chmod 700 dir, 600 файлы.
- `regenerateKeys(user)`: удалить id_ed25519* + authorized_keys, заново `ensureKeys` (host-key НЕ трогаем, чтобы отпечаток не менялся).
- `removeKeys(user)`: `rm -rf <dir>`.
- `privateKey(user)` → строка приватника (для download).
- `hostPublicKey(user)` → содержимое `ssh_host_ed25519_key.pub` (для known_hosts).
- `sshConfig(user, sshPort)` → `{ host, port, user:'student', alias:`vibe-${user}`, configSnippet, knownHostsLine, workspaceUri, projectUriBase }`.
  - configSnippet: `Host vibe-<user>\n HostName vibe.kiselevgroup.com\n Port <sshPort>\n User student\n IdentityFile ~/.ssh/vibe-<user>\n`.
  - knownHostsLine: `[vibe.kiselevgroup.com]:<sshPort> <hostPublicKey>`.
  - workspaceUri: `vscode://vscode-remote/ssh-remote+vibe-<user>/home/student/workspace`.

**Verify:** `node -e` ensureKeys('sshtest') → файлы есть, владелец 1000, authorized_keys = pub.

**Commit:** `panel: lib/ssh-access — генерация SSH-ключей ученика (pubkey-доступ)`.

## Task 3: students.js — порт, маунты, init, lifecycle

**Files:** Modify `panel/lib/students.js`.

- `allocatePort` уже есть для code-server (8200+). Добавить параллельную аллокацию SSH-порта `8400+` (поле `sshPort` в users-vibe.json; функция `allocateSshPort(state)` по аналогии).
- `dockerCreate(username, port, sshPort)`:
  - `HostConfig.Init = true` (tini, reaping).
  - `PortBindings`: оставить `8080→127.0.0.1:port` (code-server) + добавить `2222/tcp → 0.0.0.0:<sshPort>`.
  - `ExposedPorts`: добавить `2222/tcp`.
  - `Binds`: добавить `/data/config/ssh/<user>:/home/student/.sshd:rw` и `/data/config/vscode-server/<user>:/home/student/.vscode-server:rw`.
  - (CMD уже из образа — entrypoint.)
- `createStudent`: до `dockerCreate` — `ensureKeys(username)`, `allocateSshPort`, `mkdir` vscode-server dir (chown 1000). Сохранить `sshPort` в users-vibe.json.
- `deleteStudent`: `removeKeys(username)`, удалить vscode-server dir, освободить порт.

**Verify:** пересоздать `vibe-sshtest` через панельный путь → `docker port` отдаёт `8400X→2222`; mount `.sshd` есть; ключ заказчика всё ещё пускает (или перевыпуск).

**Commit:** `panel: students.js — sshPort, публикация 2222, mount .sshd/.vscode-server, Init, ключи в lifecycle`.

## Task 4: API — выдача ключа/конфига

**Files:** Modify `panel/server.js`.

- `GET /api/ssh-config` (requireAuth) → `sshConfig(user, user.sshPort)`.
- `GET /api/ssh-key` (requireAuth) → `Content-Disposition: attachment; filename=vibe-<user>` + тело = `privateKey(user)`.
- `POST /api/ssh-key/regenerate` (requireAuth) → `regenerateKeys(user)`; обновить authorized_keys в живом контейнере (`docker exec` или просто перезаписан mount — sshd перечитывает authorized_keys на каждый коннект, рестарт не нужен).
- (admin) перевыпуск для ученика — опционально.

**Verify:** curl с сессией → `/api/ssh-config` отдаёт JSON; `/api/ssh-key` отдаёт приватник.

**Commit:** `panel: API /api/ssh-config, /api/ssh-key(+regenerate)`.

## Task 5: UI — раздел SSH + deep-links

**Files:** Modify `panel/public/js/app.js` (+ html/css по факту).

- Раздел «Подключение по SSH (десктоп)»: шаги (поставить VS Code+Remote-SSH), кнопки «Скачать ключ» (`/api/ssh-key`), «Скопировать конфиг» (configSnippet), подсказка про known_hosts, кнопка «перевыпустить ключ».
- На карточке проекта — кнопка «Открыть в VS Code (десктоп)» → `projectUriBase + encodeURIComponent(name)`.
- Кнопка «Открыть весь workspace» → workspaceUri.

**Verify:** в браузере под sshtest — раздел показывает корректный порт/алиас; ключ скачивается; deep-link корректный.

**Commit:** `panel UI: раздел «Подключение по SSH» + deep-links на проектах`.

## Task 6: idle-reaper учитывает SSH

**Files:** Modify reaper (в `panel/lib/*` — найти где `IDLE_STOP_MIN`/`docker stop`).

Перед `docker stop` ученика: проверить активные SSH-соединения на его `sshPort`
(host-side `ss -tnH state established "sport = :<sshPort>"` → если есть, не усыплять;
обновить lastActivityAt). 

**Verify:** держать SSH-сессию открытой дольше idle-порога → контейнер не усыпляется.

**Commit:** `panel: idle-reaper не усыпляет контейнер с активной SSH-сессией`.

## Task 7: Предустановка расширений (Claude Code и др.)

**Files:** образ/entrypoint или выдаваемый конфиг.

Вариант A: положить нужные `.vsix`/папки в `.vscode-server/extensions` контейнера
(через образ или entrypoint, скачав по commit). Вариант B: `remote.SSH.defaultExtensions`
в выдаваемом `~/.ssh/config`-бандле/инструкции. Сначала проверить (Открытый вопрос §8.1):
работает ли расширение Claude Code через SetEnv-шим без личного логина; если нет —
расширение не предустанавливать, оставить CLI-claude (терминал, уже аудируется).

**Verify:** на стенде расширение Claude Code заходит через шим без личного логина (или решение CLI-only).

**Commit:** `image: предустановка расширений для desktop VS Code` (или решение и заметка).

## Task 8: Раскатка, чистка host-gateway, docs

- Раскатать: пересобрать образ (готов), recreate контейнеров учеников (`.ssh`/`.vscode-server` на mount — безопасно).
- **Удалить мёртвый host-gateway** с сервера: kill temp `vibe-sshd` :2222, `rm` `/usr/local/sbin/vibe-ssh-enter` `vibe-docker-enter` `/etc/sudoers.d/vibe-ssh` `/etc/ssh/vibe-sshd_config` `/etc/ssh/vibe_ssh_host_ed25519_key*`, `userdel vibe-sshtest`, `rm -rf /var/lib/vibe-ssh`. (Скрипты `scripts/vibe-ssh-enter` и т.п. из репо — удалить, они от первой версии.)
- `CLAUDE.md`: новый раздел (sshd в контейнере, порты 8400-8499, curve25519, SetEnv, выдача ключа, reaper SSH-aware, code-server остаётся).

**Commit:** по шагам.

## Финальная приёмка
- Заказчик: скачал ключ+конфиг из панели (не вручную) → desktop VS Code открыл проект по deep-link без пароля; workspace только свой; `claude` через шим в аудите.
- Перевыпуск ключа → старый не пускает. Удаление ученика → порт/ключи освобождены.
- code-server (браузер) работает. Админский :22 не затронут.
