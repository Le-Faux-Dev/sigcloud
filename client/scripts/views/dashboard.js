import { h, icon, button } from '../dom.js';
import { api } from '../api.js';
import { formatBytes, formatDate, formatPercent, CATEGORY_LABELS } from '../format.js';
import { fileIconBox, emptyState, errorState } from '../ui.js';
import { viewHead, loadingBlock } from './common.js';
import { session } from '../api.js';

export async function dashboardView({ shell }) {
  const root = h('div', { class: 'view' }, loadingBlock());
  const out = { el: root, title: 'Tableau de bord' };
  try {
    const [usage, recent, shared] = await Promise.all([
      api.get('/files/usage'),
      api.get('/files?folderId=all&sort=date&order=desc&limit=6'),
      api.get('/shares/with-me'),
    ]);
    const pct = formatPercent(usage.usedBytes, usage.quotaBytes);
    const name = session.user?.displayName ?? '';
    root.replaceChildren(
      viewHead(`Bonjour ${name}`, 'Voici l\'état de ton espace.', button({ label: 'Importer des fichiers', icon: 'upload', cls: 'btn btn-primary', onClick: () => shell.pickFiles() })),
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('span', { class: 'n', text: String(recent.total) }), h('span', { class: 'l', text: recent.total > 1 ? 'fichiers stockés' : 'fichier stocké' })),
        h('div', { class: 'stat' }, h('span', { class: 'n', text: `${formatBytes(usage.usedBytes)}` }), h('span', { class: 'l', text: `utilisés sur ${formatBytes(usage.quotaBytes)}` }), h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Espace utilisé', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, h('span', { class: pct > 95 ? 'crit' : pct > 80 ? 'warn' : '', data: { w: pct } }))),
        h('div', { class: 'stat' }, h('span', { class: 'n', text: String(shared.items.length) }), h('span', { class: 'l', text: 'partagés avec moi' })),
        h('div', { class: 'stat' }, h('span', { class: 'n', text: String(usage.trashCount) }), h('span', { class: 'l', text: 'dans la corbeille' })),
      ),
      h('section', { class: 'panel', 'aria-labelledby': 'recent-h' }, h('div', { class: 'panel-head' }, h('h2', { id: 'recent-h', text: 'Fichiers récents' }), h('a', { class: 'btn btn-ghost btn-sm', href: '#/files' }, 'Tout voir', icon('arrow-right'))),
        recent.items.length
          ? h('ul', { class: 'list-clean' }, recent.items.map((f) => h('li', { class: 'share-row' }, h('div', { class: 'name-cell' }, fileIconBox(f), h('div', { class: 'min-w-0' }, h('a', { class: 'name-link', href: `#/file/${f.id}`, text: f.name }), h('p', { class: 'sub m-0', text: `${CATEGORY_LABELS[f.category] ?? f.category} · ${formatBytes(f.sizeBytes)} · ${formatDate(f.createdAt)}` }))))))
          : emptyState({ iconName: 'cloud-upload', title: 'Aucun fichier pour le moment', text: 'Importe un GeoJSON, un KML, un Shapefile (ZIP) ou une image : tu pourras le consulter et le partager.', action: button({ label: 'Importer un fichier', icon: 'upload', cls: 'btn btn-primary', onClick: () => shell.pickFiles() }) })),
    );
    // largeur de la jauge : fixée par script (la CSP interdit les styles inline dans le HTML, pas les propriétés DOM)
    root.querySelectorAll('.meter > span[data-w]').forEach((s) => { s.style.width = `${s.dataset.w}%`; });
  } catch (err) {
    root.replaceChildren(errorState(err, { retry: () => shell.reload() }));
  }
  return out;
}
