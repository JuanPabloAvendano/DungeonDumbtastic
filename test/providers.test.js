// Lanzador local: cada proveedor de conexión saca su enlace de lo que imprime su programa.
const test = require('node:test');
const assert = require('node:assert');
const { PROVIDERS, findLink, providerById } = require('../local/providers');

const link = (id, out) => findLink(providerById(id), out);

test('Cloudflare: el enlace trycloudflare, no el de la API', () => {
  const out = 'INF Requesting new quick Tunnel on trycloudflare.com...\nhttps://api.trycloudflare.com\n|  https://gentle-owl-12.trycloudflare.com  |';
  assert.strictEqual(link('cloudflare', out), 'https://gentle-owl-12.trycloudflare.com');
});

test('Pinggy, localtunnel, bore y Tailscale', () => {
  assert.strictEqual(link('pinggy', 'You are not authenticated.\nhttp://rnxyz-1-2-3-4.a.free.pinggy.link\nhttps://rnxyz-1-2-3-4.a.free.pinggy.link'), 'https://rnxyz-1-2-3-4.a.free.pinggy.link');
  assert.strictEqual(link('localtunnel', 'your url is: https://brave-dog-42.loca.lt'), 'https://brave-dog-42.loca.lt');
  assert.strictEqual(link('bore', '2026-11-13T22:00:00Z INFO bore_cli::client: listening at bore.pub:43117'), 'http://bore.pub:43117');
  assert.strictEqual(link('tailscale', 'Available on the internet:\n\nhttps://mi-pc.tail1234.ts.net/\n|-- proxy http://127.0.0.1:3000'), 'https://mi-pc.tail1234.ts.net/');
});

test('Holesail: la clave de conexión P2P', () => {
  const key = 'hs://s000' + 'a1b2c3d4'.repeat(8);
  assert.strictEqual(link('holesail', `Holesail is now listening on 127.0.0.1:3000\nConnection string: ${key}\n`), key);
});

test('sin enlace todavía devuelve null', () => {
  for (const p of PROVIDERS.filter((x) => x.match)) assert.strictEqual(findLink(p, 'conectando…'), null);
});

test('cada proveedor sabe cómo instalarse y qué comando lanza', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.name && p.kind && p.install, p.id);
    if (p.command) assert.ok(Array.isArray(p.command(3000)) && p.command(3000).join(' ').includes('3000'), p.id);
  }
});
