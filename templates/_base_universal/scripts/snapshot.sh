#!/usr/bin/env bash
# Снимок проекта в git — «коммитим всё, что произошло».
#
# Зачем: история проекта = история коммитов. Чтобы другая нейронка могла
# восстановить «что делали, где сейчас и куда идём», каждый осмысленный шаг
# должен оказаться в git вместе с обновлёнными docs/.
#
# Использование:
#   bash scripts/snapshot.sh "что сделали этим шагом"
#   npm run snapshot -- "что сделали"      # если добавлен в package.json
#
# Что делает:
#   1. Инициализирует git-репозиторий, если его ещё нет.
#   2. git add -A  (всё, кроме того что в .gitignore: .env, node_modules, data/)
#   3. Коммитит с твоим сообщением (+ датой).
#
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "Укажи сообщение: bash scripts/snapshot.sh \"что сделали\""
  exit 1
fi

# git-репозиторий: создаём при первом запуске
if [ ! -d .git ]; then
  echo "Первый снимок — инициализирую git…"
  git init -q
  git config user.name  >/dev/null 2>&1 || git config user.name  "vibe-student"
  git config user.email >/dev/null 2>&1 || git config user.email "student@vibe.local"
fi

git add -A

# Нечего коммитить — выходим без ошибки
if git diff --cached --quiet; then
  echo "Изменений нет — снимок не нужен."
  exit 0
fi

DATE="$(date +%Y-%m-%d)"
git commit -q -m "$MSG" -m "snapshot: $DATE"
echo "✓ Снимок сохранён: $MSG"
echo "  Вся история: git log --oneline"
