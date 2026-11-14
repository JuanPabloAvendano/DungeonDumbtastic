#!/usr/bin/env bash
# Baja un respaldo (.tar.gz) de la mesa que corre en la nube a respaldos/.
#   npm run respaldo                      → un respaldo y listo
#   npm run respaldo -- --cada 10         → uno cada 10 minutos hasta Ctrl+C
#   npm run respaldo -- --restaurar       → además lo descomprime en data/ (guarda antes el data/ actual)
#   npm run respaldo -- --instalar        → lo deja automático cada 10 min (timer de systemd del usuario)
#   npm run respaldo -- --desinstalar     → quita el timer
# Se guardan los últimos KEEP respaldos y uno por día durante KEEP_DAYS días.
# Variables: DD_URL (por defecto la de Azure), DD_USER (admin), DD_PASS (si falta, se lee de
# ~/.config/dungeondumbtastic/respaldo.env o se pide).
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${DD_URL:-https://dungeondumbtastic.kindisland-2e0e68ff.brazilsouth.azurecontainerapps.io}"
USER_NAME="${DD_USER:-admin}"
KEEP=12
KEEP_DAYS=14
CONFIG_DIR="$HOME/.config/dungeondumbtastic"
ENV_FILE="$CONFIG_DIR/respaldo.env"
UNIT="dungeondumbtastic-respaldo"
EVERY_MIN=""
RESTORE=0
ACTION="download"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cada) EVERY_MIN="$2"; shift 2 ;;
    --restaurar) RESTORE=1; shift ;;
    --instalar) ACTION="install"; shift ;;
    --desinstalar) ACTION="uninstall"; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${DD_PASS:-}" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

ask_password() {
  if [[ -z "${DD_PASS:-}" ]]; then
    read -rsp "Contraseña de $USER_NAME en $URL: " DD_PASS; echo
  fi
}

login() {
  local body
  body=$(node -e 'console.log(JSON.stringify({ username: process.argv[1], password: process.argv[2] }))' "$USER_NAME" "$DD_PASS")
  curl -fsS -X POST "$URL/api/auth/login" -H 'content-type: application/json' -d "$body" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).token;if(!t)process.exit(1);console.log(t)}catch{process.exit(1)}})'
}

GOOD_FILE="respaldos/.ultimo-bueno"

prune() {
  local good
  good=$(cut -d' ' -f3 "$GOOD_FILE" 2>/dev/null || true)
  ls -1t respaldos/dungeondumbtastic-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | { grep -vxF "${good:-/}" || true; } | xargs -r rm -f || true
  ls -1t respaldos/revertido-*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f || true
  find respaldos/diario -name '*.tar.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
}

header() {
  tr -d '\r' < "$1" | awk -F': ' -v name="$2" 'tolower($1)==name{print $2}'
}

warn() {
  echo "$1" >&2
  command -v notify-send >/dev/null && notify-send -u critical "DungeonDumbtastic" "$1" || true
}

