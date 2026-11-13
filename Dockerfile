# Imagen para pruebas en la nube: un solo contenedor con la app y una copia de data/ como semilla.
# Lo que se cambie dentro se pierde al reiniciar el contenedor.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY data/db.sqlite ./data/db.sqlite
COPY data/compendio ./data/compendio
COPY data/uploads ./data/uploads
EXPOSE 3000
CMD ["node", "server/index.js"]
