#!/usr/bin/env bash
# Снимок состояния репозитория в git с заданным сообщением.
# Используется командой /end (.claude/commands/end.md) в конце сессии.
set -euo pipefail
cd "$(dirname "$0")/.."

msg="${1:-снимок сессии $(date +%F)}"

git add -A
if git diff --cached --quiet; then
  echo "Нечего коммитить."
  exit 0
fi

git commit -m "$msg"
