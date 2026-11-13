#!/usr/bin/env bash
# Sube una versión nueva a Azure sin perder lo jugado: respalda la nube, lo trae a data/,
# construye la imagen con esos datos y cambia el contenedor. Los conectados se reconectan solos.
#   npm run nube
# Variables: DD_PASS (contraseña del admin; si falta, la pide), las de scripts/respaldo.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

ACR="${DD_ACR:-ca78e2431509acr}"
APP="${DD_APP:-dungeondumbtastic}"
RG="${DD_RG:-rg-dungeondumbtastic}"
TAG="$(date +%Y%m%d-%H%M%S)"
IMAGE="$ACR.azurecr.io/$APP:$TAG"

bash scripts/respaldo.sh --restaurar
docker build -q -t "$IMAGE" .
az acr login -n "$ACR" >/dev/null
docker push -q "$IMAGE"
az containerapp update -n "$APP" -g "$RG" --image "$IMAGE" -o none
echo "✔ En la nube: $IMAGE"
