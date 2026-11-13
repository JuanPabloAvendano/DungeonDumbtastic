# DungeonDumbtastic

Mesa virtual en el navegador para jugar rol (D&D 5e) con amigos. La voz va por Discord; aquí van el mapa, las fichas, las hojas de personaje, los dados, el chat y la música.

Las guías de uso están dentro de la app: **`/#/guia`** (general, jugador y DM). No hace falta cuenta para leerlas.

## Arrancar una sesión

```bash
npm install          # solo la primera vez
npm run demo         # opcional: crea la campaña de ejemplo y cuentas (servidor apagado)
npm run sesion       # 🌍 por internet: servidor + túnel público de Cloudflare
npm run local        # 📶 sin internet: mismo wifi, hotspot del celular o el mismo PC
```

- `npm run sesion` imprime un enlace `https://….trycloudflare.com`: pásalo por Discord. Cambia en cada sesión.
- `npm run local` imprime `http://localhost:3000` y la IP de la red (`http://192.168.x.x:3000`) con un QR. Conecta el PC y los móviles al mismo wifi o al hotspot de un celular. Si no carga, abre el puerto 3000 en el cortafuegos (`sudo ufw allow 3000/tcp`).
- La primera vez el servidor crea la cuenta **admin** y muestra su contraseña en la consola (o `ADMIN_PASSWORD=… npm start`).

## Roles

| Rol | Puede |
|---|---|
| **Super Admin** | Cuentas, roles, contraseñas, registro abierto/cerrado, **Monitor** del servidor, ver todas las campañas. |
| **Dungeon Master** | Campañas, jugadores, mapas, fichas, **biblioteca de música** (música, ambiente y efectos sincronizados), iniciativa, pedir tiradas con CD, tiradas y fichas ocultas. |
| **Jugador** | Su hoja, traerla a una campaña, mover su ficha, tirar desde la hoja, chat, volumen propio. |

## Cuentas de esta instalación

Contraseñas puestas el 2026-11-05 (en `data/` solo se guarda su hash: si se pierden, se cambian desde **Administración**).

| Usuario | Contraseña | Rol | Nombre en la mesa |
|---|---|---|---|
| `admin` | `sG_VBVJR` | Super Admin | Super Admin |
| `dm` | `Xwr7jirg` | Dungeon Master | El Narrador |
| `jugador1` | `ESmXqIF8` | Jugador | Thorin |
| `jugador2` | `whDDXijP` | Jugador | Lyra |
| `jugador3` | `EFaYBqzv` | Jugador | Sombra |

La cuenta `xddd` (nine) es de un jugador real y su contraseña no se guarda aquí.

## Monitorización y logs

- **Monitor** (Administración): conexiones, quién está en cada mesa, memoria, carga, contadores (peticiones, tiradas, mensajes, subidas, errores) y eventos recientes filtrables. Se refresca cada 5 s.
- **Logs**: `data/logs/app-AAAA-MM-DD.log`, una línea JSON por evento (accesos, entradas/salidas de mesa, música, subidas, errores). Se guardan 14 días. `LOG_LEVEL=debug` registra también cada petición.
- **Salud**: `GET /healthz` → `{ ok, uptimeSec }`.

## Jugar sin navegador (pruebas y agentes)

`node scripts/bot.js --url http://localhost:3000 --user dm --pass … state|log|wait|say|roll|move|end|hp|add|scene|ini|request …` (ayuda en la cabecera del archivo). `DATA_DIR=/otra/carpeta PORT=3100 npm start` levanta una instancia aislada.

## Estructura

```
server/      index.js · routes.js (API REST) · realtime.js (socket.io) · logger.js (logs + métricas)
             auth.js · campaigns.js · dice.js · db.js (JSON en data/db.json)
public/      index.html · css/app.css · fonts/ (locales) · js/ (app, board, dice3d, music, sheet, views/)
public/assets/demo · public/assets/audio   arte y sonido de ejemplo (originales)
data/        base de datos, subidas y logs (no se versiona)
scripts/     sesion.sh (túnel) · local.sh (hotspot) · demo.js · bot.js
```

Tests: `npm test`
