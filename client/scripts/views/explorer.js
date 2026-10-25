import { h, icon, button, openMenu, toast, promptDialog, prefs } from '../dom.js';
import { api, errorMessage, getConfig } from '../api.js';
import { formatBytes, formatDate, CATEGORY_LABELS } from '../format.js';
import { fileIconBox, folderIconBox, securityBadge, previewBadge, emptyState, errorState } from '../ui.js';
import { openShareDialog } from '../share-dialog.js';
import { viewHead, downloadFile, renameItem, moveItems, trashItems, loadingBlock } from './common.js';

/**
 * Explorateur : liste ou grille, tri, recherche/filtres, sélection multiple, actions par élément.
 * Un dossier partagé avec moi s'ouvre ici en lecture seule (level = 'grant').
 */
export async function explorerView({ path, query, shell }) {
  const folderParam = path[1] ?? 'root';
  const root = h('div', { class: 'view' });
  const body = h('div', { class: 'grid gap-4' }, loadingBlock());
  const state = {
    q: query.get('q') ?? '',
    category: query.get('category') ?? '',
    preview: query.get('preview') ?? '',
    sort: prefs.get('sort', 'name'),
    order: prefs.get('order', 'asc'),
    mode: prefs.get('mode', 'list'),
    selected: new Set(),
  };
  const searching = () => Boolean(state.q || state.category || state.preview);
  let data = { folders: [], files: [], folder: null, breadcrumb: [], level: 'owner', canDownload: true };
  const config = await getConfig();

  const filesById = () => new Map(data.files.map((f) => [f.id, f]));
  const foldersById = () => new Map(data.folders.map((f) => [f.id, f]));
  const owner = () => data.level === 'owner';

  async function load() {
    body.replaceChildren(loadingBlock());
    try {
      if (searching()) {
        const qs = new URLSearchParams({ folderId: 'all', limit: '100', sort: state.sort === 'type' ? 'name' : state.sort, order: state.order });
        if (state.q) qs.set('q', state.q);
        if (state.category) qs.set('category', state.category);
        if (state.preview) qs.set('preview', state.preview);
        const res = await api.get(`/files?${qs}`);
        data = { folders: [], files: res.items, folder: null, breadcrumb: [], level: 'owner', canDownload: true, total: res.total };
      } else {
        data = await api.get(`/folders/${folderParam}/contents`);
      }
      state.selected.clear();
      render();
      shell.setCurrentFolder(owner() && !searching() ? (data.folder?.id ?? null) : undefined, !owner() || searching());
    } catch (err) {
      body.replaceChildren(errorState(err, { retry: load }));
    }
  }

  const sortItems = (items, isFolder) => {
    const dir = state.order === 'asc' ? 1 : -1;
    const key = { name: (x) => x.name.toLocaleLowerCase('fr'), size: (x) => x.sizeBytes ?? 0, date: (x) => x.createdAt }[state.sort] ?? ((x) => x.name.toLocaleLowerCase('fr'));
    return [...items].sort((a, b) => {
      if (isFolder && state.sort === 'size') return a.name.localeCompare(b.name, 'fr');
      const ka = key(a), kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
    });
  };

  // ── Actions ──
  const openFolder = (id) => { location.hash = `#/files/${id}`; };
  const openFile = (id) => { location.hash = `#/file/${id}`; };
  const refresh = async () => { await load(); shell.refreshUsage(); };

  async function newFolder() {
    const v = await promptDialog({ title: 'Nouveau dossier', label: 'Nom du dossier', confirmLabel: 'Créer', validate: (x) => (!x.trim() ? 'Le nom est obligatoire.' : /[\\/]/.test(x) ? 'Le nom ne peut pas contenir « / » ni « \\ ».' : null) });
    if (v === null) return;
    try {
      await api.post('/folders', { name: v.trim(), parentId: data.folder?.id ?? null });
      toast('Dossier créé.');
      await load();
    } catch (err) {
      toast(errorMessage(err), { error: true });
    }
  }

  function fileMenu(anchor, f) {
    const items = [
      { label: 'Ouvrir', icon: 'eye', onClick: () => openFile(f.id) },
      ...(data.canDownload ? [{ label: 'Télécharger', icon: 'download', onClick: () => downloadFile(f.id) }] : []),
      ...(owner() ? ['-', { label: 'Partager', icon: 'share-2', onClick: () => openShareDialog({ kind: 'file', id: f.id, name: f.name }) }, { label: 'Renommer', icon: 'pencil', onClick: async () => (await renameItem('file', f)) && load() }, { label: 'Déplacer', icon: 'folder-input', onClick: async () => (await moveItems([f], [])) && load() }, '-', { label: 'Mettre à la corbeille', icon: 'trash-2', danger: true, onClick: async () => (await trashItems([f], [])) && refresh() }] : []),
    ];
    openMenu(anchor, items);
  }
  function folderMenu(anchor, f) {
    const items = [
      { label: 'Ouvrir', icon: 'folder-open', onClick: () => openFolder(f.id) },
      ...(owner() ? ['-', { label: 'Partager', icon: 'share-2', onClick: () => openShareDialog({ kind: 'folder', id: f.id, name: f.name }) }, { label: 'Renommer', icon: 'pencil', onClick: async () => (await renameItem('folder', f)) && load() }, { label: 'Déplacer', icon: 'folder-input', onClick: async () => (await moveItems([], [f])) && load() }, '-', { label: 'Mettre à la corbeille', icon: 'trash-2', danger: true, onClick: async () => (await trashItems([], [f])) && refresh() }] : []),
    ];
    openMenu(anchor, items);
  }

  const menuBtn = (label, fn) => h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Actions pour ${label}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', on: { click: (e) => fn(e.currentTarget) } }, icon('ellipsis-vertical'));

  function checkbox(kind, id, label) {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Sélectionner ${label}`, checked: state.selected.has(`${kind}:${id}`) });
    cb.addEventListener('change', () => {
      cb.checked ? state.selected.add(`${kind}:${id}`) : state.selected.delete(`${kind}:${id}`);
      updateBulk();
      const tr = cb.closest('tr,.gcard');
      tr?.setAttribute('aria-selected', String(cb.checked));
    });
    return cb;
  }

  const bulk = h('div', { class: 'bulkbar', role: 'region', 'aria-label': 'Actions sur la sélection', hidden: true });
  function selection() {
    const fs = [], ds = [];
    const F = filesById(), D = foldersById();
    for (const k of state.selected) {
      const [kind, id] = k.split(':');
      if (kind === 'file' && F.has(id)) fs.push(F.get(id));
      if (kind === 'folder' && D.has(id)) ds.push(D.get(id));
    }
    return { fs, ds };
  }
  function updateBulk() {
    const n = state.selected.size;
    bulk.hidden = n === 0 || !owner();
    if (bulk.hidden) return;
    const { fs, ds } = selection();
    bulk.replaceChildren(
      h('strong', { text: `${n} sélectionné${n > 1 ? 's' : ''}`, 'aria-live': 'polite' }),
      button({ label: 'Déplacer', icon: 'folder-input', onClick: async () => (await moveItems(fs, ds)) && load() }),
      button({ label: 'Corbeille', icon: 'trash-2', onClick: async () => (await trashItems(fs, ds)) && refresh() }),
      button({ label: 'Tout désélectionner', cls: 'btn btn-secondary btn-sm', onClick: () => { state.selected.clear(); render(); } }),
    );
  }

  function metaCells(f) {
    return [
      h('td', { class: 'col-num col-meta' }, formatBytes(f.sizeBytes)),
      h('td', { class: 'col-hide-sm' }, h('span', { class: 'sub', text: CATEGORY_LABELS[f.category] ?? f.category }), ' ', h('span', { class: 'sub', text: `· ${f.formatLabel}` })),
      h('td', { class: 'col-hide-sm' }, previewBadge(f)),
      h('td', { class: 'col-hide-sm' }, securityBadge(f)),
      h('td', { class: 'col-meta' }, formatDate(f.createdAt)),
    ];
  }

  function listView() {
    const folders = sortItems(data.folders, true), files = sortItems(data.files, false);
    const th = (label, key, cls = '') => {
      const active = state.sort === key;
      return h('th', { scope: 'col', class: cls, 'aria-sort': active ? (state.order === 'asc' ? 'ascending' : 'descending') : 'none' },
        key ? h('button', { type: 'button', class: 'name-link', on: { click: () => { state.order = active && state.order === 'asc' ? 'desc' : 'asc'; state.sort = key; prefs.set('sort', key); prefs.set('order', state.order); searching() ? load() : render(); } } }, label, active ? icon(state.order === 'asc' ? 'arrow-up' : 'arrow-down') : null) : label);
    };
    const tbody = h('tbody');
    for (const f of folders) {
      tbody.append(h('tr', { 'aria-selected': String(state.selected.has(`folder:${f.id}`)) },
        h('td', { class: 'col-check' }, owner() ? checkbox('folder', f.id, f.name) : null),
        h('td', { class: 'col-name' }, h('div', { class: 'name-cell' }, folderIconBox(), h('button', { type: 'button', class: 'name-link', text: f.name, 'aria-label': `Ouvrir le dossier ${f.name}`, on: { click: () => openFolder(f.id) } }))),
        h('td', { class: 'col-num col-meta' }, 'Dossier'), h('td', { class: 'col-hide-sm' }), h('td', { class: 'col-hide-sm' }), h('td', { class: 'col-hide-sm' }),
        h('td', { class: 'col-meta' }, formatDate(f.createdAt)),
        h('td', { class: 'col-act' }, menuBtn(f.name, (a) => folderMenu(a, f)))));
    }
    for (const f of files) {
      tbody.append(h('tr', { 'aria-selected': String(state.selected.has(`file:${f.id}`)) },
        h('td', { class: 'col-check' }, owner() ? checkbox('file', f.id, f.name) : null),
        h('td', { class: 'col-name' }, h('div', { class: 'name-cell' }, fileIconBox(f), h('button', { type: 'button', class: 'name-link', text: f.name, 'aria-label': `Ouvrir ${f.name}`, on: { click: () => openFile(f.id) } }))),
        ...metaCells(f),
        h('td', { class: 'col-act' }, menuBtn(f.name, (a) => fileMenu(a, f)))));
    }
    return h('div', { class: 'panel table-wrap' }, h('table', { class: 'ftable' },
      h('caption', { class: 'sr-only', text: 'Fichiers et dossiers' }),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'col-check' }, h('span', { class: 'sr-only', text: 'Sélection' })), th('Nom', 'name'), th('Taille', 'size', 'col-num'), th('Type', null, 'col-hide-sm'), th('Aperçu', null, 'col-hide-sm'), th('Sécurité', null, 'col-hide-sm'), th('Ajouté le', 'date'), h('th', { scope: 'col', class: 'col-act' }, h('span', { class: 'sr-only', text: 'Actions' })))),
      tbody));
  }

  function gridView() {
    const grid = h('div', { class: 'grid-files' });
    for (const f of sortItems(data.folders, true)) {
      grid.append(h('div', { class: 'gcard' }, folderIconBox(), h('button', { type: 'button', class: 'name-link', text: f.name, on: { click: () => openFolder(f.id) } }), h('p', { class: 'sub m-0', text: 'Dossier' }), h('div', { class: 'gcheck' }, menuBtn(f.name, (a) => folderMenu(a, f)))));
    }
    for (const f of sortItems(data.files, false)) {
      grid.append(h('div', { class: 'gcard' }, fileIconBox(f), h('button', { type: 'button', class: 'name-link', text: f.name, on: { click: () => openFile(f.id) } }), h('p', { class: 'sub m-0', text: `${f.formatLabel} · ${formatBytes(f.sizeBytes)}` }), h('div', {}, previewBadge(f)), h('div', { class: 'gcheck' }, menuBtn(f.name, (a) => fileMenu(a, f)))));
    }
    return grid;
  }

  function breadcrumb() {
    if (searching()) return h('p', { class: 'm-0', role: 'status', text: `${data.total ?? data.files.length} résultat(s)${state.q ? ` pour « ${state.q} »` : ''}` });
    const items = [];
    const base = owner();
    items.push(h('li', {}, data.folder ? h('a', { href: base ? '#/files' : '#/shared' }, base ? 'Mes fichiers' : 'Partagés avec moi') : h('span', { 'aria-current': 'page', text: 'Mes fichiers' })));
    data.breadcrumb.forEach((c, i) => {
      items.push(h('li', {}, icon('chevron-right'), i === data.breadcrumb.length - 1 ? h('span', { 'aria-current': 'page', text: c.name }) : h('a', { href: `#/files/${c.id}`, text: c.name })));
    });
    return h('nav', { 'aria-label': "Fil d'Ariane" }, h('ol', { class: 'crumbs' }, items));
  }

  function filters() {
    const q = h('input', { class: 'input', type: 'search', id: 'f-q', value: state.q, placeholder: 'Rechercher par nom…', 'aria-label': 'Rechercher dans tous mes fichiers' });
    const cat = h('select', { class: 'input select', 'aria-label': 'Filtrer par type' }, h('option', { value: '', text: 'Tous les types' }), (config.categories ?? []).map((c) => h('option', { value: c, text: CATEGORY_LABELS[c] ?? c, selected: c === state.category })));
    const prev = h('select', { class: 'input select', 'aria-label': 'Filtrer par aperçu' }, h('option', { value: '', text: 'Aperçu : tous' }), h('option', { value: 'yes', text: 'Avec aperçu', selected: state.preview === 'yes' }), h('option', { value: 'no', text: 'Stockés seulement', selected: state.preview === 'no' }));
    const go = () => {
      const p = new URLSearchParams();
      if (q.value.trim()) p.set('q', q.value.trim());
      if (cat.value) p.set('category', cat.value);
      if (prev.value) p.set('preview', prev.value);
      location.hash = `#/files${p.toString() ? `?${p}` : ''}`;
    };
    const form = h('form', { class: 'toolbar', 'aria-label': 'Filtres', on: { submit: (e) => { e.preventDefault(); go(); } } }, q, cat, prev,
      h('button', { type: 'submit', class: 'btn btn-secondary btn-sm' }, icon('search'), h('span', { text: 'Rechercher' })),
      searching() ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/files' }, 'Effacer les filtres') : null);
    cat.addEventListener('change', go);
    prev.addEventListener('change', go);
    return form;
  }

  function render() {
    const empty = !data.folders.length && !data.files.length;
    const mode = h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Affichage' },
      button({ icon: 'list', ariaLabel: 'Affichage en liste', title: 'Liste', cls: `btn btn-sm ${state.mode === 'list' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => { state.mode = 'list'; prefs.set('mode', 'list'); render(); } }),
      button({ icon: 'layout-grid', ariaLabel: 'Affichage en grille', title: 'Grille', cls: `btn btn-sm ${state.mode === 'grid' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => { state.mode = 'grid'; prefs.set('mode', 'grid'); render(); } }));
    const top = h('div', { class: 'toolbar' }, breadcrumb(), h('span', { class: 'spacer' }), mode);
    let content;
    if (empty) {
      content = searching()
        ? emptyState({ iconName: 'search-x', title: 'Aucun résultat', text: 'Essaie un autre nom ou retire un filtre.' })
        : owner()
          ? emptyState({ iconName: 'folder-open', title: 'Ce dossier est vide', text: 'Glisse des fichiers ici ou utilise le bouton « Importer ». Formats acceptés : GeoJSON, KML, Shapefile (ZIP), GeoTIFF, GeoPackage, QGIS, images, PDF…' })
          : emptyState({ iconName: 'folder-open', title: 'Ce dossier est vide' });
    } else content = state.mode === 'grid' ? gridView() : listView();
    const notice = !owner() ? h('div', { class: 'notice' }, icon('eye'), h('p', { text: data.canDownload ? 'Ce dossier est partagé avec toi : tu peux le consulter et télécharger ses fichiers.' : 'Ce dossier est partagé avec toi en consultation seule : le téléchargement n\'est pas autorisé.' })) : null;
    body.replaceChildren(...[filters(), top, notice, bulk, content].filter(Boolean));
    updateBulk();
  }

  const actions = [];
  if (owner() && !searching()) {
    actions.push(button({ label: 'Nouveau dossier', icon: 'folder-plus', onClick: newFolder }));
  }
  const importBtn = button({ label: 'Importer', icon: 'upload', cls: 'btn btn-primary', onClick: () => shell.pickFiles() });
  if (folderParam === 'root' || data.level === 'owner') actions.push(importBtn);
  root.append(viewHead(searching() ? 'Recherche' : 'Mes fichiers', 'Tes données SIG, classées comme tu veux.', ...actions), body);
  const unsub = shell.onUploaded(() => load());
  await load();
  // Si le dossier est en lecture seule, retirer les actions d'écriture
  if (!owner()) { importBtn.remove(); }
  return { el: root, title: 'Mes fichiers', destroy: unsub, dropTarget: () => (owner() && !searching() ? (data.folder?.id ?? null) : undefined) };
}
