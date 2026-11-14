// Esquema de la plantilla de Excel: qué hojas y columnas tiene y a qué campo del juego va cada una.
// Las listas (tipos de objeto, armaduras, usos en el mapa…) salen de las mismas constantes que usa el
// servidor, y uncoveredFields() compara con lo que de verdad aceptan los limpiadores: si alguien añade
// un campo al juego y no a la plantilla, la prueba lo dice. Así la plantilla sigue a la jugabilidad.
const { ITEM_KINDS, ARMOR_TYPES, USES, COIN_KEYS, cleanItem, cleanObject } = require('./objects');
const { sanitizeCharacter, ABILITIES } = require('./campaigns');
const { VOICE_PRESETS } = require('../public/js/tts.js');

const YES_NO = ['sí', 'no'];
const TOKEN_TYPES = ['criatura', 'npc', 'pj', 'objeto'];
const ABILITY_HEADER = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const COIN_HEADER = { cp: 'pc', sp: 'pp', ep: 'pe', gp: 'po', pp: 'ppt' };

const col = (key, header, field, type = 'text', extra = {}) => ({ key, header, field, type, ...extra });

const SHEETS = [
  {
    name: 'Personajes',
    help: 'Una fila por personaje. Sin «Jugador» es un NPC tuyo; con el usuario de un jugador de la campaña, es suyo.',
    example: { name: 'Grimbold', race: 'Enano', cls: 'Herrero', level: 3, baseAc: 12, hp: 24, maxHp: 24, speed: 25, str: 16, dex: 12, con: 14, gp: 40 },
    columns: [
      col('name', 'Nombre *', 'character:name', 'text', { required: true }),
      col('player', 'Jugador (usuario)', null),
      col('race', 'Raza', 'character:race'),
      col('cls', 'Clase', 'character:cls'),
      col('level', 'Nivel', 'character:level', 'int'),
      col('baseAc', 'CA sin armadura', 'character:baseAc', 'int'),
      col('hp', 'PG', 'character:hp', 'int'),
      col('maxHp', 'PG máx.', 'character:maxHp', 'int'),
      col('speed', 'Velocidad (pies)', 'character:speed', 'int'),
      col('vision', 'Visión (casillas)', 'character:vision', 'int'),
      ...ABILITIES.map((k) => col(k, ABILITY_HEADER[k], `character:stats.${k}`, 'int')),
      ...COIN_KEYS.map((k) => col(k, COIN_HEADER[k], `character:coins.${k}`, 'int')),
      col('voicePreset', 'Voz', 'character:voice.preset', 'enum', { options: Object.keys(VOICE_PRESETS) }),
      col('voicePitch', 'Tono de voz (0-2)', 'character:voice.pitch', 'num'),
      col('voiceRate', 'Velocidad de voz (0.5-2)', 'character:voice.rate', 'num'),
      col('voiceName', 'Voz del equipo (nombre)', 'character:voice.name'),
      col('portrait', 'Retrato (URL /uploads/…)', 'character:portrait'),
      col('notes', 'Notas', 'character:notes'),
    ],
  },
  {
    name: 'Objetos',
    help: 'Tus objetos personalizados: se guardan en «Mis objetos» y se pueden poner en inventarios y mapas.',
    example: { name: 'Hacha rúnica', kind: 'arma', weight: 4, value: 300, damage: '1d10', dmgType: 'cortante', use: 'recoger', description: 'Runas que brillan' },
    columns: [
      col('name', 'Nombre *', 'item:name', 'text', { required: true }),
      col('kind', 'Tipo', 'item:kind', 'enum', { options: ITEM_KINDS }),
      col('weight', 'Peso (lb)', 'item:weight', 'num'),
      col('value', 'Valor (po)', 'item:value', 'num'),
      col('note', 'Qué es / qué hace', 'item:note'),
      col('img', 'Imagen (URL /uploads/…)', 'item:img'),
      col('armorBase', 'CA base (armadura)', 'item:armor.base', 'int'),
      col('armorType', 'Tipo de armadura', 'item:armor.type', 'enum', { options: ARMOR_TYPES }),
      col('damage', 'Daño (arma, p. ej. 1d8)', 'item:weapon.damage'),
      col('dmgType', 'Tipo de daño', 'item:weapon.dmgType'),
      col('finesse', 'Sutil', 'item:weapon.finesse', 'bool'),
      col('ranged', 'A distancia', 'item:weapon.ranged', 'bool'),
      col('proficient', 'Competente', 'item:weapon.proficient', 'bool'),
      col('use', 'En el mapa', 'object:use', 'enum', { options: USES }),
      col('description', 'Descripción (la ven todos)', 'object:description'),
      col('secret', 'Nota secreta (DM)', 'object:secret'),
      col('text', 'Texto que se lee', 'object:text'),
      col('range', 'Alcance (casillas)', 'object:range', 'int'),
      col('locked', 'Cerrado con llave', 'object:locked', 'bool'),
      col('checkAbility', 'Prueba para abrir', 'object:check.ability', 'enum', { options: ABILITIES }),
      col('checkDc', 'CD', 'object:check.dc', 'int'),
    ],
  },
  {
    name: 'Inventario',
    help: 'Qué lleva cada personaje. El objeto puede ser de la hoja «Objetos», de «Mis objetos», del equipo del SRD (Cota de malla, Espada larga…) o uno nuevo solo con su nombre.',
    example: { character: 'Grimbold', item: 'Cota de malla', qty: 1, equipped: 'sí' },
    columns: [
      col('character', 'Personaje *', null, 'text', { required: true }),
      col('item', 'Objeto *', null, 'text', { required: true }),
      col('qty', 'Cantidad', 'item:qty', 'int'),
      col('equipped', 'Equipado', 'item:equipped', 'bool'),
    ],
  },
  {
    name: 'Escenas',
    help: 'Escenas nuevas de la campaña. «Mapa» es el nombre de un mapa que ya subiste a esta campaña (vacío: sin mapa).',
    example: { name: 'La forja', map: '', gridSize: 70, moveSquares: 6 },
    columns: [
      col('name', 'Nombre *', null, 'text', { required: true }),
      col('map', 'Mapa (nombre)', null),
      col('gridSize', 'Casilla (px)', null, 'int'),
      col('moveSquares', 'Movimiento (casillas)', null, 'int'),
    ],
  },
  {
    name: 'Fichas',
    help: 'Qué hay en cada escena y dónde (columna y fila de la cuadrícula, desde 1). «npc»/«pj» usan un personaje por su nombre; «objeto», uno de tus objetos.',
    example: { scene: 'La forja', name: 'Ogro', type: 'criatura', col: 6, row: 3, size: 2, hp: 59, hidden: 'sí' },
    columns: [
      col('scene', 'Escena *', null, 'text', { required: true }),
      col('name', 'Nombre *', null, 'text', { required: true }),
      col('type', 'Tipo', null, 'enum', { options: TOKEN_TYPES }),
      col('col', 'Columna', null, 'int'),
      col('row', 'Fila', null, 'int'),
      col('size', 'Tamaño (casillas)', null, 'int'),
      col('hp', 'PG', null, 'int'),
      col('ac', 'CA (criaturas)', null, 'int'),
      col('hidden', 'Oculta', null, 'bool'),
      col('img', 'Imagen (URL /uploads/…)', null),
    ],
  },
];

