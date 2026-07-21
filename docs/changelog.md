# Changelog сессий

Записи сверху вниз, новые — наверх. Пишется командой `/end`.

## 2026-07-21

- Завершение сессии через `/end`: удалены 14 untracked `.bak-*` файлов
  (проверены построчно — точные пре-правочные копии уже закоммиченных
  изменений), закоммичена правка `vibe-entrypoint.sh` (`HOME=$HOME` в
  `SetEnv` sshd) вместе со всей инфраструктурой журналирования сессий,
  добавленной за сессию.
- Добавлен скилл `chat-history` (`.claude/skills/chat-history/`) — экспорт
  истории сессий Claude Code в `.claude/chat-history/*.md` (гитигнорится).
- Добавлена команда `/end` (`.claude/commands/end.md`, источник — репозиторий
  ученика krutko77, адаптирована под структуру vibe-portal) + сопутствующая
  инфраструктура: `docs/state.md`, `docs/changelog.md`, `docs/last-session.md`,
  `docs/handoff.md`, `scripts/snapshot.sh`.
- Добавлены остальные команды из того же репозитория: `/decision`, `/handoff`,
  `/log` (`.claude/commands/{decision,handoff,log}.md`) — каждый файл прочитан
  перед установкой, см. `docs/decisions.md` → D-002. Под `/decision` создан
  `docs/decisions.md`.
