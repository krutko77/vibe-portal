#!/usr/bin/env bash
# Синхронизирует хостовый Claude OAuth-токен в vibe-shim'овский файл.
#
# Хост-Claude (моя сессия + keepalive-claude) сам ротейтит refresh-token,
# когда им пользуются. Vibe-shim читает creds один раз при старте,
# поэтому когда хост ротейтит RT, vibe'овский становится "осиротевшим".
#
# Решение: каждые N минут сверять mtime/sha. Если хостовые свежее —
# копируем в vibe-creds + рестартим shim (он подхватит новые токены).
#
# Запускается systemd-таймером sync-claude-creds.timer.

set -euo pipefail

HOST_CREDS=/root/.claude/.credentials.json
VIBE_CREDS=/data/config/auth/claude-vibe.credentials.json

if [ ! -f "$HOST_CREDS" ]; then
  echo "host creds missing: $HOST_CREDS" >&2
  exit 1
fi

# Используем sha256 для надёжного сравнения (mtime может прыгать)
host_sha=$(sha256sum "$HOST_CREDS" | cut -d' ' -f1)
vibe_sha=""
if [ -f "$VIBE_CREDS" ]; then
  vibe_sha=$(sha256sum "$VIBE_CREDS" | cut -d' ' -f1)
fi

if [ "$host_sha" = "$vibe_sha" ]; then
  exit 0   # уже синхронизировано
fi

# Сверим что хостовые тоже валидные (хотя бы JSON)
if ! jq -e '.claudeAiOauth.refreshToken' "$HOST_CREDS" >/dev/null 2>&1; then
  echo "host creds invalid JSON or no refreshToken — skipping" >&2
  exit 1
fi

# Атомарная замена + restart shim
tmp="${VIBE_CREDS}.tmp.$$"
cp "$HOST_CREDS" "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$VIBE_CREDS"

echo "creds synced (host sha=${host_sha:0:12}); restarting shim"
systemctl restart anthropic-shim
