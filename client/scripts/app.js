// Application connectée : coquille (navigation, recherche, envois) + routeur par fragment (#/…).
import { h, icon, button, toast } from './dom.js';
import { api, loadSession, session, getConfig, errorMessage } from './api.js';
import { formatBytes, formatPercent, parseHash } from './format.js';
import { UploadManager } from './upload.js';
import { mountUploadPanel } from './upload-panel.js';

const uploads = new UploadManager();
const state = { quotaLeft: Infinity, dropFolder: null, disabled: false };
const uploadedListeners = new Set();
let current = null; // vue en cours { destroy }
let renderToken = 0;

const NAV = [
  { href: '#/', label: 'Tableau de bord', icon: 'layout-dashboard', match: (p) => p.length === 0 },
  { href: '#/files', label: 'Mes fichiers', icon: 'folder', match: (p) => p[0] === 'files' || p[0] === 'file' },
  { href: '#/shared', label: 'Partagés avec moi', icon: 'users', match: (p) => p[0] === 'shared' },
  { href: '#/sharing', label: 'Partagés par moi', icon: 'share-2', match: (p) => p[0] === 'sharing' },
  { href: '#/trash', label: 'Corbeille', icon: 'trash-2', match: (p) => p[0] === 'trash' },
  { href: '#/storage', label: 'Stockage', icon: 'hard-drive', match: (p) => p[0] === 'storage' },
  { href: '#/settings', label: 'Profil et sécurité', icon: 'user-round', match: (p) => p[0] === 'settings' },
];

const VIEWS = {
  '': () => import('./views/dashboard.js').then((m) => m.dashboardView),
  files: () => import('./views/explorer.js').then((m) => m.explorerView),
  file: () => import('./views/viewer.js').then((m) => m.viewerView),
  shared: () => import('./views/sharing.js').then((m) => m.sharedWithMeView),
  sharing: () => import('./views/sharing.js').then((m) => m.sharedByMeView),
  trash: () => import('./views/trash.js').then((m) => m.trashView),
  storage: () => import('./views/storage.js').then((m) => m.storageView),
  settings: () => import('./views/settings.js').then((m) => m.settingsView),
  admin: () => import('./views/admin.js').then((m) => m.adminView),
};

