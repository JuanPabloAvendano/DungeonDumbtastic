#!/usr/bin/env node
// Cliente de línea de comandos para jugar sin navegador (pruebas y partidas con agentes).
// Uso: node scripts/bot.js --url http://localhost:3000 --user dm --pass xxx <comando> [args]
//   state                         escena, fichas (casillas), PG, iniciativa
//   log [n] [--since ISO]         últimas entradas de tiradas y chat
//   wait <seg> [--since ISO]      espera a que aparezca algo nuevo en el registro
//   say "<texto>"                 chat
//   roll "<expr>" ["etiqueta"] [--dc N] [--adv|--dis] [--hidden] [--reaction]
//   move "<ficha>" <col> <fila>   mover ficha (por nombre o id) a una casilla
//   hp "<ficha>" <delta>          sumar/restar PG (personajes o criaturas)
//   cond "<ficha>" "<condición>"  alternar condición
//   add "<nombre>" <img> <col> <fila> [--hp N] [--hidden]   (DM) img: goblin|lobo|esqueleto|...
//   remove "<ficha>"              (DM)
//   reveal "<ficha>"              (DM) mostrar/ocultar
//   scene "<escena>"              (DM) lanzar una escena preparada para todos
//   end                           terminar tu turno (en combate)
//   ini roll|next|clear           (DM) iniciativa
//   request <car> <CD> "<prueba>" [--to usuario]   (DM) pedir tirada: car = str|dex|con|int|wis|cha
const { io } = require('socket.io-client');

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true;
  else { flags[a.slice(2)] = next; i++; }
}
const URL_BASE = flags.url || process.env.DA_URL || 'http://localhost:3000';
const USER = flags.user || process.env.DA_USER;
const PASS = flags.pass || process.env.DA_PASS;
const TIMEOUT_MS = 8000;

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function login() {
  const res = await fetch(`${URL_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }),
  }).catch(() => die(`no hay servidor en ${URL_BASE}`));
  const data = await res.json();
  if (!res.ok) die(data.error);
  return data.token;
}

async function api(token, method, url, body) {
  const res = await fetch(`${URL_BASE}/api${url}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) die(data.error);
  return data;
}

function fmtEntry(e) {
  const t = e.at.slice(11, 19);
  if (e.type === 'chat') return `[${t}] ${e.name}: ${e.text}`;
  const r = e.result;
  const dice = r.groups.map((g) => `d${g.sides}[${g.values.map((v, i) => (g.kept[i] ? v : `~${v}~`)).join(',')}]`).join(' ');
  const verdict = e.dc ? ` vs CD ${e.dc} → ${e.natural === 20 ? 'CRÍTICO' : e.natural === 1 ? 'PIFIA' : e.success ? 'ÉXITO' : 'FALLO'}` : '';
  return `[${t}] 🎲 ${e.name}${e.hidden ? ' (oculta)' : ''} · ${e.label || r.expr}: ${r.total}  (${r.expr} = ${dice}${r.modifier ? ` ${r.modifier > 0 ? '+' : ''}${r.modifier}` : ''})${verdict}`;
}

function findToken(state, ref) {
  const q = String(ref).toLowerCase();
  const name = (t) => (t.characterId ? state.characters.find((c) => c.id === t.characterId)?.name : t.name) || t.name;
  return state.tokens.find((t) => t.id === ref || t.id.startsWith(ref))
    || state.tokens.find((t) => name(t).toLowerCase() === q)
    || state.tokens.find((t) => name(t).toLowerCase().startsWith(q))
    || die(`no encuentro la ficha "${ref}"`);
}

