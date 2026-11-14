// Inventario en la mesa: lo que se puede hacer con cada objeto de la hoja (equipar, atacar, dar,
// usar, gastar, soltar, pasar a la barra) y el botín del DM. Sale de table.js para mantenerlo manejable.
import { toast, signed } from '../ui.js';
import { api } from '../api.js';
import { giveDialog, lootDialog } from '../inventory-ui.js';
import { formatGp, coinsValueGp } from '../inventory-rules.js';
import { uniqueLabels } from '../speakers.js';
import { openAttackDialog } from './attack.js';

/**
 * Acciones del inventario de un personaje. `s` es el estado de la mesa; `emit` manda al servidor
 * con respuesta; `chat` y `roll` hablan y tiran como ese personaje.
 */
export function itemHooksFor({ ch, s, emit, chat, roll }) {
  const save = (inventory) => api.patch(`/characters/${ch.id}`, { ...ch, inventory }).catch((err) => toast(err.message, 'error'));
  const others = s.characters.filter((x) => x.id !== ch.id).map((x) => ({ id: x.id, name: x.name }));
  return {
    others,
    // Poner una armadura o escudo quita el que ya llevaba del mismo tipo.
    equip: (it) => save(ch.inventory.map((x) => {
      if (x.id === it.id) return { ...x, equipped: !it.equipped };
      return !it.equipped && x.kind === it.kind && it.kind !== 'arma' ? { ...x, equipped: false } : x;
    })),
    give: (it) => giveDialog({
      title: `Dar «${it.name}»`, others, maxQty: it.qty,
      onGive: ({ toId, qty }) => emit('item:give', { fromId: ch.id, toId, itemId: it.id, qty }),
    }),
    attack: (it, a) => openAttackDialog({
      weapon: it.name, toHit: a.toHit, damage: a.damage,
      targets: uniqueLabels(s.tokens.filter((t) => t.characterId !== ch.id && t.kind !== 'objeto').map((t) => [t.id, t.name])).map(([id, name]) => ({ id, name })),
      onAttack: ({ targetId, mode }) => emit('attack', { characterId: ch.id, targetId, mode, toHit: `1d20${signed(a.toHit)}`, damage: a.damage, label: `Ataque con ${it.name}` }),
      onPlainRoll: () => roll({ characterId: ch.id, expr: `1d20${signed(a.toHit)}`, label: `Ataque con ${it.name}` }),
    }),
    giveCoins: () => giveDialog({
      title: 'Dar monedas', others, coins: ch.coins,
      onGive: ({ toId, coins }) => emit('coins:give', { fromId: ch.id, toId, coins }),
    }),
    use: (it) => chat({ characterId: ch.id, text: `🎒 usa «${it.name}»${it.note ? ` — ${it.note}` : ''}` }),
    spend: (it) => save(it.qty > 1 ? ch.inventory.map((x) => (x.id === it.id ? { ...x, qty: x.qty - 1 } : x)) : ch.inventory.filter((x) => x.id !== it.id)),
    drop: (it) => emit('item:drop', { characterId: ch.id, itemId: it.id }),
    toBar: (it) => api.patch(`/characters/${ch.id}`, {
      ...ch, actions: [...(ch.actions || []), { id: `a${Date.now().toString(36)}`, name: it.name.slice(0, 40), kind: 'free', note: it.note || '', spellLevel: null }],
    }).then(() => toast(`«${it.name}» en la barra`, 'ok')).catch((err) => toast(err.message, 'error')),
  };
}

/** Botín del DM: monedas repartidas o un objeto; avisa de lo que sobra sin repartir. */
export function openLootFor(s, emit) {
  lootDialog({
    characters: s.characters,
    onGive: async (payload, dialog) => {
      const res = await emit('loot:give', payload);
      if (!res?.ok) return;
      dialog.close();
      const left = res.rest && coinsValueGp(res.rest);
      toast(left ? `Botín repartido. Sobra ${formatGp(left)} sin repartir.` : 'Botín entregado', 'ok');
    },
  });
}
