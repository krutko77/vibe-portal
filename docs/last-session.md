# Последняя сессия — 2026-07-21

## Кто работал
Kiselev Group (admin, host-сессия Claude Code в `/opt/vibe-portal`)

## Что было сделано
- Разобрались, на чём остановилась предыдущая сессия (незакоммиченный
  `vibe-entrypoint.sh`, untracked `.bak-*` файлы, открытый вопрос про
  bridge/iptables).
- Создан скилл `chat-history` — экспорт истории сессий Claude Code в
  читаемый Markdown (`.claude/chat-history/`, в gitignore).
- Установлены команды `/end`, `/log`, `/decision`, `/handoff` из репозитория
  ученика курса `krutko77/scills-claude` — каждый файл прочитан целиком и
  проверен на безопасность перед установкой. Под них создана инфраструктура:
  `docs/state.md`, `docs/changelog.md`, `docs/last-session.md`,
  `docs/handoff.md`, `docs/decisions.md`, `scripts/snapshot.sh`.
- Все 14 `.bak-*` файлов по репозиторию сверены с git-историей построчно и
  удалены — были точными копиями состояния до уже закоммиченных правок.
- Сессия завершена командой `/end`: снимок в git включает правку
  `vibe-entrypoint.sh` (`HOME=$HOME` в `SetEnv` sshd) и всю добавленную
  инфраструктуру.

## Ключевые решения
См. `docs/decisions.md`:
- D-001 — `chat-history` сделан проектным скиллом, не глобальным.
- D-002 — команды `/end`/`/decision`/`/handoff`/`/log` установлены из
  личного репозитория ученика курса после построчной проверки содержимого.

## На чём остановились
Сессия закрыта снимком в git; следующий вход начинается с чистого
рабочего дерева.

## Что делать следующему
1. Решить вопрос с bridge `br-vibe`/iptables-изоляцией (см. `docs/state.md`).
2. Обкатать `/log`, `/decision`, `/handoff` в реальной работе.

## Подводные камни
- `scripts/snapshot.sh` делает `git add -A` — перед каждым запуском
  `/end`/`/log`/`/handoff` стоит глянуть `git status`, чтобы не закоммитить
  что-то лишнее из untracked.
