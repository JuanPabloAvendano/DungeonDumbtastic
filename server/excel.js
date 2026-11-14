// Plantillas de Excel: descargar una plantilla (hecha desde import-schema.js, así sigue a las reglas)
// e importarla en una campaña: personajes, objetos propios, inventarios, escenas y fichas. Primero se
// prueba sin guardar (?prueba=1) y se ve el informe de errores por hoja y fila.
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { db, save } = require('./db');
const camp = require('./campaigns');
const sc = require('./scenes');
const { itemData } = require('./objects');
const { cleanTemplate } = require('./templates');
const { uniqueName } = require('./realtime-board');
const { SHEETS, YES_NO, parseCell } = require('./import-schema');
const { EQUIPMENT_PRESETS } = require('../public/js/inventory-rules.js');

const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const VALIDATION_ROWS = 500;
const DEFAULT_IMG = { criatura: '/assets/demo/token-goblin.svg', objeto: '/assets/objects/bolsa.svg' };
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const colLetter = (n) => (n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

/** La plantilla vacía: instrucciones, una hoja por tipo, encabezados con ejemplo y listas desplegables. */
async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DungeonDumbtastic';
  const info = wb.addWorksheet('Instrucciones');
  info.columns = [{ width: 22 }, { width: 110 }];
  info.addRow(['DungeonDumbtastic', 'Plantilla para crear muchas cosas de una vez. Rellena las hojas que quieras y súbela en la mesa (DM → Importar Excel).']);
  info.addRow(['', 'Las columnas con * son obligatorias. Las celdas con lista desplegable solo admiten esas opciones. Deja vacío lo que no uses.']);
  info.addRow(['', 'Primero usa «Probar» para ver los errores por hoja y fila; luego «Importar» para guardarlo.']);
  info.addRow([]);
  for (const sheet of SHEETS) info.addRow([sheet.name, sheet.help]);
  info.getColumn(1).font = { bold: true };

  for (const sheet of SHEETS) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FF1D1408' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3BF6A' } };
    sheet.columns.forEach((c, i) => {
      const example = sheet.example[c.key];
      if (example !== undefined && example !== '') ws.getCell(1, i + 1).note = `Ejemplo: ${example}`;
      const options = c.type === 'enum' ? c.options : c.type === 'bool' ? YES_NO : null;
      if (!options) return;
      const letter = colLetter(i + 1);
      for (let row = 2; row <= VALIDATION_ROWS; row++) {
        ws.getCell(`${letter}${row}`).dataValidation = {
          type: 'list', allowBlank: true, formulae: [`"${options.join(',')}"`],
          showErrorMessage: true, errorTitle: c.header, error: `Opciones: ${options.join(', ')}`,
        };
      }
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Filas con datos de cada hoja: { hoja: [{ row, values }] } y los errores de formato encontrados. */
async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('No es un archivo de Excel (.xlsx) válido');
  }
  const errors = [];
  const rows = {};
  for (const sheet of SHEETS) {
    const ws = wb.getWorksheet(sheet.name);
    rows[sheet.name] = [];
    if (!ws) continue;
    const headers = ws.getRow(1).values.slice(1).map((v) => String(v ?? '').trim());
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const values = {};
      try {
        sheet.columns.forEach((c) => {
          const idx = headers.indexOf(c.header);
          if (idx < 0) return;
          const v = parseCell(c, r.getCell(idx + 1).value);
          if (v !== undefined) values[c.key] = v;
        });
        if (!Object.keys(values).length) return;
        const missing = sheet.columns.find((c) => c.required && values[c.key] === undefined);
        if (missing) throw new Error(`Falta «${missing.header.replace(' *', '')}»`);
        rows[sheet.name].push({ row: n, values });
      } catch (err) {
        errors.push({ sheet: sheet.name, row: n, message: err.message });
      }
    });
  }
  return { rows, errors };
}

const characterInput = (v) => ({
  name: v.name, race: v.race, cls: v.cls, level: v.level, baseAc: v.baseAc, hp: v.hp ?? v.maxHp, maxHp: v.maxHp ?? v.hp,
  speed: v.speed, vision: v.vision, portrait: v.portrait, notes: v.notes,
  stats: Object.fromEntries(camp.ABILITIES.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])),
  coins: { cp: v.cp, sp: v.sp, ep: v.ep, gp: v.gp, pp: v.pp },
  ...(v.voicePreset || v.voicePitch !== undefined || v.voiceRate !== undefined || v.voiceName
    ? { voice: { preset: v.voicePreset, pitch: v.voicePitch, rate: v.voiceRate, name: v.voiceName } } : {}),
});

