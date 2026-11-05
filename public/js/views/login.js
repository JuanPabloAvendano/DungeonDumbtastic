// Pantalla de acceso: entrar o crear cuenta de jugador.
import { h, clear, field, toast } from '../ui.js';
import { api } from '../api.js';

export async function loginView(root, { onLogin }) {
  const settings = await api.get('/public-settings').catch(() => ({ openRegistration: false }));
  let mode = 'login';

  const user = h('input', { autocomplete: 'username', required: true, placeholder: 'tu_usuario' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••' });
  const display = h('input', { maxlength: 40, placeholder: 'Cómo te verán en la mesa' });
  const displayField = field('Nombre visible', display);
  const submit = h('button.btn.primary.big', { type: 'submit' }, 'Entrar a la taberna');
  const tabs = h('div.tabs');

  function renderTabs() {
    clear(tabs,
      h(`button.tab${mode === 'login' ? '.active' : ''}`, { type: 'button', onclick: () => setMode('login') }, 'Entrar'),
      settings.openRegistration
        ? h(`button.tab${mode === 'register' ? '.active' : ''}`, { type: 'button', onclick: () => setMode('register') }, 'Crear cuenta')
        : null);
    displayField.classList.toggle('hidden', mode !== 'register');
    submit.textContent = mode === 'login' ? 'Entrar a la taberna' : 'Crear aventurero';
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  }
  function setMode(m) {
    mode = m;
    renderTabs();
  }

  const form = h('form.login-card', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const me = mode === 'login'
          ? await api.login(user.value, pass.value)
          : await api.register(user.value, pass.value, display.value);
        onLogin(me);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('div.logo', h('img.logo-mark', { src: '/assets/d20.svg', alt: '' }), h('h1', 'Dungeon', h('em', 'Dumbtastic')), h('p', 'Mesa virtual para tus partidas de rol')),
  tabs,
  field('Usuario', user),
  displayField,
  field('Contraseña', pass),
  submit,
  !settings.openRegistration ? h('p.tiny.muted.center', 'El registro está cerrado: pide tu cuenta al admin.') : null);

  renderTabs();
  clear(root, h('div.login-screen', form,
    h('p.login-foot', 'Las llamadas, por Discord. La aventura, aquí. · ', h('a', { href: '#/guia' }, '¿Cómo funciona?'))));
  user.focus();
}
