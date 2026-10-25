import { h, icon, button, badge } from '../dom.js';
import { api, getConfig } from '../api.js';
import { formatBytes, formatDateTime, CATEGORY_LABELS } from '../format.js';
import { securityBadge, previewBadge, errorState, SECURITY_EXPLANATION } from '../ui.js';
import { renderPreview } from '../preview.js';
import { openShareDialog } from '../share-dialog.js';
import { viewHead, downloadFile, renameItem, trashItems, loadingBlock } from './common.js';

export async function viewerView({ path, shell }) {
  const id = path[1];
  const root = h('div', { class: 'view' }, loadingBlock());
  let destroyPreview = () => {};
  const out = { el: root, title: 'Fichier', destroy: () => destroyPreview() };
  try {
    const [res, config] = await Promise.all([api.get(`/files/${id}`), getConfig()]);
    let { file, access } = res;
    const isOwner = access.level === 'owner';
    out.title = file.name;
    const stage = h('div', { class: 'grid gap-3' });
    const side = h('div', { class: 'map-panel' });

    const meta = h('dl', { class: 'kv' },
      h('dt', { text: 'Format' }), h('dd', { text: `${file.formatLabel} (.${file.extension})` }),
      h('dt', { text: 'Catégorie' }), h('dd', { text: CATEGORY_LABELS[file.category] ?? file.category }),
      h('dt', { text: 'Taille' }), h('dd', { text: formatBytes(file.sizeBytes) }),
      h('dt', { text: 'Ajouté le' }), h('dd', { text: formatDateTime(file.createdAt) }),
      file.geoMeta?.featureCount != null ? [h('dt', { text: 'Éléments' }), h('dd', { text: String(file.geoMeta.featureCount) })] : null,
      file.geoMeta?.crs ? [h('dt', { text: 'Système' }), h('dd', { text: String(file.geoMeta.crs) })] : null,
      isOwner && file.sha256 ? [h('dt', { text: 'SHA-256' }), h('dd', { class: 'break-all', text: file.sha256 })] : null,
    );
    side.append(
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Informations' })), h('div', { class: 'panel-pad grid gap-3' }, meta, h('div', { class: 'flex flex-wrap gap-2' }, previewBadge(file), securityBadge(file)), h('p', { class: 'help m-0', text: SECURITY_EXPLANATION }))),
    );
    if (isOwner && (file.description || file.tags?.length)) {
      side.append(h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Description' })), h('div', { class: 'panel-pad grid gap-2' }, file.description ? h('p', { class: 'm-0', text: file.description }) : null, file.tags?.length ? h('p', { class: 'm-0 flex flex-wrap gap-2' }, file.tags.map((t) => badge('neutral', 'tag', t))) : null)));
    }
    if (!isOwner) side.append(h('div', { class: 'notice' }, icon('eye'), h('p', { text: access.canDownload ? 'Ce fichier est partagé avec toi : consultation et téléchargement autorisés.' : 'Ce fichier est partagé avec toi en consultation seule.' })));

    const actions = [];
    if (access.canDownload) actions.push(button({ label: 'Télécharger', icon: 'download', cls: 'btn btn-primary', onClick: () => downloadFile(file.id) }));
    if (isOwner) {
      actions.push(
        button({ label: 'Partager', icon: 'share-2', onClick: () => openShareDialog({ kind: 'file', id: file.id, name: file.name }) }),
        button({ label: 'Renommer', icon: 'pencil', onClick: async () => { if (await renameItem('file', file)) { location.reload(); } } }),
        button({ label: 'Corbeille', icon: 'trash-2', cls: 'btn btn-danger-ghost', onClick: async () => { if (await trashItems([file], [])) { shell.refreshUsage(); history.length > 1 ? history.back() : (location.hash = '#/files'); } } }),
      );
    }
    const back = h('a', { class: 'btn btn-ghost btn-sm', href: isOwner ? (file.folderId ? `#/files/${file.folderId}` : '#/files') : '#/shared' }, icon('arrow-left'), h('span', { text: isOwner ? 'Retour aux fichiers' : 'Retour aux partages' }));

    root.replaceChildren(back, viewHead(file.name, `${file.formatLabel} · ${formatBytes(file.sizeBytes)}`, ...actions), h('div', { class: 'viewer-grid' }, stage, side));
    const p = await renderPreview(stage, { file, config, canDownload: access.canDownload, onDownload: () => downloadFile(file.id), fetchPreview: () => api.get(`/files/${file.id}/preview`) });
    destroyPreview = p.destroy;
  } catch (err) {
    root.replaceChildren(errorState(err, { retry: () => location.reload() }));
  }
  return out;
}
