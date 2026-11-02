#!/usr/bin/env bash
# Регулярная чистка диска: кэши + неиспользуемые версии VS Code server.
# Запускается таймером vibe-cleanup.timer (раз в неделю), можно руками.
#
#   cleanup-disk.sh            — чистить
#   cleanup-disk.sh --dry-run  — только показать, что было бы удалено
#
# Что чистится:
#   1. Старые версии VS Code server (десктопный VS Code по SSH) в
#      /data/vibe-students/*/.vscode-server и /data/config/vscode-server/*.
#      Оставляются: версии, у которых сейчас есть живой процесс, и
#      KEEP_VSCODE_VERSIONS самых свежих по mtime (по умолчанию 1).
#      Удалённая версия при следующем подключении скачается заново.
#   2. npm-кэш root (/root/.npm/_cacache) и учеников (<ws>/.npm/_cacache).
#   3. apt-кэш (apt-get clean).
#   4. journald — до JOURNAL_MAX (по умолчанию 200M).
#
# НЕ трогает: проекты, node_modules проектов, extensions VS Code, docker-образы,
# ядра, /data/config (кроме vscode-server/*/cli/servers).
set -euo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

KEEP_VSCODE_VERSIONS="${KEEP_VSCODE_VERSIONS:-1}"
JOURNAL_MAX="${JOURNAL_MAX:-200M}"
STUDENTS_DIR="${STUDENTS_DIR:-/data/vibe-students}"
VSCODE_CFG_DIR="${VSCODE_CFG_DIR:-/data/config/vscode-server}"

log() { echo "[cleanup] $*"; }
size() { du -sh "$1" 2>/dev/null | cut -f1; }

rmpath() {
  local p="$1"
  [[ -e "$p" ]] || return 0
  if (( DRY )); then log "would remove $p ($(size "$p"))"
  else log "remove $p ($(size "$p"))"; rm -rf -- "$p"; fi
}

log "start$( (( DRY )) && echo ' (dry-run)'); $(df -h / | awk 'NR==2{print "used "$3" / "$2" ("$5")"}')"

# --- 1. VS Code server -------------------------------------------------------
# Хэши коммитов, у которых сейчас есть процесс (видны с хоста, в т.ч. из контейнеров).
running="$(ps -eo args= | grep -oE '(Stable-|code-)[0-9a-f]{40}' | grep -oE '[0-9a-f]{40}' | sort -u || true)"

clean_vscode_dir() {
  local vs="$1" servers="$1/cli/servers"
  [[ -d "$servers" ]] || return 0

  # Версии по убыванию mtime.
  mapfile -t versions < <(ls -1dt "$servers"/Stable-* 2>/dev/null | xargs -r -n1 basename | sed 's/^Stable-//')
  (( ${#versions[@]} )) || return 0

  local keep=() i=0 h
  for h in "${versions[@]}"; do
    if (( i < KEEP_VSCODE_VERSIONS )) || grep -qx "$h" <<<"$running"; then keep+=("$h"); fi
    i=$((i + 1))
  done

  for h in "${versions[@]}"; do
    printf '%s\n' "${keep[@]}" | grep -qx "$h" || rmpath "$servers/Stable-$h"
  done
  # Одиночные бинари CLI code-<hash> рядом с cli/.
  local f
  for f in "$vs"/code-*; do
    [[ -f "$f" ]] || continue
    h="${f##*/code-}"
    printf '%s\n' "${keep[@]}" | grep -qx "$h" || rmpath "$f"
  done

  # lru.json — список известных CLI версий; приводим к оставшимся.
  if (( ! DRY )) && [[ -f "$servers/lru.json" ]]; then
    local owner; owner="$(stat -c %u:%g "$servers")"
    printf '%s\n' "${keep[@]}" | sed 's/^/Stable-/' \
      | node -e 'const a=require("fs").readFileSync(0,"utf8").trim().split("\n").filter(Boolean);process.stdout.write(JSON.stringify(a))' \
      > "$servers/lru.json"
    chown "$owner" "$servers/lru.json"
  fi
}

for vs in "$STUDENTS_DIR"/*/.vscode-server "$VSCODE_CFG_DIR"/*; do
  [[ -d "$vs" ]] && clean_vscode_dir "$vs"
done

# --- 2. npm-кэши -------------------------------------------------------------
rmpath /root/.npm/_cacache
for c in "$STUDENTS_DIR"/*/.npm/_cacache; do rmpath "$c"; done

# --- 3. apt ------------------------------------------------------------------
if (( DRY )); then log "would apt-get clean ($(size /var/cache/apt/archives))"
else apt-get clean; fi

# --- 4. journald -------------------------------------------------------------
if (( DRY )); then log "would journalctl --vacuum-size=$JOURNAL_MAX ($(journalctl --disk-usage | grep -oE '[0-9.]+[KMG]'))"
else journalctl --vacuum-size="$JOURNAL_MAX" 2>&1 | tail -1; fi

log "done; $(df -h / | awk 'NR==2{print "used "$3" / "$2" ("$5"), free "$4}')"
