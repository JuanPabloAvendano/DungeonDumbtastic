DungeonDumbtastic — mesa virtual en el navegador para jugar D&D 5e con amigos (voz por Discord).
Quién: Juan (dueño/DM) y su grupo de amigos; desarrollo con Claude.
Estado: primera muestra jugable; un one shot de prueba jugado por agentes el 2026-11-05.
Manda por encima: lo que pida el grupo tras jugar; reglas del SRD 5.1 (CC-BY-4.0) como referencia.

# Progreso · DungeonDumbtastic
Producto final: mesa virtual completa en el navegador (cuentas y roles, mapas y fichas, hojas con reglas 5e, dados 3D, combate asistido, audio, sesiones por túnel o hotspot, monitorizada)
Tarea actual: T-3.3

## H1 · Base, cuentas y roles · peso 10
- [x] T-1.1 · Servidor Express + socket.io con persistencia JSON · peso 3
- [x] T-1.2 · Cuentas jugador / DM / super admin con sesiones y scrypt · peso 3
- [x] T-1.3 · Panel de administración (cuentas, roles, registro abierto) · peso 2
- [x] T-1.4 · Límite de intentos de acceso por IP · peso 1
- [x] T-1.5 · Datos y cuentas de ejemplo (npm run demo) · peso 1

## H2 · Mesa y tablero · peso 15
- [x] T-2.1 · Mapa con cuadrícula, zoom, mover cámara, fichas arrastrables y ping · peso 4
- [x] T-2.2 · Fichas ocultas, estados, PG e inspector · peso 2
- [x] T-2.3 · Chat e historial de tiradas separados y plegables · peso 2
- [x] T-2.4 · Responsive (1280 px y móvil sin desborde) · peso 1
- [ ] T-2.5 · Plantillas de área (esfera, cubo, cono) · peso 2
- [ ] T-2.6 · Regla de distancia, alcance y velocidad restante · peso 2
- [x] T-2.7 · Fichas por escena y niebla de guerra (el DM pinta; cada personaje ve 6 casillas, configurable) · peso 2
- [x] T-2.8 · Preparar escenas con asistente, lanzarlas y escenas paralelas por jugador · peso 3
- [x] T-2.9 · Calibrar la cuadrícula sobre el mapa (tamaño, desfase) y recortar mapas grandes por zonas · peso 2
- [x] T-2.10 · Tablero despejable (panel izquierdo y bandeja de dados plegables) y contador de dados elegidos · peso 1
- [x] T-2.11 · Bestiario propio del DM: lo que sube y lo que guarda con ★ sirve en todas sus campañas · peso 1
- [ ] T-2.12 · Taller de mapas propio (estilo Dungeon Scrawl) · peso 3
  - [x] Editor: recortar, ampliar/acortar, goma, pincel, salas sobre la cuadrícula, deshacer
  - [x] Objetos subidos (carruaje, casas…) que se mueven, escalan, giran y se quita el fondo
  - [x] Borradores re-editables y enviar el mapa terminado a una campaña
  - [ ] Más herramientas: puertas, pasillos, capas, texturas de suelo

## H3 · Dados y tiradas · peso 10
- [x] T-3.1 · Dados 3D decididos por el servidor, ventaja/desventaja, CD, críticos · peso 4
- [x] T-3.2 · El DM pide tiradas con CD y tiradas ocultas · peso 2
- [ ] T-3.3 · Ataque contra CA → daño solo si impacta, ventana de reacción, aplicar daño al objetivo · peso 4

## H4 · Hojas y reglas 5e · peso 20
- [x] T-4.1 · Hoja básica con características, habilidades y salvaciones clicables · peso 3
- [ ] T-4.2 · Recursos de clase con contadores (Tomar aliento, Acción súbita…) · peso 3
  - [x] Usos por acción que se gastan y vuelven con descanso corto o largo
  - [ ] Recursos precargados por clase y nivel (asistente de clase)
