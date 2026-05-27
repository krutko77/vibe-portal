# vibe.kiselevgroup.com — портал платного курса
#
# Прокси к vibe-panel (127.0.0.1:3020). Тот сам разруливает:
#   - /                       → статика + JS SPA (login → app)
#   - /api/*                  → JSON API (login, students, templates, container lifecycle)
#   - /code/<user>/*          → код-сервер контейнера ученика (после session check)
#
# WebSocket нужен для code-server.

upstream vibe_panel {
    server 127.0.0.1:3020;
    keepalive 16;
}

# SSL добавлен certbot --nginx (Let's Encrypt, автообновление). Не править вручную
# блоки "managed by Certbot" — потеряются при renew.
server {
    server_name vibe.kiselevgroup.com;

    access_log /var/log/nginx/vibe.access.log;
    error_log  /var/log/nginx/vibe.error.log;

    # Без лимита — внутри code-server бывают большие upload'ы расширений
    client_max_body_size 100M;

    # ACME (certbot)
    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    # Публичная страничка про модель безопасности (без auth, минует vibe-panel)
    location = /security.html {
        alias /opt/vibe-portal/public-docs/security.html;
        default_type text/html;
        add_header Cache-Control "public, max-age=300";
    }

    location / {
        proxy_pass http://vibe_panel;
        proxy_http_version 1.1;

        # WebSocket upgrade (для code-server)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix "";

        # Большие таймауты для долгих стримов claude
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/vibe.kiselevgroup.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/vibe.kiselevgroup.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}

server {
    if ($host = vibe.kiselevgroup.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    listen [::]:80;
    server_name vibe.kiselevgroup.com;
    return 404; # managed by Certbot


}