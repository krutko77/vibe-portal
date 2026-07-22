# Состояние проекта

_Обновляется командой `/end` (или `/log`) в конце сессии/шага. Последнее обновление: 2026-07-22._

## Где мы сейчас

- HOME разведён по ролям (admin=`/home/my_workspace`,
  ученик=`/home/student/workspace`) — см. CLAUDE.md, «HOME по роли».
  Правка `vibe-entrypoint.sh` (`HOME=$HOME` в `SetEnv` конфига sshd, чтобы
  десктопный VS Code по SSH тоже видел верный HOME) закоммичена этим снимком.
- Untracked `.bak-*` файлы (остатки вчерашней миграции) проверены построчно
  и удалены — все были точными пре-правочными копиями уже закоммиченных
  изменений, ничего не потеряно.
- Добавлена инфраструктура журналирования сессий: команды `/end`, `/log`,
  `/decision`, `/handoff` (`.claude/commands/`, источник — репозиторий
  ученика курса krutko77, содержимое проверено перед установкой) +
  `docs/state.md`, `changelog.md`, `last-session.md`, `handoff.md`,
  `decisions.md`, `scripts/snapshot.sh` (`git add -A && git commit`).
- Добавлен скилл `chat-history` (`.claude/skills/chat-history/`) — экспорт
  диалогов Claude Code этого проекта в `.claude/chat-history/*.md`
  (гитигнорится, личный рабочий лог).
- Изоляция iptables между контейнерами учеников **починена** (2026-07-22):
  `setup-iptables.sh` больше не хардкодит `br-vibe`, вычисляет реальное имя
  моста динамически из `docker network inspect vibe-net` — см.
  `docs/decisions.md` D-003. Проверено практически на `vibe-krutko77`.

## Сейчас в работе

Активной незавершённой работы нет.

## Следующие шаги

1. Обкатать новые команды (`/log`, `/decision`, `/handoff`) в реальной работе.
