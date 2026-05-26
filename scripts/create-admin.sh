#!/usr/bin/env bash
# Создаёт первого admin'а vibe-портала без UI.
# Делает:
#   - htpasswd-vibe запись (bcrypt)
#   - users-vibe.json: role=admin + аллокация порта
#   - workspace папка с правами student (uid 1000)
#   - docker контейнер vibe-<username> (created, не started)
#
# usage: create-admin.sh <username> <password>

set -euo pipefail

USER="${1:-}"
PASS="${2:-}"

if [[ -z "$USER" || -z "$PASS" ]]; then
  echo "usage: $0 <username> <password>" >&2
  exit 1
fi

HTPASSWD=/data/config/auth/.htpasswd-vibe
USERS_JSON=/data/config/auth/users-vibe.json
STUDENTS_ROOT=/data/vibe-students
IMAGE=vibe-workspace:dev
NETWORK=vibe-net
TEMPLATES_DIR=/opt/dev-portal/templates
SHIM_BASE_URL=http://172.30.0.1:8190

mkdir -p "$(dirname "$HTPASSWD")" "$STUDENTS_ROOT"
touch "$HTPASSWD"

# htpasswd (bcrypt)
htpasswd -bB "$HTPASSWD" "$USER" "$PASS"

# users-vibe.json
if [[ ! -f "$USERS_JSON" ]]; then
  echo '{"users":{},"ports":{"nextFree":8200}}' > "$USERS_JSON"
fi

PORT=$(python3 - "$USERS_JSON" "$USER" <<'PY'
import json, sys
path, user = sys.argv[1], sys.argv[2]
st = json.load(open(path))
if user in st['users'] and st['users'][user].get('containerPort'):
    print(st['users'][user]['containerPort'])
else:
    used = {u.get('containerPort') for u in st['users'].values() if u.get('containerPort')}
    p = st['ports'].get('nextFree', 8200)
    while p in used: p += 1
    st['users'][user] = {
        'role': 'admin',
        'createdAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'containerPort': p,
        'lastActivityAt': None,
    }
    st['ports']['nextFree'] = p + 1
    json.dump(st, open(path, 'w'), indent=2)
    print(p)
PY
)

echo "[create-admin] assigned port $PORT"

# workspace
WS="$STUDENTS_ROOT/$USER"
mkdir -p "$WS"
chown 1000:1000 "$WS"

# docker container (create, not start)
docker rm -f "vibe-$USER" 2>/dev/null || true
docker create \
  --name "vibe-$USER" \
  --network "$NETWORK" \
  --user student \
  -w /home/student/workspace \
  -e ANTHROPIC_BASE_URL="$SHIM_BASE_URL" \
  -e ANTHROPIC_AUTH_TOKEN=sk-vibe-shim-placeholder \
  -e STUDENT_USERNAME="$USER" \
  -v "$WS:/home/student/workspace:rw" \
  -v "$TEMPLATES_DIR:/home/student/templates:ro" \
  -p "127.0.0.1:$PORT:8080/tcp" \
  --memory 1536m \
  --memory-swap 1536m \
  --cpus 1.0 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --restart unless-stopped \
  --label "kg.vibe.student=$USER" \
  --label "kg.vibe.role=workspace" \
  "$IMAGE" \
  code-server /home/student/workspace > /dev/null

echo "[create-admin] container vibe-$USER created on port $PORT"
echo "[create-admin] done. login as $USER on vibe.kiselevgroup.com"
