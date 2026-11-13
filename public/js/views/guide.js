// Guías de uso dentro de la app: general (todos los roles) y de juego (jugadores y DM).
import { h, clear } from '../ui.js';

const path = (...steps) => h('span.ui-path', steps.flatMap((st, i) => (i ? [h('i', '›'), h('b', st)] : [h('b', st)])));
const step = (title, ...body) => h('li.g-step', h('h4', title), ...body);
const tip = (...body) => h('div.g-tip', h('span', '💡'), h('div', ...body));
const warn = (...body) => h('div.g-tip.warn', h('span', '⚠'), h('div', ...body));
const kbd = (k) => h('kbd', k);

const GUIDES = {
  general: {
    title: 'Guía general',
    sub: 'Para todos: qué es esto, cuentas, roles y cómo abrir una sesión.',
    body: (me) => [
      h('section.g-sec',
        h('h3', '¿Qué es DungeonDumbtastic?'),
        h('p', 'Una mesa virtual de rol que funciona entera en el navegador (ordenador, tablet o móvil). La voz va por Discord; aquí está el mapa, las fichas, las hojas de personaje, los dados, el chat y la música. Nada que instalar para los jugadores: solo abrir el enlace.')),
      h('section.g-sec',
        h('h3', 'Los tres roles'),
        h('div.g-roles',
          h('div.g-role', h('b', '👑 Super Admin'), h('p', 'Crea las cuentas de los amigos, decide quién es DM, cambia contraseñas, abre o cierra el registro y vigila el servidor (Monitor).')),
          h('div.g-role', h('b', '♛ Dungeon Master'), h('p', 'Crea campañas, invita jugadores, sube mapas, fichas y música, controla la escena, la iniciativa y pide tiradas.')),
          h('div.g-role', h('b', '🛡 Jugador'), h('p', 'Crea su personaje, lo trae a la campaña, mueve su ficha y tira dados con un clic desde su hoja.')))),
      h('section.g-sec',
        h('h3', 'Entrar por primera vez'),
        h('ol.g-steps',
          step('Abre el enlace que te pasaron por Discord', h('p', 'Si el registro está abierto puedes pulsar ', h('b', 'Crear cuenta'), '. Si no, pide al admin tu usuario y contraseña.')),
          step('Entra con tu usuario', h('p', 'Llegas al ', h('b', 'Lobby'), ': ahí ves tus campañas y tus personajes.')),
          step('Elige la campaña', h('p', 'Pulsa ', h('b', 'Entrar a la mesa'), '. Si no ves ninguna, dile al DM tu nombre de usuario para que te añada.')))),
      h('section.g-sec',
        h('h3', 'Abrir una sesión de juego (quien hace de servidor)'),
        h('p', 'El servidor corre en el ordenador de quien organiza (normalmente el DM o el admin). Hay dos formas:'),
        h('div.g-cols',
          h('div.g-card',
            h('h4', '🌍 Por internet (amigos en sus casas)'),
            h('pre', 'npm run sesion'),
            h('p', 'Abre un túnel de Cloudflare y muestra un enlace ', h('code', 'https://…trycloudflare.com'), '. Pásalo por Discord. El enlace cambia cada sesión.')),
          h('div.g-card',
            h('h4', '📶 En local (mismo wifi o hotspot del móvil)'),
            h('pre', 'npm run local'),
            h('p', 'Sin internet: conecta el ordenador y los móviles/portátiles de todos a la misma red (o al hotspot de un celular). La consola muestra la dirección, tipo ', h('code', 'http://192.168.x.x:3000'), '. En el mismo ordenador basta ', h('code', 'http://localhost:3000'), '.'))),
        tip('Si en local nadie puede entrar, revisa el cortafuegos del ordenador (puerto 3000) y que todos estén en la misma red. Algunos hotspots aíslan a los clientes: en ese caso usa el móvil como hotspot y el ordenador como servidor conectado a él.'),
        warn('Mientras el servidor esté abierto, cualquiera con el enlace ve la pantalla de acceso. Cierra el registro en Administración si no lo necesitas.')),
      // Solo lo ve el super admin: ni DM ni jugadores necesitan (ni deben) ver la administración.
      me?.role === 'superadmin' ? h('section.g-sec',
        h('h3', 'Para el Super Admin'),
        h('ol.g-steps',
          step('Crear cuentas', h('p', path('Administración', 'Crear cuenta'), ' — usuario, nombre visible, contraseña y rol.')),
          step('Hacer DM a alguien', h('p', path('Administración', 'Cuentas', 'Rol'), ' — cambia el desplegable a ', h('b', 'Dungeon Master'), '.')),
          step('Registro abierto o cerrado', h('p', 'Casilla “Permitir que cualquiera cree su cuenta de jugador”.')),
          step('Monitor', h('p', path('Administración', 'Monitor'), ' — quién está conectado, memoria, errores, peticiones y el registro de eventos. Los logs completos se guardan en ', h('code', 'data/logs/app-AAAA-MM-DD.log'), ' (14 días).')))) : null,
      h('section.g-sec',
        h('h3', 'Atajos de la mesa'),
        h('ul.g-keys',
          h('li', kbd('Rueda'), ' zoom'), h('li', kbd('Arrastrar fondo'), ' mover la cámara'), h('li', kbd('Arrastrar ficha'), ' moverla (se ajusta a la casilla)'),
          h('li', kbd('Doble clic'), ' señalar un punto a todos'), h('li', kbd('☰'), ' ocultar el panel izquierdo'), h('li', kbd('🎲'), ' / ', kbd('💬'), ' historial de tiradas / chat (a la derecha)'))),
    ],
  },
  jugador: {
    title: 'Guía del jugador',
    sub: 'Cómo crear tu personaje, moverte por el mapa y tirar dados.',
    body: () => [
      h('ol.g-steps',
        step('Crea tu personaje', h('p', path('Lobby', 'Mis personajes', '+ Nuevo personaje'), '. Rellena nombre, raza, clase, nivel, CA, PG y las seis características. El modificador se calcula solo.'),
          tip('Retrato: elige uno de ejemplo o pulsa ', h('b', 'Subir retrato'), ' (PNG, JPG, WEBP o GIF, hasta 15 MB). Ese retrato será también tu ficha en el mapa.')),
        step('Tráelo a la campaña', h('p', 'Al editarlo, elige la campaña en el desplegable ', h('b', 'Campaña'), '. O dentro de la mesa: ', path('📜 Personaje', 'Traer'), '.')),
        step('Coloca tu ficha', h('p', path('📜 Personaje', '⬇ Colocar mi ficha'), '. Aparece en el centro del mapa; arrástrala a donde quieras. Solo puedes mover la tuya.')),
        step('Tira dados', h('p', 'Tres formas:'),
          h('ul',
            h('li', h('b', 'Desde tu hoja: '), 'clic en una característica o habilidad = 1d20 + modificador. Clic derecho en una característica = tirada de salvación.'),
            h('li', h('b', 'Bandeja de abajo: '), 'pulsa los dados para sumarlos (clic derecho quita), pon el modificador y una etiqueta, elige ventaja/desventaja y ', h('b', 'TIRAR'), '.'),
            h('li', h('b', 'Chat: '), h('code', '/r 1d20+5 Ataque'), ', ', h('code', '/r 2d6+3 Daño'), ', ', h('code', '/r 4d6kh3'), '.')),
          tip('El resultado lo decide el servidor: todos ven lo mismo y nadie puede hacer trampa. El dado aparece en grande y luego queda en el historial 🎲.')),
        step('Cuando el DM te pide una tirada', h('p', 'Aparece una ventana con la prueba y la CD. Elige ', h('b', 'Normal'), ', ', h('b', 'Ventaja'), ' o ', h('b', 'Desventaja'), ' y tira.')),
        step('En combate', h('p', 'Solo mueves tu ficha ', h('b', 'en tu turno'), ' y como mucho las casillas que marque el DM (5 por defecto; la diagonal cuenta 1). El recuadro dorado del mapa es tu alcance y arriba ves ', h('b', '👣 casillas que quedan'), ', ', h('b', 'Acción'), ', ', h('b', 'Adicional'), ' y ', h('b', 'Reacción'), '. Pulsa ', h('b', 'Terminar turno ▶'), ' al acabar.'),
          tip('Fuera de tu turno solo puedes tirar si el DM te lo pide, o gastando tu reacción (una por ronda; se recupera al empezar tu turno).')),
        step('Barra de acciones', h('p', 'Encima de los dados está la barra de tu personaje (como en Baldur\'s Gate 3): acciones, adicionales, reacciones, trucos, conjuros y rasgos pasivos. Clic en una → ', h('b', '🎯 Atacar'), ' / ', h('b', '✦ Lanzar'), ' / ', h('b', '💥 Daño'), '. Gasta solo el uso, el espacio de conjuro y la acción del turno.'),
          tip('Se rellena en ', path('✎ Editar hoja', 'Acciones, conjuros y rasgos'), ': ', h('b', '+ Acciones básicas'), ' añade Esquivar, Correr, Destrabarse… y ', h('b', '✦ Sugerir espacios'), ' pone los espacios de conjuro de tu clase y nivel. ☾ / ☀ son los descansos corto y largo.')),
        step('Dos personajes a la vez', h('p', 'Puedes llevar más de uno: ', path('📜 Personaje', '+ Llevar otro personaje'), '. Arriba del panel eliges con cuál actúas; el chat y las tiradas salen firmados con ese, y cuando le toca el turno a uno se cambia solo.')),
        step('Niebla de guerra', h('p', 'Si el DM pone niebla, solo ves lo que alcanzan los personajes del grupo (6 casillas por defecto) y lo que él revela. Lo ya explorado queda en gris, pero sin enemigos a la vista.')),
        step('Objetos del mapa', h('p', 'Cofres, puertas, cartas, palancas o un amuleto en el suelo: haz clic en el objeto y pulsa ', h('b', '✋ Recoger'), ', ', h('b', '🔓 Abrir'), ', ', h('b', '📖 Leer'), ' o ', h('b', '⚙ Activar'), '. Tu ficha tiene que estar al lado. Lo que recoges va al ', h('b', 'Inventario'), ' de tu hoja: desde ahí lo usas, gastas, sueltas en el mapa (⬇) o lo pasas a la barra (⚔).')),
        step('Libros en español', h('p', 'En ', path('Libros'), ' o en el panel 📖 de la mesa, deja activado ', h('b', '🇪🇸 Español'), ': los resultados y cada entrada salen traducidos automáticamente (con ', h('b', 'Ver original'), ' para comparar). La primera vez que se abre algo tarda un par de segundos; luego queda guardado. Puedes buscar en español.')),
        step('Puntos de golpe y estados', h('p', 'En tu hoja: botones −1 / −5 / +1 / +5. O clic en tu ficha del mapa → panel con ', h('b', 'Daño'), ', ', h('b', 'Curar'), ' y estados (envenenado, derribado…).')),
        step('Chat y tiradas', h('p', 'A la derecha hay dos iconos: ', h('b', '🎲 historial de tiradas'), ' y ', h('b', '💬 chat'), '. Están plegados para dejar sitio al mapa; el número rojo indica mensajes nuevos.')),
        step('Música', h('p', 'Suena lo que pone el DM. Arriba tienes tu propio volumen y 🎵/🔇 para silenciar. Si sale ', h('b', '🔈 Activar sonido'), ', púlsalo (el navegador lo exige).'))),
    ],
  },
  dm: {
    title: 'Guía del Dungeon Master',
    sub: 'Preparar la campaña, subir material y dirigir la partida.',
    body: () => [
      h('section.g-sec', h('h3', 'Preparar'),
        h('ol.g-steps',
          step('Crea la campaña', h('p', path('Lobby', '+ Nueva campaña'), '. Entras directamente a la mesa.')),
          step('Invita a los jugadores', h('p', path('👥 Jugadores', 'usuario del jugador', 'Añadir'), ' (también desde el Lobby → ', h('b', 'Jugadores'), '). Necesitan tener cuenta.')),
          step('Prepara escenas', h('p', path('🗺 Escena', '✦ Preparar escena nueva'), ': un asistente en 4 pasos — nombre y mapa (sube hasta 40 MB), cuadrícula, fichas iniciales y listo. La escena queda ', h('b', 'en preparación'), ': tu tablero pasa a ella y los jugadores siguen viendo la anterior mientras colocas las fichas.'),
            tip('Cuadrícula: haz zoom y usa ', h('b', '▦ Marcar casillas'), ' dibujando un recuadro sobre 3–5 casillas del dibujo (indica cuántas abarca); afina con − / + y las flechas. Si sabes cuántas casillas tiene de ancho, escríbelo. Con un mapa enorme usa ', h('b', '✂ Recortar zona'), ': cada escena puede usar una parte distinta del mismo mapa.')),
          step('Sube fichas de monstruos y PNJ', h('p', path('♟ Fichas', '⬆ Subir ficha nueva'), ' — imagen, nombre y PG. Lo que subes queda en «Mis bestias» para cualquier campaña; con ★ en una ficha del mapa también la guardas. Hay un bestiario de ejemplo. Arrastra al mapa o haz clic para ponerla en el centro.'),
            tip('Marca ', h('b', 'Colocar ocultas'), ' para preparar emboscadas: solo tú las ves (semitransparentes). Clic en la ficha → ', h('b', '👁 Revelar'), '.')),
          step('NPC con hoja completa', h('p', path('♟ Fichas', '+ Nuevo NPC'), ': se crean con la misma hoja que un personaje jugador (acciones y conjuros incluidos). Los jugadores solo ven su nombre, retrato y vida, y solo cuando su ficha está a la vista. ', h('b', '↩ Traer NPC'), ' reutiliza uno de otra campaña.')),
          step('Taller de mapas', h('p', path('Taller de mapas'), ' (menú de arriba, o ✎ en la biblioteca de mapas de la escena): recorta, amplía, borra, pinta, dibuja salas sobre la cuadrícula y coloca objetos (un carruaje, una casa…) quitándoles el fondo. Guarda el borrador y pulsa ', h('b', '▶ Enviar a una campaña'), '.'),
            tip('Quitar fondo va mejor con fondos lisos. Si la varita se come parte del objeto, deshaz o pásale el pincel ', h('b', 'Restaurar'), '.')),
          step('Prepara la música', h('p', path('🎵 Música', '⬆ Subir pista'), ' — MP3, OGG, WAV, M4A, AAC o FLAC hasta 40 MB. Elige tipo: ', h('b', 'Música'), ' o ', h('b', 'Ambiente'), ' (suenan en bucle para todos) o ', h('b', 'Efecto'), ' (suena una vez).'))),
        tip('¿Prisa? En Escena, Fichas y Música hay botones ✦ para añadir el material de ejemplo.')),
      h('section.g-sec', h('h3', 'Dirigir'),
        h('ol.g-steps',
          step('Pedir pruebas', h('p', path('👥 Jugadores', 'Pedir una tirada'), ' — a un jugador o a todos, con característica, nombre de la prueba y CD. Marca ', h('b', 'Resultado oculto'), ' si no quieres que el resto lo vea.')),
          step('Tus tiradas secretas', h('p', 'En la bandeja de dados tienes ', h('b', 'CD'), ' y ', h('b', 'Oculta'), ': las tiradas ocultas solo las ves tú.')),
          step('Combate', h('p', 'Arriba del mapa: ', h('b', '⚔ Iniciar combate'), ' tira iniciativa para todas las fichas visibles. ', h('b', 'Siguiente ▶'), ' pasa turno (y ronda). Clic en un retrato centra la cámara en esa ficha. Desde el panel de una ficha: ', h('b', '⚔ A iniciativa'), ' la añade sola.')),
          step('Objetos en partida', h('p', path('♟ Fichas', 'Objetos'), ': cofre, puerta, palanca, carta, llave, poción o bolsa; o convierte cualquier ficha con ', h('b', '📦 Objeto'), ' (el amuleto, el carruaje…). En su panel, ', h('b', '⚙ Configurar'), ' elige qué hace (recoger, abrir, leer, activar), su descripción, tu nota secreta, el texto de la carta, lo que hay dentro, si está cerrado y con qué prueba, y a cuántas casillas se usa. Los objetos no tienen PG ni entran en la iniciativa; ↻ los gira.'),
            tip('Activar te avisa a ti con tu nota secreta («la palanca abre la reja»): tú decides qué pasa.')),
          step('Hablar como un NPC', h('p', 'En el chat, el desplegable de arriba elige quién habla: tú, un NPC o cualquier ficha. Con ', h('b', '📜'), ' activado el mensaje sale además en un cuadro de diálogo con su retrato sobre el tablero. Desde una ficha de NPC, ', h('b', '📜 Hoja'), ' abre su hoja para tirar como él.')),
          step('Niebla de guerra', h('p', 'Abajo a la derecha del mapa: ', h('b', '☁ Sin niebla'), ' la activa. ', h('b', '👁'), ' revela y ', h('b', '🌑'), ' tapa casillas con el pincel (1×1 a 9×9); ', h('b', '✋'), ' vuelve a mover fichas. Tú la ves en transparencia; la visión de cada personaje está en su hoja (campo Visión, solo tú la cambias).')),
          step('Daño y estados', h('p', 'Clic en cualquier ficha → ', h('b', 'Daño'), ' / ', h('b', 'Curar'), ', estados, tamaño, renombrar o quitar. Una ficha a 0 PG se ve en gris.')),
          step('Música en vivo', h('p', path('🎵 Música'), ' — ▶ en una pista la pone para todos; ⏸ / ⏹, bucle y volumen general. 🔊 en un efecto lo hace sonar una vez.')),
          step('Lanzar y escenas paralelas', h('p', 'Cuando la escena esté lista pulsa ', h('b', '▶ Lanzar'), ': los jugadores marcados pasan a ella con un cartel de título. Si marcas solo a algunos, el grupo queda repartido en escenas paralelas; en ', path('🗺 Escena'), ' ves quién está en cada una y con ', h('b', '👁 Ver'), ' saltas entre ellas.')),
          step('Movimiento por turnos', h('p', 'Con la iniciativa en marcha, cada jugador solo mueve su ficha en su turno y hasta las casillas por turno de la escena (se cambian en ✎ Editar). Tú puedes mover cualquier ficha sin límite (empujones, caídas…).')))),
    ],
  },
};

export function guideView(root, { me, header, which = 'general' }) {
  const key = GUIDES[which] ? which : 'general';
  const g = GUIDES[key];
  const nav = h('nav.g-nav', Object.entries(GUIDES).map(([k, v]) => h(`a${k === key ? '.active' : ''}`, { href: `#/guia/${k}` }, v.title)));
  clear(root, h('div.page',
    me ? header() : h('header.topbar', h('a.brand', { href: '#/' }, h('img', { src: '/assets/d20.svg', alt: '' }), h('span', 'Dungeon', h('em', 'Dumbtastic'))),
      h('nav'), h('a.btn.small.primary', { href: '#/' }, 'Entrar')),
    h('main.lobby.guide',
      h('section.hero', h('div', h('h2', g.title), h('p.muted', g.sub))),
      nav,
      h('article.g-body', g.body(me)))));
  window.scrollTo(0, 0);
}
