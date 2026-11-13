// Graba los segmentos del anuncio: cada uno en su contexto con vídeo, cursor visible y rótulos.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/zuno/Work/DungeonAutistic/package.json');
const { io } = require('socket.io-client');
const BASE = 'http://localhost:3200';
const DIR = process.argv[2];
const ONLY = process.argv[3] || '';
const pw = Object.fromEntries(process.env.CREDS.split(',').map((p) => p.split('=')));
const SIZE = { width: 1280, height: 720 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tokens = {};
const login = async (u) => (tokens[u] ||= (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw[u] }) })).json()).token);
const api = async (u, method, url, body) => fetch(`${BASE}/api${url}`, { method, headers: { authorization: `Bearer ${await login(u)}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
const campaign = (await api('dm', 'GET', '/campaigns')).campaigns[0];
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });

// Cursor falso (Playwright no graba el puntero) y rótulos de anuncio.
const OVERLAY = () => {
  const style = document.createElement('style');
  style.textContent = `
    #fake-cursor { display: none; position: fixed; z-index: 99999; width: 22px; height: 22px; margin: -3px 0 0 -3px; pointer-events: none; transition: transform .08s; }
    #fake-cursor svg { filter: drop-shadow(0 2px 4px rgba(0,0,0,.7)); }
    .click-ring { position: fixed; z-index: 99998; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid #e3bf6a; border-radius: 50%; pointer-events: none; animation: ring .5s ease-out forwards; }
    @keyframes ring { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    #ad-caption { position: fixed; z-index: 99990; left: 28px; bottom: 28px; max-width: 640px; pointer-events: none; opacity: 0; transform: translateY(16px); transition: all .6s cubic-bezier(.16,1,.3,1); }
    #ad-caption.on { opacity: 1; transform: none; }
    #ad-caption h2 { margin: 0; display: inline-block; padding: 8px 18px; border-radius: 12px; background: #e3bf6a; color: #1d1408; font: 900 30px Cinzel, serif; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
    #ad-caption p { margin: 8px 0 0; display: inline-block; padding: 6px 14px; border-radius: 10px; background: rgba(13,11,18,.92); color: #ece4d4; font: 700 18px Inter, sans-serif; border: 1px solid #3a2f48; }`;
  const add = () => {
    document.head.append(style);
    const c = document.createElement('div');
    c.id = 'fake-cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 18 L7 13 L10.5 20 L13.5 18.5 L10 12 L17 12 Z" fill="#fff" stroke="#111" stroke-width="1.5"/></svg>';
    document.body.append(c);
    addEventListener('mousemove', (e) => { c.style.display = 'block'; c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = 'click-ring';
      Object.assign(r.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
      document.body.append(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
};

async function context(user, video) {
  const tk = user && (await login(user));
  const ctx = await browser.newContext({ viewport: SIZE, ...(video ? { recordVideo: { dir: DIR, size: SIZE } } : {}) });
  if (tk) await ctx.addInitScript((t) => { sessionStorage.setItem('da.token', t); localStorage.setItem('da.token', t); }, tk);
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(user, 'pageerror', e.message));
  return { ctx, page };
}

async function caption(page, title, sub) {
  await page.evaluate(([t, s]) => {
    let el = document.getElementById('ad-caption');
    if (!el) { el = document.createElement('div'); el.id = 'ad-caption'; document.body.append(el); }
    el.classList.remove('on');
    el.innerHTML = '';
    const h2 = document.createElement('h2'); h2.textContent = t; el.append(h2, document.createElement('br'));
    if (s) { const p = document.createElement('p'); p.textContent = s; el.append(p); }
    requestAnimationFrame(() => el.classList.add('on'));
  }, [title, sub]);
}

async function moveTo(page, selector, opts = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no encuentro ${selector}`);
  await page.mouse.move(box.x + box.width * (opts.fx ?? 0.5), box.y + box.height * (opts.fy ?? 0.5), { steps: opts.steps ?? 18 });
  return box;
}
async function click(page, selector, opts) {
  await moveTo(page, selector, opts);
  await wait(180);
  await page.mouse.down();
  await page.mouse.up();
  await wait(opts?.after ?? 500);
}
async function typeSlow(page, text, delay = 55) { await page.keyboard.type(text, { delay }); }

const segments = {
  async intro() {
    const { ctx, page } = await context(null, true);
    await page.goto(`file://${process.env.CARDS}/card.html?m=intro`);
    await wait(9800);
    return ctx;
  },

  async lobby() {
    const { ctx, page } = await context('dm', true);
    await page.goto(`${BASE}/#/`);
    await wait(900);
    await page.mouse.move(640, 300);
    await caption(page, 'Arma la partida en minutos', 'Crea la campaña, invita a tus amigos con su usuario y entra.');
    await moveTo(page, '.card.campaign');
    await wait(1600);
    await click(page, '.card.campaign .btn.primary', { after: 1800 });
    await caption(page, 'Tu mesa, lista para jugar', 'Mapa con cuadrícula, fichas, iniciativa y música para todos.');
    await moveTo(page, '.board', { fx: 0.55, fy: 0.45 });
    await page.mouse.wheel(0, -260);
    await wait(1300);
    await page.mouse.wheel(0, 260);
    await wait(1500);
    return ctx;
  },

  async niebla() {
    const dm = await context('dm', false);
    await dm.page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1500);
    if ((await dm.page.locator('.fog-bar button').first().textContent()).includes('Sin')) await dm.page.locator('.fog-bar button').first().click();
    await wait(600);
    const { ctx, page } = await context('jugador1', true);
    await page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1800);
    await caption(page, 'Niebla de guerra de verdad', 'Cada jugador ve solo lo que alcanza su personaje: 6 casillas.');
    const t = await moveTo(page, '.board-tokens .token:has(.token-name:text-is("Thorin Barbapiedra"))');
    await wait(500);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2 - t.width * 4, t.y + t.height / 2 - t.height * 3, { steps: 40 });
    await page.mouse.up();
    await wait(1600);
    await caption(page, 'Explora y descubre', 'Lo explorado queda en gris. Los enemigos, solo si los ves.');
    await page.mouse.move(t.x + t.width / 2 - t.width * 4, t.y + t.height / 2 - t.height * 3, { steps: 2 });
    const now = await page.locator('.board-tokens .token:has(.token-name:text-is("Thorin Barbapiedra"))').boundingBox();
    await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2, { steps: 10 });
    await page.mouse.down();
    await page.mouse.move(now.x + now.width / 2 + now.width * 4, now.y + now.height / 2 + now.height * 3, { steps: 40 });
    await page.mouse.up();
    await wait(2200);
    await dm.page.locator('.fog-bar button').first().click();
    await wait(400);
    await dm.ctx.close();
    return ctx;
  },

  async dialogo() {
    const { ctx, page } = await context('jugador1', true);
    await page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1600);
    await caption(page, 'Tus NPC hablan', 'El DM da voz a sus personajes, con retrato, sobre el tablero.');
    await page.mouse.move(700, 380, { steps: 12 });
    await wait(1200);
    const s = io(BASE, { auth: { token: await login('dm') }, transports: ['websocket'] });
    await new Promise((r) => s.on('connect', r));
    await new Promise((r) => s.emit('join', { id: campaign.id }, r));
    const npc = (await api('dm', 'GET', '/characters')).characters.find((c) => c.name === 'Vizconde Drael');
    s.emit('chat', { text: 'Bienvenidos a mis tierras, viajeros… Hace siglos que nadie cruza este bosque y sale con vida.', characterId: npc.id, dialog: true });
    await wait(5200);
    s.close();
    return ctx;
  },

  async barra() {
    const { ctx, page } = await context('jugador1', true);
    await page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1600);
    await caption(page, 'Todo tu personaje, a un clic', 'Acciones, conjuros y rasgos en una barra. Sin buscar en el libro.');
    await moveTo(page, '.hotbar');
    await wait(900);
    await click(page, '.hb-btn:has-text("Hacha de batalla")', { after: 900 });
    await caption(page, 'Dados 3D para todos', 'Tira el servidor: nadie hace trampa y todos ven lo mismo.');
    await click(page, '.hb-card .btn.primary', { after: 3800 });
    return ctx;
  },

  async objetos() {
    const { ctx, page } = await context('jugador1', true);
    await page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1700);
    await caption(page, 'Cofres, cartas y botín', 'Acércate, ábrelo y llévatelo a tu inventario.');
    await click(page, '.board-tokens .token.object-token:has(.token-name:text-is("Cofre"))', { after: 700 });
    await click(page, '.object-insp .btn.primary', { after: 1300 });
    await click(page, '.object-insp .list-row .btn', { after: 900 });
    await click(page, '.board-tokens .token.object-token:has(.token-name:text-is("Carta"))', { after: 700 });
    await caption(page, 'Secretos que solo lee quien los encuentra', 'El DM escribe la carta; le sale solo al que la lee.');
    await click(page, '.object-insp .btn.primary', { after: 3200 });
    await page.keyboard.press('Escape');
    await page.locator('.modal-back').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await wait(400);
    await click(page, '.ltab:has-text("Personaje")', { after: 500 });
    await page.locator('.inv-list').scrollIntoViewIfNeeded();
    await moveTo(page, '.inv-list');
    await wait(2000);
    return ctx;
  },

  async libros() {
    const { ctx, page } = await context('jugador1', true);
    await page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1500);
    await caption(page, 'Busca cualquier regla', 'Conjuros, monstruos y objetos de tus libros, también en español.');
    await click(page, '.rail-btn[title^="Libros"]', { after: 700 });
    await click(page, '.cp-search', { after: 200 });
    await typeSlow(page, 'bola de fuego', 90);
    await wait(1800);
    await click(page, '.cp-chips .chip:has-text("Monstruos")', { after: 300 });
    await page.fill('.cp-search', '');
    await typeSlow(page, 'dragon rojo', 90);
    await wait(2400);
    return ctx;
  },

  async notas() {
    const { ctx, page } = await context('jugador1', true);
    await page.goto(`${BASE}/#/mesa/${campaign.id}`);
    await wait(1500);
    await caption(page, 'Apunta lo que pasa', 'Notas privadas con formato. El DM, además, por personaje.');
    await click(page, '.ltab:has-text("Notas")', { after: 700 });
    await click(page, '.notes-panel .btn.primary', { after: 900 });
    await click(page, '.note-body', { after: 200 });
    await page.locator('.ntool[title="Título"]').click();
    await typeSlow(page, 'La cripta');
    await page.keyboard.press('Enter');
    await page.locator('.ntool[title="Normal"]').click();
    await typeSlow(page, 'Hay una carta firmada por V. ');
    await page.locator('.ntool.t-bold').click();
    await typeSlow(page, 'El sacerdote miente.');
    await wait(1800);
    return ctx;
  },

  async taller() {
    const { ctx, page } = await context('dm', true);
    await page.goto(`${BASE}/#/mapas/nuevo`);
    await wait(1500);
    await caption(page, 'Diseña tus propios mapas', 'Salas, pincel, goma, recortes y objetos sin fondo. Y a la partida.');
    await click(page, '.tool-btn:nth-child(5)', { after: 300 });
    const b = await page.locator('.studio-canvas').boundingBox();
    const drag = async (x1, y1, x2, y2) => {
      await page.mouse.move(b.x + x1, b.y + y1, { steps: 10 });
      await page.mouse.down();
      await page.mouse.move(b.x + x2, b.y + y2, { steps: 28 });
      await page.mouse.up();
      await wait(350);
    };
    await drag(140, 120, 420, 330);
    await drag(560, 180, 820, 420);
    await drag(420, 210, 560, 260);
    await click(page, '.tool-btn:nth-child(3)', { after: 300 });
    await drag(250, 220, 330, 260);
    await wait(1500);
    return ctx;
  },

  async outro() {
    const { ctx, page } = await context(null, true);
    await page.goto(`file://${process.env.CARDS}/card.html?m=outro`);
    await wait(8200);
    return ctx;
  },
};

const order = ['intro', 'lobby', 'niebla', 'dialogo', 'barra', 'objetos', 'libros', 'notas', 'taller', 'outro'];
for (const [i, name] of order.entries()) {
  if (ONLY && !ONLY.split(',').includes(name)) continue;
  const ctx = await segments[name]();
  const page = ctx.pages()[0];
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  const dest = `${DIR}/${String(i).padStart(2, '0')}-${name}.webm`;
  fs.renameSync(src, dest);
  console.log('grabado', dest);
}
await browser.close();
