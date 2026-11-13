// Lobby: campañas a las que pertenezco y mis personajes.
import { h, clear, field, toast, modal, confirmDialog, ROLE_LABEL } from '../ui.js';
import { api } from '../api.js';
import { sheetForm, DEMO_PORTRAITS } from '../sheet.js';

export async function lobbyView(root, { me, go, header }) {
  const campaignsBox = h('div.cards');
  const charsBox = h('div.cards');
  let campaigns = [];

  async function load() {
    try {
      const [list, { characters }] = await Promise.all([api.get('/campaigns'), api.get('/characters')]);
      campaigns = list.campaigns;
      renderCampaigns();
      renderChars(characters);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderCampaigns() {
    const canCreate = me.role === 'dm' || me.role === 'superadmin';
    clear(campaignsBox,
      campaigns.map((c) => h('article.card.campaign',
        h('div.card-img', { style: { backgroundImage: `url("${c.mapThumb || '/assets/demo/map-bosque.svg'}")` } },
          c.isDM ? h('span.badge.gold', 'Eres el DM') : h('span.badge', 'Jugador')),
        h('div.card-body',
          h('h3', c.name),
          h('p.muted', `DM: ${c.dm}`),
          h('p.tiny', c.players.length ? `Jugadores: ${c.players.join(', ')}` : 'Sin jugadores todavía'),
          h('div.row',
            h('button.btn.primary', { onclick: () => go(`#/mesa/${c.id}`) }, 'Entrar a la mesa'),
            c.isDM ? h('button.btn.ghost', { onclick: () => managePlayers(c) }, 'Jugadores') : null,
            c.isDM ? h('button.icon-btn', { title: 'Borrar campaña', onclick: () => removeCampaign(c) }, '🗑') : null)))),
      canCreate ? h('article.card.new', { onclick: createCampaign }, h('div.plus', '+'), h('p', 'Nueva campaña')) : null,
      !campaigns.length && !canCreate
        ? h('p.muted.empty-note', 'Aún no estás en ninguna campaña. Pídele a tu DM que te añada con tu usuario: ', h('b', me.username))
        : null);
  }

  function renderChars(characters) {
    clear(charsBox,
      characters.map((ch) => h('article.card.char',
        h('img.char-portrait', { src: ch.portrait || DEMO_PORTRAITS[0], alt: '' }),
        h('div.card-body',
          h('h3', ch.name),
          h('p.muted', [ch.race, ch.cls].filter(Boolean).join(' · ') || 'Aventurero', ` · Nv ${ch.level}`),
          h('p.tiny', campaigns.find((c) => c.id === ch.campaignId)?.name || 'Sin campaña'),
          h('div.row',
            h('button.btn.ghost', { onclick: () => editChar(ch) }, 'Editar'),
            h('button.icon-btn', { title: 'Borrar', onclick: () => removeChar(ch) }, '🗑'))))),
      h('article.card.new', { onclick: () => editChar(null) }, h('div.plus', '+'), h('p', 'Nuevo personaje')));
  }

  function createCampaign() {
    const name = h('input', { required: true, maxlength: 60, placeholder: 'La Maldición de la Cripta' });
    const m = modal('Nueva campaña', h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { campaign } = await api.post('/campaigns', { name: name.value });
          m.close();
          go(`#/mesa/${campaign.id}`);
        } catch (err) { toast(err.message, 'error'); }
      },
    }, field('Nombre', name), h('div.row.end', h('button.btn.primary', 'Crear y entrar'))));
  }

  async function managePlayers(c) {
    const list = h('div.list');
    const input = h('input', { placeholder: 'usuario del jugador', required: true });
    const refresh = async () => {
      const { campaigns: all } = await api.get('/campaigns');
      const fresh = all.find((x) => x.id === c.id);
      campaigns = all;
      renderCampaigns();
      clear(list, fresh?.players.length ? fresh.players.map((p) => h('div.list-row', h('span', p))) : h('p.muted', 'Nadie aún.'));
    };
    modal(`Jugadores · ${c.name}`, [
      h('form.row', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api.post(`/campaigns/${c.id}/players`, { username: input.value });
            toast('Jugador añadido', 'ok');
            input.value = '';
            refresh();
          } catch (err) { toast(err.message, 'error'); }
        },
      }, input, h('button.btn.primary', 'Añadir')),
      h('p.tiny.muted', 'Para quitar jugadores usa el panel “Jugadores” dentro de la mesa.'),
      list,
    ]);
    refresh();
  }

  async function removeCampaign(c) {
    if (!(await confirmDialog(`¿Borrar la campaña "${c.name}"? No se puede deshacer.`))) return;
    try {
      await api.del(`/campaigns/${c.id}`);
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function editChar(ch) {
    const m = modal(ch ? `Editar · ${ch.name}` : 'Nuevo personaje', sheetForm(ch, {
      campaigns,
      onSave: async (data) => {
        try {
          if (ch) await api.patch(`/characters/${ch.id}`, data);
          else await api.post('/characters', data);
          m.close();
          load();
          toast('Personaje guardado', 'ok');
        } catch (err) { toast(err.message, 'error'); }
      },
    }), { wide: true });
  }

  async function removeChar(ch) {
    if (!(await confirmDialog(`¿Borrar a ${ch.name}?`))) return;
    try {
      await api.del(`/characters/${ch.id}`);
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  clear(root, h('div.page',
    header(),
    h('main.lobby',
      h('section.hero',
        h('div', h('h2', `Bienvenido, ${me.displayName}`), h('p.muted', `Tu rol: ${ROLE_LABEL[me.role]}. Llamada por Discord, partida aquí.`))),
      h('section', h('h2.section-title', 'Campañas'), campaignsBox),
      h('section', h('h2.section-title', 'Mis personajes'), charsBox))));
  load();
  // Tiempo real: si el DM te añade a una campaña o cambian tus personajes, el lobby se actualiza solo.
  const socket = api.socket();
  socket.on('lobby:refresh', () => load());
  return () => socket.disconnect();
}
