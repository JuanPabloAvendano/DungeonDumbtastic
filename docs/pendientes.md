# Pendientes anotados

Problemas e ideas que Juan va listando para retomar después. Solo se anotan; se trabajan cuando él lo pida.
Al resolver uno, se borra de aquí (queda en git) y se refleja en `IA_PROGRESO.md` si avanza una tarea.

## Problemas

### Resolución con imágenes de mapa muy grandes · 2026-11-05
Con imágenes muy grandes hay problemas de resolución en el tablero. Falta reproducir con un mapa grande
concreto: medir peso y dimensiones, ver si el navegador lo reduce, si el recorte por zonas lo resuelve y
si conviene reescalar o teselar al subir.
Pista: hasta el 2026-11-05 el tablero encuadraba con el tamaño por defecto (1680×1260) antes de cargar la
imagen y no volvía a encuadrar; con mapas de otro tamaño se veía a una escala equivocada. Ya está
corregido (`board.js`, `mapReady`); comprobar si con eso desaparece este problema antes de tocar nada más.

## Ideas para futuras versiones · 2026-11-05

### Objetos del mapa: lo que queda · 2026-11-06
Ya hecho: fichas de tipo objeto (sin PG ni iniciativa, cuadradas y giratorias) con función recoger / abrir
(con contenido y cerradura con prueba) / leer (texto solo para quien lo lee) / activar (avisa al DM con su nota
secreta), alcance en casillas, biblioteca de ejemplos e inventario en la hoja (usar, gastar, soltar en el mapa,
pasar a la barra). En «La Noche Prometida» los objetos que ya estaban (Amuleto ×2, Carriage) siguen como fichas:
el DM los convierte con 📦. Falta:
- Puertas que bloqueen el paso o la visión (ligado a la línea de visión de la niebla).
- Trampas que salten solas al pisar una casilla (hoy: objeto «activar» que avisa al DM).
- Peso, monedas y valor del inventario; repartir botín entre el grupo; PX (T-4.6).

### Diálogos de NPC preparados
Ya hecho (2026-11-06): el DM habla como un NPC (chat firmado con su nombre y retrato) y con 📜 el mensaje sale
en un cuadro de diálogo sobre el tablero de esa escena. Falta:
- El mensaje de diálogo llega a toda la campaña (el cuadro solo sale en su escena, pero el texto queda en el
  chat de quien está en otra escena paralela): mandarlo solo a los de esa escena.
- Diálogos **preparados** por el DM que salen cuando un jugador interactúa (clic) con un NPC u objeto, sin que
  el DM tenga que escribirlos en el momento.

### Asistente de clase y libros: lo que queda · 2026-11-06
Ya hecho: los tres libros de Juan (PHB, DMG, MM, en inglés) importados con `npm run compendio` a
`data/compendio` (no se publican). Buscador en «Libros» (menú) y en el panel 📖 de la mesa: conjuros, monstruos,
objetos y reglas, con erratas, prefijos y términos en español. Desde una entrada: añadir a la barra, crear un NPC
desde un monstruo o un rasgo desde un pasaje. En la hoja, «📖 Desde los libros» con la pista de cuántos trucos y
conjuros suele tener la clase a ese nivel (guía, no límite). Falta:
- Rasgos de clase por nivel ya puestos en la barra (hoy se buscan y se añaden a mano como rasgo).
- Lista de conjuros de cada clase para filtrar (en el PHB están en tablas que el OCR mezcla).
- Quedan restos del OCR en algunos títulos y textos del PHB («Anti life Shell», «toa»); la búsqueda los tolera.
- La curación (Tomar aliento, Curar heridas) sale como «💥 daño» en la barra: distinguirla y aplicarla a los PG.
- Objetos (armas, armaduras, consumibles) con inventario. Ver T-4.6.

