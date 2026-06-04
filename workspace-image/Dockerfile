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
        locales \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# code-server (тот же что на dev-портале)
RUN curl -fsSL https://code-server.dev/install.sh | sh

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Non-root ученик
RUN useradd -m -u 1000 -s /bin/bash student \
    && mkdir -p /home/student/workspace /home/student/templates /home/student/.claude \
    && chown -R student:student /home/student

USER student
WORKDIR /home/student/workspace

# Дефолтные настройки code-server: без auth (gate через nginx auth_request),
# без телеметрии, отключаем встроенный update-check.
RUN mkdir -p /home/student/.config/code-server && \
    printf 'bind-addr: 0.0.0.0:8080\nauth: none\ncert: false\ndisable-telemetry: true\ndisable-update-check: true\n' \
        > /home/student/.config/code-server/config.yaml

EXPOSE 8080

# claude-cli заберёт ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN из окружения
# (выставляются при docker run, см. vibe-panel lifecycle).
CMD ["code-server", "/home/student/workspace"]