function printState(state, online) {
  const g = state.scene.grid.size;
  const map = state.maps.find((m) => m.id === state.scene.mapId);
  console.log(`Campaña: ${state.name} · Escena: ${state.scene.name} · Mapa: ${map?.name || '(ninguno)'} · casilla ${g}px · ${state.isDM ? 'eres DM' : 'eres jugador'}`);
  if (state.scenes) console.log(`Escenas: ${state.scenes.map((s) => `${s.active ? '★' : ''}${s.name} (${s.players.length} jug.)`).join(' · ')}`);
  console.log(`Conectados: ${state.users.filter((u) => online.includes(u.id)).map((u) => u.displayName).join(', ') || '—'}`);
  console.log('Fichas (col,fila):');
  for (const t of state.tokens) {
    const ch = t.characterId && state.characters.find((c) => c.id === t.characterId);
    const hp = ch ? `${ch.hp}/${ch.maxHp}` : `${t.hp}/${t.maxHp}`;
    console.log(`  - [${t.id.slice(0, 8)}] ${ch ? ch.name : t.name} @(${Math.round(t.x / g)},${Math.round(t.y / g)}) PG ${hp}${ch ? ` CA ${ch.ac}` : ''}${t.hidden ? ' [OCULTA]' : ''}${t.conditions?.length ? ` {${t.conditions.join(', ')}}` : ''}`);
  }
  const ini = state.initiative;
  if (ini.entries.length) {
    console.log(`Iniciativa (ronda ${ini.round}): ${ini.entries.map((e, i) => `${i === ini.turn ? '▶' : ''}${e.name} ${e.value}`).join(' · ')}`);
    const ts = ini.turnState;
    if (ts) console.log(`Turno: movimiento ${ts.used}/${state.scene.moveSquares} casillas · acción ${ts.action ? 'gastada' : 'libre'} · adicional ${ts.bonus ? 'gastada' : 'libre'}`);
  }
  console.log('Personajes:');
  for (const c of state.characters) {
    console.log(`  - ${c.name} (${c.race} ${c.cls} nv${c.level}) PG ${c.hp}/${c.maxHp} CA ${c.ac} · FUE ${c.stats.str} DES ${c.stats.dex} CON ${c.stats.con} INT ${c.stats.int} SAB ${c.stats.wis} CAR ${c.stats.cha}`);
  }
}

