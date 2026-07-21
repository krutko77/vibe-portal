#!/bin/sh
# Entrypoint контейнера ученика: поднимает sshd (для десктопного VS Code по SSH)
# ВНУТРИ контейнера, затем exec code-server (браузерный вход остаётся).
# Запускается от student (non-root); контейнер стартует с docker --init (tini)
# для reaping зомби. sshd авторизует ТОЛЬКО по ключу.
set -e

# NB: путь абсолютный намеренно, НЕ $HOME/.sshd — HOME студента это
# /home/my_workspace, а этот bind-mount (SSH-ключи) физически остаётся
# в /home/student/.sshd. Резолвинг через $HOME сломает поиск authorized_keys.
SSHD_DIR=/home/student/.sshd
mkdir -p "$SSHD_DIR"

# host-key и authorized_keys обычно кладёт панель в примонтированный /data/config/ssh/<user>.
# Фолбэк, если mount пуст (host-key сгенерится — но тогда у ученика поменяется отпечаток,
# поэтому в норме его создаёт панель заранее и переиспользует).
[ -f "$SSHD_DIR/ssh_host_ed25519_key" ] || ssh-keygen -q -t ed25519 -f "$SSHD_DIR/ssh_host_ed25519_key" -N ''
[ -f "$SSHD_DIR/authorized_keys" ] || : > "$SSHD_DIR/authorized_keys"
chmod 700 "$SSHD_DIR" 2>/dev/null || true
chmod 600 "$SSHD_DIR/ssh_host_ed25519_key" "$SSHD_DIR/authorized_keys" 2>/dev/null || true

# Конфиг sshd. curve25519 обязателен (иначе постквантовый KEX виснет между
# OpenSSH 9.x сервером и свежим macOS-клиентом 10.x). SetEnv доносит переменные
# шима до ВСЕХ сессий (терминал + VS Code server + расширение) — иначе claude
# не наследует docker-env и лезет напрямую в api.anthropic.com.
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
SetEnv HOME=$HOME ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-http://172.30.0.1:8190} ANTHROPIC_AUTH_TOKEN=${ANTHROPIC_AUTH_TOKEN:-sk-vibe-shim-placeholder} CLAUDE_CODE_DISABLE_1M_CONTEXT=1
EOF

# Поднять sshd (демонизируется сам); не валим контейнер, если не стартанул.
/usr/sbin/sshd -f "$SSHD_DIR/sshd_config" || echo "vibe-entrypoint: sshd start failed (non-fatal)" >&2

# Конфиг code-server. НЕ бейкается в образ — $HOME/.config живёт под
# $HOME (bind-mount хостового workspace ученика/админа, см. HOME=... в
# dockerCreate), который перекрывает содержимое образа. Без auth:none/
# bind-addr:0.0.0.0 code-server при первом старте на пустом volume сам генерит
# auth:password + bind 127.0.0.1 (secure-by-default) — и панель (проксирует по
# IP контейнера) до него не достучится.
mkdir -p "$HOME/.config/code-server"
printf 'bind-addr: 0.0.0.0:8080\nauth: none\ncert: false\ndisable-telemetry: true\ndisable-update-check: true\n' \
    > "$HOME/.config/code-server/config.yaml"

# Основной процесс — code-server (как и было).
exec code-server "$HOME"
