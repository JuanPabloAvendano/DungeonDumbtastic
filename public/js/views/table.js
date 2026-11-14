// La mesa de juego: une tablero, paneles, tiradas, chat, música, dados 3D y tiempo real.
import { h, clear, toast, modal, confirmDialog, mod, signed, ABILITIES } from '../ui.js';
import { api } from '../api.js';
import { Board } from '../board.js';
import { DiceOverlay } from '../dice3d.js';
import { MusicPlayer } from '../music.js';
import {
  tokensPanel, partyPanel, playersPanel, characterPanel, musicPanel, diceTray, initiativeBar,
} from './table-panels.js';
import { scenePanel, openLaunchDialog } from './scenes.js';
import { playSheet } from '../sheet.js';
import { createNotes } from './notes.js';
import { objectInspector, objectDmControls } from './objects.js';
import { actionBar, spend, rest } from '../actions.js';
import { spellToAction, entryToFeature, monsterToCharacter } from '../compendium-convert.js';
import { findSpeakers, splitMention, uniqueLabels } from '../speakers.js';
import { openReactionPrompt } from './attack.js';
import { itemHooksFor, openLootFor } from './table-items.js';
import { chatEntry, rollEntry } from './log-entries.js';
import { shouldSpeak, speak, voiceForName } from '../tts.js';
import { speechSettings } from '../voice-ui.js';

const CONDITIONS = ['Envenenado', 'Aturdido', 'Derribado', 'Asustado', 'Agarrado', 'Invisible', 'Concentrado', 'Bendecido', 'Cegado', 'Paralizado'];
const PREFS_KEY = 'da.prefs';
const LOG_REVEAL_MS = 2000;
const LIST_LIMIT = 200;
const TITLE_CARD_MS = 3200;
const DIALOG_MIN_MS = 5000;
const DIALOG_MS_PER_CHAR = 60;

let dice = null;