- [x] T-4.3 · Espacios de conjuro y lista de conjuros con lanzar · peso 4
  - [x] Espacios por nivel (sugeridos por clase con la tabla SRD, pacto del brujo) y contador en la barra
  - [x] Barra de acciones estilo BG3: lanzar gasta el espacio elegido, ataque y daño con un clic
  - [x] Elegir conjuros y trucos de los libros desde la hoja («📖 Desde los libros»), con pista de cuántos por clase y nivel
- [ ] T-4.4 · Perfiles de monstruo ligados a la ficha (CA, ataques, DES) · peso 4
  - [x] Crear un NPC desde un monstruo de los libros con CA, PG, características y ataques en la barra
  - [ ] Fichas del bestiario con perfil (hoy solo imagen y PG) e iniciativa con su DES
- [ ] T-4.5 · Condiciones con duración y concentración · peso 3
- [ ] T-4.6 · Inventario, botín y PX · peso 3
  - [x] Inventario en la hoja (usar, gastar, soltar en el mapa, pasar a la barra)
  - [x] Objetos del mapa que se recogen, abren (con contenido y cerradura), leen o activan
  - [ ] Monedas, peso y reparto de botín
  - [ ] PX y subida de nivel
- [x] T-4.7 · Un jugador con varios personajes y NPC con hoja completa (los jugadores no ven su hoja) · peso 2
- [x] T-4.8 · Hablar y tirar como un personaje; diálogos de NPC en un cuadro sobre el tablero · peso 1
- [x] T-4.9 · Compendio de los libros propios (importar PDF, reparar OCR) con buscador en la mesa y en su página · peso 3
- [x] T-4.10 · Notas privadas con formato (jugador para sí, DM por personaje) · peso 1
- [x] T-4.11 · Traducción automática local al español de los libros (búsqueda, entradas y barra) · peso 1

## H5 · Combate asistido · peso 10
- [x] T-5.1 · Iniciativa con retratos, turnos y rondas · peso 3
- [x] T-5.2 · Correcciones del playtest (turno al quitar ficha, ocultas fuera, nombres numerados, PG ≥ 0) · peso 2
- [ ] T-5.3 · Iniciativa con modificador de monstruos, añadir/retrasar entradas, anuncio de turno · peso 3
- [ ] T-5.4 · Ventaja/desventaja sugerida por estados (apresado, dormido…) · peso 2
- [x] T-5.5 · Movimiento por turno (5 casillas) y acciones/reacción solo en tu turno · peso 3

## H6 · Audio · peso 5
- [x] T-6.1 · Biblioteca de música del DM sincronizada (música, ambiente, efectos) · peso 3
- [x] T-6.2 · Pistas de ejemplo originales y volumen por jugador · peso 1
- [ ] T-6.3 · Listas de reproducción y fundido entre pistas · peso 1

## H7 · Sesiones e infraestructura · peso 10
- [x] T-7.1 · Sesión por túnel Cloudflare con reintentos (npm run sesion) · peso 3
- [x] T-7.2 · Modo local / hotspot sin internet con QR (npm run local) · peso 2
- [x] T-7.3 · Logs diarios, monitor en el panel de admin y /healthz · peso 2
- [ ] T-7.4 · Enlace fijo (túnel con cuenta de Cloudflare) · peso 1
- [ ] T-7.5 · Copias de seguridad automáticas de data/ · peso 2
  - [x] Base en SQLite (node:sqlite) con migración automática desde db.json
  - [x] Respaldo del super admin (endpoint + botón) con instantánea consistente
  - [x] npm run respaldo: timer de 10 min, retención y aviso si la nube se reinició
  - [x] npm run nube: redesplegar en Azure sin perder lo jugado
  - [ ] Versión con SQLite desplegada en Azure y timer instalado en el PC de Juan

## H8 · Documentación y pruebas · peso 10
- [x] T-8.1 · Guías en la app: general, jugador y DM · peso 3
- [x] T-8.2 · Pruebas unitarias y de integración (55 en verde) · peso 3
- [x] T-8.3 · CLI de juego (scripts/bot.js) y partida de prueba con agentes · peso 2
- [ ] T-8.4 · Primera sesión real con el grupo y lista de mejoras · peso 2

## H9 · Por detallar (ideas que salgan del grupo) · peso 10
- [ ] T-9.1 · Ideas y recomendaciones aún sin definir · peso 1