const templateInput = (v) => ({
  name: v.name, kind: v.kind, weight: v.weight, value: v.value, note: v.note, img: v.img,
  armor: { base: v.armorBase, type: v.armorType },
  weapon: { damage: v.damage, dmgType: v.dmgType, finesse: v.finesse, ranged: v.ranged, proficient: v.proficient },
  object: {
    use: v.use || 'recoger', description: v.description, secret: v.secret, text: v.text, range: v.range, locked: v.locked,
    ...(v.checkAbility ? { check: { ability: v.checkAbility, dc: v.checkDc ?? 10 } } : {}),
  },
});

/**
 * Aplica las filas a una copia de la campaña. Devuelve lo nuevo y lo cambiado (sin tocar la base) y
 * los errores por fila; commit() lo guarda.
 */
function plan(c, user, rows) {
  const errors = [];
  const fail = (sheet, row, err) => errors.push({ sheet, row, message: err.message });
  const users = db().users;
  const newChars = [];
  const changed = new Map();
  const newTemplates = [];
  const newScenes = [];
  const sceneTokens = new Map();
  let items = 0;
  let tokens = 0;

  for (const { row, values } of rows.Personajes) {
    try {
      let ownerId = c.dmId;
      if (values.player) {
        const u = users.find((x) => sameName(x.username, values.player));
        if (!u || !c.playerIds.includes(u.id)) throw new Error(`«${values.player}» no es jugador de esta campaña`);
        ownerId = u.id;
      }
      newChars.push({ id: crypto.randomUUID(), ownerId, campaignId: c.id, ...camp.sanitizeCharacter(characterInput(values)), createdAt: new Date().toISOString() });
    } catch (err) { fail('Personajes', row, err); }
  }

  for (const { row, values } of rows.Objetos) {
    try {
      newTemplates.push({ id: crypto.randomUUID(), ownerId: user.id, ...cleanTemplate(templateInput(values)), updatedAt: new Date().toISOString() });
    } catch (err) { fail('Objetos', row, err); }
  }

  const allTemplates = () => [...newTemplates, ...db().itemTemplates.filter((t) => t.ownerId === user.id)];
  const findChar = (name) => newChars.find((ch) => sameName(ch.name, name))
    || changed.get(camp.charactersOf(c).find((ch) => sameName(ch.name, name))?.id)
    || camp.charactersOf(c).find((ch) => sameName(ch.name, name));
  const itemFor = (name) => {
    const tpl = allTemplates().find((t) => sameName(t.name, name));
    if (tpl) return { ...itemData(tpl), img: tpl.img };
    const preset = EQUIPMENT_PRESETS.find((p) => sameName(p.name, name));
    return preset ? structuredClone(preset) : { name };
  };

  for (const { row, values } of rows.Inventario) {
    try {
      const ch = findChar(values.character);
      if (!ch) throw new Error(`No hay ningún personaje «${values.character}» (ni en la hoja ni en la campaña)`);
      const item = { ...itemFor(values.item), name: values.item, qty: values.qty ?? 1, equipped: values.equipped === true };
      const next = camp.sanitizeCharacter({ ...ch, inventory: [...(ch.inventory || []), item] }, ch);
      const isNew = newChars.indexOf(ch);
      if (isNew >= 0) newChars[isNew] = { ...ch, ...next };
      else changed.set(ch.id, { ...ch, ...next });
      items += 1;
    } catch (err) { fail('Inventario', row, err); }
  }

  for (const { row, values } of rows.Escenas) {
    try {
      const map = values.map ? c.maps.find((m) => sameName(m.name, values.map)) : null;
      if (values.map && !map) throw new Error(`No hay ningún mapa «${values.map}» en esta campaña: súbelo primero`);
      newScenes.push(sc.newScene({ name: values.name, mapId: map?.id || null, grid: values.gridSize ? { size: values.gridSize } : undefined, moveSquares: values.moveSquares }));
    } catch (err) { fail('Escenas', row, err); }
  }

  for (const { row, values } of rows.Fichas) {
    try {
      const scene = newScenes.find((s) => sameName(s.name, values.scene)) || c.scenes.find((s) => sameName(s.name, values.scene));
      if (!scene) throw new Error(`No hay ninguna escena «${values.scene}» (ni en la hoja ni en la campaña)`);
      const list = sceneTokens.get(scene.id) || [...scene.tokens];
      const type = values.type || 'criatura';
      const g = scene.grid;
      const base = {
        id: crypto.randomUUID(), x: g.ox + Math.max(0, (values.col ?? 1) - 1) * g.size, y: g.oy + Math.max(0, (values.row ?? 1) - 1) * g.size,
        size: camp.clampInt(values.size, 1, 6, 1), hidden: values.hidden === true, conditions: [],
      };
      let token;
      if (type === 'npc' || type === 'pj') {
        const ch = findChar(values.name);
        if (!ch) throw new Error(`No hay ningún personaje «${values.name}»`);
        if (list.some((t) => t.characterId === ch.id)) throw new Error(`${ch.name} ya está en «${scene.name}»`);
        token = { ...base, name: ch.name, img: ch.portrait || DEFAULT_IMG.criatura, ownerId: ch.ownerId === c.dmId ? null : ch.ownerId, characterId: ch.id, hp: ch.hp, maxHp: ch.maxHp };
      } else if (type === 'objeto') {
        const tpl = allTemplates().find((t) => sameName(t.name, values.name));
        if (!tpl) throw new Error(`No hay ningún objeto «${values.name}» en la hoja Objetos ni en Mis objetos`);
        token = { ...base, name: uniqueName(list, tpl.name), img: values.img || tpl.img || DEFAULT_IMG.objeto, ownerId: null, characterId: null, hp: 1, maxHp: 1, kind: 'objeto', object: { ...tpl.object, item: itemData(tpl) } };
      } else {
        const hp = camp.clampInt(values.hp, 1, 9999, 10);
        token = { ...base, name: uniqueName(list, values.name), img: values.img || DEFAULT_IMG.criatura, ownerId: null, characterId: null, hp, maxHp: hp, ac: camp.clampInt(values.ac, 0, 40, 10) };
      }
      sceneTokens.set(scene.id, [...list, token]);
      tokens += 1;
    } catch (err) { fail('Fichas', row, err); }
  }

  return {
    errors,
    created: { characters: newChars.length, templates: newTemplates.length, items, scenes: newScenes.length, tokens },
    commit() {
      db().characters = [...db().characters.map((ch) => changed.get(ch.id) || ch), ...newChars];
      db().itemTemplates = [...db().itemTemplates, ...newTemplates];
      c.scenes = [...c.scenes, ...newScenes].map((s) => (sceneTokens.has(s.id) ? { ...s, tokens: sceneTokens.get(s.id) } : s));
      save();
    },
  };
}