function loadPrefs() {
  const base = { bigOthers: false, placeHidden: false, rightOpen: false, rightTab: 'rolls', leftOpen: true, trayOpen: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return base; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}

export function tableView(root, { me, go, campaignId }) {
  dice = dice || new DiceOverlay();
  const socket = api.socket();
  const prefs = loadPrefs();
  let s = null;
  let online = [];
  let tab = null;
  let bestiary = [];
  let selectedId = null;
  let lastTurn = null;
  // Con quién habla y tira este usuario: '' = él mismo, 'c:<id>' = un personaje, 't:<id>' = una ficha (DM).
  let actAs = '';
  let dialogMode = false;
  const unread = { rolls: 0, chat: 0 };

  const music = new MusicPlayer({
    onBlocked: () => { renderTop(); if (tab === 'musica') renderLeft(); },
    onChange: () => renderTop(),
  });

  // ---------- estructura ----------
  const tbar = h('header.tbar');
  const leftTabs = h('div.ltabs');
  const leftBody = h('div.lbody');
  const left = h('aside.tleft', leftTabs, leftBody);
  const iniBox = h('div.ini-box');
  const inspector = h('div.inspector.hidden');
  const boardBox = h('div.board-box');
  const trayBox = h('div.tray-box');
  const hotbarBox = h('div.hotbar-box.hidden');
  const banner = h('div.scene-banner.hidden');
  const leftHandle = h('button.edge-handle.left-handle', { onclick: () => { prefs.leftOpen = !prefs.leftOpen; applyLayout(); } });
  const trayHandle = h('button.edge-handle.tray-handle', { onclick: () => { prefs.trayOpen = !prefs.trayOpen; applyLayout(); } });
  const center = h('section.tcenter', boardBox, iniBox, inspector, hotbarBox, trayBox);

  const rollList = h('div.log.rolls');
  const chatList = h('div.log.chat-log');
  const chatInput = h('input', { placeholder: 'Escribe… (/r 1d20+5 para tirar)', maxlength: 1000 });
  // Quién habla: se escribe para buscar (o se empieza el mensaje con @nombre).
  const speakerList = h('datalist', { id: 'speaker-list' });
  const speakerSel = h('input.speaker', {
    list: 'speaker-list', placeholder: 'Hablar como… (escribe para buscar)', autocomplete: 'off',
    title: 'Hablar y tirar como… Escribe parte del nombre, o empieza el mensaje con @nombre',
    onfocus: (e) => e.target.select(),
    onchange: (e) => pickSpeaker(e.target.value),
    onblur: () => renderSpeaker(),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); pickSpeaker(e.target.value); chatInput.focus(); } },
  });
  const dialogBtn = h('button.icon-btn.small', { type: 'button', onclick: () => { dialogMode = !dialogMode; renderSpeaker(); } }, '📜');
  const chatForm = h('form.chat', { onsubmit: (e) => { e.preventDefault(); sendChat(); } },
    h('div.chat-as', speakerSel, speakerList, dialogBtn), chatInput, h('button.btn.primary', { title: 'Enviar' }, '➤'));
  const dialogBox = h('div.npc-dialog.hidden');
  const fogBar = h('div.fog-bar.hidden');
  // Pincel de niebla del DM: null = mover y seleccionar fichas.
  let fogBrush = null;
  let brushSize = 1;
  const rail = h('div.rail');
  const drawerTabs = h('div.dtabs');
  const booksPane = h('div.books-pane');
  const docsPane = h('div.books-pane.docs-pane');
  const drawer = h('div.drawer', drawerTabs, rollList, h('div.chat-pane', chatList, chatForm), booksPane, docsPane);
  const right = h('aside.tright', rail, drawer);
  const screen = h('div.table-screen', tbar, h('div.tmain', left, center, right));
  clear(root, screen);

  const emit = (event, payload) => new Promise((resolve) => {
    socket.emit(event, payload, (res) => {
      if (res?.error) toast(res.error, 'error');
      resolve(res);
    });
  });

  const combat = () => Boolean(s?.initiative.entries.length);
  const turnTokenId = () => s?.initiative.turnState?.tokenId || null;
  // En combate el jugador solo mueve su ficha en su turno; el DM siempre.
  const canMove = (t) => Boolean(s && (s.isDM || (t.ownerId === me.id && (!combat() || turnTokenId() === t.id))));

  const board = new Board(boardBox, {
    canMove,
    onMove: (id, x, y, final) => socket.emit('token:update', { id, x, y, final }, final ? (r) => r?.error && toast(r.error, 'error') : undefined),
    onSelect: (t) => { selectedId = t?.id || null; renderInspector(); },
    onPing: (x, y) => socket.emit('ping', { x, y }),
    onDrop: (data, x, y) => emit('token:add', { ...data, x, y, hidden: s.isDM && prefs.placeHidden }),
    onFogPaint: (cells, mode) => emit('fog:paint', { cells, mode }),
    // Con el tamaño real del mapa ya se sabe qué fichas quedaron fuera.
    onMapReady: () => renderLeft(),
  });
  // Que el tablero no capture el puntero (paneo) al pulsar las asas.
  [leftHandle, trayHandle].forEach((el) => ['pointerdown', 'dblclick', 'wheel'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation())));
  boardBox.append(banner, dialogBox, fogBar, leftHandle, trayHandle);
  ['pointerdown', 'dblclick', 'wheel'].forEach((ev) => fogBar.addEventListener(ev, (e) => e.stopPropagation()));

  const ctx = {
    get s() { return s; },
    get online() { return online; },
    get bestiary() { return bestiary; },
    /** Guarda una criatura en el bestiario propio del DM (sirve en todas sus campañas). */
    saveBeast: async ({ name, img, hp, size, kind, object }) => {
      try {
        const { beast } = await api.post('/bestiary', { name, img, hp, size, kind, object });
        bestiary = [...bestiary, beast];
        if (tab === 'fichas') renderLeft();
        toast(`«${beast.name}» guardada en tus bestias`, 'ok');
      } catch (err) { toast(err.message, 'error'); }
    },
    deleteBeast: async (beast) => {
      try {
        await api.del(`/bestiary/${beast.id}`);
        bestiary = bestiary.filter((b) => b.id !== beast.id);
        if (tab === 'fichas') renderLeft();
      } catch (err) { toast(err.message, 'error'); }
    },
    me, board, emit, prefs, music,
    get actAs() { return actAs; },
    /** Personaje con el que actúa ahora el jugador (o el DM si habla como un NPC). */
    get actingCharacter() { return actingCharacter(); },
    setActAs: (v) => setActAs(v),
    roll: (r) => rollGated({ ...speakerPayload(), ...r }),
    viewScene: (id) => emit('scene:view', { id }),
    /** Devuelve fichas al centro visible del mapa, en fila para que no se tapen, y encuadra la primera. */
    recallTokens: async (tokens) => {
      const c = board.center();
      for (const [i, t] of tokens.entries()) {
        const p = board.snapToMap(c.x + i * board.grid, c.y, t.size);
        await emit('token:update', { id: t.id, x: p.x, y: p.y, final: true });
      }
      if (tokens[0]) board.focusToken(tokens[0].id);
    },
    /** Acciones del inventario en la hoja (ver table-items.js). */
    itemHooks: (ch) => itemHooksFor({ ch, s, emit, chat: (p) => socket.emit('chat', p), roll: (r) => ctx.roll(r) }),
    changeCharacterHp: async (ch, delta) => {
      try { await api.patch(`/characters/${ch.id}`, { ...ch, hp: Math.min(ch.maxHp, ch.hp + delta) }); } catch (err) { toast(err.message, 'error'); }
    },
  };

  // Las notas se crean una vez: así no se pierde lo que se está escribiendo cuando llegan cambios.
  const notes = createNotes(ctx);
  const openNotesFor = (characterId) => {
    tab = 'notas';
    Object.assign(prefs, { leftOpen: true });
    applyLayout();
    renderLeft();
    notes.openFor(characterId);
  };

  // ---------- paneles laterales ----------
  function applyLayout() {
    screen.classList.toggle('right-open', prefs.rightOpen);
    screen.classList.toggle('left-closed', !prefs.leftOpen);
    screen.classList.toggle('tray-closed', !prefs.trayOpen);
    leftHandle.textContent = prefs.leftOpen ? '‹' : '›';
    leftHandle.title = prefs.leftOpen ? 'Ocultar panel izquierdo' : 'Mostrar panel izquierdo';
    trayHandle.textContent = prefs.trayOpen ? '🎲 ▾' : '🎲 Dados ▴';
    trayHandle.title = prefs.trayOpen ? 'Ocultar bandeja de dados' : 'Mostrar bandeja de dados';
    drawer.dataset.tab = prefs.rightTab;
    if (prefs.rightOpen) unread[prefs.rightTab] = 0;
    renderRail();
    savePrefs(prefs);
  }

  function openRight(which) {
    if (prefs.rightOpen && prefs.rightTab === which) prefs.rightOpen = false;
    else Object.assign(prefs, { rightOpen: true, rightTab: which });
    applyLayout();
    if (prefs.rightOpen) {
      if (which === 'libros') return openBooks();
      if (which === 'docs') return openDocs();
      const list = which === 'chat' ? chatList : rollList;
      list.scrollTop = list.scrollHeight;
      if (which === 'chat') chatInput.focus();
    }
  }

  // ---------- documentos propios ----------
  let docs = null;
  async function openDocs() {
    if (docs) return docs.focus();
    const { documentsPanel } = await import('./documents.js');
    docs = documentsPanel({ campaign: { id: s.id, name: s.name, isDM: s.isDM, players: s.users.filter((u) => u.id !== me.id) } });
    clear(docsPane, docs.el);
  }

  // ---------- libros (compendio) ----------
  let books = null;
  /** El buscador se carga la primera vez que se abre el panel. */
  async function openBooks() {
    if (books) return books.focus();
    const { compendiumPanel } = await import('../compendium.js');
    books = compendiumPanel({ compact: true, actionsFor: bookActions });
    clear(booksPane, books.el);
  }

  /** Qué se puede hacer con una entrada desde la mesa: añadirla a la barra de quien actúa o crear un NPC. */
  function bookActions(entry) {
    const out = [];
    const ch = hotbarCharacter();
    const addTo = (action) => saveCharacter({ ...ch, actions: [...(ch.actions || []), action] }).then(() => toast(`«${action.name}» en la barra de ${ch.name}`, 'ok'));
    if (ch && entry.type === 'conjuro') out.push([`＋ A la barra de ${ch.name}`, () => addTo(spellToAction(entry, ch))]);
    if (ch && entry.type === 'objeto') out.push([`＋ Objeto de ${ch.name}`, () => addTo(entryToFeature(entry, 'action'))]);
    if (ch && entry.type === 'texto') out.push([`＋ Rasgo de ${ch.name}`, () => addTo(entryToFeature(entry, 'passive'))]);
    if (s.isDM && entry.type === 'monstruo') {
      out.push(['＋ Crear NPC con este perfil', async () => {
        try {
          await api.post('/characters', { ...monsterToCharacter(entry), campaignId: s.id });
          toast(`«${entry.title}» está en ♟ Fichas › NPC, con sus ataques en la barra`, 'ok');
        } catch (err) { toast(err.message, 'error'); }
      }]);
    }
    return out;
  }

  function renderRail() {
    const btn = (which, icon, label) => h(`button.rail-btn${prefs.rightOpen && prefs.rightTab === which ? '.on' : ''}`, {
      title: label, onclick: () => openRight(which),
    }, icon, unread[which] ? h('span.unread', unread[which] > 99 ? '99+' : unread[which]) : null);
    clear(rail, btn('rolls', '🎲', 'Historial de tiradas'), btn('chat', '💬', 'Chat'), btn('libros', '📖', 'Libros: conjuros, monstruos, objetos y reglas'), btn('docs', '📄', 'Documentos: los tuyos y los que te comparten'));
    clear(drawerTabs,
      h(`button.dtab${prefs.rightTab === 'rolls' ? '.active' : ''}`, { onclick: () => { prefs.rightTab = 'rolls'; applyLayout(); } }, '🎲 Tiradas'),
      h(`button.dtab${prefs.rightTab === 'chat' ? '.active' : ''}`, { onclick: () => { prefs.rightTab = 'chat'; applyLayout(); chatInput.focus(); } }, '💬 Chat'),
      h(`button.dtab${prefs.rightTab === 'libros' ? '.active' : ''}`, { onclick: () => { prefs.rightTab = 'libros'; applyLayout(); openBooks(); } }, '📖 Libros'),
      h(`button.dtab${prefs.rightTab === 'docs' ? '.active' : ''}`, { onclick: () => { prefs.rightTab = 'docs'; applyLayout(); openDocs(); } }, '📄 Docs'),
      h('button.icon-btn.small', { title: 'Ocultar panel', onclick: () => { prefs.rightOpen = false; applyLayout(); } }, '»'));
  }

  // ---------- con quién actúa / habla ----------
  const myCharacters = () => (s ? s.characters.filter((ch) => ch.ownerId === me.id) : []);

  function actingCharacter() {
    const id = actAs.startsWith('c:') ? actAs.slice(2) : null;
    return (id && s?.characters.find((ch) => ch.id === id)) || null;
  }

  /** Lo que se manda al servidor para firmar chat y tiradas con el personaje elegido. */
  function speakerPayload() {
    if (actAs.startsWith('c:')) return { characterId: actAs.slice(2) };
    if (actAs.startsWith('t:')) return { tokenId: actAs.slice(2) };
    return {};
  }

  /** Un jugador siempre actúa como uno de sus personajes; si el elegido ya no existe, el primero. */
  function normalizeActAs() {
    if (!s) return;
    const valid = speakerOptions().some(([v]) => v === actAs);
    if (!valid) actAs = !s.isDM && myCharacters()[0] ? `c:${myCharacters()[0].id}` : '';
  }

  function speakerOptions() {
    const mine = myCharacters().map((ch) => [`c:${ch.id}`, ch.name]);
    if (!s.isDM) return mine.length ? mine : [['', me.displayName]];
    const npcs = s.characters.filter((ch) => ch.ownerId !== me.id).map((ch) => [`c:${ch.id}`, `${ch.name} (PJ)`]);
    const tokens = s.tokens.filter((t) => !t.characterId).map((t) => [`t:${t.id}`, t.name]);
    return uniqueLabels([['', `${me.displayName} (DM)`], ...mine.map(([v, n]) => [v, `${n} (NPC)`]), ...tokens, ...npcs]);
  }

  /** Elige quién habla por el texto escrito: la etiqueta exacta o, si no, la mejor coincidencia. */
  function pickSpeaker(query) {
    const opts = speakerOptions();
    const hit = opts.find(([, label]) => label === query) || findSpeakers(opts, query)[0];
    if (hit) setActAs(hit[0]);
    else renderSpeaker();
  }

  function setActAs(v) {
    actAs = v;
    normalizeActAs();
    renderSpeaker();
    if (tab === 'personaje') renderLeft();
    renderIni();
    renderHotbar();
  }

  function renderSpeaker() {
    if (!s) return;
    normalizeActAs();
    const opts = speakerOptions();
    clear(speakerList, opts.map(([, label]) => h('option', { value: label })));
    if (document.activeElement !== speakerSel) speakerSel.value = opts.find(([v]) => v === actAs)?.[1] || '';
    speakerSel.classList.toggle('hidden', opts.length < 2);
    const canDialog = s.isDM && actAs !== '';
    dialogBtn.classList.toggle('hidden', !canDialog);
    dialogBtn.classList.toggle('on', canDialog && dialogMode);
    dialogBtn.title = dialogMode ? 'Diálogo activado: el mensaje sale en un cuadro sobre el tablero' : 'Mostrar el mensaje como diálogo sobre el tablero';
  }

  // ---------- barra de acciones ----------
  /** Personaje cuya barra se muestra: el elegido o, para un jugador, su primer personaje. */
  const hotbarCharacter = () => actingCharacter() || (s.isDM ? null : myCharacters()[0]) || null;

  /** Qué no puede gastar ahora en combate (acción y adicional solo en su turno; una reacción por ronda). */
  function turnLimits(ch) {
    const token = s.tokens.find((t) => t.characterId === ch.id);
    const ini = s.initiative;
    if (!combat() || !token || !ini.entries.some((e) => e.tokenId === token.id)) return null;
    const mine = ini.turnState?.tokenId === token.id;
    const reacted = Boolean(ini.reactions?.[token.id]) && 'Ya usó su reacción esta ronda';
    if (!mine) return { action: 'No es su turno', bonus: 'No es su turno', reaction: reacted };
    return { action: ini.turnState.action, bonus: ini.turnState.bonus, reaction: reacted };
  }

  async function saveCharacter(next) {
    try { await api.patch(`/characters/${next.id}`, next); } catch (err) { toast(err.message, 'error'); }
  }

  async function useAction(ch, a, slotLevel) {
    const next = spend(ch, a, slotLevel);
    if (a.uses || slotLevel) await saveCharacter(next);
    const token = s.tokens.find((t) => t.characterId === ch.id);
    const ts = s.initiative.turnState;
    const limits = turnLimits(ch);
    if (limits && (a.kind === 'action' || a.kind === 'bonus') && ts?.tokenId === token?.id && !ts[a.kind]) emit('turn:spend', { what: a.kind });
    // La reacción con tirada la gasta la propia tirada (se pide confirmación fuera de turno).
    if (limits && a.kind === 'reaction' && !a.attack && !limits.reaction) emit('turn:spend', { what: 'reaction', tokenId: token.id });
    const who = { characterId: ch.id };
    const at = slotLevel ? ` · nivel ${slotLevel}` : '';
    if (a.attack) return rollGated({ ...who, expr: a.attack, label: `${a.name}${at}` });
    if (a.damage) return rollGated({ ...who, expr: a.damage, label: `${a.name}${at}${a.damageType ? ` · ${a.damageType}` : ''}` });
    socket.emit('chat', { ...who, text: `✦ ${a.name}${at}${a.note ? ` — ${a.note}` : ''}` });
  }

  function renderHotbar() {
    const ch = s && hotbarCharacter();
    hotbarBox.classList.toggle('hidden', !ch);
    if (!ch) return clear(hotbarBox);
    clear(hotbarBox, actionBar(ch, {
      spent: turnLimits(ch),
      onUse: (a, lvl) => useAction(ch, a, lvl),
      onDamage: (a) => rollGated({ characterId: ch.id, expr: a.damage, label: `${a.name} · daño${a.damageType ? ` ${a.damageType}` : ''}` }),
      onSlots: (slots) => saveCharacter({ ...ch, slots }),
      onRest: async (kind) => {
        await saveCharacter(rest(ch, kind));
        socket.emit('chat', { characterId: ch.id, text: kind === 'long' ? '☀ Hace un descanso largo.' : '☾ Hace un descanso corto.' });
      },
    }));
  }

  /** Cuadro de diálogo de un NPC sobre el tablero (retrato, nombre y texto). */
  let dialogTimer = null;
  function showDialog(e) {
    clearTimeout(dialogTimer);
    clear(dialogBox,
      e.img ? h('img', { src: e.img, alt: '' }) : null,
      h('div.grow', h('b', e.name), h('p', e.text)),
      h('button.icon-btn.small', { title: 'Cerrar', onclick: () => dialogBox.classList.add('hidden') }, '✕'));
    dialogBox.classList.remove('hidden');
    dialogTimer = setTimeout(() => dialogBox.classList.add('hidden'), Math.max(DIALOG_MIN_MS, e.text.length * DIALOG_MS_PER_CHAR));
  }

  // ---------- barra superior ----------
  function musicWidget() {
    const current = music.current;
    const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(music.prefs.volume * 100), title: 'Tu volumen' });
    vol.addEventListener('input', () => music.setVolume(Number(vol.value) / 100));
    return h(`div.music-chip${music.playing ? '.on' : ''}`,
      music.blocked && music.playing
        ? h('button.btn.small.primary', { onclick: () => { music.unlock(); renderTop(); } }, '🔈 Activar sonido')
        : h('button.icon-btn.small', { title: music.prefs.muted ? 'Quitar silencio' : 'Silenciar', onclick: () => { music.toggleMute(); renderTop(); } },
          music.prefs.muted ? '🔇' : '🎵'),
      h('span.np', current ? current.name : 'Sin música'),
      vol);
  }

  function renderTop() {
    if (!s) return;
    const mapName = s.scene.name || s.maps.find((m) => m.id === s.scene.mapId)?.name || 'Sin mapa';
    clear(tbar,
      h('button.icon-btn', { title: prefs.leftOpen ? 'Ocultar panel izquierdo' : 'Mostrar panel izquierdo', onclick: () => { prefs.leftOpen = !prefs.leftOpen; applyLayout(); } }, '☰'),
      h('button.btn.ghost.small', { onclick: () => go('#/') }, '← Lobby'),
      h('div.tb-title', h('h1', s.name), h('span.muted', `· ${mapName}`)),
      musicWidget(),
      h('div.tb-online', s.users.map((u) => h(`span.avatar${online.includes(u.id) ? '.on' : ''}`, {
        title: `${u.displayName}${u.role === 'dm' ? ' (DM)' : ''}${online.includes(u.id) ? ' · conectado' : ''}`,
      }, u.displayName.slice(0, 1).toUpperCase(), u.role === 'dm' ? h('i', '♛') : null))),
      h(`span.badge${s.isDM ? '.gold' : ''}`, s.isDM ? 'Dungeon Master' : 'Jugador'),
      s.isDM ? h('button.icon-btn', { title: 'Botín: repartir monedas o dar un objeto', onclick: openLoot }, '🎁') : null,
      s.isDM ? h('button.icon-btn', { title: 'Importar desde Excel: personajes, objetos, escenas y fichas', onclick: () => import('./excel-import.js').then((m) => m.openExcelImport(s.id)) }, '📊') : null,
      h('button.icon-btn', { title: 'Guía de juego', onclick: () => window.open(`#/guia/${s.isDM ? 'dm' : 'jugador'}`, '_blank') }, '❔'),
      h('button.icon-btn', { title: 'Ajustes', onclick: openSettings }, '⚙'));
  }

  function tabsFor() {
    const notesTab = ['notas', '📝 Notas', () => notes.show()];
    return s.isDM
      ? [['escena', '🗺 Escena', scenePanel], ['fichas', '♟ Fichas', tokensPanel], ['musica', '🎵 Música', musicPanel],
        ['grupo', '🛡 Grupo', partyPanel], ['jugadores', '👥 Jugadores', playersPanel], notesTab]
      : [['personaje', '📜 Personaje', characterPanel], ['grupo', '🛡 Grupo', partyPanel], notesTab];
  }

  function renderLeft() {
    if (!s) return;
    const tabs = tabsFor();
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
    clear(leftTabs, tabs.map(([k, label]) => h(`button.ltab${k === tab ? '.active' : ''}`, { onclick: () => { tab = k; renderLeft(); } }, label)));
    // Las notas no se rehacen con cada cambio de la mesa: se perdería el cursor a mitad de frase.
    if (tab === 'notas' && leftBody.firstChild === notes.el) return;
    const keepScroll = leftBody.scrollTop;
    clear(leftBody, tabs.find(([k]) => k === tab)[2](ctx));
    leftBody.scrollTop = keepScroll;
  }

  function renderIni() {
    clear(iniBox, initiativeBar(ctx));
  }

  function renderBoard() {
    const map = s.maps.find((m) => m.id === s.scene.mapId);
    board.setScene(s.scene, map?.url || null);
    board.setTokens(s.tokens, s.characters);
    const ts = s.initiative.turnState;
    const acting = ts && s.tokens.find((t) => t.id === ts.tokenId);
    board.setReach(combat() && acting && ts.anchor && (s.isDM || acting.ownerId === me.id)
      ? { tokenId: acting.id, anchor: ts.anchor, remaining: Math.max(0, s.scene.moveSquares - ts.used), clamp: !s.isDM }
      : null);
    board.setFog(s.scene.fog, { dm: s.isDM, playerIds: s.playerIds });
    renderFogBar();
    renderBanner();
  }

  /** Herramientas de niebla del DM sobre el tablero: activar, pincel para revelar/tapar y tapar todo. */
  function renderFogBar() {
    fogBar.classList.toggle('hidden', !s.isDM);
    if (!s.isDM) return;
    const on = Boolean(s.scene.fog?.on);
    if (!on && fogBrush) fogBrush = null;
    board.setFogBrush(fogBrush);
    const setBrush = (mode) => {
      fogBrush = mode ? { mode, size: brushSize } : null;
      renderFogBar();
    };
    const tool = (mode, icon, label) => h(`button.btn.small${(fogBrush?.mode || null) === mode ? '.on' : '.ghost'}`, { title: label, onclick: () => setBrush(mode) }, icon);
    clear(fogBar,
      h(`button.btn.small${on ? '.on' : '.ghost'}`, {
        title: on ? 'Quitar la niebla (los jugadores ven todo el mapa)' : 'Poner niebla: los jugadores solo ven lo que alcanzan sus personajes',
        onclick: () => emit('fog:set', { on: !on }),
      }, on ? '☁ Niebla' : '☁ Sin niebla'),
      on ? [
        tool(null, '✋', 'Mover y seleccionar fichas'),
        tool('reveal', '👁', 'Pincel: revelar casillas'),
        tool('cover', '🌑', 'Pincel: tapar casillas'),
        h('select.small', {
          title: 'Tamaño del pincel (casillas)',
          onchange: (e) => { fogBrush = fogBrush && { ...fogBrush, size: Number(e.target.value) }; brushSize = Number(e.target.value); if (fogBrush) board.setFogBrush(fogBrush); },
        }, [1, 3, 5, 9].map((n) => h('option', { value: n, selected: (fogBrush?.size || brushSize) === n }, `${n}×${n}`))),
        h('button.btn.small.ghost', {
          title: 'Tapar todo el mapa otra vez (olvida lo explorado)',
          onclick: async () => { if (await confirmDialog('¿Tapar todo el mapa? Los jugadores olvidan lo que ya habían explorado.')) emit('fog:set', { reset: true }); },
        }, 'Tapar todo'),
      ] : null);
  }

  /** Aviso al DM de qué escena tiene en su tablero y si los jugadores la ven. */
  function renderBanner() {
    const info = s.isDM && s.scenes?.find((x) => x.id === s.scene.id);
    const players = info ? info.players.map((uid) => s.users.find((u) => u.id === uid)?.displayName).filter(Boolean) : [];
    const show = Boolean(info) && (!players.length || s.scenes.some((x) => x.id !== info.id && x.players.length));
    banner.classList.toggle('hidden', !show);
    banner.classList.toggle('prep', show && !players.length);
    if (!show) return clear(banner);
    const live = s.scenes.find((x) => x.active);
    clear(banner,
      h('span', players.length ? `👁 Estás en «${info.name}» · ${players.join(', ')}` : `◌ Preparando «${info.name}» · los jugadores no la ven`),
      h('button.btn.small.primary', { onclick: () => openLaunchDialog(ctx, info) }, '▶ Lanzar'),
      live && live.id !== info.id ? h('button.btn.small.ghost', { onclick: () => ctx.viewScene(live.id) }, `↩ Volver a «${live.name}»`) : null);
  }

  /** Cartel de presentación al entrar en una escena, como una diapositiva de título. */
  function titleCard(name) {
    const card = h('div.title-card', h('div', h('small', 'Escena'), h('h2', name)));
    center.append(card);
    setTimeout(() => card.classList.add('out'), TITLE_CARD_MS - 600);
    setTimeout(() => card.remove(), TITLE_CARD_MS);
  }

  /** Tiradas en combate fuera de tu turno: solo pedidas por el DM o gastando la reacción. */
  async function rollGated(r) {
    const ini = s.initiative;
    const myInIni = s.tokens.some((t) => t.ownerId === me.id && ini.entries.some((e) => e.tokenId === t.id));
    const myTurn = s.tokens.find((t) => t.id === turnTokenId())?.ownerId === me.id;
    if (s.isDM || !combat() || !myInIni || myTurn || r.requestId) return emit('roll', r);
    if (!(await confirmDialog('No es tu turno. ¿Gastas tu reacción en esta tirada? (ataque de oportunidad, Escudo…)'))) return null;
    return emit('roll', { ...r, reaction: true });
  }

  function inspectorSubtitle(t, ch) {
    if (t.kind === 'objeto') return t.hidden ? 'Objeto · oculto para jugadores' : 'Objeto';
    if (ch?.npc && !s.isDM) return 'NPC';
    if (ch) return `${ch.npc ? 'NPC · ' : ''}${[ch.race, ch.cls].filter(Boolean).join(' ')} · CA ${ch.ac}`;
    return t.hidden ? 'Oculta para jugadores' : 'Criatura';
  }

  /** El DM abre la hoja de un NPC (o PJ) para tirar como él. */
  function openSheet(ch) {
    modal(ch.name, playSheet(ch, {
      onRoll: (r) => rollGated({ ...r, characterId: ch.id }),
      onHp: (d) => ctx.changeCharacterHp(ch, d),
      items: ctx.itemHooks(ch),
    }), { wide: true });
  }

  function renderInspector() {
    const t = s?.tokens.find((x) => x.id === selectedId);
    inspector.classList.toggle('hidden', !t);
    if (!t) return clear(inspector);
    const ch = t.characterId && s.characters.find((c) => c.id === t.characterId);
    const canEdit = s.isDM || t.ownerId === me.id;
    const hp = ch ? ch.hp : t.hp;
    const maxHp = ch ? ch.maxHp : t.maxHp;
    const amount = h('input', { type: 'number', min: 1, value: 1, class: 'mod-input' });

    const applyHp = (delta) => {
      if (ch) return ctx.changeCharacterHp(ch, delta);
      emit('token:update', { id: t.id, hp: Math.min(maxHp, hp + delta) });
    };
    const toggleCond = (c) => {
      const list = t.conditions || [];
      emit('token:update', { id: t.id, conditions: list.includes(c) ? list.filter((x) => x !== c) : [...list, c] });
    };
    const head = h('div.insp-head',
      h('img', { src: t.img, alt: '' }),
      h('div.grow', h('b', ch ? ch.name : t.name), h('div.tiny.muted', inspectorSubtitle(t, ch))),
      h('button.icon-btn.small', { onclick: () => board.select(null) }, '✕'));
    const rename = () => {
      const name = prompt('Nombre de la ficha:', t.name);
      if (name) emit('token:update', { id: t.id, name });
    };
    const remove = async () => { if (await confirmDialog(`¿Quitar "${t.name}" del mapa?`)) emit('token:remove', { id: t.id }); };

    // Objetos (cofres, cartas, palancas…): sin PG ni estados; se usan acercando la ficha.
    if (t.kind === 'objeto') {
      return clear(inspector, head, objectInspector(ctx, t),
        s.isDM ? h('div.row.wrap',
          ...objectDmControls(ctx, t),
          h('button.btn.small.ghost', { onclick: () => emit('token:update', { id: t.id, hidden: !t.hidden }) }, t.hidden ? '👁 Revelar' : '🙈 Ocultar'),
          h('select.small', { onchange: (e) => emit('token:update', { id: t.id, size: Number(e.target.value) }) },
            [1, 2, 3, 4, 5, 6].map((v) => h('option', { value: v, selected: t.size === v }, `${v}×${v}`))),
          h('button.btn.small.ghost', { onclick: rename }, '✎'),
          h('button.btn.small.ghost', {
            title: 'Guardar en mis fichas para usarlo en cualquier campaña',
            onclick: () => ctx.saveBeast({ name: t.name.replace(/ \d+$/, ''), img: t.img, hp: 1, size: t.size, kind: 'objeto', object: t.object }),
          }, '★'),
          h('button.btn.small.danger', { onclick: remove }, '🗑')) : null);
    }

    clear(inspector,
      head,
      h('div.hpbar', h('i', { style: { width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` } }), h('span', `${hp} / ${maxHp} PG`)),
      canEdit ? h('div.row',
        h('button.btn.small.danger', { onclick: () => applyHp(-(Number(amount.value) || 0)) }, 'Daño'),
        amount,
        h('button.btn.small.ok', { onclick: () => applyHp(Number(amount.value) || 0) }, 'Curar')) : null,
      s.isDM && !ch ? h('label.row.tiny', { title: 'Clase de armadura: los jugadores no la ven; al atacar solo saben si impacta' }, 'CA ',
        h('input.mod-input', { type: 'number', min: 0, max: 40, value: t.ac ?? 10, onchange: (e) => emit('token:update', { id: t.id, ac: Number(e.target.value) || 0 }) })) : null,
      h('div.conds', CONDITIONS.map((c) => h(`button.cond${(t.conditions || []).includes(c) ? '.on' : ''}`, {
        disabled: !canEdit, onclick: () => toggleCond(c),
      }, c))),
      s.isDM ? h('div.row.wrap',
        h('button.btn.small.ghost', { onclick: () => emit('token:update', { id: t.id, hidden: !t.hidden }) }, t.hidden ? '👁 Revelar' : '🙈 Ocultar'),
        h('select.small', { onchange: (e) => emit('token:update', { id: t.id, size: Number(e.target.value) }) },
          [[1, 'Mediano'], [2, 'Grande'], [3, 'Enorme'], [4, 'Gargantuesco']].map(([v, l]) => h('option', { value: v, selected: t.size === v }, l))),
        h('button.btn.small.ghost', {
          onclick: () => {
            const value = 1 + Math.floor(Math.random() * 20) + (ch ? mod(ch.stats.dex) : 0);
            const entries = [...s.initiative.entries.filter((e) => e.tokenId !== t.id), { id: t.id, tokenId: t.id, name: ch ? ch.name : t.name, img: t.img, value }]
              .sort((a, b) => b.value - a.value);
            emit('initiative:set', { ...s.initiative, entries });
          },
        }, '⚔ A iniciativa'),
        h('button.btn.small.ghost', { onclick: rename }, '✎'),
        ch ? null : h('button.btn.small.ghost', { title: 'Convertir en objeto (cofre, carta, amuleto…): sin PG ni iniciativa', onclick: () => emit('token:update', { id: t.id, kind: 'objeto' }) }, '📦 Objeto'),
        ch ? h('button.btn.small.ghost', { title: 'Abrir su hoja para tirar como este personaje', onclick: () => openSheet(ch) }, '📜 Hoja') : null,
        ch ? h('button.btn.small.ghost', { title: 'Tus notas sobre este personaje (solo las ves tú)', onclick: () => openNotesFor(ch.id) }, '📝') : null,
        ch ? null : h('button.btn.small.ghost', {
          title: 'Guardar en mis bestias para usarla en cualquier campaña',
          onclick: () => ctx.saveBeast({ name: t.name.replace(/ \d+$/, ''), img: t.img, hp: t.maxHp, size: t.size }),
        }, '★'),
        h('button.btn.small.danger', { onclick: remove }, '🗑')) : (canEdit ? h('button.btn.small.danger', { onclick: () => emit('token:remove', { id: t.id }) }, 'Retirar del mapa') : null));
  }

  // ---------- tiradas y chat (separados) ----------
  function pushTo(list, node, kind) {
    list.append(node);
    while (list.children.length > LIST_LIMIT) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
    if (!(prefs.rightOpen && prefs.rightTab === kind)) {
      unread[kind] += 1;
      renderRail();
    }
  }

  function addLog(e, live) {
    if (!e) return;
    if (e.type === 'chat') {
      if (live && e.dialog && e.sceneId === s.scene.id) showDialog(e);
      if (live && shouldSpeak(e, prefs.tts || 'nada', me.id)) {
        speak(e.text, s.characters.find((ch) => ch.id === e.characterId)?.voice || voiceForName(e.name), prefs.ttsVolume ?? 1);
      }
      return live ? pushTo(chatList, chatEntry(e, me.id), 'chat') : chatList.append(chatEntry(e, me.id));
    }
    if (!live) return rollList.append(rollEntry(e));
    // La tirada entra al historial cuando el dado ya cayó, para no destripar el resultado.
    dice.show(e, { compact: e.userId !== me.id && !prefs.bigOthers });
    setTimeout(() => pushTo(rollList, rollEntry(e), 'rolls'), LOG_REVEAL_MS);
  }

  function sendChat() {
    let text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    const mention = splitMention(speakerOptions(), text);
    if (mention) {
      setActAs(mention.value);
      text = mention.text;
    }
    const m = text.match(/^\/(r|roll|tirar)\s+(\S+)\s*(.*)$/i);
    if (m) return ctx.roll({ expr: m[2], label: m[3] });
    if (/^\/(ayuda|help)$/i.test(text)) {
      return chatList.append(chatEntry({ type: 'chat', name: 'Ayuda', at: new Date().toISOString(), text: '/r 1d20+5 Ataque · /r 2d6+3 Daño · /r 4d6kh3 (las 3 mejores) · /r 2d20kl1 (desventaja) · @nombre mensaje → habla como ese personaje' }));
    }
    socket.emit('chat', { text, ...speakerPayload(), dialog: dialogMode });
  }

  const openLoot = () => openLootFor(s, emit);

  function openSettings() {
    const big = h('input', { type: 'checkbox', checked: prefs.bigOthers, onchange: (e) => { prefs.bigOthers = e.target.checked; savePrefs(prefs); } });
    modal('Ajustes de la mesa', [
      h('label.check', big, h('span', 'Ver las tiradas de los demás a pantalla completa')),
      speechSettings(prefs, savePrefs),
      s.isDM ? h('div.col',
        h('div.label-mini', 'Campaña'),
        h('button.btn.ghost', {
          onclick: async () => {
            const name = prompt('Nuevo nombre de la campaña:', s.name);
            if (name) await api.patch(`/campaigns/${s.id}`, { name }).catch((err) => toast(err.message, 'error'));
          },
        }, 'Renombrar campaña')) : null,
      h('p.tiny.muted', 'Atajos: rueda = zoom, arrastrar fondo = mover cámara, doble clic = señalar un punto a todos. ☰ oculta el panel izquierdo; 🎲 y 💬 abren el historial y el chat.'),
    ]);
  }

  // ---------- peticiones de tirada del DM ----------
  function onRollRequest(req) {
    const ch = actingCharacter() || myCharacters()[0];
    const m = req.ability && ch ? mod(ch.stats[req.ability]) : 0;
    const long = ABILITIES.find(([k]) => k === req.ability)?.[2];
    const doRoll = (modeSel) => {
      dlg.close();
      emit('roll', { expr: `1d20${signed(m)}`, label: req.label, dc: req.dc, hidden: req.hidden, mode: modeSel, requestId: req.id, ...(ch ? { characterId: ch.id } : {}) });
    };
    const dlg = modal('El DM pide una tirada', h('div.request',
      h('div.req-label', req.label),
      long ? h('p.muted', `${long} ${signed(m)}${ch ? ` · ${ch.name}` : ''}`) : null,
      req.dc ? h('div.req-dc', h('small', 'CD'), h('b', req.dc)) : null,
      h('div.row.center',
        h('button.btn.ghost', { onclick: () => doRoll('dis') }, 'Desventaja'),
        h('button.btn.roll', { onclick: () => doRoll('normal') }, `Tirar 1d20 ${signed(m)}`),
        h('button.btn.ghost', { onclick: () => doRoll('adv') }, 'Ventaja'))));
  }

  // ---------- socket ----------
  async function loadBestiary() {
    try {
      bestiary = (await api.get('/bestiary')).bestiary;
      if (tab === 'fichas') renderLeft();
    } catch (err) { toast(`No se pudo cargar tu bestiario: ${err.message}`, 'error'); }
  }

  function applyState(state, onlineIds, serverNow) {
    s = state;
    online = onlineIds || online;
    clear(rollList);
    clear(chatList);
    s.log.forEach((e) => addLog(e, false));
    music.apply(s.music, s.tracks, serverNow);
    renderAll();
  }

  function renderAll() {
    renderSpeaker();
    renderTop();
    renderLeft();
    renderIni();
    renderBoard();
    renderInspector();
    renderHotbar();
    clear(trayBox, diceTray(ctx));
    applyLayout();
  }

  const join = () => socket.emit('join', { id: campaignId }, (res) => {
    if (res?.error) {
      toast(res.error, 'error');
      return go('#/');
    }
    applyState(res.state, res.online, res.serverNow);
    lastTurn = s.initiative.turnState?.tokenId || null;
    if (s.isDM) loadBestiary();
    // Si se dejó abierto el panel de libros, se carga ya.
    if (prefs.rightOpen && prefs.rightTab === 'libros') openBooks();
    if (prefs.rightOpen && prefs.rightTab === 'docs') openDocs();
  });

  socket.on('connect', join);
  socket.on('connect_error', (err) => toast(`Sin conexión: ${err.message}`, 'error'));
  socket.on('presence', (ids) => { online = ids; if (s) { renderTop(); if (tab === 'grupo' || tab === 'jugadores') renderLeft(); } });
  socket.on('scene:state', (v) => {
    const sceneChanged = v.scene.id !== s.scene.id;
    Object.assign(s, { scene: v.scene, tokens: v.tokens, initiative: v.initiative, activeSceneId: v.activeSceneId });
    if (v.scenes) s.scenes = v.scenes;
    if (v.characters) {
      s.characters = v.characters;
      board.setTokens(s.tokens, s.characters);
    }
    renderBoard();
    renderIni();
    renderInspector();
    renderTop();
    renderSpeaker();
    renderHotbar();
    if (['fichas', 'personaje', 'escena'].includes(tab) || sceneChanged) renderLeft();
    if (v.arrived) titleCard(v.scene.name);
    const turn = s.initiative.turnState?.tokenId || null;
    const turnToken = turn && s.tokens.find((t) => t.id === turn);
    if (turn !== lastTurn && turnToken && !s.isDM && turnToken.ownerId === me.id) {
      // Con dos personajes, el turno cambia solo al que le toca.
      if (turnToken.characterId) setActAs(`c:${turnToken.characterId}`);
      toast(myCharacters().length > 1 ? `⚔ ¡Turno de ${turnToken.name}!` : '⚔ ¡Es tu turno!', 'ok');
    }
    lastTurn = turn;
  });
  socket.on('scenes', ({ scenes, activeSceneId }) => {
    Object.assign(s, { scenes, activeSceneId });
    renderBanner();
    if (tab === 'escena') renderLeft();
  });
  socket.on('token:moved', ({ id, x, y }) => {
    s.tokens = s.tokens.map((t) => (t.id === id ? { ...t, x, y } : t));
    board.moveToken(id, x, y);
  });
  socket.on('maps', (maps) => { s.maps = maps; renderBoard(); renderTop(); if (tab === 'escena') renderLeft(); });
  socket.on('characters', (chars) => { s.characters = chars; board.setTokens(s.tokens, chars); renderSpeaker(); renderLeft(); renderInspector(); renderHotbar(); });
  socket.on('tracks', (tracks) => { s.tracks = tracks; music.apply(s.music, tracks); if (tab === 'musica') renderLeft(); });
  socket.on('music', ({ music: m, serverNow }) => { s.music = m; music.apply(m, s.tracks, serverNow); if (tab === 'musica') renderLeft(); });
  socket.on('sfx', ({ url }) => music.sfx(url));
  socket.on('log', (e) => addLog(e, true));
  socket.on('ping', ({ x, y, name }) => board.ping(x, y, name));
  socket.on('campaign:meta', ({ name }) => { s.name = name; renderTop(); });
  socket.on('campaign:refresh', () => socket.emit('refresh', null, (res) => res?.state && applyState(res.state, res.online, res.serverNow)));
  socket.on('campaign:deleted', () => { toast('La campaña fue borrada', 'error'); go('#/'); });
  socket.on('campaign:removed', ({ id }) => { if (id === campaignId) { toast('El DM te sacó de esta campaña', 'error'); go('#/'); } });
  socket.on('roll:request', (req) => onRollRequest(req));
  socket.on('toast', ({ kind, text }) => toast(text, kind));
  socket.on('attack:incoming', (attack) => openReactionPrompt(attack, (kind) => emit('attack:react', { id: attack.id, kind })));

  return () => {
    music.destroy();
    socket.disconnect();
  };
}
