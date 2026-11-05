#!/usr/bin/env bash
# Abre una sesión de juego: arranca el servidor local y un túnel público de Cloudflare.
# Uso: npm run sesion   (Ctrl+C cierra todo)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
LOG_DIR="data/logs"
mkdir -p "$LOG_DIR"
TUNNEL_LOG="$LOG_DIR/tunnel.log"

command -v cloudflared >/dev/null || { echo "Falta cloudflared (instálalo: sudo pacman -S cloudflared)"; exit 1; }
[ -d node_modules ] || npm install

# ¿Ya hay algo escuchando en el puerto? (otra sesión abierta)
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "  ✖ El puerto $PORT ya está en uso (¿otra sesión abierta?)."
  echo "    Ciérrala con Ctrl+C en su terminal, o: kill \$(lsof -t -i :$PORT)   ·   o usa otro: PORT=3001 npm run sesion"
  exit 1
fi

cleanup() {
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PORT="$PORT" node server/index.js &
SERVER_PID=$!
sleep 1

TUNNEL_TRIES=3
URL=""
for try in $(seq 1 "$TUNNEL_TRIES"); do
  echo "  ⏳ Abriendo túnel (intento $try/$TUNNEL_TRIES)…"
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 60); do
    # api.trycloudflare.com aparece en el log antes del enlace real: se descarta.
    URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | grep -v '://api\.' | head -1 || true)"
    [ -n "$URL" ] && break
    grep -q 'failed to request quick Tunnel' "$TUNNEL_LOG" && break
    sleep 0.5
  done
  [ -n "$URL" ] && break
  kill "$TUNNEL_PID" 2>/dev/null || true
  sleep 2
done

if [ -n "$URL" ]; then
  echo ""
  echo "  🌍 Enlace para tus amigos:  $URL"
  echo "     (cambia en cada sesión; pásalo por Discord)"
  echo ""
else
  echo "  ⚠ No salió la URL del túnel. Revisa $TUNNEL_LOG. El servidor local sigue en http://localhost:$PORT"
fi

wait "$SERVER_PID"
