# Imagen para pruebas en la nube: un solo contenedor con la app y una copia de data/ como semilla.
# Lo que se cambie dentro se pierde al reiniciar el contenedor (lo respalda scripts/respaldo.sh).
FROM node:24-alpine
# pdftotext: extrae el texto de los PDF que suben los usuarios para poder buscar dentro.
RUN apk add --no-cache poppler-utils
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
# Todo data/ menos lo que excluye .dockerignore (modelos del traductor, logs, copias viejas).
COPY data ./data
EXPOSE 3000
CMD ["node", "server/index.js"]
