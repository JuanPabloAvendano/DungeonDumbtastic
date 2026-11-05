// Punto de entrada: Express + socket.io sirviendo la app y la API.
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { db, flush } = require('./db');
const { ensureSuperAdmin } = require('./auth');
const { buildRouter, UPLOAD_DIR, lanUrls } = require('./routes');
const { setupRealtime } = require('./realtime');
const { log, requestLogger } = require('./logger');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');

db();
const adminPassword = ensureSuperAdmin();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(requestLogger);
app.get('/healthz', (req, res) => res.json({ ok: true, uptimeSec: Math.round(process.uptime()) }));
app.use('/api', buildRouter(io));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));
app.use(express.static(path.join(ROOT, 'public')));
app.get(/^\/(?!api|uploads|vendor).*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use((err, req, res, next) => {
  log.error('error no controlado en HTTP', { path: req.path, error: err.message, stack: err.stack });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

setupRealtime(io);

server.listen(PORT, HOST, () => {
  log.info('servidor iniciado', { port: PORT, host: HOST, pid: process.pid });
  console.info(`\n  ⚔  DungeonDumbtastic listo en http://localhost:${PORT}`);
  const lan = lanUrls(PORT);
  if (lan.length) console.info(`  📶 En tu red local / hotspot: ${lan.join('  ')}`);
  if (adminPassword) {
    console.info(`  👑 Super admin creado → usuario: admin  contraseña: ${adminPassword}`);
    console.info('     (cámbiala en el panel de administración)\n');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error('puerto ocupado', { port: PORT });
    console.error(`\n  ✖ El puerto ${PORT} ya está en uso: probablemente ya hay un servidor de DungeonDumbtastic abierto.`);
    console.error(`    Ciérralo (Ctrl+C en su terminal, o: kill $(lsof -t -i :${PORT})) o usa otro puerto: PORT=3001 npm start\n`);
  } else {
    log.error('no se pudo abrir el servidor', { error: err.message });
  }
  process.exit(1);
});

// Tras una excepción no capturada el proceso queda en estado incierto: se registra y se sale.
process.on('uncaughtException', (err) => {
  log.error('excepción no capturada', { error: err.message, stack: err.stack });
  try { flush(); } catch { /* ya estamos saliendo */ }
  process.exit(1);
});
process.on('unhandledRejection', (err) => log.error('promesa rechazada sin manejar', { error: String(err?.message || err) }));

function shutdown(signal) {
  log.info('servidor detenido', { signal });
  try { flush(); } catch (err) { log.error('error guardando la base al cerrar', { error: err.message }); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
