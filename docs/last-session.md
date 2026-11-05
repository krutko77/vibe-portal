# Последняя сессия — 2026-11-05

## Кто работал
не указано

## Что было сделано
- Разобраны висевшие с 30.10 незакоммиченные `shim/server.js` +
  `.bak-before-auto-refresh-20261030`: рефреш OAuth-токена за 10 мин до
  истечения (было 1 мин) + фоновый `setInterval` раз в 5 мин. В бою с
  02.11, журнал без ошибок. Бэкап удалён, `CLAUDE.md` и раннбук §15
  обновлены — коммит `23ecf78`.
- Из GitHub установлены скиллы `.claude/skills/frontend-design/`
  (`anthropics/skills@ca45fc4`) и `.claude/skills/security-review-pr/`
  (`anthropics/claude-code-security-review@0c6a49f`; был command, по
  просьбе пользователя перенесён в skills). `git remote set-head origin
  master`. Коммиты `d366381`, `f892351`; промежуточный `/end` — `0ac75e0`.
- Ответы на вопросы пользователя (без правок кода):
  - `.claude/commands|skills` в `/opt/vibe-portal` действуют только на
    хостового Claude в этом репо; Claude в контейнере `vibe-krutko77` их
    не видит. Общие для всех проектов admin'а — в
    `/data/vibe-students/krutko77/.claude/` (`~/.claude` в контейнере),
    сейчас там пусто.
  - Хостовый Claude: расширение в admin code-server (`/admin-code/`,
    `vibe-admin-code`, root `/opt/vibe-portal`), бинарь
    `/root/.local/share/code-server/extensions/anthropic.claude-code-*`,
    CLI `/usr/bin/claude`, конфиг `/root/.claude/`. Ходит в Anthropic
    мимо шима.
  - Что такое шим: подмена фейкового ключа контейнера на реальный токен,
    рефреш, аудит диалогов, лимиты.

## Ключевые решения
- Command из `claude-code-security-review` переименован в
  `security-review-pr` (конфликт со встроенным `/security-review`) и
  перенесён в skills; Python-часть GitHub Action не ставилась.

## На чём остановились
Объяснил пользователю, что такое шим; всё закоммичено и запушено.

## Что делать следующему
1. После 2026-11-08 проверить первый прогон чистки:
   `journalctl -u vibe-cleanup --no-pager` и `df -h /`.
2. Если пользователь захочет скиллы/команды во всех своих проектах —
   скопировать в `/data/vibe-students/krutko77/.claude/{skills,commands}/`
   (chown 1000:1000); `/end` адаптировать под проекты без `docs/state.md`
   и `scripts/snapshot.sh`.
3. Остальное — бэклог `docs/state.md` «Следующие шаги».

## Подводные камни
- `/security-review-pr` диффает против `origin/HEAD` — после пуша
  проверять нечего; на свежем клоне сначала `git remote set-head origin master`.
- Правки `.claude/` хоста не влияют на Claude в контейнере, и наоборот.
- Агенту запрещено `systemctl enable` — такие шаги отдавать человеку.