async function main() {
  if (pos[0] === 'help' || flags.help) {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(0);
  }
  if (!USER || !PASS) die('faltan --user y --pass');
  const [cmd = 'state', ...args] = pos;
  const token = await login();
  const { campaigns } = await api(token, 'GET', '/campaigns');
  const campaign = flags.campaign ? campaigns.find((c) => c.id === flags.campaign || c.name === flags.campaign) : campaigns[0];
  if (!campaign) die('no estás en ninguna campaña');

  const socket = io(URL_BASE, { auth: { token }, transports: ['websocket'] });
  const emit = (event, payload) => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: 'sin respuesta del servidor' }), TIMEOUT_MS);
    socket.emit(event, payload, (r) => { clearTimeout(t); resolve(r || {}); });
  });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', (e) => reject(e));
  }).catch((e) => die(e.message));
  const joined = await emit('join', { id: campaign.id });
  if (joined.error) die(joined.error);
  const state = joined.state;
  const g = state.scene.grid.size;
  const ok = (r, msg) => (r.error ? die(r.error) : console.log(msg || 'OK'));

  switch (cmd) {
    case 'state': printState(state, joined.online); break;
    case 'log': {
      const since = flags.since ? Date.parse(flags.since) : 0;
      state.log.filter((e) => Date.parse(e.at) > since).slice(-(Number(args[0]) || 25)).forEach((e) => console.log(fmtEntry(e)));
      console.log(`(ahora: ${new Date().toISOString()})`);
      break;
    }
    case 'wait': {
      const limit = Math.min(600, Number(args[0]) || 60) * 1000;
      const since = flags.since ? Date.parse(flags.since) : Date.now();
      const fresh = state.log.filter((e) => Date.parse(e.at) > since);
      if (!fresh.length) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, limit);
          socket.on('log', (e) => { if (e) { fresh.push(e); setTimeout(() => { clearTimeout(t); resolve(); }, 1500); } });
        });
      }
      fresh.forEach((e) => console.log(fmtEntry(e)));
      if (!fresh.length) console.log('(nada nuevo)');
      console.log(`(ahora: ${new Date().toISOString()})`);
      break;
    }
    case 'say': ok(await emit('chat', { text: args.join(' ') }), 'mensaje enviado'); break;
    case 'roll': {
      const mode = flags.adv ? 'adv' : flags.dis ? 'dis' : 'normal';
      const r = await emit('roll', { expr: args[0], label: args[1] || '', dc: flags.dc || null, mode, hidden: flags.hidden === true, reaction: flags.reaction === true });
      if (r.error) die(r.error);
      await new Promise((res) => setTimeout(res, 300));
      const after = (await emit('refresh', null)).state;
      const mine = after.log.filter((e) => e.type === 'roll').pop();
      console.log(mine ? fmtEntry(mine) : 'tirada enviada');
      break;
    }
    case 'move': {
      const t = findToken(state, args[0]);
      ok(await emit('token:update', { id: t.id, x: Number(args[1]) * g + state.scene.grid.ox, y: Number(args[2]) * g + state.scene.grid.oy, final: true }), `movida a (${args[1]},${args[2]})`);
      break;
    }
    case 'hp': {
      const t = findToken(state, args[0]);
      const delta = Number(args[1]);
      const ch = t.characterId && state.characters.find((c) => c.id === t.characterId);
      if (ch) {
        const { character } = await api(token, 'PATCH', `/characters/${ch.id}`, { ...ch, hp: Math.min(ch.maxHp, ch.hp + delta) });
        console.log(`${ch.name}: PG ${character.hp}/${character.maxHp}`);
      } else {
        const hp = Math.min(t.maxHp, t.hp + delta);
        ok(await emit('token:update', { id: t.id, hp }), `${t.name}: PG ${hp}/${t.maxHp}`);
      }
      break;
    }
    case 'cond': {
      const t = findToken(state, args[0]);
      const list = t.conditions || [];
      const c = args[1];
      ok(await emit('token:update', { id: t.id, conditions: list.includes(c) ? list.filter((x) => x !== c) : [...list, c] }));
      break;
    }
    case 'add': {
      const hp = Number(flags.hp) || 10;
      ok(await emit('token:add', {
        name: args[0], img: `/assets/demo/token-${args[1] || 'goblin'}.svg`, x: Number(args[2]) * g, y: Number(args[3]) * g,
        hp, maxHp: hp, size: 1, hidden: flags.hidden === true,
      }), `"${args[0]}" colocado`);
      break;
    }
    case 'remove': ok(await emit('token:remove', { id: findToken(state, args[0]).id })); break;
    case 'reveal': { const t = findToken(state, args[0]); ok(await emit('token:update', { id: t.id, hidden: !t.hidden }), t.hidden ? 'revelada' : 'oculta'); break; }
    case 'scene': {
      const q = String(args[0]).toLowerCase();
      const target = (state.scenes || []).find((x) => x.name.toLowerCase().startsWith(q)) || die('escena no encontrada');
      ok(await emit('scene:launch', { id: target.id }), `escena lanzada: ${target.name}`);
      break;
    }
    case 'end': ok(await emit('turn:end', {}), 'turno terminado'); break;
    case 'ini': {
      const ini = state.initiative;
      if (args[0] === 'clear') { ok(await emit('initiative:set', { entries: [], turn: 0, round: 1 })); break; }
      if (args[0] === 'next') { ok(await emit('turn:end', {}), 'siguiente turno'); break; }
      const dex = (t) => { const c = t.characterId && state.characters.find((x) => x.id === t.characterId); return c ? Math.floor((c.stats.dex - 10) / 2) : 0; };
      const entries = state.tokens.filter((t) => !t.hidden).map((t) => {
        const c = t.characterId && state.characters.find((x) => x.id === t.characterId);
        return { id: t.id, tokenId: t.id, name: c ? c.name : t.name, img: t.img, value: 1 + Math.floor(Math.random() * 20) + dex(t) };
      }).sort((a, b) => b.value - a.value);
      ok(await emit('initiative:set', { entries, turn: 0, round: 1 }), entries.map((e) => `${e.name} ${e.value}`).join(' · '));
      break;
    }
    case 'request': {
      const to = flags.to && state.users.find((u) => u.username === flags.to);
      ok(await emit('roll:request', { ability: args[0], dc: Number(args[1]), label: args[2] || 'Prueba', userId: to ? to.id : null }), 'tirada pedida');
      break;
    }
    default: die(`comando desconocido: ${cmd}`);
  }
  socket.close();
  process.exit(0);
}

main().catch((e) => die(e.message));