### Libros en español: lo que queda · 2026-11-06
Ya hecho: traducción automática local (modelo libre de Argos con CTranslate2, en `data/traductor`, instalable
con `bash scripts/traductor/instalar.sh`), capa de términos de juego y lista de nombres conocidos
(`scripts/traductor/nombres.py`), caché en `data/compendio/es`, pretraducción en segundo plano y búsqueda en
español. Interruptor «🇪🇸 Español» en Libros y en el panel 📖 de la mesa. Falta:
- Ampliar `nombres.py` con más conjuros, monstruos y objetos (los títulos son lo que peor traduce el modelo).
- Frases ambiguas o con restos del OCR salen raras: se puede revisar a mano lo más usado.
- La pretraducción usa bastante CPU unos minutos al arrancar; si molesta en partida, bajarle la prioridad.

### Niebla de guerra: lo que queda · 2026-11-06
Ya hecho: el DM activa la niebla y pinta (revelar/tapar, pincel 1–9 casillas, tapar todo); cada personaje ve
6 casillas (campo «Visión» de la hoja); lo explorado queda en gris; al jugador no le llegan las fichas que nadie
ve. Falta:
- Paredes que tapen la visión (línea de visión) y fuentes de luz.
- La barra de iniciativa muestra nombre y retrato de todos los combatientes, aunque estén en la niebla.

### Taller de mapas: lo que queda · 2026-11-06
Ya hecho: sección «Taller de mapas» (menú superior y ✎ en la biblioteca de mapas de la escena) con recortar,
ampliar/acortar, goma, pincel, salas sobre la cuadrícula, objetos que se mueven/escalan/giran, quitar el fondo
(varita, desde los bordes, goma y pincel de restaurar), borradores re-editables y enviar a una campaña. Falta:
- Puertas, pasillos, capas y texturas de suelo (más estilo Dungeon Scrawl).
- Quitar fondo con IA en el navegador para fotos con fondo complicado (p. ej. `@imgly/background-removal`,
  modelo de unos 40 MB): decidir si merece la pena el peso. Con fondos lisos la varita ya va bien.
- Cada «Guardar» sube una imagen nueva de la base: limpiar las que quedan huérfanas en `data/uploads`.

### Descubrimiento progresivo de información
Lo que el jugador sabe de una ficha se desbloquea poco a poco con acciones o comentarios.
El sitio natural es el **resumen de la ficha** (el inspector que se abre al seleccionarla: retrato,
nombre, tipo, PG, estados, tamaño):
- Visible desde el principio: lo que se ve a simple vista (es una criatura, es un lobo).
- Oculto hasta que el DM lo desbloquee: el nombre propio de un NPC (si aún no lo ha dicho), su clase, sus
  atributos y demás datos de la hoja.
- El DM decide qué campos ve cada jugador y los va revelando.

## Producto y negocio · 2026-11-06

### Vídeo de presentación para un anuncio de YouTube
Juan quiere un vídeo completo de presentación del producto, como anuncio de YouTube.
**Primera versión hecha (2026-11-06)** para enseñar a los amigos: «Kiosko Productions presenta», 88 s,
1280×720, en `~/Videos/DungeonDumbtastic-Kiosko-Productions.mp4`; se regraba con `scripts/anuncio/` (ver su LEEME).
Para YouTube faltaría: quitar el segmento de los libros (texto con derechos), voz o rótulos más largos y versión 1080p. Ideas para cuando toque: grabar la mesa con la instancia de demo (DM + jugadores en pantallas
paralelas) con Playwright o OBS; recorrido de 60–90 s: crear campaña → taller de mapas → escena con niebla →
combate con la barra de acciones y dados 3D → diálogo de NPC → notas. Música propia (las pistas de ejemplo son
originales). Sin logotipos ni nombres de marcas de terceros.

### Monetizar: alquilar la mesa por horas a grupos · 2026-11-06
Objetivo: algo de ingreso pasivo y sencillo, alquilando el servicio por horas a grupos de amigos para sus
sesiones. Aún no se hace. Pendiente de investigar: servidor barato, sin arquitectura completa.
**Antes de cobrar, dos límites legales:**
- El **compendio con los libros propios de Juan** (PHB, DMG, MM importados con `npm run compendio`) es solo para
  uso privado. Una instancia de pago no puede llevarlos: solo el **SRD 5.1** (CC-BY-4.0, con su atribución).
