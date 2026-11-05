# Последняя сессия — 2026-11-05

## Кто работал
не указано

## Что было сделано
- Разобраны висевшие с 30.10 незакоммиченные `shim/server.js` +
  `shim/server.js.bak-before-auto-refresh-20261030`: рефреш OAuth-токена
  за 10 мин до истечения (было 1 мин) + фоновый `setInterval` раз в 5 мин.
  Шим уже работал на этом коде с рестарта 02.11; по журналу рефреши раз в
  ~7 ч 50 мин, ошибок нет, `/_shim/health` ok.
- Бэкап `.bak` (идентичен HEAD) удалён; `CLAUDE.md` (шим, п.5) и
  `docs/expand_vibe-portal.md` §15 обновлены; коммит `23ecf78`.
- Из GitHub установлены скиллы: `.claude/skills/frontend-design/`
  (`anthropics/skills@ca45fc4`) и `security-review-pr`
  (`anthropics/claude-code-security-review@0c6a49f`). Сначала положен в
  `.claude/commands/`, по просьбе пользователя перенесён в
  `.claude/skills/security-review-pr/SKILL.md` (добавлено `name:`).
- `git remote set-head origin master` — для команды нужен `origin/HEAD`.
- Раннбук §15 дополнен; коммиты `d366381`, `f892351`. Всё запушено.

## Ключевые решения
- Command из `claude-code-security-review` переименован в
  `security-review-pr`, чтобы не конфликтовать со встроенным
  `/security-review` (тексты почти совпадают). Python-часть GitHub Action
  не ставилась — нужна только команда.

## На чём остановились
Всё закоммичено и запушено, рабочее дерево чистое; следующее плановое
событие — первый прогон `vibe-cleanup.timer` в вс 2026-11-08 04:35.

## Что делать следующему
1. После 2026-11-08 проверить первый прогон чистки:
   `journalctl -u vibe-cleanup --no-pager` и `df -h /`.
2. Остальное — бэклог из `docs/state.md` «Следующие шаги» (живые проверки
   UI в браузере, ufw на Amsterdam и т.д.).

## Подводные камни
- `/security-review-pr` диффает против `origin/HEAD` — после `git push`
  проверять нечего; на свежем клоне сначала `git remote set-head origin master`.
- `shim/server.js` общий OAuth-файл с хостовым claude: таймер рефреша
  ротирует RT и для хостового claude (перечитывание по mtime это покрывает).
- Агенту запрещено `systemctl enable` — такие шаги отдавать человеку.
