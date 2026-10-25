// Page publique de partage : le jeton vit dans le fragment (#), envoyé seulement dans l'en-tête X-Share-Token.
import { h, icon, button, toast } from './dom.js';
import { api, errorMessage, getConfig } from './api.js';
import { formatBytes, formatDate } from './format.js';
import { renderPreview } from './preview.js';
import { fileIconBox, folderIconBox, securityBadge, previewBadge, emptyState, SECURITY_EXPLANATION } from './ui.js';
import { downloadFile } from './views/common.js';

const token = location.hash.slice(1);
const main = document.getElementById('main');
let destroy = () => {};

function unavailable(reason) {
  main.replaceChildren(h('div', { class: 'panel' }, emptyState({ iconName: 'link-2-off', title: 'Lien indisponible', text: `${reason ?? 'Ce lien est invalide, a expiré ou a été révoqué.'} Demande un nouveau lien à la personne qui te l'a envoyé.` })));
  document.title = 'Lien indisponible · SIG-Cloud';
}

async function showFile(file, canDownload, back) {
  destroy();
  const config = await getConfig();
  const stage = h('div', { class: 'grid gap-3' });
  const dl = canDownload ? button({ label: 'Télécharger', icon: 'download', cls: 'btn btn-primary', onClick: () => downloadFile(file.id, { share: token }) }) : null;
  main.replaceChildren(
    ...[back ? button({ label: 'Retour', icon: 'arrow-left', cls: 'btn btn-ghost btn-sm', onClick: back }) : null,
    h('div', { class: 'view-head' }, h('div', {}, h('h1', { id: 'page-title', tabindex: '-1', text: file.name }), h('p', { text: `${file.formatLabel} · ${formatBytes(file.sizeBytes)}` })), dl ? h('div', { class: 'toolbar' }, dl) : null),
    h('div', { class: 'toolbar' }, previewBadge(file), securityBadge(file)),
    stage,
    h('p', { class: 'help', text: SECURITY_EXPLANATION })].filter(Boolean),
  );
  document.title = `${file.name} · SIG-Cloud`;
  const p = await renderPreview(stage, { file, config, canDownload, onDownload: () => downloadFile(file.id, { share: token }), fetchPreview: () => api.get(`/public/share/files/${file.id}/preview`, { share: token }) });
  destroy = p.destroy;
  document.getElementById('page-title')?.focus({ preventScroll: true });
}

async function boot() {
  if (!token) return unavailable();
  let root;
  try {
    root = await api.get('/public/share', { share: token });
  } catch (err) {
    if (err.status >= 400 && err.status < 500 && err.status !== 429) return unavailable(err.status === 404 ? null : err.message);
    main.replaceChildren(h('div', { class: 'panel' }, emptyState({ iconName: 'triangle-alert', title: 'Chargement impossible', text: errorMessage(err) })));
    return;
  }
  const info = h('p', { class: 'help m-0', text: `${root.canDownload ? 'Consultation et téléchargement autorisés.' : 'Consultation seule : le téléchargement n\'est pas autorisé.'}${root.expiresAt ? ` Lien valable jusqu'au ${formatDate(root.expiresAt)}.` : ''}` });
  if (root.kind === 'file') {
    await showFile(root.file, root.canDownload, null);
    main.append(info);
    return;
  }
  // Dossier partagé : navigation dans le dossier et ses sous-dossiers
  const trail = [{ id: root.folder.id, name: root.folder.name }];
  async function open(id, name, push = true) {
    destroy();
    let data;
    try {
      data = id === root.folder.id && root.files ? root : await api.get(`/public/share/folders/${id}`, { share: token });
    } catch (err) {
      toast(errorMessage(err), { error: true });
      return;
    }
    if (push) trail.push({ id, name });
    renderFolder(data);
  }
  function renderFolder(data) {
    const here = trail[trail.length - 1];
    const crumbs = h('nav', { 'aria-label': "Fil d'Ariane" }, h('ol', { class: 'crumbs' }, trail.map((c, i) => h('li', {}, i ? icon('chevron-right') : null, i === trail.length - 1 ? h('span', { 'aria-current': 'page', text: c.name }) : h('button', { type: 'button', text: c.name, on: { click: () => { trail.length = i + 1; open(c.id, c.name, false); } } })))));
    const rows = [
      ...data.folders.map((f) => h('li', { class: 'share-row' }, h('div', { class: 'name-cell' }, folderIconBox(), h('button', { type: 'button', class: 'name-link', text: f.name, 'aria-label': `Ouvrir le dossier ${f.name}`, on: { click: () => open(f.id, f.name) } })))),
      ...data.files.map((f) => h('li', { class: 'share-row' }, h('div', { class: 'name-cell' }, fileIconBox(f), h('div', { class: 'min-w-0' }, h('button', { type: 'button', class: 'name-link', text: f.name, on: { click: () => showFile(f, root.canDownload, () => { renderFolder(data); }) } }), h('p', { class: 'sub m-0', text: `${f.formatLabel} · ${formatBytes(f.sizeBytes)}` }))), h('div', {}, previewBadge(f)))),
    ];
    main.replaceChildren(
      h('div', { class: 'view-head' }, h('div', {}, h('h1', { id: 'page-title', tabindex: '-1', text: trail[0].name }), h('p', { text: 'Dossier partagé avec toi' }))),
      crumbs,
      h('div', { class: 'panel panel-pad' }, rows.length ? h('ul', { class: 'list-clean grid gap-2' }, rows) : emptyState({ iconName: 'folder-open', title: 'Ce dossier est vide' })),
      info,
    );
    document.title = `${here.name} · SIG-Cloud`;
  }
  renderFolder(root);
}

boot();
