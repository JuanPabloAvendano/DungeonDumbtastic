// Importar desde Excel (DM): descargar la plantilla, probar el archivo (informe sin guardar) e importarlo.
import { h, clear, toast, modal } from '../ui.js';
import { api } from '../api.js';

const LABEL = { characters: 'personajes', templates: 'objetos propios', items: 'cosas en inventarios', scenes: 'escenas', tokens: 'fichas' };

async function send(campaignId, file, dry) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/campaigns/${campaignId}/importar${dry ? '?prueba=1' : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${api.token()}` }, body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function report(box, { saved, created, errors }) {
  const made = Object.entries(created).filter(([, n]) => n).map(([k, n]) => `${n} ${LABEL[k]}`);
  clear(box,
    h('p', saved ? '✅ Importado: ' : '🔎 Si lo importas se crearán: ', made.length ? made.join(', ') : 'nada'),
    errors.length ? h('div.col',
      h('p.tiny', `⚠ ${errors.length} ${errors.length === 1 ? 'fila no se importa' : 'filas no se importan'}:`),
      h('div.excel-errors', errors.map((e) => h('div.excel-error', h('b', `${e.sheet} · fila ${e.row}`), h('span', e.message))))) : null);
}

/** Diálogo de importación para la campaña abierta. */
export function openExcelImport(campaignId) {
  const file = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const out = h('div.excel-report');
  const run = async (dry) => {
    const f = file.files?.[0];
    if (!f) return toast('Elige primero el archivo de Excel', 'error');
    try {
      const res = await send(campaignId, f, dry);
      report(out, res);
      if (!dry) setTimeout(() => location.reload(), 1500);
    } catch (err) { toast(err.message, 'error'); }
  };
  modal('📊 Importar desde Excel', [
    h('p.muted.tiny', 'Crea de una vez personajes y NPC, tus objetos, lo que lleva cada uno, escenas y lo que hay en cada una. La plantilla se genera con las reglas actuales del juego: descárgala de nuevo si añadimos cosas.'),
    h('button.btn', { onclick: () => api.download('/excel/plantilla', 'dungeondumbtastic-plantilla.xlsx').catch((err) => toast(err.message, 'error')) }, '⬇ Descargar plantilla'),
    h('div.row', file),
    h('div.row.end',
      h('button.btn.ghost', { onclick: () => run(true) }, '🔎 Probar (no guarda)'),
      h('button.btn.primary', { onclick: () => run(false) }, '📥 Importar')),
    out,
  ], { wide: true });
}
