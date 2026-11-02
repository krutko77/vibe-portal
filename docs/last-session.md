# Последняя сессия — 2026-11-02

## Кто работал
не указано

## Что было сделано
- Обследован диск хоста (24 ГБ, было 90%, 2.6 ГБ свободно): главные
  потребители — npm-кэш root 3.2 ГБ, 5 версий VS Code server у `krutko77`
  (~650 МБ каждая), устаревший `/data/config/vscode-server/krutko77` 998 МБ,
  Playwright-браузеры 656 МБ.
- Удалено: `/root/.npm/_cacache`, 4 старые версии
  `.vscode-server/cli/servers/Stable-*` и старые `code-*` (оставлена
  запущенная `Stable-2c33b50b…`, `lru.json` приведён к ней), apt-кэш.
- По явной просьбе пользователя удалены содержимое
  `/data/config/vscode-server/krutko77` (сама папка оставлена — это bind-mount
  контейнера) и `/data/vibe-students/krutko77/.cache/ms-playwright`.
- Итог: 53%, 11 ГБ свободно. Панель Timeweb сначала показывала старые 85% —
  сделан `fstrim -v /` (11 GiB), после этого панель обновилась.
- Написаны `scripts/cleanup-disk.sh` (`--dry-run`, env
  `KEEP_VSCODE_VERSIONS`/`JOURNAL_MAX`/`STUDENTS_DIR`/`VSCODE_CFG_DIR`) и
  `systemd/vibe-cleanup.{service,timer}` (вс 04:30). Проверено: dry-run на
  хосте + тест логики VS Code на фейковых каталогах в scratchpad.
  Задокументировано в `docs/expand_vibe-portal.md` §7. Коммит `f8de424`,
  запушен.

## Ключевые решения
- Оставлять VS Code server версии с живым процессом + 1 самую свежую по
  mtime: старые не нужны (VS Code обновляется только вперёд), при
  необходимости скачаются заново.
- Скрипт не трогает проекты, `node_modules` проектов, extensions, docker-образ
  (он в работе) и ядра (установлены только текущее и новое).
- Прежний запрет из handoff «не чистить `/data/config/vscode-server/krutko77`»
  снят — пользователь сам попросил удалить.

## На чём остановились
Место освобождено и подтверждено пользователем в панели Timeweb; скрипт чистки
в git, но таймер в systemd ещё не включён.

## Что делать следующему
1. Включить таймер (агенту запрещено классификатором разрешений):
   `cp /opt/vibe-portal/systemd/vibe-cleanup.{service,timer} /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now vibe-cleanup.timer`.
2. Разобраться с незакоммиченными `shim/server.js` и
   `shim/server.js.bak-before-auto-refresh-20261030` (висят с 30.10, не из
   этой сессии) — спросить пользователя, закоммитить или откатить.
3. Запушить `/end`-снимок (`git push origin master`) — `snapshot.sh` только
   коммитит.
4. Остальное — бэклог из `docs/state.md` «Следующие шаги».

## Подводные камни
- Панель Timeweb показывает заполнение диска с задержкой; истина — `df -h /`.
  Корень смонтирован с `discard`, `fstrim.timer` включён.
- `cleanup-disk.sh` при тесте с подменёнными `STUDENTS_DIR`/`VSCODE_CFG_DIR`
  всё равно выполняет реальные `apt-get clean`, `journalctl --vacuum` и
  чистит `/root/.npm/_cacache` — безопасно, но учитывать.
- Главный рост диска: новая версия VS Code server (~650 МБ) после каждого
  обновления десктопного VS Code и npm-кэш.
- Хост перезагрузился на ядро `6.8.0-147-generic`.
