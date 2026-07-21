# vibe-workspace: code-server + claude-cli + Node для учеников курса.
# Запускается per-student. Без sudo, без host network, без privileged.

FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Базовые инструменты + Node 22 (NodeSource)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git \
        build-essential python3 python3-pip \
        sqlite3 \
        php-cli \
        psmisc \
        procps \
        openssh-server \
        locales \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# code-server (тот же что на dev-портале)
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Non-root ученик. HOME в /etc/passwd — только дефолт/фолбэк для образа
# (студенческий путь). Реальный HOME каждого контейнера задаётся ЯВНО через
# Env HOME=... в docker create (см. panel/lib/students.js dockerCreate() +
# lib/home-dir.js) — так admin (/home/my_workspace) и ученики
# (/home/student/workspace) разъезжаются на ОДНОМ образе. docker exec
# наследует Config.Env контейнера, поэтому и exec-сессии видят верный $HOME.
RUN useradd -m -u 1000 -d /home/student/workspace -s /bin/bash student \
    && mkdir -p /home/student/templates /home/student/.claude \
    && chown -R student:student /home/student \
    && mkdir -p /home/my_workspace \
    && chown -R student:student /home/my_workspace

USER student
WORKDIR /home/student/workspace

# Дефолтные настройки code-server (без auth, слушать 0.0.0.0) пишутся в рантайме
# vibe-entrypoint.sh (через $HOME), НЕ здесь: HOME — bind-mount хостового
# workspace, который перекрывает содержимое образа.

# Дефолтная модель claude-cli — sonnet (иначе claude-code по умолчанию берёт opus,
# ×5 дороже). Бейк в образ бесполезен (HOME — bind-mount, содержимое образа под
# ним не видно). Единственный источник — рантайм-хук panel/lib/students.js →
# ensureClaudeModelDefault() (выполняется при каждом старте контейнера).

EXPOSE 8080
EXPOSE 2222

# Entrypoint: поднимает sshd (десктопный VS Code по SSH) + exec code-server.
# Контейнер запускается с docker --init (tini) для reaping зомби — см. students.js.
USER root
COPY vibe-entrypoint.sh /usr/local/bin/vibe-entrypoint.sh
RUN chmod 0755 /usr/local/bin/vibe-entrypoint.sh
USER student

# claude-cli заберёт ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN из окружения
# (выставляются при docker run, см. vibe-panel lifecycle); sshd доносит их в
# SSH-сессии через SetEnv (см. vibe-entrypoint.sh).
CMD ["/usr/local/bin/vibe-entrypoint.sh"]
