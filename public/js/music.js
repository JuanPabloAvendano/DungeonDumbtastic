// Reproductor sincronizado: el DM controla qué suena; cada cliente calcula la posición
// con el reloj del servidor. El volumen local (y silenciar) es de cada persona.
const DRIFT_TOLERANCE_SEC = 1.5;
const PREFS_KEY = 'da.audio';

function loadPrefs() {
  try { return { volume: 0.8, muted: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { volume: 0.8, muted: false }; }
}

export class MusicPlayer {
  /** @param {{ onBlocked?: () => void, onChange?: () => void }} hooks */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.prefs = loadPrefs();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.music = null;
    this.tracks = [];
    this.skew = 0;
    this.blocked = false;
    this.audio.addEventListener('loadedmetadata', () => this.sync());
    this.audio.addEventListener('ended', () => this.hooks.onChange?.());
  }

  get current() {
    return this.music?.trackId ? this.tracks.find((t) => t.id === this.music.trackId) || null : null;
  }

  get playing() {
    return Boolean(this.music?.playing && this.current);
  }

  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* sin almacenamiento */ }
  }

  setVolume(v) {
    this.prefs = { ...this.prefs, volume: Math.min(1, Math.max(0, v)) };
    this.savePrefs();
    this.applyVolume();
  }

  toggleMute() {
    this.prefs = { ...this.prefs, muted: !this.prefs.muted };
    this.savePrefs();
    this.applyVolume();
  }

  applyVolume() {
    const shared = this.music?.volume ?? 0.7;
    this.audio.volume = this.prefs.muted ? 0 : shared * this.prefs.volume;
  }

  /** Estado que manda el servidor: (music, tracks, serverNow) */
  apply(music, tracks, serverNow) {
    if (tracks) this.tracks = tracks;
    if (serverNow) this.skew = serverNow - Date.now();
    this.music = music;
    const track = this.current;
    if (!track) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.hooks.onChange?.();
      return;
    }
    const src = new URL(track.url, location.href).href;
    if (this.audio.src !== src) this.audio.src = src;
    this.audio.loop = Boolean(music.loop);
    this.applyVolume();
    this.sync();
    this.hooks.onChange?.();
  }

  position() {
    const m = this.music;
    if (!m) return 0;
    const raw = m.playing ? m.offset + (Date.now() + this.skew - m.startedAt) / 1000 : m.offset;
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) return m.loop ? raw % d : Math.min(raw, d);
    return raw;
  }

  sync() {
    if (!this.music || !this.current) return;
    const target = this.position();
    if (Math.abs(this.audio.currentTime - target) > DRIFT_TOLERANCE_SEC && Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = target;
    }
    if (!this.music.playing) {
      this.audio.pause();
      return;
    }
    if (!this.music.loop && Number.isFinite(this.audio.duration) && target >= this.audio.duration) return;
    this.audio.play().then(() => { this.blocked = false; }).catch(() => {
      // El navegador exige un clic del usuario antes de reproducir sonido.
      this.blocked = true;
      this.hooks.onBlocked?.();
    });
  }

  unlock() {
    this.blocked = false;
    this.sync();
  }

  sfx(url) {
    const a = new Audio(url);
    a.volume = this.prefs.muted ? 0 : this.prefs.volume;
    a.play().catch(() => this.hooks.onBlocked?.());
  }

  destroy() {
    this.audio.pause();
    this.audio.removeAttribute('src');
  }
}
