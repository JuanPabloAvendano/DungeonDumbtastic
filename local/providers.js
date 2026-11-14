// Formas de conectar a los amigos con la mesa que corre en este PC. Solo para el lanzador local:
// nada de esto va en la imagen de la nube. Cada proveedor dice qué programa lanza, cómo reconocer
// el enlace en lo que imprime y cómo se instala si falta.
const { execFileSync } = require('child_process');

const PROVIDERS = [
  {
    id: 'lan', name: 'Red local / hotspot', kind: 'lan',
    about: 'Mismo wifi o tu hotspot. Sin internet ni cuentas.',
    install: 'Nada que instalar. Si no entran, abre el puerto: sudo ufw allow <puerto>/tcp',
  },
  {
    id: 'cloudflare', name: 'Cloudflare Tunnel', kind: 'tunel', bin: 'cloudflared',
    about: 'Enlace https gratis sin cuenta. Puede caerse si Cloudflare tiene problemas.',
    install: 'sudo pacman -S cloudflared',
    command: (port) => ['cloudflared', 'tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`],
    match: /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/,
  },
  {
    id: 'pinggy', name: 'Pinggy', kind: 'tunel', bin: 'ssh',
    about: 'Enlace https por SSH, sin instalar nada. Gratis: 60 minutos por enlace.',
    install: 'Viene con ssh (openssh).',
    command: (port) => ['ssh', '-p', '443', '-o', 'StrictHostKeyChecking=no', '-o', 'ServerAliveInterval=30',
      '-o', 'BatchMode=yes', `-R0:localhost:${port}`, 'a.pinggy.io'],
    match: /https:\/\/[a-z0-9-]+\.[a-z0-9.-]*pinggy\.(?:link|online)/,
  },
  {
    id: 'localtunnel', name: 'localtunnel', kind: 'tunel', bin: 'npx',
    about: 'Enlace https con npx. La primera vez pide a tus amigos una clave: tu IP pública.',
    install: 'Viene con Node (npx).',
    command: (port) => ['npx', '--yes', 'localtunnel', '--port', String(port)],
    match: /https:\/\/[a-z0-9-]+\.loca\.lt/,
  },
  {
    id: 'bore', name: 'bore', kind: 'tunel', bin: 'bore',
    about: 'Túnel TCP mínimo a bore.pub. Enlace http (sin candado), pero muy estable.',
    install: 'cargo install bore-cli   (o: yay -S bore)',
    command: (port) => ['bore', 'local', String(port), '--to', 'bore.pub'],
    match: /bore\.pub:(\d+)/, toLink: (m) => `http://bore.pub:${m[1]}`,
  },
  {
    id: 'tailscale', name: 'Tailscale Funnel', kind: 'p2p', bin: 'tailscale',
    about: 'Red privada P2P (WireGuard). Con Funnel, enlace https público y estable.',
    install: 'sudo pacman -S tailscale && sudo systemctl enable --now tailscaled && sudo tailscale up',
    command: (port) => ['tailscale', 'funnel', String(port)],
    match: /https:\/\/[a-z0-9.-]+\.ts\.net\/?/,
  },
  {
    id: 'holesail', name: 'Holesail', kind: 'p2p', bin: 'npx',
    about: 'P2P puro, sin cuentas ni servidores. Cada amigo corre: npx holesail <clave> y abre http://localhost:8989',
    install: 'Viene con Node (npx).',
    command: (port) => ['npx', '--yes', 'holesail', '--live', String(port), '--host', '127.0.0.1'],
    match: /hs:\/\/[a-z0-9]{20,}/i, friends: (key) => `npx holesail ${key}`,
  },
];

const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

/** El enlace (o clave P2P) que el programa del proveedor imprimió, o null si aún no salió. */
function findLink(provider, output) {
  if (!provider?.match) return null;
  const m = provider.match.exec(String(output));
  if (!m) return null;
  return provider.toLink ? provider.toLink(m) : m[0];
}

/** ¿Está instalado el programa que necesita? */
function isInstalled(provider) {
  if (!provider.bin) return true;
  try {
    execFileSync('sh', ['-c', `command -v ${provider.bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { PROVIDERS, providerById, findLink, isInstalled };
