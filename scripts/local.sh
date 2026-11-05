#!/usr/bin/env bash
# Sesión SIN internet: mismo wifi, hotspot del celular o el mismo computador.
# Uso: npm run local   (Ctrl+C para cerrar)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
[ -d node_modules ] || npm install

# ¿Ya hay algo escuchando en el puerto? (otra sesión abierta)
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "  ✖ El puerto $PORT ya está en uso (¿otra sesión abierta?)."
  echo "    Ciérrala con Ctrl+C en su terminal, o: kill \$(lsof -t -i :$PORT)   ·   o usa otro: PORT=3001 npm run local"
  exit 1
fi

# IPs de la red local (se ignoran loopback y docker)
IPS="$(ip -4 -o addr show 2>/dev/null | awk '$2 !~ /^(lo|docker|br-|veth|virbr)/ {split($4, a, "/"); print a[1]}')"

echo ""
echo "  📶 Modo local (sin internet)"
echo "  ─────────────────────────────"
echo "  En este computador:      http://localhost:$PORT"
for ip in $IPS; do
  echo "  Desde móviles/portátiles: http://$ip:$PORT"
done
if [ -z "$IPS" ]; then
  echo "  ⚠ No hay red local. Activa el hotspot del celular y conecta este computador a él."
fi
echo ""
echo "  Hotspot del celular: activa el punto de acceso, conecta este PC y los demás dispositivos"
echo "  a esa red y abrid la dirección de arriba. Si no carga, revisa el cortafuegos (puerto $PORT)."
if command -v qrencode >/dev/null && [ -n "$IPS" ]; then
  echo ""
  qrencode -t ANSIUTF8 "http://$(echo "$IPS" | head -1):$PORT"
fi
echo ""
HOST=0.0.0.0 PORT="$PORT" exec node server/index.js