download() {
  mkdir -p respaldos/diario
  local out="respaldos/dungeondumbtastic-$(date +%Y-%m-%d-%H%M%S).tar.gz"
  local token saved boot started prev_saved prev_started prev_file
  token=$(login) || { echo "✖ No se pudo iniciar sesión (usuario/contraseña o servidor caído)" >&2; return 1; }
  if ! curl -fsS "$URL/api/admin/backup" -H "authorization: Bearer $token" -D "$out.headers" -o "$out.part"; then
    rm -f "$out.part" "$out.headers"; echo "✖ Falló la descarga del respaldo" >&2; return 1
  fi
  saved=$(header "$out.headers" x-dd-saved-at)
  boot=$(header "$out.headers" x-dd-boot-saved-at)
  started=$(header "$out.headers" x-dd-started-at)
  rm -f "$out.headers"
  tar -tzf "$out.part" >/dev/null || { rm -f "$out.part"; echo "✖ El respaldo llegó dañado" >&2; return 1; }
  [[ -f "$GOOD_FILE" ]] && read -r prev_saved prev_started prev_file < "$GOOD_FILE"
  # La nube se reinició y arrancó con datos más viejos que nuestro último respaldo: volvió a la imagen.
  # (Tras npm run nube la imagen lleva justo ese respaldo, así que no salta.)
  if [[ -n "$started" && -n "${prev_started:-}" && "$started" != "$prev_started" \
        && "$boot" -lt "$prev_saved" && -f "${prev_file:-}" ]]; then
    mv "$out.part" "respaldos/revertido-$(date +%Y-%m-%d-%H%M%S).tar.gz"
    warn "⚠ La nube volvió a un estado anterior (se reinició). Tu último respaldo bueno es $prev_file; corre npm run nube para volver a subirlo."
    LAST="$prev_file"
    prune
    return 0
  fi
  mv "$out.part" "$out"
  [[ -n "$saved" ]] && echo "$saved $started $out" > "$GOOD_FILE"
  cp "$out" "respaldos/diario/$(date +%Y-%m-%d).tar.gz"
  prune
  echo "✔ $(date +%H:%M) respaldo guardado: $out ($(du -h "$out" | cut -f1))"
  LAST="$out"
}

restore() {
  local keep="respaldos/data-local-antes-de-restaurar-$(date +%Y-%m-%d-%H%M%S).tar.gz"
  mkdir -p data
  (cd data && tar -czf "../$keep" --ignore-failed-read $(ls -d db.sqlite db.json uploads compendio docs 2>/dev/null)) 2>/dev/null || true
  # Una base nueva con el WAL viejo al lado se corrompe; y el JSON antiguo ya no se usa.
  rm -f data/db.sqlite-wal data/db.sqlite-shm
  [[ -f data/db.json ]] && mv data/db.json "data/db.json.migrado-$(date +%s)"
  # Respaldos de antes de SQLite traen db.json: se quita la base local para que se migre desde él.
  if tar -tzf "$LAST" | grep -qx 'db.json'; then rm -f data/db.sqlite; fi
  tar -xzf "$LAST" -C data
  DATA_DIR="$PWD/data" node --no-warnings -e 'require("./server/db").db()'
  echo "✔ Restaurado en data/ (tu data/ anterior quedó en $keep)"
}

install_timer() {
  ask_password
  login >/dev/null || { echo "✖ Esa contraseña no entra en $URL" >&2; exit 1; }
  mkdir -p "$CONFIG_DIR" "$HOME/.config/systemd/user"
  (umask 077; printf 'DD_PASS=%q\nDD_USER=%q\nDD_URL=%q\n' "$DD_PASS" "$USER_NAME" "$URL" > "$ENV_FILE")
  cat > "$HOME/.config/systemd/user/$UNIT.service" <<UNIT_EOF
[Unit]
Description=Respaldo de DungeonDumbtastic desde la nube

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $PWD/scripts/respaldo.sh
UNIT_EOF
  cat > "$HOME/.config/systemd/user/$UNIT.timer" <<UNIT_EOF
[Unit]
Description=Respaldo de DungeonDumbtastic cada 10 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT_EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT.timer"
  echo "✔ Respaldo automático cada 10 min en $PWD/respaldos (ver: journalctl --user -u $UNIT)"
}

uninstall_timer() {
  systemctl --user disable --now "$UNIT.timer" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/$UNIT.service" "$HOME/.config/systemd/user/$UNIT.timer" "$ENV_FILE"
  systemctl --user daemon-reload
  echo "✔ Respaldo automático quitado"
}

case "$ACTION" in
  install) install_timer; exit 0 ;;
  uninstall) uninstall_timer; exit 0 ;;
esac

ask_password
if [[ -n "$EVERY_MIN" ]]; then
  echo "Respaldando cada $EVERY_MIN min. Ctrl+C para parar."
  while true; do download || true; sleep "$((EVERY_MIN * 60))"; done
fi

download
[[ "$RESTORE" == 1 ]] && restore
exit 0
