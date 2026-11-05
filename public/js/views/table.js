// La mesa de juego: une tablero, paneles, tiradas, chat, música, dados 3D y tiempo real.
import { h, clear, toast, modal, confirmDialog, mod, signed, clock, ABILITIES } from '../ui.js';
import { api } from '../api.js';
import { Board } from '../board.js';
import { DiceOverlay } from '../dice3d.js';
import { MusicPlayer } from '../music.js';
import {
  scenePanel, tokensPanel, partyPanel, playersPanel, characterPanel, musicPanel, diceTray, initiativeBar,
} from './table-panels.js';

const CONDITIONS = ['Envenenado', 'Aturdido', 'Derribado', 'Asustado', 'Agarrado', 'Invisible', 'Concentrado', 'Bendecido', 'Cegado', 'Paralizado'];
const PREFS_KEY = 'da.prefs';
const LOG_REVEAL_MS = 2000;
const LIST_LIMIT = 200;

let dice = null;

function loadPrefs() {
  const base = { bigOthers: false, placeHidden: false, rightOpen: false, rightTab: 'rolls', leftOpen: true };
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
  let selectedId = null;
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
  const center = h('section.tcenter', boardBox, iniBox, inspector, trayBox);

  const rollList = h('div.log.rolls');
  const chatList = h('div.log.chat-log');
  const chatInput = h('input', { placeholder: 'Escribe… (/r 1d20+5 para tirar)', maxlength: 1000 });
  const chatForm = h('form.chat', { onsubmit: (e) => { e.preventDefault(); sendChat(); } }, chatInput, h('button.btn.primary', { title: 'Enviar' }, '➤'));
  const rail = h('div.rail');
  const drawerTabs = h('div.dtabs');
  const drawer = h('div.drawer', drawerTabs, rollList, h('div.chat-pane', chatList, chatForm));
  const right = h('aside.tright', rail, drawer);
  const screen = h('div.table-screen', tbar, h('div.tmain', left, center, right));
  clear(root, screen);

  const emit = (event, payload) => new Promise((resolve) => {
    socket.emit(event, payload, (res) => {
      if (res?.error) toast(res.error, 'error');
      resolve(res);
    });
  });

  const board = new Board(boardBox, {
    canMove: (t) => Boolean(s && (s.isDM || t.ownerId === me.id)),
    onMove: (id, x, y, final) => socket.emit('token:update', { id, x, y }, final ? (r) => r?.error && toast(r.error, 'error') : undefined),
    onSelect: (t) => { selectedId = t?.id || null; renderInspector(); },
    onPing: (x, y) => socket.emit('ping', { x, y }),
    onDrop: (data, x, y) => emit('token:add', { ...data, x, y, hidden: s.isDM && prefs.placeHidden }),
  });

  const ctx = {
    get s() { return s; },
    get online() { return online; },
    me, board, emit, prefs, music,
    roll: (r) => emit('roll', r),
    changeCharacterHp: async (ch, delta) => {
      try { await api.patch(`/characters/${ch.id}`, { ...ch, hp: Math.min(ch.maxHp, ch.hp + delta) }); } catch (err) { toast(err.message, 'error'); }
    },
  };

  // ---------- paneles laterales ----------
  function applyLayout() {
    screen.classList.toggle('right-open', prefs.rightOpen);
    screen.classList.toggle('left-closed', !prefs.leftOpen);
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
      const list = which === 'chat' ? chatList : rollList;
      list.scrollTop = list.scrollHeight;
      if (which === 'chat') chatInput.focus();
    }
  }

  function renderRail() {
    const btn = (which, icon, label) => h(`button.rail-btn${prefs.rightOpen && prefs.rightTab === which ? '.on' : ''}`, {
      title: label, onclick: () => openRight(which),
    }, icon, unread[which] ? h('span.unread', unread[which] > 99 ? '99+' : unread[which]) : null);
    clear(rail, btn('rolls', '🎲', 'Historial de tiradas'), btn('chat', '💬', 'Chat'));
    clear(drawerTabs,
      h(`button.dtab${prefs.rightTab === 'rolls' ? '.active' : ''}`, { onclick: () => { prefs.rightTab = 'rolls'; applyLayout(); } }, '🎲 Tiradas'),
      h(`button.dtab${prefs.rightTab === 'chat' ? '.active' : ''}`, { onclick: () => { prefs.rightTab = 'chat'; applyLayout(); chatInput.focus(); } }, '💬 Chat'),
      h('button.icon-btn.small', { title: 'Ocultar panel', onclick: () => { prefs.rightOpen = false; applyLayout(); } }, '»'));
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
    const mapName = s.maps.find((m) => m.id === s.scene.mapId)?.name || 'Sin mapa';
    clear(tbar,
      h('button.icon-btn', { title: prefs.leftOpen ? 'Ocultar panel izquierdo' : 'Mostrar panel izquierdo', onclick: () => { prefs.leftOpen = !prefs.leftOpen; applyLayout(); } }, '☰'),
      h('button.btn.ghost.small', { onclick: () => go('#/') }, '← Lobby'),
      h('div.tb-title', h('h1', s.name), h('span.muted', `· ${mapName}`)),
      musicWidget(),
      h('div.tb-online', s.users.map((u) => h(`span.avatar${online.includes(u.id) ? '.on' : ''}`, {
        title: `${u.displayName}${u.role === 'dm' ? ' (DM)' : ''}${online.includes(u.id) ? ' · conectado' : ''}`,
      }, u.displayName.slice(0, 1).toUpperCase(), u.role === 'dm' ? h('i', '♛') : null))),
      h(`span.badge${s.isDM ? '.gold' : ''}`, s.isDM ? 'Dungeon Master' : 'Jugador'),
      h('button.icon-btn', { title: 'Guía de juego', onclick: () => window.open(`#/guia/${s.isDM ? 'dm' : 'jugador'}`, '_blank') }, '❔'),
      h('button.icon-btn', { title: 'Ajustes', onclick: openSettings }, '⚙'));
  }

  function tabsFor() {
    return s.isDM
      ? [['escena', '🗺 Escena', scenePanel], ['fichas', '♟ Fichas', tokensPanel], ['musica', '🎵 Música', musicPanel],
        ['grupo', '🛡 Grupo', partyPanel], ['jugadores', '👥 Jugadores', playersPanel]]
      : [['personaje', '📜 Personaje', characterPanel], ['grupo', '🛡 Grupo', partyPanel]];
  }

  function renderLeft() {
    if (!s) return;
    const tabs = tabsFor();
    if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
    clear(leftTabs, tabs.map(([k, label]) => h(`button.ltab${k === tab ? '.active' : ''}`, { onclick: () => { tab = k; renderLeft(); } }, label)));
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

    clear(inspector,
      h('div.insp-head',
        h('img', { src: t.img, alt: '' }),
        h('div.grow', h('b', ch ? ch.name : t.name), h('div.tiny.muted', ch ? `${ch.race} ${ch.cls} · CA ${ch.ac}` : (t.hidden ? 'Oculta para jugadores' : 'Criatura'))),
        h('button.icon-btn.small', { onclick: () => board.select(null) }, '✕')),
      h('div.hpbar', h('i', { style: { width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` } }), h('span', `${hp} / ${maxHp} PG`)),
      canEdit ? h('div.row',
        h('button.btn.small.danger', { onclick: () => applyHp(-(Number(amount.value) || 0)) }, 'Daño'),
        amount,
        h('button.btn.small.ok', { onclick: () => applyHp(Number(amount.value) || 0) }, 'Curar')) : null,
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
        h('button.btn.small.ghost', {
          onclick: () => {
            const name = prompt('Nombre de la ficha:', t.name);
            if (name) emit('token:update', { id: t.id, name });
          },
        }, '✎'),
        h('button.btn.small.danger', {
          onclick: async () => { if (await confirmDialog(`¿Quitar "${t.name}" del mapa?`)) emit('token:remove', { id: t.id }); },
        }, '🗑')) : (canEdit ? h('button.btn.small.danger', { onclick: () => emit('token:remove', { id: t.id }) }, 'Retirar del mapa') : null));
  }

  // ---------- tiradas y chat (separados) ----------
  function chatEntry(e) {
    return h(`div.msg${e.userId === me.id ? '.mine' : ''}`, h('div.msg-head', h('b', e.name), h('span.tiny.muted', clock(e.at))), h('p', e.text));
  }

  function rollEntry(e) {
    const r = e.result;
    const chips = r.groups.flatMap((g) => g.values.map((v, i) => h(`span.die-chip${g.kept[i] ? '' : '.dropped'}${g.sides === 20 && v === 20 ? '.crit' : ''}${g.sides === 20 && v === 1 ? '.fumble' : ''}`,
      { title: `d${g.sides}` }, v)));
    return h(`div.roll-card${e.success === true ? '.success' : ''}${e.success === false ? '.fail' : ''}${e.hidden ? '.secret' : ''}`,
      h('div.roll-total', r.total),
      h('div.roll-main',
        h('div.msg-head', h('b', e.name), e.hidden ? h('span.badge.small', 'oculta') : null, h('span.tiny.muted', clock(e.at))),
        h('div.roll-label', e.label || 'Tirada', e.mode ? h('small', e.mode === 'adv' ? ' · ventaja' : ' · desventaja') : null),
        h('div.roll-detail', h('code', r.expr), chips, r.modifier ? h('span.mod', signed(r.modifier)) : null),
        e.dc ? h('div.roll-verdict', `CD ${e.dc} · ${e.natural === 20 ? '¡Crítico!' : e.natural === 1 ? 'Pifia' : e.success ? 'Éxito' : 'Fallo'}`) : null));
  }

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
    if (e.type === 'chat') return live ? pushTo(chatList, chatEntry(e), 'chat') : chatList.append(chatEntry(e));
    if (!live) return rollList.append(rollEntry(e));
    // La tirada entra al historial cuando el dado ya cayó, para no destripar el resultado.
    dice.show(e, { compact: e.userId !== me.id && !prefs.bigOthers });
    setTimeout(() => pushTo(rollList, rollEntry(e), 'rolls'), LOG_REVEAL_MS);
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    const m = text.match(/^\/(r|roll|tirar)\s+(\S+)\s*(.*)$/i);
    if (m) return ctx.roll({ expr: m[2], label: m[3] });
    if (/^\/(ayuda|help)$/i.test(text)) {
      return chatList.append(chatEntry({ type: 'chat', name: 'Ayuda', at: new Date().toISOString(), text: '/r 1d20+5 Ataque · /r 2d6+3 Daño · /r 4d6kh3 (las 3 mejores) · /r 2d20kl1 (desventaja)' }));
    }
    socket.emit('chat', { text });
  }

  function openSettings() {
    const big = h('input', { type: 'checkbox', checked: prefs.bigOthers, onchange: (e) => { prefs.bigOthers = e.target.checked; savePrefs(prefs); } });
    modal('Ajustes de la mesa', [
      h('label.check', big, h('span', 'Ver las tiradas de los demás a pantalla completa')),
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
    const ch = s.characters.find((c) => c.ownerId === me.id);
    const m = req.ability && ch ? mod(ch.stats[req.ability]) : 0;
    const long = ABILITIES.find(([k]) => k === req.ability)?.[2];
    const doRoll = (modeSel) => {
      dlg.close();
      emit('roll', { expr: `1d20${signed(m)}`, label: req.label, dc: req.dc, hidden: req.hidden, mode: modeSel });
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
    renderTop();
    renderLeft();
    renderIni();
    renderBoard();
    renderInspector();
    clear(trayBox, diceTray(ctx));
    applyLayout();
  }

  const join = () => socket.emit('join', { id: campaignId }, (res) => {
    if (res?.error) {
      toast(res.error, 'error');
      return go('#/');
    }
    applyState(res.state, res.online, res.serverNow);
  });

  socket.on('connect', join);
  socket.on('connect_error', (err) => toast(`Sin conexión: ${err.message}`, 'error'));
  socket.on('presence', (ids) => { online = ids; if (s) { renderTop(); if (tab === 'grupo' || tab === 'jugadores') renderLeft(); } });
  socket.on('tokens', (tokens) => { s.tokens = tokens; board.setTokens(tokens, s.characters); renderInspector(); if (tab === 'fichas' || tab === 'personaje') renderLeft(); });
  socket.on('token:moved', ({ id, x, y }) => {
    s.tokens = s.tokens.map((t) => (t.id === id ? { ...t, x, y } : t));
    board.moveToken(id, x, y);
  });
  socket.on('scene', (scene) => { s.scene = scene; renderBoard(); renderTop(); if (tab === 'escena') renderLeft(); });
  socket.on('maps', (maps) => { s.maps = maps; renderTop(); if (tab === 'escena') renderLeft(); });
  socket.on('initiative', (ini) => { s.initiative = ini; renderIni(); });
  socket.on('characters', (chars) => { s.characters = chars; board.setTokens(s.tokens, chars); renderLeft(); renderInspector(); });
  socket.on('tracks', (tracks) => { s.tracks = tracks; music.apply(s.music, tracks); if (tab === 'musica') renderLeft(); });
  socket.on('music', ({ music: m, serverNow }) => { s.music = m; music.apply(m, s.tracks, serverNow); if (tab === 'musica') renderLeft(); });
  socket.on('sfx', ({ url }) => music.sfx(url));
  socket.on('log', (e) => addLog(e, true));
  socket.on('ping', ({ x, y, name }) => board.ping(x, y, name));
  socket.on('campaign:meta', ({ name }) => { s.name = name; renderTop(); });
  socket.on('campaign:refresh', () => socket.emit('refresh', null, (res) => res?.state && applyState(res.state, res.online, res.serverNow)));
  socket.on('campaign:deleted', () => { toast('La campaña fue borrada', 'error'); go('#/'); });
  socket.on('roll:request', (req) => onRollRequest(req));
  socket.on('toast', ({ kind, text }) => toast(text, kind));

  return () => {
    music.destroy();
    socket.disconnect();
  };
}
