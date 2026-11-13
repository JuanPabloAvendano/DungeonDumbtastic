# Anuncio en vídeo (Kiosko Productions)

Graba el anuncio de ~90 s de DungeonDumbtastic sobre una instancia de demo y lo monta con música propia.

1. `npm i --no-save playwright-core` y tener `chromium` y `ffmpeg` (con libvpx y libx264) en el sistema.
   Playwright busca su ffmpeg en `~/.cache/ms-playwright/ffmpeg-1010/ffmpeg-linux`: basta un enlace al del sistema
   mientras se graba (`ln -s /usr/bin/ffmpeg …`), y se quita después.
2. Instancia aparte: `DATA_DIR=/tmp/anuncio PORT=3200 node scripts/demo.js` (apunta las contraseñas), copia
   `data/compendio` dentro y arranca `DATA_DIR=/tmp/anuncio PORT=3200 node server/index.js`.
3. `CREDS=dm=…,jugador1=… node scripts/anuncio/seed.mjs` (barra de Thorin, cofre, carta y NPC).
4. `CARDS=scripts/anuncio CREDS=… node scripts/anuncio/record.mjs <carpeta>/raw` (un .webm por segmento; se puede
   regrabar uno solo pasando su nombre: `… raw libros`).
5. `MUSIC=~/Downloads/The_Map_Unfolds.mp3 python3 scripts/anuncio/assemble.py <carpeta> anuncio.mp4` (sin MUSIC usa la pista de taberna del proyecto).

Para un anuncio público: quitar el segmento «libros» (enseña texto de libros con derechos) y no nombrar la marca
de terceros; el resto es contenido propio.
