// Respaldo rápido: el super admin descarga un .tar.gz con la base (instantánea SQLite), las subidas y
// el compendio. La nube no guarda nada fuera del contenedor: el PC lo baja cada 10 minutos
// (scripts/respaldo.sh) y lo vuelve a subir con la imagen al redesplegar (scripts/nube.sh).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { snapshot, savedAt, bootSavedAt, DATA_DIR } = require('./db');
const { log } = require('./logger');

// Lo que hace falta para reconstruir la mesa; quedan fuera logs, copias viejas y los modelos del traductor.
const FILE_ENTRIES = ['uploads', 'compendio', 'docs'];
const DB_NAME = 'db.sqlite';
// Identifica este arranque: si cambia entre dos respaldos, el contenedor se reinició.
const STARTED_AT = Date.now();

function backupName() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `dungeondumbtastic-${stamp}.tar.gz`;
}

function registerBackup(r, admin) {
  r.get('/admin/backup', admin, (req, res) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-respaldo-'));
    const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      snapshot(path.join(tmpDir, DB_NAME));
    } catch (err) {
      cleanup();
      log.error('no se pudo sacar la instantánea de la base', { error: err.message });
      return res.status(500).json({ error: 'No se pudo preparar el respaldo' });
    }
    const entries = FILE_ENTRIES.filter((name) => fs.existsSync(path.join(DATA_DIR, name)));
    const tar = spawn('tar', ['-czf', '-', '-C', tmpDir, DB_NAME, '-C', DATA_DIR, ...entries]);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${backupName()}"`);
    // Para que el PC note si la nube volvió a un estado anterior (ver scripts/respaldo.sh).
    res.setHeader('X-DD-Saved-At', String(savedAt()));
    res.setHeader('X-DD-Boot-Saved-At', String(bootSavedAt()));
    res.setHeader('X-DD-Started-At', String(STARTED_AT));
    tar.stdout.pipe(res);
    tar.stderr.on('data', (chunk) => log.warn('tar avisa durante el respaldo', { msg: String(chunk).slice(0, 200) }));
    tar.on('error', (err) => {
      cleanup();
      log.error('no se pudo lanzar tar para el respaldo', { error: err.message });
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear el respaldo' });
      else res.destroy(err);
    });
    tar.on('close', (code) => {
      cleanup();
      if (code === 0) log.info('respaldo descargado', { user: req.user.username, entries: [DB_NAME, ...entries] });
      else {
        log.error('tar terminó con error en el respaldo', { code });
        res.destroy(new Error(`tar salió con código ${code}`));
      }
    });
    res.on('close', () => { if (tar.exitCode === null) tar.kill(); });
  });
}

module.exports = { registerBackup };
