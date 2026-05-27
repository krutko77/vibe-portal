#!/usr/bin/env bash
# Короткий вызов claude чтобы держать OAuth-токен на хосте свежим.
#
# Хост-Claude рефрешит access+refresh-токены через 401-механизм upstream'а
# api.anthropic.com, но только когда им активно пользуются. Если никто не
# логинится / не дёргает claude — токены протухают за 4 часа.
#
# Этот скрипт запускается systemd-таймером раз в 3 часа и делает
# минимальный prompt — что заставляет claude обновить токены при
# необходимости, не тратя много API.
#
# Дальше sync-claude-creds.sh подберёт обновлённые токены и нальёт
# их в vibe-shim.

set -euo pipefail

# Чтобы запрос был дёшев — без инструментов, через текст, минимум токенов
timeout 90 /usr/bin/claude \
  -p "ok" \
  --allowed-tools "" \
  --output-format text \
  --model sonnet >/dev/null 2>&1 || {
  echo "keepalive: claude call failed (rc=$?)" >&2
  exit 1
}

echo "keepalive ok"