- En el anuncio y el producto no se puede usar la marca «Dungeons & Dragons» ni sus logos: decir «compatible con
  la 5.ª edición / SRD 5.1». Lo mismo para cualquier contenido de terceros (mapas, imágenes, música).

**Primera investigación (2026-11-06), para decidir más adelante:**
- **0 €/mes · el PC de Juan + túnel con nombre de Cloudflare:** el túnel es gratis; solo hace falta un dominio
  barato (unos pocos € al año; mirar el precio de renovación, no el del primer año). Da un enlace fijo en vez del
  que cambia en cada `npm run sesion` (cubre T-7.4). Pega: el PC tiene que estar encendido durante las sesiones.
- **≈ 4–5 €/mes · VPS pequeño (Hetzner CX22: 2 vCPU, 4 GB):** sobra para varios grupos a la vez con este
  servidor (Node + JSON). Hetzner subió precios en 2026: confirmar en su web antes de contratar.
- **Gratis con riesgo · Oracle Cloud Always Free (ARM):** a menudo «sin capacidad» al crear la cuenta y pueden
  reclamar máquinas paradas; solo con copias de seguridad (T-7.5).
- Cobro sencillo para empezar: manual (enlace de pago y cuentas que el admin activa por horas o por sesión).
  Si funciona, un «pase» con caducidad por campaña en el panel de admin. Con ~2 sesiones pagadas al mes ya se
  cubre un VPS de 4 €.
- Fuentes: comparativas de precios de 2026 (blogs de terceros, con datos dispares): bitdoze.com/hetzner-cloud-cost-optimized-plans,
  deploywise.dev/blog/cheap-vps-for-developers, tech-insider.org/cloudflare-tunnel-setup-2026-homelab.

### Persistencia en la nube: lo que queda · 2026-11-13
Decidido: un solo contenedor y nada más en la nube (proyecto pequeño, para Juan y sus amigos). Ya hecho:
SQLite dentro del contenedor (`data/db.sqlite`), el PC baja un respaldo cada 10 min (`npm run respaldo --
--instalar`) y `npm run nube` redespliega con esos datos. Si el contenedor se reinicia solo, vuelve a lo último desplegado:
el respaldo lo detecta, avisa y guarda el último bueno; hay que correr `npm run nube` a mano para volver a
subirlo (se pierde como mucho lo jugado en los últimos 10 min).

### Documentos propios de cada usuario · 2026-11-13
Que cualquier usuario suba sus documentos (PDF, notas, manuales caseros) y los use: para sí mismo de forma
constante (su biblioteca personal) y, si es DM, compartiéndolos en su campaña con sus jugadores. Pensar
permisos (privado / campaña / jugadores concretos), búsqueda dentro de ellos como en el compendio y dónde
se guardan en la nube (ligado a «Persistencia de verdad en la nube»).

### Personalización y creación de objetos más dinámica · 2026-11-13
Crear y personalizar objetos de forma más flexible que la biblioteca de ejemplos actual: editor con
propiedades libres, imagen propia, efectos y plantillas reutilizables (ver también «Objetos del mapa: lo que queda»).

### Conexión P2P y alternativas de túnel · 2026-11-13
Hoy, si Cloudflare cae, no hay cómo jugar fuera de la LAN sin desplegar en la nube. Opciones a evaluar:
- Conexión P2P entre navegadores (WebRTC) para jugar sin servidor público.
- Varios proveedores de túnel intercambiables, como Cloudflare Tunnel: ngrok, Tailscale Funnel,
  localtunnel, Pinggy, zrok, bore… con un comando que pruebe el siguiente si uno falla.
La parte de red y hosting la decide Juan.
