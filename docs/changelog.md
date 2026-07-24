# Changelog сессий

Записи сверху вниз, новые — наверх. Пишется командой `/end`.

## 2026-07-24

- Построен и введён в строй `deploy-service` (`172.30.0.1:8191`,
  `systemd/vibe-deploy.service`, код в `deploy-service/`) — узкий сервис по
  образцу `anthropic-shim`, позволяющий агентам в личных проектах admin'а
  (`/home/my_workspace`) деплоить на этот же хост (rsync+nginx+certbot+pm2)
  без выдачи root/sudo контейнерам. Повод: агент в `es-trans_repairs`
  попросил root на `201.51.4.183` — разбор показал, что это тот же хост,
  что держит vibe-portal, с уже живой прод-инфраструктурой личных сайтов
  admin'а. Владельца резолвит по source-IP контейнера (docker-лейбл
  `kg.vibe.student`, как в `shim/transcript.js`); домен ограничен
  `*.es-trans.ru`; iptables открывает только этот порт из `vibe-net`.
  Решения и отвергнутые альтернативы (root/sudo, `--privileged`) —
  `docs/decisions.md` D-004.
- Попутно найден и исправлен регресс: `HOST_PUBLIC_IP` в
  `scripts/setup-iptables.sh` был захардкожен на устаревший IP хоста —
  анти-NAT-loopback DROP молчал (тот же класс бага, что чинили в D-003).
  Теперь вычисляется динамически при каждом запуске.
- Реестр `/etc/vibe-deploy/registry.json` заполнен: 3 Node-проекта сразу
  (`es-trans_repairs`, `es-trans_orders-and-transportation`,
  `es-trans_tests-results`), затем ещё `es-trans-standard` (Node) и `a1track`
  (PHP/php-fpm — потребовал добавить в код новый `type:"php"`: rsync+chown
  вместо pm2, плюс поля `src_subdir`/`exclude` для исходника не в корне
  проекта и прод-секретов/рантайм-данных). Легаси-сайты сверялись по факту
  (`pm2 jlist`+`ss -ltnp`), не по именам — домены `test-1`/`test-2`
  оказались проксированы на процессы с обратными по интуиции именами.
  Решение и урок — `docs/decisions.md` D-005.
- Написана и закоммичена копируемая инструкция для агента в
  `es-trans_repairs` (`DEPLOY-INSTRUCTIONS-es-trans_repairs.txt` в корне
  репо; тот же текст опубликован отдельным HTML-артефактом с кнопками
  копирования, т.к. пользователь не мог скопировать текст из терминала
  через Ctrl+C).
- `CLAUDE.md` и `docs/expand_vibe-portal.md` (§ 12, новый) дополнены
  описанием deploy-service как опционального компонента для новых
  установок.

## 2026-07-22 (3)

- Включён HTTPS (самоподписанный сертификат) на голом IP `201.51.4.183` —
  убирает предупреждение "insecure context" у `/admin-code/`. Разведкой
  вскрыт факт, что реальный задеплоенный `/etc/nginx/sites-available/vibe`
  вообще не был под git (отдельный от `nginx/vibe.kiselevgroup.com` файл,
  разошёлся с репозиторием ещё 2026-06-27). Заведён в репозиторий как
  `nginx/201.51.4.183`: `:80` → редирект на `:443`, сертификат в
  `/etc/nginx/ssl/` (вне git), сохранён проброс WS-заголовков
  (Upgrade/Connection) для `/code/`/`/admin-code/` — Баг 5 (1006) не
  проявился при проверке. Добавлен раздел 8b в
  `docs/expand_vibe-portal.md`.

## 2026-07-22 (2)

- Написан `docs/expand_vibe-portal.md` — раннбук развёртывания vibe-portal
  с нуля на новом сервере (пакеты, сборка образа, `vibe-net`, секреты,
  systemd-юниты, nginx+certbot, бутстрап admin'а, смоук-тест изоляции).
  Явно отделён от несвязанного `new-server-setup.md` (проксмокс/железо).
- Попутно обнаружен рассинхрон `scripts/create-admin.sh` с текущим
  `students.js → dockerCreate()` (старые лимиты ресурсов, устаревший путь
  шаблонов, нет общих volume'ов/SSH-маунтов) — не исправлен, задокументирован
  как воркэраунд в раннбуке и как следующий шаг в `docs/state.md`.

## 2026-07-22

- Починена изоляция iptables между контейнерами учеников (D-003):
  `scripts/setup-iptables.sh` вычисляет имя bridge-интерфейса `vibe-net`
  динамически вместо хардкода `br-vibe` (реальное имя — `br-92be0fc90d9e`,
  генерится docker'ом из ID сети и не персистентно между ребутами).
  Применено через `vibe-iptables.service`, старые нерабочие hook-правила
  вручную сняты, проверено практически на `vibe-krutko77` (shim доступен,
  хостовые порты/публичный IP — задроплены, интернет — доступен).
  CLAUDE.md обновлён.

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