// Campos que la plantilla no cubre a propósito (y por qué). Lo demás debe tener columna.
const NOT_IN_TEMPLATE = {
  character: {
    ac: 'se calcula sola con la armadura', actions: 'la barra de acciones se arma en la mesa', slots: 'espacios de conjuro: en la mesa',
    inventory: 'va en la hoja Inventario',
  },
  item: { id: 'interno' },
  object: {
    contents: 'contenido de contenedores: en la mesa', open: 'estado de partida', used: 'estado de partida', rot: 'giro en el mapa',
    item: 'sale de la propia fila de Objetos',
  },
};

/** Rutas de campos («stats.str», «weapon.damage») de un objeto ya limpio. */
function fieldPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) && ['stats', 'coins', 'voice', 'weapon', 'armor', 'check'].includes(k)
    ? fieldPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

/** Campos que acepta el juego y no tienen columna ni excusa: deberían estar vacíos. */
function uncoveredFields() {
  const covered = new Set(SHEETS.flatMap((s) => s.columns.map((c) => c.field)).filter(Boolean));
  const produced = {
    character: fieldPaths(sanitizeCharacter({ name: 'x' })),
    item: [...new Set([
      ...fieldPaths(cleanItem({ name: 'x', kind: 'arma' })), ...fieldPaths(cleanItem({ name: 'x', kind: 'armadura' })),
    ])],
    object: fieldPaths(cleanObject({ check: { ability: 'str', dc: 10 } })),
  };
  return Object.entries(produced).flatMap(([domain, paths]) => paths
    .filter((p) => !NOT_IN_TEMPLATE[domain][p.split('.')[0]] && !covered.has(`${domain}:${p}`))
    .map((p) => `${domain}:${p}`));
}

/** Convierte una celda según el tipo de la columna; lanza un error legible si no encaja. */
function parseCell(column, raw) {
  const v = raw && typeof raw === 'object' ? (raw.result ?? raw.text ?? raw.richText?.map((t) => t.text).join('') ?? '') : raw;
  if (v === null || v === undefined || String(v).trim() === '') return undefined;
  const s = String(v).trim();
  switch (column.type) {
    case 'int':
    case 'num': {
      const n = Number(s.replace(',', '.'));
      if (!Number.isFinite(n)) throw new Error(`«${column.header}» debe ser un número (llegó «${s}»)`);
      return column.type === 'int' ? Math.round(n) : n;
    }
    case 'bool': {
      const low = s.toLowerCase();
      if (['sí', 'si', 'yes', 'x', '1', 'true', 'verdadero'].includes(low)) return true;
      if (['no', '0', 'false', 'falso'].includes(low)) return false;
      throw new Error(`«${column.header}» es sí o no (llegó «${s}»)`);
    }
    case 'enum': {
      const hit = column.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (!hit) throw new Error(`«${column.header}» no admite «${s}» (opciones: ${column.options.join(', ')})`);
      return hit;
    }
    default:
      return s;
  }
}

module.exports = { SHEETS, YES_NO, TOKEN_TYPES, parseCell, uncoveredFields };
