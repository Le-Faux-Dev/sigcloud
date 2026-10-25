import { h, icon } from './dom.js';
import { api, ApiError, errorMessage, loadSession, getConfig } from './api.js';
import { mountContours } from './contours.js';

const page = document.body.dataset.page;
const errBox = document.getElementById('form-error');
const okBox = document.getElementById('form-ok');
const form = document.querySelector('form');
const submitBtn = form?.querySelector('button[type="submit"]');
const hostC = document.getElementById('contours');
if (hostC) mountContours(hostC);

function showError(message) {
  errBox.replaceChildren(icon('triangle-alert'), h('span', { text: message }));
  errBox.hidden = false;
  errBox.focus();
}
function clearErrors() {
  if (errBox) errBox.hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}
function markFields(err) {
  const fields = err instanceof ApiError ? err.details?.fields ?? [] : [];
  let first = null;
  for (const f of fields) {
    const input = form.querySelector(`[name="${f.champ}"]`);
    if (input) { input.setAttribute('aria-invalid', 'true'); first ??= input; }
  }
  return first;
}

async function submit(handler) {
  clearErrors();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  submitBtn.disabled = true;
  submitBtn.setAttribute('aria-busy', 'true');
  try {
    await handler(Object.fromEntries(new FormData(form)));
  } catch (err) {
    showError(err instanceof ApiError && err.status === 429 ? 'Trop de tentatives. Patiente quelques minutes avant de réessayer.' : errorMessage(err));
    markFields(err)?.focus();
    if (!(err instanceof ApiError) || err.status !== 429) errBox.focus();
  } finally {
    submitBtn.disabled = false;
    submitBtn.removeAttribute('aria-busy');
  }
}

form?.setAttribute('novalidate', '');
form?.addEventListener('submit', (e) => e.preventDefault());

if (page === 'login' || page === 'register') {
  loadSession().then((u) => { if (u) location.replace('/app.html'); }).catch(() => {});
}

if (page === 'login') {
  if (new URLSearchParams(location.search).get('expired')) {
    okBox.replaceChildren(icon('info'), h('span', { text: 'Ta session a expiré. Reconnecte-toi pour continuer.' }));
    okBox.hidden = false;
  }
  form.addEventListener('submit', () => submit(async (v) => {
    await api.post('/auth/login', { email: v.email.trim(), password: v.password });
    location.replace('/app.html');
  }));
}

if (page === 'register') {
  form.addEventListener('submit', () => submit(async (v) => {
    await api.post('/auth/register', { email: v.email.trim(), password: v.password, displayName: v.displayName.trim() });
    location.replace('/app.html');
  }));
}

if (page === 'forgot') {
  getConfig().then((c) => {
    if (!c.features.passwordResetByEmail) {
      document.getElementById('no-mail').hidden = false;
    }
  }).catch(() => {});
  form.addEventListener('submit', () => submit(async (v) => {
    const r = await api.post('/auth/password-reset/request', { email: v.email.trim() });
    okBox.replaceChildren(icon('circle-check'), h('span', { text: r.message ?? 'Si un compte existe avec cette adresse, un e-mail vient d\'être envoyé.' }));
    okBox.hidden = false;
    okBox.focus();
  }));
}

if (page === 'reset') {
  // Le jeton est dans le fragment (#) : il n'est jamais envoyé au serveur ni conservé dans l'historique de requêtes.
  const token = location.hash.slice(1);
  if (!token) {
    form.hidden = true;
    errBox.replaceChildren(icon('triangle-alert'), h('span', { text: 'Lien invalide. Redemande un nouveau lien de réinitialisation.' }));
    errBox.hidden = false;
  }
  form.addEventListener('submit', () => submit(async (v) => {
    await api.post('/auth/password-reset/confirm', { token, password: v.password });
    history.replaceState(null, '', location.pathname);
    form.hidden = true;
    okBox.replaceChildren(icon('circle-check'), h('span', {}, 'Mot de passe modifié. ', h('a', { href: '/login.html', text: 'Se connecter' })));
    okBox.hidden = false;
    okBox.focus();
  }));
}
