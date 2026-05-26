#!/usr/bin/env bash
# Изолирует контейнеры vibe-net: разрешён только shim + внешний интернет.
# Идемпотентно: можно безопасно перезапускать.
#
# Цепочка VIBE-FILTER собирается заново, потом цепляется к DOCKER-USER (которая
# срабатывает раньше дефолтных docker-правил).

set -euo pipefail

CHAIN="VIBE-FILTER"
INPUT_CHAIN="VIBE-INPUT"
BR="${BR:-br-vibe}"
SHIM_IP="${SHIM_IP:-172.30.0.1}"
SHIM_PORT="${SHIM_PORT:-8190}"
HOST_PUBLIC_IP="${HOST_PUBLIC_IP:-80.87.104.193}"

# --- FORWARD: трафик контейнер → внешний мир и контейнер → другие сети ---
while iptables -C DOCKER-USER -i "$BR" -j "$CHAIN" 2>/dev/null; do
  iptables -D DOCKER-USER -i "$BR" -j "$CHAIN"
done
if iptables -nL "$CHAIN" >/dev/null 2>&1; then
  iptables -F "$CHAIN"
  iptables -X "$CHAIN"
fi

# --- INPUT: трафик контейнер → IP хоста (loopback и публичный) ---
while iptables -C INPUT -i "$BR" -j "$INPUT_CHAIN" 2>/dev/null; do
  iptables -D INPUT -i "$BR" -j "$INPUT_CHAIN"
done
if iptables -nL "$INPUT_CHAIN" >/dev/null 2>&1; then
  iptables -F "$INPUT_CHAIN"
  iptables -X "$INPUT_CHAIN"
fi

iptables -N "$CHAIN"
iptables -N "$INPUT_CHAIN"

# === INPUT-цепочка: контейнер → любой IP хоста ===
# Разрешён только shim. Остальное (sshd, nginx, etc.) — DROP.
iptables -A "$INPUT_CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A "$INPUT_CHAIN" -p tcp --dport "$SHIM_PORT" -d "$SHIM_IP" -j ACCEPT
iptables -A "$INPUT_CHAIN" -j DROP

iptables -I INPUT 1 -i "$BR" -j "$INPUT_CHAIN"

# 1) Уже установленные соединения (return-трафик) — пропускаем.
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# 2) Разрешаем достучаться до shim'а на gateway.
iptables -A "$CHAIN" -d "$SHIM_IP" -p tcp --dport "$SHIM_PORT" -j ACCEPT

# 3) Всё остальное в сторону gateway (любые другие порты host'а) — drop.
iptables -A "$CHAIN" -d "$SHIM_IP" -j DROP

# 4) Прочие приватные сети (другие docker bridges, RFC1918, link-local).
#    Заодно режет vibe-net↔vibe-net (изоляция учеников между собой).
iptables -A "$CHAIN" -d 10.0.0.0/8       -j DROP
iptables -A "$CHAIN" -d 172.16.0.0/12    -j DROP
iptables -A "$CHAIN" -d 192.168.0.0/16   -j DROP
iptables -A "$CHAIN" -d 169.254.0.0/16   -j DROP    # link-local + AWS metadata-style
iptables -A "$CHAIN" -d 127.0.0.0/8      -j DROP    # на всякий

# 5) Публичный IP хоста — drop (чтобы не было обхода через NAT loopback).
iptables -A "$CHAIN" -d "$HOST_PUBLIC_IP" -j DROP

# 6) Всё остальное наружу (DNS, npm, github, anthropic напрямую без OAuth) — ок.
iptables -A "$CHAIN" -j ACCEPT

# Вставляем hook первым правилом в DOCKER-USER.
iptables -I DOCKER-USER 1 -i "$BR" -j "$CHAIN"

echo "VIBE-FILTER applied. Rules in chain:"
iptables -nL "$CHAIN" --line-numbers
