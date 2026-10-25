import { h, icon, button, openDialog, toast, promptDialog, confirmDialog } from '../dom.js';
import { api, errorMessage } from '../api.js';

/** En-tête de page : un seul <h1> par vue (reçoit le focus au changement de page). */
export function viewHead(title, sub, ...actions) {
  return h('div', { class: 'view-head' }, h('div', {}, h('h1', { id: 'page-title', tabindex: '-1', text: title }), sub ? h('p', { text: sub }) : null), actions.length ? h('div', { class: 'toolbar' }, actions) : null);
}

/** Télécharge un fichier : les droits sont vérifiés par le serveur AVANT l'émission de l'URL signée. */
export async function downloadFile(fileId, { share } = {}) {
  try {
    const path = share ? `/public/share/files/${fileId}/download` : `/files/${fileId}/download`;
    const out = await api.get(path, share ? { share } : undefined);
    const a = h('a', { href: out.url, rel: 'noopener noreferrer' });
    document.body.append(a);
    a.click();
    a.remove();
  } catch (err) {
    toast(errorMessage(err), { error: true });
  }
}

/** Sélecteur de dossier (déplacement). Retourne l'id choisi, 'root' ou null si annulé. */
export function folderPicker({ title = 'Choisir un dossier', excludeIds = [] } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    let current = 'root';
    const list = h('ul', { class: 'list-clean grid gap-1' });
    const crumb = h('p', { class: 'sub m-0', 'aria-live': 'polite' });
    const choose = button({ label: 'Déplacer ici', cls: 'btn btn-primary', onClick: () => { answered = true; resolve(current); d.close('ok'); } });
    async function load(id) {
      try {
        const data = await api.get(`/folders/${id}/contents`);
        current = id;
        crumb.textContent = data.folder ? `Dossier : ${data.folder.name}` : 'Dossier : Mes fichiers (racine)';
        list.replaceChildren();
        if (id !== 'root') {
          const up = data.folder?.parentId ?? 'root';
          list.append(h('li', {}, button({ label: 'Dossier parent', icon: 'corner-left-up', cls: 'btn btn-ghost btn-sm', onClick: () => load(up) })));
        }
        const subs = data.folders.filter((f) => !excludeIds.includes(f.id));
        if (!subs.length) list.append(h('li', { class: 'sub', text: 'Aucun sous-dossier ici.' }));
        for (const f of subs) list.append(h('li', {}, button({ label: f.name, icon: 'folder', cls: 'btn btn-ghost btn-sm', onClick: () => load(f.id) })));
      } catch (err) {
        list.replaceChildren(h('li', { class: 'form-error', role: 'alert', text: errorMessage(err) }));
      }
    }
    const d = openDialog({
      title,
      body: [crumb, list],
      actions: [h('button', { type: 'button', class: 'btn btn-secondary', text: 'Annuler', on: { click: () => d.close('cancel') } }), choose],
      onClose: () => { if (!answered) resolve(null); },
    });
    load('root');
  });
}

export async function renameItem(kind, item) {
  const isFile = kind === 'file';
  const ext = isFile ? `.${item.extension}` : '';
  const base = isFile ? item.name.slice(0, -ext.length) : item.name;
  const v = await promptDialog({
    title: isFile ? 'Renommer le fichier' : 'Renommer le dossier',
    label: 'Nouveau nom',
    value: base,
    help: isFile ? `L'extension ${ext} est conservée.` : undefined,
    validate: (x) => (!x.trim() ? 'Le nom est obligatoire.' : /[\\/]/.test(x) ? 'Le nom ne peut pas contenir « / » ni « \\ ».' : x.length > 200 ? 'Nom trop long.' : null),
  });
  if (v === null) return false;
  try {
    await api.patch(isFile ? `/files/${item.id}` : `/folders/${item.id}`, { name: v.trim() + ext });
    toast('Renommé.');
    return true;
  } catch (err) {
    toast(errorMessage(err), { error: true });
    return false;
  }
}

export async function moveItems(files, folders) {
  const target = await folderPicker({ title: files.length + folders.length > 1 ? 'Déplacer la sélection' : 'Déplacer vers…', excludeIds: folders.map((f) => f.id) });
  if (target === null) return false;
  const folderId = target === 'root' ? null : target;
  let failed = 0;
  for (const f of files) {
    try { await api.patch(`/files/${f.id}`, { folderId }); } catch (err) { failed++; toast(`${f.name} : ${errorMessage(err)}`, { error: true }); }
  }
  for (const f of folders) {
    try { await api.patch(`/folders/${f.id}`, { parentId: folderId }); } catch (err) { failed++; toast(`${f.name} : ${errorMessage(err)}`, { error: true }); }
  }
  if (!failed) toast('Déplacé.');
  return true;
}

export async function trashItems(files, folders) {
  const n = files.length + folders.length;
  const ok = await confirmDialog({
    title: n > 1 ? `Mettre ${n} éléments à la corbeille ?` : 'Mettre à la corbeille ?',
    message: 'Ils seront supprimés définitivement au bout de 30 jours. Les partages sont suspendus pendant ce temps.',
    confirmLabel: 'Mettre à la corbeille',
    danger: true,
  });
  if (!ok) return false;
  for (const f of files) {
    try { await api.delete(`/files/${f.id}`); } catch (err) { toast(`${f.name} : ${errorMessage(err)}`, { error: true }); }
  }
  for (const f of folders) {
    try { await api.delete(`/folders/${f.id}`); } catch (err) { toast(`${f.name} : ${errorMessage(err)}`, { error: true }); }
  }
  toast(n > 1 ? 'Éléments placés dans la corbeille.' : 'Placé dans la corbeille.');
  return true;
}

export const loadingBlock = () => h('div', { class: 'empty', role: 'status' }, icon('loader-circle', 'icon-xl spin'), h('p', { text: 'Chargement…' }));
