#!/usr/bin/env bash
# Деплой на Vibecode
# Документация: https://vibecode.bitrix24.tech/docs-content/infra.md
#
# Использование:
#   npm run deploy
#   SERVER_ID=<id> npm run deploy   # если SERVER_ID не задан в .env
#
set -euo pipefail

# Загружаем переменные из .env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# SERVER_ID можно передать через переменную окружения или .env
if [ -z "${SERVER_ID:-}" ]; then
  echo "Ошибка: SERVER_ID не задан."
  echo "Создай сервер: POST /v1/infra/servers"
  echo "Или передай: SERVER_ID=<id> npm run deploy"
  exit 1
fi

API_URL="https://vibecode.bitrix24.tech/v1/infra/servers/$SERVER_ID/deploy?stream=false"

echo "Упаковываем проект..."
tar czf /tmp/vibe-deploy.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=.claude \
  --exclude='*.pen' \
  --exclude=data \
  --exclude=.env \
  .

echo "Деплоим на Vibecode (SERVER_ID: $SERVER_ID)..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "X-Api-Key: $VIBE_API_KEY" \
  -F "archive=@/tmp/vibe-deploy.tar.gz" \
  -F "runtime=node20" \
  -F "install=cd /opt/app && npm install --production" \
  -F "start=cd /opt/app && node src/server.js" \
  -F "port=3000" \
  -F "cleanDeploy=true" \
  -F "env[NODE_ENV]=production" \
  -F "env[VIBE_API_KEY]=$VIBE_API_KEY" \
  -F "env[VIBE_BASE_URL]=${VIBE_BASE_URL:-https://vibecode.bitrix24.tech/v1}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  APP_URL=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['appUrl'])")
  echo "✓ Деплой успешен: $APP_URL"
else
  echo "✗ Деплой не удался (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi

rm -f /tmp/vibe-deploy.tar.gz
