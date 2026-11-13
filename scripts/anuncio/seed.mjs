// Prepara la instancia de demo del vídeo: barra de acciones de Thorin y objetos junto al grupo.
import { createRequire } from 'node:module';
const require = createRequire('/home/zuno/Work/DungeonAutistic/package.json');
const { io } = require('socket.io-client');
const BASE = 'http://localhost:3200';
const pw = Object.fromEntries(process.env.CREDS.split(',').map((p) => p.split('=')));
const login = async (u) => (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw[u] }) })).json()).token;
const api = (tk, method, url, body) => fetch(`${BASE}/api${url}`, { method, headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
const p1 = await login('jugador1');
const thorin = (await api(p1, 'GET', '/characters')).characters.find((c) => c.name.startsWith('Thorin'));
await api(p1, 'PATCH', `/characters/${thorin.id}`, { ...thorin, cls: 'Guerrero', inventory: [], actions: [
  { name: 'Hacha de batalla', kind: 'action', attack: '1d20+5', damage: '1d8+3', damageType: 'cortante', note: 'Cuerpo a cuerpo, 5 pies.' },
  { name: 'Tomar aliento', kind: 'bonus', damage: '1d10+3', uses: { max: 1, used: 0, reset: 'short' }, note: 'Recuperas 1d10 + nivel PG.' },
  { name: 'Acción súbita', kind: 'free', uses: { max: 1, used: 0, reset: 'short' }, note: 'Una acción más en tu turno.' },
  { name: 'Ataque de oportunidad', kind: 'reaction', attack: '1d20+5' },
  { name: 'Estilo: Defensa', kind: 'passive', note: '+1 a la CA con armadura.' },
], slots: {} });
const dmTk = await login('dm');
const s = io(BASE, { auth: { token: dmTk }, transports: ['websocket'] });
await new Promise((r) => s.on('connect', r));
const emit = (e, p) => new Promise((r) => s.emit(e, p, r));
const { campaigns } = await api(dmTk, 'GET', '/campaigns');
const { state } = await emit('join', { id: campaigns[0].id });
const g = state.scene.grid.size;
const t = state.tokens.find((x) => x.name.startsWith('Thorin'));
await emit('token:add', { name: 'Cofre', img: '/assets/objects/cofre.svg', kind: 'objeto', x: t.x - g, y: t.y,
  object: { use: 'abrir', description: 'Un cofre de madera reforzada, cubierto de musgo.', contents: [{ name: 'Monedas de oro', qty: 40 }, { name: 'Poción de curación', qty: 1 }] } });
await emit('token:add', { name: 'Carta', img: '/assets/objects/carta.svg', kind: 'objeto', x: t.x - g, y: t.y + g,
  object: { use: 'leer', description: 'Una carta sellada con lacre negro.', text: 'Si leéis esto, ya es tarde.\nEl sacerdote no es quien dice ser.\n\n— V.' } });
// Un NPC con hoja completa para el diálogo.
await api(dmTk, 'POST', '/characters', { name: 'Vizconde Drael', race: 'Humano', cls: 'Mago', level: 7, ac: 15, hp: 40, maxHp: 40, portrait: '/assets/demo/vampireguy.jpeg', campaignId: campaigns[0].id });
console.log('listo', campaigns[0].name);
s.close();
