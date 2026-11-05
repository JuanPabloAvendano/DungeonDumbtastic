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
    body: () => [
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
      h('section.g-sec',
        h('h3', 'Para el Super Admin'),
        h('ol.g-steps',
          step('Crear cuentas', h('p', path('Administración', 'Crear cuenta'), ' — usuario, nombre visible, contraseña y rol.')),
          step('Hacer DM a alguien', h('p', path('Administración', 'Cuentas', 'Rol'), ' — cambia el desplegable a ', h('b', 'Dungeon Master'), '.')),
          step('Registro abierto o cerrado', h('p', 'Casilla “Permitir que cualquiera cree su cuenta de jugador”.')),
          step('Monitor', h('p', path('Administración', 'Monitor'), ' — quién está conectado, memoria, errores, peticiones y el registro de eventos. Los logs completos se guardan en ', h('code', 'data/logs/app-AAAA-MM-DD.log'), ' (14 días).')))),
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
          step('Sube mapas', h('p', path('🗺 Escena', '⬆ Subir mapa'), ' — PNG, JPG, WEBP o GIF hasta 15 MB. Clic en un mapa de la lista = se lo muestras a todos.'),
            tip('Ajusta ', h('b', 'Cuadrícula'), ' (tamaño en px) hasta que coincida con las casillas del dibujo. 1 casilla = 5 pies. Si tu mapa ya trae cuadrícula, puedes ocultar la nuestra.')),
          step('Sube fichas de monstruos y PNJ', h('p', path('♟ Fichas', '⬆ Subir ficha nueva'), ' — imagen, nombre y PG. Hay un bestiario de ejemplo. Arrastra al mapa o haz clic para ponerla en el centro.'),
            tip('Marca ', h('b', 'Colocar ocultas'), ' para preparar emboscadas: solo tú las ves (semitransparentes). Clic en la ficha → ', h('b', '👁 Revelar'), '.')),
          step('Prepara la música', h('p', path('🎵 Música', '⬆ Subir pista'), ' — MP3, OGG, WAV, M4A, AAC o FLAC hasta 40 MB. Elige tipo: ', h('b', 'Música'), ' o ', h('b', 'Ambiente'), ' (suenan en bucle para todos) o ', h('b', 'Efecto'), ' (suena una vez).'))),
        tip('¿Prisa? En Escena, Fichas y Música hay botones ✦ para añadir el material de ejemplo.')),
      h('section.g-sec', h('h3', 'Dirigir'),
        h('ol.g-steps',
          step('Pedir pruebas', h('p', path('👥 Jugadores', 'Pedir una tirada'), ' — a un jugador o a todos, con característica, nombre de la prueba y CD. Marca ', h('b', 'Resultado oculto'), ' si no quieres que el resto lo vea.')),
          step('Tus tiradas secretas', h('p', 'En la bandeja de dados tienes ', h('b', 'CD'), ' y ', h('b', 'Oculta'), ': las tiradas ocultas solo las ves tú.')),
          step('Combate', h('p', 'Arriba del mapa: ', h('b', '⚔ Iniciar combate'), ' tira iniciativa para todas las fichas visibles. ', h('b', 'Siguiente ▶'), ' pasa turno (y ronda). Clic en un retrato centra la cámara en esa ficha. Desde el panel de una ficha: ', h('b', '⚔ A iniciativa'), ' la añade sola.')),
          step('Daño y estados', h('p', 'Clic en cualquier ficha → ', h('b', 'Daño'), ' / ', h('b', 'Curar'), ', estados, tamaño, renombrar o quitar. Una ficha a 0 PG se ve en gris.')),
          step('Música en vivo', h('p', path('🎵 Música'), ' — ▶ en una pista la pone para todos; ⏸ / ⏹, bucle y volumen general. 🔊 en un efecto lo hace sonar una vez.')),
          step('Cambiar de escena', h('p', path('🗺 Escena'), ' → clic en otro mapa. Las fichas se quedan donde estaban: retíralas o muévelas.')))),
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
      h('article.g-body', g.body()))));
  window.scrollTo(0, 0);
}