async function boot() {
  const root = document.getElementById('app');
  let user;
  try {
    user = await loadSession();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'centered-page' }, h('div', { class: 'panel panel-pad centered-card' }, h('h1', { text: 'Service momentanément indisponible' }), h('p', { text: errorMessage(err) }), button({ label: 'Réessayer', cls: 'btn btn-primary', onClick: () => location.reload() }))));
    return;
  }
  if (!user) {
    location.replace('/login.html');
    return;
  }
  window.addEventListener('sig:unauthorized', () => location.replace('/login.html?expired=1'), { once: true });
  getConfig().catch(() => {});

  // ── Éléments de la coquille ──
  const usageText = h('span', { class: 'sub-light' });
  const usageBar = h('span', {});
  const meter = h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Espace de stockage utilisé', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, usageBar);
  const nameEl = h('strong', { text: user.displayName });
  const nav = h('nav', { 'aria-label': 'Navigation principale', class: 'nav' }, NAV.map((n) => h('a', { class: 'nav-item', href: n.href, data: { key: n.href } }, icon(n.icon), h('span', { text: n.label }))));
  const adminLink = h('a', { class: 'nav-item', href: '#/admin', data: { key: '#/admin' } }, icon('shield-check'), h('span', { text: 'Administration' }));
  if (user.role === 'ADMIN') nav.append(h('p', { class: 'nav-title', text: 'Administration' }), adminLink);

  const logout = button({ label: 'Se déconnecter', icon: 'log-out', cls: 'btn btn-ghost btn-sm', onClick: async () => {
    try { await api.post('/auth/logout', {}); } catch { /* la session est de toute façon abandonnée */ }
    session.clear();
    location.replace('/login.html');
  } });
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Menu' },
    h('a', { class: 'brand', href: '#/' }, icon('map-pinned', 'brand-mark icon-lg'), h('span', { text: 'SIG-Cloud' })),
    nav,
    h('div', { class: 'sidebar-foot' }, h('div', {}, nameEl, h('div', { class: 'sub-light', text: user.email })), meter, usageText, logout));

  const fileInput = h('input', { type: 'file', multiple: true, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', id: 'file-input' });
  const main = h('main', { id: 'main', tabindex: '-1' });
  const menuToggle = h('button', { type: 'button', class: 'icon-btn menu-toggle', 'aria-label': 'Ouvrir le menu', 'aria-controls': 'sidebar', 'aria-expanded': 'false' }, icon('menu'));
  const q = h('input', { class: 'input', type: 'search', id: 'top-q', placeholder: 'Rechercher un fichier…', 'aria-label': 'Rechercher dans tous mes fichiers', autocomplete: 'off' });
  const search = h('form', { class: 'search', role: 'search', on: { submit: (e) => { e.preventDefault(); const v = q.value.trim(); location.hash = v ? `#/files?q=${encodeURIComponent(v)}` : '#/files'; } } }, icon('search'), q);
  const topUpload = button({ label: 'Importer', icon: 'upload', cls: 'btn btn-primary btn-sm', onClick: () => pickFiles() });
  const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true' });
  const shellEl = h('div', { class: 'shell', 'data-nav-open': 'false' }, sidebar, scrim, h('div', { class: 'main-col' }, h('header', { class: 'topbar' }, menuToggle, search, topUpload), main));

  const panel = mountUploadPanel(uploads);
  root.replaceChildren(shellEl, fileInput, ...panel.el);

  // ── Menu mobile ──
  const mq = window.matchMedia('(max-width: 62rem)');
  const setNav = (open) => {
    shellEl.dataset.navOpen = String(open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    sidebar.inert = mq.matches && !open;
    if (open) nav.querySelector('a')?.focus();
  };
  menuToggle.addEventListener('click', () => setNav(shellEl.dataset.navOpen !== 'true'));
  scrim.addEventListener('click', () => { setNav(false); menuToggle.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shellEl.dataset.navOpen === 'true') { setNav(false); menuToggle.focus(); } });
  mq.addEventListener('change', () => setNav(false));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
  setNav(false);

  // ── Envois ──
  const pickFiles = () => fileInput.click();
  // La liste du champ est « vivante » : on la copie AVANT de vider le champ.
  fileInput.addEventListener('change', () => { const picked = Array.from(fileInput.files); fileInput.value = ''; if (picked.length) addFiles(picked); });
  async function addFiles(list) {
    try {
      await uploads.add(list, { folderId: state.disabled ? null : state.dropFolder, quotaLeft: state.quotaLeft });
    } catch (err) {
      toast(errorMessage(err), { error: true });
    }
  }
  let dragDepth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  document.body.dataset.dropLabel = 'Dépose tes fichiers pour les importer';
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
  });
  let timer;
  uploads.addEventListener('done', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { await refreshUsage(); uploadedListeners.forEach((fn) => fn()); }, 400);
  });

  async function refreshUsage() {
    try {
      const u = await api.get('/files/usage');
      const pct = formatPercent(u.usedBytes, u.quotaBytes);
      usageBar.style.width = `${pct}%`;
      usageBar.className = pct > 95 ? 'crit' : pct > 80 ? 'warn' : '';
      meter.setAttribute('aria-valuenow', String(Math.round(pct)));
      usageText.textContent = `${formatBytes(u.usedBytes)} utilisés sur ${formatBytes(u.quotaBytes)}`;
      state.quotaLeft = Math.max(0, u.quotaBytes - u.usedBytes);
    } catch { /* non bloquant */ }
  }

  const shell = {
    pickFiles,
    refreshUsage,
    reload: () => route(),
    reloadSession: async () => { await loadSession(); nameEl.textContent = session.user.displayName; },
    setCurrentFolder: (id, disabled) => { state.dropFolder = id ?? null; state.disabled = Boolean(disabled); },
    onUploaded: (fn) => { uploadedListeners.add(fn); return () => uploadedListeners.delete(fn); },
  };

  // ── Routeur ──
  async function route() {
    const token = ++renderToken;
    const { path, query } = parseHash(location.hash);
    try { current?.destroy?.(); } catch { /* ignoré */ }
    current = null;
    for (const a of nav.querySelectorAll('a')) {
      const item = NAV.find((n) => n.href === a.dataset.key);
      const on = item ? item.match(path) : path[0] === 'admin';
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    }
    state.dropFolder = null;
    state.disabled = false;
    const key = path[0] ?? '';
    const loader = Object.hasOwn(VIEWS, key) ? VIEWS[key] : null; // hasOwn : « constructor », « __proto__ » ne sont pas des routes
    main.replaceChildren(h('div', { class: 'empty', role: 'status' }, icon('loader-circle', 'icon-xl spin'), h('p', { text: 'Chargement…' })));
    let view;
    if (!loader) {
      view = { title: 'Page introuvable', el: h('div', { class: 'view' }, h('h1', { id: 'page-title', tabindex: '-1', text: 'Page introuvable' }), h('p', { text: 'Cette page n\'existe pas.' }), h('a', { class: 'btn btn-primary', href: '#/' }, 'Retour au tableau de bord')) };
    } else {
      try {
        const fn = await loader();
        view = await fn({ path, query, shell, user: session.user });
      } catch (err) {
        view = { title: 'Erreur', el: h('div', { class: 'view' }, h('div', { class: 'empty', role: 'alert' }, icon('triangle-alert', 'icon-xl'), h('h1', { id: 'page-title', tabindex: '-1', text: 'Chargement impossible' }), h('p', { text: errorMessage(err) }), button({ label: 'Réessayer', cls: 'btn btn-secondary', onClick: () => route() }))) };
      }
    }
    if (token !== renderToken) { view.destroy?.(); return; }
    current = view;
    main.replaceChildren(view.el);
    document.title = `${view.title} · SIG-Cloud`;
    const target = main.querySelector('#page-title') ?? main;
    target.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    // Un dossier partagé en lecture seule : pas d'envoi dedans
  }
  window.addEventListener('hashchange', route);
  await Promise.all([refreshUsage(), route()]);
}

boot();
