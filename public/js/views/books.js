// Página de los libros: consultar conjuros, monstruos, objetos y reglas fuera de la mesa y, de paso,
// añadir lo encontrado a la barra de un personaje propio o crear un NPC en una campaña del DM.
import { h, clear, toast } from '../ui.js';
import { api } from '../api.js';
import { compendiumPanel } from '../compendium.js';
import { spellToAction, entryToFeature, monsterToCharacter } from '../compendium-convert.js';

const MAX_TARGETS = 4;

export async function booksView(root, { me, header }) {
  let characters = [];
  let campaigns = [];
  const addTo = async (ch, action) => {
    try {
      const { character } = await api.patch(`/characters/${ch.id}`, { ...ch, actions: [...(ch.actions || []), action] });
      characters = characters.map((c) => (c.id === character.id ? character : c));
      toast(`«${action.name}» en la barra de ${ch.name}`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };
  const actionsFor = (entry) => {
    if (entry.type === 'monstruo') {
      return campaigns.filter((c) => c.isDM).slice(0, MAX_TARGETS).map((c) => [`＋ NPC en «${c.name}»`, async () => {
        try {
          await api.post('/characters', { ...monsterToCharacter(entry), campaignId: c.id });
          toast(`«${entry.title}» creado como NPC en ${c.name}`, 'ok');
        } catch (err) { toast(err.message, 'error'); }
      }]);
    }
    const convert = (ch) => (entry.type === 'conjuro' ? spellToAction(entry, ch) : entryToFeature(entry, entry.type === 'objeto' ? 'action' : 'passive'));
    return characters.filter((c) => c.ownerId === me.id).slice(0, MAX_TARGETS).map((ch) => [`＋ ${ch.name}`, () => addTo(ch, convert(ch))]);
  };
  const panel = compendiumPanel({ actionsFor });
  clear(root, h('div.page', header(), h('main.books-page',
    h('section.hero', h('div', h('h2', 'Libros'),
      h('p.muted', 'Busca conjuros, monstruos, objetos mágicos y reglas en los libros importados. Puedes escribir en español: «bola de fuego», «poción de curación», «ataque furtivo».'))),
    panel.el)));
  try {
    [{ characters }, { campaigns }] = await Promise.all([api.get('/characters'), api.get('/campaigns')]);
  } catch (err) { toast(err.message, 'error'); }
  return null;
}
