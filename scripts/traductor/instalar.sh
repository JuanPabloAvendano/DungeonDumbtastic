#!/usr/bin/env bash
# Instala el traductor local inglés → español del compendio (una sola vez, ~150 MB en DATA_DIR/traductor).
# Usa uv para el entorno de Python y el modelo libre de Argos Translate (en → es). Sin servicios externos
# al traducir: después de instalarlo funciona sin internet.
# Uso: bash scripts/traductor/instalar.sh   (con DATA_DIR=… si los datos están en otra carpeta)
set -euo pipefail
cd "$(dirname "$0")/../.."
DATA_DIR="${DATA_DIR:-data}"
DEST="$DATA_DIR/traductor"
MODEL_URL="https://argos-net.com/v1/translate-en_es-1_0.argosmodel"

command -v uv >/dev/null || { echo "Falta uv (instálalo: sudo pacman -S uv)"; exit 1; }
mkdir -p "$DEST"
[ -x "$DEST/venv/bin/python" ] || uv venv -q "$DEST/venv"
VIRTUAL_ENV="$DEST/venv" uv pip install -q ctranslate2 sentencepiece
if [ ! -f "$DEST/en_es/model/model.bin" ]; then
  echo "  ⬇ Descargando el modelo inglés → español…"
  curl -sL -o "$DEST/en_es.argosmodel" "$MODEL_URL"
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$DEST/en_es.argosmodel" "$DEST"
  rm -f "$DEST/en_es.argosmodel"
fi
echo '{"id":1,"texts":["Make a Dexterity saving throw."]}' | "$DEST/venv/bin/python" scripts/traductor/traducir.py "$DEST/en_es" | tail -1
echo "  ✔ Traductor listo. Reinicia el servidor: el compendio se traducirá solo en segundo plano."