function registerExcel(r, { handle, httpError, logged, io }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_XLSX_BYTES, files: 1 } });

  r.get('/excel/plantilla', logged, async (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="dungeondumbtastic-plantilla.xlsx"');
      res.send(await buildTemplate());
    } catch (err) {
      res.status(500).json({ error: `No se pudo crear la plantilla: ${err.message}` });
    }
  });

  r.post('/campaigns/:id/importar', logged, (req, res) => {
    const c = camp.findCampaign(req.params.id);
    if (!c || !camp.canAccess(req.user, c)) return res.status(404).json({ error: 'Campaña no encontrada' });
    if (!camp.isDM(req.user, c)) return res.status(403).json({ error: 'Solo el DM importa en su campaña' });
    upload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Excel demasiado grande (máx 5 MB)' : err.message });
      if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo' });
      try {
        const { rows, errors: formatErrors } = await readWorkbook(req.file.buffer);
        const result = plan(c, req.user, rows);
        const dry = req.query.prueba === '1';
        if (!dry) {
          result.commit();
          io?.to(c.id).emit('toast', { kind: 'ok', text: 'El DM importó contenido desde Excel: recarga si no lo ves.' });
        }
        const order = SHEETS.map((s) => s.name);
        const errors = [...formatErrors, ...result.errors].sort((a, b) => order.indexOf(a.sheet) - order.indexOf(b.sheet) || a.row - b.row);
        res.json({ saved: !dry, created: result.created, errors });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });
  });
}

module.exports = { registerExcel, buildTemplate };
